/**
 * AWS Bedrock Batch Inference Service (Phase C).
 *
 * When BEDROCK_BATCH_MODE=true, Bedrock-eligible workloads (extraction,
 * clinical-note extraction) can be deferred and processed in batch at
 * 50% cost reduction vs on-demand pricing. Batch jobs complete within
 * 24h — not suitable for interactive RAG queries.
 *
 * This module is the service layer. It provides:
 *   - createBatchInput(items) — write a JSONL input file to S3
 *   - createJob(inputUri, batchId, itemIds) — submit a batch job
 *   - getJobStatus(jobArn) — poll a submitted job
 *   - readBatchOutput(outputUri) — parse the output JSONL
 *
 * The scheduler in `batchScheduler.ts` drives the full lifecycle.
 *
 * Requires IAM: bedrock:CreateModelInvocationJob, bedrock:GetModelInvocationJob,
 * plus S3 RW on the configured bucket.
 */

import { randomUUID } from 'crypto';
import {
  BedrockClient,
  CreateModelInvocationJobCommand,
  GetModelInvocationJobCommand,
  type ModelInvocationJobStatus,
} from '@aws-sdk/client-bedrock';
import {
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { s3Client, S3_BUCKET, bedrockCircuitBreaker } from '../config/aws';
import { getModelForTier } from './modelTiers';
import { logger } from '../utils/logger';

const region = process.env.AWS_REGION || 'us-east-1';

/**
 * Bedrock management client (distinct from the BedrockRuntimeClient used for
 * on-demand invocation). Batch inference lives in the management API.
 */
const bedrockMgmtClient = new BedrockClient({
  region,
  credentials: {
    accessKeyId: (process.env.AWS_ACCESS_KEY_ID || '').trim(),
    secretAccessKey: (process.env.AWS_SECRET_ACCESS_KEY || '').trim(),
  },
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PendingBatchItem {
  /** Unique id for the batch record — typically the job-queue job id. */
  itemId: string;
  /** User-message text sent to Bedrock. */
  prompt: string;
  /** Optional system prompt. Rendered as a Converse `system` block. */
  systemPrompt?: string;
  /** Optional per-item inference config override (temp + maxTokens). */
  inferenceConfig?: { temperature?: number; maxTokens?: number };
  /** Optional passthrough metadata (templateId, userId, etc). */
  metadata?: Record<string, unknown>;
  /** Who triggered this item — used for audit. */
  uploadedBy?: string;
  /** ISO timestamp of when this item was enqueued. */
  timestamp: string;
}

export interface BatchJob {
  jobId: string;
  jobArn: string;
  status: ModelInvocationJobStatus | 'Submitted';
  inputS3Uri: string;
  outputS3Uri: string;
  /** Item IDs included in this batch — used to reconcile output to pending items. */
  itemIds: string[];
  createdAt: string;
}

export interface BatchResultEntry {
  itemId: string;
  text: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Config + availability guard
// ---------------------------------------------------------------------------

let misconfigLogged = false;

/**
 * Batch mode is only available when BOTH:
 *   - BEDROCK_BATCH_MODE=true
 *   - BEDROCK_BATCH_ROLE_ARN is set (Bedrock requires this for CreateModelInvocationJob)
 *
 * Logs the misconfiguration once per process so operators see the reason the
 * scheduler refused to start instead of submitting jobs that AWS rejects.
 */
export function isBatchModeAvailable(): boolean {
  if (process.env.BEDROCK_BATCH_MODE !== 'true') return false;
  if (!process.env.BEDROCK_BATCH_ROLE_ARN) {
    if (!misconfigLogged) {
      logger.error(
        'BEDROCK_BATCH_MODE=true but BEDROCK_BATCH_ROLE_ARN is unset — batch mode disabled',
      );
      misconfigLogged = true;
    }
    return false;
  }
  return true;
}

/**
 * Resolve the Bedrock model id to use for batch jobs. Uses the "strong" tier
 * (same abstraction introduced in Phase A) so a promotion via the admin
 * model-tiers API affects batch and on-demand identically.
 */
function resolveBatchModelId(): string {
  return getModelForTier('strong');
}

// ---------------------------------------------------------------------------
// S3 helpers — scoped to batch-inference/ prefix, use the shared s3Client
// ---------------------------------------------------------------------------

async function s3PutJson(key: string, body: unknown): Promise<void> {
  await s3Client.send(
    new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Body: JSON.stringify(body),
      ContentType: 'application/json',
      ServerSideEncryption: 'AES256',
    }),
  );
}

async function s3PutJsonl(key: string, body: string): Promise<void> {
  await s3Client.send(
    new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Body: body,
      // Bedrock's CreateModelInvocationJob accepts JSONL uploaded with this type.
      ContentType: 'application/jsonl',
      ServerSideEncryption: 'AES256',
    }),
  );
}

