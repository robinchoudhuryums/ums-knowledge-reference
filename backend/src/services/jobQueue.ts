/**
 * Job Queue Service — simple in-memory job queue for async document processing.
 *
 * Jobs are stored in memory (Map) and cleaned up automatically.
 * Completed/failed jobs older than 1 hour are removed every 10 minutes.
 */

import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';

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
  Object.assign(job, updates);
  jobs.set(id, job);
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
    logger.info('Job cleanup removed old jobs', { removed, remaining: jobs.size });
  }
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
