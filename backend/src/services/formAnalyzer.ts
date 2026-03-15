/**
 * Form Analyzer — uses AWS Textract AnalyzeDocument (FORMS) to detect
 * key-value pairs in scanned forms and identify blank/missing fields.
 *
 * Features:
 * - Template caching: hashes uploaded files and caches Textract results on S3
 *   so re-uploads of the same form skip the Textract call (cost reduction).
 * - Improved blank detection: handles underscores, dashes, placeholders, unchecked boxes.
 * - Confidence categories: separates fields into high/low confidence buckets.
 * - Form type detection: auto-detects CMN and prior-auth forms and applies field-level rules.
 * - Batch analysis: analyzeFormFieldsBatch() processes multiple files.
 */

import {
  TextractClient,
  AnalyzeDocumentCommand,
  StartDocumentAnalysisCommand,
  GetDocumentAnalysisCommand,
  Block,
} from '@aws-sdk/client-textract';
import { s3Client, S3_BUCKET } from '../config/aws';
import { PutObjectCommand, DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';
import { logger } from '../utils/logger';
import { detectFormType, matchRequiredField, type FormTypeRule } from '../config/formRules';

const region = process.env.AWS_REGION || 'us-east-1';

const textractClient = new TextractClient({
  region,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
});

/** Confidence threshold — fields below this are flagged as "low confidence" */
const LOW_CONFIDENCE_THRESHOLD = 60;

export interface FormField {
  key: string;           // Field label text
  value: string;         // Field value text (empty string if blank)
  isEmpty: boolean;      // True if the value is empty/whitespace/placeholder
  confidence: number;    // Textract confidence (0-100)
  confidenceCategory: 'high' | 'low';  // Based on threshold
  page: number;          // Page number (1-indexed)
  isRequired: boolean;   // True if this field matches a known required-field rule
  requiredLabel?: string; // Human-readable label from form rules
  section?: string;      // Form section (e.g., "Section A")
  isCheckbox: boolean;   // True if this is a checkbox/selection field
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
  lowConfidenceFields: FormField[];
  requiredMissingFields: FormField[];
  totalFields: number;
  emptyCount: number;
  lowConfidenceCount: number;
  requiredMissingCount: number;
  pageCount: number;
  formType: { key: string; name: string; description: string } | null;
  completionPercentage: number;
  cached: boolean;  // True if result came from cache (no Textract cost)
}

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 120;
const CACHE_PREFIX = 'form-analysis-cache';

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Compute a content hash for cache key.
 */
function hashBuffer(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * Try to load a cached analysis result from S3.
 */
async function loadCachedResult(hash: string): Promise<FormAnalysisResult | null> {
  try {
    const key = `${CACHE_PREFIX}/${hash}.json`;
    const response = await s3Client.send(new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
    }));
    const body = await response.Body?.transformToString();
    if (!body) return null;
    const cached = JSON.parse(body) as FormAnalysisResult;
    cached.cached = true;
    logger.info('Form analysis cache hit', { hash });
    return cached;
  } catch {
    return null;
  }
}

/**
 * Store analysis result in S3 cache.
 */
async function cacheResult(hash: string, result: FormAnalysisResult): Promise<void> {
  try {
    const key = `${CACHE_PREFIX}/${hash}.json`;
    await s3Client.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Body: JSON.stringify(result),
      ContentType: 'application/json',
    }));
    logger.info('Form analysis result cached', { hash });
  } catch (err) {
    logger.warn('Failed to cache form analysis result', { hash, error: String(err) });
  }
}

/**
 * Analyze a document for form fields. Uses sync API for images,
 * async API for multi-page PDFs. Checks cache first to avoid
 * duplicate Textract charges.
 */
export async function analyzeFormFields(buffer: Buffer, filename: string): Promise<FormAnalysisResult> {
  logger.info('Starting form analysis', { filename, sizeBytes: buffer.length });

  // Check cache first
  const contentHash = hashBuffer(buffer);
  const cached = await loadCachedResult(contentHash);
  if (cached) return cached;

  const ext = filename.split('.').pop()?.toLowerCase() || '';
  const isPdf = ext === 'pdf';

  let blocks: Block[];

  if (isPdf) {
    blocks = await analyzeFormAsync(buffer, filename);
  } else {
    blocks = await analyzeFormSync(buffer);
  }

  const result = parseFormBlocks(blocks);
  result.cached = false;

  // Cache the result for future lookups
  await cacheResult(contentHash, result);

  return result;
}

/**
 * Batch analyze multiple documents. Returns results in the same order as input.
 */
