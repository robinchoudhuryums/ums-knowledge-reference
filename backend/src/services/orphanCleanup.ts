/**
 * Orphan Cleanup Service — periodically checks for documents stuck in
 * 'uploading' or 'processing' status for more than 24 hours and marks
 * them as 'error' so they don't block the UI or waste resources.
 */

import { getDocumentsIndex, saveDocumentsIndex } from '../db';
import { removeDocumentChunks } from './vectorStore';
import { logger } from '../utils/logger';

const ORPHAN_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // every 1 hour


/**
 * Check for and clean up orphaned documents.
 * Returns the number of documents cleaned up.
 */
export async function cleanupOrphanedDocuments(): Promise<number> {
  const docs = await getDocumentsIndex();
  const now = Date.now();
  let cleaned = 0;

  for (const doc of docs) {
    if (doc.status !== 'uploading' && doc.status !== 'processing') continue;

    const uploadedAt = new Date(doc.uploadedAt).getTime();
    if (now - uploadedAt < ORPHAN_THRESHOLD_MS) continue;

    // This document has been stuck for over 24 hours — mark as error
    doc.status = 'error';
    doc.errorMessage = `Orphaned: stuck in processing for over 24 hours (since ${doc.uploadedAt})`;

    // Remove any partial chunks that may have been added
    try {
      await removeDocumentChunks(doc.id);
    } catch {
      // Chunks may not exist yet — that's fine
    }

    logger.warn('Orphaned document cleaned up', {
      documentId: doc.id,
      originalName: doc.originalName,
      status: doc.status,
      uploadedAt: doc.uploadedAt,
    });

    cleaned++;
  }

  if (cleaned > 0) {
    await saveDocumentsIndex(docs);
    logger.info(`Orphan cleanup: marked ${cleaned} document(s) as error`);
  }

  return cleaned;
}

/**
 * Start the background orphan cleanup scheduler.
 */
export function startOrphanCleanup(): void {
  // Run once on startup (after a short delay to let initialization complete)
  setTimeout(() => {
    cleanupOrphanedDocuments().catch(err =>
      logger.error('Orphan cleanup failed', { error: String(err) })
    );
  }, 30_000);

  // Then run every hour
  setInterval(() => {
    cleanupOrphanedDocuments().catch(err =>
      logger.error('Orphan cleanup failed', { error: String(err) })
    );
  }, CHECK_INTERVAL_MS);

  logger.info('Orphan cleanup scheduler started (every 1 hour)');
}
