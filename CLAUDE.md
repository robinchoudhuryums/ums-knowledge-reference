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
  - `vectorStore.ts` — Hybrid vector store: routes to pgvector (PostgreSQL) when DATABASE_URL is configured, falls back to in-memory S3 JSON. Cosine similarity + IDF-enhanced BM25 keyword boosting + re-ranking. Medical-term-aware tokenizer preserves short tokens (IV, O2, 5mg). NaN guards, dimension validation.
  - `s3Storage.ts` — S3 operations for documents, vectors. Size guards (50MB metadata, 500MB vector index).
  - `jobQueue.ts` — Async job queue with S3 persistence (survives restarts), status polling, auto-cleanup
  - `audit.ts` — HIPAA audit logging with SHA-256 hash chaining, mutex-protected writes, deep PHI redaction (recursive traversal of nested objects/arrays)
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
- **Routes** (`backend/src/routes/`):
  - `query.ts` — RAG query (non-streaming + streaming SSE), query reformulation for follow-ups, rate-limited (30 req/15min per user)
  - `documents.ts` — Document upload, listing, deletion, clinical extraction, fee schedule fetch, reindex
  - `extraction.ts` — Structured document extraction with template selection + async job endpoints
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
- **Migrations** (`backend/migrations/`): `001_initial_schema.sql` (13 tables: users, documents, collections, audit_logs, query_logs, rag_traces, feedback, jobs, ppd_submissions, monitored_sources, usage_records, usage_daily_totals, schema_migrations), `002_pgvector_chunks.sql` (chunks table with vector(1024) column, IVFFlat index), `003_add_fk_indexes.sql` (indexes on FK columns: usage_records, audit_logs, query_logs, feedback, jobs by user_id + partial index on documents where status='ready'), `004_add_fk_constraints.sql` (FK constraints with cascade deletes: documents→collections, documents→users, usage_records→users, feedback→users/traces, jobs→users, ppd→users, sources→collections)
- **Middleware** (`backend/src/middleware/`): `auth.ts` (JWT auth with role support, async lockout check in middleware, lockout cache for S3 outage resilience, revokeAllUserTokens on password reset), `authConfig.ts` (JWT config, password validation, lockout logic), `tokenService.ts` (token creation/revocation, cookie management)
- **Utils** (`backend/src/utils/`): `logger.ts` (structured JSON logging with correlation IDs), `correlationId.ts` (AsyncLocalStorage per-request tracing), `phiRedactor.ts` (PHI scrubbing with natural language DOB, MRN, SSN, phone, email, address, Medicare/Medicaid), `htmlEscape.ts` (HTML entity escaping for safe email template interpolation), `envValidation.ts`, `fileValidation.ts`, `urlValidation.ts` (SSRF prevention), `resilience.ts` (shared retry with jitter, circuit breaker, timeout), `metrics.ts` (in-memory request metrics with per-route latency percentiles)
- **Storage abstraction** (`backend/src/storage/`): `interfaces.ts` (MetadataStore, DocumentStore, VectorStore interfaces with RDS/pgvector migration documentation), `s3MetadataStore.ts`, `s3DocumentStore.ts`, `index.ts`
- **Cache abstraction** (`backend/src/cache/`): `interfaces.ts` (CacheProvider, SetProvider), `memoryCache.ts` (in-memory with TTL and LRU eviction), `index.ts` — swap to Redis for horizontal scaling
- **Tests** (`backend/src/__tests__/`): 731 total tests across 49 test files (vitest). Covers vector store, PHI redaction, URL validation, auth flows, usage tracking, HIPAA compliance, extraction templates, document extractor, orphan cleanup, job queue, ingestion pipeline, audit service, embeddings, OCR, email service, data retention, metrics, seating evaluation, PPD questionnaire, integration tests, HTML escaping, HCPCS lookup, ICD-10 mapping, PMD catalog, coverage checklists, form rules, account creation, PAP account creation, reference enrichment, FAQ analytics, and route-level tests for documents, extraction, HCPCS, ICD-10, coverage, queryLog, PPD, and s3Storage.
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
- Default topK: `6` chunks

## Tuning Knobs for Response Quality
- **System prompt** (`query.ts:70`): Controls tone, conciseness, citation style
- **Temperature** (`query.ts:267,407`): Currently 0.15 (conservative). Higher = more varied
- **Max tokens** (`query.ts:264,404`): Currently 4096. Lower = forces shorter answers
- **topK** (`query.ts:224,359`): Default 6 chunks. Fewer = more focused, more = comprehensive
- **Chunk size/overlap** (`chunker.ts`): Affects retrieval granularity

## API Cost Optimization
- **Prompt caching**: All Bedrock InvokeModel calls use `cache_control: { type: 'ephemeral' }` on system prompt blocks. Cache reads cost 0.1x base input price (90% savings). Applied to RAG queries (streaming + non-streaming), query reformulation, document extraction, and clinical note extraction. See `query.ts:88` (`buildSystemBlocks()`).
- **Embedding batching**: `embeddings.ts` processes chunks in parallel batches of 20 via `Promise.all`
- **Retry with exponential backoff**: Embedding calls retry up to 3x (1s, 2s, 4s delays)
- **Model selection**: Haiku 4.5 for RAG (fast/cheap), Sonnet 4.6 for extraction (accurate)
- **Input truncation**: 8K chars for embeddings, 100K for extraction, 2K for user queries
- **Token right-sizing**: Max tokens set per task (150 reformulation, 4096 RAG, 8192 extraction)

