/**
 * CMS Fee Schedule Fetcher
 *
 * Downloads the CMS DMEPOS fee schedule (public data), processes it, and ingests
 * it into the knowledge base. Runs on a configurable schedule (default: weekly).
 *
 * Manual upload of fee schedule CSVs also works — just upload via the Documents tab.
 * This service automates that process.
 *
 * CMS publishes fee schedules at:
 *   https://www.cms.gov/medicare/payment/fee-schedules/dmepos
 *
 * The URL changes per year/quarter, so it's configurable via env var.
 */

import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { s3Client, S3_BUCKET, S3_PREFIXES } from '../config/aws';
import { logger } from '../utils/logger';
import { ingestDocument } from './ingestion';
import { v4 as uuidv4 } from 'uuid';
import { validateUrl, MAX_DOWNLOAD_SIZE } from '../utils/urlValidation';
import https from 'https';
import http from 'http';
import { createHash } from 'crypto';

// Configurable URL for CMS DMEPOS fee schedule
// Update this when CMS publishes new schedules (quarterly/annually)
const CMS_FEE_SCHEDULE_URL = process.env.CMS_FEE_SCHEDULE_URL || '';

// How often to check for updates (default: weekly)
const FETCH_INTERVAL_HOURS = parseInt(process.env.FEE_SCHEDULE_FETCH_INTERVAL_HOURS || '168', 10); // 168 = 7 days

// S3 key for tracking last fetch metadata
const FETCH_META_KEY = `${S3_PREFIXES.metadata}fee-schedule-meta.json`;

// Collection ID for fee schedule data
const FEE_SCHEDULE_COLLECTION = 'cms-fee-schedules';

interface FetchMeta {
  lastFetchDate: string;
  lastContentHash: string;
  sourceUrl: string;
  recordCount: number;
}

/**
 * Download a file from a URL and return as Buffer.
 * Validates the URL against SSRF attacks before downloading.
 */
function downloadFile(url: string, redirectCount = 0): Promise<Buffer> {
  if (redirectCount > 5) {
    return Promise.reject(new Error('Too many redirects'));
  }

  const urlError = validateUrl(url);
  if (urlError) {
    return Promise.reject(new Error(`Invalid URL: ${urlError}`));
  }

  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const request = client.get(url, { timeout: 60000 }, (response) => {
      // Follow redirects — re-validate each redirect target
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        downloadFile(response.headers.location, redirectCount + 1).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode} from ${url}`));
        return;
      }

      const chunks: Buffer[] = [];
      let totalSize = 0;
      response.on('data', (chunk: Buffer) => {
        totalSize += chunk.length;
        if (totalSize > MAX_DOWNLOAD_SIZE) {
          request.destroy();
          reject(new Error(`Download exceeds maximum size of ${MAX_DOWNLOAD_SIZE} bytes`));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    });

    request.on('error', reject);
    request.on('timeout', () => {
      request.destroy();
      reject(new Error(`Timeout fetching ${url}`));
    });
  });
}

/**
 * Load the last fetch metadata from S3.
 */
async function loadFetchMeta(): Promise<FetchMeta | null> {
  try {
    const response = await s3Client.send(new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: FETCH_META_KEY,
    }));
    const body = await response.Body?.transformToString();
    return body ? JSON.parse(body) : null;
  } catch {
    return null;
  }
}

/**
 * Save fetch metadata to S3.
 */
async function saveFetchMeta(meta: FetchMeta): Promise<void> {
  await s3Client.send(new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: FETCH_META_KEY,
    Body: JSON.stringify(meta),
    ContentType: 'application/json',
  }));
}

/**
 * Process a fee schedule CSV into chunked, readable text.
 * CMS DMEPOS fee schedules typically have columns like:
 *   HCPCS, Modifier, Description, Pricing Indicator, Fee Amount, etc.
 *
 * We format it for readability and better RAG retrieval.
 */
function processFeeScheduleCsv(csvContent: string): { text: string; recordCount: number } {
  const lines = csvContent.split('\n').filter(l => l.trim());
  if (lines.length < 2) return { text: csvContent, recordCount: 0 };

  const header = lines[0];
  const headerFields = parseCSVLine(header);

  // Find key column indices (flexible matching)
  const hcpcsIdx = headerFields.findIndex(h => /hcpcs|code/i.test(h));
  const descIdx = headerFields.findIndex(h => /desc/i.test(h));
  const feeIdx = headerFields.findIndex(h => /fee|amount|price|rate|charge/i.test(h));
  const modIdx = headerFields.findIndex(h => /mod/i.test(h));

  const formattedLines: string[] = [
    '# CMS DMEPOS Fee Schedule',
    `Source: CMS.gov | Columns: ${headerFields.join(', ')}`,
    `Total records: ${lines.length - 1}`,
    '',
    '---',
    '',
  ];

  let currentCode = '';
  let recordCount = 0;

  for (let i = 1; i < lines.length; i++) {
    const fields = parseCSVLine(lines[i]);
    if (fields.length < 2) continue;

    recordCount++;
    const code = hcpcsIdx >= 0 ? fields[hcpcsIdx]?.trim() : '';
    const desc = descIdx >= 0 ? fields[descIdx]?.trim() : '';
    const fee = feeIdx >= 0 ? fields[feeIdx]?.trim() : '';
    const mod = modIdx >= 0 ? fields[modIdx]?.trim() : '';

    // Group by HCPCS code for better chunking
    if (code && code !== currentCode) {
      if (currentCode) formattedLines.push('');
      formattedLines.push(`## ${code}${desc ? ` — ${desc}` : ''}`);
      currentCode = code;
    }

    // Format each row
    const parts: string[] = [];
    for (let j = 0; j < fields.length && j < headerFields.length; j++) {
      if (j === hcpcsIdx || j === descIdx) continue; // Already in header
      if (fields[j]?.trim()) {
        parts.push(`${headerFields[j]}: ${fields[j].trim()}`);
      }
    }
    if (parts.length) {
      formattedLines.push(`  ${mod ? `[${mod}] ` : ''}${parts.join(' | ')}`);
    }
  }

  return { text: formattedLines.join('\n'), recordCount };
}

