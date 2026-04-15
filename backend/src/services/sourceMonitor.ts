/**
 * Document Source Monitor
 *
 * Monitors a list of configured URLs (public policy docs, fee schedules, LCD PDFs, etc.)
 * for content changes. When a change is detected, the new version is automatically
 * downloaded and ingested into the knowledge base, replacing the previous version.
 *
 * Sources are stored in S3 metadata and managed via admin API endpoints.
 *
 * Supports: PDF, CSV, TXT, and auto-detection by URL extension / Content-Type header.
 */

import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { s3Client, S3_BUCKET, S3_PREFIXES } from '../config/aws';
import { logger } from '../utils/logger';
import { ingestDocument } from './ingestion';
import { removeDocumentChunks } from './vectorStore';
import { getDocumentsIndex, saveDocumentsIndex } from './s3Storage';
import { MonitoredSource } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { validateUrl, MAX_DOWNLOAD_SIZE } from '../utils/urlValidation';
import { createHash } from 'crypto';
import https from 'https';
import http from 'http';
import { sendOperationalAlert } from './alertService';

// S3 key for the source registry
const SOURCES_INDEX_KEY = `${S3_PREFIXES.metadata}monitored-sources.json`;

// Default check interval: every 24 hours
const DEFAULT_CHECK_INTERVAL_HOURS = 24;

// Scheduler runs every hour to check if any sources are due
const SCHEDULER_TICK_MS = 60 * 60 * 1000; // 1 hour

let schedulerInterval: ReturnType<typeof setInterval> | null = null;

// ─── Source Registry (S3-backed) ───────────────────────────────────────

export async function getMonitoredSources(): Promise<MonitoredSource[]> {
  try {
    const response = await s3Client.send(new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: SOURCES_INDEX_KEY,
    }));
    const body = await response.Body?.transformToString();
    return body ? JSON.parse(body) : [];
  } catch (err) {
    logger.warn('Failed to load monitored sources index from S3', { error: String(err) });
    return [];
  }
}

export async function saveMonitoredSources(sources: MonitoredSource[]): Promise<void> {
  await s3Client.send(new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: SOURCES_INDEX_KEY,
    Body: JSON.stringify(sources, null, 2),
    ContentType: 'application/json',
    ServerSideEncryption: 'AES256',
  }));
}

// ─── CRUD ──────────────────────────────────────────────────────────────

export async function addMonitoredSource(input: {
  name: string;
  url: string;
  collectionId: string;
  checkIntervalHours?: number;
  fileType?: MonitoredSource['fileType'];
  category?: string;
  createdBy: string;
  expectedUpdateCadenceDays?: number;
}): Promise<MonitoredSource> {
  const sources = await getMonitoredSources();

  // Validate URL against SSRF attacks
  const urlError = validateUrl(input.url);
  if (urlError) {
    throw new Error(`Invalid URL: ${urlError}`);
  }

  // Prevent duplicate URLs
  if (sources.find(s => s.url === input.url)) {
    throw new Error('A source with this URL is already being monitored');
  }

  if (
    input.expectedUpdateCadenceDays !== undefined &&
    (input.expectedUpdateCadenceDays <= 0 || !Number.isFinite(input.expectedUpdateCadenceDays))
  ) {
    throw new Error('expectedUpdateCadenceDays must be a positive number');
  }

  const source: MonitoredSource = {
    id: uuidv4(),
    name: input.name,
    url: input.url,
    collectionId: input.collectionId,
    checkIntervalHours: input.checkIntervalHours || DEFAULT_CHECK_INTERVAL_HOURS,
    fileType: input.fileType || 'auto',
    enabled: true,
    category: input.category || 'general',
    createdBy: input.createdBy,
    createdAt: new Date().toISOString(),
    expectedUpdateCadenceDays: input.expectedUpdateCadenceDays,
  };

  sources.push(source);
  await saveMonitoredSources(sources);
  logger.info('Monitored source added', { id: source.id, name: source.name, url: source.url });

  return source;
}

