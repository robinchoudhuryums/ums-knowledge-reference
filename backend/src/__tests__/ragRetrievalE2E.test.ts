/**
 * End-to-end RAG retrieval test (S2-3 / top-10 item #8).
 *
 * Exercises the full combined-score pipeline on the S3 in-memory path:
 *   addChunksToStore → searchVectorStore → cosine + BM25 + reRank
 *
 * Uses hand-crafted embeddings with known similarity relationships so
 * we can assert ranking correctness without any Bedrock calls.
 *
 * WHY THIS MATTERS: unit tests cover cosine, BM25, and reRank individually.
 * No test previously validated that they *compose* correctly — a bug in
 * normalization, synonym expansion, or NaN guards would only surface in
 * production queries returning nonsensical order.
 *
 * COVERAGE: exercises searchVectorStore's full S3 path including:
 *   - IDF build from corpus
 *   - Synonym expansion
 *   - Cosine + BM25 combined scoring with adaptive weights
 *   - Dynamic BM25 normalization (max-of-set)
 *   - NaN guard on combined score
 *   - reRankResults (header boost, document frequency boost, short-chunk penalty, dedup)
 *   - Collection filter
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mock external dependencies but NOT the vector store itself ─────────────

// Prevent RDS path so the S3 in-memory path is exercised
vi.mock('../db/index', () => ({
  useRds: vi.fn(async () => false),
}));

// Mock the embedding provider to accept our small test dimension (DIM=8)
// instead of requiring real Titan 1024-dim vectors.
const DIM = 8;
vi.mock('../services/embeddings', () => ({
  generateEmbedding: vi.fn(async () => new Array(DIM).fill(0.1)),
  generateEmbeddingsBatch: vi.fn(async (texts: string[]) => texts.map(() => new Array(DIM).fill(0.1))),
  getEmbeddingProvider: vi.fn(() => ({
    modelId: 'test-model',
    dimensions: DIM,
    generateEmbedding: vi.fn(async () => new Array(DIM).fill(0.1)),
    generateEmbeddingsBatch: vi.fn(async (texts: string[]) => texts.map(() => new Array(DIM).fill(0.1))),
  })),
}));

// S3 storage: provide a functional in-memory metadata/index layer
const s3Store = new Map<string, string>();
vi.mock('../services/s3Storage', () => ({
  loadVectorIndex: vi.fn(async () => {
    const raw = s3Store.get('vector-index');
    return raw ? JSON.parse(raw) : null;
  }),
  saveVectorIndex: vi.fn(async (index: unknown) => {
    s3Store.set('vector-index', JSON.stringify(index));
  }),
  getDocumentsIndex: vi.fn(async () => {
    const raw = s3Store.get('documents-index');
    return raw ? JSON.parse(raw) : [];
  }),
  saveDocumentsIndex: vi.fn(async (docs: unknown) => {
    s3Store.set('documents-index', JSON.stringify(docs));
  }),
}));

// Cross-encoder disabled (separate test scope)
vi.mock('../services/crossEncoderRerank', () => ({
  isCrossEncoderEnabled: vi.fn(() => false),
  crossEncoderRerank: vi.fn(async (candidates: unknown[]) => candidates),
}));

vi.mock('../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ─── Helpers ────────────────────────────────────────────────────────────────

import type { Document, DocumentChunk } from '../types';

/** Create a unit-ish vector pointing mostly along axis `i`. */
function basisVec(i: number, dim = DIM): number[] {
  const v = new Array(dim).fill(0.05);
  v[i % dim] = 0.95;
  return v;
}

function makeChunk(id: string, docId: string, text: string, sectionHeader?: string): DocumentChunk {
  return {
    id,
    documentId: docId,
    chunkIndex: 0,
    text,
    tokenCount: text.split(/\s+/).length,
    startOffset: 0,
    endOffset: text.length,
    sectionHeader,
  };
}

