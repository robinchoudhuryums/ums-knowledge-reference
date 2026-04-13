import { v4 as uuidv4 } from 'uuid';
import { createHash } from 'crypto';
import { Document } from '../types';
import { S3_PREFIXES } from '../config/aws';
import {
  uploadDocumentToS3,
  getDocumentsIndex,
  saveDocumentsIndex,
} from './s3Storage';
import { extractText } from './textExtractor';
import { extractImageDescriptions } from './visionExtractor';
import { chunkDocument } from './chunker';
import { generateEmbeddingsBatch } from './embeddings';
import { addChunksToStore, removeDocumentChunks } from './vectorStore';
import { logAuditEvent } from './audit';
import { logger } from '../utils/logger';
import { createMutex } from '../utils/asyncMutex';
import { stripImageMetadata } from '../utils/stripMetadata';

// Allowed file extensions for uploaded documents
const ALLOWED_EXTENSIONS = new Set([
  'pdf', 'docx', 'doc', 'xlsx', 'xls', 'csv', 'txt', 'md', 'html', 'htm',
]);

// Mutex lock to prevent concurrent document index updates from corrupting state.
const withIndexLock = createMutex();

export interface UploadResult {
  document: Document;
  chunkCount: number;
}

/**
 * Full document ingestion pipeline:
 * 1. Validate file extension
 * 2. Upload original file to S3
 * 3. Extract text
 * 4. Chunk text
 * 5. Generate embeddings
 * 6. Store in vector store
 * 7. Update document index (with mutex lock)
 * 8. Log audit trail for version replacements
 *
 * On failure after vector store insertion, chunks are rolled back to prevent orphans.
 */
