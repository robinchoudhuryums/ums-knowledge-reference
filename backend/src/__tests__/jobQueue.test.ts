import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock logger before importing jobQueue
vi.mock('../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { createJob, getJob, updateJob, getUserJobs, cleanupOldJobs, startJobCleanup } from '../services/jobQueue';

describe('jobQueue', () => {
  // Track job IDs created in each test so we can clean them up
  const createdJobIds: string[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    createdJobIds.length = 0;
  });

  afterEach(() => {
    // Clean up jobs by marking them completed in the past, then running cleanup
    const pastTime = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    for (const id of createdJobIds) {
      updateJob(id, { status: 'completed', completedAt: pastTime });
    }
    cleanupOldJobs();
    vi.useRealTimers();
  });

  function trackJob<T extends { id: string }>(job: T): T {
    createdJobIds.push(job.id);
    return job;
  }

  it('createJob returns a job with pending status and UUID id', () => {
    const job = trackJob(createJob('extraction', 'user1', { file: 'test.pdf' }));

    expect(job.status).toBe('pending');
    expect(job.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(job.type).toBe('extraction');
    expect(job.userId).toBe('user1');
    expect(job.input).toEqual({ file: 'test.pdf' });
    expect(job.progress).toBe(0);
    expect(job.createdAt).toBeDefined();
  });

  it('createJob stores the job so getJob retrieves it', () => {
    const job = trackJob(createJob('clinical-extraction', 'user2', { doc: 'notes.pdf' }));
    const retrieved = getJob(job.id);

    expect(retrieved).not.toBeNull();
    expect(retrieved!.id).toBe(job.id);
    expect(retrieved!.type).toBe('clinical-extraction');
    expect(retrieved!.userId).toBe('user2');
  });

  it('getJob returns null for unknown id', () => {
    expect(getJob('nonexistent-id-12345')).toBeNull();
  });

  it('updateJob merges partial fields into existing job', () => {
    const job = trackJob(createJob('extraction', 'user3', {}));
    updateJob(job.id, { status: 'processing', progress: 50 });

    const updated = getJob(job.id);
    expect(updated!.status).toBe('processing');
    expect(updated!.progress).toBe(50);
    // Original fields preserved
    expect(updated!.userId).toBe('user3');
    expect(updated!.type).toBe('extraction');
  });

  it('updateJob does nothing for non-existent job (no error)', () => {
    expect(() => {
      updateJob('does-not-exist', { status: 'completed' });
    }).not.toThrow();
  });

  it('getUserJobs returns only jobs for that user, sorted newest first', () => {
    // Create jobs at different times
    vi.setSystemTime(new Date('2026-01-01T10:00:00Z'));
    const job1 = trackJob(createJob('extraction', 'userA', { order: 1 }));

    vi.setSystemTime(new Date('2026-01-01T11:00:00Z'));
    const job2 = trackJob(createJob('extraction', 'userA', { order: 2 }));

    vi.setSystemTime(new Date('2026-01-01T12:00:00Z'));
    const job3 = trackJob(createJob('extraction', 'userB', { order: 3 }));

    const userAJobs = getUserJobs('userA');
    expect(userAJobs).toHaveLength(2);
    // Newest first
    expect(userAJobs[0].id).toBe(job2.id);
    expect(userAJobs[1].id).toBe(job1.id);

    // userB should only have their own job
    const userBJobs = getUserJobs('userB');
    expect(userBJobs).toHaveLength(1);
    expect(userBJobs[0].id).toBe(job3.id);
  });

  it('getUserJobs filters by type when type is specified', () => {
    trackJob(createJob('extraction', 'userC', {}));
    const job2 = trackJob(createJob('clinical-extraction', 'userC', {}));
    trackJob(createJob('extraction', 'userC', {}));

    const extractionJobs = getUserJobs('userC', 'extraction');
    expect(extractionJobs).toHaveLength(2);
    expect(extractionJobs.every(j => j.type === 'extraction')).toBe(true);

    const clinicalJobs = getUserJobs('userC', 'clinical-extraction');
    expect(clinicalJobs).toHaveLength(1);
    expect(clinicalJobs[0].id).toBe(job2.id);
  });

  it('cleanupOldJobs removes completed/failed jobs older than 1 hour', () => {
    vi.setSystemTime(new Date('2026-01-01T10:00:00Z'));
    const completedJob = trackJob(createJob('extraction', 'userD', {}));
    const failedJob = trackJob(createJob('extraction', 'userD', {}));

    // Mark them as completed/failed with completedAt in the past
    const pastTime = new Date('2026-01-01T10:00:00Z').toISOString();
    updateJob(completedJob.id, { status: 'completed', completedAt: pastTime });
    updateJob(failedJob.id, { status: 'failed', completedAt: pastTime });

    // Advance time by more than 1 hour
    vi.setSystemTime(new Date('2026-01-01T11:01:00Z'));
    cleanupOldJobs();

    expect(getJob(completedJob.id)).toBeNull();
    expect(getJob(failedJob.id)).toBeNull();

    // Remove from tracking since they're already cleaned up
    createdJobIds.length = 0;
  });

  it('cleanupOldJobs keeps pending/processing jobs regardless of age', () => {
    vi.setSystemTime(new Date('2026-01-01T08:00:00Z'));
    const pendingJob = trackJob(createJob('extraction', 'userE', {}));
    const processingJob = trackJob(createJob('extraction', 'userE', {}));
    updateJob(processingJob.id, { status: 'processing' });

    // Advance time by 3 hours
    vi.setSystemTime(new Date('2026-01-01T11:00:00Z'));
    cleanupOldJobs();

    expect(getJob(pendingJob.id)).not.toBeNull();
    expect(getJob(processingJob.id)).not.toBeNull();
  });

  it('startJobCleanup is idempotent (calling twice does not create two intervals)', () => {
    const setIntervalSpy = vi.spyOn(global, 'setInterval');
    const callsBefore = setIntervalSpy.mock.calls.length;

    startJobCleanup();
    startJobCleanup();

    const callsAfter = setIntervalSpy.mock.calls.length;
    // Only one new setInterval call should have been made
    expect(callsAfter - callsBefore).toBe(1);

    setIntervalSpy.mockRestore();
  });
});
