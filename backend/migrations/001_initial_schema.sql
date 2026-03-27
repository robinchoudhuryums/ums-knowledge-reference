-- ============================================================================
-- UMS Knowledge Base — Initial PostgreSQL Schema
-- ============================================================================
-- Run this against your RDS PostgreSQL database:
--   psql -h <rds-host> -U <user> -d ums_knowledge -f 001_initial_schema.sql
--
-- Prerequisites:
--   CREATE DATABASE ums_knowledge;
--   CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- for gen_random_uuid()
--   CREATE EXTENSION IF NOT EXISTS "vector";      -- for pgvector (embeddings)
-- ============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── Users ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id                    TEXT PRIMARY KEY DEFAULT 'user-' || extract(epoch from now())::bigint,
  username              TEXT UNIQUE NOT NULL,
  password_hash         TEXT NOT NULL,
  role                  TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login            TIMESTAMPTZ,
  must_change_password  BOOLEAN NOT NULL DEFAULT false,
  failed_login_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until          TIMESTAMPTZ,
  password_history      TEXT[] DEFAULT '{}',
  allowed_collections   TEXT[] DEFAULT '{}'
);

-- ─── Collections ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS collections (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name        TEXT NOT NULL,
  description TEXT DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  TEXT NOT NULL REFERENCES users(id)
);

-- ─── Documents ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS documents (
  id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  filename            TEXT NOT NULL,
  original_name       TEXT NOT NULL,
  mime_type           TEXT NOT NULL,
  size_bytes          BIGINT NOT NULL,
  s3_key              TEXT NOT NULL,
  collection_id       TEXT NOT NULL,
  uploaded_by         TEXT NOT NULL,
  uploaded_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  status              TEXT NOT NULL DEFAULT 'uploading'
                        CHECK (status IN ('uploading', 'processing', 'ready', 'error', 'replaced')),
  chunk_count         INTEGER NOT NULL DEFAULT 0,
  version             INTEGER NOT NULL DEFAULT 1,
  previous_version_id TEXT REFERENCES documents(id),
  content_hash        TEXT,
  error_message       TEXT,
  tags                TEXT[] DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_documents_collection ON documents(collection_id);
CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(status);
CREATE INDEX IF NOT EXISTS idx_documents_content_hash ON documents(content_hash);
CREATE INDEX IF NOT EXISTS idx_documents_uploaded_by ON documents(uploaded_by);

-- ─── Usage Tracking ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS usage_records (
  date          DATE NOT NULL,
  user_id       TEXT NOT NULL,
  query_count   INTEGER NOT NULL DEFAULT 0,
  last_query_at TIMESTAMPTZ,
  PRIMARY KEY (date, user_id)
);

CREATE TABLE IF NOT EXISTS usage_daily_totals (
  date          DATE PRIMARY KEY,
  total_queries INTEGER NOT NULL DEFAULT 0
);

-- ─── Audit Logs ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS audit_logs (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  timestamp     TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id       TEXT NOT NULL,
  username      TEXT NOT NULL,
  action        TEXT NOT NULL,
  details       JSONB NOT NULL DEFAULT '{}',
  previous_hash TEXT,
  entry_hash    TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);

-- ─── Query Logs ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS query_logs (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  timestamp     TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id       TEXT NOT NULL,
  username      TEXT NOT NULL,
  question      TEXT NOT NULL,
  answer        TEXT,
  confidence    TEXT CHECK (confidence IN ('high', 'partial', 'low')),
  sources       JSONB DEFAULT '[]',
  collection_ids TEXT[] DEFAULT '{}',
  response_time_ms INTEGER
);

CREATE INDEX IF NOT EXISTS idx_query_logs_timestamp ON query_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_query_logs_user_id ON query_logs(user_id);

-- ─── RAG Traces ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS rag_traces (
  trace_id            TEXT PRIMARY KEY,
  timestamp           TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id             TEXT NOT NULL,
  username            TEXT NOT NULL,
  query_text          TEXT NOT NULL,
  reformulated_query  TEXT,
  retrieved_chunk_ids TEXT[] DEFAULT '{}',
  retrieval_scores    REAL[] DEFAULT '{}',
  avg_retrieval_score REAL,
  chunks_passed       INTEGER,
  model_id            TEXT,
  response_text       TEXT,
  confidence          TEXT,
  response_time_ms    INTEGER,
  embedding_time_ms   INTEGER,
  retrieval_time_ms   INTEGER,
  generation_time_ms  INTEGER,
  collection_ids      TEXT[] DEFAULT '{}',
  streamed            BOOLEAN DEFAULT false,
  input_tokens        INTEGER,
  output_tokens       INTEGER
);

CREATE INDEX IF NOT EXISTS idx_rag_traces_timestamp ON rag_traces(timestamp);

-- ─── Feedback ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS feedback (
  id             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  timestamp      TIMESTAMPTZ NOT NULL DEFAULT now(),
  trace_id       TEXT,
  user_id        TEXT NOT NULL,
  username       TEXT NOT NULL,
  question       TEXT,
  answer         TEXT,
  feedback_type  TEXT NOT NULL CHECK (feedback_type IN ('thumbs_up', 'thumbs_down', 'flag')),
  notes          TEXT,
  sources        JSONB DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_feedback_trace_id ON feedback(trace_id);
CREATE INDEX IF NOT EXISTS idx_feedback_timestamp ON feedback(timestamp);

-- ─── Job Queue ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS jobs (
  id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  type         TEXT NOT NULL CHECK (type IN ('extraction', 'clinical-extraction')),
  status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  user_id      TEXT NOT NULL,
  input        JSONB NOT NULL DEFAULT '{}',
  result       JSONB,
  error        TEXT,
  progress     INTEGER DEFAULT 0 CHECK (progress >= 0 AND progress <= 100)
);

CREATE INDEX IF NOT EXISTS idx_jobs_user_status ON jobs(user_id, status);
CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at);

-- ─── PPD Submissions ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ppd_submissions (
  id                 TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  patient_info       TEXT NOT NULL,
  language           TEXT NOT NULL DEFAULT 'english',
  responses          JSONB NOT NULL DEFAULT '[]',
  recommendations    JSONB NOT NULL DEFAULT '[]',
  product_selections JSONB DEFAULT '{}',
  submitted_by       TEXT NOT NULL,
  submitted_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  status             TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'in_review', 'completed', 'returned')),
  reviewed_by        TEXT,
  reviewed_at        TIMESTAMPTZ,
  reviewer_notes     TEXT
);

CREATE INDEX IF NOT EXISTS idx_ppd_status ON ppd_submissions(status);
CREATE INDEX IF NOT EXISTS idx_ppd_submitted_by ON ppd_submissions(submitted_by);

-- ─── Monitored Sources ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS monitored_sources (
  id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name                TEXT NOT NULL,
  url                 TEXT NOT NULL,
  collection_id       TEXT NOT NULL,
  check_interval_hours INTEGER NOT NULL DEFAULT 168,
  enabled             BOOLEAN NOT NULL DEFAULT true,
  last_checked_at     TIMESTAMPTZ,
  last_content_hash   TEXT,
  last_change_at      TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Schema Version Tracking ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS schema_migrations (
  version     INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO schema_migrations (version, name)
VALUES (1, '001_initial_schema')
ON CONFLICT (version) DO NOTHING;
