# UMS Knowledge Base Reference Tool

## Project Overview
A HIPAA-aware knowledge base RAG (Retrieval-Augmented Generation) tool for Universal Medical Supply (UMS). Employees upload documents (PDFs, DOCX, XLSX, CSV, TXT) and query them via a chat interface. The system retrieves relevant chunks, sends them to Claude Haiku 4.5 via AWS Bedrock, and returns cited answers.

## Architecture

### Backend (`backend/`)
- **Runtime**: Node.js + Express + TypeScript
- **Entry**: `backend/src/server.ts`
- **Key services** (`backend/src/services/`):
  - `ingestion.ts` — Full pipeline: upload to S3 → extract text → vision describe images → chunk → embed → store in vector store. Mutex-protected index updates, chunk rollback on failure, content-hash deduplication (race-safe verified check inside mutex), file extension whitelist. 100MB file-size guard at entry catches service-account uploads that bypass multer's 50MB browser cap.
  - `textExtractor.ts` — Extracts text from PDFs (pdf-parse + conditional Textract OCR based on word count), DOCX, XLSX, CSV, HTML
  - `visionExtractor.ts` — Sends PDFs to Haiku 4.5 via Bedrock Converse API to describe images/diagrams. All structured-log filenames pass through `safeFilename` → `redactPhi` so user-uploaded names like "john-doe-mri-scan.pdf" don't leak PHI to log aggregators (M2). Descriptions themselves are never logged.
  - `ocr.ts` — AWS Textract OCR (sync for images, async for multi-page PDFs). 5-minute hard timeout, transient error retry (3 attempts), 100ms pagination delay.
  - `chunker.ts` — Splits text into overlapping chunks with section header detection and table preservation
  - `embeddings.ts` — Embedding facade (delegates to `EmbeddingProvider`), batch support (parallel batches of 20), retry with exponential backoff
  - `embeddingProvider.ts` — `EmbeddingProvider` interface for swappable embedding models
  - `titanEmbeddingProvider.ts` — Amazon Titan Embed V2 implementation of `EmbeddingProvider`
  - `vectorStore.ts` — Hybrid vector store: routes to pgvector (PostgreSQL) when DATABASE_URL is configured, falls back to in-memory S3 JSON. Cosine similarity + IDF-enhanced BM25 keyword boosting + re-ranking. Medical-term-aware tokenizer preserves short tokens (IV, O2, 5mg). NaN guards, dimension validation. Embedding model mismatch detection on init with reindex migration path (`reindexAllEmbeddings`).
  - `s3Storage.ts` — S3 operations for documents, vectors. Size guards (50MB metadata, 500MB vector index, 100MB document fetch with HEAD pre-check + stream-length fallback).
  - `jobQueue.ts` — Async job queue with S3 persistence (survives restarts), status polling, auto-cleanup. Creates and status transitions persist immediately (bypass debounce); progress-only updates still go through the debounced path so a crash in the debounce window can't lose queued jobs (M7).
  - `audit.ts` — HIPAA audit logging with HMAC-SHA256 hash chaining (keyed with app secret — attacker with DB access cannot recompute), mutex-protected writes, deep PHI redaction (recursive traversal of nested objects/arrays), S3 write retry with backoff
  - `usage.ts` — Per-user daily query limits with rollback on failed queries
  - `queryLog.ts` — Query analytics with CSV export
  - `ragTrace.ts` — Per-query RAG observability tracing (retrieval scores, timing, confidence)
  - `ragMetrics.ts` — Retrieval evaluation metrics: recall@K, MRR, keyword coverage, formatted report output
  - `alertService.ts` — Operational email alerts for critical failures (audit write drops, reindex failures, ingestion errors, source staleness, malware scanner unavailability, admin role grants). Throttled to 1 alert/hour per category. Configurable via ALERT_EMAIL.
  - `extractionFeedback.ts` — Human-in-the-loop extraction correction store. Reviewers submit per-field corrections + overall quality rating after editing extraction results; S3-backed append-only audit record with accuracy and overconfidence stats.
  - `formDrafts.ts` — Server-side partial save/resume for PPD, PMD Account, and PAP Account forms. S3-backed, user-scoped, 2MB payload guard. Complements per-form sessionStorage with cross-device resume.
  - `faqAnalytics.ts` — FAQ pattern detection from query logs
  - `feedback.ts` — User feedback/flagging service
  - `formAnalyzer.ts` — CMN form analysis with blank detection and confidence scoring
  - `pdfAnnotator.ts` — Server-side PDF annotation support
  - `documentExtractor.ts` — Structured document extraction with templates (PPD, CMN, Prior Auth, General) using Claude Sonnet
  - `extractionTemplates.ts` — Extraction template definitions and field schemas
  - `clinicalNoteExtractor.ts` — AI-assisted clinical note extraction (ICD-10, test results, medical necessity) using Claude Sonnet
  - `sourceMonitor.ts` — Automated URL monitoring for external document changes (SHA-256 hash comparison). Parallel checks with concurrency limit of 3. Staleness audit (`auditStaleSources`) runs daily and alerts when a source hasn't produced fresh content in longer than its configured `expectedUpdateCadenceDays`; per-source alerts throttled to 1/24h.
  - `feeScheduleFetcher.ts` — CMS DME fee schedule auto-fetch and ingestion
  - `reindexer.ts` — Document change detection and re-ingestion service
  - `hcpcsLookup.ts` — Static HCPCS code database (334 codes, 25 categories) with search, lookup, and category browsing
  - `icd10Mapping.ts` — ICD-10 to HCPCS crosswalk (66 diagnosis codes, 116+ mappings) for DME equipment justification
  - `coverageChecklists.ts` — LCD coverage criteria checklists (8 LCDs) with documentation validation
  - `referenceEnrichment.ts` — Auto-detects HCPCS/ICD-10 codes and coverage keywords in queries, injects structured reference data into RAG context
  - `ppdQuestionnaire.ts` — PPD (Patient Provided Data) questionnaire (45 questions EN/ES) for Power Mobility Device orders. Weight range validation (70-700 lbs), clinical-context spasticity detection.
  - `pmdCatalog.ts` — PMD product catalog (22 products) with images, brochures, weight capacities, seat types
  - `ppdQueue.ts` — S3-backed PPD submission queue with status workflow (pending → in_review → completed/returned). Per-submission mutex on `updatePpdStatus` prevents two admins racing on the same ID from clobbering each other's review action (H6; in-process only, multi-instance deploys would need Redis).
  - `seatingEvaluation.ts` — Auto-fills 2-page Seating Evaluation form from PPD responses (10 sections mapped). Numeric armStrength comparison, word-boundary MRADL classification, cognitive status inference from diagnoses.
  - `accountCreation.ts` — PMD Account Creation questionnaire (25 questions EN/ES) for sales lead intake
  - `papAccountCreation.ts` — PAP/CPAP Account Creation questionnaire (24 questions EN/ES) with conditional formatting
  - `emailService.ts` — Gmail SMTP email sending via nodemailer with email format validation and header injection prevention
  - `insuranceCardReader.ts` — Insurance card OCR: Textract + Claude extracts structured fields, immediate PHI redaction, audit trail, mismatch detection
  - `dataRetention.ts` — HIPAA-compliant automated data retention cleanup with hard-coded minimum floors (audit ≥6yr), NaN-safe parseInt, validated date regex. Includes index-based form-draft sweep for non-date-keyed S3 objects (prunes by `updatedAt`; default 90 days, HIPAA floor 30)
  - `incidentResponse.ts` — Formal IRP (HIPAA §164.308): 7-phase lifecycle (detection → triage → containment → eradication → recovery → post-incident → closed), severity classification (P1-P4), escalation contacts, response procedures with time targets, action items
  - `vulnerabilityScanner.ts` — Automated daily security audits: JWT_SECRET strength, AWS creds, DATABASE_URL, S3_BUCKET, SSL enforcement, npm audit. Admin risk acceptance, scan history capped at 10 reports
