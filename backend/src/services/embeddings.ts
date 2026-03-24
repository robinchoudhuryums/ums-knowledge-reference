/**
 * Embedding facade — delegates to the active EmbeddingProvider singleton.
 *
 * Existing consumers can continue importing { generateEmbedding, generateEmbeddingsBatch }
 * without changes. Consumers that need provider metadata (modelId, dimensions) can use
 * getEmbeddingProvider().
 */

import { EmbeddingProvider } from './embeddingProvider';
import { TitanEmbeddingProvider } from './titanEmbeddingProvider';

// Singleton provider instance
let provider: EmbeddingProvider | null = null;

function ensureProvider(): EmbeddingProvider {
  if (!provider) {
    provider = new TitanEmbeddingProvider();
  }
  return provider;
}

/**
 * Return the active embedding provider (for metadata access — modelId, dimensions).
 */
export function getEmbeddingProvider(): EmbeddingProvider {
  return ensureProvider();
}

/**
 * Generate an embedding vector for a single text.
 * Delegates to the active EmbeddingProvider.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  return ensureProvider().generateEmbedding(text);
}

/**
 * Generate embeddings for multiple texts in batches.
 * Returns embeddings in the same order as inputs.
 */
export async function generateEmbeddingsBatch(texts: string[]): Promise<number[][]> {
  return ensureProvider().generateEmbeddingsBatch(texts);
}
