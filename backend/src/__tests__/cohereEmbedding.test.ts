/**
 * Tests for Cohere Embed English v3 provider.
 * Verifies the provider correctly formats API requests and parses responses.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Must use vi.hoisted so the mock fn is available before vi.mock factories run
const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }));

vi.mock('../config/aws', () => ({
  bedrockClient: { send: (...args: unknown[]) => mockSend(...args) },
  BEDROCK_EMBEDDING_MODEL: 'cohere.embed-english-v3',
}));

vi.mock('../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../utils/resilience', () => ({
  withRetry: vi.fn(async (fn: () => Promise<unknown>) => fn()),
}));

import { CohereEmbeddingProvider } from '../services/cohereEmbeddingProvider';

describe('CohereEmbeddingProvider', () => {
  let provider: CohereEmbeddingProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new CohereEmbeddingProvider('cohere.embed-english-v3');
  });

  it('has correct model ID and dimensions', () => {
    expect(provider.modelId).toBe('cohere.embed-english-v3');
    expect(provider.dimensions).toBe(1024);
  });

  it('generates a single query embedding with search_query input_type', async () => {
    const mockEmbedding = Array(1024).fill(0).map((_, i) => i / 1024);
    mockSend.mockResolvedValue({
      body: new TextEncoder().encode(JSON.stringify({
        embeddings: { float: [mockEmbedding] },
      })),
    });

    const result = await provider.generateEmbedding('What is CPAP coverage?');

    expect(result).toEqual(mockEmbedding);
    expect(result.length).toBe(1024);

    // Verify the API call used search_query input_type
    const callBody = JSON.parse(mockSend.mock.calls[0][0].input.body);
    expect(callBody.input_type).toBe('search_query');
    expect(callBody.texts).toEqual(['What is CPAP coverage?']);
  });

  it('generates batch document embeddings with search_document input_type', async () => {
    const texts = ['Document about oxygen', 'Document about wheelchairs', 'Document about CPAP'];
    const mockEmbeddings = texts.map((_, i) => Array(1024).fill(i / 1024));

    mockSend.mockResolvedValue({
      body: new TextEncoder().encode(JSON.stringify({
        embeddings: { float: mockEmbeddings },
      })),
    });

    const results = await provider.generateEmbeddingsBatch(texts);

    expect(results.length).toBe(3);
    expect(results[0].length).toBe(1024);

    // Verify batch call used search_document input_type
    const callBody = JSON.parse(mockSend.mock.calls[0][0].input.body);
    expect(callBody.input_type).toBe('search_document');
    expect(callBody.texts.length).toBe(3);
  });

  it('truncates text exceeding 8000 characters', async () => {
    const longText = 'x'.repeat(10000);
    mockSend.mockResolvedValue({
      body: new TextEncoder().encode(JSON.stringify({
        embeddings: { float: [Array(1024).fill(0)] },
      })),
    });

    await provider.generateEmbedding(longText);

    const callBody = JSON.parse(mockSend.mock.calls[0][0].input.body);
    expect(callBody.texts[0].length).toBe(8000);
  });

  it('handles Cohere response without nested float key', async () => {
    // Some Cohere versions return embeddings directly (not nested under float)
    mockSend.mockResolvedValue({
      body: new TextEncoder().encode(JSON.stringify({
        embeddings: [Array(1024).fill(0.5)],
      })),
    });

    const result = await provider.generateEmbedding('test');
    expect(result.length).toBe(1024);
    expect(result[0]).toBe(0.5);
  });

  it('handles empty batch gracefully', async () => {
    const results = await provider.generateEmbeddingsBatch([]);
    expect(results).toEqual([]);
  });
});
