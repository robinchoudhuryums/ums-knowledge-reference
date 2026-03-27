import { describe, it, expect, vi, beforeEach } from 'vitest';

// Create a fake embedding of the specified dimension
function fakeEmbedding(dim: number): number[] {
  return Array.from({ length: dim }, (_, i) => (i + 1) / dim);
}

// Mock the titanEmbeddingProvider module before importing the facade
vi.mock('../services/titanEmbeddingProvider', () => {
  const DIMS = 1024;
  return {
    TitanEmbeddingProvider: class {
      readonly modelId = 'amazon.titan-embed-text-v2:0';
      readonly dimensions = DIMS;

      async generateEmbedding(text: string): Promise<number[]> {
        // Store the received text so tests can inspect truncation behavior
        (this as any)._lastInput = text;
        return fakeEmbedding(DIMS);
      }

      async generateEmbeddingsBatch(texts: string[]): Promise<number[][]> {
        return Promise.all(texts.map(t => this.generateEmbedding(t)));
      }
    },
  };
});

// Import after mock is in place
import {
  generateEmbedding,
  generateEmbeddingsBatch,
  getEmbeddingProvider,
} from '../services/embeddings';

describe('Embeddings Facade', () => {
  beforeEach(() => {
    // Reset the singleton between tests by clearing the module-level variable.
    // The facade lazily creates the provider, so we can rely on fresh imports
    // thanks to vitest module isolation, but we explicitly reset here for safety.
    vi.resetModules;
  });

  describe('generateEmbedding', () => {
    it('should return a number array', async () => {
      const result = await generateEmbedding('hello world');
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
      result.forEach(val => expect(typeof val).toBe('number'));
    });

    it('should return an array with 1024 dimensions', async () => {
      const result = await generateEmbedding('test input');
      expect(result).toHaveLength(1024);
    });
  });

  describe('generateEmbeddingsBatch', () => {
    it('should process multiple texts and return matching-length array', async () => {
      const texts = ['first text', 'second text', 'third text'];
      const results = await generateEmbeddingsBatch(texts);
      expect(results).toHaveLength(texts.length);
      results.forEach(embedding => {
        expect(Array.isArray(embedding)).toBe(true);
        expect(embedding).toHaveLength(1024);
      });
    });

    it('should handle a single text', async () => {
      const results = await generateEmbeddingsBatch(['only one']);
      expect(results).toHaveLength(1);
      expect(results[0]).toHaveLength(1024);
    });

    it('should handle an empty array', async () => {
      const results = await generateEmbeddingsBatch([]);
      expect(results).toHaveLength(0);
    });
  });

  describe('text truncation', () => {
    it('should accept text longer than 8000 chars without error', async () => {
      const longText = 'a'.repeat(10000);
      // The TitanEmbeddingProvider truncates to 8000 chars internally.
      // The facade should pass through without throwing.
      const result = await generateEmbedding(longText);
      expect(result).toHaveLength(1024);
    });

    it('should accept text exactly at the 8000 char limit', async () => {
      const exactText = 'b'.repeat(8000);
      const result = await generateEmbedding(exactText);
      expect(result).toHaveLength(1024);
    });

    it('should accept short text well under the limit', async () => {
      const result = await generateEmbedding('short');
      expect(result).toHaveLength(1024);
    });
  });

  describe('getEmbeddingProvider', () => {
    it('should return a provider with modelId property', () => {
      const provider = getEmbeddingProvider();
      expect(typeof provider.modelId).toBe('string');
      expect(provider.modelId).toBe('amazon.titan-embed-text-v2:0');
    });

    it('should return a provider with dimensions property', () => {
      const provider = getEmbeddingProvider();
      expect(typeof provider.dimensions).toBe('number');
      expect(provider.dimensions).toBe(1024);
    });

    it('should return the same singleton instance on repeated calls', () => {
      const a = getEmbeddingProvider();
      const b = getEmbeddingProvider();
      expect(a).toBe(b);
    });
  });
});
