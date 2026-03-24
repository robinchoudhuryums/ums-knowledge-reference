export type { MetadataStore, DocumentStore, VectorStore, VectorSearchOptions, KeywordSearchResult } from './interfaces';
export { S3MetadataStore } from './s3MetadataStore';
export { S3DocumentStore } from './s3DocumentStore';

import { MetadataStore, DocumentStore } from './interfaces';
import { S3MetadataStore } from './s3MetadataStore';
import { S3DocumentStore } from './s3DocumentStore';

/**
 * Singleton store instances.
 * Swap these out to migrate from S3 to PostgreSQL/pgvector without changing callers.
 * VectorStore is not included here yet because the current implementation
 * (backend/src/services/vectorStore.ts) has complex in-memory caching state
 * that will be addressed in the pgvector migration.
 */
export const metadataStore: MetadataStore = new S3MetadataStore();
export const documentStore: DocumentStore = new S3DocumentStore();
