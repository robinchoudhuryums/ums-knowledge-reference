# Horizontal Scaling Guide

## In-Memory State Locations

| File | Variables | What it stores | Risk with 2+ instances |
|------|-----------|----------------|----------------------|
| `backend/src/services/vectorStore.ts` | `cachedIndex`, `idfCache`, `docFreqCounts`, `totalCorpusTokens`, `corpusChunkCount`, `embeddingModelMismatch` | Full vector index + incremental IDF state + embedding model tracking | Each instance has its own stale copy; uploads on one instance are invisible to others until they reload |
| `backend/src/services/queryLog.ts` | `todayEntries`, `todayDate` | Today's query log buffer (flushes to S3 every 15s) | **Mitigated**: read-merge-write flush pattern with deduplication prevents entry loss |
| `backend/src/services/ragTrace.ts` | `todayTraces`, `todayFeedback`, `todayDate` | Today's RAG trace + feedback buffer (flushes to S3 every 15s) | **Mitigated**: read-merge-write flush with traceId deduplication prevents loss |
| `backend/src/services/usage.ts` | `todayRecord`, `cachedLimits` | Per-user daily query counts and rate limits | Users can exceed limits by hitting different instances |
| `backend/src/middleware/auth.ts` | `revokedTokens`, `revokedUserIds` (Sets) | JWTs invalidated on logout (TTL: 35min) | Logout on instance A does not revoke the token on instance B |
| `backend/src/middleware/auth.ts` | Reset codes (via cache abstraction) | Password reset codes (TTL: 15min) | **Mitigated**: uses CacheProvider — in-memory for single instance, Redis when REDIS_URL configured |

## Migration Path

### Move to Redis / ElastiCache (shared, fast, ephemeral)
- **`revokedTokens`** — Use `SetProvider`. Critical for security. `sets.add("revoked_tokens", jti, 35 * 60 * 1000)`
- **`cachedLimits`** / **`todayRecord`** (usage) — Use `CacheProvider`. Key: `usage:<date>`. Atomicity via Redis INCR.
- **`idfCache`** — Use `CacheProvider`. Rebuild on index change, share across instances.
- **`cachedIndex`** — Large (all vectors). Options:
  - Redis with serialized index (works up to ~100k chunks)
  - Dedicated vector DB (OpenSearch / pgvector) for larger scale

### Move to a database (durable, queryable)
- **`todayEntries`** (query logs) — Append-only writes suit DynamoDB or PostgreSQL. Eliminates flush races.
- **`todayTraces`** / **`todayFeedback`** (RAG traces) — Same as query logs. Database solves concurrent-write conflicts.

### Keep in-memory (stateless, no migration needed)
- **`initPromise`** / **`ensurePromise`** (lock guards) — Process-local concurrency control; each instance manages its own.
- **`schedulerInterval`** in `sourceMonitor.ts` — Timer handle; use leader election or a single cron worker to avoid duplicate checks.

## Recommended Architecture for 2+ Instances

1. **Add Redis (ElastiCache)** — Token revocation, usage counters, vector index cache, IDF cache
2. **Add PostgreSQL or DynamoDB** — Query logs, RAG traces, feedback (replace S3 JSON files)
3. **Leader election for background tasks** — Source monitor scheduler and fee schedule fetcher should run on one instance only (use Redis-based lock or a separate worker process)
4. **Sticky sessions not required** — All user auth state is in JWT + Redis; no session affinity needed
5. **S3 remains** — Document storage, vector index persistence (source of truth), audit logs

## Cache Abstraction

The interfaces in `backend/src/cache/` provide a drop-in abstraction:

- `CacheProvider` — key/value with optional TTL (`get`, `set`, `delete`, `has`)
- `SetProvider` — set membership with optional TTL (`add`, `has`, `remove`)
- Current implementation: in-memory with LRU eviction at 10k entries
- Swap to Redis: implement the same interfaces using `ioredis` and update `backend/src/cache/index.ts`
