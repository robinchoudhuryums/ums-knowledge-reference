/**
 * Data Retention Service — automated cleanup of expired data for HIPAA compliance.
 *
 * Configurable retention periods per data type. Runs daily at ~3 AM via setInterval.
 * Identifies expired S3 objects by parsing the YYYY-MM-DD date from their key path
 * and deletes them when they exceed their retention period.
 */

import { ListObjectsV2Command, DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { s3Client, S3_BUCKET, S3_PREFIXES } from '../config/aws';
import { logAuditEvent } from './audit';
import { logger } from '../utils/logger';

// HIPAA-mandated minimum retention floors (in days).
// These cannot be overridden by environment variables — they represent the absolute
// legal minimums. HIPAA requires audit trails for 6 years; we enforce 6 years minimum.
const MIN_RETENTION_AUDIT_DAYS = 2190;     // 6 years — HIPAA § 164.530(j)
const MIN_RETENTION_QUERY_LOG_DAYS = 180;  // 6 months minimum for operational logs
const MIN_RETENTION_RAG_TRACE_DAYS = 30;   // 30 days minimum for troubleshooting
const MIN_RETENTION_FEEDBACK_DAYS = 180;   // 6 months minimum
const MIN_RETENTION_PPD_DAYS = 365;        // 1 year minimum for clinical intake data
const MIN_RETENTION_FORM_DRAFT_DAYS = 30;  // 30 days minimum for abandoned form drafts

/**
 * Parse an integer from an env var with a safe fallback.
 * Returns the fallback if the env var is missing, empty, or non-numeric.
 * This prevents NaN from propagating into retention period comparisons,
 * which would silently break the entire retention cleanup process.
 */
function safeParseInt(envValue: string | undefined, fallback: number): number {
  if (!envValue) return fallback;
  const parsed = parseInt(envValue, 10);
  return isNaN(parsed) ? fallback : parsed;
}

// Retention periods in days, configurable via environment variables.
// The configured value is clamped to be at least the HIPAA minimum floor.
// If the env var is non-numeric (e.g. "invalid"), the default is used.
const RETENTION_AUDIT_DAYS = Math.max(
  safeParseInt(process.env.RETENTION_AUDIT_DAYS, 2555),
  MIN_RETENTION_AUDIT_DAYS
);
const RETENTION_QUERY_LOG_DAYS = Math.max(
  safeParseInt(process.env.RETENTION_QUERY_LOG_DAYS, 365),
  MIN_RETENTION_QUERY_LOG_DAYS
);
const RETENTION_RAG_TRACE_DAYS = Math.max(
  safeParseInt(process.env.RETENTION_RAG_TRACE_DAYS, 90),
  MIN_RETENTION_RAG_TRACE_DAYS
);
const RETENTION_FEEDBACK_DAYS = Math.max(
  safeParseInt(process.env.RETENTION_FEEDBACK_DAYS, 365),
  MIN_RETENTION_FEEDBACK_DAYS
);
const RETENTION_PPD_DAYS = Math.max(
  safeParseInt(process.env.RETENTION_PPD_DAYS, 730),
  MIN_RETENTION_PPD_DAYS
);
const RETENTION_FORM_DRAFT_DAYS = Math.max(
  safeParseInt(process.env.RETENTION_FORM_DRAFT_DAYS, 90),
  MIN_RETENTION_FORM_DRAFT_DAYS
);

export interface RetentionSummary {
  auditDeleted: number;
  queryLogDeleted: number;
  traceDeleted: number;
  feedbackDeleted: number;
  ppdDeleted: number;
  formDraftsDeleted: number;
}

// Date pattern: YYYY-MM-DD with valid month (01-12) and day (01-31) ranges.
// The old regex /(\d{4}-\d{2}-\d{2})/ matched invalid dates like "2024-13-45".
const DATE_REGEX = /(\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01]))/;