## Development Roadmap
See `ROADMAP.md` for the full prioritized roadmap covering: code quality, RAG quality (medical embeddings, cross-encoder re-ranking, evaluation framework), HIPAA hardening (MFA, field-level encryption, audit immutability), scalability (Redis, HNSW, worker queues), UI/UX (mobile responsive, WCAG AA), and testing/observability.

## Cross-Project Port Tracking
When making improvements to this codebase, update `OBSERVATORY_PORT_LOG.md` to track which changes are candidates for porting to the multi-tenant [Observatory QA](https://github.com/robinchoudhuryums/observatory-qa) platform. The log tracks porting status (Ported/Pending/N/A) across security, RAG quality, compliance, and observability categories.

## Recent Changes (reverse chronological)
- **Scalability improvements — database, performance, metrics**:
  - **Database**: Migration 004 adds FK constraints with cascade deletes across 8 tables (documents→collections/users, usage→users, feedback→users/traces, jobs→users, ppd→users, sources→collections). Migration 003 syntax fix.
  - **Performance**: Incremental IDF updates — add/remove operations update running doc-frequency counts in O(changed chunks) instead of rebuilding from O(corpus). Full rebuild only on first query after startup.
  - **Performance**: Audit log retrieval now fetches S3 objects in parallel batches of 10 (was sequential), ~10x faster for high-volume days.
  - **Metrics**: `/api/metrics` now includes database connection pool stats (totalConnections, idleConnections, waitingRequests) when PostgreSQL is configured.
- **Codebase audit round 2 — bug fixes + quality improvements**:
  - **Bug fix**: SPA fallback now returns JSON 404 for unmatched `/api/*` routes instead of serving `index.html`
  - **Bug fix**: Document selection state (selectedIds) now resets when switching collections, preventing bulk operations on wrong documents
  - **Bug fix**: Medical synonym self-reference removed (`hospital bed` no longer maps to itself)
  - **Security**: Collection ACL enforced on document delete, version history, tags list, and text search endpoints (previously admin-only but no collection restriction)
  - **Security**: reset-admin.ts script respects `DB_SSL_REJECT_UNAUTHORIZED` env var (was hardcoded `false`)
  - **Security**: Email error messages no longer leaked to clients (account creation, PAP routes)
  - **Security**: ReactMarkdown `skipHtml` prevents raw HTML injection in chat responses
  - **Refactor**: Extracted shared `runQueryPipeline()` from streaming/non-streaming query endpoints (~100 lines deduplicated)
  - **Documentation**: Added `ROADMAP.md` with prioritized multi-sprint improvement plan, referenced from CLAUDE.md
- **RAG quality improvements — 4 enhancements**:
  - **Medical synonyms**: Expanded from 30 to 75+ synonym groups — added DME equipment (ventilator, commode, lift, TENS, trapeze, mattress, mask, tubing), clinical abbreviations (MS, SCI, TBI, ESRD, AFib, PE, RA, OA), and billing terms (denial, appeal, modifier, MBI, HICN, ADL, MRADL, DMRC, CBA, AOB, EOB)
  - **Confidence scoring**: Added score-spread awareness (penalize single-result queries), confidence upgrade path (PARTIAL→HIGH when top retrieval score >0.65), and `computeEffectiveScore()` utility
  - **Chunk deduplication**: Post-retrieval Jaccard similarity dedup (>80% token overlap = near-duplicate) removes redundant chunks from overlapping documents, freeing context window slots
  - **Query routing**: `classifyQuery()` detects pure code/crosswalk/checklist lookups and serves structured data directly, skipping embedding + vector search + LLM generation (~2-4s savings, zero Bedrock cost for structured queries)
  - **Security**: Source monitor redirect targets now validated for SSRF (prevents redirect to internal IPs/metadata endpoints)
  - **Bug fix**: Data retention date validation prevents date rollover (Feb 31 → Mar 2 no longer silently deletes wrong files)
  - **Bug fix**: HTML entity decoding uses `String.fromCodePoint()` instead of `fromCharCode()` for full Unicode support (emoji, supplementary planes)
  - **Performance**: Health check endpoint uses top-level imports instead of dynamic `await import()` on every request
  - **Type safety**: `ConversationTurn.isError` added to types (was used but not declared)
  - **Accessibility**: PopoutButton aria-label added, ChangePasswordForm uses CSS variables instead of hardcoded hex colors for dark mode support
  - **Accessibility**: Skip-to-content link for keyboard navigation, `focus-visible` styles on all interactive elements, `id="main-content"` landmark
  - **Accessibility**: PHI detection uses async ConfirmDialog modal instead of blocking `window.confirm()`
  - **Responsive**: Improved tablet breakpoint (icon-only tabs at ≤900px), mobile nav wraps to full width at ≤640px
  - **UX**: Clipboard write error handled gracefully (no uncaught promise rejection)
  - **Documentation**: Updated AUDIT_REPORT.md with comprehensive ratings and improvement paths
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
