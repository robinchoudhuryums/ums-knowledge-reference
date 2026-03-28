-- ============================================================================
-- UMS Knowledge Base — pgvector Chunks Table
-- ============================================================================
-- Migrates the vector store from in-memory JSON (S3-backed) to PostgreSQL
-- with the pgvector extension for native vector similarity search.
--
-- Prerequisites:
--   CREATE EXTENSION IF NOT EXISTS "vector";  (requires rds_superuser)
-- ============================================================================

-- Chunks table: stores document chunks with their embedding vectors
CREATE TABLE IF NOT EXISTS chunks (
  id              TEXT PRIMARY KEY,
  document_id     TEXT NOT NULL,
  chunk_index     INTEGER NOT NULL,
  text            TEXT NOT NULL,
  token_count     INTEGER NOT NULL DEFAULT 0,
  start_offset    INTEGER NOT NULL DEFAULT 0,
  end_offset      INTEGER NOT NULL DEFAULT 0,
  page_number     INTEGER,
  section_header  TEXT,
  embedding       vector(1024) NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for fast vector similarity search (IVFFlat).
-- lists = sqrt(num_vectors) is a good starting point; 100 lists works well up to ~1M vectors.
-- Rebuild with more lists as the dataset grows: ALTER INDEX idx_chunks_embedding ... SET (lists = 300);
CREATE INDEX IF NOT EXISTS idx_chunks_embedding
  ON chunks USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- Index for fast document-level operations (delete all chunks for a document)
CREATE INDEX IF NOT EXISTS idx_chunks_document_id ON chunks(document_id);

-- Index for collection-based filtering (join through documents table)
-- This composite index helps the common query pattern: filter by document, order by chunk
CREATE INDEX IF NOT EXISTS idx_chunks_doc_chunk ON chunks(document_id, chunk_index);

-- Track embedding model metadata so we know if re-indexing is needed
CREATE TABLE IF NOT EXISTS vector_store_meta (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);

INSERT INTO vector_store_meta (key, value) VALUES
  ('embedding_model', 'amazon.titan-embed-text-v2:0'),
  ('embedding_dimensions', '1024'),
  ('last_updated', now()::text)
ON CONFLICT (key) DO NOTHING;

-- Record migration
INSERT INTO schema_migrations (version, name)
VALUES (2, '002_pgvector_chunks')
ON CONFLICT (version) DO NOTHING;