export async function updateMonitoredSource(
  id: string,
  updates: Partial<Pick<MonitoredSource, 'name' | 'url' | 'collectionId' | 'checkIntervalHours' | 'fileType' | 'enabled' | 'category' | 'expectedUpdateCadenceDays'>>
): Promise<MonitoredSource> {
  const sources = await getMonitoredSources();
  const idx = sources.findIndex(s => s.id === id);
  if (idx === -1) throw new Error('Monitored source not found');

  // If URL is changing, validate and check for duplicates
  if (updates.url && updates.url !== sources[idx].url) {
    const urlError = validateUrl(updates.url);
    if (urlError) {
      throw new Error(`Invalid URL: ${urlError}`);
    }
    if (sources.find(s => s.url === updates.url && s.id !== id)) {
      throw new Error('A source with this URL is already being monitored');
    }
  }

  if (
    updates.expectedUpdateCadenceDays !== undefined &&
    updates.expectedUpdateCadenceDays !== null &&
    (updates.expectedUpdateCadenceDays <= 0 || !Number.isFinite(updates.expectedUpdateCadenceDays))
  ) {
    throw new Error('expectedUpdateCadenceDays must be a positive number');
  }

  Object.assign(sources[idx], updates);
  await saveMonitoredSources(sources);
  return sources[idx];
}

export async function removeMonitoredSource(id: string): Promise<void> {
  const sources = await getMonitoredSources();
  const idx = sources.findIndex(s => s.id === id);
  if (idx === -1) throw new Error('Monitored source not found');

  const source = sources[idx];

  // Clean up the last ingested document if it exists
  if (source.lastDocumentId) {
    try {
      await removeDocumentChunks(source.lastDocumentId);
      const docs = await getDocumentsIndex();
      const updated = docs.filter(d => d.id !== source.lastDocumentId);
      if (updated.length !== docs.length) {
        await saveDocumentsIndex(updated);
      }
    } catch (err) {
      logger.warn('Failed to clean up document for removed source', {
        sourceId: id,
        documentId: source.lastDocumentId,
        error: String(err),
      });
    }
  }

  sources.splice(idx, 1);
  await saveMonitoredSources(sources);
  logger.info('Monitored source removed', { id, name: source.name });
}

// ─── Download Utility ──────────────────────────────────────────────────

function downloadFile(url: string, timeoutMs = 60000, redirectCount = 0): Promise<{ buffer: Buffer; contentType?: string }> {
  if (redirectCount > 5) {
    return Promise.reject(new Error('Too many redirects'));
  }

  const urlError = validateUrl(url);
  if (urlError) {
    return Promise.reject(new Error(`Invalid URL: ${urlError}`));
  }

  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const request = client.get(url, { timeout: timeoutMs }, (response) => {
      // Follow redirects — re-validate each redirect target
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        // Resolve relative redirect URLs against the original URL
        let redirectUrl: string;
        try {
          redirectUrl = new URL(response.headers.location, url).href;
        } catch {
          reject(new Error(`Invalid redirect URL: ${response.headers.location}`));
          return;
        }
        // Re-validate the redirect target to prevent SSRF via open redirect.
        // An attacker-controlled redirect could point to internal IPs, localhost,
        // or cloud metadata endpoints even if the original URL was validated.
        const redirectError = validateUrl(redirectUrl);
        if (redirectError) {
          reject(new Error(`Redirect target blocked: ${redirectError}`));
          return;
        }
        downloadFile(redirectUrl, timeoutMs, redirectCount + 1).then(resolve).catch(reject);
        return;
      }

      if (!response.statusCode || response.statusCode !== 200) {
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
      response.on('end', () => resolve({
        buffer: Buffer.concat(chunks),
        contentType: response.headers['content-type'],
      }));
      response.on('error', reject);
    });

    request.on('error', reject);
    request.on('timeout', () => {
      request.destroy();
      reject(new Error(`Timeout fetching ${url}`));
    });
  });
}

// ─── File Type Detection ───────────────────────────────────────────────

