import { PutObjectCommand, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { s3Client, S3_BUCKET, S3_PREFIXES } from '../config/aws';
import { AuditLogEntry } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';

export async function logAuditEvent(
  userId: string,
  username: string,
  action: AuditLogEntry['action'],
  details: Record<string, unknown>
): Promise<void> {
  const entry: AuditLogEntry = {
    id: uuidv4(),
    timestamp: new Date().toISOString(),
    userId,
    username,
    action,
    details,
  };

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
    logger.info('Audit event logged', { action, userId, entryId: entry.id });
  } catch (error) {
    // Audit logging should not break the main flow, but we log the failure
    logger.error('Failed to write audit log', { error: String(error), entry });
  }
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
