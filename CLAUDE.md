# UMS Knowledge Base Reference Tool

## Project Overview
A HIPAA-aware knowledge base RAG (Retrieval-Augmented Generation) tool for Universal Medical Supply (UMS). Employees upload documents (PDFs, DOCX, XLSX, CSV, TXT) and query them via a chat interface. The system retrieves relevant chunks, sends them to Claude Haiku 4.5 via AWS Bedrock, and returns cited answers.

## Architecture

### Backend (`backend/`)
- **Runtime**: Node.js + Express + TypeScript
- **Entry**: `backend/src/server.ts`
- **Key services** (`backend/src/services/`):
  - `ingestion.ts` — Full pipeline: upload to S3 → extract text → vision describe images → chunk → embed → store in vector store. Mutex-protected index updates, chunk rollback on failure, content-hash deduplication, file extension whitelist.
  - `textExtractor.ts` — Extracts text from PDFs (pdf-parse + conditional Textract OCR based on word count), DOCX, XLSX, CSV, HTML
  - `visionExtractor.ts` — Sends PDFs to Haiku 4.5 via Bedrock Converse API to describe images/diagrams
  - `ocr.ts` — AWS Textract OCR (sync for images, async for multi-page PDFs). 5-minute hard timeout, transient error retry (3 attempts), 100ms pagination delay.
  - `chunker.ts` — Splits text into overlapping chunks with section header detection and table preservation
  - `embeddings.ts` — Embedding facade (delegates to `EmbeddingProvider`), batch support (parallel batches of 20), retry with exponential backoff
  - `embeddingProvider.ts` — `EmbeddingProvider` interface for swappable embedding models
  - `titanEmbeddingProvider.ts` — Amazon Titan Embed V2 implementation of `EmbeddingProvider`
  - `vectorStore.ts` — Hybrid vector store: routes to pgvector (PostgreSQL) when DATABASE_URL is configured, falls back to in-memory S3 JSON. Cosine similarity + IDF-enhanced BM25 keyword boosting + re-ranking. Medical-term-aware tokenizer preserves short tokens (IV, O2, 5mg). NaN guards, dimension validation. Embedding model mismatch detection on init with reindex migration path (`reindexAllEmbeddings`).
  - `s3Storage.ts` — S3 operations for documents, vectors. Size guards (50MB metadata, 500MB vector index).
  - `jobQueue.ts` — Async job queue with S3 persistence (survives restarts), status polling, auto-cleanup
  - `audit.ts` — HIPAA audit logging with HMAC-SHA256 hash chaining (keyed with app secret — attacker with DB access cannot recompute), mutex-protected writes, deep PHI redaction (recursive traversal of nested objects/arrays)
  - `usage.ts` — Per-user daily query limits with rollback on failed queries
  - `queryLog.ts` — Query analytics with CSV export
  - `ragTrace.ts` — Per-query RAG observability tracing (retrieval scores, timing, confidence)
  - `faqAnalytics.ts` — FAQ pattern detection from query logs
  - `feedback.ts` — User feedback/flagging service
  - `formAnalyzer.ts` — CMN form analysis with blank detection and confidence scoring
  - `pdfAnnotator.ts` — Server-side PDF annotation support
  - `documentExtractor.ts` — Structured document extraction with templates (PPD, CMN, Prior Auth, General) using Claude Sonnet
  - `extractionTemplates.ts` — Extraction template definitions and field schemas
  - `clinicalNoteExtractor.ts` — AI-assisted clinical note extraction (ICD-10, test results, medical necessity) using Claude Sonnet
  - `sourceMonitor.ts` — Automated URL monitoring for external document changes (SHA-256 hash comparison). Parallel checks with concurrency limit of 3.
  - `feeScheduleFetcher.ts` — CMS DME fee schedule auto-fetch and ingestion
  - `reindexer.ts` — Document change detection and re-ingestion service
  - `hcpcsLookup.ts` — Static HCPCS code database (332 codes, 25 categories) with search, lookup, and category browsing
  - `icd10Mapping.ts` — ICD-10 to HCPCS crosswalk (66 diagnosis codes, 116+ mappings) for DME equipment justification
  - `coverageChecklists.ts` — LCD coverage criteria checklists (8 LCDs) with documentation validation
  - `referenceEnrichment.ts` — Auto-detects HCPCS/ICD-10 codes and coverage keywords in queries, injects structured reference data into RAG context
  - `ppdQuestionnaire.ts` — PPD (Patient Provided Data) questionnaire (45 questions EN/ES) for Power Mobility Device orders. Weight range validation (70-700 lbs), clinical-context spasticity detection.
  - `pmdCatalog.ts` — PMD product catalog (22 products) with images, brochures, weight capacities, seat types
  - `ppdQueue.ts` — S3-backed PPD submission queue with status workflow (pending → in_review → completed/returned)
  - `seatingEvaluation.ts` — Auto-fills 2-page Seating Evaluation form from PPD responses (10 sections mapped). Numeric armStrength comparison, word-boundary MRADL classification, cognitive status inference from diagnoses.
  - `accountCreation.ts` — PMD Account Creation questionnaire (25 questions EN/ES) for sales lead intake
  - `papAccountCreation.ts` — PAP/CPAP Account Creation questionnaire (24 questions EN/ES) with conditional formatting
  - `emailService.ts` — Gmail SMTP email sending via nodemailer with email format validation and header injection prevention
  - `insuranceCardReader.ts` — Insurance card OCR: Textract + Claude extracts structured fields, immediate PHI redaction, audit trail, mismatch detection
  - `dataRetention.ts` — HIPAA-compliant automated data retention cleanup with hard-coded minimum floors (audit ≥6yr), NaN-safe parseInt, validated date regex
  - `incidentResponse.ts` — Formal IRP (HIPAA §164.308): 7-phase lifecycle (detection → triage → containment → eradication → recovery → post-incident → closed), severity classification (P1-P4), escalation contacts, response procedures with time targets, action items
  - `vulnerabilityScanner.ts` — Automated daily security audits: JWT_SECRET strength, AWS creds, DATABASE_URL, S3_BUCKET, SSL enforcement, npm audit. Admin risk acceptance, scan history capped at 10 reports
- **Middleware** (`backend/src/middleware/`):
  - `auth.ts` — JWT authentication (httpOnly cookies), MFA (TOTP), account lockout, password history, service-to-service API key auth (X-API-Key header with timing-safe comparison for CallAnalyzer integration)
  - `waf.ts` — Application-level WAF: 13 SQLi + 13 XSS + 7 path traversal + 4 CRLF patterns, IP blocklist (permanent + temporary), anomaly scoring with sliding window + auto-block, input truncation (4KB) prevents regex DoS
- **Utilities** (`backend/src/utils/`):
  - `sentry.ts` — Sentry error tracking with PHI-safe scrubbing (8 patterns). Strips request bodies, cookies, query strings. No-op when SENTRY_DSN not set
  - `stripMetadata.ts` — EXIF/IPTC/XMP metadata stripping from image uploads using sharp. Removes GPS, timestamps, device info. Visible content (pixels) preserved for OCR
  - `logger.ts` — Structured JSON logging with AsyncLocalStorage correlation IDs
  - `phiRedactor.ts` — PHI redaction (14 HIPAA identifiers) with deep recursive traversal
- **Routes** (`backend/src/routes/`):
  - `query.ts` — RAG query (non-streaming + streaming SSE), query reformulation for follow-ups, rate-limited (30 req/15min per user)
  - `documents.ts` — Document upload, listing, deletion, clinical extraction, fee schedule fetch, reindex, embedding reindex (migration path for model changes)
  - `extraction.ts` — Structured document extraction with template selection + async job endpoints. Error messages sanitized to prevent internal AWS/Bedrock detail leakage.
  - `users.ts` — Admin user management CRUD (list, update role, delete, password reset)
  - `errors.ts` — Frontend error reporting endpoint
  - `feedback.ts` — User feedback and response flagging
  - `queryLog.ts` — Query log viewing and CSV export
  - `sourceMonitor.ts` — Admin CRUD API for monitored document sources
  - `usage.ts` — Usage stats and limits
  - `hcpcs.ts` — HCPCS code search, lookup, categories
  - `icd10.ts` — ICD-10 to HCPCS crosswalk lookups
  - `coverage.ts` — LCD coverage checklist retrieval and documentation validation
  - `ppd.ts` — PPD questionnaire, PMD recommendations, seating evaluation, submission queue, email
  - `accountCreation.ts` — PMD Account Creation form submission + insurance card OCR
  - `papAccountCreation.ts` — PAP/CPAP Account Creation form submission
