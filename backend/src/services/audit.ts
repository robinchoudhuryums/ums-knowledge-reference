import { createHash, createHmac } from 'crypto';
import { PutObjectCommand, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { s3Client, S3_BUCKET, S3_PREFIXES } from '../config/aws';
import { AuditLogEntry } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';
import { withSpan } from '../utils/traceSpan';
import { redactPhi } from '../utils/phiRedactor';
import { createMutex } from '../utils/asyncMutex';
import { withRetry } from '../utils/resilience';
import { sendOperationalAlert } from './alertService';

const GENESIS_HASH = 'GENESIS';

// S3 Object Lock: when AUDIT_OBJECT_LOCK=true and the S3 bucket has Object Lock enabled,
// audit entries are written with COMPLIANCE mode retention (immutable — cannot be deleted
// even by root until retention expires). Retention period defaults to HIPAA minimum (6 years).
const AUDIT_OBJECT_LOCK = process.env.AUDIT_OBJECT_LOCK === 'true';
const AUDIT_RETENTION_YEARS = Math.max(6, parseInt(process.env.AUDIT_RETENTION_YEARS || '6', 10) || 6);

// HMAC secret for audit log integrity chain.
// Using HMAC (vs plain SHA-256) ensures an attacker with DB access cannot
// recompute the chain — they'd need the application secret.
const AUDIT_HMAC_SECRET = process.env.JWT_SECRET || process.env.SESSION_SECRET || 'audit-log-integrity-key';

// Module-level variable tracking the hash of the last written entry
let lastEntryHash: string = GENESIS_HASH;
let chainInitialized = false;
// Database-backed chain is attempted automatically when PostgreSQL is available

// Mutex to serialize audit writes and prevent concurrent entries from
// reading the same lastEntryHash, which would break the hash chain.
const withAuditLock = createMutex();

/**
 * Compute SHA-256 hash of a string.
 * Kept for backward-compatible chain verification of entries written before HMAC upgrade.
 */
export function sha256(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Compute HMAC-SHA256 of a string with the audit secret.
 */
function hmacSha256(data: string): string {
  return createHmac('sha256', AUDIT_HMAC_SECRET).update(data).digest('hex');
}

/**
 * Compute the entryHash for an audit log entry.
 * Uses HMAC-SHA256 keyed with a secret so the chain cannot be recomputed
 * by an attacker who only has access to the stored entries.
 * The hash covers: entry content (without entryHash) + previousHash linkage.
 */
function computeEntryHash(entry: AuditLogEntry): string {
  const { entryHash: _, ...rest } = entry;
  const content = JSON.stringify(rest);
  return hmacSha256(content + (entry.previousHash || GENESIS_HASH));
}

/**
 * Recursively redact PHI from all string values in an object tree.
 * Traverses nested objects and arrays to catch PHI at any depth.
 */
function deepRedactPhi(value: unknown): unknown {
  if (typeof value === 'string') {
    return redactPhi(value).text;
  }
  if (Array.isArray(value)) {
    return value.map(deepRedactPhi);
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = deepRedactPhi(v);
    }
    return result;
  }
  // Numbers, booleans, null — pass through unchanged
  return value;
}

/**
 * Recover the hash chain from S3 on first audit write after restart.
 * Scans back through recent days of audit entries to find the most recent
 * hash and preserve chain continuity across server restarts. Without this,
 * multi-day downtime in S3-only mode (no DATABASE_URL) silently forks the
 * chain — auditors comparing entries across the gap would see continuous
 * `previousHash` references but a verifiability break.
 *
 * Scan window is bounded so a fresh deploy with no prior entries doesn't
 * loop indefinitely. If audit entries exist somewhere in the bucket but
 * none within the window, the chain forks and we fire an operational alert
 * so an operator can investigate (typical cause: server downtime exceeded
 * the window, or audit-prefix listing access is broken).
 *
 * Note: when DATABASE_URL is set, dbAtomicChainWrite handles chain head
 * via SELECT FOR UPDATE and this S3 path is a fallback only.
 */
const CHAIN_RECOVERY_DAYS = Math.max(1, parseInt(process.env.AUDIT_CHAIN_RECOVERY_DAYS || '30', 10) || 30);

async function recoverHashChain(): Promise<void> {
  if (chainInitialized) return;
  chainInitialized = true;

  try {
    // Walk backwards from today, stopping at the first day with an entry
    // that carries an entryHash. Bounded by CHAIN_RECOVERY_DAYS so a
    // brand-new deployment with no audit history terminates promptly.
    for (let dayOffset = 0; dayOffset < CHAIN_RECOVERY_DAYS; dayOffset++) {
      const date = new Date(Date.now() - dayOffset * 86400000).toISOString().split('T')[0];
      const entries = await getAuditLogs(date);
      if (entries.length > 0) {
        // getAuditLogs sorts descending by timestamp, so [0] is the most recent
        const mostRecent = entries[0];
        if (mostRecent.entryHash) {
          lastEntryHash = mostRecent.entryHash;
          logger.info('Audit hash chain recovered from S3', {
            date,
            recoveredFromEntryId: mostRecent.id,
            dayOffsetFromToday: dayOffset,
          });
          return;
        }
      }
    }

    // No entries found in the recovery window. Distinguish two cases by
    // checking whether the audit prefix has *any* objects at all: a fresh
    // deploy is fine, but stale entries beyond the window indicate downtime
    // longer than the configured window and the chain will fork on the
    // next write — alert an operator.
    const hasOlderEntries = await auditPrefixHasAnyObjects();
    if (hasOlderEntries) {
      logger.error('Audit hash chain recovery exhausted — entries exist beyond recovery window, chain will fork', {
        recoveryDays: CHAIN_RECOVERY_DAYS,
      });
      sendOperationalAlert(
        'audit_chain_fork',
        `Audit hash chain forked: no entry found within ${CHAIN_RECOVERY_DAYS} days but older entries exist in the bucket`,
        { recoveryDays: CHAIN_RECOVERY_DAYS },
      ).catch(() => {});
    } else {
      logger.info('No previous audit entries found, starting hash chain from GENESIS');
    }
  } catch (err) {
    // Recovery failure is non-fatal — chain starts fresh from GENESIS
    logger.warn('Failed to recover audit hash chain, starting from GENESIS', { error: String(err) });
  }
}

/**
 * Check whether ANY object exists under the audit prefix (with a 1-key
 * cap so we don't pay for a full listing). Used by recoverHashChain to
 * distinguish "fresh deploy" from "downtime exceeded recovery window".
 */
async function auditPrefixHasAnyObjects(): Promise<boolean> {
  try {
    const result = await s3Client.send(new ListObjectsV2Command({
      Bucket: S3_BUCKET,
      Prefix: S3_PREFIXES.audit,
      MaxKeys: 1,
    }));
    return (result.Contents?.length ?? 0) > 0;
  } catch {
    // If we can't list, assume yes — that's the safer side (we'll alert).
    return true;
  }
}

/**
 * Database-backed hash chain for multi-instance coordination.
 * Uses PostgreSQL SELECT FOR UPDATE to atomically read and update the
 * last hash, preventing concurrent instances from reading the same
 * previousHash value. Falls back to in-process mutex when DB is unavailable.
 */
async function dbAtomicChainWrite(entry: AuditLogEntry): Promise<string> {
  try {
    const { checkDatabaseConnection } = await import('../config/database');
    if (!(await checkDatabaseConnection())) throw new Error('DB not connected');

    const { getPool } = await import('../config/database');
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Atomically read and lock the last hash row
      const result = await client.query(
        `SELECT value FROM audit_chain_state WHERE key = 'last_hash' FOR UPDATE`
      );

      const previousHash = result.rows.length > 0 ? result.rows[0].value : GENESIS_HASH;
      entry.previousHash = previousHash;
      entry.entryHash = computeEntryHash(entry);

      // Update the stored hash atomically
      await client.query(
        `INSERT INTO audit_chain_state (key, value) VALUES ('last_hash', $1)
         ON CONFLICT (key) DO UPDATE SET value = $1`,
        [entry.entryHash]
      );

      await client.query('COMMIT');
      return entry.entryHash;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch {
    // DB not available — fall back to in-process chain
    return '';
  }
}

export async function logAuditEvent(
  userId: string,
  username: string,
  action: AuditLogEntry['action'],
  details: Record<string, unknown>
): Promise<void> {
  return withSpan('audit.log_event', { action, userId }, async () => {
  const sanitizedDetails = deepRedactPhi(details) as Record<string, unknown>;

  await withAuditLock(async () => {
    await recoverHashChain();

    const entry: AuditLogEntry = {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      userId,
      username,
      action,
      details: sanitizedDetails,
      previousHash: lastEntryHash,
    };

    // Try database-backed atomic chain first (multi-instance safe)
    const dbHash = await dbAtomicChainWrite(entry);

    if (!dbHash) {
      // Fallback: in-process chain (single instance only)
      entry.entryHash = computeEntryHash(entry);
    }

    const date = new Date().toISOString().split('T')[0];
    const key = `${S3_PREFIXES.audit}${date}/${entry.id}.json`;

    try {
      const putParams: Record<string, unknown> = {
        Bucket: S3_BUCKET,
        Key: key,
        Body: JSON.stringify(entry),
        ContentType: 'application/json',
        ServerSideEncryption: 'AES256',
      };

      // When Object Lock is enabled, set COMPLIANCE retention so audit entries
      // cannot be deleted or overwritten until the retention period expires.
      // Requires: S3 bucket created with Object Lock enabled (one-time setup).
      if (AUDIT_OBJECT_LOCK) {
        const retainUntil = new Date();
        retainUntil.setFullYear(retainUntil.getFullYear() + AUDIT_RETENTION_YEARS);
        putParams.ObjectLockMode = 'COMPLIANCE';
        putParams.ObjectLockRetainUntilDate = retainUntil;
      }

      await withRetry(
        () => s3Client.send(new PutObjectCommand(putParams as any)),
        { maxRetries: 2, baseDelayMs: 500, label: 'audit-s3-write' }
      );

      lastEntryHash = entry.entryHash!;
      logger.info('Audit event logged', { action, userId, entryId: entry.id });
    } catch (error) {
      // All retries exhausted — audit entry is permanently lost
      logger.error('Failed to write audit log after retries — entry dropped', {
        error: String(error), action, entryId: entry.id, userId,
      });
      // Send operational alert (throttled to 1/hour)
      sendOperationalAlert('audit_write_failed', 'Audit log entry dropped after retries', {
        action,
        entryId: entry.id,
        userId,
        error: String(error),
      }).catch(() => {}); // Never block audit path
    }
  });
  }); // end withSpan
}

/** Concurrency limit for parallel S3 GETs during audit log retrieval */
const AUDIT_FETCH_CONCURRENCY = 10;

export async function getAuditLogs(date: string): Promise<AuditLogEntry[]> {
  const prefix = `${S3_PREFIXES.audit}${date}/`;

  try {
    // Phase 1: List all keys (sequential pagination)
    const keys: string[] = [];
    let continuationToken: string | undefined;

    do {
      const listResult = await s3Client.send(new ListObjectsV2Command({
        Bucket: S3_BUCKET,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }));

      if (listResult.Contents) {
        for (const obj of listResult.Contents) {
          if (obj.Key) keys.push(obj.Key);
        }
      }

      continuationToken = listResult.IsTruncated ? listResult.NextContinuationToken : undefined;
    } while (continuationToken);

    if (keys.length === 0) return [];

    // Phase 2: Fetch entries in parallel batches (much faster than sequential)
    const entries: AuditLogEntry[] = [];

    for (let i = 0; i < keys.length; i += AUDIT_FETCH_CONCURRENCY) {
      const batch = keys.slice(i, i + AUDIT_FETCH_CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map(async (key) => {
          const getResult = await s3Client.send(new GetObjectCommand({
            Bucket: S3_BUCKET,
            Key: key,
          }));
          const body = await getResult.Body?.transformToString();
          return body ? JSON.parse(body) as AuditLogEntry : null;
        })
      );

      for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
          entries.push(result.value);
        } else if (result.status === 'rejected') {
          logger.warn('Failed to read audit log entry', { error: String(result.reason) });
        }
      }
    }

    return entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  } catch (error) {
    logger.error('Failed to retrieve audit logs', { error: String(error), date });
    return [];
  }
}

