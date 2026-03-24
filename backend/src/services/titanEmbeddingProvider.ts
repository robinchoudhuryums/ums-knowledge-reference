/**
 * Amazon Titan Embed V2 implementation of EmbeddingProvider.
 * Extracted from embeddings.ts for provider-agnostic embedding support.
 */

import { InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { bedrockClient, BEDROCK_EMBEDDING_MODEL } from '../config/aws';
import { withRetry } from '../utils/resilience';
import { logger } from '../utils/logger';
import { EmbeddingProvider } from './embeddingProvider';

const BATCH_SIZE = 20;
const MAX_INPUT_CHARS = 8000;

export class TitanEmbeddingProvider implements EmbeddingProvider {
  readonly modelId: string;
  readonly dimensions: number = 1024;

  constructor(modelId?: string) {
    this.modelId = modelId ?? BEDROCK_EMBEDDING_MODEL;
  }

  async generateEmbedding(text: string): Promise<number[]> {
    const truncated = text.slice(0, MAX_INPUT_CHARS);

    return withRetry(async () => {
      const payload = {
        inputText: truncated,
        dimensions: this.dimensions,
        normalize: true,
      };

      const command = new InvokeModelCommand({
        modelId: this.modelId,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify(payload),
      });

      const response = await bedrockClient.send(command);
      const responseBody = JSON.parse(new TextDecoder().decode(response.body));

      return responseBody.embedding as number[];
    }, { label: 'generateEmbedding' });
  }

  async generateEmbeddingsBatch(texts: string[]): Promise<number[][]> {
    const embeddings: number[][] = [];

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
      const batch = texts.slice(i, i + BATCH_SIZE);

      logger.info('Generating embeddings batch', {
        batchStart: i,
        batchSize: batch.length,
        totalTexts: texts.length,
      });

      const batchResults = await Promise.all(
        batch.map(text => this.generateEmbedding(text))
      );

      embeddings.push(...batchResults);
    }

    return embeddings;
  }
}
