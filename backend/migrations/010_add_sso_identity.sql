-- Migration 010: Add SSO identity columns to users table
--
-- Supports Option-A SSO with CallAnalyzer where RAG keeps its local users
-- table but trusts CA as the auth authority. On first SSO login, we look up
-- a local user by sso_sub (CA's user id); on miss, we fall back to matching
-- by email/username; on second miss, we JIT-provision a fresh row.
--
-- Existing RAG user rows are untouched — sso_sub is nullable so break-glass
-- local-password accounts keep working, and the first SSO login from an
-- existing email-matched user will populate sso_sub on demand.

BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS sso_sub TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS sso_source TEXT;

-- UNIQUE on sso_sub prevents two local rows claiming the same CA identity.
-- Partial index (WHERE sso_sub IS NOT NULL) so multiple NULLs are allowed
-- for pre-SSO / break-glass users.
CREATE UNIQUE INDEX IF NOT EXISTS users_sso_sub_idx
  ON users(sso_sub)
  WHERE sso_sub IS NOT NULL;

INSERT INTO schema_migrations (version, name)
VALUES (10, '010_add_sso_identity')
ON CONFLICT (version) DO NOTHING;

COMMIT;
