-- ============================================================================
-- UMS Knowledge Base — HNSW Index Migration
-- ============================================================================
-- Replaces the IVFFlat index on chunks.embedding with an HNSW index.
-- HNSW provides better recall than IVFFlat (especially at scale) without
-- requiring periodic REINDEX after bulk inserts.
--
-- Key differences:
--   IVFFlat: faster build, lower recall, needs REINDEX after bulk changes
--   HNSW:    slower build, higher recall, no reindex needed, more memory
--
-- Parameters:
--   m = 16 (max connections per node — default, good balance of recall vs memory)
--   ef_construction = 64 (build-time beam width — default, higher = better recall)
--
-- Note: this migration can take several minutes on large tables (100K+ chunks).
-- Run during a maintenance window. The DROP + CREATE is non-transactional for
-- large tables; consider using CREATE INDEX CONCURRENTLY in production.
-- ============================================================================

-- Drop the old IVFFlat index
DROP INDEX IF EXISTS idx_chunks_embedding;

-- Create HNSW index with cosine distance operator
CREATE INDEX IF NOT EXISTS idx_chunks_embedding
  ON chunks USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Record migration
INSERT INTO schema_migrations (version, name)
VALUES (9, '009_hnsw_index')
ON CONFLICT (version) DO NOTHING;
