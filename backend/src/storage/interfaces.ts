import { DocumentChunk, SearchResult } from '../types';

/**
 * Storage Abstraction Layer
 *
 * These interfaces decouple the application from the underlying storage backend.
 * All callers import from this module — never from s3Storage directly.
 *
 * ─── Current Implementations ────────────────────────────────────────────
 *   MetadataStore  → s3MetadataStore.ts  (JSON files on S3)
 *   DocumentStore  → s3DocumentStore.ts  (raw files on S3)
 *   VectorStore    → vectorStore.ts      (in-memory + S3 JSON persistence)
 *
 * ─── Migration to AWS RDS (PostgreSQL + pgvector) ───────────────────────
 * The planned migration replaces S3 JSON storage with PostgreSQL tables:
 *
 *   MetadataStore → PostgreSQL tables:
 *     - documents (id, filename, original_name, mime_type, size_bytes, s3_key,
 *       collection_id, uploaded_by, uploaded_at, status, chunk_count, version,
 *       content_hash, previous_version_id)
 *     - collections (id, name, description, created_at, created_by)
 *     - users (id, username, password_hash, role, created_at, last_login, ...)
 *     - usage_records (date, user_id, query_count, total_queries)
 *     - Benefits: Atomic writes, concurrent access, indexing, JOINs
 *
 *   VectorStore → PostgreSQL with pgvector extension:
 *     - chunks (id, document_id, chunk_index, text, embedding vector(1024),
 *       token_count, start_offset, end_offset, page_number, section_header)
 *     - Index: CREATE INDEX ON chunks USING ivfflat (embedding vector_cosine_ops)
 *     - Benefits: No memory ceiling, concurrent writes, ACID, backup/restore
 *     - BM25 keyword search via pg_trgm or ParadeDB pg_search extension
 *
 *   DocumentStore → Keep S3 for raw files (blobs don't belong in PostgreSQL).
 *     Reference S3 keys in the PostgreSQL documents table.
 *
 *   Connection: Use pg Pool with SSL, connection pooling via PgBouncer for
 *   horizontal scaling. Set statement_timeout to 30s for queries.
 *
 * To implement: Create rdsMetadataStore.ts and rdsVectorStore.ts implementing
 * these interfaces, then swap the exports in storage/index.ts.
 */

/**
 * Storage abstraction for JSON metadata (documents index, collections, config, etc.).
 * Current implementation: S3 JSON objects under the metadata prefix.
 * Target implementation: PostgreSQL tables (see migration notes above).
 */
export interface MetadataStore {
  load<T>(key: string): Promise<T | null>;
  save<T>(key: string, data: T): Promise<void>;
  delete(key: string): Promise<void>;
}

/**
 * Storage abstraction for raw document files (PDFs, DOCX, images, etc.).
 * Current implementation: S3 objects.
 * Target implementation: Keep S3 — reference S3 keys from PostgreSQL documents table.
 */
export interface DocumentStore {
  upload(key: string, buffer: Buffer, contentType: string): Promise<void>;
  download(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  getETag(key: string): Promise<string | null>;
}

/**
 * Storage abstraction for vector embeddings and similarity search.
 * Current implementation: In-memory index backed by S3 JSON persistence.
 * Target implementation: PostgreSQL with pgvector extension.
 *
 * Current limits:
 *   - ~83K chunks before hitting the 500MB S3 JSON size guard
 *   - Entire index loaded into memory on startup
 *   - Single-instance only (no shared state across processes)
 *
 * pgvector migration removes all three limits.
 */
export interface VectorStore {
  initialize(): Promise<void>;
  addChunks(chunks: DocumentChunk[], embeddings: number[][]): Promise<void>;
  removeDocumentChunks(documentId: string): Promise<void>;
  search(queryEmbedding: number[], queryText: string, options?: VectorSearchOptions): Promise<SearchResult[]>;
  searchByKeyword(query: string, collectionId?: string): Promise<KeywordSearchResult[]>;
  getStats(): { totalChunks: number; lastUpdated: string | null };
}

export interface VectorSearchOptions {
  topK?: number;
  collectionIds?: string[];
  tags?: string[];
  semanticWeight?: number;
  keywordWeight?: number;
}

export interface KeywordSearchResult {
  documentId: string;
  documentName: string;
  matches: Array<{ text: string; pageNumber?: number; chunkIndex: number }>;
}
