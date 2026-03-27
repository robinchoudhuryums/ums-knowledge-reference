import { createHash } from 'crypto';
import { PutObjectCommand, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { s3Client, S3_BUCKET, S3_PREFIXES } from '../config/aws';
import { AuditLogEntry } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';
import { redactPhi } from '../utils/phiRedactor';

const GENESIS_HASH = 'GENESIS';

// Module-level variable tracking the hash of the last written entry
let lastEntryHash: string = GENESIS_HASH;

// Mutex to serialize audit writes and prevent concurrent entries from
// reading the same lastEntryHash, which would break the hash chain.
let auditMutexPromise: Promise<void> | null = null;

async function withAuditLock<T>(fn: () => Promise<T>): Promise<T> {
  while (auditMutexPromise) {
    await auditMutexPromise;
  }

  let resolve: () => void;
  auditMutexPromise = new Promise<void>(r => { resolve = r; });

  try {
    return await fn();
  } finally {
    auditMutexPromise = null;
    resolve!();
  }
}

/**
 * Compute SHA-256 hash of a string.
 */
function sha256(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Compute the entryHash for an audit log entry.
 * Hashes the JSON of the entry with the entryHash field excluded.
 */
function computeEntryHash(entry: AuditLogEntry): string {
  const { entryHash: _, ...rest } = entry;
  return sha256(JSON.stringify(rest));
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

export async function logAuditEvent(
  userId: string,
  username: string,
  action: AuditLogEntry['action'],
  details: Record<string, unknown>
): Promise<void> {
  // Deep-redact PHI from all string values at any depth in the details payload.
  // This catches nested objects like { userInfo: { name: "John Doe" } } and arrays
  // like { documents: ["file with SSN 123-45-6789"] } that shallow redaction missed.
  const sanitizedDetails = deepRedactPhi(details) as Record<string, unknown>;

  // Serialize audit writes under a mutex to ensure each entry's previousHash
  // correctly references the preceding entry. Without this, concurrent writes
  // would both read the same lastEntryHash, producing a broken chain.
  await withAuditLock(async () => {
    const entry: AuditLogEntry = {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      userId,
      username,
      action,
      details: sanitizedDetails,
      previousHash: lastEntryHash,
    };

    // Compute and attach the entry's own hash (covers all fields except entryHash itself)
    entry.entryHash = computeEntryHash(entry);

    // Store audit logs by date for easy retrieval
    const date = new Date().toISOString().split('T')[0];
    const key = `${S3_PREFIXES.audit}${date}/${entry.id}.json`;

    try {
      await s3Client.send(new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
        Body: JSON.stringify(entry),
        ContentType: 'application/json',
        ServerSideEncryption: 'AES256',
      }));

      // Update the chain: next entry will reference this entry's hash
      lastEntryHash = entry.entryHash;

      logger.info('Audit event logged', { action, userId, entryId: entry.id });
    } catch (error) {
      // Audit logging should not break the main flow, but we log the failure
      logger.error('Failed to write audit log', { error: String(error), action, entryId: entry.id });
    }
  });
}

export async function getAuditLogs(date: string): Promise<AuditLogEntry[]> {
  const prefix = `${S3_PREFIXES.audit}${date}/`;

  try {
    const listResult = await s3Client.send(new ListObjectsV2Command({
      Bucket: S3_BUCKET,
      Prefix: prefix,
    }));

    if (!listResult.Contents) return [];

    const entries: AuditLogEntry[] = [];
    for (const obj of listResult.Contents) {
      if (!obj.Key) continue;
      const getResult = await s3Client.send(new GetObjectCommand({
        Bucket: S3_BUCKET,
        Key: obj.Key,
      }));
      const body = await getResult.Body?.transformToString();
      if (body) {
        entries.push(JSON.parse(body));
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
