/**
 * Job Queue Service — async document processing with S3 persistence.
 *
 * Jobs are stored in memory (Map) for fast access and periodically persisted
 * to S3 so they survive server restarts. On startup, any persisted jobs are
 * reloaded. Completed/failed jobs older than 1 hour are cleaned up every 10 min.
 */

import { v4 as uuidv4 } from 'uuid';
import { loadMetadata, saveMetadata } from './s3Storage';
import { logger } from '../utils/logger';

const JOBS_S3_KEY = 'job-queue.json';
const PERSIST_INTERVAL_MS = 30_000; // persist every 30s at most

export interface Job {
  id: string;
  type: 'extraction' | 'clinical-extraction';
  status: 'pending' | 'processing' | 'completed' | 'failed';
  createdAt: string;
  completedAt?: string;
  userId: string;
  input: Record<string, unknown>;
  result?: unknown;
  error?: string;
  progress?: number; // 0-100
}

const jobs = new Map<string, Job>();

let cleanupInterval: ReturnType<typeof setInterval> | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let lastPersist = 0;
let dirty = false;

/**
 * Schedule an S3 persist if not already pending. Debounces writes to at most
 * one every PERSIST_INTERVAL_MS to avoid excessive S3 API calls.
 */
function schedulePersist(): void {
  dirty = true;
  if (persistTimer) return;
  const elapsed = Date.now() - lastPersist;
  const delay = Math.max(0, PERSIST_INTERVAL_MS - elapsed);
  persistTimer = setTimeout(async () => {
    persistTimer = null;
    if (!dirty) return;
    dirty = false;
    await persistJobs();
  }, delay);
}

/**
 * Persist current job state to S3.
 */
async function persistJobs(): Promise<void> {
  try {
    // Only persist non-expired jobs (skip already-cleaned-up ones)
    const jobArray = Array.from(jobs.values());
    await saveMetadata(JOBS_S3_KEY, jobArray);
    lastPersist = Date.now();
  } catch (err) {
    logger.warn('Failed to persist job queue to S3', { error: String(err) });
  }
}

/**
 * Load persisted jobs from S3 on startup. In-progress jobs are marked as
 * failed since the server restarted before they could complete.
 */
export async function loadPersistedJobs(): Promise<void> {
  try {
    const persisted = await loadMetadata<Job[]>(JOBS_S3_KEY);
    if (!persisted || persisted.length === 0) return;

    let recovered = 0;
    let markedFailed = 0;
    for (const job of persisted) {
      // In-progress jobs can't resume after restart — mark them failed
      if (job.status === 'pending' || job.status === 'processing') {
        job.status = 'failed';
        job.error = 'Server restarted during processing';
        job.completedAt = new Date().toISOString();
        markedFailed++;
      }
      jobs.set(job.id, job);
      recovered++;
    }
    logger.info('Job queue restored from S3', { recovered, markedFailed });
  } catch (err) {
    logger.warn('Failed to load persisted job queue', { error: String(err) });
  }
}

/**
 * Persist immediately, bypassing the debounce timer. Used for state
 * transitions where losing the record would be user-visible (job creation
 * and terminal states). M7 — a 30-second debounce means a crash between
 * creation and persist silently loses the client's record of their upload.
 */
function persistNow(): void {
  dirty = false;
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  // Fire-and-forget; the caller has already returned the job. If the S3
  // write fails, schedulePersist's next tick will retry.
  persistJobs().catch(err => {
    dirty = true; // ensure the next debounced tick retries
    logger.warn('Immediate job persist failed; will retry on next tick', { error: String(err) });
  });
}

/**
 * Create a new job and return it.
 */
export function createJob(type: Job['type'], userId: string, input: Record<string, unknown>): Job {
  const job: Job = {
    id: uuidv4(),
    type,
    status: 'pending',
    createdAt: new Date().toISOString(),
    userId,
    input,
    progress: 0,
  };
  jobs.set(job.id, job);
  // M7: persist immediately on create so a crash in the 30s debounce
  // window cannot silently lose a job the caller thinks is queued.
  persistNow();
  logger.info('Job created', { jobId: job.id, type, userId });
  return job;
}

/**
 * Get a job by ID, or null if not found.
 */
export function getJob(id: string): Job | null {
  return jobs.get(id) ?? null;
}

/**
 * Update a job with partial fields.
 */
export function updateJob(id: string, updates: Partial<Job>): void {
  const job = jobs.get(id);
  if (!job) {
    logger.warn('Attempted to update non-existent job', { jobId: id });
    return;
  }
  const prevStatus = job.status;
  Object.assign(job, updates);
  jobs.set(id, job);

  // M7: persist immediately on every status transition — especially
  // transitions into terminal states (completed/failed). Progress-only
  // updates still use the debounced path to avoid excess S3 traffic.
  const statusChanged = updates.status && updates.status !== prevStatus;
  if (statusChanged) {
    persistNow();
  } else {
    schedulePersist();
  }
}

/**
 * Get all jobs for a user, optionally filtered by type.
 */
export function getUserJobs(userId: string, type?: Job['type']): Job[] {
  const result: Job[] = [];
  for (const job of jobs.values()) {
    if (job.userId === userId && (!type || job.type === type)) {
      result.push(job);
    }
  }
  // Most recent first
  result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return result;
}

/**
 * Remove completed/failed jobs older than 1 hour.
 */
export function cleanupOldJobs(): void {
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  let removed = 0;
  for (const [id, job] of jobs.entries()) {
    if (
      (job.status === 'completed' || job.status === 'failed') &&
      new Date(job.completedAt || job.createdAt).getTime() < oneHourAgo
    ) {
      jobs.delete(id);
      removed++;
    }
  }
  if (removed > 0) {
    schedulePersist();
    logger.info('Job cleanup removed old jobs', { removed, remaining: jobs.size });
  }
}

/**
 * Flush job queue to S3 immediately (call on graceful shutdown).
 */
export async function flushJobs(): Promise<void> {
  dirty = true;
  await persistJobs();
}

/**
 * Start the periodic cleanup interval (every 10 minutes).
 * Call once at server startup.
 */
export function startJobCleanup(): void {
  if (cleanupInterval) return;
  cleanupInterval = setInterval(cleanupOldJobs, 10 * 60 * 1000);
  logger.info('Job cleanup scheduler started (every 10 minutes)');
}

export function stopJobCleanup(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}
