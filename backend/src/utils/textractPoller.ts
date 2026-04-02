/**
 * Shared Textract async job polling utility.
 *
 * Both OCR (GetDocumentTextDetection) and Form Analysis (GetDocumentAnalysis)
 * follow the same polling + pagination pattern. This module extracts that
 * shared logic to avoid duplication and ensure consistent error handling.
 */

import { logger } from './logger';

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 120; // 120 * 2s = 4 minutes
const MAX_TRANSIENT_RETRIES = 3;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export interface TextractPollOptions<TResponse> {
  /** Unique job ID returned by StartDocument* command */
  jobId: string;
  /** Human-readable label for logging (e.g. 'OCR', 'form analysis') */
  label: string;
  /** Function that sends the Get* command and returns the response */
  getResult: (jobId: string, nextToken?: string) => Promise<TResponse>;
  /** Extract job status from response */
  getStatus: (response: TResponse) => string | undefined;
  /** Extract status message (for failed jobs) */
  getStatusMessage?: (response: TResponse) => string | undefined;
  /** Extract result blocks from response */
  getBlocks: (response: TResponse) => unknown[] | undefined;
  /** Extract pagination token from response */
  getNextToken: (response: TResponse) => string | undefined;
  /** Max pages for pagination (default 200) */
  maxResultPages?: number;
}

/**
 * Poll a Textract async job until completion, then paginate through all results.
 *
 * Phase 1: Poll until status is SUCCEEDED or FAILED. Transient errors (network,
 * HTTP 500) are retried up to MAX_TRANSIENT_RETRIES times per poll attempt.
 *
 * Phase 2: Paginate through all result pages with throttling to stay under
 * Textract rate limits.
 */
export async function pollTextractJob<TResponse>(
  options: TextractPollOptions<TResponse>
): Promise<unknown[]> {
  const {
    jobId, label, getResult, getStatus, getStatusMessage,
    getBlocks, getNextToken, maxResultPages = 200,
  } = options;

  // Phase 1: Poll until job completes
  let jobStatus = 'IN_PROGRESS';
  let transientRetries = 0;
  let firstPageBlocks: unknown[] = [];

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    await sleep(POLL_INTERVAL_MS);

    let response: TResponse;
    try {
      response = await getResult(jobId);
      transientRetries = 0;
    } catch (pollError: unknown) {
      transientRetries++;
      if (transientRetries <= MAX_TRANSIENT_RETRIES) {
        logger.warn(`Textract ${label} poll transient error, retrying`, {
          jobId, attempt, transientRetries, error: String(pollError),
        });
        continue;
      }
      throw new Error(`Textract ${label} polling failed after ${MAX_TRANSIENT_RETRIES} retries: ${String(pollError)}`);
    }

    jobStatus = getStatus(response) || 'FAILED';

    if (jobStatus === 'SUCCEEDED') {
      const blocks = getBlocks(response);
      if (blocks) firstPageBlocks = blocks;
      break;
    }

    if (jobStatus === 'FAILED') {
      const statusMessage = getStatusMessage?.(response) || 'Unknown error';
      throw new Error(`Textract ${label} job failed: ${statusMessage}`);
    }
  }

  if (jobStatus !== 'SUCCEEDED') {
    throw new Error(`Textract ${label} job timed out after polling`);
  }

  // Phase 2: Paginate through remaining result pages
  let allBlocks = [...firstPageBlocks];
  let nextToken: string | undefined;

  // Re-fetch to get NextToken (the polling response may have had one)
  const initialResponse = await getResult(jobId);
  nextToken = getNextToken(initialResponse);

  for (let page = 0; page < maxResultPages && nextToken; page++) {
    const response = await getResult(jobId, nextToken);
    const blocks = getBlocks(response);
    if (blocks) allBlocks = allBlocks.concat(blocks);

    nextToken = getNextToken(response);
    if (!nextToken) break;

    // Brief delay to avoid AWS API throttling (Textract default: 10 TPS)
    await sleep(100);
  }

  return allBlocks;
}