/**
 * Simple CSV line parser that handles quoted fields.
 */
function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

/**
 * Fetch and ingest the CMS fee schedule.
 * Returns true if new data was ingested, false if skipped (no changes or no URL configured).
 */
export async function fetchAndIngestFeeSchedule(forceRefresh: boolean = false): Promise<{
  ingested: boolean;
  message: string;
  recordCount?: number;
}> {
  if (!CMS_FEE_SCHEDULE_URL) {
    return {
      ingested: false,
      message: 'No CMS_FEE_SCHEDULE_URL configured. Set the environment variable to enable auto-fetch.',
    };
  }

  logger.info('Checking CMS fee schedule', { url: CMS_FEE_SCHEDULE_URL, forceRefresh });

  // Check last fetch metadata
  const meta = await loadFetchMeta();
  if (meta && !forceRefresh) {
    const lastFetch = new Date(meta.lastFetchDate);
    const hoursSince = (Date.now() - lastFetch.getTime()) / (1000 * 60 * 60);
    if (hoursSince < FETCH_INTERVAL_HOURS) {
      return {
        ingested: false,
        message: `Last fetched ${Math.round(hoursSince)} hours ago. Next check in ${Math.round(FETCH_INTERVAL_HOURS - hoursSince)} hours.`,
      };
    }
  }

  // Download the file
  let fileBuffer: Buffer;
  try {
    fileBuffer = await downloadFile(CMS_FEE_SCHEDULE_URL);
    logger.info('Downloaded fee schedule', { sizeBytes: fileBuffer.length });
  } catch (error: any) {
    logger.error('Failed to download fee schedule', { error: error.message });
    return { ingested: false, message: `Download failed: ${error.message}` };
  }

  // Check if content has changed
  const contentHash = createHash('sha256').update(fileBuffer).digest('hex');
  if (meta?.lastContentHash === contentHash && !forceRefresh) {
    // Update fetch date but don't re-ingest
    await saveFetchMeta({ ...meta, lastFetchDate: new Date().toISOString() });
    return { ingested: false, message: 'Fee schedule has not changed since last fetch.' };
  }

  // Determine file type and process
  const url = CMS_FEE_SCHEDULE_URL.toLowerCase();
  let csvContent: string;

  if (url.endsWith('.csv')) {
    csvContent = fileBuffer.toString('utf-8');
  } else if (url.endsWith('.zip')) {
    // For ZIP files, we'd need a ZIP library — for now, guide the user
    return {
      ingested: false,
      message: 'ZIP files detected. Please extract the CSV from the ZIP and either upload it manually via the Documents tab, or set CMS_FEE_SCHEDULE_URL to the direct CSV link.',
    };
  } else {
    // Try as CSV
    csvContent = fileBuffer.toString('utf-8');
  }

  // Process the CSV into readable text
  const { text, recordCount } = processFeeScheduleCsv(csvContent);

  if (recordCount < 1) {
    return { ingested: false, message: 'No valid records found in the fee schedule file.' };
  }

  // Ingest into the knowledge base
  const textBuffer = Buffer.from(text, 'utf-8');
  const filename = `CMS-DMEPOS-Fee-Schedule-${new Date().toISOString().slice(0, 10)}.txt`;

  try {
    await ingestDocument(
      textBuffer,
      filename,
      'text/plain',
      FEE_SCHEDULE_COLLECTION,
      'system', // uploaded by system
    );

    // Save metadata
    await saveFetchMeta({
      lastFetchDate: new Date().toISOString(),
      lastContentHash: contentHash,
      sourceUrl: CMS_FEE_SCHEDULE_URL,
      recordCount,
    });

    logger.info('Fee schedule ingested', { recordCount, filename });

    return {
      ingested: true,
      message: `Successfully ingested ${recordCount} fee schedule records.`,
      recordCount,
    };
  } catch (error: any) {
    logger.error('Fee schedule ingestion failed', { error: error.message });
    return { ingested: false, message: `Ingestion failed: ${error.message}` };
  }
}

// Background scheduler
let schedulerInterval: ReturnType<typeof setInterval> | null = null;

export function startFeeScheduleFetcher(): void {
  if (!CMS_FEE_SCHEDULE_URL) {
    logger.info('CMS fee schedule auto-fetch disabled (no URL configured)');
    return;
  }

  logger.info('Starting CMS fee schedule auto-fetcher', {
    intervalHours: FETCH_INTERVAL_HOURS,
    url: CMS_FEE_SCHEDULE_URL,
  });

  // Initial fetch after 5 minutes (let the server warm up first)
  setTimeout(() => {
    fetchAndIngestFeeSchedule().catch(err => {
      logger.error('Fee schedule initial fetch failed', { error: String(err) });
    });
  }, 5 * 60 * 1000);

  // Recurring check
  schedulerInterval = setInterval(() => {
    fetchAndIngestFeeSchedule().catch(err => {
      logger.error('Fee schedule periodic fetch failed', { error: String(err) });
    });
  }, FETCH_INTERVAL_HOURS * 60 * 60 * 1000);
}

export function stopFeeScheduleFetcher(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}