/**
 * Extract the first YYYY-MM-DD date found in an S3 key.
 * Returns null if no date is found or the date is not valid.
 */
function extractDateFromKey(key: string): string | null {
  const match = key.match(DATE_REGEX);
  if (!match) return null;
  // Double-check that JavaScript can parse this as a valid date.
  // Also verify no date rollover occurred (e.g., Feb 31 → Mar 2).
  const d = new Date(match[1] + 'T00:00:00Z');
  if (isNaN(d.getTime())) return null;
  if (d.toISOString().split('T')[0] !== match[1]) return null;
  return match[1];
}

/**
 * Check whether a date string is older than the given retention period in days.
 */
function isExpired(dateStr: string, retentionDays: number, now: Date): boolean {
  const date = new Date(dateStr + 'T00:00:00Z');
  if (isNaN(date.getTime())) {
    // Treat objects with unparseable dates as expired — they should be cleaned up
    // rather than accumulating indefinitely. Log for investigation.
    logger.warn('Data retention: invalid date treated as expired', { dateStr });
    return true;
  }
  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - retentionDays);
  return date < cutoff;
}

/**
 * List and delete all S3 objects under the given prefix that are older than
 * the retention period. Returns the count of objects deleted.
 */
async function deleteExpiredObjects(
  prefix: string,
  retentionDays: number,
  now: Date
): Promise<number> {
  let deleted = 0;
  let continuationToken: string | undefined;

  do {
    const listResult = await s3Client.send(new ListObjectsV2Command({
      Bucket: S3_BUCKET,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    }));

    if (listResult.Contents) {
      for (const obj of listResult.Contents) {
        if (!obj.Key) continue;

        const dateStr = extractDateFromKey(obj.Key);
        if (!dateStr) continue;

        if (isExpired(dateStr, retentionDays, now)) {
          try {
            await s3Client.send(new DeleteObjectCommand({
              Bucket: S3_BUCKET,
              Key: obj.Key,
            }));
            deleted++;
            logger.debug('Retention: deleted expired object', { key: obj.Key, date: dateStr });
          } catch (error) {
            logger.error('Retention: failed to delete object', {
              key: obj.Key,
              error: String(error),
            });
          }
        }
      }
    }

    continuationToken = listResult.IsTruncated ? listResult.NextContinuationToken : undefined;
  } while (continuationToken);

  return deleted;
}

/**
 * Cleanup abandoned form drafts. Unlike other data categories (which embed
 * YYYY-MM-DD in the S3 key), form drafts use an index file with `updatedAt`
 * timestamps. We load the index, find entries older than the retention
 * threshold, delete the corresponding S3 objects, and save the pruned index.
 *
 * This runs as part of the daily retention sweep alongside audit/queryLog/etc.
 * The minimum retention floor (MIN_RETENTION_FORM_DRAFT_DAYS = 30) ensures
 * even a misconfigured env var can't silently delete an active draft.
 */
const FORM_DRAFTS_INDEX_KEY = `${S3_PREFIXES.metadata}form-drafts-index.json`;
const FORM_DRAFTS_PREFIX = `${S3_PREFIXES.metadata}form-drafts/`;

interface DraftIndexEntry {
  id: string;
  formType: string;
  createdBy: string;
  updatedAt: string;
  [key: string]: unknown;
}