export async function ingestDocument(
  fileBuffer: Buffer,
  originalName: string,
  mimeType: string,
  collectionId: string,
  uploadedBy: string
): Promise<UploadResult> {
  const documentId = uuidv4();
  const extension = (originalName.split('.').pop() || '').toLowerCase();
  const filename = `${documentId}.${extension}`;
  const s3Key = `${S3_PREFIXES.documents}${collectionId}/${filename}`;

  // Step 0: Validate file extension to prevent unexpected file types
  if (extension && !ALLOWED_EXTENSIONS.has(extension)) {
    throw new Error(
      `Unsupported file extension: .${extension}. Allowed: ${[...ALLOWED_EXTENSIONS].join(', ')}`
    );
  }

  // Check if this is a re-upload (same name in same collection)
  const existingDocs = await getDocumentsIndex();
  const existingDoc = existingDocs.find(
    d => d.originalName === originalName && d.collectionId === collectionId && d.status === 'ready'
  );

  // Content deduplication: if a document with identical content already exists in this
  // collection (regardless of filename), reject the upload to prevent duplicate chunks.
  const contentHash = createHash('sha256').update(fileBuffer).digest('hex');
  const duplicateByContent = existingDocs.find(
    d => d.contentHash === contentHash && d.collectionId === collectionId && d.status === 'ready' && d.id !== existingDoc?.id
  );
  if (duplicateByContent) {
    throw new Error(
      `A document with identical content already exists in this collection: "${duplicateByContent.originalName}". ` +
      `Delete the existing document first if you want to re-upload.`
    );
  }

  // Create document record
  const document: Document = {
    id: documentId,
    filename,
    originalName,
    mimeType,
    sizeBytes: fileBuffer.length,
    s3Key,
    collectionId,
    uploadedBy,
    uploadedAt: new Date().toISOString(),
    status: 'uploading',
    chunkCount: 0,
    version: existingDoc ? existingDoc.version + 1 : 1,
    previousVersionId: existingDoc?.id,
    contentHash,
  };

  // Track whether chunks were added to the vector store (for rollback on error)
  let chunksAddedToStore = false;

  try {
    // Step 0.5: Strip image metadata (EXIF, IPTC, XMP) — HIPAA defense-in-depth.
    // Camera phones embed GPS, timestamps, and device info that could identify patients.
    // Visible image content (pixels) is preserved; only hidden metadata is removed.
    const stripResult = await stripImageMetadata(fileBuffer, mimeType, originalName);
    if (stripResult.stripped && stripResult.metadataFound) {
      fileBuffer = stripResult.buffer;
      document.sizeBytes = stripResult.strippedSize;
      logger.info('Ingestion: Image metadata stripped before storage', {
        documentId, originalSize: stripResult.originalSize, strippedSize: stripResult.strippedSize,
      });
    }

    // Step 1: Upload original file to S3
    logger.info('Ingestion: Uploading to S3', { documentId, originalName });
    await uploadDocumentToS3(fileBuffer, s3Key, mimeType);
    document.status = 'processing';

    // Step 2: Extract text
    logger.info('Ingestion: Extracting text', { documentId });
    const extracted = await extractText(fileBuffer, mimeType, originalName);

    if (!extracted.text.trim()) {
      throw new Error('No text could be extracted from the document');
    }

    // Step 2b: For PDFs, use vision to describe images/diagrams and append to text
    if (mimeType === 'application/pdf') {
      logger.info('Ingestion: Extracting image descriptions via vision', { documentId });
      const imageDescriptions = await extractImageDescriptions(fileBuffer, originalName);
      if (imageDescriptions) {
        extracted.text += imageDescriptions;
      }
    }

    // Step 3: Chunk text
    logger.info('Ingestion: Chunking document', { documentId });
    const chunks = chunkDocument(documentId, extracted);

    if (chunks.length === 0) {
      throw new Error('Document produced no chunks after processing');
    }

    // Step 4: Generate embeddings (with content-hash dedup for embedding reuse)
    // Adapted from Observatory QA: hash each chunk's text, look up existing embeddings
    // for identical content across documents, and skip redundant Bedrock API calls.
    logger.info('Ingestion: Generating embeddings', { documentId, chunkCount: chunks.length });
    const texts = chunks.map(c => c.text);
    const chunkHashes = texts.map(t => createHash('sha256').update(t).digest('hex'));

    // Check for existing chunks with same content hash — reuse their embeddings
    const existingEmbeddings = new Map<string, number[]>();
    try {
      const { useRds } = await import('../db/index');
      if (await useRds()) {
        const { getPool } = await import('../config/database');
        const pool = getPool();
        const uniqueHashes = [...new Set(chunkHashes)];
        if (uniqueHashes.length > 0) {
          const result = await pool.query(
            `SELECT content_hash, embedding FROM chunks WHERE content_hash = ANY($1) AND embedding IS NOT NULL LIMIT $2`,
            [uniqueHashes, uniqueHashes.length]
          );
          for (const row of result.rows) {
            if (row.content_hash && row.embedding) {
              existingEmbeddings.set(row.content_hash, row.embedding);
            }
          }
          if (existingEmbeddings.size > 0) {
            logger.info('Ingestion: Reusing embeddings for duplicate chunks', {
              documentId, reused: existingEmbeddings.size, total: chunks.length,
            });
          }
        }
      }
    } catch {
      // Non-fatal — proceed with fresh embeddings for all chunks
    }

    // Only generate embeddings for chunks without cached embeddings
    const textsToEmbed: string[] = [];
    const embedIndexMap: number[] = [];
    for (let i = 0; i < chunks.length; i++) {
      if (!existingEmbeddings.has(chunkHashes[i])) {
        embedIndexMap.push(i);
        textsToEmbed.push(texts[i]);
      }
    }

    const freshEmbeddings = textsToEmbed.length > 0 ? await generateEmbeddingsBatch(textsToEmbed) : [];

    // Merge fresh + cached embeddings
    const embeddings: number[][] = [];
    let freshIdx = 0;
    for (let i = 0; i < chunks.length; i++) {
      const cached = existingEmbeddings.get(chunkHashes[i]);
      if (cached) {
        embeddings.push(cached);
      } else {
        embeddings.push(freshEmbeddings[freshIdx++]);
      }
    }

    // Step 5: Store in vector store
    logger.info('Ingestion: Adding to vector store', { documentId });
    await addChunksToStore(chunks, embeddings);
    chunksAddedToStore = true;

    // Step 6 & 7: Update document index atomically under mutex lock
    // This prevents concurrent uploads from reading stale index, both appending,
    // and the second save overwriting the first document's entry.
    await withIndexLock(async () => {
      // Re-read index inside the lock to get the latest state
      const freshDocs = await getDocumentsIndex();

      // If re-uploading, remove old document chunks and mark as replaced
      if (existingDoc) {
        logger.info('Ingestion: Removing previous version chunks', {
          documentId,
          previousVersionId: existingDoc.id,
        });
        await removeDocumentChunks(existingDoc.id);

        // Mark old version as replaced in the fresh index
        const idx = freshDocs.findIndex(d => d.id === existingDoc.id);
        if (idx !== -1) {
          freshDocs[idx].status = 'replaced';
          freshDocs[idx].errorMessage = `Replaced by version ${document.version} (${documentId})`;
        }

        // Log audit trail for document replacement
        logAuditEvent(uploadedBy, uploadedBy, 'document_replaced', {
          documentId,
          previousVersionId: existingDoc.id,
          previousVersion: existingDoc.version,
          newVersion: document.version,
          originalName,
          collectionId,
        }).catch(err => logger.warn('Failed to log replacement audit event', { error: String(err) }));
      }

      // Append new document to index
      document.status = 'ready';
      document.chunkCount = chunks.length;
      freshDocs.push(document);
      await saveDocumentsIndex(freshDocs);
    });

    logger.info('Ingestion: Complete', {
      documentId,
      originalName,
      chunkCount: chunks.length,
      version: document.version,
    });

    return { document, chunkCount: chunks.length };
  } catch (error) {
    // Roll back vector store chunks if they were added before the failure
    if (chunksAddedToStore) {
      try {
        logger.info('Ingestion: Rolling back vector store chunks after failure', { documentId });
        await removeDocumentChunks(documentId);
      } catch (rollbackError) {
        logger.error('Ingestion: Failed to roll back chunks — orphaned chunks may exist', {
          documentId,
          rollbackError: String(rollbackError),
        });
      }
    }

    document.status = 'error';
    document.errorMessage = error instanceof Error ? error.message : String(error);

    // Save the failed document record so users can see what happened (under lock)
    await withIndexLock(async () => {
      const docs = await getDocumentsIndex();
      docs.push(document);
      await saveDocumentsIndex(docs);
    });

    logger.error('Ingestion failed', {
      documentId,
      originalName,
      error: document.errorMessage,
    });

    throw error;
  }
}
