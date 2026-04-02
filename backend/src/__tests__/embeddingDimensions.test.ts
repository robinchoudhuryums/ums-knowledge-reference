/**
 * Tests for embedding dimension validation, mismatch detection, and reindex.
 *
 * Uses vi.resetModules() between test groups because vectorStore.ts has module-level
 * cached state (cachedIndex) that persists across initializeVectorStore() calls.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DocumentChunk, VectorStoreIndex } from '../types';

// Shared mock provider — mutated per test to simulate different model configs
const mockProvider = {
  modelId: 'amazon.titan-embed-text-v2:0',
  dimensions: 1024,
  generateEmbedding: vi.fn(),
  generateEmbeddingsBatch: vi.fn(),
};

// Shared mock for loadVectorIndex — controls what index initializeVectorStore sees
const mockLoadVectorIndex = vi.fn().mockResolvedValue(null);
const mockSaveVectorIndex = vi.fn().mockResolvedValue(undefined);

// Register mocks before any imports (these persist across resetModules)
vi.mock('../services/s3Storage', () => ({
  loadVectorIndex: mockLoadVectorIndex,
  saveVectorIndex: mockSaveVectorIndex,
  getDocumentsIndex: vi.fn().mockResolvedValue([]),
}));
vi.mock('../services/embeddings', () => ({
  getEmbeddingProvider: vi.fn(() => mockProvider),
}));
vi.mock('../db', () => ({
  useRds: vi.fn().mockResolvedValue(false),
  dbAddChunks: vi.fn(),
  dbRemoveDocumentChunks: vi.fn(),
  dbSearchVectorStore: vi.fn(),
  dbSearchChunksByKeyword: vi.fn(),
  dbGetVectorStoreStats: vi.fn(),
}));
vi.mock('../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function makeChunk(overrides: Partial<DocumentChunk> = {}): DocumentChunk {
  return {
    id: 'chunk-1',
    documentId: 'doc-1',
    chunkIndex: 0,
    text: 'Sample text for testing',
    tokenCount: 5,
    startOffset: 0,
    endOffset: 23,
    ...overrides,
  };
}

describe('Embedding Dimension Validation — addChunksToStore', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockProvider.modelId = 'amazon.titan-embed-text-v2:0';
    mockProvider.dimensions = 1024;
    mockLoadVectorIndex.mockResolvedValue(null);
  });

  it('rejects embeddings with wrong dimensions', async () => {
    const { addChunksToStore, initializeVectorStore } = await import('../services/vectorStore');
    await initializeVectorStore();

    const chunk = makeChunk();
    const wrongDimEmbedding = new Array(768).fill(0.1);

    await expect(addChunksToStore([chunk], [wrongDimEmbedding])).rejects.toThrow(
      /dimension mismatch on chunk 0.*got 768.*expects 1024/
    );
  });

  it('accepts embeddings with correct dimensions', async () => {
    const { addChunksToStore, initializeVectorStore } = await import('../services/vectorStore');
    await initializeVectorStore();

    const chunk = makeChunk();
    const correctEmbedding = new Array(1024).fill(0.1);

    await expect(addChunksToStore([chunk], [correctEmbedding])).resolves.not.toThrow();
    expect(mockSaveVectorIndex).toHaveBeenCalled();
  });
});

describe('Embedding Model Mismatch Detection', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockProvider.modelId = 'amazon.titan-embed-text-v2:0';
    mockProvider.dimensions = 1024;
  });

  it('detects dimension mismatch on init when stored index uses different model', async () => {
    const storedIndex: VectorStoreIndex = {
      version: 1,
      lastUpdated: '2025-01-01T00:00:00Z',
      chunks: [{
        id: 'old-chunk', documentId: 'doc-1', chunkIndex: 0,
        text: 'old text', tokenCount: 2, startOffset: 0, endOffset: 8,
        embedding: new Array(768).fill(0.1),
      }],
      embeddingModel: 'amazon.titan-embed-text-v1:0',
      embeddingDimensions: 768,
    };
    mockLoadVectorIndex.mockResolvedValue(storedIndex);

    const { initializeVectorStore, getVectorStoreStats } = await import('../services/vectorStore');
    await initializeVectorStore();

    const stats = await getVectorStoreStats();
    expect(stats.modelMismatch).toBeDefined();
    expect(stats.modelMismatch!.storedDims).toBe(768);
    expect(stats.modelMismatch!.currentDims).toBe(1024);
    expect(stats.modelMismatch!.requiresReindex).toBe(true);
  });

  it('reports no mismatch when dimensions match', async () => {
    const storedIndex: VectorStoreIndex = {
      version: 1,
      lastUpdated: '2025-01-01T00:00:00Z',
      chunks: [{
        id: 'chunk-1', documentId: 'doc-1', chunkIndex: 0,
        text: 'text', tokenCount: 1, startOffset: 0, endOffset: 4,
        embedding: new Array(1024).fill(0.1),
      }],
      embeddingModel: 'amazon.titan-embed-text-v2:0',
      embeddingDimensions: 1024,
    };
    mockLoadVectorIndex.mockResolvedValue(storedIndex);

    const { initializeVectorStore, getVectorStoreStats } = await import('../services/vectorStore');
    await initializeVectorStore();

    const stats = await getVectorStoreStats();
    expect(stats.modelMismatch).toBeUndefined();
  });
});

describe('reindexAllEmbeddings', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockProvider.modelId = 'amazon.titan-embed-text-v2:0';
    mockProvider.dimensions = 1024;
  });

  it('re-embeds all chunks with the current model', async () => {
    const storedIndex: VectorStoreIndex = {
      version: 1,
      lastUpdated: '2025-01-01T00:00:00Z',
      chunks: [
        { id: 'c1', documentId: 'doc-1', chunkIndex: 0, text: 'chunk one', tokenCount: 2, startOffset: 0, endOffset: 9, embedding: new Array(768).fill(0.1) },
        { id: 'c2', documentId: 'doc-1', chunkIndex: 1, text: 'chunk two', tokenCount: 2, startOffset: 10, endOffset: 19, embedding: new Array(768).fill(0.2) },
        { id: 'c3', documentId: 'doc-2', chunkIndex: 0, text: 'chunk three', tokenCount: 2, startOffset: 0, endOffset: 11, embedding: new Array(768).fill(0.3) },
      ],
      embeddingModel: 'old-model',
      embeddingDimensions: 768,
    };
    mockLoadVectorIndex.mockResolvedValue(storedIndex);

    const newEmbedding = new Array(1024).fill(0.5);
    // doc-1 has 2 chunks, doc-2 has 1 — each call returns embeddings for one document
    mockProvider.generateEmbeddingsBatch
      .mockResolvedValueOnce([newEmbedding, newEmbedding])  // doc-1
      .mockResolvedValueOnce([newEmbedding]);                // doc-2

    const { initializeVectorStore, reindexAllEmbeddings, getVectorStoreStats } = await import('../services/vectorStore');
    await initializeVectorStore();
    const result = await reindexAllEmbeddings();

    expect(result.reindexedChunks).toBe(3);
    expect(result.errors).toHaveLength(0);
    expect(mockSaveVectorIndex).toHaveBeenCalled();

    // Verify mismatch is cleared after reindex
    const stats = await getVectorStoreStats();
    expect(stats.modelMismatch).toBeUndefined();
    expect(stats.embeddingModel).toBe('amazon.titan-embed-text-v2:0');
    expect(stats.embeddingDimensions).toBe(1024);
  });

  it('handles partial failures during reindex', async () => {
    const storedIndex: VectorStoreIndex = {
      version: 1,
      lastUpdated: '2025-01-01T00:00:00Z',
      chunks: [
        { id: 'c1', documentId: 'doc-ok', chunkIndex: 0, text: 'ok', tokenCount: 1, startOffset: 0, endOffset: 2, embedding: new Array(768).fill(0.1) },
        { id: 'c2', documentId: 'doc-fail', chunkIndex: 0, text: 'fail', tokenCount: 1, startOffset: 0, endOffset: 4, embedding: new Array(768).fill(0.2) },
      ],
      embeddingModel: 'old-model',
      embeddingDimensions: 768,
    };
    mockLoadVectorIndex.mockResolvedValue(storedIndex);

    const newEmbedding = new Array(1024).fill(0.5);
    mockProvider.generateEmbeddingsBatch
      .mockResolvedValueOnce([newEmbedding])                  // doc-ok succeeds
      .mockRejectedValueOnce(new Error('Bedrock throttled')); // doc-fail fails

    const { initializeVectorStore, reindexAllEmbeddings } = await import('../services/vectorStore');
    await initializeVectorStore();
    const result = await reindexAllEmbeddings();

    expect(result.reindexedChunks).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/doc-fail.*Bedrock throttled/);
  });
});