async function s3GetText(key: string): Promise<string | null> {
  try {
    const response = await s3Client.send(
      new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }),
    );
    const text = await response.Body?.transformToString('utf-8');
    return text ?? null;
  } catch (err) {
    const name = (err as { name?: string }).name;
    if (name === 'NoSuchKey' || name === 'NotFound') return null;
    throw err;
  }
}

async function s3ListKeys(prefix: string): Promise<string[]> {
  // A3/F08 parity with CA: paginate via continuation token with a safety cap
  // so a pathological response shape can't loop forever.
  const MAX_PAGES = 50;
  const keys: string[] = [];
  let continuationToken: string | undefined;
  let page = 0;

  while (page < MAX_PAGES) {
    const response = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: S3_BUCKET,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );
    for (const obj of response.Contents ?? []) {
      if (obj.Key) keys.push(obj.Key);
    }
    if (!response.IsTruncated) break;
    continuationToken = response.NextContinuationToken;
    if (!continuationToken) break;
    page++;
  }

  if (page >= MAX_PAGES) {
    logger.warn('batchBedrock.s3ListKeys hit safety cap; results may be incomplete', {
      maxPages: MAX_PAGES,
      prefix,
    });
  }

  return keys;
}

// ---------------------------------------------------------------------------
// Public service API
// ---------------------------------------------------------------------------

/**
 * Build a JSONL input file from pending items and upload it to S3. Each line
 * is a Converse-shaped record with a `recordId` matching PendingBatchItem.itemId.
 */
export async function createBatchInput(
  items: PendingBatchItem[],
): Promise<{ s3Uri: string; batchId: string }> {
  const batchId = `batch-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const lines = items.map((item) => {
    const modelInput: Record<string, unknown> = {
      messages: [{ role: 'user', content: [{ text: item.prompt }] }],
      inferenceConfig: {
        temperature: item.inferenceConfig?.temperature ?? 0.05,
        // 8192 default — extraction's working cap. Override per-item when
        // the caller knows the expected output is smaller.
        maxTokens: item.inferenceConfig?.maxTokens ?? 8192,
      },
    };
    if (item.systemPrompt) {
      modelInput.system = [{ text: item.systemPrompt }];
    }
    return JSON.stringify({ recordId: item.itemId, modelInput });
  });
  const jsonl = lines.join('\n');
  const key = `batch-inference/input/${batchId}.jsonl`;
  const s3Uri = `s3://${S3_BUCKET}/${key}`;

  await s3PutJsonl(key, jsonl);
  logger.info('Batch input uploaded', {
    s3Uri,
    itemCount: items.length,
    bytes: Buffer.byteLength(jsonl, 'utf-8'),
  });

  return { s3Uri, batchId };
}

/**
 * Submit a batch inference job to Bedrock. The job will process asynchronously;
 * poll via `getJobStatus`.
 *
 * Wrapped in the shared `bedrockCircuitBreaker` so a regional outage stops
 * submissions from piling up unprocessable jobs + orphan tracking writes.
 */
export async function createJob(
  inputS3Uri: string,
  batchId: string,
  itemIds: string[],
): Promise<BatchJob> {
  const roleArn = process.env.BEDROCK_BATCH_ROLE_ARN;
  if (!roleArn) {
    throw new Error('Bedrock batch: BEDROCK_BATCH_ROLE_ARN is not set');
  }

  const model = resolveBatchModelId();
  const outputS3Uri = `s3://${S3_BUCKET}/batch-inference/output/${batchId}/`;

  return bedrockCircuitBreaker.execute(async () => {
    const response = await bedrockMgmtClient.send(
      new CreateModelInvocationJobCommand({
        jobName: batchId,
        modelId: model,
        roleArn,
        inputDataConfig: {
          s3InputDataConfig: {
            s3Uri: inputS3Uri,
            s3InputFormat: 'JSONL',
          },
        },
        outputDataConfig: {
          s3OutputDataConfig: {
            s3Uri: outputS3Uri,
          },
        },
      }),
    );

    const jobArn = response.jobArn;
    if (!jobArn) {
      throw new Error('Bedrock batch: CreateModelInvocationJob returned no jobArn');
    }
    const jobId = jobArn.split('/').pop() || batchId;

    logger.info('Batch job created', {
      jobId,
      model,
      itemCount: itemIds.length,
    });

    return {
      jobId,
      jobArn,
      status: 'Submitted' as const,
      inputS3Uri,
      outputS3Uri,
      itemIds,
      createdAt: new Date().toISOString(),
    };
  });
}

/**
 * Fetch the current status of a batch job.
 */
