/**
 * Batch Inference Scheduler (Phase C).
 *
 * Drives the lifecycle of Bedrock batch jobs:
 *   0. Promote any files stranded in orphaned-submissions/ back to active-jobs/
 *   1. Poll active batch jobs; on completion read results + fire registered handler
 *   2. If enough pending items exist (≥ MIN_BATCH_SIZE, or oldest aged past 2×
 *      interval), collect them and submit a new batch job
 *
 * A separate orphan-recovery loop marks jobs "abandoned" when they've been
 * awaiting a batch result for longer than ORPHAN_THRESHOLD_MS — the extraction
 * pipeline (follow-up PR) will register a handler that updates the
 * corresponding jobQueue job so users see a clear failure status.
 *
 * This module is pure infrastructure: it does NOT know about the jobQueue,
 * extraction, or any other RAG subsystem. Integration is via the
 * `setBatchResultHandler` API, which a caller invokes at server startup to
 * register a callback for per-item results.
 */

import {
  isBatchModeAvailable,
  createBatchInput,
  createJob,
  getJobStatus,
  readBatchOutput,
  listPendingItemKeys,
  downloadPendingItem,
  deletePendingItem,
  writeActiveJob,
  writeOrphanedSubmission,
  listActiveJobKeys,
  listOrphanedSubmissionKeys,
  downloadJob,
  deleteObjectKey,
  type PendingBatchItem,
  type BatchJob,
  type BatchResultEntry,
} from './bedrockBatch';
import { logger } from '../utils/logger';

const MIN_BATCH_SIZE = 5;
const ORPHAN_CHECK_INTERVAL_MS = 30 * 60 * 1000; // 30 min
const ORPHAN_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours

// Timer handles — nullable so stop() is idempotent. Every timer .unref()'d
// per INV-30 parity (CA convention) so a lingering tick can't pin the event
// loop open past graceful shutdown.
let batchCycleTimeout: ReturnType<typeof setTimeout> | null = null;
let batchCycleInterval: ReturnType<typeof setInterval> | null = null;
let orphanCheckTimeout: ReturnType<typeof setTimeout> | null = null;
let orphanCheckInterval: ReturnType<typeof setInterval> | null = null;

// Guard against concurrent cycles: setInterval fires regardless of whether
// the prior async cycle has finished. A slow S3 walk could otherwise double-
// run + double-submit a batch.
let batchCycleRunning = false;

// ---------------------------------------------------------------------------
// Result handler registration
// ---------------------------------------------------------------------------

export interface BatchResultContext {
  job: BatchJob;
  pendingItem: PendingBatchItem | null;
  result: BatchResultEntry;
}

export type BatchResultHandler = (ctx: BatchResultContext) => Promise<void> | void;

let resultHandler: BatchResultHandler | null = null;

/**
 * Register the callback invoked for each processed batch output record. The
 * extraction pipeline (follow-up PR) will use this to update jobQueue state
 * from within the scheduler without the scheduler needing to import jobQueue.
 *
 * Passing `null` clears the handler. Safe to call before or after `start`.
 */
export function setBatchResultHandler(handler: BatchResultHandler | null): void {
  resultHandler = handler;
}

// ---------------------------------------------------------------------------
// Core cycle
// ---------------------------------------------------------------------------

/**
 * Process a completed batch job: read results from S3, fire the result handler
 * per item, delete pending items, delete the active-job tracking file.
 */
async function processCompletedJob(job: BatchJob, jobKey: string): Promise<void> {
  const results = await readBatchOutput(job.outputS3Uri);
  logger.info('Batch job completed, processing results', {
    jobId: job.jobId,
    resultCount: results.size,
  });

  for (const [itemId, result] of results) {
    try {
      const pendingKey = `batch-inference/pending/${itemId}.json`;
      const pendingItem = await downloadPendingItem(pendingKey);

      if (resultHandler) {
        try {
          await resultHandler({ job, pendingItem, result });
        } catch (err) {
          logger.warn('Batch result handler threw', {
            itemId,
            error: (err as Error).message,
          });
        }
      }
    } finally {
      try {
        await deletePendingItem(itemId);
      } catch (err) {
        logger.warn('Batch: failed to delete pending item', {
          itemId,
          error: (err as Error).message,
        });
      }
    }
  }

  // CA parity (F2): callIds in the submitted batch but absent from the
  // output are marked as missing so the handler can transition their
  // jobQueue state to failed rather than stranding them until orphan
  // recovery catches them.
  const processedIds = new Set(results.keys());
  for (const itemId of job.itemIds) {
    if (processedIds.has(itemId)) continue;
    logger.warn('Batch: submitted itemId missing from output, notifying handler', {
      itemId,
      jobId: job.jobId,
    });
    if (resultHandler) {
      try {
        await resultHandler({
          job,
          pendingItem: null,
          result: {
            itemId,
            text: '',
            error: 'Batch: result missing from output',
          },
        });
      } catch (err) {
        logger.warn('Batch result handler threw on missing-output item', {
          itemId,
          error: (err as Error).message,
        });
      }
    }
    try {
      await deletePendingItem(itemId);
    } catch {
      // best-effort
    }
  }

  await deleteObjectKey(jobKey);
}

