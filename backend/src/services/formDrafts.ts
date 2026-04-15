/**
 * Form Drafts Service
 *
 * Server-side partial-save and resume for long forms (PPD, PMD Account
 * Creation, PAP Account Creation). Clients call `upsertDraft` on every
 * meaningful change; reviewers can `listDrafts` and `getDraft` to resume
 * later, and `discardDraft` to "start over" cleanly.
 *
 * Why server-side (instead of relying on localStorage alone):
 *   - A phone interview may span devices (tablet during visit, desktop
 *     afterwards). localStorage is device-local.
 *   - A browser crash during a 45-question PPD otherwise loses 20 minutes
 *     of patient input.
 *   - HIPAA audit: PHI typed into a form belongs in the same encrypted
 *     S3 store as the rest of the PPD record, not an uncontrolled browser
 *     cache.
 *
 * PHI handling: draft payloads ARE the data being collected. They're
 * stored in S3 with AES256, scoped to the submitting user, and
 * automatically expired by the existing data-retention service on the
 * `form-drafts/` prefix. Payload bodies are never written to logs —
 * only sizes and counts.
 *
 * Storage layout (S3): metadata/form-drafts/{userId}/{formType}/{id}.json
 * Index: metadata/form-drafts-index.json (contains summary rows only)
 */

import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { s3Client, S3_BUCKET, S3_PREFIXES } from '../config/aws';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

const DRAFTS_PREFIX = `${S3_PREFIXES.metadata}form-drafts/`;
const DRAFTS_INDEX_KEY = `${S3_PREFIXES.metadata}form-drafts-index.json`;

export type FormType = 'ppd' | 'pmd-account' | 'pap-account';
const VALID_FORM_TYPES: FormType[] = ['ppd', 'pmd-account', 'pap-account'];

export function isValidFormType(v: unknown): v is FormType {
  return typeof v === 'string' && (VALID_FORM_TYPES as string[]).includes(v);
}

export interface FormDraftRecord {
  id: string;
  formType: FormType;
  /** Arbitrary JSON payload representing the in-progress form state */
  payload: unknown;
  /** Optional short label shown in resume UI (e.g. patient name + Trx#) */
  label?: string;
  /** Form version at save time — lets UI warn on schema drift */
  formVersion?: string;
  /** 0-100 — best-effort fill completion for progress UI */
  completionPercent?: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

interface FormDraftIndexEntry {
  id: string;
  formType: FormType;
  label?: string;
  completionPercent?: number;
  formVersion?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

// S3 PUT object size guard — prevent runaway draft payloads (e.g. paste
// of the entire web page). 2MB is ~10x the largest PPD submission.
const MAX_DRAFT_PAYLOAD_BYTES = 2 * 1024 * 1024;

function draftKey(userId: string, formType: FormType, id: string): string {
  return `${DRAFTS_PREFIX}${userId}/${formType}/${id}.json`;
}

async function loadIndex(): Promise<FormDraftIndexEntry[]> {
  try {
    const result = await s3Client.send(new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: DRAFTS_INDEX_KEY,
    }));
    const body = await result.Body?.transformToString();
    return body ? JSON.parse(body) : [];
  } catch {
    return [];
  }
}

async function saveIndex(entries: FormDraftIndexEntry[]): Promise<void> {
  await s3Client.send(new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: DRAFTS_INDEX_KEY,
    Body: JSON.stringify(entries, null, 2),
    ContentType: 'application/json',
    ServerSideEncryption: 'AES256',
  }));
}

/**
 * Create a new draft or update an existing one in-place. Pass `id`
 * to update; omit to create.
 */
