import {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { s3Client, S3_BUCKET, S3_PREFIXES } from '../config/aws';
import { Document, Collection, VectorStoreIndex } from '../types';
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

export async function getDocumentFromS3(s3Key: string): Promise<Buffer> {
  const result = await s3Client.send(new GetObjectCommand({
    Bucket: S3_BUCKET,
    Key: s3Key,
  }));

  const stream = result.Body as Readable;
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
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
    const err = error as { name?: string };
    if (err.name === 'NoSuchKey') return null;
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

const DOCUMENTS_INDEX_KEY = 'documents-index.json';
const COLLECTIONS_INDEX_KEY = 'collections-index.json';

export async function getDocumentsIndex(): Promise<Document[]> {
  const docs = await loadMetadata<Document[]>(DOCUMENTS_INDEX_KEY);
  return docs || [];
}

export async function saveDocumentsIndex(docs: Document[]): Promise<void> {
  await saveMetadata(DOCUMENTS_INDEX_KEY, docs);
}

export async function getCollectionsIndex(): Promise<Collection[]> {
  const collections = await loadMetadata<Collection[]>(COLLECTIONS_INDEX_KEY);
  return collections || [];
}

export async function saveCollectionsIndex(collections: Collection[]): Promise<void> {
  await saveMetadata(COLLECTIONS_INDEX_KEY, collections);
}

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
    const err = error as { name?: string };
    if (err.name === 'NoSuchKey') return null;
    throw error;
  }
}
