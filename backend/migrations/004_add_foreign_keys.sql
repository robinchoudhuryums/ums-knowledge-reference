-- Migration 004: Add foreign key constraints
--
-- The initial schema omitted FK constraints on most tables, allowing orphaned
-- records when referenced users, collections, or documents are deleted.
-- This migration adds the missing FKs with ON DELETE behavior:
--   - SET NULL for audit/log tables (preserve history even if user is deleted)
--   - CASCADE for operational tables (clean up child records)
--   - RESTRICT for collections (prevent deleting collections with documents)
--
-- Note: These are ALTER TABLE ADD CONSTRAINT, not CREATE TABLE. Existing data
-- must satisfy the constraints or the migration will fail. Run a cleanup first
-- if orphaned records exist:
--   DELETE FROM documents WHERE uploaded_by NOT IN (SELECT id FROM users);
--   DELETE FROM documents WHERE collection_id NOT IN (SELECT id FROM collections);
--
-- Run: psql -U ums_admin -d ums_knowledge -f migrations/004_add_foreign_keys.sql

BEGIN;

-- ─── Documents ──────────────────────────────────────────────────────────────

-- documents.collection_id → collections.id (RESTRICT: can't delete a collection that has documents)
ALTER TABLE documents
  ADD CONSTRAINT fk_documents_collection
  FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE RESTRICT;

-- documents.uploaded_by → users.id (SET NULL would require nullable column; use RESTRICT for safety)
ALTER TABLE documents
  ADD CONSTRAINT fk_documents_uploaded_by
  FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE RESTRICT;

-- ─── Chunks ─────────────────────────────────────────────────────────────────

-- chunks.document_id → documents.id (CASCADE: delete chunks when document is deleted)
ALTER TABLE chunks
  ADD CONSTRAINT fk_chunks_document
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE;

-- ─── Usage Tracking ─────────────────────────────────────────────────────────

-- usage_records.user_id → users.id (CASCADE: remove usage records when user is deleted)
ALTER TABLE usage_records
  ADD CONSTRAINT fk_usage_records_user
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- ─── Audit Logs (preserve history — use SET NULL so logs survive user deletion) ──

-- audit_logs: user_id is NOT NULL, so we can't SET NULL. Use RESTRICT to prevent
-- deleting users who have audit logs (HIPAA requires audit preservation).
ALTER TABLE audit_logs
  ADD CONSTRAINT fk_audit_logs_user
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;

-- ─── Query Logs ─────────────────────────────────────────────────────────────

ALTER TABLE query_logs
  ADD CONSTRAINT fk_query_logs_user
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;

-- ─── RAG Traces ─────────────────────────────────────────────────────────────

ALTER TABLE rag_traces
  ADD CONSTRAINT fk_rag_traces_user
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;

-- ─── Feedback ───────────────────────────────────────────────────────────────

ALTER TABLE feedback
  ADD CONSTRAINT fk_feedback_user
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;

ALTER TABLE feedback
  ADD CONSTRAINT fk_feedback_trace
  FOREIGN KEY (trace_id) REFERENCES rag_traces(trace_id) ON DELETE SET NULL;

-- ─── Jobs ───────────────────────────────────────────────────────────────────

ALTER TABLE jobs
  ADD CONSTRAINT fk_jobs_user
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- ─── PPD Submissions ────────────────────────────────────────────────────────

ALTER TABLE ppd_submissions
  ADD CONSTRAINT fk_ppd_submitted_by
  FOREIGN KEY (submitted_by) REFERENCES users(id) ON DELETE RESTRICT;

-- ─── Monitored Sources ──────────────────────────────────────────────────────

ALTER TABLE monitored_sources
  ADD CONSTRAINT fk_monitored_sources_collection
  FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE;

-- ─── Record migration ───────────────────────────────────────────────────────

INSERT INTO schema_migrations (version, name)
VALUES (4, '004_add_foreign_keys')
ON CONFLICT (version) DO NOTHING;

COMMIT;
