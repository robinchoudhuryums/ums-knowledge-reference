import { logger } from './logger';

interface EnvVar {
  name: string;
  required: boolean;
  description: string;
}

const ENV_VARS: EnvVar[] = [
  { name: 'AWS_ACCESS_KEY_ID', required: true, description: 'AWS access key for S3/Bedrock/Textract' },
  { name: 'AWS_SECRET_ACCESS_KEY', required: true, description: 'AWS secret key' },
  { name: 'S3_BUCKET', required: true, description: 'S3 bucket for document and metadata storage' },
  { name: 'JWT_SECRET', required: true, description: 'Secret key for JWT signing (must not use default in production)' },
  { name: 'AWS_REGION', required: false, description: 'AWS region (default: us-east-1)' },
  { name: 'PORT', required: false, description: 'Server port (default: 3001)' },
  { name: 'CORS_ORIGIN', required: false, description: 'Allowed CORS origin (default: http://localhost:5173)' },
  { name: 'JWT_EXPIRY', required: false, description: 'JWT token expiry (default: 30m)' },
  { name: 'BEDROCK_GENERATION_MODEL', required: false, description: 'Bedrock model for RAG generation' },
  { name: 'BEDROCK_EMBEDDING_MODEL', required: false, description: 'Bedrock model for embeddings' },
  { name: 'BEDROCK_EXTRACTION_MODEL', required: false, description: 'Bedrock model for document extraction' },
  { name: 'CMS_FEE_SCHEDULE_URL', required: false, description: 'CMS DMEPOS fee schedule CSV URL' },
];

/**
 * Validates required environment variables at startup.
 * Logs warnings for missing optional vars and throws for missing required vars.
 */
export function validateEnv(): void {
  const missing: string[] = [];
  const warnings: string[] = [];

  for (const env of ENV_VARS) {
    if (!process.env[env.name]) {
      if (env.required) {
        missing.push(`  - ${env.name}: ${env.description}`);
      } else {
        // Only warn for optional vars that change behavior meaningfully
      }
    }
  }

  // Special check: JWT_SECRET set but using default
  if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
    warnings.push('JWT_SECRET is not set — using insecure default. This is DANGEROUS in production!');
  }

  if (warnings.length > 0) {
    for (const w of warnings) {
      logger.warn(`[ENV] ${w}`);
    }
  }

  if (missing.length > 0) {
    const msg = `Missing required environment variables:\n${missing.join('\n')}`;
    logger.error(`[ENV] ${msg}`);
    throw new Error(msg);
  }

  logger.info('[ENV] Environment validation passed');
}