export async function analyzeFormFieldsBatch(
  files: Array<{ buffer: Buffer; filename: string }>
): Promise<FormAnalysisResult[]> {
  logger.info('Starting batch form analysis', { fileCount: files.length });

  // Process files concurrently (up to 5 at a time to avoid throttling)
  const concurrencyLimit = 5;
  const results: FormAnalysisResult[] = new Array(files.length);

  for (let i = 0; i < files.length; i += concurrencyLimit) {
    const batch = files.slice(i, i + concurrencyLimit);
    const batchResults = await Promise.all(
      batch.map(f => analyzeFormFields(f.buffer, f.filename))
    );
    for (let j = 0; j < batchResults.length; j++) {
      results[i + j] = batchResults[j];
    }
  }

  return results;
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

// Patterns that indicate a field value is effectively blank
const BLANK_PATTERNS = [
  /^[_\-]+$/,                    // Only underscores or dashes
  /^[\s_\-./]+$/,                // Whitespace, underscores, dashes, dots, slashes
  /^\[?\s*\]?$/,                 // Empty brackets
  /^n\/?a$/i,                    // N/A
  /^none$/i,                     // "none"
  /^(mm|dd|yyyy|xx)[\/\-](mm|dd|yyyy|xx)[\/\-]?(mm|dd|yyyy|xx)?$/i, // Date placeholders
  /^\(\s*\)$/,                   // Empty parentheses
  /^-{2,}$/,                     // Multiple dashes
  /^\.{2,}$/,                    // Multiple dots (fill-in-the-blank)
];

/**
 * Determine if a field value is effectively blank/empty.
 * Goes beyond simple whitespace check to handle placeholders and patterns.
 */
function isFieldBlank(value: string, isCheckbox: boolean): boolean {
  const trimmed = value.trim();

  // Empty or whitespace-only
  if (!trimmed) return true;

  // Unchecked checkbox
  if (isCheckbox && trimmed === '[ ]') return true;

  // Check against blank patterns
  for (const pattern of BLANK_PATTERNS) {
    if (pattern.test(trimmed)) return true;
  }

  return false;
}

/**
 * Parse Textract blocks to extract form key-value pairs.
 */
function parseFormBlocks(blocks: Block[]): FormAnalysisResult {
  const blockMap = new Map<string, Block>();
  for (const block of blocks) {
    if (block.Id) blockMap.set(block.Id, block);
  }

  // Collect all text from LINE blocks for form type detection
  const lineTexts: string[] = [];
  for (const block of blocks) {
    if (block.BlockType === 'LINE' && block.Text) {
      lineTexts.push(block.Text);
    }
  }
  const fullText = lineTexts.join(' ');

  // Detect form type
  const formTypeMatch = detectFormType(fullText);

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

    const { text: valueText, hasCheckbox, isCheckboxSelected } = getBlockTextWithMeta(valueBlock, blockMap);
    const valueBBox = valueBlock.Geometry?.BoundingBox;

    if (!keyBBox || !valueBBox) continue;

    const isCheckbox = hasCheckbox;
    const isEmpty = isFieldBlank(valueText, isCheckbox);
    const confidence = block.Confidence || 0;
    const confidenceCategory = confidence >= LOW_CONFIDENCE_THRESHOLD ? 'high' : 'low';

    // Check if this field matches a required field rule
    let isRequired = false;
    let requiredLabel: string | undefined;
    let section: string | undefined;

    if (formTypeMatch) {
      const match = matchRequiredField(keyText, formTypeMatch.rule);
      if (match) {
        isRequired = true;
        requiredLabel = match.label;
        section = match.section;
      }
    }

    fields.push({
      key: keyText.trim(),
      value: valueText.trim(),
      isEmpty,
      confidence,
      confidenceCategory,
      page,
      isRequired,
      requiredLabel,
      section,
      isCheckbox,
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
  const lowConfidenceFields = fields.filter(f => f.confidenceCategory === 'low');
  const requiredMissingFields = fields.filter(f => f.isEmpty && f.isRequired);
  const completionPercentage = fields.length > 0
    ? Math.round(((fields.length - emptyFields.length) / fields.length) * 100)
    : 100;

  logger.info('Form analysis complete', {
    totalFields: fields.length,
    emptyCount: emptyFields.length,
    filledCount: filledFields.length,
    lowConfidenceCount: lowConfidenceFields.length,
    requiredMissingCount: requiredMissingFields.length,
    formType: formTypeMatch?.key || 'unknown',
    pageCount: pages.size,
  });

  return {
    fields,
    emptyFields,
    filledFields,
    lowConfidenceFields,
    requiredMissingFields,
    totalFields: fields.length,
    emptyCount: emptyFields.length,
    lowConfidenceCount: lowConfidenceFields.length,
    requiredMissingCount: requiredMissingFields.length,
    pageCount: pages.size || 1,
    formType: formTypeMatch
      ? { key: formTypeMatch.key, name: formTypeMatch.rule.name, description: formTypeMatch.rule.description }
      : null,
    completionPercentage,
    cached: false,
  };
}

/**
 * Get text content from a block by following its CHILD relationships to WORD blocks.
 */
function getBlockText(block: Block, blockMap: Map<string, Block>): string {
  return getBlockTextWithMeta(block, blockMap).text;
}

/**
 * Get text and metadata (checkbox info) from a block.
 */
function getBlockTextWithMeta(
  block: Block,
  blockMap: Map<string, Block>,
): { text: string; hasCheckbox: boolean; isCheckboxSelected: boolean } {
  const childRelationship = block.Relationships?.find(r => r.Type === 'CHILD');
  if (!childRelationship?.Ids) return { text: '', hasCheckbox: false, isCheckboxSelected: false };

  const words: string[] = [];
  let hasCheckbox = false;
  let isCheckboxSelected = false;

  for (const childId of childRelationship.Ids) {
    const child = blockMap.get(childId);
    if (child?.BlockType === 'WORD' && child.Text) {
      words.push(child.Text);
    } else if (child?.BlockType === 'SELECTION_ELEMENT') {
      hasCheckbox = true;
      if (child.SelectionStatus === 'SELECTED') {
        isCheckboxSelected = true;
        words.push('[X]');
      } else {
        words.push('[ ]');
      }
    }
  }

  return { text: words.join(' '), hasCheckbox, isCheckboxSelected };
}
