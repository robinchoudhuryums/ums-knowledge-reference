/**
 * Embedding facade — delegates to the active EmbeddingProvider singleton.
 *
 * Existing consumers can continue importing { generateEmbedding, generateEmbeddingsBatch }
 * without changes. Consumers that need provider metadata (modelId, dimensions) can use
 * getEmbeddingProvider().
 *
 * Includes an LRU cache for query embeddings to avoid re-embedding identical queries.
 * This is especially useful for follow-up conversations where the reformulated query
 * may repeat, and for duplicate queries across users.
 */

import { EmbeddingProvider } from './embeddingProvider';
import { TitanEmbeddingProvider } from './titanEmbeddingProvider';
import { logger } from '../utils/logger';

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

// ---------------------------------------------------------------------------
// Query embedding LRU cache
// Caches recent query embeddings to avoid redundant Bedrock calls for repeated
// or reformulated queries. Keyed by normalized text. Max 200 entries (~800KB
// at 1024 dims × 4 bytes each). Only used for single-text queries (not batch
// ingestion) since ingestion texts are unique.
// ---------------------------------------------------------------------------
const QUERY_EMBEDDING_CACHE_MAX = 200;
const queryEmbeddingCache = new Map<string, number[]>();

function normalizeForCache(text: string): string {
  // Include model ID in cache key so cache is automatically invalidated on model change
  const modelId = ensureProvider().modelId;
  return `${modelId}:${text.toLowerCase().trim().replace(/\s+/g, ' ')}`;
}

/**
 * Generate an embedding vector for a single text.
 * Uses an LRU cache to avoid re-embedding identical or near-identical queries.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const cacheKey = normalizeForCache(text);

  // Check cache
  const cached = queryEmbeddingCache.get(cacheKey);
  if (cached) {
    // Move to end (most recently used) by re-inserting
    queryEmbeddingCache.delete(cacheKey);
    queryEmbeddingCache.set(cacheKey, cached);
    logger.info('Query embedding cache hit', { textLength: text.length });
    return cached;
  }

  // Generate fresh embedding
  const embedding = await ensureProvider().generateEmbedding(text);

  // Evict oldest entry if at capacity
  if (queryEmbeddingCache.size >= QUERY_EMBEDDING_CACHE_MAX) {
    const oldestKey = queryEmbeddingCache.keys().next().value;
    if (oldestKey !== undefined) {
      queryEmbeddingCache.delete(oldestKey);
    }
  }

  queryEmbeddingCache.set(cacheKey, embedding);
  return embedding;
}

/**
 * Generate embeddings for multiple texts in batches.
 * Returns embeddings in the same order as inputs.
 * Does NOT use the query cache — batch calls are for document ingestion
 * where each text is unique.
 */
export async function generateEmbeddingsBatch(texts: string[]): Promise<number[][]> {
  return ensureProvider().generateEmbeddingsBatch(texts);
}
