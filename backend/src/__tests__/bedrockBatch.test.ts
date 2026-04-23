/**
 * Tests for Bedrock batch inference helpers.
 *
 * Focus: the pure / S3-only paths — availability guard, JSONL encoding, and
 * output parsing. The Bedrock CreateModelInvocationJob + GetModelInvocationJob
 * paths are mocked at the SDK level so no network calls happen.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the AWS SDK clients BEFORE the module under test is imported, so the
// module-level client constructors pick up the mocks.
vi.mock('@aws-sdk/client-bedrock', () => {
  class BedrockClient {
    send = vi.fn();
  }
  class CreateModelInvocationJobCommand {
    constructor(public input: unknown) {}
  }
  class GetModelInvocationJobCommand {
    constructor(public input: unknown) {}
  }
  return { BedrockClient, CreateModelInvocationJobCommand, GetModelInvocationJobCommand };
});

vi.mock('../config/aws', () => ({
  s3Client: { send: vi.fn() },
  S3_BUCKET: 'test-bucket',
  bedrockCircuitBreaker: {
    execute: vi.fn(async (fn: () => Promise<unknown>) => fn()),
  },
}));

import {
  isBatchModeAvailable,
  readBatchOutput,
  createBatchInput,
  BATCH_S3_PREFIXES,
} from '../services/bedrockBatch';
import { s3Client } from '../config/aws';

describe('isBatchModeAvailable', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns false when BEDROCK_BATCH_MODE is unset', () => {
    delete process.env.BEDROCK_BATCH_MODE;
    process.env.BEDROCK_BATCH_ROLE_ARN = 'arn:aws:iam::123:role/x';
    expect(isBatchModeAvailable()).toBe(false);
  });

  it('returns false when BEDROCK_BATCH_MODE is not "true"', () => {
    process.env.BEDROCK_BATCH_MODE = 'yes';
    process.env.BEDROCK_BATCH_ROLE_ARN = 'arn:aws:iam::123:role/x';
    expect(isBatchModeAvailable()).toBe(false);
  });

  it('returns false when BEDROCK_BATCH_ROLE_ARN is missing (even with mode=true)', () => {
    process.env.BEDROCK_BATCH_MODE = 'true';
    delete process.env.BEDROCK_BATCH_ROLE_ARN;
    expect(isBatchModeAvailable()).toBe(false);
  });

  it('returns true when both env vars are set correctly', () => {
    process.env.BEDROCK_BATCH_MODE = 'true';
    process.env.BEDROCK_BATCH_ROLE_ARN = 'arn:aws:iam::123:role/batch';
    expect(isBatchModeAvailable()).toBe(true);
  });
});

describe('createBatchInput JSONL encoding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('emits a system block when systemPrompt is provided', async () => {
    const mockSend = s3Client.send as ReturnType<typeof vi.fn>;
    mockSend.mockResolvedValueOnce({});
    await createBatchInput([
      {
        itemId: 'a',
        prompt: 'user msg',
        systemPrompt: 'you are a careful extractor',
        timestamp: '2026-04-23T00:00:00.000Z',
      },
    ]);
    // The PUT call's Body is the JSONL string.
    const putCall = mockSend.mock.calls[0][0] as { input: { Body: string } };
    const lines = putCall.input.Body.split('\n');
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]);
    expect(parsed.recordId).toBe('a');
    expect(parsed.modelInput.system).toEqual([{ text: 'you are a careful extractor' }]);
    expect(parsed.modelInput.messages).toEqual([
      { role: 'user', content: [{ text: 'user msg' }] },
    ]);
    expect(parsed.modelInput.inferenceConfig.maxTokens).toBe(8192);
  });

  it('omits the system block when not provided', async () => {
    const mockSend = s3Client.send as ReturnType<typeof vi.fn>;
    mockSend.mockResolvedValueOnce({});
    await createBatchInput([
      { itemId: 'b', prompt: 'hi', timestamp: '2026-04-23T00:00:00.000Z' },
    ]);
    const putCall = mockSend.mock.calls[0][0] as { input: { Body: string } };
    const parsed = JSON.parse(putCall.input.Body);
    expect(parsed.modelInput.system).toBeUndefined();
  });

  it('honors per-item inferenceConfig overrides', async () => {
    const mockSend = s3Client.send as ReturnType<typeof vi.fn>;
    mockSend.mockResolvedValueOnce({});
    await createBatchInput([
      {
        itemId: 'c',
        prompt: 'x',
        inferenceConfig: { temperature: 0.9, maxTokens: 256 },
        timestamp: '2026-04-23T00:00:00.000Z',
      },
    ]);
    const putCall = mockSend.mock.calls[0][0] as { input: { Body: string } };
    const parsed = JSON.parse(putCall.input.Body);
    expect(parsed.modelInput.inferenceConfig).toEqual({ temperature: 0.9, maxTokens: 256 });
  });
});

describe('BATCH_S3_PREFIXES', () => {
  it('exposes the three canonical prefixes', () => {
    expect(BATCH_S3_PREFIXES.pending).toBe('batch-inference/pending/');
    expect(BATCH_S3_PREFIXES.activeJobs).toBe('batch-inference/active-jobs/');
    expect(BATCH_S3_PREFIXES.orphanedSubmissions).toBe(
      'batch-inference/orphaned-submissions/',
    );
  });
});

describe('readBatchOutput', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses a JSONL output file with mixed success + error records', async () => {
    const jsonl = [
      JSON.stringify({
        recordId: 'item-1',
        modelOutput: {
          output: {
            message: { content: [{ text: 'result one' }] },
          },
        },
      }),
      JSON.stringify({
        recordId: 'item-2',
        error: 'ThrottlingException',
      }),
      JSON.stringify({
        recordId: 'item-3',
        modelOutput: {
          output: {
            message: { content: [{ text: 'result three' }] },
          },
        },
      }),
      '', // empty line, should be skipped
    ].join('\n');

    const mockSend = s3Client.send as ReturnType<typeof vi.fn>;
    // First call: ListObjectsV2 returns one .jsonl.out file
    mockSend.mockResolvedValueOnce({
      Contents: [{ Key: 'batch-inference/output/batch-1/results.jsonl.out' }],
      IsTruncated: false,
    });
    // Second call: GetObject returns the JSONL content
    mockSend.mockResolvedValueOnce({
      Body: { transformToString: async () => jsonl },
    });

    const results = await readBatchOutput('s3://test-bucket/batch-inference/output/batch-1/');
    expect(results.size).toBe(3);
    expect(results.get('item-1')?.text).toBe('result one');
    expect(results.get('item-1')?.error).toBeUndefined();
    expect(results.get('item-2')?.text).toBe('');
    expect(results.get('item-2')?.error).toBe('ThrottlingException');
    expect(results.get('item-3')?.text).toBe('result three');
  });

  it('skips non-.jsonl.out files (e.g. manifest.json)', async () => {
    const mockSend = s3Client.send as ReturnType<typeof vi.fn>;
    mockSend.mockResolvedValueOnce({
      Contents: [
        { Key: 'batch-inference/output/batch-1/manifest.json' },
        { Key: 'batch-inference/output/batch-1/results.jsonl.out' },
      ],
      IsTruncated: false,
    });
    mockSend.mockResolvedValueOnce({
      Body: {
        transformToString: async () =>
          JSON.stringify({
            recordId: 'a',
            modelOutput: { output: { message: { content: [{ text: 'x' }] } } },
          }),
      },
    });

    const results = await readBatchOutput('s3://test-bucket/batch-inference/output/batch-1/');
    // GetObject should have been called exactly once (only for .jsonl.out)
    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(results.size).toBe(1);
    expect(results.get('a')?.text).toBe('x');
  });

  it('tolerates unparseable lines and continues processing', async () => {
    const jsonl = [
      '{"not json',
      JSON.stringify({
        recordId: 'ok',
        modelOutput: { output: { message: { content: [{ text: 'fine' }] } } },
      }),
    ].join('\n');

    const mockSend = s3Client.send as ReturnType<typeof vi.fn>;
    mockSend.mockResolvedValueOnce({
      Contents: [{ Key: 'batch-inference/output/b/results.jsonl.out' }],
      IsTruncated: false,
    });
    mockSend.mockResolvedValueOnce({
      Body: { transformToString: async () => jsonl },
    });

    const results = await readBatchOutput('s3://test-bucket/batch-inference/output/b/');
    expect(results.size).toBe(1);
    expect(results.get('ok')?.text).toBe('fine');
  });

  it('returns an empty map when the output prefix has no files', async () => {
    const mockSend = s3Client.send as ReturnType<typeof vi.fn>;
    mockSend.mockResolvedValueOnce({ Contents: [], IsTruncated: false });

    const results = await readBatchOutput('s3://test-bucket/batch-inference/output/empty/');
    expect(results.size).toBe(0);
  });

  it('paginates through multiple ListObjectsV2 responses', async () => {
    const mockSend = s3Client.send as ReturnType<typeof vi.fn>;
    // Page 1
    mockSend.mockResolvedValueOnce({
      Contents: [{ Key: 'batch-inference/output/p/a.jsonl.out' }],
      IsTruncated: true,
      NextContinuationToken: 'tok-1',
    });
    // Page 2
    mockSend.mockResolvedValueOnce({
      Contents: [{ Key: 'batch-inference/output/p/b.jsonl.out' }],
      IsTruncated: false,
    });
    // GetObject for a.jsonl.out
    mockSend.mockResolvedValueOnce({
      Body: {
        transformToString: async () =>
          JSON.stringify({
            recordId: 'a',
            modelOutput: { output: { message: { content: [{ text: 'A' }] } } },
          }),
      },
    });
    // GetObject for b.jsonl.out
    mockSend.mockResolvedValueOnce({
      Body: {
        transformToString: async () =>
          JSON.stringify({
            recordId: 'b',
            modelOutput: { output: { message: { content: [{ text: 'B' }] } } },
          }),
      },
    });

    const results = await readBatchOutput('s3://test-bucket/batch-inference/output/p/');
    expect(results.size).toBe(2);
    expect(results.get('a')?.text).toBe('A');
    expect(results.get('b')?.text).toBe('B');
  });
});