async function cleanupExpiredFormDrafts(retentionDays: number, now: Date): Promise<number> {
  try {
    // Load the draft index
    const indexResult = await s3Client.send(new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: FORM_DRAFTS_INDEX_KEY,
    }));
    const indexBody = await indexResult.Body?.transformToString();
    if (!indexBody) return 0;

    const entries: DraftIndexEntry[] = JSON.parse(indexBody);
    if (!Array.isArray(entries) || entries.length === 0) return 0;

    const cutoff = new Date(now);
    cutoff.setUTCDate(cutoff.getUTCDate() - retentionDays);

    const toDelete: DraftIndexEntry[] = [];
    const toKeep: DraftIndexEntry[] = [];
    for (const entry of entries) {
      const updated = new Date(entry.updatedAt);
      if (isNaN(updated.getTime()) || updated < cutoff) {
        toDelete.push(entry);
      } else {
        toKeep.push(entry);
      }
    }

    if (toDelete.length === 0) return 0;

    // Delete the S3 objects for expired drafts
    for (const entry of toDelete) {
      try {
        const key = `${FORM_DRAFTS_PREFIX}${entry.createdBy}/${entry.formType}/${entry.id}.json`;
        await s3Client.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: key }));
        logger.debug('Retention: deleted expired form draft', {
          id: entry.id,
          formType: entry.formType,
          updatedAt: entry.updatedAt,
        });
      } catch (err) {
        // Best-effort — S3 DeleteObject is idempotent, so a missing key is fine
        logger.warn('Retention: failed to delete form draft object', {
          id: entry.id,
          error: String(err),
        });
      }
    }

    // Save the pruned index
    await s3Client.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: FORM_DRAFTS_INDEX_KEY,
      Body: JSON.stringify(toKeep, null, 2),
      ContentType: 'application/json',
      ServerSideEncryption: 'AES256',
    }));

    logger.info('Retention: form drafts cleanup', {
      deleted: toDelete.length,
      remaining: toKeep.length,
      retentionDays,
    });

    return toDelete.length;
  } catch (err) {
    // If the index doesn't exist, there are no drafts to clean up
    const errObj = err as { name?: string };
    if (errObj.name === 'NoSuchKey' || errObj.name === 'NotFound') return 0;
    logger.error('Retention: form drafts cleanup failed', { error: String(err) });
    return 0;
  }
}

/**
 * Run retention cleanup across all data categories.
 * Deletes S3 objects whose embedded date exceeds their retention period.
 * Logs the cleanup action via the audit service.
 */
export async function cleanupExpiredData(): Promise<RetentionSummary> {
  const now = new Date();
  logger.info('Data retention cleanup starting', {
    retentionAuditDays: RETENTION_AUDIT_DAYS,
    retentionQueryLogDays: RETENTION_QUERY_LOG_DAYS,
    retentionRagTraceDays: RETENTION_RAG_TRACE_DAYS,
    retentionFeedbackDays: RETENTION_FEEDBACK_DAYS,
    retentionPpdDays: RETENTION_PPD_DAYS,
    retentionFormDraftDays: RETENTION_FORM_DRAFT_DAYS,
  });

  // Audit logs: stored under audit/YYYY-MM-DD/
  const auditDeleted = await deleteExpiredObjects(
    S3_PREFIXES.audit,
    RETENTION_AUDIT_DAYS,
    now
  );

  // Query logs: stored under metadata/query-logs/YYYY-MM-DD.json
  const queryLogDeleted = await deleteExpiredObjects(
    `${S3_PREFIXES.metadata}query-logs/`,
    RETENTION_QUERY_LOG_DAYS,
    now
  );

  // RAG traces: stored under metadata/rag-traces/YYYY-MM-DD-traces.json and YYYY-MM-DD-feedback.json
  const traceDeleted = await deleteExpiredObjects(
    `${S3_PREFIXES.metadata}rag-traces/`,
    RETENTION_RAG_TRACE_DAYS,
    now
  );

  // Feedback: stored under metadata/feedback/YYYY-MM-DD/ and YYYY-MM-DD-index.json
  const feedbackDeleted = await deleteExpiredObjects(
    `${S3_PREFIXES.metadata}feedback/`,
    RETENTION_FEEDBACK_DAYS,
    now
  );

  // PPD submissions: stored under metadata/ppd-queue/ — contain clinical PHI
  const ppdDeleted = await deleteExpiredObjects(
    `${S3_PREFIXES.metadata}ppd-queue/`,
    RETENTION_PPD_DAYS,
    now
  );

  // Form drafts: stored under metadata/form-drafts/ with an index-based
  // retention approach (no YYYY-MM-DD in key; uses updatedAt from index)
  const formDraftsDeleted = await cleanupExpiredFormDrafts(
    RETENTION_FORM_DRAFT_DAYS,
    now
  );

  const summary: RetentionSummary = {
    auditDeleted,
    queryLogDeleted,
    traceDeleted,
    feedbackDeleted,
    ppdDeleted,
    formDraftsDeleted,
  };

  const totalDeleted = auditDeleted + queryLogDeleted + traceDeleted + feedbackDeleted + ppdDeleted + formDraftsDeleted;

  logger.info('Data retention cleanup completed', {
    ...summary,
    totalDeleted,
  });

  // Log the retention cleanup action itself as an audit event
  if (totalDeleted > 0) {
    try {
      await logAuditEvent('system', 'system', 'data_retention', {
        ...summary,
        totalDeleted,
        retentionConfig: {
          auditDays: RETENTION_AUDIT_DAYS,
          queryLogDays: RETENTION_QUERY_LOG_DAYS,
          ragTraceDays: RETENTION_RAG_TRACE_DAYS,
          feedbackDays: RETENTION_FEEDBACK_DAYS,
          ppdDays: RETENTION_PPD_DAYS,
          formDraftDays: RETENTION_FORM_DRAFT_DAYS,
        },
      });
    } catch (error) {
      logger.error('Failed to audit-log retention cleanup', { error: String(error) });
    }
  }

  return summary;
}

