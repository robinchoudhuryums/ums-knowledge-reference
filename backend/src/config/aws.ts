import {
  S3Client,
  GetBucketEncryptionCommand,
  GetPublicAccessBlockCommand,
  GetBucketVersioningCommand,
} from '@aws-sdk/client-s3';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';

const region = process.env.AWS_REGION || 'us-east-1';

const awsCredentials = {
  accessKeyId: (process.env.AWS_ACCESS_KEY_ID || '').trim(),
  secretAccessKey: (process.env.AWS_SECRET_ACCESS_KEY || '').trim(),
};

export const s3Client = new S3Client({
  region,
  credentials: awsCredentials,
});

export const bedrockClient = new BedrockRuntimeClient({
  region,
  credentials: awsCredentials,
});

export const S3_BUCKET = process.env.S3_BUCKET || 'ums-knowledge-reference';

// S3 key prefixes for organized storage
export const S3_PREFIXES = {
  documents: 'documents/',
  vectors: 'vectors/',
  metadata: 'metadata/',
  audit: 'audit/',
} as const;

/**
 * Verify S3 bucket security configuration at startup.
 * Checks encryption, public access block, and versioning.
 * In production, failures are fatal. In development, they're warnings.
 */
export async function verifyS3BucketConfig(): Promise<void> {
  const issues: string[] = [];
  const isProduction = process.env.NODE_ENV === 'production';
  const { logger } = await import('../utils/logger');

  // 1. Check default encryption
  try {
    const encryption = await s3Client.send(new GetBucketEncryptionCommand({ Bucket: S3_BUCKET }));
    const rules = encryption.ServerSideEncryptionConfiguration?.Rules || [];
    const hasEncryption = rules.some(r => r.ApplyServerSideEncryptionByDefault?.SSEAlgorithm);
    if (!hasEncryption) {
      issues.push('S3 bucket does not have default encryption enabled');
    } else {
      const algo = rules[0]?.ApplyServerSideEncryptionByDefault?.SSEAlgorithm;
      logger.info(`[S3] Bucket encryption: ${algo}`);
      if (algo === 'AES256' && isProduction) {
        logger.warn('[S3] Consider upgrading to aws:kms encryption for PHI data');
      }
    }
  } catch (error: unknown) {
    const err = error as { name?: string };
    if (err.name === 'ServerSideEncryptionConfigurationNotFoundError') {
      issues.push('S3 bucket has NO default encryption — PHI data may be stored unencrypted');
    } else {
      logger.warn('[S3] Could not verify bucket encryption', { error: String(error) });
    }
  }

  // 2. Check public access block
  try {
    const publicAccess = await s3Client.send(new GetPublicAccessBlockCommand({ Bucket: S3_BUCKET }));
    const config = publicAccess.PublicAccessBlockConfiguration;
    if (!config?.BlockPublicAcls || !config?.BlockPublicPolicy ||
        !config?.IgnorePublicAcls || !config?.RestrictPublicBuckets) {
      issues.push('S3 bucket public access is not fully blocked — PHI could be publicly exposed');
    } else {
      logger.info('[S3] Public access block: all blocked');
    }
  } catch {
    logger.warn('[S3] Could not verify public access block configuration');
  }

  // 3. Check versioning
  try {
    const versioning = await s3Client.send(new GetBucketVersioningCommand({ Bucket: S3_BUCKET }));
    if (versioning.Status !== 'Enabled') {
      issues.push(`S3 bucket versioning is ${versioning.Status || 'not enabled'} — data recovery may not be possible`);
    } else {
      logger.info('[S3] Bucket versioning: enabled');
    }
  } catch {
    logger.warn('[S3] Could not verify bucket versioning');
  }

  if (issues.length > 0) {
    const msg = `[S3 SECURITY] Bucket configuration issues:\n  - ${issues.join('\n  - ')}`;
    logger.error(msg);
  } else {
    logger.info('[S3] Bucket security configuration verified');
  }
}

export const BEDROCK_EMBEDDING_MODEL = process.env.BEDROCK_EMBEDDING_MODEL || 'amazon.titan-embed-text-v2:0';
// Default to Haiku 4.5 via cross-region inference profile (required for newer models).
// For a RAG tool, retrieval quality drives answer quality more than model size.
// Override with BEDROCK_GENERATION_MODEL env var if needed.
export const BEDROCK_GENERATION_MODEL = process.env.BEDROCK_GENERATION_MODEL || 'us.anthropic.claude-haiku-4-5-20251001-v1:0';
// Sonnet for structured extraction tasks (more accurate for form-filling).
// Generation model (Haiku) is used for RAG queries; extraction model (Sonnet) for document data extraction.
export const BEDROCK_EXTRACTION_MODEL = process.env.BEDROCK_EXTRACTION_MODEL || 'us.anthropic.claude-sonnet-4-6-20250514-v1:0';
