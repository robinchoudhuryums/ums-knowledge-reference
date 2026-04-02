-- Migration 005: Replace predictable user ID default with cryptographic UUID
--
-- The original default `'user-' || extract(epoch from now())::bigint` generates
-- timestamp-based IDs that are predictable and enumerable (~86,400 possible values
-- per day). While the application always uses crypto.randomUUID(), the DB default
-- could be exploited via direct SQL access or schema reuse.
--
-- This changes the default to use pgcrypto's gen_random_uuid(), matching the
-- application's UUID generation pattern.
--
-- Run: psql -U ums_admin -d ums_knowledge -f migrations/005_fix_user_id_default.sql

BEGIN;

ALTER TABLE users ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;

INSERT INTO schema_migrations (version, name)
VALUES (5, '005_fix_user_id_default')
ON CONFLICT (version) DO NOTHING;

COMMIT;