/**
 * Start the retention cleanup scheduler. Runs daily at approximately 3 AM.
 * Calculates the initial delay to the next 3 AM, then repeats every 24 hours.
 */
export function startRetentionScheduler(): void {
  const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
  const TARGET_HOUR_UTC = 3; // 3 AM UTC (consistent with UTC-based expiration checks)

  // Calculate milliseconds until the next 3 AM UTC
  const now = new Date();
  const next3AM = new Date(now);
  next3AM.setUTCHours(TARGET_HOUR_UTC, 0, 0, 0);
  if (next3AM.getTime() <= now.getTime()) {
    // Already past 3 AM UTC today — schedule for tomorrow
    next3AM.setUTCDate(next3AM.getUTCDate() + 1);
  }
  const initialDelayMs = next3AM.getTime() - now.getTime();

  const runCleanup = () => {
    cleanupExpiredData().catch(err =>
      logger.error('Data retention cleanup failed', { error: String(err) })
    );
  };

  // Schedule first run at ~3 AM, then repeat every 24 hours
  retentionInitialTimeout = setTimeout(() => {
    runCleanup();
    retentionRepeatInterval = setInterval(runCleanup, TWENTY_FOUR_HOURS_MS);
  }, initialDelayMs);

  logger.info('Data retention scheduler started', {
    nextRunIn: `${Math.round(initialDelayMs / 60000)} minutes`,
    targetHour: `${TARGET_HOUR_UTC}:00 UTC`,
    retentionAuditDays: RETENTION_AUDIT_DAYS,
    retentionQueryLogDays: RETENTION_QUERY_LOG_DAYS,
    retentionRagTraceDays: RETENTION_RAG_TRACE_DAYS,
    retentionFeedbackDays: RETENTION_FEEDBACK_DAYS,
    retentionPpdDays: RETENTION_PPD_DAYS,
  });
}

let retentionInitialTimeout: ReturnType<typeof setTimeout> | null = null;
let retentionRepeatInterval: ReturnType<typeof setInterval> | null = null;

export function stopRetentionScheduler(): void {
  if (retentionInitialTimeout) {
    clearTimeout(retentionInitialTimeout);
    retentionInitialTimeout = null;
  }
  if (retentionRepeatInterval) {
    clearInterval(retentionRepeatInterval);
    retentionRepeatInterval = null;
  }
}