async function processFailedJob(
  job: BatchJob,
  jobKey: string,
  reason: string,
): Promise<void> {
  logger.error('Batch job failed', { jobId: job.jobId, reason });
  for (const itemId of job.itemIds) {
    if (resultHandler) {
      try {
        await resultHandler({
          job,
          pendingItem: null,
          result: { itemId, text: '', error: `Batch job ${reason}` },
        });
      } catch (err) {
        logger.warn('Batch result handler threw on failed-job item', {
          itemId,
          error: (err as Error).message,
        });
      }
    }
    try {
      await deletePendingItem(itemId);
    } catch {
      // best-effort
    }
  }
  await deleteObjectKey(jobKey);
}

/**
 * Scan the orphaned-submissions/ prefix and promote any surviving tracking
 * files back into active-jobs/. Called at the top of each batch cycle so the
 * next run after a transient S3 failure self-heals.
 */
async function promoteOrphanedSubmissions(): Promise<void> {
  try {
    const orphanKeys = await listOrphanedSubmissionKeys();
    if (orphanKeys.length === 0) return;
    for (const key of orphanKeys) {
      try {
        const job = await downloadJob(key);
        if (!job?.jobId) {
          logger.warn('Batch: orphaned-submissions entry missing jobId, skipping', {
            key,
          });
          continue;
        }
        await writeActiveJob(job);
        await deleteObjectKey(key);
        logger.info('Batch: promoted orphaned submission to active-jobs', {
          jobId: job.jobId,
        });
      } catch (err) {
        logger.warn('Batch: failed to promote orphaned submission (retry next cycle)', {
          key,
          error: (err as Error).message,
        });
      }
    }
  } catch (err) {
    logger.warn('Batch: failed to list orphaned-submissions prefix', {
      error: (err as Error).message,
    });
  }
}

/**
 * Persist the batch-job tracking file with retry + orphan fallback. By the
 * time we get here the AWS job is running and billable — losing the tracking
 * file means the job runs invisibly. Recovery (in order):
 *   1. Retry primary write 3x with exponential backoff (1s, 2s, 4s)
 *   2. Fall back to orphaned-submissions/ so the job is still findable in S3
 *   3. In ALL failure paths, escalate via logger.error with jobId + jobArn
 */
async function persistBatchJobTracking(
  batchJob: BatchJob,
  itemCount: number,
): Promise<void> {
  const RETRIES = 3;
  const BASE_DELAY_MS = 1000;

  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      await writeActiveJob(batchJob);
      logger.info('Batch: submitted job', {
        jobId: batchJob.jobId,
        itemCount,
        attempt,
      });
      return;
    } catch (err) {
      const isLast = attempt === RETRIES;
      logger.warn('Batch: tracking-file write failed', {
        jobId: batchJob.jobId,
        attempt,
        isLast,
        error: (err as Error).message,
      });
      if (!isLast) {
        await new Promise((resolve) =>
          setTimeout(resolve, BASE_DELAY_MS * Math.pow(2, attempt - 1)),
        );
      }
    }
  }

  // Primary retries exhausted — fall back to the orphan prefix.
  try {
    await writeOrphanedSubmission(batchJob, {
      itemCount,
      reason: 'primary_write_failed',
    });
    logger.error(
      'Batch: tracking-file fell back to orphan prefix — next cycle will promote',
      { jobId: batchJob.jobId },
    );
    escalateOrphanedJob(batchJob, 'primary_write_failed_orphan_fallback');
  } catch (err) {
    logger.error(
      'Batch: tracking-file orphan fallback also failed — job NOT discoverable in S3',
      {
        jobId: batchJob.jobId,
        jobArn: batchJob.jobArn,
        error: (err as Error).message,
      },
    );
    escalateOrphanedJob(batchJob, 'primary_and_orphan_write_failed');
  }
}

function escalateOrphanedJob(batchJob: BatchJob, reason: string): void {
  logger.error(
    'batch-orphan-escalation: tracking-file write failed — job invisible to RAG',
    {
      alert: 'batch_orphan_escalation',
      reason,
      jobId: batchJob.jobId,
      jobArn: batchJob.jobArn,
      recoveryHint: `Manually reconstruct batch-inference/active-jobs/${batchJob.jobId}.json with the BatchJob shape from the AWS console.`,
    },
  );
}

