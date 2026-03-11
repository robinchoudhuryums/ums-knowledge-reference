/**
 * Form Analyzer — uses AWS Textract AnalyzeDocument (FORMS) to detect
 * key-value pairs in scanned forms and identify blank/missing fields.
 *
 * Returns structured data about which fields are filled vs. empty,
 * with bounding box coordinates for annotation.
 */

import {
  TextractClient,
  AnalyzeDocumentCommand,
  StartDocumentAnalysisCommand,
  GetDocumentAnalysisCommand,
  Block,
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

export interface FormField {
  key: string;           // Field label text
  value: string;         // Field value text (empty string if blank)
  isEmpty: boolean;      // True if the value is empty/whitespace
  confidence: number;    // Textract confidence (0-100)
  page: number;          // Page number (1-indexed)
  // Bounding box for the VALUE area (normalized 0-1 coordinates)
  valueBoundingBox: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
  // Bounding box for the KEY (label) area
  keyBoundingBox: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
}

export interface FormAnalysisResult {
  fields: FormField[];
  emptyFields: FormField[];
  filledFields: FormField[];
  totalFields: number;
  emptyCount: number;
  pageCount: number;
}

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 120;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Analyze a document for form fields. Uses sync API for images,
 * async API for multi-page PDFs.
 */
export async function analyzeFormFields(buffer: Buffer, filename: string): Promise<FormAnalysisResult> {
  logger.info('Starting form analysis', { filename, sizeBytes: buffer.length });

  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const isPdf = ext === 'pdf';

  let blocks: Block[];

  if (isPdf) {
    blocks = await analyzeFormAsync(buffer, filename);
  } else {
    blocks = await analyzeFormSync(buffer);
  }

  return parseFormBlocks(blocks);
}

/**
 * Sync Textract AnalyzeDocument for single-page images.
 */
async function analyzeFormSync(buffer: Buffer): Promise<Block[]> {
  const command = new AnalyzeDocumentCommand({
    Document: { Bytes: buffer },
    FeatureTypes: ['FORMS'],
  });

  const response = await textractClient.send(command);
  return response.Blocks || [];
}

/**
 * Async Textract StartDocumentAnalysis for multi-page PDFs.
 */
async function analyzeFormAsync(buffer: Buffer, filename: string): Promise<Block[]> {
  const tempKey = `temp-form-analysis/${uuidv4()}.pdf`;

  try {
    await s3Client.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: tempKey,
      Body: buffer,
      ContentType: 'application/pdf',
    }));

    const startCommand = new StartDocumentAnalysisCommand({
      DocumentLocation: {
        S3Object: { Bucket: S3_BUCKET, Name: tempKey },
      },
      FeatureTypes: ['FORMS'],
    });

    const startResponse = await textractClient.send(startCommand);
    const jobId = startResponse.JobId;

    if (!jobId) throw new Error('Textract did not return a JobId');

    logger.info('Async form analysis job started', { jobId, filename });

    let allBlocks: Block[] = [];
    let nextToken: string | undefined;
    let jobStatus = 'IN_PROGRESS';

    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
      await sleep(POLL_INTERVAL_MS);

      const getCommand = new GetDocumentAnalysisCommand({
        JobId: jobId,
        NextToken: nextToken,
      });

      const getResponse = await textractClient.send(getCommand);
      jobStatus = getResponse.JobStatus || 'FAILED';

      if (jobStatus === 'SUCCEEDED') {
        if (getResponse.Blocks) {
          allBlocks = allBlocks.concat(getResponse.Blocks);
        }
        if (getResponse.NextToken) {
          nextToken = getResponse.NextToken;
          attempt--;
          continue;
        }
        break;
      }

      if (jobStatus === 'FAILED') {
        throw new Error(`Textract job failed: ${getResponse.StatusMessage || 'Unknown error'}`);
      }
    }

    if (jobStatus !== 'SUCCEEDED') {
      throw new Error('Textract form analysis job timed out');
    }

    return allBlocks;
  } finally {
    try {
      await s3Client.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: tempKey }));
    } catch (cleanupErr) {
      logger.warn('Failed to clean up temp form analysis file', { tempKey, error: String(cleanupErr) });
    }
  }
}

/**
 * Parse Textract blocks to extract form key-value pairs.
 */
function parseFormBlocks(blocks: Block[]): FormAnalysisResult {
  const blockMap = new Map<string, Block>();
  for (const block of blocks) {
    if (block.Id) blockMap.set(block.Id, block);
  }

  const fields: FormField[] = [];
  const pages = new Set<number>();

  for (const block of blocks) {
    // KEY_VALUE_SET blocks with EntityTypes containing 'KEY' are form field labels
    if (block.BlockType !== 'KEY_VALUE_SET') continue;
    if (!block.EntityTypes?.includes('KEY')) continue;

    const page = block.Page || 1;
    pages.add(page);

    // Get the key (label) text by following CHILD relationships
    const keyText = getBlockText(block, blockMap);
    const keyBBox = block.Geometry?.BoundingBox;

    // Find the associated VALUE block via VALUE relationship
    const valueRelationship = block.Relationships?.find(r => r.Type === 'VALUE');
    if (!valueRelationship?.Ids?.length) continue;

    const valueBlockId = valueRelationship.Ids[0];
    const valueBlock = blockMap.get(valueBlockId);
    if (!valueBlock) continue;

    const valueText = getBlockText(valueBlock, blockMap);
    const valueBBox = valueBlock.Geometry?.BoundingBox;

    if (!keyBBox || !valueBBox) continue;

    const isEmpty = !valueText.trim();

    fields.push({
      key: keyText.trim(),
      value: valueText.trim(),
      isEmpty,
      confidence: block.Confidence || 0,
      page,
      valueBoundingBox: {
        left: valueBBox.Left || 0,
        top: valueBBox.Top || 0,
        width: valueBBox.Width || 0,
        height: valueBBox.Height || 0,
      },
      keyBoundingBox: {
        left: keyBBox.Left || 0,
        top: keyBBox.Top || 0,
        width: keyBBox.Width || 0,
        height: keyBBox.Height || 0,
      },
    });
  }

  const emptyFields = fields.filter(f => f.isEmpty);
  const filledFields = fields.filter(f => !f.isEmpty);

  logger.info('Form analysis complete', {
    totalFields: fields.length,
    emptyCount: emptyFields.length,
    filledCount: filledFields.length,
    pageCount: pages.size,
  });

  return {
    fields,
    emptyFields,
    filledFields,
    totalFields: fields.length,
    emptyCount: emptyFields.length,
    pageCount: pages.size || 1,
  };
}

/**
 * Get text content from a block by following its CHILD relationships to WORD blocks.
 */
function getBlockText(block: Block, blockMap: Map<string, Block>): string {
  const childRelationship = block.Relationships?.find(r => r.Type === 'CHILD');
  if (!childRelationship?.Ids) return '';

  const words: string[] = [];
  for (const childId of childRelationship.Ids) {
    const child = blockMap.get(childId);
    if (child?.BlockType === 'WORD' && child.Text) {
      words.push(child.Text);
    } else if (child?.BlockType === 'SELECTION_ELEMENT') {
      // Checkboxes: SELECTED or NOT_SELECTED
      words.push(child.SelectionStatus === 'SELECTED' ? '[X]' : '[ ]');
    }
  }

  return words.join(' ');
}