- **Config** (`backend/src/config/`): `aws.ts` (AWS clients, model IDs), `database.ts` (PostgreSQL connection pool with RDS SSL), `migrate.ts` (SQL migration runner), `formRules.ts` (CMN form type rules)
- **Database layer** (`backend/src/db/`): Hybrid S3/RDS access layer. `index.ts` routes to PostgreSQL when DATABASE_URL is configured, falls back to S3 JSON. `users.ts` (user CRUD), `documents.ts` (document/collection CRUD with document count aggregation), `vectorStore.ts` (pgvector-backed similarity search with IVFFlat index).
- **Migrations** (`backend/migrations/`): `001_initial_schema.sql` (13 tables: users, documents, collections, audit_logs, query_logs, rag_traces, feedback, jobs, ppd_submissions, monitored_sources, usage_records, usage_daily_totals, schema_migrations), `002_pgvector_chunks.sql` (chunks table with vector(1024) column, IVFFlat index), `003_add_fk_indexes.sql` (indexes on FK columns: usage_records, audit_logs, query_logs, feedback, jobs by user_id + partial index on documents where status='ready'), `004_add_foreign_keys.sql` (FK constraints on 12 columns across 9 tables: RESTRICT on audit/log tables for HIPAA preservation, CASCADE on chunks/usage/jobs), `005_fix_user_id_default.sql` (replaces predictable timestamp-based user ID default with `gen_random_uuid()`)
- **Middleware** (`backend/src/middleware/`): `auth.ts` (JWT auth with role support, async lockout check in middleware, lockout cache for S3 outage resilience, revokeAllUserTokens on password reset)
- **Utils** (`backend/src/utils/`): `logger.ts` (structured JSON logging with correlation IDs), `correlationId.ts` (AsyncLocalStorage per-request tracing), `phiRedactor.ts` (PHI scrubbing with natural language DOB, MRN, SSN, phone, email, address, Medicare/Medicaid), `htmlEscape.ts` (HTML entity escaping for safe email template interpolation), `envValidation.ts`, `fileValidation.ts`, `urlValidation.ts` (SSRF prevention), `resilience.ts` (shared retry with jitter, circuit breaker, timeout), `metrics.ts` (in-memory request metrics with per-route latency percentiles), `textractPoller.ts` (shared Textract async job polling + pagination with transient error retry)
- **Storage abstraction** (`backend/src/storage/`): `interfaces.ts` (MetadataStore, DocumentStore, VectorStore interfaces with RDS/pgvector migration documentation), `s3MetadataStore.ts`, `s3DocumentStore.ts`, `index.ts`
- **Cache abstraction** (`backend/src/cache/`): `interfaces.ts` (CacheProvider, SetProvider), `memoryCache.ts` (in-memory with TTL and LRU eviction), `index.ts` — swap to Redis for horizontal scaling
- **Tests** (`backend/src/__tests__/`): 725 total tests across 49 test files (vitest). Covers vector store, PHI redaction, URL validation, auth flows, usage tracking, HIPAA compliance, extraction templates, document extractor, orphan cleanup, job queue, ingestion pipeline, audit service, embeddings, embedding dimension validation, OCR, email service, data retention, metrics, seating evaluation, PPD questionnaire, integration tests, HTML escaping, HCPCS lookup, ICD-10 mapping, PMD catalog, coverage checklists, form rules, account creation, PAP account creation, reference enrichment, FAQ analytics, and route-level tests for documents, extraction, HCPCS, ICD-10, coverage, queryLog, PPD, and s3Storage.
- **Scripts** (`backend/src/scripts/`): `reset-admin.ts` — Admin password reset utility for when initial random password is lost or account is locked. Works with both PostgreSQL and S3 storage backends. Usage: `cd backend && npx tsx src/scripts/reset-admin.ts [password]`

### Frontend (`frontend/`)
- **Framework**: React + TypeScript + Vite
- **Entry**: `frontend/src/App.tsx`
- **Components** (`frontend/src/components/`):
  - `ChatInterface.tsx` — Main chat with streaming SSE, markdown rendering, source citations
  - `DocumentManager.tsx` — Document upload with progress, status badges, collection management
  - `DocumentSearch.tsx` — Document search and filtering
  - `DocumentExtractor.tsx` — Structured data extraction UI with template selection
  - `IntakeAutoFill.tsx` — Intake/Clinical tab for patient demographics, CMN field mapping
  - `AnnotatedPdfViewer.tsx` — Interactive PDF viewer with drag/move annotations, undo/redo (code-split via React.lazy)
  - `FaqDashboard.tsx` — FAQ pattern analytics
  - `FeedbackForm.tsx` — User feedback on responses
  - `LoginForm.tsx` — Login with account lockout display
  - `ChangePasswordForm.tsx` — Password change with history enforcement
  - `OcrTool.tsx` — OCR tool for ad-hoc text extraction
  - `ObservabilityDashboard.tsx` — RAG trace observability with daily stats, failure drill-down
  - `QualityDashboard.tsx` — Query confidence distribution, flagged responses, unanswered tracking
  - `QueryLogViewer.tsx` — Query log viewer with CSV export
  - `SourceViewer.tsx` — Source citation viewer
  - `PopoutButton.tsx` — Popout window utility
  - `ErrorBoundary.tsx` — React error boundary for graceful degradation
  - `FormsTab.tsx` — Forms tab container with sub-navigation (PPD, PMD Account, PAP Account, PPD Queue)
  - `PpdQuestionnaire.tsx` — PPD phone interview form with API-driven questions (EN/ES), pain body map grid, SVG progress ring, PMD recommendation engine, seating evaluation generator, queue submission
  - `PpdQueueViewer.tsx` — PPD submission queue viewer with status filters, detail view, reviewer controls
  - `AccountCreationForm.tsx` — PMD Account Creation form with section completion badges, progress ring, insurance card OCR upload
  - `PapAccountCreationForm.tsx` — PAP/CPAP Account Creation form with conditional formatting badges, insurance card OCR upload
  - `InsuranceCardUpload.tsx` — Reusable drag-and-drop/paste image upload with Textract OCR, auto-fill, and mismatch detection
  - `LoadingSkeleton.tsx` — Reusable shimmer-animated loading placeholder
  - `Toast.tsx` — Toast notification system with Heroicon status icons and semantic CSS variable theming
  - `ConfirmDialog.tsx` — Modal confirmation dialog with danger variant, Escape key dismiss, auto-focus management
- **Hooks**: `frontend/src/hooks/useAuth.ts` (login/logout with stream cancellation), `frontend/src/hooks/useIdleTimeout.ts` (15-min idle auto-logout with full-viewport interaction blocker)
- **API client**: `frontend/src/services/api.ts` (AbortController-based stream cancellation, 2MB SSE buffer cap)
- **Types**: `frontend/src/types/index.ts`
- **Styling**: CSS variables design system (`index.css`) with 60+ tokens for light/dark themes including semantic status colors (success/error/warning/info with light/border/text variants) and confidence colors (high/partial/low with background/border variants). Tailwind CSS v4 for utility classes. Healthcare blue palette with hexagonal/molecular background pattern. Dark mode via `class="dark"` on `<html>` with localStorage persistence and system preference detection.
- **Icons**: Heroicons (`@heroicons/react/24/outline`) for standard UI, Lucide React (`lucide-react`) for medical icons (Brain logo, Stethoscope for clinical tab)

### AWS Services Used
- **RDS (PostgreSQL 17)**: Primary database for users, documents, collections, audit logs, query logs, traces, feedback, jobs, PPD submissions. pgvector extension for embedding storage and similarity search.
- **S3**: Raw document file storage (PDFs, DOCX, images), form analysis cache. Vector index and metadata fall back to S3 JSON when DATABASE_URL is not configured.
- **Bedrock**: Claude Haiku 4.5 (RAG generation + vision), Claude Sonnet 4.6 (structured extraction + clinical notes), Titan Embed V2 (embeddings)
- **Textract**: OCR for scanned PDFs and images

### Deployment
- Single Docker container via `Dockerfile` (serves both backend API and frontend static build)
- **Production**: EC2 behind ALB with ACM SSL certificate. Auto-deploy via GitHub Actions CD pipeline on push to `main`.
- **Database**: PostgreSQL on shared RDS instance (`ums_knowledge` database), pgvector extension enabled
- Environment variables in `.env` (see `backend/.env.example`)

