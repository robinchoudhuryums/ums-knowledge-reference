/**
 * Embedding provider abstraction — allows swapping embedding models
 * without reindexing by tracking model metadata alongside vectors.
 */

export interface EmbeddingProvider {
  readonly modelId: string;
  readonly dimensions: number;
  generateEmbedding(text: string): Promise<number[]>;
  generateEmbeddingsBatch(texts: string[]): Promise<number[][]>;
}