/**
 * Single batch cycle: promote orphans → check active jobs → submit pending.
 * Exported for manual admin triggers / tests.
 */
export async function runBatchCycle(): Promise<void> {
  if (batchCycleRunning) {
    logger.info('Batch: previous cycle still running, skipping');
    return;
  }
  batchCycleRunning = true;
  try {
    const batchIntervalMinutes = parseInt(
      process.env.BATCH_INTERVAL_MINUTES || '15',
      10,
    );

    // 0. Promote orphans so a newly-promoted file is picked up in step 1.
    await promoteOrphanedSubmissions();

    // 1. Check active jobs
    const activeJobKeys = await listActiveJobKeys();
    for (const jobKey of activeJobKeys) {
      try {
        const job = await downloadJob(jobKey);
        if (!job) continue;
        const status = await getJobStatus(job.jobArn);
        logger.info('Batch job status', {
          jobId: job.jobId,
          status: status.status,
        });
        if (status.status === 'Completed') {
          await processCompletedJob(job, jobKey);
        } else if (
          status.status === 'Failed' ||
          status.status === 'Stopped' ||
          status.status === 'Expired'
        ) {
          await processFailedJob(job, jobKey, status.message || status.status);
        }
        // Submitted / InProgress / Scheduled / Validating / Stopping: keep waiting
      } catch (err) {
        logger.warn('Batch: error checking job status', {
          error: (err as Error).message,
        });
      }
    }

    // 2. Collect pending items and submit if threshold met
    const pendingKeys = await listPendingItemKeys();
    if (pendingKeys.length === 0) return;

    if (pendingKeys.length < MIN_BATCH_SIZE) {
      // Head-of-queue age check: submit an under-threshold batch if the oldest
      // item has been sitting for longer than 2× the normal interval, so low-
      // volume tenants don't wait forever for MIN_BATCH_SIZE.
      const oldest = await downloadPendingItem(pendingKeys[0]);
      if (oldest) {
        const age = Date.now() - new Date(oldest.timestamp).getTime();
        if (age < batchIntervalMinutes * 60 * 1000 * 2) {
          logger.info('Batch: below threshold, waiting', {
            pendingCount: pendingKeys.length,
            threshold: MIN_BATCH_SIZE,
          });
          return;
        }
      }
    }

    logger.info('Batch: collecting pending items for submission', {
      pendingCount: pendingKeys.length,
    });
    const items: PendingBatchItem[] = [];
    for (const key of pendingKeys) {
      const data = await downloadPendingItem(key);
      if (data?.itemId && data?.prompt) {
        items.push(data);
      } else {
        logger.warn('Batch: skipping invalid pending item', { key });
      }
    }
    if (items.length === 0) return;

    const { s3Uri, batchId } = await createBatchInput(items);
    const itemIds = items.map((i) => i.itemId);
    const batchJob = await createJob(s3Uri, batchId, itemIds);

    // The AWS job is now running and billable. Persist the tracking file
    // with retry + orphan fallback so a transient S3 hiccup doesn't strand it.
    await persistBatchJobTracking(batchJob, items.length);
  } catch (err) {
    logger.error('Batch cycle error', { error: (err as Error).message });
  } finally {
    batchCycleRunning = false;
  }
}

/**
 * Recover pending items stuck with no active job. Items age-out at 2 hours,
 * which means something went wrong (crash between enqueue and submit, or a
 * submission that never produced output). Calls the result handler with a
 * synthesized "abandoned" error per item so the jobQueue can transition the
 * owning job to failed.
 */
export async function recoverOrphanedPendingItems(): Promise<void> {
  try {
    const pendingKeys = await listPendingItemKeys();
    if (pendingKeys.length === 0) return;

    // Build a set of all item IDs currently in-flight in any active job so
    // we don't accidentally fail items that ARE being processed.
    const activeItemIds = new Set<string>();
    const activeJobKeys = await listActiveJobKeys();
    for (const jobKey of activeJobKeys) {
      const job = await downloadJob(jobKey);
      if (job) for (const id of job.itemIds) activeItemIds.add(id);
    }

    let recovered = 0;
    for (const key of pendingKeys) {
      const item = await downloadPendingItem(key);
      if (!item) continue;
      if (activeItemIds.has(item.itemId)) continue;

      const age = Date.now() - new Date(item.timestamp).getTime();
      if (age <= ORPHAN_THRESHOLD_MS) continue;

      if (resultHandler) {
        try {
          await resultHandler({
            job: {
              jobId: 'orphan-recovery',
              jobArn: '',
              status: 'Failed',
              inputS3Uri: '',
              outputS3Uri: '',
              itemIds: [item.itemId],
              createdAt: new Date().toISOString(),
            },
            pendingItem: item,
            result: {
              itemId: item.itemId,
              text: '',
              error: 'Batch: orphaned — no active job and aged past threshold',
            },
          });
        } catch (err) {
          logger.warn('Batch: orphan recovery handler threw', {
            itemId: item.itemId,
            error: (err as Error).message,
          });
        }
      }
      try {
        await deletePendingItem(item.itemId);
        recovered++;
      } catch {
        // best-effort
      }
    }

    if (recovered > 0) {
      logger.warn('Batch: recovered orphaned pending items', { count: recovered });
    }
  } catch (err) {
    logger.warn('Batch: orphan recovery error', { error: (err as Error).message });
  }
}

