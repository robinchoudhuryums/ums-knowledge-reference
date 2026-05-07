-- ============================================================================
-- UMS Knowledge Base — Add extraction_warnings to documents
-- ============================================================================
-- Surfaces non-fatal extraction-pipeline warnings (vision/OCR partial
-- failures) on the document row so users can tell when a "ready" document
-- is actually under-indexed. Previously these failures were swallowed by
-- `logger.warn` calls in visionExtractor.ts and textExtractor.ts; the user
-- saw status='ready' on a document that had silently skipped pages or
-- failed image analysis (F9 from the audit).
-- ============================================================================

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS extraction_warnings TEXT[] DEFAULT '{}';

-- Record migration
INSERT INTO schema_migrations (version, name)
VALUES (12, '012_add_documents_extraction_warnings')
ON CONFLICT (version) DO NOTHING;