function detectMimeType(url: string, contentType?: string, fileType?: MonitoredSource['fileType']): string {
  // Explicit file type takes precedence
  if (fileType && fileType !== 'auto') {
    const mimeMap: Record<string, string> = {
      pdf: 'application/pdf',
      csv: 'text/csv',
      txt: 'text/plain',
      html: 'text/html',
    };
    return mimeMap[fileType] || 'application/octet-stream';
  }

  // Check Content-Type header
  if (contentType) {
    const ct = contentType.toLowerCase().split(';')[0].trim();
    if (ct === 'application/pdf') return 'application/pdf';
    if (ct === 'text/csv') return 'text/csv';
    if (ct === 'text/html') return 'text/html';
    if (ct.startsWith('text/')) return 'text/plain';
  }

  // Fall back to URL extension
  const urlLower = url.toLowerCase().split('?')[0];
  if (urlLower.endsWith('.pdf')) return 'application/pdf';
  if (urlLower.endsWith('.csv')) return 'text/csv';
  if (urlLower.endsWith('.txt') || urlLower.endsWith('.md')) return 'text/plain';
  if (urlLower.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

  return 'application/pdf'; // Default assumption for policy documents
}

function detectFilename(source: MonitoredSource, contentType?: string): string {
  // Build a filename from the source name (preferred — unique per source)
  const safeName = source.name.replace(/[^a-zA-Z0-9-_]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  const mimeType = detectMimeType(source.url, contentType, source.fileType);
  const extMap: Record<string, string> = {
    'application/pdf': '.pdf',
    'text/csv': '.csv',
    'text/plain': '.txt',
    'text/html': '.html',
  };
  const ext = extMap[mimeType] || '.pdf';
  return `${safeName}${ext}`;
}

// ─── Check & Ingest a Single Source ────────────────────────────────────

export async function checkSource(source: MonitoredSource): Promise<{
  changed: boolean;
  ingested: boolean;
  message: string;
}> {
  logger.info('Checking monitored source', { id: source.id, name: source.name, url: source.url });

  // Download the file
  let buffer: Buffer;
  let contentType: string | undefined;
  try {
    const result = await downloadFile(source.url);
    buffer = result.buffer;
    contentType = result.contentType;
  } catch (error: unknown) {
    const msg = `Download failed: ${(error as Error).message}`;
    logger.warn('Source check failed', { sourceId: source.id, error: msg });
    // Update source metadata with error
    await updateSourceCheckResult(source.id, {
      lastCheckedAt: new Date().toISOString(),
      lastError: msg,
      lastHttpStatus: extractHttpStatus((error as Error).message),
    });
    return { changed: false, ingested: false, message: msg };
  }

  // Hash the content
  const contentHash = createHash('sha256').update(buffer).digest('hex');

  // Check if content has changed
  if (contentHash === source.lastContentHash) {
    await updateSourceCheckResult(source.id, {
      lastCheckedAt: new Date().toISOString(),
      lastError: undefined,
      lastHttpStatus: 200,
    });
    return { changed: false, ingested: false, message: 'No changes detected' };
  }

  // Content has changed — ingest the new version
  const mimeType = detectMimeType(source.url, contentType, source.fileType);
  const filename = detectFilename(source, contentType);

  logger.info('Source content changed, re-ingesting', {
    sourceId: source.id,
    name: source.name,
    oldHash: source.lastContentHash?.slice(0, 12),
    newHash: contentHash.slice(0, 12),
    mimeType,
    filename,
    sizeBytes: buffer.length,
  });

  try {
    // Remove previous version's chunks if we had one
    if (source.lastDocumentId) {
      try {
        await removeDocumentChunks(source.lastDocumentId);
        const docs = await getDocumentsIndex();
        const docIdx = docs.findIndex(d => d.id === source.lastDocumentId);
        if (docIdx !== -1) {
          docs[docIdx].status = 'error';
          docs[docIdx].errorMessage = `Replaced by updated version from ${source.name}`;
          await saveDocumentsIndex(docs);
        }
      } catch (err) {
        logger.warn('Failed to clean up previous version', { error: String(err) });
      }
    }

    // Ingest new version
    const result = await ingestDocument(
      buffer,
      filename,
      mimeType,
      source.collectionId,
      'source-monitor',
    );

    // Update source metadata
    const nowIso = new Date().toISOString();
    await updateSourceCheckResult(source.id, {
      lastCheckedAt: nowIso,
      lastContentHash: contentHash,
      lastIngestedAt: nowIso,
      lastContentChangeAt: nowIso,
      // Clear any prior staleness alert state — we have fresh content
      lastStalenessAlertAt: undefined,
      lastDocumentId: result.document.id,
      lastError: undefined,
      lastHttpStatus: 200,
    });

    logger.info('Source ingested successfully', {
      sourceId: source.id,
      name: source.name,
      documentId: result.document.id,
      chunkCount: result.chunkCount,
    });

    return {
      changed: true,
      ingested: true,
      message: `Ingested ${result.chunkCount} chunks from updated ${source.name}`,
    };
  } catch (error: unknown) {
    const msg = `Ingestion failed: ${(error as Error).message}`;
    await updateSourceCheckResult(source.id, {
      lastCheckedAt: new Date().toISOString(),
      lastError: msg,
      // Omit lastHttpStatus — the HTTP download succeeded but ingestion failed.
      // Reporting 200 here would mislead operators into thinking the source is healthy.
    });
    // Send operational alert (throttled to 1/hour)
    sendOperationalAlert('ingestion_failed', `Source monitor ingestion failed: ${source.name}`, {
      sourceId: source.id,
      sourceName: source.name,
      url: source.url,
      error: (error as Error).message,
    }).catch(() => {});
    return { changed: true, ingested: false, message: msg };
  }
}

// ─── Batch Check (all due sources) ────────────────────────────────────

export async function checkAllDueSources(): Promise<{
  checked: number;
  changed: number;
  ingested: number;
  errors: number;
  results: Array<{ sourceId: string; name: string; changed: boolean; ingested: boolean; message: string }>;
}> {
  const sources = await getMonitoredSources();
  const enabledSources = sources.filter(s => s.enabled);

  const now = Date.now();
  const dueSources = enabledSources.filter(s => {
    if (!s.lastCheckedAt) return true; // Never checked
    const lastCheck = new Date(s.lastCheckedAt).getTime();
    const intervalMs = s.checkIntervalHours * 60 * 60 * 1000;
    return (now - lastCheck) >= intervalMs;
  });

  if (dueSources.length === 0) {
    return { checked: 0, changed: 0, ingested: 0, errors: 0, results: [] };
  }

  logger.info('Source monitor: checking due sources', {
    total: enabledSources.length,
    due: dueSources.length,
  });

  const results: Array<{ sourceId: string; name: string; changed: boolean; ingested: boolean; message: string }> = [];
  let changed = 0;
  let ingested = 0;
  let errors = 0;

  // Check sources in parallel with a concurrency limit to balance speed vs. load.
  // Without parallelism, 10 sources with 1-minute timeouts would take 10+ minutes.
  const CONCURRENCY_LIMIT = 3;
  for (let i = 0; i < dueSources.length; i += CONCURRENCY_LIMIT) {
    const batch = dueSources.slice(i, i + CONCURRENCY_LIMIT);
    const batchResults = await Promise.allSettled(
      batch.map(async (source) => {
        const result = await checkSource(source);
        return { source, result };
      })
    );

    for (let j = 0; j < batchResults.length; j++) {
      const settled = batchResults[j];
      if (settled.status === 'fulfilled') {
        const { source, result } = settled.value;
        results.push({
          sourceId: source.id,
          name: source.name,
          changed: result.changed,
          ingested: result.ingested,
          message: result.message,
        });
        if (result.changed) changed++;
        if (result.ingested) ingested++;
        if (!result.ingested && result.changed) errors++;
      } else {
        // Use index j directly — indexOf() could return wrong index for duplicate objects
        const source = batch[j];
        errors++;
        results.push({
          sourceId: source.id,
          name: source.name,
          changed: false,
          ingested: false,
          message: `Unexpected error: ${String(settled.reason)}`,
        });
      }
    }
  }

  logger.info('Source monitor: check complete', { checked: dueSources.length, changed, ingested, errors });
  return { checked: dueSources.length, changed, ingested, errors, results };
}

// ─── Force-check a single source by ID ────────────────────────────────

export async function forceCheckSource(id: string): Promise<{
  changed: boolean;
  ingested: boolean;
  message: string;
}> {
  const sources = await getMonitoredSources();
  const source = sources.find(s => s.id === id);
  if (!source) throw new Error('Monitored source not found');
  return checkSource(source);
}

// ─── Helpers ───────────────────────────────────────────────────────────

async function updateSourceCheckResult(
  sourceId: string,
  updates: Partial<MonitoredSource>
): Promise<void> {
  const sources = await getMonitoredSources();
  const idx = sources.findIndex(s => s.id === sourceId);
  if (idx === -1) return;
  Object.assign(sources[idx], updates);
  await saveMonitoredSources(sources);
}

function extractHttpStatus(errorMessage: string): number | undefined {
  const match = errorMessage.match(/HTTP (\d+)/);
  return match ? parseInt(match[1], 10) : undefined;
}

// ─── Staleness Audit ──────────────────────────────────────────────────
//
// Distinguishes "we fetched this OK and it was unchanged" from "this URL
// hasn't produced fresh content for too long" — the latter almost always
// means an upstream breakage (URL moved, page restructured, credentials
// expired) that silent-success monitoring would miss.
//
// A source is considered stale when ALL of:
//   - It's enabled and has expectedUpdateCadenceDays configured
//   - Its last content change (or creation, if never changed) is older than
//     expectedUpdateCadenceDays
// Alerts are throttled per-source via lastStalenessAlertAt (min 24h between
// alerts for the same source) and per-category via alertService (1/hr).

const STALENESS_ALERT_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface StalenessReport {
  sourceId: string;
  name: string;
  url: string;
  expectedCadenceDays: number;
  daysSinceLastChange: number;
  lastContentChangeAt?: string;
  lastCheckedAt?: string;
  alertedNow: boolean;
}

/**
 * Compute days between two ISO timestamps. Returns Infinity if `from` is missing.
 */
function daysSince(fromIso: string | undefined, nowMs: number): number {
  if (!fromIso) return Infinity;
  const t = new Date(fromIso).getTime();
  if (!Number.isFinite(t)) return Infinity;
  return (nowMs - t) / (24 * 60 * 60 * 1000);
}

/**
 * Audit all monitored sources for staleness. For any source that has exceeded
 * its configured cadence, send an operational alert (rate-limited per source)
 * and stamp lastStalenessAlertAt. Returns a report of all stale sources,
 * whether or not they were alerted this run.
 */
export async function auditStaleSources(): Promise<StalenessReport[]> {
  const sources = await getMonitoredSources();
  const now = Date.now();
  const reports: StalenessReport[] = [];

  for (const s of sources) {
    if (!s.enabled) continue;
    if (!s.expectedUpdateCadenceDays || s.expectedUpdateCadenceDays <= 0) continue;

    // Use lastContentChangeAt if we've ever observed a change; otherwise
    // fall back to createdAt — freshly-added sources shouldn't alert
    // immediately, so createdAt gives the source a grace period equal to
    // its cadence before first alert.
    const anchor = s.lastContentChangeAt || s.createdAt;
    const ageDays = daysSince(anchor, now);
    if (ageDays <= s.expectedUpdateCadenceDays) continue;

    // Throttle: don't alert the same source more than once per 24h
    const recentlyAlerted =
      s.lastStalenessAlertAt &&
      now - new Date(s.lastStalenessAlertAt).getTime() < STALENESS_ALERT_MIN_INTERVAL_MS;

    let alertedNow = false;
    if (!recentlyAlerted) {
      try {
        await sendOperationalAlert(
          'source_stale',
          `Source stale: ${s.name} hasn't changed in ${Math.floor(ageDays)} days (expected every ${s.expectedUpdateCadenceDays})`,
          {
            sourceId: s.id,
            sourceName: s.name,
            url: s.url,
            daysSinceLastChange: Math.floor(ageDays),
            expectedCadenceDays: s.expectedUpdateCadenceDays,
            lastContentChangeAt: s.lastContentChangeAt || '(never changed)',
            lastCheckedAt: s.lastCheckedAt || '(never checked)',
          },
        );
        await updateSourceCheckResult(s.id, {
          lastStalenessAlertAt: new Date().toISOString(),
        });
        alertedNow = true;
      } catch (err) {
        logger.error('Failed to record staleness alert', { sourceId: s.id, error: String(err) });
      }
    }

    reports.push({
      sourceId: s.id,
      name: s.name,
      url: s.url,
      expectedCadenceDays: s.expectedUpdateCadenceDays,
      daysSinceLastChange: Math.floor(ageDays),
      lastContentChangeAt: s.lastContentChangeAt,
      lastCheckedAt: s.lastCheckedAt,
      alertedNow,
    });
  }

  if (reports.length > 0) {
    logger.info('Source staleness audit complete', {
      stale: reports.length,
      alerted: reports.filter(r => r.alertedNow).length,
    });
  }
  return reports;
}

// ─── Background Scheduler ──────────────────────────────────────────────

// Staleness audit runs every 24 hours on its own cadence — checking more
// often wastes cycles since alerts are throttled to once per 24h per source.
const STALENESS_TICK_MS = 24 * 60 * 60 * 1000;
let stalenessInterval: ReturnType<typeof setInterval> | null = null;

export function startSourceMonitor(): void {
  logger.info('Starting document source monitor', {
    tickIntervalMinutes: SCHEDULER_TICK_MS / 60000,
    stalenessTickHours: STALENESS_TICK_MS / 3600000,
  });

  // Initial check after 10 minutes (let server warm up, after fee schedule fetcher)
  setTimeout(() => {
    checkAllDueSources().catch(err => {
      logger.error('Source monitor initial check failed', { error: String(err) });
    });
  }, 10 * 60 * 1000);

  // Recurring tick
  schedulerInterval = setInterval(() => {
    checkAllDueSources().catch(err => {
      logger.error('Source monitor periodic check failed', { error: String(err) });
    });
  }, SCHEDULER_TICK_MS);

  // Staleness audit: initial run 30 min after boot, then daily
  setTimeout(() => {
    auditStaleSources().catch(err => {
      logger.error('Initial staleness audit failed', { error: String(err) });
    });
  }, 30 * 60 * 1000);

  stalenessInterval = setInterval(() => {
    auditStaleSources().catch(err => {
      logger.error('Periodic staleness audit failed', { error: String(err) });
    });
  }, STALENESS_TICK_MS);
}

export function stopSourceMonitor(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
  if (stalenessInterval) {
    clearInterval(stalenessInterval);
    stalenessInterval = null;
  }
  logger.info('Document source monitor stopped');
}
