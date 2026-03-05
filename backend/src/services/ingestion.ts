import { v4 as uuidv4 } from 'uuid';
import { Document } from '../types';
import { S3_PREFIXES } from '../config/aws';
import {
  uploadDocumentToS3,
  getDocumentFromS3,
  getDocumentsIndex,
  saveDocumentsIndex,
} from './s3Storage';
import { extractText } from './textExtractor';
import { extractImageDescriptions } from './visionExtractor';
import { chunkDocument } from './chunker';
import { generateEmbeddingsBatch } from './embeddings';
import { addChunksToStore, removeDocumentChunks } from './vectorStore';
import { logger } from '../utils/logger';

export interface UploadResult {
  document: Document;
  chunkCount: number;
}

/**
 * Full document ingestion pipeline:
 * 1. Upload original file to S3
 * 2. Extract text
 * 3. Chunk text
 * 4. Generate embeddings
 * 5. Store in vector store
 * 6. Update document index
 */
export async function ingestDocument(
  fileBuffer: Buffer,
  originalName: string,
  mimeType: string,
  collectionId: string,
  uploadedBy: string
): Promise<UploadResult> {
  const documentId = uuidv4();
  const extension = originalName.split('.').pop() || '';
  const filename = `${documentId}.${extension}`;
  const s3Key = `${S3_PREFIXES.documents}${collectionId}/${filename}`;

  // Check if this is a re-upload (same name in same collection)
  const existingDocs = await getDocumentsIndex();
  const existingDoc = existingDocs.find(
    d => d.originalName === originalName && d.collectionId === collectionId && d.status === 'ready'
  );

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
  };

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

    // Step 6: If re-uploading, remove old document chunks
    if (existingDoc) {
      logger.info('Ingestion: Removing previous version chunks', {
        documentId,
        previousVersionId: existingDoc.id,
      });
      await removeDocumentChunks(existingDoc.id);

      // Mark old version as replaced
      const idx = existingDocs.findIndex(d => d.id === existingDoc.id);
      if (idx !== -1) {
        existingDocs[idx].status = 'error';
        existingDocs[idx].errorMessage = `Replaced by version ${document.version} (${documentId})`;
      }
    }

    // Step 7: Update document index
    document.status = 'ready';
    document.chunkCount = chunks.length;
    existingDocs.push(document);
    await saveDocumentsIndex(existingDocs);

    logger.info('Ingestion: Complete', {
      documentId,
      originalName,
      chunkCount: chunks.length,
      version: document.version,
    });

    return { document, chunkCount: chunks.length };
  } catch (error) {
    document.status = 'error';
    document.errorMessage = error instanceof Error ? error.message : String(error);

    // Save the failed document record so users can see what happened
    const docs = await getDocumentsIndex();
    docs.push(document);
    await saveDocumentsIndex(docs);

    logger.error('Ingestion failed', {
      documentId,
      originalName,
      error: document.errorMessage,
    });

    throw error;
  }
}
