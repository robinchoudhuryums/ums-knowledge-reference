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
import { v4 as uuidv4 } from 'uuid';
import { PpdResponse, PmdRecommendation } from './ppdQuestionnaire';

const PPD_QUEUE_PREFIX = `${S3_PREFIXES.metadata}ppd-queue/`;
const PPD_INDEX_KEY = `${S3_PREFIXES.metadata}ppd-queue-index.json`;

export type PpdStatus = 'pending' | 'in_review' | 'completed' | 'returned';

export interface PpdSubmissionRecord {
  id: string;
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
  } catch {
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

  logger.info('PPD submitted to queue', { id: record.id, patientInfo: record.patientInfo, submittedBy: record.submittedBy });
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
  } catch {
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

  logger.info('PPD status updated', { id, status: update.status, reviewedBy: update.reviewedBy });
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
  } catch {
    return false;
  }
}