export async function upsertDraft(input: {
  id?: string;
  formType: FormType;
  payload: unknown;
  label?: string;
  formVersion?: string;
  completionPercent?: number;
  userId: string;
}): Promise<FormDraftRecord> {
  // Size-guard the payload before hitting S3 so we fail fast with a
  // meaningful message (INV-24 in spirit — bounded writes).
  const payloadStr = JSON.stringify(input.payload);
  if (payloadStr.length > MAX_DRAFT_PAYLOAD_BYTES) {
    throw new Error(`Draft payload exceeds ${MAX_DRAFT_PAYLOAD_BYTES} bytes`);
  }

  const now = new Date().toISOString();
  const isNew = !input.id;
  const id = input.id || uuidv4();

  // If updating, preserve the original createdAt
  let createdAt = now;
  if (!isNew) {
    try {
      const existing = await getDraft(input.userId, input.formType, id);
      if (existing) createdAt = existing.createdAt;
    } catch {
      // Treat missing-on-update as a new record; no harm done
    }
  }

  const record: FormDraftRecord = {
    id,
    formType: input.formType,
    payload: input.payload,
    label: input.label,
    formVersion: input.formVersion,
    completionPercent: input.completionPercent,
    createdBy: input.userId,
    createdAt,
    updatedAt: now,
  };

  await s3Client.send(new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: draftKey(input.userId, input.formType, id),
    Body: JSON.stringify(record),
    ContentType: 'application/json',
    ServerSideEncryption: 'AES256',
  }));

  // Update index — newest first for resume UI
  const index = await loadIndex();
  const existingIdx = index.findIndex(e => e.id === id && e.createdBy === input.userId);
  const entry: FormDraftIndexEntry = {
    id,
    formType: record.formType,
    label: record.label,
    completionPercent: record.completionPercent,
    formVersion: record.formVersion,
    createdBy: record.createdBy,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
  if (existingIdx >= 0) {
    index.splice(existingIdx, 1);
  }
  index.unshift(entry);
  await saveIndex(index);

  logger.info('Form draft upserted', {
    id,
    formType: record.formType,
    userId: input.userId,
    isNew,
    payloadBytes: payloadStr.length,
    completionPercent: record.completionPercent,
  });

  return record;
}

/**
 * Fetch a user's draft by id and form type. Returns null if missing.
 */
export async function getDraft(userId: string, formType: FormType, id: string): Promise<FormDraftRecord | null> {
  try {
    const result = await s3Client.send(new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: draftKey(userId, formType, id),
    }));
    const body = await result.Body?.transformToString();
    return body ? JSON.parse(body) : null;
  } catch {
    return null;
  }
}

/**
 * List drafts visible to the caller.
 *   - Regular users: only their own drafts.
 *   - Admins: all drafts (pass `adminView: true`).
 */
export async function listDrafts(input: {
  userId: string;
  adminView?: boolean;
  formType?: FormType;
}): Promise<FormDraftIndexEntry[]> {
  let entries = await loadIndex();
  if (!input.adminView) {
    entries = entries.filter(e => e.createdBy === input.userId);
  }
  if (input.formType) {
    entries = entries.filter(e => e.formType === input.formType);
  }
  return entries;
}

/**
 * Discard a draft ("start over"). Removes both the S3 object and the
 * index entry. Idempotent — returns false if the draft was not present
 * in the owner's index (S3 DeleteObject is itself idempotent, so it is
 * not an authoritative signal of existence).
 */
export async function discardDraft(userId: string, formType: FormType, id: string): Promise<boolean> {
  // Authoritative signal: did the caller actually own this draft?
  const index = await loadIndex();
  const filtered = index.filter(e => !(e.id === id && e.createdBy === userId));
  const existed = filtered.length !== index.length;

  // Always attempt the S3 delete so stray blobs don't outlive their index
  // entry. S3 DeleteObject is idempotent — deleting a missing key succeeds.
  try {
    await s3Client.send(new DeleteObjectCommand({
      Bucket: S3_BUCKET,
      Key: draftKey(userId, formType, id),
    }));
  } catch (err) {
    logger.warn('Draft S3 delete failed (may already be gone)', { id, error: String(err) });
  }

  if (existed) {
    await saveIndex(filtered);
  }

  logger.info('Form draft discarded', { id, formType, userId, removed: existed });
  return existed;
}

// Exposed so test suites / data-retention can reference the prefix.
export const FORM_DRAFTS_PREFIX = DRAFTS_PREFIX;
