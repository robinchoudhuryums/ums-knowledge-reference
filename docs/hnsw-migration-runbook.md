# HNSW Index Migration Runbook — Phase 2

## Overview

Replace the IVFFlat index on `chunks.embedding` with HNSW for better recall@10
at the same or lower latency. The migration is SQL-only — no app code changes.

**Expected impact:** 5–15% recall improvement (literature + pgvector benchmarks).
**Risk:** Low — fully reversible. The app works identically with either index type.
**Downtime:** Zero — `CREATE INDEX CONCURRENTLY` does not lock the table.
**Duration:** 2–30 minutes depending on corpus size (~1 min per 50K chunks).

---

## Pre-flight: Test on an RDS Snapshot

**Do this first.** Never run the migration directly on production without verifying
on a copy.

### 1. Create an RDS snapshot

```bash
# Via AWS CLI (or use the RDS console → Snapshots → Take snapshot)
aws rds create-db-snapshot \
  --db-instance-identifier ums-knowledge-db \
  --db-snapshot-identifier ums-hnsw-test-$(date +%Y%m%d)

# Wait for it to complete (~5-10 min for a small instance)
aws rds wait db-snapshot-available \
  --db-snapshot-identifier ums-hnsw-test-$(date +%Y%m%d)
```

### 2. Restore the snapshot to a temp instance

```bash
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier ums-hnsw-test \
  --db-snapshot-identifier ums-hnsw-test-$(date +%Y%m%d) \
  --db-instance-class db.t3.micro \
  --no-multi-az

# Wait for instance to become available (~5 min)
aws rds wait db-instance-available --db-instance-identifier ums-hnsw-test

# Get the endpoint
aws rds describe-db-instances \
  --db-instance-identifier ums-hnsw-test \
  --query 'DBInstances[0].Endpoint.Address' --output text
```

### 3. Connect and check current state

```bash
# Build the connection string (replace <endpoint> with the value from above)
export TEST_DB_URL="postgresql://ums_user:<password>@<endpoint>:5432/ums_knowledge?sslmode=require"

psql "$TEST_DB_URL" -c "
  SELECT count(*) AS total_chunks,
         pg_size_pretty(pg_relation_size('chunks')) AS table_size
  FROM chunks;
"

# Verify current index type
psql "$TEST_DB_URL" -c "
  SELECT indexname, indexdef
  FROM pg_indexes
  WHERE tablename = 'chunks' AND indexname LIKE '%embedding%';
"
# Should show: idx_chunks_embedding ... USING ivfflat ...
```

### 4. Run the migration on the test instance

```bash
# Step 1: Drop old IVFFlat index
psql "$TEST_DB_URL" -c "DROP INDEX IF EXISTS idx_chunks_embedding;"

# Step 2: Create HNSW index (CONCURRENTLY requires no transaction wrapper)
# Time this — it tells you how long production will take.
time psql "$TEST_DB_URL" -c "
  CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chunks_embedding
    ON chunks USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);
"

# Step 3: Record migration
psql "$TEST_DB_URL" -c "
  INSERT INTO schema_migrations (version, name)
  VALUES (9, '009_hnsw_index')
  ON CONFLICT (version) DO NOTHING;
"

# Verify the new index
psql "$TEST_DB_URL" -c "
  SELECT indexname, indexdef
  FROM pg_indexes
  WHERE tablename = 'chunks' AND indexname LIKE '%embedding%';
"
# Should show: idx_chunks_embedding ... USING hnsw ... (m=16, ef_construction=64)
```

### 5. Run the eval harness against the test instance

```bash
cd backend

# Point the eval at the test DB (override DATABASE_URL only)
DATABASE_URL="$TEST_DB_URL" npx tsx src/scripts/evalRag.ts

# Compare against your baseline
node scripts/diffEval.js eval-output/results.json eval-output/baseline-*.json
```

**What to look for:**
- Aggregate recall@10 should improve or hold steady
- Per-category: check if any category regressed (the diff script highlights these in red)
- If any regressions: try tuning `ef_search` (see "Tuning" section below)

### 6. Clean up test instance

```bash
aws rds delete-db-instance \
  --db-instance-identifier ums-hnsw-test \
  --skip-final-snapshot

# Also delete the snapshot if you don't need it
aws rds delete-db-snapshot \
  --db-snapshot-identifier ums-hnsw-test-$(date +%Y%m%d)
```

---

## Production Cutover

Only proceed if the snapshot test showed improvement (or at least no regression).

### Timing

