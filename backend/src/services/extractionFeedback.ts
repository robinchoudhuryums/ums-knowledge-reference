/**
 * Extraction Feedback Service — Human-in-the-Loop corrections
 *
 * Stores user corrections to document-extraction results so the extraction
 * pipeline can be measured against real ground truth rather than self-reported
 * confidence. Each correction is an append-only audit record that captures:
 *   - The original LLM-extracted fields
 *   - The human-corrected fields (only the ones that were changed)
 *   - Which template was used
 *   - Whether the LLM's self-reported confidence agreed with reality
 *
 * Why store this: (1) baseline for future prompt/model tuning, (2) operator
 * metric — "how often does the model get it right?", (3) HIPAA audit trail
 * of who edited what clinical field.
 *
 * Storage: S3 at metadata/extraction-feedback/{templateId}/{id}.json with
 * an index file for fast listing. PHI is redacted before logging (never
 * before storage — corrections ARE the data).
 */

import { PutObjectCommand, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { s3Client, S3_BUCKET, S3_PREFIXES } from '../config/aws';
import { logger } from '../utils/logger';
import { redactPhi } from '../utils/phiRedactor';
import { v4 as uuidv4 } from 'uuid';

const FEEDBACK_PREFIX = `${S3_PREFIXES.metadata}extraction-feedback/`;
const FEEDBACK_INDEX_KEY = `${S3_PREFIXES.metadata}extraction-feedback-index.json`;

export type FieldValue = string | number | boolean | null;

export interface CorrectedField {
  key: string;
  originalValue: FieldValue;
  correctedValue: FieldValue;
}

export interface ExtractionFeedbackRecord {
  id: string;
  templateId: string;
  templateName: string;
  modelUsed: string;
  /** Confidence the LLM self-reported for the original extraction */
  reportedConfidence: 'high' | 'medium' | 'low';
  /** Reviewer's assessment of the original extraction overall */
  actualQuality: 'correct' | 'minor_errors' | 'major_errors' | 'unusable';
  /** Only the fields the reviewer changed — absence means the model was right */
  correctedFields: CorrectedField[];
  /** Optional free-text note from the reviewer (no PHI required) */
  reviewerNote?: string;
  submittedBy: string;
  submittedAt: string;
  /** Original filename — for grouping corrections by document, not for re-ingestion */
  filename?: string;
}

interface FeedbackIndexEntry {
  id: string;
  templateId: string;
  actualQuality: ExtractionFeedbackRecord['actualQuality'];
  reportedConfidence: ExtractionFeedbackRecord['reportedConfidence'];
  correctedFieldCount: number;
  submittedBy: string;
  submittedAt: string;
}

async function loadIndex(): Promise<FeedbackIndexEntry[]> {
  try {
    const result = await s3Client.send(new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: FEEDBACK_INDEX_KEY,
    }));
    const body = await result.Body?.transformToString();
    return body ? JSON.parse(body) : [];
  } catch {
    return [];
  }
}

async function saveIndex(entries: FeedbackIndexEntry[]): Promise<void> {
  await s3Client.send(new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: FEEDBACK_INDEX_KEY,
    Body: JSON.stringify(entries, null, 2),
    ContentType: 'application/json',
    ServerSideEncryption: 'AES256',
  }));
}

/**
 * Submit a correction for an extraction result.
 * Appends to the feedback store; never mutates or deletes prior records.
 */
