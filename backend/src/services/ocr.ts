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

/**
 * Determine whether to use async Textract (multi-page PDFs) or sync (single-page images / small PDFs).
 * The sync API only supports single-page PDFs via bytes. For multi-page or large PDFs,
 * we upload to S3 and use the async StartDocumentTextDetection API.
 */
export async function extractTextWithOcr(buffer: Buffer, filename: string): Promise<OcrResult> {
  logger.info('Starting OCR extraction', { filename, sizeBytes: buffer.length });

  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const isPdf = ext === 'pdf';

  if (isPdf) {
    // PDFs may be multi-page — always use async API via S3 to be safe
    return extractTextWithAsyncOcr(buffer, filename);
  }

  // Images (PNG, JPEG, TIFF) — use fast sync API
  return extractTextWithSyncOcr(buffer, filename);
}

/**
 * Synchronous Textract for single-page images (PNG, JPEG, TIFF).
 */
async function extractTextWithSyncOcr(buffer: Buffer, filename: string): Promise<OcrResult> {
  const command = new DetectDocumentTextCommand({
    Document: {
      Bytes: buffer,
    },
  });

  const response = await textractClient.send(command);
  return parseTextractBlocks(response.Blocks || [], filename);
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

    // Phase 1: Poll until job completes (IN_PROGRESS → SUCCEEDED or FAILED)
    let jobStatus = 'IN_PROGRESS';
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
      await sleep(POLL_INTERVAL_MS);

      const getCommand = new GetDocumentTextDetectionCommand({ JobId: jobId });
      const getResponse = await textractClient.send(getCommand);
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

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Extract structured text (tables, forms) from a document using Textract AnalyzeDocument.
 * More expensive but better for clinical notes with structured fields.
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
  return parseTextractBlocks(response.Blocks || [], filename);
}
