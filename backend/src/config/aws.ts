import { S3Client } from '@aws-sdk/client-s3';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';

const region = process.env.AWS_REGION || 'us-east-1';

const awsCredentials = {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
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

export const BEDROCK_EMBEDDING_MODEL = process.env.BEDROCK_EMBEDDING_MODEL || 'amazon.titan-embed-text-v2:0';
// Default to Haiku 4.5 for best cost/quality balance.
// For a RAG tool, retrieval quality drives answer quality more than model size.
// Override with BEDROCK_GENERATION_MODEL env var if needed.
export const BEDROCK_GENERATION_MODEL = process.env.BEDROCK_GENERATION_MODEL || 'anthropic.claude-haiku-4-5-20251001-v1:0';
