-- Migration 003: Add indexes on foreign key columns
--
-- Several tables reference users/collections/documents by ID but lack indexes
-- on those FK columns, causing full table scans on JOIN and WHERE clauses.
-- This migration adds the missing indexes for query performance.
--
-- Run: psql -U ums_admin -d ums_knowledge -f migrations/003_add_fk_indexes.sql

BEGIN;

-- usage_records.user_id — queried per-user for daily usage checks
CREATE INDEX IF NOT EXISTS idx_usage_records_user_id ON usage_records(user_id);

-- audit_logs.user_id — queried for per-user audit history
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);

-- query_logs.user_id — queried for per-user query history
CREATE INDEX IF NOT EXISTS idx_query_logs_user_id ON query_logs(user_id);

-- feedback.user_id — queried for per-user feedback listings
CREATE INDEX IF NOT EXISTS idx_feedback_user_id ON feedback(user_id);

-- jobs.user_id — queried for per-user job listings
CREATE INDEX IF NOT EXISTS idx_jobs_user_id ON jobs(user_id);

-- Partial indexes for common query patterns (documents filtered by status)
CREATE INDEX IF NOT EXISTS idx_documents_status_ready
  ON documents(collection_id, id) WHERE status = 'ready';

INSERT INTO schema_migrations (version) VALUES ('003') ON CONFLICT DO NOTHING;

COMMIT;