Pick a low-traffic window. The index build doesn't lock the table, but it does
consume CPU/IO on the RDS instance. Early morning UTC is ideal (matches the
nightly eval schedule).

### Steps

```bash
# SSH to the EC2 host (or run from any machine with psql + DB access)
ssh $EC2_USER@$EC2_HOST

# Connect to production
psql "$DATABASE_URL"
```

Then run each statement **one at a time** (not in a transaction):

```sql
-- Step 1: Drop old IVFFlat (~instant)
DROP INDEX IF EXISTS idx_chunks_embedding;

-- Step 2: Build HNSW index CONCURRENTLY
-- This takes minutes. Monitor with: SELECT * FROM pg_stat_progress_create_index;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_chunks_embedding
  ON chunks USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Step 3: Record migration
INSERT INTO schema_migrations (version, name)
VALUES (9, '009_hnsw_index')
ON CONFLICT (version) DO NOTHING;
```

### Verify

```sql
-- Confirm index type
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'chunks' AND indexname LIKE '%embedding%';
-- Expected: ... USING hnsw ...

-- Confirm index is valid (not left in INVALID state from a failed CONCURRENTLY)
SELECT indexrelid::regclass, indisvalid
FROM pg_index
WHERE indrelid = 'chunks'::regclass;
-- All should show indisvalid = true

-- Quick smoke test: run a similarity query and check it uses the index
EXPLAIN ANALYZE
SELECT id, 1 - (embedding <=> '[0.1,0.2,...]'::vector) AS score
FROM chunks
ORDER BY embedding <=> '[0.1,0.2,...]'::vector
LIMIT 10;
-- Should show "Index Scan using idx_chunks_embedding"
```

### Post-cutover eval

```bash
# Trigger a manual eval run
# GitHub → Actions → RAG Eval Nightly → Run workflow

# Or run locally:
cd backend && npx tsx src/scripts/evalRag.ts

# Diff against baseline
node scripts/diffEval.js eval-output/results.json eval-output/baseline-*.json
```

Save the post-HNSW results as a new baseline if recall improved:
```bash
cp eval-output/results.json eval-output/baseline-post-hnsw-$(date +%Y%m%d).json
git add eval-output/baseline-post-hnsw-*.json
git commit -m "Phase 2 baseline: recall@10 N% (+X%), MRR N% (+Y%) after HNSW"
```

---

## Rollback

If something went wrong (index build failed, recall dropped, latency spiked):

```sql
-- Drop the HNSW index
DROP INDEX IF EXISTS idx_chunks_embedding;

-- Rebuild IVFFlat (the original index type)
-- lists=100 is the default from migration 002
CREATE INDEX CONCURRENTLY idx_chunks_embedding
  ON chunks USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- Remove the migration record so it can be re-attempted later
DELETE FROM schema_migrations WHERE version = 9;
```

---

## Tuning (if needed)

### Build-time parameters (set during CREATE INDEX)

| Parameter | Default | Effect |
|---|---|---|
| `m` | 16 | Max connections per node. Higher = better recall, more memory, slower build. Try 24 or 32 if recall is still below target. |
| `ef_construction` | 64 | Build-time beam width. Higher = better index quality, slower build. Try 128 if recall needs a boost. |

Changing these requires dropping and rebuilding the index.

### Query-time parameter

```sql
-- Set per-session (or per-transaction) before running queries
SET hnsw.ef_search = 100;  -- default is 40

-- Test with higher values:
SET hnsw.ef_search = 200;
```

Higher `ef_search` = better recall, higher latency. The sweet spot is usually
80–200 for medical corpora. To set it application-wide, add to the connection
pool configuration in `backend/src/config/database.ts`:

```typescript
// In buildPoolConfig(), add to the return object:
options: {
  statement: ['SET hnsw.ef_search = 100']
}
```

Or use an `afterCreate` pool hook. But test the latency impact first —
the eval harness measures wall-clock time per query.

---

## Monitoring

After cutover, watch these for 24 hours:

1. **Nightly eval** — the workflow runs at 5 AM UTC; check the artifact for recall/MRR
2. **RDS CloudWatch** — `ReadLatency`, `CPUUtilization`, `FreeableMemory`
3. **App metrics** — `GET /api/metrics` → check p95 query latency
4. **User feedback** — if operators report slower or worse answers, check the eval diff

The HNSW index uses more memory than IVFFlat. For a 50K-chunk corpus with
1024-dim vectors, expect ~200–400MB additional memory. Monitor `FreeableMemory`
on RDS and scale the instance class if it drops below 500MB.
