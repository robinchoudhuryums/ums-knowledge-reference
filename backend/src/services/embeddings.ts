import { InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { bedrockClient, BEDROCK_EMBEDDING_MODEL } from '../config/aws';
import { logger } from '../utils/logger';

const EMBEDDING_BATCH_SIZE = 20;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1000;

/**
 * Retry a function with exponential backoff.
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  maxRetries: number = MAX_RETRIES
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < maxRetries) {
        const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
        logger.warn(`${label} failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms`, {
          error: lastError.message,
        });
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

/**
 * Generate an embedding vector for a single text using Amazon Titan Embeddings v2 via Bedrock.
 * Includes retry logic for transient API failures.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const truncated = text.slice(0, 8000);

  return withRetry(async () => {
    const payload = {
      inputText: truncated,
      dimensions: 1024,
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
  }, 'generateEmbedding');
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