// ---------------------------------------------------------------------------
// Start / stop
// ---------------------------------------------------------------------------

/**
 * Start the scheduler. No-op when batch mode is not available (env-misconfigured
 * or disabled). Safe to call multiple times — subsequent calls are idempotent.
 */
export function startBatchScheduler(): void {
  if (!isBatchModeAvailable()) {
    logger.info('Batch scheduler: batch mode disabled (env-guard failed)');
    return;
  }
  if (batchCycleInterval || batchCycleTimeout) {
    // Already running
    return;
  }

  const intervalMinutes = parseInt(process.env.BATCH_INTERVAL_MINUTES || '15', 10);
  logger.info('Batch scheduler started', { intervalMinutes });

  // First run after 1 minute, then on interval. `.unref()` so a lingering
  // timer doesn't keep the event loop alive past graceful shutdown.
  batchCycleTimeout = setTimeout(() => {
    runBatchCycle().catch((err) =>
      logger.error('Batch: initial cycle failed', { error: String(err) }),
    );
  }, 60_000);
  batchCycleTimeout.unref();
  batchCycleInterval = setInterval(() => {
    runBatchCycle().catch((err) =>
      logger.error('Batch: cycle failed', { error: String(err) }),
    );
  }, intervalMinutes * 60 * 1000);
  batchCycleInterval.unref();

  // Orphan recovery: first after 5 min, then every 30 min.
  orphanCheckTimeout = setTimeout(() => {
    recoverOrphanedPendingItems().catch((err) =>
      logger.error('Batch: initial orphan-recovery failed', { error: String(err) }),
    );
  }, 5 * 60 * 1000);
  orphanCheckTimeout.unref();
  orphanCheckInterval = setInterval(() => {
    recoverOrphanedPendingItems().catch((err) =>
      logger.error('Batch: orphan-recovery failed', { error: String(err) }),
    );
  }, ORPHAN_CHECK_INTERVAL_MS);
  orphanCheckInterval.unref();
}

/** Stop all scheduler timers. Idempotent. */
export function stopBatchScheduler(): void {
  if (batchCycleTimeout) {
    clearTimeout(batchCycleTimeout);
    batchCycleTimeout = null;
  }
  if (batchCycleInterval) {
    clearInterval(batchCycleInterval);
    batchCycleInterval = null;
  }
  if (orphanCheckTimeout) {
    clearTimeout(orphanCheckTimeout);
    orphanCheckTimeout = null;
  }
  if (orphanCheckInterval) {
    clearInterval(orphanCheckInterval);
    orphanCheckInterval = null;
  }
  logger.info('Batch scheduler stopped');
}

// ---------------------------------------------------------------------------
// Admin status snapshot
// ---------------------------------------------------------------------------

export interface BatchStatusSnapshot {
  enabled: boolean;
  intervalMinutes: number;
  pending: number;
  active: Array<{ jobId: string; createdAt: string; itemCount: number }>;
  orphanedSubmissions: number;
}

/**
 * Return a cheap status summary for the admin dashboard. Does NOT call Bedrock
 * — only reads S3 keys. Safe to poll every few seconds.
 */
export async function getBatchStatus(): Promise<BatchStatusSnapshot> {
  const enabled = isBatchModeAvailable();
  const intervalMinutes = parseInt(process.env.BATCH_INTERVAL_MINUTES || '15', 10);
  if (!enabled) {
    return { enabled: false, intervalMinutes, pending: 0, active: [], orphanedSubmissions: 0 };
  }

  const [pendingKeys, activeKeys, orphanKeys] = await Promise.all([
    listPendingItemKeys(),
    listActiveJobKeys(),
    listOrphanedSubmissionKeys(),
  ]);

  const active: Array<{ jobId: string; createdAt: string; itemCount: number }> = [];
  for (const key of activeKeys) {
    const job = await downloadJob(key);
    if (job) {
      active.push({
        jobId: job.jobId,
        createdAt: job.createdAt,
        itemCount: job.itemIds.length,
      });
    }
  }

  return {
    enabled: true,
    intervalMinutes,
    pending: pendingKeys.length,
    active,
    orphanedSubmissions: orphanKeys.length,
  };
}
