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
export const BEDROCK_GENERATION_MODEL = process.env.BEDROCK_GENERATION_MODEL || 'anthropic.claude-3-sonnet-20240229-v1:0';