export async function submitExtractionCorrection(input: {
  templateId: string;
  templateName: string;
  modelUsed: string;
  reportedConfidence: ExtractionFeedbackRecord['reportedConfidence'];
  actualQuality: ExtractionFeedbackRecord['actualQuality'];
  correctedFields: CorrectedField[];
  reviewerNote?: string;
  submittedBy: string;
  filename?: string;
}): Promise<ExtractionFeedbackRecord> {
  const record: ExtractionFeedbackRecord = {
    id: uuidv4(),
    templateId: input.templateId,
    templateName: input.templateName,
    modelUsed: input.modelUsed,
    reportedConfidence: input.reportedConfidence,
    actualQuality: input.actualQuality,
    correctedFields: input.correctedFields,
    reviewerNote: input.reviewerNote,
    submittedBy: input.submittedBy,
    submittedAt: new Date().toISOString(),
    filename: input.filename,
  };

  await s3Client.send(new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: `${FEEDBACK_PREFIX}${input.templateId}/${record.id}.json`,
    Body: JSON.stringify(record, null, 2),
    ContentType: 'application/json',
    ServerSideEncryption: 'AES256',
  }));

  const index = await loadIndex();
  index.unshift({
    id: record.id,
    templateId: record.templateId,
    actualQuality: record.actualQuality,
    reportedConfidence: record.reportedConfidence,
    correctedFieldCount: record.correctedFields.length,
    submittedBy: record.submittedBy,
    submittedAt: record.submittedAt,
  });
  await saveIndex(index);

  logger.info('Extraction correction submitted', {
    id: record.id,
    templateId: record.templateId,
    actualQuality: record.actualQuality,
    correctedFieldCount: record.correctedFields.length,
    reviewerNoteLength: record.reviewerNote ? redactPhi(record.reviewerNote).text.length : 0,
  });

  return record;
}

/**
 * List feedback index entries with optional filtering.
 */
export async function listExtractionCorrections(filters?: {
  templateId?: string;
  actualQuality?: ExtractionFeedbackRecord['actualQuality'];
  submittedBy?: string;
  limit?: number;
}): Promise<FeedbackIndexEntry[]> {
  let entries = await loadIndex();
  if (filters?.templateId) entries = entries.filter(e => e.templateId === filters.templateId);
  if (filters?.actualQuality) entries = entries.filter(e => e.actualQuality === filters.actualQuality);
  if (filters?.submittedBy) entries = entries.filter(e => e.submittedBy === filters.submittedBy);
  if (filters?.limit && filters.limit > 0) entries = entries.slice(0, filters.limit);
  return entries;
}

/**
 * Fetch a single full correction record.
 */
export async function getExtractionCorrection(id: string, templateId: string): Promise<ExtractionFeedbackRecord | null> {
  try {
    const result = await s3Client.send(new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: `${FEEDBACK_PREFIX}${templateId}/${id}.json`,
    }));
    const body = await result.Body?.transformToString();
    return body ? JSON.parse(body) : null;
  } catch {
    return null;
  }
}

export interface ExtractionQualityStats {
  templateId?: string;
  total: number;
  byActualQuality: Record<ExtractionFeedbackRecord['actualQuality'], number>;
  /** Fraction of submissions the LLM got right (actualQuality === 'correct') */
  accuracyRate: number;
  /** Fraction where reportedConfidence was "high" but actualQuality was not "correct" */
  overconfidenceRate: number;
  /** Total individual fields corrected across all records */
  totalFieldsCorrected: number;
}

/**
 * Compute aggregate quality stats. Intended for a lightweight admin dashboard
 * card: "Extraction accuracy: 82% (of 45 reviewed). Overconfidence: 12%."
 */
export async function getExtractionQualityStats(templateId?: string): Promise<ExtractionQualityStats> {
  const index = await loadIndex();
  const filtered = templateId ? index.filter(e => e.templateId === templateId) : index;

  const byActualQuality = {
    correct: 0,
    minor_errors: 0,
    major_errors: 0,
    unusable: 0,
  } as Record<ExtractionFeedbackRecord['actualQuality'], number>;

  let totalFieldsCorrected = 0;
  let overconfidentCount = 0;
  for (const e of filtered) {
    byActualQuality[e.actualQuality] = (byActualQuality[e.actualQuality] || 0) + 1;
    totalFieldsCorrected += e.correctedFieldCount;
    if (e.reportedConfidence === 'high' && e.actualQuality !== 'correct') {
      overconfidentCount++;
    }
  }

  const total = filtered.length;
  return {
    templateId,
    total,
    byActualQuality,
    accuracyRate: total === 0 ? 0 : byActualQuality.correct / total,
    overconfidenceRate: total === 0 ? 0 : overconfidentCount / total,
    totalFieldsCorrected,
  };
}

// Re-export for consumer code that wants to inspect prefix paths.
export const EXTRACTION_FEEDBACK_PREFIX = FEEDBACK_PREFIX;
// Exported for external tooling; not used internally.
export { ListObjectsV2Command };
