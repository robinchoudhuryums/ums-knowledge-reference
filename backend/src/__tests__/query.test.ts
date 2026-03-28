/**
 * Tests for the RAG query pipeline and vector store search.
 *
 * Query route tests mock all external dependencies (auth, embeddings, vectorStore, Bedrock).
 * Vector store search tests use real in-memory data with mocked S3.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing any application code
// ---------------------------------------------------------------------------

// Mock S3 storage
vi.mock('../services/s3Storage', () => ({
  saveVectorIndex: vi.fn(async () => {}),
  loadVectorIndex: vi.fn(async () => null),
  getDocumentsIndex: vi.fn(async () => []),
  loadMetadata: vi.fn(async () => null),
  saveMetadata: vi.fn(async () => {}),
}));

// Mock audit
vi.mock('../services/audit', () => ({
  logAuditEvent: vi.fn(async () => {}),
}));

// Mock usage
vi.mock('../services/usage', () => ({
  checkAndRecordQuery: vi.fn(async () => ({ allowed: true })),
  recordQuery: vi.fn(async () => {}),
}));

// Mock queryLog
vi.mock('../services/queryLog', () => ({
  logQuery: vi.fn(async () => {}),
}));

// Mock ragTrace
vi.mock('../services/ragTrace', () => ({
  generateTraceId: vi.fn(() => 'trace-123'),
  logRagTrace: vi.fn(async () => {}),
}));

// Mock embeddings
vi.mock('../services/embeddings', () => ({
  generateEmbedding: vi.fn(async () => [0.1, 0.2, 0.3]),
  getEmbeddingProvider: vi.fn(() => ({
    modelId: 'test-model',
    dimensions: 3,
  })),
}));

// Mock vectorStore
vi.mock('../services/vectorStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/vectorStore')>();
  return {
    ...actual,
    searchVectorStore: vi.fn(async () => []),
    initializeVectorStore: vi.fn(async () => {}),
    addChunksToStore: vi.fn(async () => {}),
    removeDocumentChunks: vi.fn(async () => {}),
    searchChunksByKeyword: vi.fn(async () => []),
    getVectorStoreStats: vi.fn(() => ({ totalChunks: 0, lastUpdated: null })),
  };
});

// Mock Bedrock client
const mockBedrockSend = vi.fn();
vi.mock('../config/aws', () => ({
  bedrockClient: { send: (...args: unknown[]) => mockBedrockSend(...args) },
  BEDROCK_GENERATION_MODEL: 'mock-model',
}));

// Mock auth middleware — just passes through with a test user
vi.mock('../middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    if (!req.user) {
      req.user = { id: 'user-1', username: 'testuser', role: 'user' };
    }
    next();
  },
  getUserAllowedCollections: vi.fn(async () => null),
  AuthRequest: {},
}));

// Mock logger
vi.mock('../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock PHI redactor
vi.mock('../utils/phiRedactor', () => ({
  redactPhi: vi.fn((text: string) => ({ text, redacted: false })),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import request from 'supertest';
import express from 'express';
import queryRouter from '../routes/query';
import { checkAndRecordQuery } from '../services/usage';
import { logAuditEvent } from '../services/audit';
import { getUserAllowedCollections } from '../middleware/auth';
import { searchVectorStore } from '../services/vectorStore';
import { SearchResult, Document, StoredChunk } from '../types';

const mockSearchVectorStore = searchVectorStore as any;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/query', queryRouter);
  return app;
}

function makeSearchResult(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    chunk: {
      id: 'chunk-1',
      documentId: 'doc-1',
      chunkIndex: 0,
      text: 'Test chunk text about wheelchair procedures.',
      tokenCount: 10,
      startOffset: 0,
      endOffset: 100,
      pageNumber: 1,
      sectionHeader: 'Wheelchair Policy',
    },
    document: {
      id: 'doc-1',
      filename: 'policy.pdf',
      originalName: 'Policy Document.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1000,
      s3Key: 'docs/policy.pdf',
      collectionId: 'col-1',
      uploadedBy: 'admin',
      uploadedAt: '2024-01-01',
      status: 'ready',
      chunkCount: 5,
      version: 1,
    },
    score: 0.85,
    ...overrides,
  };
}

function makeBedrockResponse(text: string) {
  return {
    body: new TextEncoder().encode(JSON.stringify({
      content: [{ text }],
      usage: { input_tokens: 100, output_tokens: 50 },
    })),
  };
}

// ---------------------------------------------------------------------------
// Query Route Tests
// ---------------------------------------------------------------------------

describe('Query Route', () => {
  let app: ReturnType<typeof makeApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = makeApp();
    // Reset default happy-path mocks
    (checkAndRecordQuery as any).mockResolvedValue({ allowed: true });
    mockSearchVectorStore.mockResolvedValue([]);
    mockBedrockSend.mockResolvedValue(makeBedrockResponse('The answer is 42. [CONFIDENCE: HIGH]'));
    (getUserAllowedCollections as any).mockResolvedValue(null);
  });

  it('rejects empty question', async () => {
    const res = await request(app).post('/api/query').send({ question: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Question is required');
  });

  it('rejects when usage limit exceeded', async () => {
    (checkAndRecordQuery as any).mockResolvedValue({
      allowed: false,
      reason: 'Daily limit reached (50 queries/day). Try again tomorrow.',
      usage: { userToday: 50, totalToday: 200 },
    });

    const res = await request(app)
      .post('/api/query')
      .send({ question: 'What is the wheelchair policy?' });

    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/Daily limit reached/);
  });

  it('returns answer with sources when results found', async () => {
    const sr = makeSearchResult();
    mockSearchVectorStore.mockResolvedValue([sr]);

    const res = await request(app)
      .post('/api/query')
      .send({ question: 'What is the wheelchair policy?' });

    expect(res.status).toBe(200);
    expect(res.body.answer).toBe('The answer is 42.');
    expect(res.body.confidence).toBe('high');
    expect(res.body.sources).toHaveLength(1);
    expect(res.body.sources[0].documentId).toBe('doc-1');
    expect(res.body.sources[0].documentName).toBe('Policy Document.pdf');
    expect(res.body.traceId).toBe('trace-123');
  });

  it('returns "not covered" message when no results', async () => {
    mockSearchVectorStore.mockResolvedValue([]);

    const res = await request(app)
      .post('/api/query')
      .send({ question: 'What is the meaning of life?' });

    expect(res.status).toBe(200);
    expect(res.body.answer).toMatch(/not covered in the current knowledge base/);
    expect(res.body.confidence).toBe('low');
    expect(res.body.sources).toHaveLength(0);
  });

  it('logs audit event with accessed document IDs', async () => {
    const sr1 = makeSearchResult();
    const sr2 = makeSearchResult({
      chunk: { ...makeSearchResult().chunk, id: 'chunk-2', documentId: 'doc-2' },
      document: { ...makeSearchResult().document, id: 'doc-2', originalName: 'Other.pdf' },
    });
    mockSearchVectorStore.mockResolvedValue([sr1, sr2]);

    await request(app)
      .post('/api/query')
      .send({ question: 'wheelchair procedures' });

    expect(logAuditEvent).toHaveBeenCalledWith(
      'user-1',
      'testuser',
      'query',
      expect.objectContaining({
        accessedDocumentIds: expect.arrayContaining(['doc-1', 'doc-2']),
        traceId: 'trace-123',
      }),
    );
  });

  it('enforces collection ACL for restricted users', async () => {
    // User is allowed only col-A
    (getUserAllowedCollections as any).mockResolvedValue(['col-A']);

    const sr = makeSearchResult();
    mockSearchVectorStore.mockResolvedValue([sr]);

    await request(app)
      .post('/api/query')
      .send({ question: 'test', collectionIds: ['col-A', 'col-B'] });

    // searchVectorStore should be called with collectionIds filtered to only col-A
    expect(mockSearchVectorStore).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(String),
      expect.objectContaining({ collectionIds: ['col-A'] }),
    );
  });

  it('allows admin to query any collection', async () => {
    // null means no restrictions (admin)
    (getUserAllowedCollections as any).mockResolvedValue(null);

    const sr = makeSearchResult();
    mockSearchVectorStore.mockResolvedValue([sr]);

    await request(app)
      .post('/api/query')
      .send({ question: 'test', collectionIds: ['col-X', 'col-Y'] });

    // collectionIds should pass through unfiltered
    expect(mockSearchVectorStore).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(String),
      expect.objectContaining({ collectionIds: ['col-X', 'col-Y'] }),
    );
  });
});

// ---------------------------------------------------------------------------
// Vector Store scoring tests have been moved to vectorStore.test.ts where they
// use REAL exported functions instead of re-implementations. This eliminates
// the risk of test logic diverging from production scoring code.
//
// See: vectorStore.test.ts for comprehensive tests of:
//   - cosineSimilarity, tokenize, buildIdfMap, bm25Score, reRankResults
//   - expandQueryWithSynonyms (medical synonym expansion)
//   - Dynamic avgDocLength, IDF cache invalidation
// ---------------------------------------------------------------------------

// Keeping a minimal integration-style test using real imports
import {
  cosineSimilarity as realCosine,
  buildIdfMap as realBuildIdf,
  bm25Score as realBm25,
} from '../services/vectorStore';

describe('Vector Store Search (real scoring functions)', () => {
  function makeStoredChunk(overrides: Partial<StoredChunk> = {}): StoredChunk {
    return {
      id: 'c-1', documentId: 'doc-1', chunkIndex: 0,
      text: 'Default chunk text about oxygen supply equipment and procedures for patient care.',
      tokenCount: 15, startOffset: 0, endOffset: 200, embedding: [0.5, 0.3, 0.1],
      ...overrides,
    };
  }

  it('scoring pipeline produces correct ranking using real functions', () => {
    const query = [0.9, 0.1, 0.0];
    const chunks = [
      makeStoredChunk({ id: 'c-1', embedding: [0.9, 0.1, 0.0], text: 'oxygen supply equipment and maintenance' }),
      makeStoredChunk({ id: 'c-2', embedding: [0.1, 0.9, 0.0], text: 'billing and insurance procedures for claims' }),
      makeStoredChunk({ id: 'c-3', embedding: [0.8, 0.2, 0.1], text: 'oxygen concentrator setup instructions manual' }),
    ];
    const { idf } = realBuildIdf(chunks);

    const rawScored = chunks.map(chunk => ({
      chunk,
      semanticScore: realCosine(query, chunk.embedding),
      keywordScore: realBm25('oxygen supply', chunk.text, idf),
    }));

    const maxBm25 = rawScored.reduce((max, r) => Math.max(max, r.keywordScore), 0);
    const scored = rawScored.map(({ chunk, semanticScore, keywordScore }) => ({
      chunk,
      score: 0.7 * semanticScore + 0.3 * (maxBm25 > 0 ? keywordScore / maxBm25 : 0),
    }));

    scored.sort((a, b) => b.score - a.score);
    expect(scored[0].chunk.id).toBe('c-1'); // Most similar to query
  });

  it('BM25 handles empty query via real function', () => {
    const chunks = [makeStoredChunk({ text: 'some content here about equipment.' })];
    const { idf } = realBuildIdf(chunks);
    expect(realBm25('', chunks[0].text, idf)).toBe(0);
  });

  it('cosine similarity handles zero vector via real function', () => {
    expect(realCosine([0, 0, 0], [0.5, 0.3, 0.1])).toBe(0);
  });
});
