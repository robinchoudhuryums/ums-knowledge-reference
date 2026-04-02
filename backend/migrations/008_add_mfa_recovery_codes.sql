-- Migration 008: Add MFA recovery codes column
--
-- Stores bcrypt-hashed one-time recovery codes for MFA backup.
-- Array of hashed codes; entries are removed as codes are consumed.

BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_recovery_codes TEXT[] DEFAULT '{}';

INSERT INTO schema_migrations (version, name)
VALUES (8, '008_add_mfa_recovery_codes')
ON CONFLICT (version) DO NOTHING;

COMMIT;
