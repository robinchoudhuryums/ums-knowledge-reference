/**
 * Extraction Batch Result Handler.
 *
 * Registered at server startup via setBatchResultHandler. Called by the
 * scheduler once per batch output record. Maps the result back to the
 * originating jobQueue job and transitions it to completed/failed.
 *
 * Metadata schema carried on each PendingBatchItem from the extraction route:
 *   - kind: 'extraction' (scope guard — future wires can share the queue)
 *   - jobId: jobQueue job id
 *   - templateId: extraction template id
 *   - userId: authenticated user id (for audit)
 *   - username: authenticated username (for audit)
 *   - filename: original upload filename (for audit + job result)
 */

import { updateJob } from './jobQueue';
import { finalizeExtractionFromResponse } from './documentExtractor';
import { logAuditEvent } from './audit';
import { getTemplateById } from './extractionTemplates';
import { setBatchResultHandler, type BatchResultContext } from './batchScheduler';
import { logger } from '../utils/logger';

interface ExtractionBatchMetadata {
  kind?: string;
  jobId?: string;
  templateId?: string;
  userId?: string;
  username?: string;
  filename?: string;
}

function readMetadata(ctx: BatchResultContext): ExtractionBatchMetadata {
  const raw = ctx.pendingItem?.metadata ?? {};
  return raw as ExtractionBatchMetadata;
}

/**
 * The actual result callback. Exported for direct unit testing without
 * going through the scheduler registration.
 */
export async function handleExtractionBatchResult(ctx: BatchResultContext): Promise<void> {
  const meta = readMetadata(ctx);
  if (meta.kind !== 'extraction') {
    // Not ours — a future wire-in (clinical note extraction, etc.) can use
    // its own `kind` and register a chained handler.
    return;
  }

  const jobId = meta.jobId;
  if (!jobId) {
    logger.warn('extractionBatchHandler: metadata missing jobId, dropping result', {
      itemId: ctx.result.itemId,
    });
    return;
  }

  // Batch error OR missing-output — surface to the job as a sanitized failure.
  if (ctx.result.error) {
    logger.warn('extractionBatchHandler: batch item failed', {
      jobId,
      itemId: ctx.result.itemId,
      error: ctx.result.error,
    });
    updateJob(jobId, {
      status: 'failed',
      completedAt: new Date().toISOString(),
      error: 'Extraction service temporarily unavailable. Please try again later.',
      progress: undefined,
    });
    return;
  }

  if (!meta.templateId) {
    logger.warn('extractionBatchHandler: metadata missing templateId', { jobId });
    updateJob(jobId, {
      status: 'failed',
      completedAt: new Date().toISOString(),
      error: 'Extraction metadata incomplete — please resubmit.',
    });
    return;
  }

  // Parse the batch-output text the same way the sync path would.
  try {
    const result = finalizeExtractionFromResponse(ctx.result.text, meta.templateId);
    updateJob(jobId, {
      status: 'completed',
      completedAt: new Date().toISOString(),
      result,
      progress: 100,
    });

    // Audit — mirrors the sync async-extraction audit entry so the two paths
    // are indistinguishable in the HIPAA log except by the "batch" modelUsed
    // marker and the delivery timing.
    if (meta.userId && meta.username) {
      const template = getTemplateById(meta.templateId);
      try {
        await logAuditEvent(meta.userId, meta.username, 'ocr', {
          operation: 'extraction-async-batch',
          filename: meta.filename || '(unknown)',
          templateId: meta.templateId,
          templateName: template?.name || meta.templateId,
          confidence: result.confidence,
          modelUsed: result.modelUsed,
          jobId,
        });
      } catch (auditErr) {
        logger.warn('extractionBatchHandler: audit write failed', {
          jobId,
          error: (auditErr as Error).message,
        });
      }
    }

    logger.info('extractionBatchHandler: job completed from batch result', {
      jobId,
      templateId: meta.templateId,
      confidence: result.confidence,
    });
  } catch (err) {
    logger.error('extractionBatchHandler: finalize threw, marking job failed', {
      jobId,
      error: (err as Error).message,
    });
    updateJob(jobId, {
      status: 'failed',
      completedAt: new Date().toISOString(),
      error: 'Extraction result could not be parsed. Please retry.',
      progress: undefined,
    });
  }
}

/**
 * Register the extraction handler. Call once at server startup, after the
 * batch scheduler has been started. Idempotent — re-registering overwrites
 * the prior handler.
 */
export function registerExtractionBatchHandler(): void {
  setBatchResultHandler(handleExtractionBatchResult);
  logger.info('Extraction batch handler registered');
}
