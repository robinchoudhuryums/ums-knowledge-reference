-- Migration 005: Add MFA columns to users table
--
-- Adds TOTP multi-factor authentication fields. Without these columns,
-- MFA settings are silently lost when using PostgreSQL (they only persisted
-- in S3 JSON mode via the full User object serialization).
--
-- Run: psql -U ums_admin -d ums_knowledge -f migrations/005_add_mfa_columns.sql

BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_secret TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN NOT NULL DEFAULT false;

INSERT INTO schema_migrations (version, name)
VALUES (5, '005_add_mfa_columns')
ON CONFLICT (version) DO NOTHING;

COMMIT;
