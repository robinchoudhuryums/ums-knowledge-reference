-- Migration 006: Add audit chain state table for multi-instance coordination
--
-- Stores the last audit hash so multiple server instances can atomically
-- read and update the chain via SELECT FOR UPDATE, preventing broken chains
-- from concurrent writes.
--
-- Run: psql -U ums_admin -d ums_knowledge -f migrations/006_audit_chain_state.sql

BEGIN;

CREATE TABLE IF NOT EXISTS audit_chain_state (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO audit_chain_state (key, value)
VALUES ('last_hash', 'GENESIS')
ON CONFLICT (key) DO NOTHING;

INSERT INTO schema_migrations (version, name)
VALUES (6, '006_audit_chain_state')
ON CONFLICT (version) DO NOTHING;

COMMIT;
