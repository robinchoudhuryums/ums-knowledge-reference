/**
 * PPD Submission Queue
 *
 * Stores completed PPD questionnaires in S3 for the Pre-Appointment Kit team
 * to review. Each submission includes patient info, all responses, and PMD
 * recommendations. Submissions have a status workflow:
 *
 *   pending → in_review → completed
 *                       → returned (needs corrections)
 *
 * This replaces the email-based handoff with an in-app queue.
 */

import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { s3Client, S3_BUCKET, S3_PREFIXES } from '../config/aws';
import { logger } from '../utils/logger';
import { redactPhi } from '../utils/phiRedactor';
import { v4 as uuidv4 } from 'uuid';
import { PpdResponse, PmdRecommendation, PPD_FORM_VERSION } from './ppdQuestionnaire';

const PPD_QUEUE_PREFIX = `${S3_PREFIXES.metadata}ppd-queue/`;
const PPD_INDEX_KEY = `${S3_PREFIXES.metadata}ppd-queue-index.json`;

export type PpdStatus = 'pending' | 'in_review' | 'completed' | 'returned';

/**
 * Valid state machine transitions for PPD submissions.
 * pending → in_review → completed
 *                     → returned → in_review (re-review after corrections)
 */
const VALID_TRANSITIONS: Record<PpdStatus, PpdStatus[]> = {
  pending:   ['in_review'],
  in_review: ['completed', 'returned'],
  returned:  ['in_review'],
  completed: [], // terminal state — no further transitions
};

/**
 * Check whether a status transition is valid per the PPD state machine.
 */
export function isValidTransition(from: PpdStatus, to: PpdStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export interface PpdSubmissionRecord {
  id: string;
  /** Form version at time of submission (for audit trail when questions change) */
  formVersion: string;
  patientInfo: string;
  language: 'english' | 'spanish';
  responses: PpdResponse[];
  recommendations: PmdRecommendation[];
  productSelections: Record<string, { status: string; preferred: boolean }>;
  status: PpdStatus;
  submittedBy: string;
  submittedAt: string;
  reviewedBy?: string;
  reviewedAt?: string;
  reviewNotes?: string;
  returnReason?: string;
}

// ─── Index Management ─────────────────────────────────────────────────

interface PpdIndexEntry {
  id: string;
  patientInfo: string;
  status: PpdStatus;
  submittedBy: string;
  submittedAt: string;
  reviewedBy?: string;
  reviewedAt?: string;
  recommendationCount: number;
}

async function loadIndex(): Promise<PpdIndexEntry[]> {
  try {
    const result = await s3Client.send(new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: PPD_INDEX_KEY,
    }));
    const body = await result.Body?.transformToString();
    return body ? JSON.parse(body) : [];
  } catch (err) {
    logger.warn('Failed to load PPD queue index from S3', { error: String(err) });
    return [];
  }
}

async function saveIndex(index: PpdIndexEntry[]): Promise<void> {
  await s3Client.send(new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: PPD_INDEX_KEY,
    Body: JSON.stringify(index, null, 2),
    ContentType: 'application/json',
    ServerSideEncryption: 'AES256',
  }));
}

// ─── CRUD ─────────────────────────────────────────────────────────────

export async function submitPpd(submission: {
  patientInfo: string;
  language: 'english' | 'spanish';
  responses: PpdResponse[];
  recommendations: PmdRecommendation[];
  productSelections: Record<string, { status: string; preferred: boolean }>;
  submittedBy: string;
}): Promise<PpdSubmissionRecord> {
  const record: PpdSubmissionRecord = {
    id: uuidv4(),
    formVersion: PPD_FORM_VERSION,
    patientInfo: submission.patientInfo,
    language: submission.language,
    responses: submission.responses,
    recommendations: submission.recommendations,
    productSelections: submission.productSelections,
    status: 'pending',
    submittedBy: submission.submittedBy,
    submittedAt: new Date().toISOString(),
  };

  // Save full record
  await s3Client.send(new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: `${PPD_QUEUE_PREFIX}${record.id}.json`,
    Body: JSON.stringify(record, null, 2),
    ContentType: 'application/json',
    ServerSideEncryption: 'AES256',
  }));

  // Update index
  const index = await loadIndex();
  index.unshift({
    id: record.id,
    patientInfo: record.patientInfo,
    status: record.status,
    submittedBy: record.submittedBy,
    submittedAt: record.submittedAt,
    recommendationCount: record.recommendations.length,
  });
  await saveIndex(index);

  logger.info('PPD submitted to queue', { id: record.id, patientInfo: redactPhi(record.patientInfo).text, submittedBy: record.submittedBy });
  return record;
}

export async function getPpdSubmission(id: string): Promise<PpdSubmissionRecord | null> {
  try {
    const result = await s3Client.send(new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: `${PPD_QUEUE_PREFIX}${id}.json`,
    }));
    const body = await result.Body?.transformToString();
    return body ? JSON.parse(body) : null;
  } catch (err) {
    logger.warn('Failed to load PPD submission from S3', { id, error: String(err) });
    return null;
  }
}

export async function listPpdSubmissions(filters?: {
  status?: PpdStatus;
  submittedBy?: string;
}): Promise<PpdIndexEntry[]> {
  let index = await loadIndex();

  if (filters?.status) {
    index = index.filter(e => e.status === filters.status);
  }
  if (filters?.submittedBy) {
    index = index.filter(e => e.submittedBy === filters.submittedBy);
  }

  return index;
}

export async function updatePpdStatus(
  id: string,
  update: {
    status: PpdStatus;
    reviewedBy: string;
    reviewNotes?: string;
    returnReason?: string;
  }
): Promise<PpdSubmissionRecord | null> {
  const record = await getPpdSubmission(id);
  if (!record) return null;

  // Validate state machine transition
  if (!isValidTransition(record.status, update.status)) {
    throw new Error(
      `Invalid status transition: ${record.status} → ${update.status}. ` +
      `Allowed: ${VALID_TRANSITIONS[record.status].join(', ') || 'none (terminal state)'}`
    );
  }

  record.status = update.status;
  record.reviewedBy = update.reviewedBy;
  record.reviewedAt = new Date().toISOString();
  if (update.reviewNotes) record.reviewNotes = update.reviewNotes;
  if (update.returnReason) record.returnReason = update.returnReason;

  // Save updated record
  await s3Client.send(new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: `${PPD_QUEUE_PREFIX}${id}.json`,
    Body: JSON.stringify(record, null, 2),
    ContentType: 'application/json',
    ServerSideEncryption: 'AES256',
  }));

  // Update index
  const index = await loadIndex();
  const idx = index.findIndex(e => e.id === id);
  if (idx >= 0) {
    index[idx].status = update.status;
    index[idx].reviewedBy = update.reviewedBy;
    index[idx].reviewedAt = record.reviewedAt;
    await saveIndex(index);
  }

  logger.info('PPD status updated', { id, status: update.status, reviewedBy: update.reviewedBy, patientInfo: redactPhi(record.patientInfo).text });
  return record;
}

export async function deletePpdSubmission(id: string): Promise<boolean> {
  try {
    await s3Client.send(new DeleteObjectCommand({
      Bucket: S3_BUCKET,
      Key: `${PPD_QUEUE_PREFIX}${id}.json`,
    }));

    const index = await loadIndex();
    const filtered = index.filter(e => e.id !== id);
    await saveIndex(filtered);

    logger.info('PPD submission deleted', { id });
    return true;
  } catch (err) {
    logger.error('Failed to delete PPD submission', { id, error: String(err) });
    return false;
  }
}
