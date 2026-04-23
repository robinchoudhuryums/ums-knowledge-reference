import { createHash } from 'crypto';
import { getDocumentsIndex, saveDocumentsIndex, getDocumentFromS3 } from './s3Storage';
import { ingestDocument } from './ingestion';
import { logger } from '../utils/logger';
import { sendOperationalAlert } from './alertService';

// Check interval: every 6 hours (in ms)
const REINDEX_INTERVAL = 6 * 60 * 60 * 1000;

let reindexTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Check all ready documents for changes by comparing stored content hash
 * with the current S3 object hash. Re-ingest if changed.
 */
export async function checkForChanges(): Promise<{ checked: number; reindexed: string[] }> {
  const docs = await getDocumentsIndex();
  const readyDocs = docs.filter(d => d.status === 'ready' && d.contentHash);

  const reindexed: string[] = [];

  for (const doc of readyDocs) {
    try {
      const fileBuffer = await getDocumentFromS3(doc.s3Key);
      const currentHash = createHash('sha256').update(fileBuffer).digest('hex');

      if (currentHash !== doc.contentHash) {
        logger.info('Re-indexing: document content changed', {
          documentId: doc.id,
          originalName: doc.originalName,
          oldHash: doc.contentHash?.slice(0, 12),
          newHash: currentHash.slice(0, 12),
        });

        await ingestDocument(
          fileBuffer,
          doc.originalName,
          doc.mimeType,
          doc.collectionId,
          doc.uploadedBy
        );

        reindexed.push(doc.originalName);
      }
    } catch (error) {
      logger.warn('Re-indexing: failed to check/re-ingest document', {
        documentId: doc.id,
        originalName: doc.originalName,
        error: String(error),
      });
      // Mark document as stale so users know the content may be outdated
      try {
        const allDocs = await getDocumentsIndex();
        const idx = allDocs.findIndex(d => d.id === doc.id);
        if (idx !== -1) {
          allDocs[idx].errorMessage = `Re-index failed: ${(error as Error).message || String(error)}`;
          await saveDocumentsIndex(allDocs);
        }
      } catch {
        // Best-effort — don't cascade failures from status update
      }
      // Send operational alert (throttled to 1/hour)
      sendOperationalAlert('reindex_failed', `Document re-index failed: ${doc.originalName}`, {
        documentId: doc.id,
        originalName: doc.originalName,
        error: String(error),
      }).catch(() => {});
    }
  }

  if (reindexed.length > 0) {
    logger.info('Re-indexing complete', {
      checked: readyDocs.length,
      reindexed: reindexed.length,
      documents: reindexed,
    });
  }

  return { checked: readyDocs.length, reindexed };
}

/**
 * Start the periodic re-indexing background check.
 */
export function startReindexScheduler(): void {
  if (reindexTimer) return;

  logger.info('Re-index scheduler started', {
    intervalHours: REINDEX_INTERVAL / (60 * 60 * 1000),
  });

  reindexTimer = setInterval(async () => {
    try {
      logger.info('Re-index scheduler: checking for document changes');
      await checkForChanges();
    } catch (error) {
      logger.error('Re-index scheduler: check failed', { error: String(error) });
    }
  }, REINDEX_INTERVAL);
  reindexTimer.unref();
}

/**
 * Stop the periodic re-indexing scheduler.
 */
export function stopReindexScheduler(): void {
  if (reindexTimer) {
    clearInterval(reindexTimer);
    reindexTimer = null;
    logger.info('Re-index scheduler stopped');
  }
}