- **Middleware** (`backend/src/middleware/`):
  - `auth.ts` — JWT authentication (httpOnly cookies), MFA (TOTP — gated by ENABLE_NATIVE_MFA, default on; skipped when off so CA's pre-session MFA is trusted), account lockout (async IIFE check + lockout cache for S3 outage resilience), password history, revokeAllUserTokens on all password reset/change paths, refresh tokens (7-day httpOnly cookie with S3-backed revocation persistence), service-to-service API key auth (X-API-Key header with timing-safe comparison for CallAnalyzer integration), per-username login mutex serializing read-modify-save of the users list so concurrent logins cannot both consume the same MFA recovery code (in-process only; multi-instance deploys would need Redis)
  - `sso.ts` — Option-A SSO with CallAnalyzer. Global middleware runs after cookieParser, before WAF; no-ops unless `ENABLE_SSO=true`, no `ums_auth_token`, and a `connect.sid` cookie is present. On the active path: forwards the full Cookie header + `SSO_SHARED_SECRET` to CA's `/api/auth/sso-verify` (3s timeout via AbortController), resolves via `ssoSub → email/username → JIT-provision` (JIT rows use CA's UUID as RAG's user.id so FKs stay coherent), mints a RAG JWT cookie, mutates `req.cookies` so the same-request authenticate middleware verifies it, and writes a `login` audit entry with `details.action=sso_login`. Failure modes all pass through to the normal 401 flow. Role mapping: CA admin → RAG admin, else → RAG user.
  - `waf.ts` — Application-level WAF: 13 SQLi + 13 XSS + 7 path traversal + 4 CRLF patterns, IP blocklist (permanent + temporary), anomaly scoring with sliding window + auto-block, input truncation (4KB) prevents regex DoS
- **Utilities** (`backend/src/utils/`):
  - `sentry.ts` — Sentry error tracking with PHI-safe scrubbing (8 patterns). Strips request bodies, cookies, query strings. No-op when SENTRY_DSN not set
  - `stripMetadata.ts` — Document metadata stripping. Images (EXIF/IPTC/XMP/ICC via sharp) remove GPS, timestamps, device info. PDFs (via pdf-lib) clear the info dictionary: /Author, /Creator, /Producer, /Title, /Subject, /Keywords. DOCX/XLSX/PPTX (via jszip) replace `docProps/core.xml` and `docProps/app.xml` with empty-field XML, clearing dc:creator, cp:lastModifiedBy, dc:title, dc:subject, cp:keywords, Company, Manager. `stripDocumentMetadata` dispatcher routes by MIME type. Visible content (pixels, text, form fields) preserved byte-identically.
  - `logger.ts` — Structured JSON logging with AsyncLocalStorage correlation IDs
  - `correlationId.ts` — AsyncLocalStorage per-request tracing
  - `phiRedactor.ts` — PHI redaction (14 HIPAA identifiers) with deep recursive traversal
  - `htmlEscape.ts` — HTML entity escaping for safe email template interpolation
  - `envValidation.ts`, `fileValidation.ts`, `urlValidation.ts` (SSRF prevention)
  - `rateLimitKey.ts` — `resolveRateLimitKey(req)` for express-rate-limit keyGenerators; resolves `user.id → req.ip → SHA-256(XFF + User-Agent) → per-request UUID`. Never returns `'unknown'` so distinct clients cannot pool into one bucket (H3). Logs a throttled warning on any fallback past req.ip so broken trust-proxy setups are visible.
  - `resilience.ts` — shared retry with jitter, circuit breaker, timeout
  - `metrics.ts` — in-memory request metrics with per-route latency percentiles
  - `textractPoller.ts` — shared Textract async job polling + pagination with transient error retry
- **Routes** (`backend/src/routes/`):
  - `query.ts` — RAG query (non-streaming + streaming SSE), query reformulation for follow-ups, rate-limited (30 req/15min per user)
  - `documents.ts` — Document upload, listing, deletion, clinical extraction, fee schedule fetch, reindex, embedding reindex (migration path for model changes)
  - `extraction.ts` — Structured document extraction with template selection + async job endpoints. Error messages sanitized to prevent internal AWS/Bedrock detail leakage. Includes human-in-the-loop correction endpoints (submit per-field corrections, list/fetch history, admin aggregate stats).
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
  - `formDrafts.ts` — Partial save/resume/discard for PPD, PMD Account, and PAP Account forms
  - `eval.ts` — Admin read-only view of the gold-standard RAG evaluation dataset
- **Config** (`backend/src/config/`): `aws.ts` (AWS clients, model IDs), `database.ts` (PostgreSQL connection pool with RDS SSL), `migrate.ts` (SQL migration runner), `formRules.ts` (CMN form type rules)
- **Database layer** (`backend/src/db/`): Hybrid S3/RDS access layer. `index.ts` routes to PostgreSQL when DATABASE_URL is configured, falls back to S3 JSON. `users.ts` (user CRUD), `documents.ts` (document/collection CRUD with document count aggregation), `vectorStore.ts` (pgvector-backed similarity search with HNSW index).
- **Migrations** (`backend/migrations/`): `001_initial_schema.sql` (13 tables: users, documents, collections, audit_logs, query_logs, rag_traces, feedback, jobs, ppd_submissions, monitored_sources, usage_records, usage_daily_totals, schema_migrations), `002_pgvector_chunks.sql` (chunks table with vector(1024) column, IVFFlat index), `003_add_fk_indexes.sql` (indexes on FK columns: usage_records, audit_logs, query_logs, feedback, jobs by user_id + partial index on documents where status='ready'), `004_add_foreign_keys.sql` (FK constraints on 12 columns across 9 tables: RESTRICT on audit/log tables for HIPAA preservation, CASCADE on chunks/usage/jobs), `005_fix_user_id_default.sql` (replaces predictable timestamp-based user ID default with `gen_random_uuid()`), `005_add_mfa_columns.sql` (MFA secret, enabled flag), `006_audit_chain_state.sql` (DB-backed audit hash chain for multi-instance), `007_add_user_email.sql` (email column for password reset), `008_add_mfa_recovery_codes.sql` (recovery codes array), `010_add_sso_identity.sql` (sso_sub + sso_source columns on users, partial UNIQUE index on sso_sub WHERE NOT NULL so multiple pre-SSO / break-glass rows can keep nulls), `009_hnsw_index.sql.manual` (replaces IVFFlat with HNSW — MANUAL migration, not auto-applied on startup because non-concurrent CREATE INDEX on a populated chunks table would exceed the deploy health-check timeout. Run steps manually via `psql "$DATABASE_URL"` using `CREATE INDEX CONCURRENTLY`)
- **Storage abstraction** (`backend/src/storage/`): `interfaces.ts` (MetadataStore, DocumentStore, VectorStore interfaces with RDS/pgvector migration documentation), `s3MetadataStore.ts`, `s3DocumentStore.ts`, `index.ts`
- **Cache abstraction** (`backend/src/cache/`): `interfaces.ts` (CacheProvider, SetProvider), `memoryCache.ts` (in-memory with TTL and LRU eviction), `index.ts` — swap to Redis for horizontal scaling
- **Tests** (`backend/src/__tests__/`): 1019 total tests across 69 test files (vitest). Covers vector store, PHI redaction (incl. Unicode patient names — Spanish, Irish, French, hyphenated), URL validation, auth flows, usage tracking, HIPAA compliance, extraction templates, document extractor, extraction feedback, form drafts, gold-standard eval dataset + scoring, source staleness auditing + alerting, malware scan fail-closed, token revocation (INV-12), MFA recovery code TOCTOU regression, ingestion lifecycle (real chunker + rollback + dedup + oversize rejection), rate-limit key resolution (H3), zero-width prompt-injection bypass (H4), admin-role-grant audit (L2), document size guard (M12), OOXML metadata stripping, form-draft retention sweep, orphan cleanup, job queue, ingestion pipeline, audit service, embeddings, embedding dimension validation, OCR, email service, data retention, metrics, seating evaluation, PPD questionnaire, integration tests, HTML escaping, HCPCS lookup, ICD-10 mapping, PMD catalog, coverage checklists, form rules, account creation, PAP account creation, reference enrichment, FAQ analytics, and route-level tests for documents, extraction, HCPCS, ICD-10, coverage, queryLog, PPD, and s3Storage.
- **Eval data** (`backend/src/evalData/`): `goldStandardRag.json` (51 Q&A pairs across coverage, clinical, equipment, billing, forms categories) + `loader.ts` (validating loader — fails fast on malformed entries). Consumed by `scripts/evalRag.ts` (CI harness) and `scripts/evalEmbeddings.ts` (embedding-model comparison).
- **Scripts** (`backend/src/scripts/`): `reset-admin.ts` — Admin password reset utility for when initial random password is lost or account is locked. Works with both PostgreSQL and S3 storage backends. Usage: `cd backend && npx tsx src/scripts/reset-admin.ts [password]`. `reembed.ts` — Re-embed all chunks with the current embedding model (migration path for model changes). `evalEmbeddings.ts` — Embedding model comparison (Titan vs Cohere) against the gold-standard dataset. `evalRag.ts` — Gold-standard RAG eval harness; emits `eval-output/junit.xml` + `results.json` and exits non-zero when recall/MRR fall below configured thresholds. Not in `npm test` because it requires Bedrock + a populated index.

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
  - `FormDraftBanner.tsx` — Save-status indicator + "Resume draft…" dropdown + "Start over" button shown at the top of PPD/PMD/PAP forms; drives the `useFormDraft` hook
  - `ExtractionCorrectionPanel.tsx` — Inline panel under extraction results. Diffs original LLM output against reviewer edits and submits the correction record with an overall quality rating and optional note
  - `SourceStalenessManager.tsx` — Admin dashboard card listing monitored sources past their expected update cadence; includes "Run audit now" button that triggers the alerting path
  - `RagEvalDatasetViewer.tsx` — Admin read-only view of the gold-standard RAG dataset with category filter and text search
  - `ExtractionQualityStatsCard.tsx` — Admin card showing aggregate accuracy and overconfidence from reviewer-submitted extraction corrections
- **Hooks**: `frontend/src/hooks/useAuth.ts` (login/logout with stream cancellation), `frontend/src/hooks/useIdleTimeout.ts` (15-min idle auto-logout with full-viewport interaction blocker), `frontend/src/hooks/useFormDraft.ts` (debounced 2s auto-save to `/api/form-drafts`, `resume(id)`, `discardCurrent()`; failures are non-fatal since sessionStorage remains the first line of defense)
- **API client**: `frontend/src/services/api.ts` (AbortController-based stream cancellation, 2MB SSE buffer cap, silent token refresh on 401; on refresh failure dispatches `SESSION_EXPIRED_EVENT` so `useAuth` transitions to LoginForm without a full-page reload — preserves React state and in-memory form drafts)
- **Types**: `frontend/src/types/index.ts`
- **Design system**: "Warm-paper" OKLCH palette (paper/ink/copper/sage/amber/warm-red) ported from CallAnalyzer. Inter + Inter Tight + IBM Plex Mono type, `--radius: 0.25rem`, hairline borders, no glass/blur. Confidence aliases (`--conf-high/partial/low` → sage/amber/warm-red) preserve the ChatInterface/SourceViewer/QualityDashboard semantic layer. Palette provider (`components/appearance-provider.tsx` + `lib/palettes.ts`) injects `<style id="palette-override">` with full paper-tone + accent shift per palette (extends CallAnalyzer's accent-only design — every palette reskins the whole paper surface). Escape hatch `?style-guide=1` renders `pages/StyleGuide.tsx` for smoke-testing.
- **UI kit**: shadcn/ui "new-york" style in `components/ui/` (button, input, card, skeleton, toast, label, badge, textarea, separator + unused primitives kept for future features) on Radix, `class-variance-authority`, `tailwind-merge`. Tailwind CSS v3 (downgraded from v4 for shadcn compatibility). `wouter` for client-side routing.
- **Icons**: Heroicons (`@heroicons/react/24/outline`) for standard UI, Phosphor (`@phosphor-icons/react`) in shared dashboard primitives, Lucide React (`lucide-react`) for medical icons (Brain logo, Stethoscope for clinical tab).

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
- System prompt: `backend/src/routes/query.ts` (line ~86)
- Temperature: `0.15` (RAG), `0.05` (extraction), `0.1` (vision), `0` (reformulation)
- Max tokens: `2048` (concise) / `4096` (detailed) / `8192` (comprehensive) for RAG, `8192` (extraction), `150` (reformulation)
- Default topK: `8` chunks (was 6; increased for richer context on multi-faceted medical questions)

## Tuning Knobs for Response Quality
- **System prompt** (`query.ts:86`): Controls tone, conciseness, citation style
- **Temperature** (`query.ts:785,919`): Currently 0.15 (conservative). Higher = more varied
- **Max tokens** (`query.ts:782,916` via `STYLE_CONFIG`): 2048/4096/8192 by response style. Lower = forces shorter answers
- **topK** (`query.ts:680`): Default 8 chunks. Fewer = more focused, more = comprehensive
- **Chunk size/overlap** (`chunker.ts`): Affects retrieval granularity

## API Cost Optimization
- **Prompt caching**: All Bedrock InvokeModel calls use `cache_control: { type: 'ephemeral' }` on system prompt blocks. Cache reads cost 0.1x base input price (90% savings). Applied to RAG queries (streaming + non-streaming), query reformulation, document extraction, and clinical note extraction. See `query.ts:121` (`buildSystemBlocks()`).
- **Embedding batching**: `embeddings.ts` processes chunks in parallel batches of 20 via `Promise.all`
- **Retry with exponential backoff**: Embedding calls retry up to 3x (1s, 2s, 4s delays)
- **Model selection**: Haiku 4.5 for RAG (fast/cheap), Sonnet 4.6 for extraction (accurate)
- **Input truncation**: 8K chars for embeddings, 100K for extraction, 2K for user queries
- **Token right-sizing**: Max tokens set per task (150 reformulation, 4096 RAG, 8192 extraction)

## Cross-Project Port Tracking
When making improvements to this codebase, update `OBSERVATORY_PORT_LOG.md` to track which changes are candidates for porting to the multi-tenant [Observatory QA](https://github.com/robinchoudhuryums/observatory-qa) platform. The log tracks porting status (Ported/Pending/N/A) across security, RAG quality, compliance, and observability categories.

## Deployment
- **Docker**: Multi-stage build, `node:20.19.0-slim`, tini init, non-root user, health check. `npm ci --legacy-peer-deps` in all build stages (matches CI's permissive peer-dep resolution; stricter npm in the slim image otherwise rejects the existing lockfile with ERESOLVE).
- **Blue-green deploy**: `.github/workflows/ci.yml` runs the authoritative deploy inline on push to main; `deploy-bluegreen.sh` is a manual/local fallback kept in sync. Flow: build new image → pre-build disk cleanup (prune old images, builder cache, stopped containers, unused volumes/networks, truncate large container logs) → start new container on staging port (3002) → 60s health-check loop with partial-log dump at 15s → swap to production port (3001) → verify prod health → remove old container on success, rollback on failure. ~2s downtime vs ~30s with standard deploy. Rollback: `docker stop ums-knowledge && docker rename ums-knowledge-old ums-knowledge && docker start ums-knowledge`
- **CI/CD**: `.github/workflows/ci.yml` — TruffleHog secret scanning (diff-scoped, non-blocking), backend lint + type-check + tests + coverage, frontend type-check + build + axe-core WCAG 2.0 A+AA accessibility audit (non-blocking), deploy via SSH with blue-green strategy. Deploy step uses verbose build output (`docker build --progress=plain`), explicit build/run error capture, pre-flight port availability check, and 700MB image size guard.
- **Error monitoring**: `.github/workflows/error-monitor.yml` — checks Docker status, HTTP health, error logs, disk, DB connectivity, memory every 4 hours. Auto-creates GitHub Issues.

## Environment Variables (not in .env.example)
```
# Service-to-service auth (for CallAnalyzer RAG integration)
SERVICE_API_KEY                 # Shared secret for X-API-Key auth (min 32 chars)

# SSO with CallAnalyzer (Option A — CA is auth authority, RAG trusts shared cookie)
# All off by default; see docs/sso-rollout.md for the coordinated cutover procedure.
ENABLE_SSO                      # "true" activates the introspection middleware (default: false)
CA_BASE_URL                     # CA's URL, e.g. https://umscallanalyzer.com (required when ENABLE_SSO=true)
SHARED_COOKIE_DOMAIN            # Parent domain for auth + refresh + CSRF cookies, e.g. .umscallanalyzer.com (default: "" = host-scoped)
SSO_SHARED_SECRET               # Shared secret (min 32 chars) forwarded as X-Service-Secret on /sso-verify calls
ENABLE_NATIVE_MFA               # "false" to skip RAG's TOTP check at login after SSO is stable (default: true)
SERVICE_API_USERNAME            # Service account identity (default: call-analyzer)

# Error tracking
SENTRY_DSN                      # Sentry DSN (optional — disabled if not set)

# Database SSL
DB_SSL_REJECT_UNAUTHORIZED      # "false" for self-signed certs in dev (IGNORED in production — always true)

# Field encryption
FIELD_ENCRYPTION_KEY            # AES-256-GCM key for sensitive fields (MFA secrets) at rest

# Malware scanning
MALWARE_SCAN_ENABLED            # "false" to disable ClamAV file scanning (default: true — scanning enabled)
MALWARE_SCAN_FAIL_CLOSED        # "false" to allow uploads when ClamAV is unreachable (default: true — fail-closed).
                                #   Applies to ALL upload paths including service-account (X-API-Key) uploads.
                                #   NEVER set to "false" in production with SCAN_ENABLED=true.
CLAMAV_HOST                     # ClamAV daemon host (default: localhost)
CLAMAV_PORT                     # ClamAV daemon port (default: 3310)

# Redis (optional — enables distributed state)
REDIS_URL                       # Redis connection string
REDIS_KEY_PREFIX                # Key namespace prefix

# OpenTelemetry tracing (optional — disabled by default)
OTEL_ENABLED                    # "true" to enable distributed tracing
OTEL_SERVICE_NAME               # Service name (default: ums-knowledge-base)
OTEL_ENVIRONMENT                # Environment tag (default: NODE_ENV)
OTEL_EXPORTER_OTLP_ENDPOINT    # OTLP collector URL

# Form email BCC recipients (optional)
PPD_BCC_EMAIL                   # BCC on PPD form emails
PMD_BCC_EMAIL                   # BCC on PMD Account Creation emails (falls back to PPD_BCC_EMAIL)
PAP_BCC_EMAIL                   # BCC on PAP Account Creation emails (falls back to PPD_BCC_EMAIL)

# Operational alerting (optional)
ALERT_EMAIL                     # Recipient for operational alerts (defaults to SMTP_FROM/SMTP_USER)

# Audit log immutability (optional — requires S3 bucket with Object Lock enabled)
AUDIT_OBJECT_LOCK               # "true" to enable COMPLIANCE mode retention on audit entries
AUDIT_RETENTION_YEARS           # Retention period in years (default: 6, HIPAA minimum enforced)

# Data retention overrides (daily cleanup at ~3 AM UTC; HIPAA minimum floors enforced)
RETENTION_FORM_DRAFT_DAYS       # Abandoned form-draft cleanup threshold (default: 90, HIPAA minimum 30)

# Cross-encoder re-ranking (optional — adds ~200-500ms latency per query)
CROSS_ENCODER_RERANK            # "true" to enable LLM-based re-ranking after retrieval
CROSS_ENCODER_TOP_N             # Number of candidates to re-score (default: 8, max: 20)

# RAG gold-standard eval harness (CLI: scripts/evalRag.ts, not run in CI by default)
RAG_EVAL_RECALL_THRESHOLD       # Minimum average recall@10 to pass (default: 0.5)
RAG_EVAL_MRR_THRESHOLD          # Minimum MRR to pass (default: 0.4)
RAG_EVAL_OUTPUT_DIR             # Where to write junit.xml + results.json (default: ./eval-output)
```

## Recent Changes
See `CHANGELOG.md` for the full categorized history of all improvements.
Critical invariants that must not regress are captured in the Invariant Library below.
The Architecture section above describes the current state of every service, route, and component.

## IAM Permissions Needed
The Bedrock IAM policy needs these actions:
- `bedrock:InvokeModel` (generation, embeddings, vision via Converse)
- `bedrock:InvokeModelWithResponseStream` (streaming responses)
- Textract: `textract:DetectDocumentText`, `textract:AnalyzeDocument`, `textract:StartDocumentTextDetection`, `textract:GetDocumentTextDetection`, `textract:StartDocumentAnalysis`, `textract:GetDocumentAnalysis`
- S3: standard read/write/delete on the configured bucket

## API Endpoints Summary
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/auth/config` | None | Public auth config (SSO enabled + loginUrl). Consumed by LoginForm to decide whether to render local form or "Sign in with CallAnalyzer" button. |
| POST | `/api/auth/login` | None | Login (rate-limited) |
| POST | `/api/auth/logout` | User | Logout (revokes current token) |
| POST | `/api/auth/change-password` | User | Change password (revokes all sessions) |
| POST | `/api/auth/users` | Admin | Create user |
| POST | `/api/auth/forgot-password` | None | Request password reset code (rate-limited) |
| POST | `/api/auth/reset-password` | None | Reset password with code (rate-limited) |
| POST | `/api/auth/refresh` | None | Refresh access token using refresh cookie |
| POST | `/api/auth/mfa/setup` | User | Initialize MFA TOTP setup |
| POST | `/api/auth/mfa/verify` | User | Verify MFA code and enable (rate-limited: 10 attempts / 15 min) |
| POST | `/api/auth/mfa/disable` | User | Disable MFA |
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
| POST | `/api/extraction/correct` | User | Submit reviewer correction for an extraction result |
| GET | `/api/extraction/corrections` | User | List reviewer corrections (own only; admins see all) |
| GET | `/api/extraction/corrections/:templateId/:id` | User | Fetch a single correction record |
| GET | `/api/extraction/corrections-stats` | Admin | Aggregate accuracy + overconfidence stats |
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
| GET | `/api/sources/staleness` | Admin | Read-only view of sources past their expected update cadence |
| POST | `/api/sources/audit-staleness` | Admin | Run staleness audit now; alerts via operational email (throttled) |
| POST | `/api/form-drafts` | User | Upsert a form draft (partial save) for PPD/PMD/PAP |
| GET | `/api/form-drafts` | User | List caller's form drafts (admins can pass `?all=1`) |
| GET | `/api/form-drafts/:formType/:id` | User | Load a specific draft (ACL-enforced to owner) |
| DELETE | `/api/form-drafts/:formType/:id` | User | Discard a draft ("start over") |
| GET | `/api/eval/dataset` | Admin | Gold-standard RAG evaluation dataset (read-only) |
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


# Cycle Workflow Config

## Test Command
cd backend && npm test

## Health Dimensions
PHI Protection, Authentication & Authorization Integrity, RAG Retrieval Quality, HIPAA Audit Completeness, Input Validation & Injection Defense, Data Integrity & Concurrency Safety, Document Processing Correctness, Forms & Clinical Data Accuracy, Reference Data Currency, Test Coverage & Quality, Error Handling & Resilience, Frontend Reliability & Accessibility, Observability & Cost Efficiency

## Subsystems
RAG Query Pipeline:
services/vectorStore.ts, services/embeddings.ts, services/embeddingProvider.ts, services/titanEmbeddingProvider.ts, services/cohereEmbeddingProvider.ts, services/chunker.ts, services/referenceEnrichment.ts, services/abTesting.ts, services/ragMetrics.ts, services/crossEncoderRerank.ts, db/vectorStore.ts, evalData/loader.ts, scripts/evalRag.ts, routes/query.ts, routes/eval.ts

## Document Ingestion & Lifecycle:
services/ingestion.ts, services/textExtractor.ts, services/visionExtractor.ts, services/ocr.ts, services/s3Storage.ts, services/sourceMonitor.ts, services/feeScheduleFetcher.ts, services/reindexer.ts, services/orphanCleanup.ts, routes/documents.ts, routes/sourceMonitor.ts

## Document Extraction & Analysis:
services/documentExtractor.ts, services/extractionTemplates.ts, services/clinicalNoteExtractor.ts, services/extractionFeedback.ts, services/formAnalyzer.ts, services/pdfAnnotator.ts, services/jobQueue.ts, routes/extraction.ts

## Auth, Security & Access Control:
middleware/auth.ts, middleware/authConfig.ts, middleware/tokenService.ts, middleware/waf.ts, services/mfa.ts, services/vulnerabilityScanner.ts, routes/users.ts

## HIPAA Compliance & Data Protection:
services/audit.ts, services/dataRetention.ts, services/incidentResponse.ts, utils/phiRedactor.ts, utils/stripMetadata.ts, utils/malwareScan.ts, utils/fieldEncryption.ts

## Reference Data & Medical Codes:
services/hcpcsLookup.ts, services/icd10Mapping.ts, services/coverageChecklists.ts, services/pmdCatalog.ts, config/formRules.ts, routes/hcpcs.ts, routes/icd10.ts, routes/coverage.ts

## Forms & Workflows:
services/ppdQuestionnaire.ts, services/seatingEvaluation.ts, services/ppdQueue.ts, services/accountCreation.ts, services/papAccountCreation.ts, services/insuranceCardReader.ts, services/emailService.ts, services/productImageResolver.ts, services/formDrafts.ts, utils/htmlEscape.ts, routes/ppd.ts, routes/accountCreation.ts, routes/papAccountCreation.ts, routes/productImages.ts, routes/formDrafts.ts

## Observability & Analytics:
services/ragTrace.ts, services/queryLog.ts, services/faqAnalytics.ts, services/usage.ts, services/feedback.ts, services/alertService.ts, utils/metrics.ts, routes/queryLog.ts, routes/feedback.ts, routes/usage.ts, routes/abTesting.ts, routes/errors.ts

## Infrastructure — Data & Storage Layer:
config/aws.ts, config/database.ts, config/migrate.ts, db/index.ts, db/users.ts, db/documents.ts, cache/interfaces.ts, cache/memoryCache.ts, cache/redisCache.ts, cache/index.ts, storage/interfaces.ts, storage/s3DocumentStore.ts, storage/s3MetadataStore.ts, storage/index.ts, types/index.ts, types/declarations.d.ts

## Infrastructure — Server & Utilities:
server.ts, tracing.ts, utils/logger.ts, utils/correlationId.ts, utils/resilience.ts, utils/envValidation.ts, utils/urlValidation.ts, utils/fileValidation.ts, utils/asyncMutex.ts, utils/rateLimitKey.ts, utils/textractPoller.ts, utils/sentry.ts, utils/traceSpan.ts, scripts/reset-admin.ts, scripts/reembed.ts, scripts/migrateProductImages.ts

## Frontend — Core & Shared:
App.tsx, main.tsx, types/index.ts, hooks/useAuth.ts, hooks/useIdleTimeout.ts, hooks/useUnsavedChanges.ts, hooks/useFormDraft.ts, services/api.ts, services/errorReporting.ts, components/LoginForm.tsx, components/ChangePasswordForm.tsx, components/ErrorBoundary.tsx, components/Toast.tsx, components/ConfirmDialog.tsx, components/LoadingSkeleton.tsx, components/PopoutButton.tsx, components/FormDraftBanner.tsx

## Frontend — Feature UI (split for audit sessions: 12a Chat & Docs / 12b Forms & Admin):
components/ChatInterface.tsx, components/DocumentManager.tsx, components/DocumentSearch.tsx, components/SourceViewer.tsx, components/FeedbackForm.tsx, components/DocumentsTab.tsx, components/DocumentExtractor.tsx, components/ExtractionCorrectionPanel.tsx, components/AnnotatedPdfViewer.tsx, components/OcrTool.tsx, components/IntakeAutoFill.tsx, components/ToolsTab.tsx, components/FormsTab.tsx, components/PpdQuestionnaire.tsx, components/PpdQueueViewer.tsx, components/AccountCreationForm.tsx, components/PapAccountCreationForm.tsx, components/InsuranceCardUpload.tsx, components/FormWithQueue.tsx, components/UserManagement.tsx, components/ProductImageManager.tsx, components/UsageLimitsManager.tsx, components/FaqDashboard.tsx, components/ObservabilityDashboard.tsx, components/QualityDashboard.tsx, components/QueryLogViewer.tsx, components/ExtractionQualityStatsCard.tsx, components/SourceStalenessManager.tsx, components/RagEvalDatasetViewer.tsx

## Invariant Library
INV-01 | Audit log entries must use HMAC-SHA256 hash chain with app secret, never raw SHA-256 | Subsystem: HIPAA Compliance
INV-02 | PHI redaction must run on all data written to query logs, RAG traces, feedback, and audit details before persistence | Subsystem: HIPAA Compliance
INV-03 | Authenticate middleware must check account lockout via async IIFE (not .then()) before granting access | Subsystem: Auth & Security
INV-04 | JWT tokens stored in httpOnly cookies only; localStorage isLoggedIn flag must never contain token | Subsystem: Auth & Security
INV-05 | All Bedrock InvokeModel/Converse generation calls must include cache_control (or Converse cachePoint) on system prompt blocks (embedding models are exempt — Titan/Cohere do not support prompt caching) | Subsystem: RAG Pipeline
INV-06 | Vector store index updates must be protected by async mutex | Subsystem: RAG Pipeline
INV-07 | On ingestion failure after chunks written, chunks must be rolled back (deleted) | Subsystem: Ingestion
INV-08 | Content-hash deduplication must reject identical SHA-256 uploads in same collection | Subsystem: Ingestion
INV-09 | HIPAA retention floors enforced via Math.max (audit >= 6yr) even if env vars set lower | Subsystem: HIPAA Compliance
INV-10 | All URL downloads must validate via SSRF prevention (block private IPs, localhost, metadata) | Subsystem: Server & Utilities
INV-11 | CSRF double-submit cookie enforced on all POST/PUT/DELETE except login, forgot-password, reset-password, refresh, and health. Exempt list is exact-match only (no prefix matching) so a future route like `/api/auth/login-sso` cannot inherit an exemption | Subsystem: Server & Utilities
INV-12 | revokeAllUserTokens() must be called on password reset to invalidate existing sessions | Subsystem: Auth & Security
INV-13 | JWT jti claims must use crypto.randomUUID(), never predictable values | Subsystem: Auth & Security
INV-14 | Extraction route error messages must not expose internal AWS/Bedrock details | Subsystem: Extraction
INV-15 | Embedding dimension validated on addChunksToStore — reject wrong-dimension vectors | Subsystem: RAG Pipeline
INV-16 | WAF middleware must run after body parsing but before CSRF and routes | Subsystem: Server & Utilities
INV-17 | Seating eval armStrength uses numeric comparison with NaN guard | Subsystem: Forms & Workflows
INV-18 | Spasticity detection uses negation check + clinical context, not bare keyword match | Subsystem: Forms & Workflows
INV-19 | SSL rejectUnauthorized=true enforced in production regardless of env var | Subsystem: Infrastructure
INV-20 | JWT_SECRET fail-fast in production if default/weak | Subsystem: Server & Utilities
INV-21 | Prompt injection detection includes NFKD normalization + HTML entity decode + zero-width/invisible character stripping (U+200B-200D, FEFF, 2060, 00AD, 180E, 2061-2064) prior to normalization | Subsystem: RAG Pipeline
INV-22 | Output guardrails detect system prompt leakage in generated responses | Subsystem: RAG Pipeline
INV-23 | Conversation history enforces 20-turn and 50K-char budgets | Subsystem: RAG Pipeline
INV-24 | S3 object size guards: 50MB metadata, 500MB vector index | Subsystem: Ingestion
INV-25 | checkAndRecordQuery() is atomic — no TOCTOU race between check and record | Subsystem: Observability
INV-26 | Successful logins must call logAuditEvent with action 'login' | Subsystem: Auth & Security
INV-27 | Combined search scores must have NaN guard in both S3 and pgvector paths | Subsystem: RAG Pipeline
INV-28 | Concurrent login attempts for the same username must be serialized so MFA recovery code consumption is atomic (single-use) | Subsystem: Auth & Security
INV-29 | Malware scanning must fail-closed when MALWARE_SCAN_ENABLED=true and the ClamAV daemon is unreachable (reject upload, do not silently pass) | Subsystem: HIPAA Compliance
INV-30 | All express-rate-limit keyGenerators must go through `resolveRateLimitKey(req)`; direct fallback to `req.ip \|\| 'unknown'` is forbidden because distinct clients would pool into a single shared bucket (H3) | Subsystem: Server & Utilities
INV-31 | PPD submission status transitions must run under the per-submission mutex so two concurrent reviewer actions cannot clobber each other (H6) | Subsystem: Forms & Workflows

## Policy Configuration
Policy threshold: 5/10
Consecutive cycles: 2

## OUTPUT 2 — CYCLE ROTATION PLAN
Recommended First Subsystem to Audit
Auth, Security & Access Control — This is a HIPAA healthcare application where a security gap has the highest blast radius. Auth is the gatekeeper for everything: any bypass exposes all PHI. It's also a manageable 7 files / ~1,848 lines, making it ideal for establishing audit patterns and calibrating scoring.

## Recommended Cycle Order
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

## CONFIDENCE ASSESSMENT
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
