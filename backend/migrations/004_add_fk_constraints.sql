-- Migration 004: Add missing foreign key constraints
--
-- Several tables reference users, collections, or documents by ID without
-- formal FK constraints. This allows orphaned records to accumulate when
-- referenced rows are deleted. Adding proper FK constraints with
-- ON DELETE CASCADE or SET NULL ensures referential integrity.
--
-- Note: ON DELETE CASCADE is used for operational data (logs, traces, feedback)
-- since deleting a user should clean up their activity records.
-- ON DELETE SET NULL is used where we want to preserve the record but lose
-- the attribution (e.g., reviewed_by on PPD submissions).
--
-- Run: psql -U ums_admin -d ums_knowledge -f migrations/004_add_fk_constraints.sql

BEGIN;

-- ─── Documents ──────────────────────────────────────────────────────────────
-- documents.collection_id → collections.id (SET NULL: preserve doc if collection deleted)
DO $$ BEGIN
  ALTER TABLE documents ADD CONSTRAINT fk_documents_collection
    FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- documents.uploaded_by → users.id (SET NULL: preserve doc if user deleted)
DO $$ BEGIN
  ALTER TABLE documents ADD CONSTRAINT fk_documents_uploaded_by
    FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── Usage Records ──────────────────────────────────────────────────────────
-- usage_records.user_id → users.id (CASCADE: delete usage data with user)
DO $$ BEGIN
  ALTER TABLE usage_records ADD CONSTRAINT fk_usage_records_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── Audit Logs ─────────────────────────────────────────────────────────────
-- audit_logs.user_id → users.id
-- NOTE: No FK constraint here — audit logs must be preserved even after user
-- deletion for HIPAA compliance (6-year retention). The user_id is kept as
-- a denormalized reference alongside the username for traceability.

-- ─── Query Logs ─────────────────────────────────────────────────────────────
-- Same as audit logs: retain for compliance. No FK cascade.

-- ─── RAG Traces ─────────────────────────────────────────────────────────────
-- Same: retain for operational analysis.

-- ─── Feedback ───────────────────────────────────────────────────────────────
-- feedback.user_id → users.id (CASCADE: delete feedback with user)
DO $$ BEGIN
  ALTER TABLE feedback ADD CONSTRAINT fk_feedback_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- feedback.trace_id → rag_traces.trace_id (SET NULL: preserve feedback if trace cleaned up)
DO $$ BEGIN
  ALTER TABLE feedback ADD CONSTRAINT fk_feedback_trace
    FOREIGN KEY (trace_id) REFERENCES rag_traces(trace_id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── Jobs ───────────────────────────────────────────────────────────────────
-- jobs.user_id → users.id (CASCADE: delete jobs with user)
DO $$ BEGIN
  ALTER TABLE jobs ADD CONSTRAINT fk_jobs_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── PPD Submissions ────────────────────────────────────────────────────────
-- ppd_submissions.submitted_by → users.id (SET NULL: preserve submission)
DO $$ BEGIN
  ALTER TABLE ppd_submissions ADD CONSTRAINT fk_ppd_submitted_by
    FOREIGN KEY (submitted_by) REFERENCES users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ppd_submissions.reviewed_by → users.id (SET NULL: preserve submission)
DO $$ BEGIN
  ALTER TABLE ppd_submissions ADD CONSTRAINT fk_ppd_reviewed_by
    FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── Monitored Sources ──────────────────────────────────────────────────────
-- monitored_sources.collection_id → collections.id (CASCADE: delete source monitor with collection)
DO $$ BEGIN
  ALTER TABLE monitored_sources ADD CONSTRAINT fk_monitored_sources_collection
    FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── Make nullable columns that need SET NULL actually nullable ─────────────
-- documents.collection_id and documents.uploaded_by are declared NOT NULL in
-- the original schema, which conflicts with ON DELETE SET NULL. We need to
-- make them nullable for the FK constraint to work correctly.
ALTER TABLE documents ALTER COLUMN collection_id DROP NOT NULL;
ALTER TABLE documents ALTER COLUMN uploaded_by DROP NOT NULL;

-- ppd_submissions.submitted_by is NOT NULL — keep it NOT NULL since we
-- shouldn't have orphaned submissions. Change FK to RESTRICT instead.
ALTER TABLE ppd_submissions DROP CONSTRAINT IF EXISTS fk_ppd_submitted_by;
DO $$ BEGIN
  ALTER TABLE ppd_submissions ADD CONSTRAINT fk_ppd_submitted_by
    FOREIGN KEY (submitted_by) REFERENCES users(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

INSERT INTO schema_migrations (version, name)
VALUES (4, '004_add_fk_constraints')
ON CONFLICT (version) DO NOTHING;

COMMIT;
