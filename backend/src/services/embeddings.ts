import { InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { bedrockClient, BEDROCK_EMBEDDING_MODEL } from '../config/aws';
import { logger } from '../utils/logger';

const EMBEDDING_BATCH_SIZE = 20;

/**
 * Generate an embedding vector for a single text using Amazon Titan Embeddings v2 via Bedrock.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const truncated = text.slice(0, 8000); // Titan v2 supports up to 8192 tokens

  const payload = {
    inputText: truncated,
    dimensions: 1024, // Titan v2 supports 256, 512, or 1024 dimensions
    normalize: true,
  };

  const command = new InvokeModelCommand({
    modelId: BEDROCK_EMBEDDING_MODEL,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(payload),
  });

  const response = await bedrockClient.send(command);
  const responseBody = JSON.parse(new TextDecoder().decode(response.body));

  return responseBody.embedding as number[];
}

/**
 * Generate embeddings for multiple texts in batches.
 * Returns embeddings in the same order as inputs.
 */
export async function generateEmbeddingsBatch(texts: string[]): Promise<number[][]> {
  const embeddings: number[][] = [];

  for (let i = 0; i < texts.length; i += EMBEDDING_BATCH_SIZE) {
    const batch = texts.slice(i, i + EMBEDDING_BATCH_SIZE);

    logger.info('Generating embeddings batch', {
      batchStart: i,
      batchSize: batch.length,
      totalTexts: texts.length,
    });

    // Process batch items in parallel
    const batchResults = await Promise.all(
      batch.map(text => generateEmbedding(text))
    );

    embeddings.push(...batchResults);
  }

  return embeddings;
}
