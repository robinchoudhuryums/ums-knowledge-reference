/**
 * Tests for the batch scheduler lifecycle: result handler registration,
 * start/stop idempotency, and the env-guarded no-op behavior.
 *
 * The bedrockBatch module is fully mocked so no AWS calls happen.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../services/bedrockBatch', () => ({
  isBatchModeAvailable: vi.fn(() => false),
  createBatchInput: vi.fn(),
  createJob: vi.fn(),
  getJobStatus: vi.fn(),
  readBatchOutput: vi.fn(async () => new Map()),
  listPendingItemKeys: vi.fn(async () => []),
  downloadPendingItem: vi.fn(),
  deletePendingItem: vi.fn(),
  writeActiveJob: vi.fn(),
  writeOrphanedSubmission: vi.fn(),
  listActiveJobKeys: vi.fn(async () => []),
  listOrphanedSubmissionKeys: vi.fn(async () => []),
  downloadJob: vi.fn(),
  deleteObjectKey: vi.fn(),
  BATCH_S3_PREFIXES: {
    pending: 'batch-inference/pending/',
    activeJobs: 'batch-inference/active-jobs/',
    orphanedSubmissions: 'batch-inference/orphaned-submissions/',
  },
}));

import {
  startBatchScheduler,
  stopBatchScheduler,
  setBatchResultHandler,
  getBatchStatus,
  runBatchCycle,
} from '../services/batchScheduler';
import * as bedrockBatch from '../services/bedrockBatch';

describe('batchScheduler lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    stopBatchScheduler();
    setBatchResultHandler(null);
  });

  it('start is a no-op when batch mode is unavailable', () => {
    vi.mocked(bedrockBatch.isBatchModeAvailable).mockReturnValue(false);
    startBatchScheduler();
    // Nothing exposed to observe directly, but the subsequent stop must also
    // no-op without throwing.
    stopBatchScheduler();
  });

  it('start is idempotent when mode is available', () => {
    vi.mocked(bedrockBatch.isBatchModeAvailable).mockReturnValue(true);
    startBatchScheduler();
    // Second call should not throw or register additional timers. We can't
    // inspect timer handles directly, but stopBatchScheduler should clean up
    // idempotently regardless.
    startBatchScheduler();
    stopBatchScheduler();
    // Calling stop twice is also safe.
    stopBatchScheduler();
  });
});

describe('batchScheduler result handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    setBatchResultHandler(null);
  });

  it('setBatchResultHandler accepts null to clear', () => {
    const handler = vi.fn();
    setBatchResultHandler(handler);
    setBatchResultHandler(null);
    // No direct observable — this just exercises the clear path to ensure
    // it doesn't throw.
  });
});

describe('getBatchStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns disabled snapshot when batch mode is unavailable', async () => {
    vi.mocked(bedrockBatch.isBatchModeAvailable).mockReturnValue(false);
    const snapshot = await getBatchStatus();
    expect(snapshot.enabled).toBe(false);
    expect(snapshot.pending).toBe(0);
    expect(snapshot.active).toEqual([]);
    expect(snapshot.orphanedSubmissions).toBe(0);
  });

  it('reports pending + active counts when batch mode is available', async () => {
    vi.mocked(bedrockBatch.isBatchModeAvailable).mockReturnValue(true);
    vi.mocked(bedrockBatch.listPendingItemKeys).mockResolvedValue([
      'batch-inference/pending/a.json',
      'batch-inference/pending/b.json',
      'batch-inference/pending/c.json',
    ]);
    vi.mocked(bedrockBatch.listActiveJobKeys).mockResolvedValue([
      'batch-inference/active-jobs/job-1.json',
    ]);
    vi.mocked(bedrockBatch.listOrphanedSubmissionKeys).mockResolvedValue([]);
    vi.mocked(bedrockBatch.downloadJob).mockResolvedValue({
      jobId: 'job-1',
      jobArn: 'arn:aws:bedrock:us-east-1:123:job/job-1',
      status: 'Submitted',
      inputS3Uri: 's3://bkt/in',
      outputS3Uri: 's3://bkt/out/',
      itemIds: ['a', 'b', 'c', 'd', 'e'],
      createdAt: '2026-04-23T00:00:00.000Z',
    });

    const snapshot = await getBatchStatus();
    expect(snapshot.enabled).toBe(true);
    expect(snapshot.pending).toBe(3);
    expect(snapshot.active).toHaveLength(1);
    expect(snapshot.active[0].jobId).toBe('job-1');
    expect(snapshot.active[0].itemCount).toBe(5);
    expect(snapshot.orphanedSubmissions).toBe(0);
  });
});

describe('runBatchCycle fires the result handler on completed jobs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    setBatchResultHandler(null);
  });

  it('invokes the registered handler per-result and deletes pending + tracking files', async () => {
    vi.mocked(bedrockBatch.listOrphanedSubmissionKeys).mockResolvedValue([]);
    vi.mocked(bedrockBatch.listActiveJobKeys).mockResolvedValue([
      'batch-inference/active-jobs/job-42.json',
    ]);
    vi.mocked(bedrockBatch.listPendingItemKeys).mockResolvedValue([]);

    const fakeJob = {
      jobId: 'job-42',
      jobArn: 'arn:aws:bedrock:us-east-1:1:job/job-42',
      status: 'Submitted' as const,
      inputS3Uri: 's3://bkt/in',
      outputS3Uri: 's3://bkt/out/',
      itemIds: ['item-alpha', 'item-beta'],
      createdAt: '2026-04-23T00:00:00.000Z',
    };
    vi.mocked(bedrockBatch.downloadJob).mockResolvedValue(fakeJob);
    vi.mocked(bedrockBatch.getJobStatus).mockResolvedValue({ status: 'Completed' });

    const results = new Map([
      [
        'item-alpha',
        { itemId: 'item-alpha', text: 'result alpha' },
      ],
      [
        'item-beta',
        { itemId: 'item-beta', text: '', error: 'output parse failure' },
      ],
    ]);
    vi.mocked(bedrockBatch.readBatchOutput).mockResolvedValue(results);
    vi.mocked(bedrockBatch.downloadPendingItem).mockResolvedValue({
      itemId: 'item-alpha',
      prompt: 'p',
      timestamp: '2026-04-23T00:00:00.000Z',
    });
    vi.mocked(bedrockBatch.deletePendingItem).mockResolvedValue(undefined);
    vi.mocked(bedrockBatch.deleteObjectKey).mockResolvedValue(undefined);

    const handler = vi.fn(async () => {});
    setBatchResultHandler(handler);

    await runBatchCycle();

    // Handler fired once per result in the output map.
    expect(handler).toHaveBeenCalledTimes(2);
    const handlerCalls = handler.mock.calls.map(
      (c: unknown[]) => (c[0] as { result: { itemId: string } }).result.itemId,
    );
    expect(handlerCalls).toEqual(['item-alpha', 'item-beta']);

    // Each pending item deletion attempted.
    expect(bedrockBatch.deletePendingItem).toHaveBeenCalledWith('item-alpha');
    expect(bedrockBatch.deletePendingItem).toHaveBeenCalledWith('item-beta');

    // The active-job tracking file was deleted via deleteObjectKey.
    expect(bedrockBatch.deleteObjectKey).toHaveBeenCalledWith(
      'batch-inference/active-jobs/job-42.json',
    );
  });

  it('notifies handler for submitted itemIds that are missing from the output', async () => {
    vi.mocked(bedrockBatch.listOrphanedSubmissionKeys).mockResolvedValue([]);
    vi.mocked(bedrockBatch.listActiveJobKeys).mockResolvedValue([
      'batch-inference/active-jobs/job-99.json',
    ]);
    vi.mocked(bedrockBatch.listPendingItemKeys).mockResolvedValue([]);

    vi.mocked(bedrockBatch.downloadJob).mockResolvedValue({
      jobId: 'job-99',
      jobArn: 'arn:aws:bedrock:us-east-1:1:job/job-99',
      status: 'Submitted',
      inputS3Uri: 's3://bkt/in',
      outputS3Uri: 's3://bkt/out/',
      itemIds: ['in-output', 'dropped-by-bedrock'],
      createdAt: '2026-04-23T00:00:00.000Z',
    });
    vi.mocked(bedrockBatch.getJobStatus).mockResolvedValue({ status: 'Completed' });
    vi.mocked(bedrockBatch.readBatchOutput).mockResolvedValue(
      new Map([
        ['in-output', { itemId: 'in-output', text: 'got this one' }],
      ]),
    );
    vi.mocked(bedrockBatch.downloadPendingItem).mockResolvedValue(null);
    vi.mocked(bedrockBatch.deletePendingItem).mockResolvedValue(undefined);
    vi.mocked(bedrockBatch.deleteObjectKey).mockResolvedValue(undefined);

    const handler = vi.fn(async () => {});
    setBatchResultHandler(handler);
    await runBatchCycle();

    // Handler fires for BOTH: the received result AND the missing item (with
    // a synthesized error).
    expect(handler).toHaveBeenCalledTimes(2);
    const calls = handler.mock.calls.map(
      (c: unknown[]) => c[0] as { result: { itemId: string; error?: string } },
    );
    const missing = calls.find((c) => c.result.itemId === 'dropped-by-bedrock');
    expect(missing?.result.error).toMatch(/missing from output/i);
  });
});