## Development Commands
```bash
# Backend
cd backend && npm install && npm run dev    # Dev server with tsx watch
cd backend && npx tsc --noEmit              # Type-check only
cd backend && npm test                      # Run unit tests (vitest)

# Frontend
cd frontend && npm install && npm run dev   # Vite dev server
cd frontend && npm run build                # Production build

# Full build (Docker)
docker build -t ums-knowledge .

# Admin password reset (on EC2, loads production env vars)
cd ~/ums-knowledge-reference/backend && env $(cat ~/ums-knowledge.env | grep -v '^#' | xargs) npx tsx src/scripts/reset-admin.ts [optional-password]
```

## Key Configuration
- `backend/src/config/aws.ts` — AWS clients, S3 bucket, Bedrock model IDs
- Generation model: `us.anthropic.claude-haiku-4-5-20251001-v1:0` (cross-region inference profile)
- Extraction model: `us.anthropic.claude-sonnet-4-6-20250514-v1:0` (structured extraction + clinical)
- Embedding model: `amazon.titan-embed-text-v2:0`
- System prompt: `backend/src/routes/query.ts` (line ~70)
- Temperature: `0.15` (RAG), `0.05` (extraction), `0.1` (vision), `0` (reformulation)
- Max tokens: `4096` (RAG), `8192` (extraction), `150` (reformulation)
- Default topK: `8` chunks (was 6; increased for richer context on multi-faceted medical questions)

## Tuning Knobs for Response Quality
- **System prompt** (`query.ts:70`): Controls tone, conciseness, citation style
- **Temperature** (`query.ts:267,407`): Currently 0.15 (conservative). Higher = more varied
- **Max tokens** (`query.ts:264,404`): Currently 4096. Lower = forces shorter answers
- **topK** (`query.ts:224,359`): Default 8 chunks. Fewer = more focused, more = comprehensive
- **Chunk size/overlap** (`chunker.ts`): Affects retrieval granularity

## API Cost Optimization
- **Prompt caching**: All Bedrock InvokeModel calls use `cache_control: { type: 'ephemeral' }` on system prompt blocks. Cache reads cost 0.1x base input price (90% savings). Applied to RAG queries (streaming + non-streaming), query reformulation, document extraction, and clinical note extraction. See `query.ts:88` (`buildSystemBlocks()`).
- **Embedding batching**: `embeddings.ts` processes chunks in parallel batches of 20 via `Promise.all`
- **Retry with exponential backoff**: Embedding calls retry up to 3x (1s, 2s, 4s delays)
- **Model selection**: Haiku 4.5 for RAG (fast/cheap), Sonnet 4.6 for extraction (accurate)
- **Input truncation**: 8K chars for embeddings, 100K for extraction, 2K for user queries
- **Token right-sizing**: Max tokens set per task (150 reformulation, 4096 RAG, 8192 extraction)

