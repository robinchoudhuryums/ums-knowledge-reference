-- Migration 007: Add email column to users table
--
-- Enables direct password reset emails to users instead of routing through admin.

BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;

INSERT INTO schema_migrations (version, name)
VALUES (7, '007_add_user_email')
ON CONFLICT (version) DO NOTHING;

COMMIT;
