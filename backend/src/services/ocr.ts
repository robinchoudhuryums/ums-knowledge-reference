import { TextractClient, DetectDocumentTextCommand, AnalyzeDocumentCommand } from '@aws-sdk/client-textract';
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

/**
 * Extract text from a scanned document image or PDF using AWS Textract.
 * Supports single-page documents directly via DetectDocumentText.
 * For multi-page PDFs, use the S3-based async API (not yet implemented).
 *
 * Supported formats: PDF (single page), PNG, JPEG, TIFF
 * Max file size for synchronous API: 10MB
 */
export async function extractTextWithOcr(buffer: Buffer, filename: string): Promise<OcrResult> {
  logger.info('Starting OCR extraction', { filename, sizeBytes: buffer.length });

  const command = new DetectDocumentTextCommand({
    Document: {
      Bytes: buffer,
    },
  });

  const response = await textractClient.send(command);

  const blocks = response.Blocks || [];
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

  const blocks = response.Blocks || [];
  const lineBlocks = blocks.filter(b => b.BlockType === 'LINE');

  const text = lineBlocks.map(b => b.Text || '').join('\n');

  const confidences = lineBlocks
    .map(b => b.Confidence || 0)
    .filter(c => c > 0);
  const avgConfidence = confidences.length > 0
    ? confidences.reduce((sum, c) => sum + c, 0) / confidences.length
    : 0;

  const pages = new Set(lineBlocks.map(b => b.Page || 1));

  return {
    text,
    pageCount: pages.size,
    confidence: avgConfidence,
  };
}
