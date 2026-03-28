import {
  TextractClient,
  DetectDocumentTextCommand,
  AnalyzeDocumentCommand,
  StartDocumentTextDetectionCommand,
  GetDocumentTextDetectionCommand,
} from '@aws-sdk/client-textract';
import { s3Client, S3_BUCKET } from '../config/aws';
import { PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';

const region = process.env.AWS_REGION || 'us-east-1';

const textractClient = new TextractClient({
  region,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
});

export interface OcrResult {
  text: string;
  pageCount: number;
  confidence: number; // average confidence across all detected text blocks
}

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 120; // 4 minutes max
const OCR_TIMEOUT_MS = 5 * 60 * 1000; // 5-minute hard timeout for entire OCR operation
const MAX_TRANSIENT_RETRIES = 3; // Retry transient errors (HTTP 500) up to 3 times

/**
 * Determine whether to use async Textract (multi-page PDFs) or sync (single-page images / small PDFs).
 * The sync API only supports single-page PDFs via bytes. For multi-page or large PDFs,
 * we upload to S3 and use the async StartDocumentTextDetection API.
 */
export async function extractTextWithOcr(buffer: Buffer, filename: string): Promise<OcrResult> {
  logger.info('Starting OCR extraction', { filename, sizeBytes: buffer.length });

  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const isPdf = ext === 'pdf';

  // Wrap in a hard timeout to prevent indefinite hangs if Textract is unresponsive.
  // Without this, a stuck job could block the request forever.
  const ocrPromise = isPdf
    ? extractTextWithAsyncOcr(buffer, filename)
    : extractTextWithSyncOcr(buffer, filename);

  let timeoutId: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`OCR timed out after ${OCR_TIMEOUT_MS / 1000}s`)), OCR_TIMEOUT_MS);
  });

  try {
    return await Promise.race([ocrPromise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId!);
  }
}

/**
 * Synchronous Textract for single-page images (PNG, JPEG, TIFF).
 * Retries transient errors (HTTP 5xx, throttle) up to MAX_TRANSIENT_RETRIES times.
 */
async function extractTextWithSyncOcr(buffer: Buffer, filename: string): Promise<OcrResult> {
  const command = new DetectDocumentTextCommand({
    Document: {
      Bytes: buffer,
    },
  });

  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_TRANSIENT_RETRIES; attempt++) {
    try {
      const response = await textractClient.send(command);
      return parseTextractBlocks(response.Blocks || [], filename);
    } catch (err: unknown) {
      lastError = err;
      const isTransient = isTransientError(err);
      if (!isTransient || attempt === MAX_TRANSIENT_RETRIES) {
        throw err;
      }
      const delayMs = POLL_INTERVAL_MS * (attempt + 1); // 2s, 4s, 6s
      logger.warn('Sync OCR transient error, retrying', {
        filename, attempt: attempt + 1, maxRetries: MAX_TRANSIENT_RETRIES, error: String(err),
      });
      await sleep(delayMs);
    }
  }
  throw lastError; // Should not reach here, but satisfies TypeScript
}

/**
 * Async Textract for PDFs (supports multi-page).
 * Uploads to a temp S3 key, starts an async job, polls for completion, then cleans up.
 */
