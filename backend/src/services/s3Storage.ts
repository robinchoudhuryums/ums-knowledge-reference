import {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { s3Client, S3_BUCKET, S3_PREFIXES } from '../config/aws';
import { VectorStoreIndex } from '../types';
import { logger } from '../utils/logger';
import { Readable } from 'stream';

// --- Document file storage ---

export async function uploadDocumentToS3(
  fileBuffer: Buffer,
  s3Key: string,
  contentType: string
): Promise<void> {
  const upload = new Upload({
    client: s3Client,
    params: {
      Bucket: S3_BUCKET,
      Key: s3Key,
      Body: fileBuffer,
      ContentType: contentType,
      ServerSideEncryption: 'AES256',
    },
  });

  await upload.done();
  logger.info('Document uploaded to S3', { s3Key });
}

// M12: Max size we'll buffer into memory when fetching a raw document back
// from S3. multer caps browser uploads at 50 MB, but service-account callers
// (X-API-Key) bypass multer, and adversarial callers could upload large blobs
// that later OOM the process when a re-processing flow pulls them back.
// 100 MB is well above the largest legitimate medical document we've seen.
const MAX_DOCUMENT_BYTES = 100 * 1024 * 1024;

export async function getDocumentFromS3(s3Key: string): Promise<Buffer> {
  // HEAD first so we can reject oversized objects without streaming them.
  // Also catches objects that existed before the guard was in place.
  const head = await s3Client.send(new HeadObjectCommand({
    Bucket: S3_BUCKET,
    Key: s3Key,
  }));
  if (head.ContentLength && head.ContentLength > MAX_DOCUMENT_BYTES) {
    logger.error('S3 document exceeds size limit', {
      s3Key, sizeBytes: head.ContentLength, limitBytes: MAX_DOCUMENT_BYTES,
    });
    throw new Error(
      `Document too large: ${Math.round(head.ContentLength / 1024 / 1024)}MB ` +
      `(limit: ${MAX_DOCUMENT_BYTES / 1024 / 1024}MB)`
    );
  }

  const result = await s3Client.send(new GetObjectCommand({
    Bucket: S3_BUCKET,
    Key: s3Key,
  }));

  const stream = result.Body as Readable;
  const chunks: Buffer[] = [];
  let totalSize = 0;
  for await (const chunk of stream) {
    const buf = Buffer.from(chunk);
    totalSize += buf.length;
    // Belt-and-suspenders guard — a streamed body can exceed the HEAD-reported
    // size if the object is replaced mid-read. Abort early rather than
    // unbounded memory growth.
    if (totalSize > MAX_DOCUMENT_BYTES) {
      throw new Error(
        `Document stream exceeded size limit while reading ${s3Key} ` +
        `(${MAX_DOCUMENT_BYTES / 1024 / 1024}MB)`
      );
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

/**
 * Get the S3 ETag (content hash) for a document without downloading it.
 * Returns null if the object doesn't exist.
 */
export async function getDocumentETag(s3Key: string): Promise<string | null> {
  try {
    const result = await s3Client.send(new HeadObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3Key,
    }));
    return result.ETag?.replace(/"/g, '') || null;
  } catch (error: unknown) {
    const err = error as { name?: string };
    if (err.name === 'NotFound' || err.name === 'NoSuchKey') return null;
    throw error;
  }
}

export async function deleteDocumentFromS3(s3Key: string): Promise<void> {
  await s3Client.send(new DeleteObjectCommand({
    Bucket: S3_BUCKET,
    Key: s3Key,
  }));
  logger.info('Document deleted from S3', { s3Key });
}

// --- Metadata storage (documents index, collections) ---

export async function saveMetadata<T>(key: string, data: T): Promise<void> {
  await s3Client.send(new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: `${S3_PREFIXES.metadata}${key}`,
    Body: JSON.stringify(data, null, 2),
    ContentType: 'application/json',
    ServerSideEncryption: 'AES256',
  }));
}

// Maximum metadata JSON size we'll load into memory (50 MB).
// Protects against OOM if an object grows unexpectedly large.
const MAX_METADATA_BYTES = 50 * 1024 * 1024;

export async function loadMetadata<T>(key: string): Promise<T | null> {
  try {
    const result = await s3Client.send(new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: `${S3_PREFIXES.metadata}${key}`,
    }));

    // Guard: reject objects that would consume too much memory
    if (result.ContentLength && result.ContentLength > MAX_METADATA_BYTES) {
      logger.error('S3 metadata object exceeds size limit', {
        key, sizeBytes: result.ContentLength, limitBytes: MAX_METADATA_BYTES,
      });
      throw new Error(`Metadata object too large: ${key} is ${Math.round(result.ContentLength / 1024 / 1024)}MB (limit: ${MAX_METADATA_BYTES / 1024 / 1024}MB)`);
    }

    const body = await result.Body?.transformToString();
    if (!body) return null;
    return JSON.parse(body) as T;
  } catch (error: unknown) {
    const err = error as { name?: string; $metadata?: { httpStatusCode?: number } };
    // Handle "object doesn't exist" gracefully — AWS SDK uses different error
    // names depending on the operation and SDK version
    if (err.name === 'NoSuchKey' || err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
      return null;
    }
    // Log unexpected S3 errors before re-throwing for easier debugging
    logger.error('Unexpected S3 error loading metadata', { key, errorName: err.name, error: String(error) });
    throw error;
  }
}

