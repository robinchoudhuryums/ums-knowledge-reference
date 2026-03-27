/**
 * Data Retention Service — automated cleanup of expired data for HIPAA compliance.
 *
 * Configurable retention periods per data type. Runs daily at ~3 AM via setInterval.
 * Identifies expired S3 objects by parsing the YYYY-MM-DD date from their key path
 * and deletes them when they exceed their retention period.
 */

import { ListObjectsV2Command, DeleteObjectCommand } from '@aws-sdk/client-s3';
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

export interface RetentionSummary {
  auditDeleted: number;
  queryLogDeleted: number;
  traceDeleted: number;
  feedbackDeleted: number;
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
  // Double-check that JavaScript can parse this as a valid date
  const d = new Date(match[1] + 'T00:00:00Z');
  if (isNaN(d.getTime())) return null;
  return match[1];
}

/**
 * Check whether a date string is older than the given retention period in days.
 */
function isExpired(dateStr: string, retentionDays: number, now: Date): boolean {
  const date = new Date(dateStr + 'T00:00:00Z');
  if (isNaN(date.getTime())) return false;
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

  const summary: RetentionSummary = {
    auditDeleted,
    queryLogDeleted,
    traceDeleted,
    feedbackDeleted,
  };

  const totalDeleted = auditDeleted + queryLogDeleted + traceDeleted + feedbackDeleted;

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
  const TARGET_HOUR = 3; // 3 AM local time

  // Calculate milliseconds until the next 3 AM
  const now = new Date();
  const next3AM = new Date(now);
  next3AM.setHours(TARGET_HOUR, 0, 0, 0);
  if (next3AM.getTime() <= now.getTime()) {
    // Already past 3 AM today — schedule for tomorrow
    next3AM.setDate(next3AM.getDate() + 1);
  }
  const initialDelayMs = next3AM.getTime() - now.getTime();

  const runCleanup = () => {
    cleanupExpiredData().catch(err =>
      logger.error('Data retention cleanup failed', { error: String(err) })
    );
  };

  // Schedule first run at ~3 AM, then repeat every 24 hours
  setTimeout(() => {
    runCleanup();
    setInterval(runCleanup, TWENTY_FOUR_HOURS_MS);
  }, initialDelayMs);

  logger.info('Data retention scheduler started', {
    nextRunIn: `${Math.round(initialDelayMs / 60000)} minutes`,
    targetHour: `${TARGET_HOUR}:00`,
    retentionAuditDays: RETENTION_AUDIT_DAYS,
    retentionQueryLogDays: RETENTION_QUERY_LOG_DAYS,
    retentionRagTraceDays: RETENTION_RAG_TRACE_DAYS,
    retentionFeedbackDays: RETENTION_FEEDBACK_DAYS,
  });
}