async function extractTextWithAsyncOcr(buffer: Buffer, filename: string): Promise<OcrResult> {
  const tempKey = `temp-ocr/${uuidv4()}.pdf`;

  try {
    // Upload to temp S3 location
    logger.info('Uploading PDF to S3 for async OCR', { tempKey, filename });
    await s3Client.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: tempKey,
      Body: buffer,
      ContentType: 'application/pdf',
    }));

    // Start async text detection job
    const startCommand = new StartDocumentTextDetectionCommand({
      DocumentLocation: {
        S3Object: {
          Bucket: S3_BUCKET,
          Name: tempKey,
        },
      },
    });

    const startResponse = await textractClient.send(startCommand);
    const jobId = startResponse.JobId;

    if (!jobId) {
      throw new Error('Textract did not return a JobId');
    }

    logger.info('Async OCR job started', { jobId, filename });

    // Phase 1: Poll until job completes (IN_PROGRESS → SUCCEEDED or FAILED).
    // Transient errors (network/HTTP 500) are retried up to MAX_TRANSIENT_RETRIES
    // times per poll attempt instead of being treated as permanent failures.
    let jobStatus = 'IN_PROGRESS';
    let transientRetries = 0;
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
      await sleep(POLL_INTERVAL_MS);

      let getResponse;
      try {
        const getCommand = new GetDocumentTextDetectionCommand({ JobId: jobId });
        getResponse = await textractClient.send(getCommand);
        transientRetries = 0; // Reset on success
      } catch (pollError: unknown) {
        // Transient network/server errors — retry a few times before giving up
        transientRetries++;
        if (transientRetries <= MAX_TRANSIENT_RETRIES) {
          logger.warn('Textract poll transient error, retrying', {
            jobId, attempt, transientRetries, error: String(pollError),
          });
          continue;
        }
        throw new Error(`Textract polling failed after ${MAX_TRANSIENT_RETRIES} retries: ${String(pollError)}`);
      }

      jobStatus = getResponse.JobStatus || 'FAILED';

      if (jobStatus === 'SUCCEEDED') break;

      if (jobStatus === 'FAILED') {
        const statusMessage = getResponse.StatusMessage || 'Unknown error';
        throw new Error(`Textract job failed: ${statusMessage}`);
      }

      // Still IN_PROGRESS — continue polling
    }

    if (jobStatus !== 'SUCCEEDED') {
      throw new Error('Textract job timed out after polling');
    }

    // Phase 2: Paginate through all result pages (separate from polling to prevent infinite loop).
    // Cap pagination to a safe maximum to prevent runaway loops from malformed NextToken responses.
    const MAX_RESULT_PAGES = 200;
    let allBlocks: Array<{ BlockType?: string; Text?: string; Confidence?: number; Page?: number }> = [];
    let nextToken: string | undefined;

    for (let page = 0; page < MAX_RESULT_PAGES; page++) {
      const getCommand = new GetDocumentTextDetectionCommand({
        JobId: jobId,
        NextToken: nextToken,
      });

      const getResponse = await textractClient.send(getCommand);

      if (getResponse.Blocks) {
        allBlocks = allBlocks.concat(getResponse.Blocks);
      }

      if (!getResponse.NextToken) break;
      nextToken = getResponse.NextToken;

      // Brief delay between pagination calls to avoid AWS API throttling.
      // Textract's GetDocumentTextDetection has a default rate of 10 TPS;
      // a 100ms pause keeps us well under that even at max concurrency.
      await sleep(100);
    }

    return parseTextractBlocks(allBlocks, filename);
  } finally {
    // Clean up temp S3 object
    try {
      await s3Client.send(new DeleteObjectCommand({
        Bucket: S3_BUCKET,
        Key: tempKey,
      }));
      logger.info('Cleaned up temp OCR file', { tempKey });
    } catch (cleanupErr) {
      logger.warn('Failed to clean up temp OCR file', { tempKey, error: String(cleanupErr) });
    }
  }
}

/**
 * Parse Textract response blocks into our OcrResult format.
 */
function parseTextractBlocks(
  blocks: Array<{ BlockType?: string; Text?: string; Confidence?: number; Page?: number }>,
  filename: string
): OcrResult {
  const lineBlocks = blocks.filter(b => b.BlockType === 'LINE');

  const text = lineBlocks.map(b => b.Text || '').join('\n');

  const confidences = lineBlocks
    .map(b => b.Confidence || 0)
    .filter(c => c > 0);
  const avgConfidence = confidences.length > 0
    ? confidences.reduce((sum, c) => sum + c, 0) / confidences.length
    : 0;

  // Count unique pages
  const pages = new Set(lineBlocks.map(b => b.Page || 1));

  logger.info('OCR extraction complete', {
    filename,
    lineCount: lineBlocks.length,
    pageCount: pages.size,
    avgConfidence: Math.round(avgConfidence),
  });

  return {
    text,
    pageCount: pages.size,
    confidence: avgConfidence,
  };
}

/**
 * Detect transient AWS errors worth retrying (HTTP 5xx, throttling, network errors).
 */
function isTransientError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as Record<string, unknown>)['$metadata']
    && typeof (err as any)['$metadata'] === 'object'
    ? (err as any)['$metadata'].httpStatusCode
    : undefined;
  if (typeof code === 'number' && code >= 500) return true;
  const name = (err as any).name || '';
  const message = String((err as any).message || '');
  if (name === 'ThrottlingException' || name === 'ProvisionedThroughputExceededException') return true;
  if (name === 'InternalServerError' || name === 'ServiceUnavailableException') return true;
  if (message.includes('ECONNRESET') || message.includes('ETIMEDOUT') || message.includes('socket hang up')) return true;
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Extract structured text (tables, forms) from a document using Textract AnalyzeDocument.
 * More expensive but better for clinical notes with structured fields.
 * Preserves table structure as tab-delimited rows and form key-value pairs.
 */
export async function analyzeDocumentWithOcr(buffer: Buffer, filename: string): Promise<OcrResult> {
  logger.info('Starting OCR analysis (tables + forms)', { filename });

  const command = new AnalyzeDocumentCommand({
    Document: {
      Bytes: buffer,
    },
    FeatureTypes: ['TABLES', 'FORMS'],
  });

  const response = await textractClient.send(command);
  return parseAnalyzeBlocks(response.Blocks || [], filename);
}