function makeDoc(id: string, collectionId: string, name: string): Document {
  return {
    id,
    filename: `${name}.pdf`,
    originalName: `${name}.pdf`,
    mimeType: 'application/pdf',
    sizeBytes: 1000,
    s3Key: `documents/${collectionId}/${id}.pdf`,
    collectionId,
    uploadedBy: 'test',
    uploadedAt: new Date().toISOString(),
    status: 'ready',
    chunkCount: 1,
    version: 1,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('E2E RAG retrieval — full pipeline (S2-3)', () => {
  beforeEach(() => {
    s3Store.clear();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    // Reset the in-memory cached index so each test starts fresh.
    // The module-level `cachedIndex` is private, so we reinitialize by
    // calling initializeVectorStore with a clean store.
    s3Store.clear();
    const vs = await import('../services/vectorStore');
    await vs.initializeVectorStore();
  });

  it('ranks a semantically close chunk above distant ones', async () => {
    const vs = await import('../services/vectorStore');
    const s3 = await import('../services/s3Storage');

    // Register documents FIRST so the store can resolve doc metadata during add + search
    const docs = [makeDoc('d1', 'col-1', 'oxygen-policy'), makeDoc('d2', 'col-1', 'dme-guide')];
    (s3.getDocumentsIndex as ReturnType<typeof vi.fn>).mockResolvedValue(docs);

    // Seed 4 chunks with 4 different embedding directions
    const chunks: DocumentChunk[] = [
      makeChunk('c1', 'd1', 'Home oxygen coverage requires SpO2 below 88 percent on arterial blood gas.'),
      makeChunk('c2', 'd1', 'CPAP compliance must be demonstrated within 90 days of setup.'),
      makeChunk('c3', 'd2', 'Hospital beds require a face-to-face exam and physician order.'),
      makeChunk('c4', 'd2', 'Wheelchair group 1 vs group 2 depends on mobility assessment results.'),
    ];
    const embeddings = [basisVec(0), basisVec(1), basisVec(2), basisVec(3)];

    await vs.addChunksToStore(chunks, embeddings);

    // Query with embedding close to c1 (oxygen)
    const results = await vs.searchVectorStore(basisVec(0), 'oxygen SpO2 coverage', { topK: 4 });

    expect(results.length).toBeGreaterThanOrEqual(1);
    // c1 (oxygen) should be the top result — its embedding is closest and
    // its text has BM25-matching keywords.
    expect(results[0].chunk.id).toBe('c1');
    expect(results[0].score).toBeGreaterThan(0);

    // Scores should be monotonically non-increasing
    for (let i = 1; i < results.length; i++) {
      expect(results[i].score).toBeLessThanOrEqual(results[i - 1].score);
    }
  });

  it('applies collection filter correctly', async () => {
    const vs = await import('../services/vectorStore');
    const s3 = await import('../services/s3Storage');

    const chunks: DocumentChunk[] = [
      makeChunk('c-a', 'doc-a', 'Oxygen therapy for COPD patients.'),
      makeChunk('c-b', 'doc-b', 'Wheelchair maintenance procedures.'),
    ];
    const embeddings = [basisVec(0), basisVec(1)];

    const docs = [
      makeDoc('doc-a', 'lcd-policies', 'oxygen-lcd'),
      makeDoc('doc-b', 'internal-sops', 'wheelchair-sop'),
    ];
    (s3.getDocumentsIndex as ReturnType<typeof vi.fn>).mockResolvedValue(docs);

    await vs.addChunksToStore(chunks, embeddings);

    // Search restricted to lcd-policies — should only return c-a
    const results = await vs.searchVectorStore(
      basisVec(0),
      'oxygen',
      { topK: 10, collectionIds: ['lcd-policies'] },
    );

    expect(results.length).toBe(1);
    expect(results[0].chunk.id).toBe('c-a');
  });

  it('returns empty array when no chunks match the collection filter', async () => {
    const vs = await import('../services/vectorStore');
    const s3 = await import('../services/s3Storage');

    const chunks: DocumentChunk[] = [
      makeChunk('c-1', 'd-1', 'Some medical text.'),
    ];
    await vs.addChunksToStore(chunks, [basisVec(0)]);

    const docs = [makeDoc('d-1', 'col-x', 'doc')];
    (s3.getDocumentsIndex as ReturnType<typeof vi.fn>).mockResolvedValue(docs);

    const results = await vs.searchVectorStore(
      basisVec(0),
      'medical',
      { collectionIds: ['nonexistent-collection'] },
    );
    expect(results).toEqual([]);
  });

  it('NaN guard prevents degenerate inputs from corrupting scores (INV-27)', async () => {
    const vs = await import('../services/vectorStore');
    const s3 = await import('../services/s3Storage');

    // A zero-vector embedding produces NaN cosine similarity.
    // The combined-score NaN guard (line ~849) should clamp it to a finite
    // number (cosine=NaN → 0, but BM25 keyword matching still contributes).
    const zeroVec = new Array(DIM).fill(0);
    (s3.getDocumentsIndex as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeDoc('d-nan', 'col', 'doc'),
    ]);

    const chunks: DocumentChunk[] = [
      makeChunk('c-nan', 'd-nan', 'Test chunk for NaN guard.'),
    ];
    await vs.addChunksToStore(chunks, [zeroVec]);

    const results = await vs.searchVectorStore(zeroVec, 'test', { topK: 1 });
    expect(results.length).toBe(1);
    // Score must be finite (not NaN) — the NaN cosine was guarded.
    // BM25 may still contribute a small non-zero score from keyword match.
    expect(Number.isFinite(results[0].score)).toBe(true);
  });

  it('reRank boosts chunks with section-header matches', async () => {
    const vs = await import('../services/vectorStore');
    const s3 = await import('../services/s3Storage');

    (s3.getDocumentsIndex as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeDoc('d1', 'col', 'oxygen-doc'),
    ]);

    // Two chunks with IDENTICAL embeddings and nearly identical text so
    // base cosine + BM25 scores are as close as possible. The ONLY
    // differentiator is the sectionHeader on c-with-header, which reRank
    // boosts by +5% for query-term overlap.
    const sameEmb = basisVec(0);
    const chunks: DocumentChunk[] = [
      makeChunk('c-no-header', 'd1', 'Oxygen coverage criteria details for home use', undefined),
      makeChunk('c-with-header', 'd1', 'Oxygen coverage criteria details for home use', 'Oxygen Coverage'),
    ];
    await vs.addChunksToStore(chunks, [sameEmb, sameEmb]);

    const results = await vs.searchVectorStore(basisVec(0), 'oxygen coverage', { topK: 2 });

    // Both returned — the one WITH a header containing "oxygen" + "coverage"
    // should be ranked first due to reRank header boost.
    expect(results.length).toBe(2);
    expect(results[0].chunk.id).toBe('c-with-header');
  });

  it('throws on embedding dimension mismatch', async () => {
    const vs = await import('../services/vectorStore');
    const s3 = await import('../services/s3Storage');

    const chunks: DocumentChunk[] = [
      makeChunk('c-dim', 'd-dim', 'Text'),
    ];
    await vs.addChunksToStore(chunks, [basisVec(0)]); // DIM=8
    (s3.getDocumentsIndex as ReturnType<typeof vi.fn>).mockResolvedValue([
      makeDoc('d-dim', 'col', 'doc'),
    ]);

    // Query with a different dimension (4 instead of 8) — should throw per INV-15
    const wrongDim = [0.1, 0.2, 0.3, 0.4];
    await expect(
      vs.searchVectorStore(wrongDim, 'text', { topK: 1 }),
    ).rejects.toThrow(/dimension mismatch/i);
  });
});