/**
 * Verify the hash chain integrity for all audit log entries on a given date.
 * Entries are sorted chronologically and each entry's entryHash and previousHash
 * linkage is validated.
 */
export async function verifyAuditChain(date: string): Promise<{
  valid: boolean;
  brokenAt?: string;
  totalEntries: number;
}> {
  const entries = await getAuditLogs(date);
  // Sort chronologically (ascending) for chain verification
  const sorted = entries.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  if (sorted.length === 0) {
    return { valid: true, totalEntries: 0 };
  }

  for (let i = 0; i < sorted.length; i++) {
    const entry = sorted[i];

    // Verify the entry's own hash is correct
    const expectedHash = computeEntryHash(entry);
    if (entry.entryHash !== expectedHash) {
      return {
        valid: false,
        brokenAt: entry.id,
        totalEntries: sorted.length,
      };
    }

    // Verify chain linkage
    if (i === 0) {
      // First entry of the day should reference GENESIS or a previous day's last hash
      // We only verify that previousHash exists (it could be GENESIS or a carried-over hash)
      if (!entry.previousHash) {
        return {
          valid: false,
          brokenAt: entry.id,
          totalEntries: sorted.length,
        };
      }
    } else {
      // Subsequent entries must reference the previous entry's entryHash
      const prevEntry = sorted[i - 1];
      if (entry.previousHash !== prevEntry.entryHash) {
        return {
          valid: false,
          brokenAt: entry.id,
          totalEntries: sorted.length,
        };
      }
    }
  }

  return { valid: true, totalEntries: sorted.length };
}
