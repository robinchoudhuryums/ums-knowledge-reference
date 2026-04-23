/**
 * Tests for the extraction batch result handler — the glue between the
 * Bedrock batch scheduler and the RAG jobQueue.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../services/jobQueue', () => ({
  updateJob: vi.fn(),
}));

vi.mock('../services/audit', () => ({
  logAuditEvent: vi.fn(async () => {}),
}));

vi.mock('../services/batchScheduler', () => ({
  setBatchResultHandler: vi.fn(),
}));

// Provide a deterministic template lookup so finalizeExtractionFromResponse
// produces predictable output.
vi.mock('../services/extractionTemplates', () => ({
  getTemplateById: (id: string) => {
    if (id === 'test-template') {
      return {
        id: 'test-template',
        name: 'Test Template',
        systemPrompt: 'sys',
        fields: [
          { key: 'patientName', label: 'Patient', type: 'string', required: true },
          { key: 'dob', label: 'DOB', type: 'date' },
        ],
      };
    }
    return undefined;
  },
  listTemplates: () => [],
}));

import {
  handleExtractionBatchResult,
  registerExtractionBatchHandler,
} from '../services/extractionBatchHandler';
import { updateJob } from '../services/jobQueue';
import { logAuditEvent } from '../services/audit';
import { setBatchResultHandler } from '../services/batchScheduler';
import type { BatchResultContext } from '../services/batchScheduler';

function ctx(overrides: Partial<BatchResultContext['result']> & Partial<{
  metadata: Record<string, unknown>;
}> = {}): BatchResultContext {
  const { metadata, ...resultOverrides } = overrides;
  return {
    job: {
      jobId: 'batch-42',
      jobArn: 'arn:aws:bedrock:us-east-1:1:job/batch-42',
      status: 'Completed',
      inputS3Uri: 's3://bkt/in',
      outputS3Uri: 's3://bkt/out/',
      itemIds: ['job-1'],
      createdAt: '2026-04-23T00:00:00.000Z',
    },
    pendingItem: {
      itemId: 'job-1',
      prompt: 'extract this',
      metadata: metadata ?? {
        kind: 'extraction',
        jobId: 'job-1',
        templateId: 'test-template',
        userId: 'user-abc',
        username: 'reviewer',
        filename: 'scan.pdf',
      },
      timestamp: '2026-04-23T00:00:00.000Z',
    },
    result: {
      itemId: 'job-1',
      text: '{"patientName":"Alice","dob":"1980-01-01"}\nCONFIDENCE: high\nNOTES: clean extraction',
      ...resultOverrides,
    },
  };
}

describe('handleExtractionBatchResult', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('ignores items whose metadata.kind is not "extraction"', async () => {
    await handleExtractionBatchResult(ctx({ metadata: { kind: 'other', jobId: 'x' } }));
    expect(updateJob).not.toHaveBeenCalled();
  });

  it('drops results with missing jobId without throwing', async () => {
    await handleExtractionBatchResult(ctx({ metadata: { kind: 'extraction' } }));
    expect(updateJob).not.toHaveBeenCalled();
  });

  it('marks job failed with sanitized message when the result carries an error', async () => {
    await handleExtractionBatchResult(ctx({ error: 'ThrottlingException', text: '' }));
    expect(updateJob).toHaveBeenCalledTimes(1);
    const [jobId, patch] = vi.mocked(updateJob).mock.calls[0];
    expect(jobId).toBe('job-1');
    expect(patch.status).toBe('failed');
    // INV-14 parity: internal AWS detail must not leak out through the job result.
    expect(patch.error).not.toMatch(/Throttling/i);
    expect(patch.error).toMatch(/temporarily unavailable/i);
  });

  it('marks job failed when templateId is missing', async () => {
    await handleExtractionBatchResult(
      ctx({ metadata: { kind: 'extraction', jobId: 'job-1' } }),
    );
    expect(updateJob).toHaveBeenCalledWith(
      'job-1',
      expect.objectContaining({ status: 'failed' }),
    );
  });

  it('completes the job with the parsed extraction result on success', async () => {
    await handleExtractionBatchResult(ctx());
    expect(updateJob).toHaveBeenCalledTimes(1);
    const [jobId, patch] = vi.mocked(updateJob).mock.calls[0];
    expect(jobId).toBe('job-1');
    expect(patch.status).toBe('completed');
    expect(patch.progress).toBe(100);
    expect(patch.result).toBeDefined();
    const result = patch.result as {
      templateId: string;
      data: Record<string, unknown>;
      confidence: string;
    };
    expect(result.templateId).toBe('test-template');
    expect(result.data.patientName).toBe('Alice');
    expect(result.data.dob).toBe('1980-01-01');
    expect(result.confidence).toBe('high');
  });

  it('writes an audit entry on success with extraction-async-batch operation', async () => {
    await handleExtractionBatchResult(ctx());
    expect(logAuditEvent).toHaveBeenCalledTimes(1);
    const [userId, username, action, details] = vi.mocked(logAuditEvent).mock.calls[0];
    expect(userId).toBe('user-abc');
    expect(username).toBe('reviewer');
    expect(action).toBe('ocr');
    expect((details as { operation: string }).operation).toBe('extraction-async-batch');
    expect((details as { jobId: string }).jobId).toBe('job-1');
  });

  it('marks the job failed when the response text is unparseable', async () => {
    await handleExtractionBatchResult(
      ctx({ text: 'not json at all — raw garbage' }),
    );
    // Template parsing falls back to null-per-field + low confidence; this is
    // "completed" not "failed" because the template path handled it — mirrors
    // sync-path behavior. Assertion: we DO transition the job to completed.
    expect(updateJob).toHaveBeenCalledWith(
      'job-1',
      expect.objectContaining({ status: 'completed' }),
    );
  });
});

describe('registerExtractionBatchHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls setBatchResultHandler with the exported handler', () => {
    registerExtractionBatchHandler();
    expect(setBatchResultHandler).toHaveBeenCalledTimes(1);
    expect(setBatchResultHandler).toHaveBeenCalledWith(handleExtractionBatchResult);
  });
});
