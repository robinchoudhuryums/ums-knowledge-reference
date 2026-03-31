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

    // Step 4: Generate embeddings
    logger.info('Ingestion: Generating embeddings', { documentId, chunkCount: chunks.length });
    const texts = chunks.map(c => c.text);
    const embeddings = await generateEmbeddingsBatch(texts);

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
