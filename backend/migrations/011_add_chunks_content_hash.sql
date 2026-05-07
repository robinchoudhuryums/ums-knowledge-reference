-- ============================================================================
-- UMS Knowledge Base — Add content_hash to chunks
-- ============================================================================
-- The ingestion pipeline computes a SHA-256 hash per chunk text and looks up
-- existing embeddings to skip redundant Bedrock calls on duplicate content.
-- That lookup (services/ingestion.ts) queries chunks.content_hash, but the
-- column did not exist on the pgvector chunks table — so the SELECT failed,
-- the surrounding catch swallowed it, and embedding reuse silently never
-- ran in pgvector mode. Every duplicate chunk re-embedded.
--
-- Adding the column closes the cost leak. Backfill is intentionally skipped:
--   - existing rows get NULL content_hash, which the lookup naturally ignores
--   - duplicate-content reuse only matters for *new* uploads going forward
--   - on the next reindex (services/reindexer.ts) all rows get repopulated
-- ============================================================================

ALTER TABLE chunks
  ADD COLUMN IF NOT EXISTS content_hash TEXT;

-- Partial index — only chunks with a hash are reuse candidates. WHERE-clause
-- keeps the index small until backfill happens organically via reindex.
CREATE INDEX IF NOT EXISTS idx_chunks_content_hash
  ON chunks(content_hash)
  WHERE content_hash IS NOT NULL;

-- Record migration
INSERT INTO schema_migrations (version, name)
VALUES (11, '011_add_chunks_content_hash')
ON CONFLICT (version) DO NOTHING;
