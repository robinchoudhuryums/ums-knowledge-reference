import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../services/s3Storage', () => {
  let store: Record<string, unknown> = {};
  return {
    loadMetadata: vi.fn(async <T>(key: string): Promise<T | null> => (store[key] as T) || null),
    saveMetadata: vi.fn(async (key: string, data: unknown) => { store[key] = data; }),
    __resetStore: () => { store = {}; },
    __getStore: () => store,
  };
});

vi.mock('../utils/phiRedactor', () => ({
  redactPhi: vi.fn((text: string) => ({ text, redacted: false })),
}));

vi.mock('../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import * as s3Module from '../services/s3Storage';

let ragTrace: typeof import('../services/ragTrace');

beforeEach(async () => {
  vi.clearAllMocks();
  (s3Module as any).__resetStore();
  vi.resetModules();
  ragTrace = await import('../services/ragTrace');
});

function makeTrace(overrides: Partial<import('../services/ragTrace').RagTrace> = {}) {
  return {
    traceId: 'trace-001',
    timestamp: new Date().toISOString(),
    userId: 'user1',
    username: 'testuser',
    queryText: 'What is oxygen therapy?',
    retrievedChunkIds: ['doc1-chunk-0', 'doc1-chunk-1'],
    retrievalScores: [0.9, 0.8],
    avgRetrievalScore: 0.85,
    chunksPassedToModel: 2,
    modelId: 'claude-haiku',
    responseText: 'Oxygen therapy is a treatment...',
    confidence: 'high' as const,
    responseTimeMs: 500,
    streamed: false,
    ...overrides,
  };
}

describe('ragTrace service', () => {
  it('generateTraceId returns a non-empty UUID-format string', () => {
    const id = ragTrace.generateTraceId();
    expect(id).toBeDefined();
    expect(id.length).toBeGreaterThan(0);
    // UUID v4 format: 8-4-4-4-12 hex chars
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('logRagTrace stores trace with createdAt timestamp', async () => {
    const trace = makeTrace();
    await ragTrace.logRagTrace(trace);
    await ragTrace.flushTraces();

    const today = new Date().toISOString().split('T')[0];
    const stored = (s3Module as any).__getStore()[`rag-traces/${today}-traces.json`] as any[];

    expect(stored).toBeDefined();
    expect(stored).toHaveLength(1);
    expect(stored[0].createdAt).toBeDefined();
    expect(stored[0].traceId).toBe('trace-001');
    expect(stored[0].queryText).toBe('What is oxygen therapy?');
  });

  it('logRagTrace calls redactPhi on queryText, reformulatedQuery, responseText', async () => {
    const { redactPhi } = await import('../utils/phiRedactor');

    const trace = makeTrace({
      reformulatedQuery: 'Tell me about O2 therapy',
    });
    await ragTrace.logRagTrace(trace);

    expect(redactPhi).toHaveBeenCalledWith('What is oxygen therapy?');
    expect(redactPhi).toHaveBeenCalledWith('Tell me about O2 therapy');
    expect(redactPhi).toHaveBeenCalledWith('Oxygen therapy is a treatment...');
  });

  it('logRagFeedback creates feedback entry with feedbackId and createdAt', async () => {
    const feedback = {
      traceId: 'trace-001',
      feedbackType: 'thumbs_up' as const,
      userId: 'user1',
      username: 'testuser',
      notes: 'Helpful answer',
    };

    const result = await ragTrace.logRagFeedback(feedback);

    expect(result.feedbackId).toBeDefined();
    expect(result.feedbackId.length).toBeGreaterThan(0);
    expect(result.createdAt).toBeDefined();
    expect(result.traceId).toBe('trace-001');
    expect(result.feedbackType).toBe('thumbs_up');
    expect(result.userId).toBe('user1');
  });

  it('flushTraces persists traces to S3', async () => {
    const { saveMetadata } = await import('../services/s3Storage');

    await ragTrace.logRagTrace(makeTrace());
    // logRagTrace may eagerly flush (persist interval from epoch), so
    // verify saveMetadata was called at any point with the trace data.
    await ragTrace.flushTraces();

    const today = new Date().toISOString().split('T')[0];
    expect(saveMetadata).toHaveBeenCalledWith(
      `rag-traces/${today}-traces.json`,
      expect.any(Array),
    );
  });

  it('getTraces returns today\'s traces after flush', async () => {
    await ragTrace.logRagTrace(makeTrace({ traceId: 'trace-A' }));
    await ragTrace.logRagTrace(makeTrace({ traceId: 'trace-B' }));
    await ragTrace.flushTraces();

    const today = new Date().toISOString().split('T')[0];
    const traces = await ragTrace.getTraces(today);

    expect(traces).toHaveLength(2);
    expect(traces[0].traceId).toBe('trace-A');
    expect(traces[1].traceId).toBe('trace-B');
  });

  it('purgeDocumentFromTraces removes chunk IDs matching documentId prefix', async () => {
    await ragTrace.logRagTrace(makeTrace({
      traceId: 'trace-purge',
      retrievedChunkIds: ['doc-abc-chunk-0', 'doc-abc-chunk-1', 'doc-xyz-chunk-0'],
      retrievalScores: [0.9, 0.8, 0.7],
      chunksPassedToModel: 3,
    }));
    await ragTrace.flushTraces();

    const modified = await ragTrace.purgeDocumentFromTraces('doc-abc');

    expect(modified).toBeGreaterThanOrEqual(1);

    const today = new Date().toISOString().split('T')[0];
    const traces = await ragTrace.getTraces(today);
    const purged = traces.find(t => t.traceId === 'trace-purge');
    expect(purged).toBeDefined();
    expect(purged!.retrievedChunkIds).toEqual(['doc-xyz-chunk-0']);
    expect(purged!.retrievalScores).toHaveLength(1);
    expect(purged!.chunksPassedToModel).toBe(1);
  });
});
