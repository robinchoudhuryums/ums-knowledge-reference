/**
 * Cohere Embed English v3 implementation of EmbeddingProvider.
 *
 * Advantages over Titan Embed V2 for medical/DME retrieval:
 * - Asymmetric search support via `input_type` parameter:
 *   "search_document" for indexing, "search_query" for queries
 *   (Titan treats all text identically, losing query-doc asymmetry)
 * - Better domain-specific retrieval on specialized vocabulary
 * - Same 1024 dimensions — drop-in replacement, no reindexing dimension change
 *
 * Model ID: cohere.embed-english-v3 (available on Bedrock)
 * Dimensions: 1024 (default, configurable down to 256)
 *
 * Config:
 *   BEDROCK_EMBEDDING_MODEL=cohere.embed-english-v3
 *
 * NOTE: After switching, existing documents must be re-indexed since
 * Titan and Cohere produce different embedding spaces. The vector store
 * tracks embeddingModel metadata to detect mismatches.
 */

import { InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { bedrockClient } from '../config/aws';
import { withRetry } from '../utils/resilience';
import { logger } from '../utils/logger';
import { EmbeddingProvider } from './embeddingProvider';

const BATCH_SIZE = 20;
const MAX_INPUT_CHARS = 8000;
// Cohere supports up to 96 texts per batch call — we batch at API level too
const COHERE_BATCH_LIMIT = 96;

export class CohereEmbeddingProvider implements EmbeddingProvider {
  readonly modelId: string;
  readonly dimensions: number = 1024;

  constructor(modelId?: string) {
    this.modelId = modelId ?? 'cohere.embed-english-v3';
  }

  /**
   * Generate embedding for a single query text.
   * Uses input_type="search_query" for asymmetric retrieval.
   */
  async generateEmbedding(text: string): Promise<number[]> {
    const truncated = text.slice(0, MAX_INPUT_CHARS);

    return withRetry(async () => {
      const command = new InvokeModelCommand({
        modelId: this.modelId,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
          texts: [truncated],
          input_type: 'search_query',
          embedding_types: ['float'],
        }),
      });

      const response = await bedrockClient.send(command);
      const body = JSON.parse(new TextDecoder().decode(response.body));

      // Cohere returns { embeddings: { float: [[...]] } } or { embeddings: [[...]] }
      const embeddings = body.embeddings?.float ?? body.embeddings;
      if (!embeddings?.[0]) {
        throw new Error('Cohere embedding response missing embeddings array');
      }
      return embeddings[0] as number[];
    }, { label: 'cohere-embedding' });
  }

  /**
   * Generate embeddings for multiple document texts.
   * Uses input_type="search_document" for asymmetric retrieval.
   * Cohere supports batch API — send multiple texts in one call.
   */
  async generateEmbeddingsBatch(texts: string[]): Promise<number[][]> {
    const allEmbeddings: number[][] = [];

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);

      logger.info('Generating Cohere embeddings batch', {
        batchStart: i,
        batchSize: batch.length,
        totalTexts: texts.length,
      });

      // Cohere's batch API supports up to 96 texts — use it for efficiency
      const truncatedBatch = batch.map(t => t.slice(0, MAX_INPUT_CHARS));

      // For batches within Cohere's limit, use a single API call
      if (truncatedBatch.length <= COHERE_BATCH_LIMIT) {
        const batchResult = await withRetry(async () => {
          const command = new InvokeModelCommand({
            modelId: this.modelId,
            contentType: 'application/json',
            accept: 'application/json',
            body: JSON.stringify({
              texts: truncatedBatch,
              input_type: 'search_document',
              embedding_types: ['float'],
            }),
          });

          const response = await bedrockClient.send(command);
          const body = JSON.parse(new TextDecoder().decode(response.body));
          const embeddings = body.embeddings?.float ?? body.embeddings;
          if (!embeddings || embeddings.length !== truncatedBatch.length) {
            throw new Error(`Cohere batch response length mismatch: expected ${truncatedBatch.length}, got ${embeddings?.length}`);
          }
          return embeddings as number[][];
        }, { label: 'cohere-embedding-batch' });

        allEmbeddings.push(...batchResult);
      } else {
        // Fallback: individual calls for oversized batches
        const results = await Promise.all(
          truncatedBatch.map(text => this.generateDocumentEmbedding(text))
        );
        allEmbeddings.push(...results);
      }
    }

    return allEmbeddings;
  }

  /**
   * Generate embedding for a single document text (for indexing).
   * Uses input_type="search_document" instead of "search_query".
   */
  private async generateDocumentEmbedding(text: string): Promise<number[]> {
    return withRetry(async () => {
      const command = new InvokeModelCommand({
        modelId: this.modelId,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
          texts: [text.slice(0, MAX_INPUT_CHARS)],
          input_type: 'search_document',
          embedding_types: ['float'],
        }),
      });

      const response = await bedrockClient.send(command);
      const body = JSON.parse(new TextDecoder().decode(response.body));
      const embeddings = body.embeddings?.float ?? body.embeddings;
      return embeddings[0] as number[];
    }, { label: 'cohere-doc-embedding' });
  }
}