export async function deleteMetadata(key: string): Promise<void> {
  await s3Client.send(new DeleteObjectCommand({
    Bucket: S3_BUCKET,
    Key: `${S3_PREFIXES.metadata}${key}`,
  }));
}

// --- Document registry ---

// ─── Document & Collection Index (delegated to db layer for RDS/S3 hybrid) ──
// These re-export from the db layer which automatically uses PostgreSQL when
// DATABASE_URL is configured, falling back to S3 JSON when it's not.
export {
  getDocumentsIndex,
  saveDocumentsIndex,
  getCollectionsIndex,
  saveCollectionsIndex,
} from '../db';

// --- Vector store persistence ---

export async function saveVectorIndex(index: VectorStoreIndex): Promise<void> {
  await s3Client.send(new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: `${S3_PREFIXES.vectors}index.json`,
    Body: JSON.stringify(index),
    ContentType: 'application/json',
    ServerSideEncryption: 'AES256',
  }));
  logger.info('Vector index saved to S3', { chunkCount: index.chunks.length });
}

// Maximum vector index size (500 MB) — vector indexes are large but bounded.
const MAX_VECTOR_INDEX_BYTES = 500 * 1024 * 1024;

export async function loadVectorIndex(): Promise<VectorStoreIndex | null> {
  try {
    const result = await s3Client.send(new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: `${S3_PREFIXES.vectors}index.json`,
    }));

    // Guard: reject vector indexes that would consume too much memory
    if (result.ContentLength && result.ContentLength > MAX_VECTOR_INDEX_BYTES) {
      logger.error('Vector index exceeds size limit', {
        sizeBytes: result.ContentLength, limitBytes: MAX_VECTOR_INDEX_BYTES,
      });
      throw new Error(`Vector index too large: ${Math.round(result.ContentLength / 1024 / 1024)}MB (limit: ${MAX_VECTOR_INDEX_BYTES / 1024 / 1024}MB). Consider migrating to pgvector.`);
    }

    const body = await result.Body?.transformToString();
    if (!body) return null;
    return JSON.parse(body) as VectorStoreIndex;
  } catch (error: unknown) {
    const err = error as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (err.name === 'NoSuchKey' || err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
      return null;
    }
    logger.error('Unexpected S3 error loading vector index', { errorName: err.name, error: String(error) });
    throw error;
  }
}