## Cross-Project Port Tracking
When making improvements to this codebase, update `OBSERVATORY_PORT_LOG.md` to track which changes are candidates for porting to the multi-tenant [Observatory QA](https://github.com/robinchoudhuryums/observatory-qa) platform. The log tracks porting status (Ported/Pending/N/A) across security, RAG quality, compliance, and observability categories.

## Deployment
- **Docker**: Multi-stage build, `node:20.19.0-slim`, tini init, non-root user, health check
- **Blue-green deploy**: `deploy-bluegreen.sh` — starts new container on staging port (3002), health-checks, then swaps to production port (3001). ~2s downtime vs ~30s with standard deploy. Rollback: `docker stop ums-knowledge && docker rename ums-knowledge-old ums-knowledge && docker start ums-knowledge`
- **CI/CD**: `.github/workflows/ci.yml` — backend lint + type-check + tests + coverage, frontend type-check + build, deploy via SSH with blue-green strategy
- **Error monitoring**: `.github/workflows/error-monitor.yml` — checks Docker status, HTTP health, error logs, disk, DB connectivity, memory every 4 hours. Auto-creates GitHub Issues.

## Environment Variables (not in .env.example)
```
# Service-to-service auth (for CallAnalyzer RAG integration)
SERVICE_API_KEY                 # Shared secret for X-API-Key auth (min 32 chars)
SERVICE_API_USERNAME            # Service account identity (default: call-analyzer)

# Error tracking
SENTRY_DSN                      # Sentry DSN (optional — disabled if not set)

# Database SSL
DB_SSL_REJECT_UNAUTHORIZED      # "false" for self-signed certs in dev (IGNORED in production — always true)

# Field encryption
FIELD_ENCRYPTION_KEY            # AES-256-GCM key for sensitive fields (MFA secrets) at rest

# Malware scanning
MALWARE_SCAN_ENABLED            # "true" to enable ClamAV file scanning
CLAMAV_HOST                     # ClamAV daemon host (default: localhost)
CLAMAV_PORT                     # ClamAV daemon port (default: 3310)

# Redis (optional — enables distributed state)
REDIS_URL                       # Redis connection string
REDIS_KEY_PREFIX                # Key namespace prefix
```

## Recent Changes (reverse chronological)
- **A/B model testing & search optimization** (April 2026, 1 commit):
  - **A/B model testing framework** (`services/abTesting.ts`, `routes/abTesting.ts`): Compare Bedrock models on RAG query quality. `runABTest()` runs same query through two models with shared retrieval context (identical chunks). Welch's t-test for statistical significance on aggregate latency. Automated recommendation based on cost/latency tradeoffs. 4 endpoints: `POST /api/ab-tests/run` (single), `POST /api/ab-tests/batch` (up to 20 questions), `GET /api/ab-tests` (list results), `GET /api/ab-tests/stats` (aggregate with significance testing). 6 new tests
  - **Semantic dedup length-ratio pre-check**: Fast `minSize/maxSize` check before O(n) Jaccard set intersection in `deduplicateResults()`. Skips pairs that can't possibly exceed 0.80 threshold based on token set size difference alone — avoids unnecessary set operations
- **Cross-repo improvements from Observatory QA** (April 2026, 1 commit):
  - **Chunk content dedup with embedding reuse**: During ingestion, SHA-256 hash each chunk's text, look up existing embeddings in pgvector for identical content, skip redundant Bedrock API calls. Reduces embedding costs when documents share common sections (e.g., LCD boilerplate appearing in multiple uploads)
  - **Enhanced prompt injection detection**: HTML entity decoding (`&lt;system&gt;` bypass), NFKD normalization + diacritical mark stripping (`ìgnórè prëvíóüs` bypass), HTML comment stripping (`<!-- -->` hiding), 10KB input truncation (ReDoS prevention), 3 new patterns (XML tag injection, "act as if you", "do not follow"). 7 new tests
  - **Configurable charsPerToken ratio**: Chunker accepts `charsPerToken` option (default 4.0). `getCharsPerTokenForDocType()` returns 3.5 for medical/clinical/LCD/HCPCS docs, 3.8 for forms. Improves token estimation for dense clinical text
- **Codebase audit & cross-repo improvements** (April 2026, 12 commits):
  - **Bug fixes**: useAuth JSON.parse crash, ChatInterface useEffect dependency, MFA audit logging, duplicate migration 004
  - **Query pipeline**: Extracted `processPostGeneration()` helper (deduplicates ~56 lines streaming/non-streaming)
  - **Service-to-service auth**: X-API-Key in auth middleware for CallAnalyzer RAG integration
  - **WAF middleware** (`middleware/waf.ts`): 13 SQLi + 13 XSS + 7 path traversal + 4 CRLF, anomaly scoring, IP blocklist
  - **Incident response** (`services/incidentResponse.ts`): HIPAA §164.308, 7-phase lifecycle, escalation contacts
  - **HMAC audit chain**: SHA-256 → HMAC-SHA256 (attacker with DB access cannot recompute)
  - **Vulnerability scanner** (`services/vulnerabilityScanner.ts`): daily automated security audits
  - **Sentry integration** (`utils/sentry.ts`): PHI-safe error tracking (8 scrubbing patterns)
  - **Image metadata stripping** (`utils/stripMetadata.ts`): EXIF/IPTC/XMP removal before S3 storage
  - **SSL hardening**: production enforces `rejectUnauthorized: true`
  - **Error monitoring**: GitHub Actions workflow every 4 hours
  - **Blue-green Docker deployment**: staging port health check, ~2s downtime
- **RAG quality improvements** (1 commit):
  - **Adaptive search weighting**: Query type classification (`code_lookup`, `coverage_question`, `general`) with automatic semantic/keyword weight adjustment. HCPCS/ICD-10 code queries use 0.4/0.6 (keyword-heavy); coverage questions use 0.55/0.45 (balanced); general queries use 0.7/0.3 (semantic-heavy). Caller can still override via `semanticWeight`/`keywordWeight` options.
  - **Confidence scoring**: Inverted avgScore/topScore blend from 0.6/0.4 to 0.35/0.65 — a single strong match (0.7) now properly lifts confidence even when average is pulled down by noise. Reconciliation floor raised to 0.30. Thresholds retuned (LOW=0.30, PARTIAL=0.42).
  - **Re-ranking diversity**: Added token-overlap deduplication pass. When two chunks share >70% tokens, the lower-scored one gets a penalty (scaled 0→0.06 from 70%→100% overlap). Prevents returning 3 variations of the same paragraph from overlapping chunks.
  - **Threshold tuning**: MIN_SCORE_THRESHOLD raised from 0.10 to 0.15 (filters ~30% marginal noise). Default topK raised from 6 to 8 (richer context for multi-faceted medical questions).
  - **Tests**: 10 new tests for query classification (HCPCS, ICD-10, coverage, general), adaptive weights, and re-ranking diversity (duplicate penalty, low-overlap preservation). 725 total.
- **Code quality & architecture improvements** (1 commit):
  - **DRY**: Extracted shared Textract async polling utility (`textractPoller.ts`) from duplicated code in `ocr.ts` and `formAnalyzer.ts`. Includes transient error retry (was missing in formAnalyzer), configurable pagination limits, and consistent logging.
  - **Dead code**: Removed deprecated `checkUsageLimit()` and `recordQuery()` from `usage.ts` (verified unused across codebase). Removed 2 associated legacy tests.
  - **Error handling**: Added `logger.warn`/`logger.error` to 4 silent `catch {}` blocks in `ppdQueue.ts` and `sourceMonitor.ts` that were swallowing S3 errors with no logging.
  - **Schema**: Migration 005 replaces predictable timestamp-based user ID default (`'user-' || epoch`) with `gen_random_uuid()::text`.
- **Security fixes, embedding migration, deploy rollback** (3 commits):
  - **Security**: Collection ACL enforcement on `GET /:id/versions` and `GET /collections/list` (were bypassing user restrictions). Predictable JWT `jti` in `changePasswordHandler` fixed to `crypto.randomUUID()`. Extraction endpoint error messages sanitized (no more AWS/Bedrock internal detail leakage).
  - **Database**: Migration 004 adds FK constraints on 12 columns across 9 tables. RESTRICT on audit/log tables (HIPAA record preservation), CASCADE on chunks/usage/jobs, RESTRICT on documents→collections.
  - **RAG**: Embedding dimension migration path — mismatch detection on init, dimension validation on `addChunksToStore`, `reindexAllEmbeddings()` function, admin endpoint `POST /api/documents/reindex-embeddings`, health check exposes mismatch status.
  - **Frontend**: ChatInterface streaming refactored from 5-level nested setState to ref-based pattern (eliminates stale closure race conditions).
  - **DevOps**: CI deploy now renames old container before starting new one. Health check retries 3x. Failed health check triggers automatic rollback to previous container. Images tagged with git SHA.
  - **Tests**: 705 → 717 tests across 48 → 49 files. New: collection ACL tests (6), JWT jti test (1), extraction error sanitization test (1), embedding dimension validation/mismatch/reindex tests (6).
- **Comprehensive codebase audit — 40 fixes + 172 new tests** (PR #52, 11 commits):
  - **Test coverage**: 533 → 705 tests across 40 → 48 files. New route-level tests: documents (36), extraction (20), PPD (25), queryLog (15), coverage (11), HCPCS (10), ICD-10 (10), s3Storage (42). CI thresholds raised: 30% → 50% lines, new 40% branch threshold.
  - **HIPAA**: SSL cert validation defaults to `rejectUnauthorized: true` (opt out via `DB_SSL_REJECT_UNAUTHORIZED=false`). PHI redaction on PPD queue logging. Collection ACL on `GET /documents/:id`. Predictable user IDs → `crypto.randomUUID()`. Bulk delete array mutation fix. Audit date range loop fix. Data retention treats invalid dates as expired.
  - **UI/UX**: ARIA labels + `aria-pressed` on feedback buttons. Focus traps in SourceViewer/FeedbackForm modals. `role="dialog"` + `aria-modal`. 120s SSE streaming timeout. Event listener leak fix in useIdleTimeout. ErrorBoundary wraps LoginForm. Type-safe localStorage parsing. Memoized deduplicateSources. Login error UX improved with bold headers and lockout icon.
  - **RAG**: IDF cache invalidation fix (idfVersion++). Minimum score threshold (0.1). Conversation history injection validation. Unicode normalization in prompt injection detection (Cyrillic look-alikes). Chunker forward-progress warning log. Embedding cache key includes model ID.
  - **OCR/Extraction**: FormAnalyzer pagination infinite loop fix (separated polling from pagination, capped MAX_RESULT_PAGES=100). Extraction text limit 80K → 100K with truncation warning. CSV parser handles RFC 4180 escaped quotes. HTML entity decoding: hex entities, precise fallback.
  - **Forms**: Spasticity detection negation check + expanded keywords. Server-side validation for Account Creation and PAP forms. Seating evaluation NaN guard on armStrength.
  - **Architecture**: Mass delete safety guard in db/users.ts. Health check returns 503 when configured DB unreachable. orphanCleanup uses hybrid db/ layer. Migration 003: FK indexes + partial index.
  - **Admin tooling**: Password reset script (`backend/src/scripts/reset-admin.ts`) for locked/lost admin credentials.
- **Test coverage expansion** (10 new test files, 142 new tests): Added tests for htmlEscape, hcpcsLookup, icd10Mapping, pmdCatalog, coverageChecklists, formRules, accountCreation, papAccountCreation, referenceEnrichment, and faqAnalytics. Total: 391 → 533 tests across 30 → 40 test files.
- **Security and DevOps hardening**: HTML escaping utility (`htmlEscape.ts`) applied to all email HTML builders (PPD, Account Creation, PAP) to prevent XSS. CRLF sanitization on email subjects. `requireAdmin` added to PPD status update endpoint (was missing authorization). JWT `jti` changed from predictable `user-id-timestamp` to `crypto.randomUUID()`. CORS origin validation prevents `*` with credentials. Rate limiting added to Account Creation and PAP submit endpoints (10/15min) and query endpoints (30/15min). Lockout timing removed from error messages. `.nvmrc` (Node 20), `.github/dependabot.yml` (weekly npm + GitHub Actions updates).
- **UI/UX improvements**: Semantic CSS variable system with 30+ new tokens for status colors (success/error/warning/info) and confidence colors (high/partial/low) with proper dark mode variants. Replaced hard-coded hex colors across 15+ components. Toast notifications use Heroicons with semantic theming. ConfirmDialog supports Escape key dismiss and danger-variant auto-focus. DocumentSearch adds loading skeleton, search hint, and no-results empty state. ObservabilityDashboard period buttons unified to brand palette. PpdQueueViewer, InsuranceCardUpload, IntakeAutoFill, ChatInterface confidence badges, ErrorBoundary all converted to CSS variables.
- **Comprehensive codebase audit and hardening** (18 commits across all categories):
  - **RAG**: Dynamic BM25 normalization (replaces hardcoded /10), embedding dimension validation, prompt injection detection (12 patterns + XML context framing), medical-term-aware tokenizer (preserves hyphenated terms + short medical tokens like IV, O2, 5mg), chunker table detection fix, usage rollback on failed queries, improved confidence scoring (blended avg+top score, tuned thresholds, model-vs-retrieval reconciliation), output-side guardrails (detect system prompt leakage, role deviation), conversation history validation (20 turn / 50K char budget), NaN guard on combined scores
  - **Ingestion**: Mutex lock on document index updates (prevents concurrent corruption), chunk rollback on failure (prevents orphans), document version audit trail (`document_replaced` action), file extension whitelist, OCR polling loop fix (separated polling from pagination), conditional OCR (word-count threshold skips Textract for text-native PDFs), content-hash deduplication (rejects identical uploads in same collection)
  - **HIPAA**: Audit log hash chain mutex (prevents broken chain from concurrent writes), deep PHI redaction in audit details (recursive traversal of nested objects/arrays), admin password removed from structured logs (written to file instead), JWT_SECRET enforcement in production (fail-fast), reformulated query + conversation history redacted in all trace logs, HIPAA retention floors enforced via `Math.max` (audit ≥ 6yr) with NaN-safe parseInt, insurance card OCR audit trail + immediate rawText redaction, natural language DOB patterns added to PHI redactor, MRN pattern strengthened, RAG response PHI scanning (logs warning + flags response), lockout cache prevents fail-open on S3 outage
  - **Forms**: Weight range validation (70-700 lbs realistic range + NaN guards), spasticity detection with clinical-context keywords (stiff/tight require body-part context), null guards in seating evaluation, MRADL classifier uses word-boundary `\bno\b` matching (no false positive on "no difficulty"), cognitive status inferred from diagnoses, armStrength numeric comparison (not string), empty recommendations guard, email validation with header injection prevention, rate limiting on PPD submission (10/15min) and email (5/15min)
  - **Security**: Account lockout enforced in authenticate middleware via async IIFE (not .then() chain), `revokeAllUserTokens()` on admin password reset, rate limiting on OCR/extraction/form-review/clinical-extract endpoints (10/15min), SSE buffer cap (2MB), client-side PHI detection with confirmation dialog
  - **UI/UX**: InsuranceCardUpload paste handler fix (useState→useEffect), collection selection persisted to localStorage, DocumentManager Select All 3-state (page→all→deselect with indeterminate checkbox), full-viewport idle overlay (z-index 9999, covers modals/portals), CSV export with UTF-8 BOM + multiline per RFC 4180, in-flight SSE stream cancellation on logout via AbortController, LoadingSkeleton component with shimmer animation
  - **Scalability**: `/api/metrics` admin endpoint (per-route request counts, p50/p95/p99 latency, memory usage), job queue S3 persistence (survives restarts), source monitor parallel checks (concurrency 3, correct index tracking), S3 object size guards (metadata 50MB, vector index 500MB), vector store memory warning at 50K chunks, RDS/pgvector migration documented in storage interfaces
  - **OCR**: 5-minute hard timeout via Promise.race, transient error retry (3 attempts) during Textract polling, 100ms pagination delay to prevent AWS throttling, word-count skip threshold (not char count)
  - **Code quality**: Stricter TypeScript (`noUnusedLocals`, `noImplicitReturns`), silent `.catch(() => {})` replaced with logged warnings, dynamic `require()` replaced with static imports, S3 error handling improved (NoSuchKey + NotFound + HTTP 404), unused variables removed, date regex validates month/day ranges
  - **Tests**: 391 tests across 30 files (was 205/18) — new coverage for ingestion, audit, embeddings, OCR, email, data retention, metrics, seating evaluation, PPD questionnaire, PPD queue
- **Insurance card OCR auto-fill**: Upload insurance card images (drag-and-drop/paste) → Textract OCR → Claude extracts structured fields (insurance name, member ID, group #, plan type, subscriber name/DOB). Auto-fills form fields and flags mismatches against entered data. Integrated into both PMD and PAP Account Creation forms.
- **PAP Account Creation form**: CPAP/BiPAP sales lead intake tool ported from Apps Script. 24 questions across 4 sections with conditional formatting badges (sleep study status, CPAP age). Purple/indigo theme. Email via Gmail SMTP.
- **PMD Account Creation form**: Power mobility sales lead intake tool ported from Apps Script. 25 questions across 4 sections (Demographics, Insurance, Clinical, Scheduling) with EN/ES toggle, email support.
- **PPD visual improvements**: SVG progress ring, animated section collapse, pain body map grid (2-column toggle), gradient headers, section completion badges, hover shadows, responsive layout, product cards with 150px images and category gradient headers.
- **PPD questionnaire rewrite**: Switched from hardcoded questions to API-driven (GET /api/ppd/questions). Questions always match backend's 45-question set. Clear form button with confirmation.
- **Seating Evaluation auto-fill**: Maps all 45 PPD answers to the 10-section Seating Evaluation for PMD form. Generates printable HTML. API: POST /api/ppd/seating-eval.
- **PPD submission queue**: In-app queue replacing email handoff. Status workflow: pending → in_review → completed/returned. S3-backed with index. Frontend queue viewer with status filters and reviewer controls.
- **PPD questionnaire and PMD recommendation engine**: Full port of Apps Script PPD tool. 45 questions (EN/ES), phone interview workflow, PMD recommendation engine with: weight-class routing, solid seat logic, stroke/hemiplegia analysis, neuro/SPO/MPO eligibility, oxygen conflict, substitution rules (K0841→K0861, etc.), product catalog with images/brochures.
- **Forms tab**: New "Forms" tab with sub-navigation housing PPD Questionnaire, PMD Account Creation, PAP Account Creation, and PPD Queue.
- **Gmail SMTP email service**: Nodemailer-based email sending for form submissions. Configurable via SMTP_USER/SMTP_PASS env vars. Styled HTML email generation matching original Apps Script format.
- **Structured reference enrichment in RAG**: Query pipeline auto-detects HCPCS codes, ICD-10 codes, and coverage keywords. Injects structured data (code details, crosswalk mappings, LCD checklists) as [Structured Reference] blocks alongside RAG document context.
- **LCD coverage checklists**: 8 real CMS LCD checklists (L33797 oxygen, L33718 CPAP, L33895 beds, etc.) with per-item required/optional flags and validation endpoint.
- **ICD-10 to HCPCS crosswalk**: 66 ICD-10 codes, 116+ mappings. Forward/reverse lookup, partial code matching.
- **HCPCS code lookup**: 332 real DME HCPCS codes across 25 categories (power wheelchairs K0813-K0890, oxygen, CPAP supplies, catheters, incontinence, ventilators, bed accessories, wheelchair accessories, respiratory supplies, etc.).
- **LCD source monitor seeding**: One-call endpoint (POST /api/sources/seed-lcds) creates collection and registers 8 CMS LCD sources for weekly auto-monitoring. HTML text extraction support added.
- **HIPAA compliance improvements**: (1) Audit log hash chaining — tamper-evident SHA-256 chain with verification endpoint. (2) Automated data retention — configurable cleanup at 3 AM daily (audit 7yr, query logs 1yr, traces 90d). (3) Frontend idle timeout — 15-minute auto-logout with 2-minute warning countdown.
- **OpenAPI specification**: Comprehensive OpenAPI 3.0.3 spec (`backend/openapi.yaml`) covering 50+ endpoints, 11 tags, reusable schemas.
- **Horizontal scaling prep**: Cache abstraction layer (`cache/interfaces.ts`) with `CacheProvider` and `SetProvider` interfaces. In-memory implementation with TTL and LRU eviction (10K cap). `SCALING.md` documents all in-memory state and migration paths for multi-instance deployment.
- **HIPAA compliance test suite**: 30 automated tests covering PHI redaction patterns (SSN, phone, email, DOB, MRN, names), false positive prevention (HCPCS codes), redaction performance (<100ms for 100KB), auth security controls, password policy, audit trail fields, HTTPS/HSTS config, session timeout, account lockout. Total: 101 tests.
- **Async document extraction**: Job queue (`jobQueue.ts`) with `POST /api/extraction/extract/async` returning `202 {jobId}`, `GET /api/extraction/jobs/:id` for status polling, `GET /api/extraction/jobs` for user's job list. Background processing with progress tracking. Auto-cleanup of completed jobs after 1 hour.
- **Frontend error tracking**: `POST /api/errors/report` endpoint receives client errors. `errorReporting.ts` service with deduplication (60s window), global `window.onerror`/`unhandledrejection` handlers, `ErrorBoundary` integration via `componentDidCatch`.
- **User management**: Admin CRUD at `/api/users` — list users, update roles (prevents demoting last admin), delete users (prevents self-delete), force password reset with temp password + `mustChangePassword` flag. `lastLogin` tracking.
- **Embedding model abstraction**: `EmbeddingProvider` interface with `TitanEmbeddingProvider` implementation. Facade in `embeddings.ts` delegates to swappable provider. Vector store index now tracks `embeddingModel` and `embeddingDimensions` metadata.
- **Storage abstraction layer**: `MetadataStore`, `DocumentStore`, `VectorStore` interfaces in `storage/interfaces.ts`. S3 implementations wrap existing functions. Singleton exports for callers. Foundation for PostgreSQL/pgvector migration.
- **Retry/circuit breaker**: Shared `withRetry` (exponential backoff + jitter), `withTimeout`, and `CircuitBreaker` class in `utils/resilience.ts`. Applied to Bedrock extraction and clinical note calls. Embeddings migrated from local retry to shared utility.
- **Structured JSON logging**: Logger rewritten to output JSON with ISO timestamps, levels, correlation IDs. `correlationId.ts` uses `AsyncLocalStorage` for per-request tracing. Request middleware generates UUID per request (or reads `X-Request-Id`).
- **httpOnly cookie auth**: JWT tokens now stored in httpOnly cookies (immune to XSS) instead of localStorage. Backend `authenticate` middleware reads from cookie first, Authorization header as fallback. Login/logout/change-password endpoints set/clear the cookie. Frontend uses `credentials: 'same-origin'` on all fetch calls. `isLoggedIn` flag in localStorage replaces token for UI state.
- **Race condition fixes**: (1) Vector store initialization lock prevents concurrent `initializeVectorStore()` calls from corrupting state. (2) Query log and RAG trace day-boundary transitions use promise-based locks with double-check pattern to prevent data loss. (3) Usage tracking: new `checkAndRecordQuery()` atomically checks limits and records usage in one step, eliminating the TOCTOU race between `checkUsageLimit` and `recordQuery`.
- **CI pipeline**: GitHub Actions workflow (`.github/workflows/ci.yml`) with backend lint/type-check/test, frontend type-check/build, and Docker build verification. Runs on push to main and claude/* branches plus all PRs.
- **Integration tests**: Auth flow tests (14 tests: init, login, lockout, JWT validation, password change, user creation) and usage tracking tests (6 tests: atomic limits, concurrent races, per-user tracking). Total test count: 71.
- **Security audit fixes**: (1) SSRF prevention — new `urlValidation.ts` utility blocks private IPs, localhost, cloud metadata endpoints, and non-HTTP protocols on all URL download functions (`feeScheduleFetcher.ts`, `sourceMonitor.ts`); redirect targets re-validated; download size capped at 100MB. 13 unit tests. (2) CSRF protection — double-submit cookie pattern on all state-changing endpoints; `cookie-parser` middleware; frontend sends `x-csrf-token` header on POST/PUT/DELETE. (3) PHI redaction in audit logs — `redactPhi()` applied to question text in both streaming and non-streaming query audit log entries. (4) Docker non-root user — container now runs as `appuser` (UID 1000). (5) CORS hardened — `render.yaml` no longer sets `CORS_ORIGIN: "*"`; must be configured per-deployment. (6) URL validation on source monitor CRUD — add/update operations validate URLs before persisting.
- **Prompt caching**: Enabled Bedrock prompt caching (`cache_control: ephemeral`) on system prompts across all LLM call sites — RAG queries (streaming + non-streaming), query reformulation, document extraction, clinical note extraction. Reduces cached token costs to 0.1x and TTFT by up to 85%. Cache hit/miss logging added to non-streaming RAG queries.
- **HIPAA hardening**: PHI redaction layer (`phiRedactor.ts`) applied to query logs, RAG traces, and feedback before S3 persistence — regex-based detection of SSNs, DOBs, MRNs, phone numbers, emails, addresses, Medicare/Medicaid IDs, and contextual patient names. JWT secret fail-fast in production (server refuses to start with default secret). HTTPS enforcement middleware with HSTS (1-year max-age). Account lockout after 5 failed login attempts (15-minute cooldown). Password history tracking prevents reuse of last 5 passwords. 18 unit tests for PHI redaction.
- **Document source monitor**: Automated URL monitoring service (`sourceMonitor.ts`) that tracks external document URLs (LCDs, CMS policies, payer docs) for content changes. SHA-256 hash comparison, configurable per-source check intervals, auto-ingestion on change with previous version cleanup. Admin CRUD API at `/api/sources/`, force-check per source or all. Background scheduler ticks hourly.
- **Intake data auto-fill**: New "Intake / Clinical" tab with form fields for patient demographics, physician info, supplier details, HCPCS, diagnosis, and insurance. Generates CMN/prior-auth field mappings from entered intake data for form pre-population.
- **AI-assisted clinical note extraction**: Upload physician notes → Claude Sonnet extracts ICD-10 codes, test results (ABG, SpO2, PFT), medical necessity language, functional limitations, equipment recommendations, and HCPCS codes. Maps extracted data to CMN form fields. Backend: `clinicalNoteExtractor.ts`, route: `POST /api/documents/clinical-extract`.
- **Interactive PDF annotation editor**: Client-side PDF viewer (PDF.js) with SVG overlay for interactive annotations. Drag-to-move, click-to-remove, undo/redo (Ctrl+Z/Y), manual highlight drawing with 4 color choices. Code-split via React.lazy(). Component: `AnnotatedPdfViewer.tsx`.
- **Structured document extraction**: Extraction templates (PPD, CMN, Prior Auth, General) with Claude Sonnet via Bedrock. Upload any document → get structured JSON data matching template fields. Route: `POST /api/extraction/extract`.
- **RAG observability tracing**: Per-query trace logging (`ragTrace.ts`) capturing retrieval scores, response times, and confidence. Observability dashboard with daily stats, retrieval/generation failure drill-down.
- **Quality metrics dashboard**: Tracks query confidence distribution, flagged responses, and unanswered questions over time.
- **CMS fee schedule fetcher**: Auto-fetches and ingests CMS DME fee schedules (`feeScheduleFetcher.ts`) with configurable refresh interval. Admin trigger: `POST /api/documents/fee-schedule/fetch`.
- **Document reindexer**: Change detection service (`reindexer.ts`) that checks for modified documents and re-ingests them. Admin trigger: `POST /api/documents/reindex`.
- **Document collections and tagging**: Organize documents into collections, add/remove tags, filter queries by collection.
- **Form review enhancements**: CMN form type auto-detection (CMS-484, CMS-10126, CMS-10125, prior auth) with required-field rules (`config/formRules.ts`), improved blank detection (underscores, placeholders, unchecked checkboxes), confidence threshold categories (high/low at 60%), template caching via SHA-256 hash on S3 (`form-analysis-cache/`), batch review endpoint (up to 10 files), in-browser PDF preview, confidence-based coloring on annotated PDFs (red=missing, amber=low confidence, orange=required)
- **IDF-enhanced BM25 hybrid search**: Added proper IDF weighting to BM25 scoring with corpus-wide term frequency stats, normalized keyword scores for balanced hybrid combination
- **Re-ranking pipeline**: Added post-retrieval re-ranking that boosts section header matches, document-level relevance signals, and penalizes noise chunks
- **Section header detection**: Chunker now auto-detects ALL CAPS, markdown, colon-terminated, and numbered section headers and attaches them as metadata
- **Conversation memory with summarization**: Older conversation turns are summarized into a compact context string, recent 4 turns kept verbatim for follow-up accuracy
- **Document status tracking**: Frontend now shows document status (ready/processing/error) with colored badges; upload queue with per-file progress indicators
- **Admin dashboard improvements**: Unified admin view with header, analytics grid layout
- **Error boundaries**: React ErrorBoundary wraps all tab content for graceful degradation
- **Retry logic**: Bedrock API calls (embeddings) now retry up to 3x with exponential backoff
- **Unit tests**: 38 tests covering cosine similarity, BM25 scoring, IDF, tokenization, section header detection, chunking logic, and PHI redaction (vitest)
- **TypeScript fixes**: Added `types: ["node"]` to tsconfig; moved ExtractedText interface to shared types
- Added conciseness guideline to system prompt for balanced response length
- Added vision-based image description for PDFs (Bedrock Converse API + Haiku 4.5)
- PDF ingestion runs Textract OCR alongside pdf-parse to capture text in images
- Boosted hexagonal background pattern visibility (doubled opacity, increased stroke/dot size)
- Fixed Bedrock cross-region inference profile for Haiku 4.5
- Added auto-logout on 401 responses
- Healthcare blue UI palette with molecular pattern
- Streaming SSE responses, markdown rendering, document search
- FAQ analytics, query logging with CSV export, OCR tool
- Confidence scoring, feedback/flagging, usage tracking

## IAM Permissions Needed
The Bedrock IAM policy needs these actions:
- `bedrock:InvokeModel` (generation, embeddings, vision via Converse)
- `bedrock:InvokeModelWithResponseStream` (streaming responses)
- Textract: `textract:DetectDocumentText`, `textract:AnalyzeDocument`, `textract:StartDocumentTextDetection`, `textract:GetDocumentTextDetection`, `textract:StartDocumentAnalysis`, `textract:GetDocumentAnalysis`
- S3: standard read/write/delete on the configured bucket

## API Endpoints Summary
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/query` | User | RAG query (non-streaming) |
| POST | `/api/query/stream` | User | RAG query (streaming SSE) |
| POST | `/api/documents/upload` | User | Upload document for ingestion |
| GET | `/api/documents` | User | List documents |
| DELETE | `/api/documents/:id` | Admin | Delete document |
| POST | `/api/documents/clinical-extract` | User | Extract clinical data from physician notes |
| POST | `/api/documents/fee-schedule/fetch` | Admin | Trigger CMS fee schedule fetch |
| POST | `/api/documents/reindex` | Admin | Trigger document reindex |
| POST | `/api/documents/reindex-embeddings` | Admin | Re-embed all chunks with current model (migration path) |
| POST | `/api/extraction/extract` | User | Structured document extraction with template (sync) |
| POST | `/api/extraction/extract/async` | User | Start async extraction job, returns jobId |
| GET | `/api/extraction/jobs/:id` | User | Get async job status and result |
| GET | `/api/extraction/jobs` | User | List user's async jobs |
| GET | `/api/users` | Admin | List all users |
| PUT | `/api/users/:id/role` | Admin | Update user role |
| DELETE | `/api/users/:id` | Admin | Delete user |
| POST | `/api/users/:id/reset-password` | Admin | Force-reset user password |
| POST | `/api/errors/report` | User | Report frontend error |
| POST | `/api/feedback` | User | Submit feedback on a response |
| GET | `/api/query-log` | Admin | View query logs |
| GET | `/api/query-log/export` | Admin | Export query logs as CSV |
| GET | `/api/usage` | User | View usage stats |
| GET | `/api/sources` | Admin | List monitored document sources |
| POST | `/api/sources` | Admin | Add monitored source |
| PUT | `/api/sources/:id` | Admin | Update monitored source |
| DELETE | `/api/sources/:id` | Admin | Delete monitored source |
| POST | `/api/sources/:id/check` | Admin | Force-check a source for changes |
| POST | `/api/sources/check-all` | Admin | Force-check all sources |
| POST | `/api/sources/seed-lcds` | Admin | Seed 8 CMS LCD sources for auto-monitoring |
| GET | `/api/hcpcs/search?q=` | User | Search HCPCS codes by code or description |
| GET | `/api/hcpcs/code/:code` | User | Exact HCPCS code lookup |
| GET | `/api/hcpcs/categories` | User | List all HCPCS categories |
| GET | `/api/hcpcs/category/:cat` | User | Codes in a category |
| GET | `/api/icd10/for-diagnosis/:code` | User | HCPCS codes justified by an ICD-10 code |
| GET | `/api/icd10/for-hcpcs/:code` | User | ICD-10 codes that justify a HCPCS code |
| GET | `/api/icd10/search?q=` | User | Search ICD-10 codes |
| GET | `/api/coverage/checklist/:code` | User | LCD coverage checklist for a HCPCS code |
| GET | `/api/coverage/list` | User | List all available checklists |
| POST | `/api/coverage/validate` | User | Validate documentation completeness |
| GET | `/api/ppd/questions` | User | Get PPD questionnaire (45 questions EN/ES) |
| POST | `/api/ppd/recommend` | User | Submit PPD responses, get PMD recommendations |
| POST | `/api/ppd/seating-eval` | User | Generate auto-filled Seating Evaluation |
| POST | `/api/ppd/submit` | User | Submit PPD to review queue |
| GET | `/api/ppd/submissions` | User | List PPD submissions (own or all for admin) |
| PUT | `/api/ppd/submissions/:id/status` | Admin | Update PPD submission status |
| POST | `/api/ppd/send-email` | User | Email PPD form via Gmail SMTP |
| GET | `/api/account-creation/questions` | User | Get PMD Account Creation questionnaire |
| POST | `/api/account-creation/submit` | User | Submit PMD Account Creation form |
| POST | `/api/account-creation/read-insurance-card` | User | OCR insurance card image |
| GET | `/api/pap-account/questions` | User | Get PAP Account Creation questionnaire |
| POST | `/api/pap-account/submit` | User | Submit PAP Account Creation form |
| GET | `/api/query-log/audit/:date/verify` | Admin | Verify audit log hash chain integrity |
| GET | `/api/metrics` | Admin | Server metrics (request counts, latency percentiles, memory) |
| POST | `/api/ab-tests/run` | Admin | Run single A/B test (same query through baseline + test model) |
| POST | `/api/ab-tests/batch` | Admin | Batch A/B test (up to 20 questions) |
| GET | `/api/ab-tests` | Admin | List all A/B test results (last 50) |
| GET | `/api/ab-tests/stats` | Admin | Aggregate stats with Welch's t-test significance |


##Cycle Workflow Config
Test Command
cd backend && npm test

Health Dimensions
PHI Protection, Authentication & Authorization Integrity, RAG Retrieval Quality, HIPAA Audit Completeness, Input Validation & Injection Defense, Data Integrity & Concurrency Safety, Document Processing Correctness, Forms & Clinical Data Accuracy, Reference Data Currency, Test Coverage & Quality, Error Handling & Resilience, Frontend Reliability & Accessibility, Observability & Cost Efficiency

Subsystems
RAG Query Pipeline:
services/vectorStore.ts, services/embeddings.ts, services/embeddingProvider.ts, services/titanEmbeddingProvider.ts, services/cohereEmbeddingProvider.ts, services/chunker.ts, services/referenceEnrichment.ts, services/abTesting.ts, db/vectorStore.ts, routes/query.ts

Document Ingestion & Lifecycle:
services/ingestion.ts, services/textExtractor.ts, services/visionExtractor.ts, services/ocr.ts, services/s3Storage.ts, services/sourceMonitor.ts, services/feeScheduleFetcher.ts, services/reindexer.ts, services/orphanCleanup.ts, routes/documents.ts, routes/sourceMonitor.ts

Document Extraction & Analysis:
services/documentExtractor.ts, services/extractionTemplates.ts, services/clinicalNoteExtractor.ts, services/formAnalyzer.ts, services/pdfAnnotator.ts, services/jobQueue.ts, routes/extraction.ts

Auth, Security & Access Control:
middleware/auth.ts, middleware/authConfig.ts, middleware/tokenService.ts, middleware/waf.ts, services/mfa.ts, services/vulnerabilityScanner.ts, routes/users.ts

HIPAA Compliance & Data Protection:
services/audit.ts, services/dataRetention.ts, services/incidentResponse.ts, utils/phiRedactor.ts, utils/stripMetadata.ts, utils/malwareScan.ts, utils/fieldEncryption.ts

Reference Data & Medical Codes:
services/hcpcsLookup.ts, services/icd10Mapping.ts, services/coverageChecklists.ts, services/pmdCatalog.ts, config/formRules.ts, routes/hcpcs.ts, routes/icd10.ts, routes/coverage.ts

Forms & Workflows:
services/ppdQuestionnaire.ts, services/seatingEvaluation.ts, services/ppdQueue.ts, services/accountCreation.ts, services/papAccountCreation.ts, services/insuranceCardReader.ts, services/emailService.ts, services/productImageResolver.ts, utils/htmlEscape.ts, routes/ppd.ts, routes/accountCreation.ts, routes/papAccountCreation.ts, routes/productImages.ts

Observability & Analytics:
services/ragTrace.ts, services/queryLog.ts, services/faqAnalytics.ts, services/usage.ts, services/feedback.ts, utils/metrics.ts, routes/queryLog.ts, routes/feedback.ts, routes/usage.ts, routes/abTesting.ts, routes/errors.ts

Infrastructure — Data & Storage Layer:
config/aws.ts, config/database.ts, config/migrate.ts, db/index.ts, db/users.ts, db/documents.ts, cache/interfaces.ts, cache/memoryCache.ts, cache/redisCache.ts, cache/index.ts, storage/interfaces.ts, storage/s3DocumentStore.ts, storage/s3MetadataStore.ts, storage/index.ts, types/index.ts, types/declarations.d.ts

Infrastructure — Server & Utilities:
server.ts, tracing.ts, utils/logger.ts, utils/correlationId.ts, utils/resilience.ts, utils/envValidation.ts, utils/urlValidation.ts, utils/fileValidation.ts, utils/asyncMutex.ts, utils/textractPoller.ts, utils/sentry.ts, utils/traceSpan.ts, scripts/reset-admin.ts, scripts/reembed.ts, scripts/migrateProductImages.ts

Frontend — Core & Shared:
App.tsx, main.tsx, types/index.ts, hooks/useAuth.ts, hooks/useIdleTimeout.ts, hooks/useUnsavedChanges.ts, services/api.ts, services/errorReporting.ts, components/LoginForm.tsx, components/ChangePasswordForm.tsx, components/ErrorBoundary.tsx, components/Toast.tsx, components/ConfirmDialog.tsx, components/LoadingSkeleton.tsx, components/PopoutButton.tsx

Frontend — Feature UI (split for audit sessions: 12a Chat & Docs / 12b Forms & Admin):
components/ChatInterface.tsx, components/DocumentManager.tsx, components/DocumentSearch.tsx, components/SourceViewer.tsx, components/FeedbackForm.tsx, components/DocumentsTab.tsx, components/DocumentExtractor.tsx, components/AnnotatedPdfViewer.tsx, components/OcrTool.tsx, components/IntakeAutoFill.tsx, components/ToolsTab.tsx, components/FormsTab.tsx, components/PpdQuestionnaire.tsx, components/PpdQueueViewer.tsx, components/AccountCreationForm.tsx, components/PapAccountCreationForm.tsx, components/InsuranceCardUpload.tsx, components/FormWithQueue.tsx, components/UserManagement.tsx, components/ProductImageManager.tsx, components/UsageLimitsManager.tsx, components/FaqDashboard.tsx, components/ObservabilityDashboard.tsx, components/QualityDashboard.tsx, components/QueryLogViewer.tsx

Invariant Library
INV-01 | Audit log entries must use HMAC-SHA256 hash chain with app secret, never raw SHA-256 | Subsystem: HIPAA Compliance
INV-02 | PHI redaction must run on all data written to query logs, RAG traces, feedback, and audit details before persistence | Subsystem: HIPAA Compliance
INV-03 | Authenticate middleware must check account lockout via async IIFE (not .then()) before granting access | Subsystem: Auth & Security
INV-04 | JWT tokens stored in httpOnly cookies only; localStorage isLoggedIn flag must never contain token | Subsystem: Auth & Security
INV-05 | All Bedrock InvokeModel calls must include cache_control ephemeral on system prompt blocks | Subsystem: RAG Pipeline
INV-06 | Vector store index updates must be protected by async mutex | Subsystem: RAG Pipeline
INV-07 | On ingestion failure after chunks written, chunks must be rolled back (deleted) | Subsystem: Ingestion
INV-08 | Content-hash deduplication must reject identical SHA-256 uploads in same collection | Subsystem: Ingestion
INV-09 | HIPAA retention floors enforced via Math.max (audit >= 6yr) even if env vars set lower | Subsystem: HIPAA Compliance
INV-10 | All URL downloads must validate via SSRF prevention (block private IPs, localhost, metadata) | Subsystem: Server & Utilities
INV-11 | CSRF double-submit cookie enforced on all POST/PUT/DELETE except login and health | Subsystem: Server & Utilities
INV-12 | revokeAllUserTokens() must be called on password reset to invalidate existing sessions | Subsystem: Auth & Security
INV-13 | JWT jti claims must use crypto.randomUUID(), never predictable values | Subsystem: Auth & Security
INV-14 | Extraction route error messages must not expose internal AWS/Bedrock details | Subsystem: Extraction
INV-15 | Embedding dimension validated on addChunksToStore — reject wrong-dimension vectors | Subsystem: RAG Pipeline
INV-16 | WAF middleware must run after body parsing but before CSRF and routes | Subsystem: Server & Utilities
INV-17 | Seating eval armStrength uses numeric comparison with NaN guard | Subsystem: Forms & Workflows
INV-18 | Spasticity detection uses negation check + clinical context, not bare keyword match | Subsystem: Forms & Workflows
INV-19 | SSL rejectUnauthorized=true enforced in production regardless of env var | Subsystem: Infrastructure
INV-20 | JWT_SECRET fail-fast in production if default/weak | Subsystem: Server & Utilities
INV-21 | Prompt injection detection includes NFKD normalization + HTML entity decode | Subsystem: RAG Pipeline
INV-22 | Output guardrails detect system prompt leakage in generated responses | Subsystem: RAG Pipeline
INV-23 | Conversation history enforces 20-turn and 50K-char budgets | Subsystem: RAG Pipeline
INV-24 | S3 object size guards: 50MB metadata, 500MB vector index | Subsystem: Ingestion
INV-25 | checkAndRecordQuery() is atomic — no TOCTOU race between check and record | Subsystem: Observability

Policy Configuration
Policy threshold: 5/10
Consecutive cycles: 2

OUTPUT 2 — CYCLE ROTATION PLAN
Recommended First Subsystem to Audit
Auth, Security & Access Control — This is a HIPAA healthcare application where a security gap has the highest blast radius. Auth is the gatekeeper for everything: any bypass exposes all PHI. It's also a manageable 7 files / ~1,848 lines, making it ideal for establishing audit patterns and calibrating scoring.

Recommended Cycle Order
Cycle	Subsystem	Rationale
1	Auth, Security & Access Control	Highest consequence — auth bypass = total PHI exposure. Establishes security baseline.
2	HIPAA Compliance & Data Protection	Directly follows auth — validates that even with correct auth, PHI is redacted and audit trail is intact.
3	RAG Query Pipeline	Core product value — search quality directly impacts user trust and medical decision support.
4	Document Ingestion & Lifecycle	Feeds the RAG pipeline — garbage in = garbage out. Concurrency bugs here corrupt the entire index.
5	Infrastructure — Server & Utilities	Cross-cutting concerns (CSRF, rate limiting, SSRF) affect all subsystems. Best audited after understanding the features they protect.
6	Infrastructure — Data & Storage Layer	Database/S3 fallback logic, connection pools, migrations. Foundation for everything above.
7	Document Extraction & Analysis	Clinical data accuracy — extraction errors cascade into wrong form fills and potentially wrong treatments.
8	Forms & Workflows	Domain-critical — PPD/seating eval mapping errors affect real patient equipment orders.
9	Reference Data & Medical Codes	Static data correctness — HCPCS/ICD-10/LCD accuracy directly affects claim approvals.
10	Observability & Analytics	Supports all other subsystems but lower blast radius. PHI-in-logs is the main risk (covered by invariants).
11	Frontend — Core & Shared	Auth state, XSS prevention, SSE handling. Client-side security surface.
12a	Frontend — Feature UI: Chat & Docs	Primary user interface — streaming, document management, PDF viewer.
12b	Frontend — Feature UI: Forms & Admin	Form accuracy, admin controls, dashboard correctness.
Seams Audit Frequency
Every 3 subsystem cycles — audit seam files (referenceEnrichment, s3Storage, phiRedactor, jobQueue, htmlEscape, formRules, emailService, routes/abTesting) to verify cross-subsystem contracts haven't drifted.

CONFIDENCE ASSESSMENT
Subsystem	File List Confidence	Boundary Confidence	Notes
RAG Query Pipeline	High	High	Clear import chain from embeddings→vectorStore→query
Document Ingestion & Lifecycle	High	High	Linear pipeline with clear boundaries
Document Extraction & Analysis	High	High	Self-contained with jobQueue as only shared concern
Auth, Security & Access Control	High	High	Middleware directory provides natural boundary
HIPAA Compliance & Data Protection	High	Medium	phiRedactor is a seam file (consumed by Observability too)
Reference Data & Medical Codes	High	High	Static data services with 1:1 route mapping
Forms & Workflows	High	Medium	emailService is a seam (also used by auth password reset)
Observability & Analytics	High	Medium	routes/abTesting is a seam (could be in RAG Pipeline)
Infrastructure — Data & Storage	High	High	Directory-aligned, clear interface boundaries
Infrastructure — Server & Utilities	High	High	Entry point + cross-cutting utils, natural grouping
Frontend — Core & Shared	High	High	App shell + shared primitives, clear boundary
Frontend — Feature UI	High	Medium	Large subsystem; split into 12a/12b for audit sessions; component independence means boundary is flexible