export async function getJobStatus(
  jobArn: string,
): Promise<{ status: BatchJob['status']; message?: string }> {
  return bedrockCircuitBreaker.execute(async () => {
    const response = await bedrockMgmtClient.send(
      new GetModelInvocationJobCommand({ jobIdentifier: jobArn }),
    );
    return {
      status: (response.status ?? 'Submitted') as BatchJob['status'],
      message: response.message,
    };
  });
}

/**
 * Read the batch output files from S3 and parse each record. Bedrock writes
 * `.jsonl.out` files under the output prefix; each line has `recordId` +
 * `modelOutput` (Converse shape) or `error`.
 */
export async function readBatchOutput(
  outputS3Uri: string,
): Promise<Map<string, BatchResultEntry>> {
  const results = new Map<string, BatchResultEntry>();
  const prefix = outputS3Uri.replace(`s3://${S3_BUCKET}/`, '');
  const keys = await s3ListKeys(prefix);
  logger.info('Batch output files located', { count: keys.length, prefix });

  for (const key of keys) {
    if (!key.endsWith('.jsonl.out')) continue;
    const text = await s3GetText(key);
    if (!text) continue;

    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line) as {
          recordId: string;
          modelOutput?: {
            output?: { message?: { content?: Array<{ text?: string }> } };
          };
          error?: string;
        };

        if (record.error) {
          results.set(record.recordId, {
            itemId: record.recordId,
            text: '',
            error: record.error,
          });
          continue;
        }

        const responseText = record.modelOutput?.output?.message?.content?.[0]?.text ?? '';
        results.set(record.recordId, {
          itemId: record.recordId,
          text: responseText,
        });
      } catch (err) {
        logger.warn('Batch output: failed to parse line', {
          error: (err as Error).message,
        });
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Pending-item helpers — exposed for the extraction pipeline (follow-up PR)
// ---------------------------------------------------------------------------

const PENDING_PREFIX = 'batch-inference/pending/';

/**
 * Write a pending item to S3. The next scheduler cycle picks it up and
 * includes it in the next batch submission. Does NOT submit anything itself.
 *
 * Callers (future extraction integration) set their job to
 * `status: 'processing'` with a marker indicating "deferred to batch", then
 * poll job status via the normal jobQueue lookup. The batch result handler
 * (wired separately) flips the job to completed or failed.
 */
export async function enqueuePendingItem(item: PendingBatchItem): Promise<void> {
  const key = `${PENDING_PREFIX}${item.itemId}.json`;
  await s3PutJson(key, item);
}

export async function listPendingItemKeys(): Promise<string[]> {
  return s3ListKeys(PENDING_PREFIX);
}

export async function downloadPendingItem(
  key: string,
): Promise<PendingBatchItem | null> {
  const text = await s3GetText(key);
  if (!text) return null;
  try {
    return JSON.parse(text) as PendingBatchItem;
  } catch {
    return null;
  }
}

export async function deletePendingItem(itemId: string): Promise<void> {
  const key = `${PENDING_PREFIX}${itemId}.json`;
  await s3Client.send(
    new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: key }),
  );
}

// ---------------------------------------------------------------------------
// Tracking-file helpers — consumed by the scheduler
// ---------------------------------------------------------------------------

const ACTIVE_JOBS_PREFIX = 'batch-inference/active-jobs/';
const ORPHAN_SUBMISSIONS_PREFIX = 'batch-inference/orphaned-submissions/';

export async function writeActiveJob(job: BatchJob): Promise<void> {
  await s3PutJson(`${ACTIVE_JOBS_PREFIX}${job.jobId}.json`, job);
}

export async function writeOrphanedSubmission(
  job: BatchJob,
  meta: { itemCount: number; reason: string },
): Promise<void> {
  await s3PutJson(`${ORPHAN_SUBMISSIONS_PREFIX}${job.jobId}.json`, {
    ...job,
    orphanedAt: new Date().toISOString(),
    itemCount: meta.itemCount,
    reason: meta.reason,
  });
}

export async function listActiveJobKeys(): Promise<string[]> {
  return s3ListKeys(ACTIVE_JOBS_PREFIX);
}

export async function listOrphanedSubmissionKeys(): Promise<string[]> {
  return s3ListKeys(ORPHAN_SUBMISSIONS_PREFIX);
}

export async function downloadJob(key: string): Promise<BatchJob | null> {
  const text = await s3GetText(key);
  if (!text) return null;
  try {
    return JSON.parse(text) as BatchJob;
  } catch {
    return null;
  }
}

export async function deleteObjectKey(key: string): Promise<void> {
  await s3Client.send(
    new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: key }),
  );
}

// Re-exported constants so callers + the scheduler can share a single source
// of truth for the S3 layout.
export const BATCH_S3_PREFIXES = {
  pending: PENDING_PREFIX,
  activeJobs: ACTIVE_JOBS_PREFIX,
  orphanedSubmissions: ORPHAN_SUBMISSIONS_PREFIX,
} as const;