/**
 * Parse AnalyzeDocument blocks preserving table/form structure.
 * Tables are rendered as tab-delimited rows; form key-value pairs as "Key: Value" lines.
 * Falls back to LINE extraction for regular text.
 */
function parseAnalyzeBlocks(
  blocks: Array<{ BlockType?: string; Text?: string; Confidence?: number; Page?: number; Id?: string; EntityTypes?: string[]; Relationships?: Array<{ Type?: string; Ids?: string[] }> }>,
  filename: string
): OcrResult {
  // Build a map of block ID → block for relationship lookups
  const blockMap = new Map<string, typeof blocks[number]>();
  for (const block of blocks) {
    if (block.Id) blockMap.set(block.Id, block);
  }

  const outputParts: string[] = [];
  const confidences: number[] = [];
  const pages = new Set<number>();

  // Helper: get text from a block by resolving CHILD relationships to WORD blocks
  function getBlockText(block: typeof blocks[number]): string {
    if (block.Text) return block.Text;
    const childRel = block.Relationships?.find(r => r.Type === 'CHILD');
    if (!childRel?.Ids) return '';
    return childRel.Ids
      .map(id => blockMap.get(id))
      .filter(b => b && (b.BlockType === 'WORD' || b.BlockType === 'SELECTION_ELEMENT'))
      .map(b => b!.BlockType === 'SELECTION_ELEMENT' ? (b!.Text === 'SELECTED' ? '[X]' : '[ ]') : (b!.Text || ''))
      .join(' ');
  }

  // Extract tables as tab-delimited text
  for (const block of blocks) {
    if (block.BlockType !== 'TABLE') continue;
    const cellRel = block.Relationships?.find(r => r.Type === 'CHILD');
    if (!cellRel?.Ids) continue;

    const cells = cellRel.Ids
      .map(id => blockMap.get(id))
      .filter(b => b && b.BlockType === 'CELL') as Array<typeof blocks[number] & { RowIndex?: number; ColumnIndex?: number }>;

    // Group cells by row
    const rows = new Map<number, Map<number, string>>();
    for (const cell of cells) {
      const row = (cell as any).RowIndex || 1;
      const col = (cell as any).ColumnIndex || 1;
      if (!rows.has(row)) rows.set(row, new Map());
      rows.get(row)!.set(col, getBlockText(cell));
      if (cell.Confidence) confidences.push(cell.Confidence);
      if (cell.Page) pages.add(cell.Page);
    }

    // Render rows
    const sortedRows = [...rows.entries()].sort((a, b) => a[0] - b[0]);
    outputParts.push('[TABLE]');
    for (const [, colMap] of sortedRows) {
      const sortedCols = [...colMap.entries()].sort((a, b) => a[0] - b[0]);
      outputParts.push(sortedCols.map(([, text]) => text).join('\t'));
    }
    outputParts.push('[/TABLE]');
    outputParts.push('');
  }

  // Extract form key-value pairs
  for (const block of blocks) {
    if (block.BlockType !== 'KEY_VALUE_SET') continue;
    if (!block.EntityTypes?.includes('KEY')) continue;

    const keyText = getBlockText(block);
    const valueRel = block.Relationships?.find(r => r.Type === 'VALUE');
    let valueText = '';
    if (valueRel?.Ids) {
      const valueBlock = blockMap.get(valueRel.Ids[0]);
      if (valueBlock) valueText = getBlockText(valueBlock);
    }

    if (keyText.trim()) {
      outputParts.push(`${keyText.trim()}: ${valueText.trim()}`);
      if (block.Confidence) confidences.push(block.Confidence);
      if (block.Page) pages.add(block.Page);
    }
  }

  // Also include LINE blocks for text not captured by tables/forms
  const lineBlocks = blocks.filter(b => b.BlockType === 'LINE');
  for (const line of lineBlocks) {
    if (line.Text) outputParts.push(line.Text);
    if (line.Confidence) confidences.push(line.Confidence);
    if (line.Page) pages.add(line.Page || 1);
  }

  const text = outputParts.join('\n');
  const avgConfidence = confidences.length > 0
    ? confidences.reduce((sum, c) => sum + c, 0) / confidences.length
    : 0;

  logger.info('OCR analysis complete (tables + forms)', {
    filename,
    pageCount: pages.size,
    avgConfidence: Math.round(avgConfidence),
  });

  return {
    text,
    pageCount: pages.size || 1,
    confidence: avgConfidence,
  };
}
