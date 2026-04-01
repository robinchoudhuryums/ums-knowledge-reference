/**
 * Embedding facade — delegates to the active EmbeddingProvider singleton.
 *
 * Includes a cache for query embeddings backed by the cache abstraction layer:
 * - Single instance: in-memory LRU (200 entries, ~800KB)
 * - Multi-instance: Redis (shared across instances, 1hr TTL)
 *
 * Only used for single-text queries (not batch ingestion) since ingestion texts
 * are unique and would just pollute the cache.
 */

import { EmbeddingProvider } from './embeddingProvider';
import { TitanEmbeddingProvider } from './titanEmbeddingProvider';
import { CohereEmbeddingProvider } from './cohereEmbeddingProvider';
import { BEDROCK_EMBEDDING_MODEL } from '../config/aws';
import { getCache } from '../cache';
import { logger } from '../utils/logger';

// Singleton provider instance
let provider: EmbeddingProvider | null = null;

/**
 * Auto-select embedding provider based on the configured model ID.
 * Supports Titan Embed V2 (default) and Cohere Embed English v3.
 */
function ensureProvider(): EmbeddingProvider {
  if (!provider) {
    const model = BEDROCK_EMBEDDING_MODEL;
    if (model.includes('cohere')) {
      provider = new CohereEmbeddingProvider(model);
      logger.info('Embedding provider: Cohere Embed', { model });
    } else {
      provider = new TitanEmbeddingProvider(model);
      logger.info('Embedding provider: Amazon Titan Embed', { model });
    }
  }
  return provider;
}

/**
 * Return the active embedding provider (for metadata access — modelId, dimensions).
 */
export function getEmbeddingProvider(): EmbeddingProvider {
  return ensureProvider();
}

const EMBEDDING_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function normalizeForCache(text: string): string {
  const modelId = ensureProvider().modelId;
  return `emb:${modelId}:${text.toLowerCase().trim().replace(/\s+/g, ' ')}`;
}

/**
 * Generate an embedding vector for a single text.
 * Uses the shared cache (in-memory or Redis) to avoid re-embedding identical queries.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const cacheKey = normalizeForCache(text);

  // Check cache
  try {
    const cached = await getCache().get<number[]>(cacheKey);
    if (cached) {
      logger.info('Query embedding cache hit', { textLength: text.length });
      return cached;
    }
  } catch {
    // Cache miss or error — proceed to generate
  }

  // Generate fresh embedding
  const embedding = await ensureProvider().generateEmbedding(text);

  // Store in cache (fire-and-forget)
  getCache().set(cacheKey, embedding, EMBEDDING_CACHE_TTL_MS).catch(() => {});

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
