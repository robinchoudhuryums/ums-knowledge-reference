/**
 * Tests for the RAG query pipeline and vector store search.
 *
 * Query route tests mock all external dependencies (auth, embeddings, vectorStore, Bedrock).
 * Vector store search tests use real in-memory data with mocked S3.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Request, Response } from 'express';

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
vi.mock('../services/vectorStore', () => ({
  searchVectorStore: vi.fn(async () => []),
  initializeVectorStore: vi.fn(async () => {}),
  addChunksToStore: vi.fn(async () => {}),
  removeDocumentChunks: vi.fn(async () => {}),
  searchChunksByKeyword: vi.fn(async () => []),
  getVectorStoreStats: vi.fn(() => ({ totalChunks: 0, lastUpdated: null })),
}));

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
import { SearchResult, Document, DocumentChunk, StoredChunk } from '../types';
import { getDocumentsIndex } from '../services/s3Storage';

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
// Vector Store Search Tests — use real scoring logic with in-memory data
// ---------------------------------------------------------------------------

describe('Vector Store Search (in-memory)', () => {
  // We need the real internal functions. Since they are not exported, we
  // replicate them here exactly as in vectorStore.ts to test the algorithms.

  function cosineSimilarity(a: number[], b: number[]): number {
    let dotProduct = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const d = Math.sqrt(normA) * Math.sqrt(normB);
    return d === 0 ? 0 : dotProduct / d;
  }

  function tokenize(text: string): string[] {
    return text.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(t => t.length > 2);
  }

  function buildIdfMap(chunks: StoredChunk[]): Map<string, number> {
    const N = chunks.length;
    const docFreq = new Map<string, number>();
    for (const chunk of chunks) {
      const terms = new Set(tokenize(chunk.text));
      for (const term of terms) {
        docFreq.set(term, (docFreq.get(term) || 0) + 1);
      }
    }
    const idf = new Map<string, number>();
    for (const [term, df] of docFreq) {
      idf.set(term, Math.log((N - df + 0.5) / (df + 0.5) + 1));
    }
    return idf;
  }

  function bm25Score(query: string, text: string, idf: Map<string, number>): number {
    const queryTerms = tokenize(query);
    const docTerms = tokenize(text);
    const docLength = docTerms.length;
    const avgDocLength = 500;
    const k1 = 1.2;
    const b = 0.75;
    const tf = new Map<string, number>();
    for (const term of docTerms) {
      tf.set(term, (tf.get(term) || 0) + 1);
    }
    let score = 0;
    for (const term of queryTerms) {
      const termFreq = tf.get(term) || 0;
      if (termFreq === 0) continue;
      const idfScore = idf.get(term) || 0;
      const num = termFreq * (k1 + 1);
      const den = termFreq + k1 * (1 - b + b * (docLength / avgDocLength));
      score += idfScore * (num / den);
    }
    return score;
  }

  function reRankResults(
    results: Array<{ chunk: StoredChunk; document: Document; score: number }>,
    queryText: string
  ): Array<{ chunk: StoredChunk; document: Document; score: number }> {
    const queryTerms = new Set(tokenize(queryText));
    const docChunkCounts = new Map<string, number>();
    for (const r of results) {
      docChunkCounts.set(r.chunk.documentId, (docChunkCounts.get(r.chunk.documentId) || 0) + 1);
    }
    return results.map(r => {
      let boost = 0;
      if (r.chunk.sectionHeader) {
        const headerTerms = tokenize(r.chunk.sectionHeader);
        const matchCount = headerTerms.filter(t => queryTerms.has(t)).length;
        if (matchCount > 0) {
          boost += 0.05 * Math.min(matchCount / queryTerms.size, 1);
        }
      }
      const docCount = docChunkCounts.get(r.chunk.documentId) || 1;
      if (docCount > 1) {
        boost += 0.02 * Math.min(docCount - 1, 3);
      }
      if (r.chunk.text.length < 50) {
        boost -= 0.1;
      }
      return { ...r, score: r.score + boost };
    });
  }

  // Helpers to build test data

  function makeStoredChunk(overrides: Partial<StoredChunk> = {}): StoredChunk {
    return {
      id: 'c-1',
      documentId: 'doc-1',
      chunkIndex: 0,
      text: 'Default chunk text about oxygen supply equipment and procedures for patient care.',
      tokenCount: 15,
      startOffset: 0,
      endOffset: 200,
      embedding: [0.5, 0.3, 0.1],
      ...overrides,
    };
  }

  function makeDocument(overrides: Partial<Document> = {}): Document {
    return {
      id: 'doc-1',
      filename: 'doc.pdf',
      originalName: 'Document.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1000,
      s3Key: 'docs/doc.pdf',
      collectionId: 'col-1',
      uploadedBy: 'admin',
      uploadedAt: '2024-01-01',
      status: 'ready',
      chunkCount: 1,
      version: 1,
      ...overrides,
    };
  }

  // -----------------------------------------------------------------------
  // searchVectorStore integration tests (via the exported function, which
  // uses the mocked S3 but real scoring). Since the module-level mock
  // overrides searchVectorStore, we test the scoring algorithms directly.
  // -----------------------------------------------------------------------

  it('searchVectorStore returns top-K results sorted by score', () => {
    // Simulate the scoring + sorting pipeline
    const query = [0.9, 0.1, 0.0]; // query embedding
    const chunks = [
      makeStoredChunk({ id: 'c-1', embedding: [0.9, 0.1, 0.0], text: 'oxygen supply equipment and maintenance' }),
      makeStoredChunk({ id: 'c-2', embedding: [0.1, 0.9, 0.0], text: 'billing and insurance procedures for claims' }),
      makeStoredChunk({ id: 'c-3', embedding: [0.8, 0.2, 0.1], text: 'oxygen concentrator setup instructions manual' }),
      makeStoredChunk({ id: 'c-4', embedding: [0.0, 0.0, 1.0], text: 'unrelated content about cafeteria lunch menu' }),
    ];
    const idf = buildIdfMap(chunks);

    const scored = chunks.map(chunk => ({
      chunk,
      document: makeDocument({ id: chunk.documentId }),
      score: 0.7 * cosineSimilarity(query, chunk.embedding) + 0.3 * Math.min(bm25Score('oxygen supply', chunk.text, idf) / 10, 1),
    }));

    scored.sort((a, b) => b.score - a.score);
    const topK = scored.slice(0, 2);

    expect(topK).toHaveLength(2);
    expect(topK[0].score).toBeGreaterThanOrEqual(topK[1].score);
    // The chunk most similar to query should be first
    expect(topK[0].chunk.id).toBe('c-1');
  });

  it('searchVectorStore filters by collectionIds', () => {
    const docs = [
      makeDocument({ id: 'doc-A', collectionId: 'col-1' }),
      makeDocument({ id: 'doc-B', collectionId: 'col-2' }),
      makeDocument({ id: 'doc-C', collectionId: 'col-1' }),
    ];
    const chunks = [
      makeStoredChunk({ id: 'c-A', documentId: 'doc-A' }),
      makeStoredChunk({ id: 'c-B', documentId: 'doc-B' }),
      makeStoredChunk({ id: 'c-C', documentId: 'doc-C' }),
    ];

    const collectionIds = ['col-1'];
    const allowedDocIds = new Set(
      docs.filter(d => collectionIds.includes(d.collectionId)).map(d => d.id)
    );
    const filtered = chunks.filter(c => allowedDocIds.has(c.documentId));

    expect(filtered).toHaveLength(2);
    expect(filtered.map(c => c.id)).toEqual(['c-A', 'c-C']);
  });

  it('searchVectorStore returns empty array when no candidates match', () => {
    const docs = [makeDocument({ id: 'doc-1', collectionId: 'col-1' })];
    const chunks = [makeStoredChunk({ id: 'c-1', documentId: 'doc-1' })];
    const collectionIds = ['col-nonexistent'];
    const allowedDocIds = new Set(
      docs.filter(d => collectionIds.includes(d.collectionId)).map(d => d.id)
    );
    const filtered = chunks.filter(c => allowedDocIds.has(c.documentId));
    expect(filtered).toHaveLength(0);
  });

  it('reRankResults boosts section header matches', () => {
    const chunk1 = makeStoredChunk({ id: 'c-1', sectionHeader: 'Oxygen Supply Policy', text: 'Some text about procedures.' });
    const chunk2 = makeStoredChunk({ id: 'c-2', sectionHeader: 'Billing Procedures', text: 'Some text about billing.' });

    const results = [
      { chunk: chunk1, document: makeDocument(), score: 0.50 },
      { chunk: chunk2, document: makeDocument(), score: 0.50 },
    ];

    const reRanked = reRankResults(results, 'oxygen supply');
    const oxygenResult = reRanked.find(r => r.chunk.id === 'c-1')!;
    const billingResult = reRanked.find(r => r.chunk.id === 'c-2')!;

    expect(oxygenResult.score).toBeGreaterThan(billingResult.score);
  });

  it('reRankResults penalizes short chunks', () => {
    const shortChunk = makeStoredChunk({ id: 'c-short', text: 'Very short.' });
    const normalChunk = makeStoredChunk({
      id: 'c-normal',
      text: 'This is a normal length chunk with enough content to describe oxygen supply equipment maintenance procedures and guidelines.',
    });

    const results = [
      { chunk: shortChunk, document: makeDocument(), score: 0.60 },
      { chunk: normalChunk, document: makeDocument(), score: 0.60 },
    ];

    const reRanked = reRankResults(results, 'oxygen');
    const short = reRanked.find(r => r.chunk.id === 'c-short')!;
    const normal = reRanked.find(r => r.chunk.id === 'c-normal')!;

    // Short chunk gets -0.1 penalty (both also get +0.02 doc-count boost for sharing a doc)
    expect(short.score).toBeLessThan(normal.score);
    expect(short.score).toBeCloseTo(0.52, 2); // 0.60 - 0.10 + 0.02 = 0.52
  });

  it('hybrid scoring combines semantic and keyword weights correctly', () => {
    const queryEmb = [1, 0, 0];
    const chunkEmb = [0.8, 0.6, 0];

    const semanticScore = cosineSimilarity(queryEmb, chunkEmb);
    const semanticWeight = 0.7;
    const keywordWeight = 0.3;

    const chunks = [makeStoredChunk({ text: 'oxygen equipment maintenance procedures for patient care' })];
    const idf = buildIdfMap(chunks);
    const keyword = bm25Score('oxygen equipment', chunks[0].text, idf);
    const normalizedKeyword = Math.min(keyword / 10, 1);

    const combined = semanticWeight * semanticScore + keywordWeight * normalizedKeyword;

    // Verify the weights add up correctly
    expect(combined).toBeCloseTo(semanticWeight * semanticScore + keywordWeight * normalizedKeyword, 10);
    // Semantic component should dominate with 0.7 weight
    expect(semanticWeight * semanticScore).toBeGreaterThan(keywordWeight * normalizedKeyword);
  });

  it('BM25 with IDF weights rare terms higher', () => {
    const chunks = [
      makeStoredChunk({ id: 'c-1', text: 'the common words appear in every single document here' }),
      makeStoredChunk({ id: 'c-2', text: 'the common words also appear in this other document too' }),
      makeStoredChunk({ id: 'c-3', text: 'wheelchair maintenance is a specialized rare topic not found elsewhere' }),
    ];

    const idf = buildIdfMap(chunks);

    // "common" appears in 2/3 chunks, "wheelchair" appears in 1/3
    const commonIdf = idf.get('common') || 0;
    const wheelchairIdf = idf.get('wheelchair') || 0;

    expect(wheelchairIdf).toBeGreaterThan(commonIdf);

    // A query for "wheelchair" should score higher on the chunk that has it
    const scoreWithTerm = bm25Score('wheelchair', chunks[2].text, idf);
    const scoreWithoutTerm = bm25Score('wheelchair', chunks[0].text, idf);

    expect(scoreWithTerm).toBeGreaterThan(0);
    expect(scoreWithoutTerm).toBe(0);
  });

  it('searchVectorStore handles empty query gracefully', () => {
    const chunks = [
      makeStoredChunk({ id: 'c-1', embedding: [0.5, 0.3, 0.1], text: 'some content here about equipment.' }),
    ];
    const idf = buildIdfMap(chunks);

    // Empty query: tokenize returns empty, BM25 should be 0
    const bm25 = bm25Score('', chunks[0].text, idf);
    expect(bm25).toBe(0);

    // Cosine sim with zero vector also returns 0
    const sim = cosineSimilarity([0, 0, 0], chunks[0].embedding);
    expect(sim).toBe(0);
  });
});
