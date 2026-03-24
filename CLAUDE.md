# UMS Knowledge Base Reference Tool

## Project Overview
A HIPAA-aware knowledge base RAG (Retrieval-Augmented Generation) tool for Universal Medical Supply (UMS). Employees upload documents (PDFs, DOCX, XLSX, CSV, TXT) and query them via a chat interface. The system retrieves relevant chunks, sends them to Claude Haiku 4.5 via AWS Bedrock, and returns cited answers.

## Architecture

### Backend (`backend/`)
- **Runtime**: Node.js + Express + TypeScript
- **Entry**: `backend/src/index.ts`
- **Key services** (`backend/src/services/`):
  - `ingestion.ts` — Full pipeline: upload to S3 → extract text → vision describe images → chunk → embed → store in vector store
  - `textExtractor.ts` — Extracts text from PDFs (pdf-parse + Textract OCR in parallel), DOCX, XLSX, CSV
  - `visionExtractor.ts` — Sends PDFs to Haiku 4.5 via Bedrock Converse API to describe images/diagrams
  - `ocr.ts` — AWS Textract OCR (sync for images, async for multi-page PDFs)
  - `chunker.ts` — Splits text into overlapping chunks with section header detection
  - `embeddings.ts` — Embedding facade (delegates to `EmbeddingProvider`), batch support (parallel batches of 20), retry with exponential backoff
  - `embeddingProvider.ts` — `EmbeddingProvider` interface for swappable embedding models
  - `titanEmbeddingProvider.ts` — Amazon Titan Embed V2 implementation of `EmbeddingProvider`
  - `vectorStore.ts` — JSON-based vector store on S3 with cosine similarity search + IDF-enhanced BM25 keyword boosting + re-ranking. Tracks embedding model metadata.
  - `s3Storage.ts` — S3 operations for documents, vectors, metadata
  - `jobQueue.ts` — In-memory async job queue for long-running extractions, with status polling and auto-cleanup
  - `audit.ts` — HIPAA audit logging to S3
  - `usage.ts` — Per-user daily query limits
  - `queryLog.ts` — Query analytics with CSV export
  - `ragTrace.ts` — Per-query RAG observability tracing (retrieval scores, timing, confidence)
  - `faqAnalytics.ts` — FAQ pattern detection from query logs
  - `feedback.ts` — User feedback/flagging service
  - `formAnalyzer.ts` — CMN form analysis with blank detection and confidence scoring
  - `pdfAnnotator.ts` — Server-side PDF annotation support
  - `documentExtractor.ts` — Structured document extraction with templates (PPD, CMN, Prior Auth, General) using Claude Sonnet
  - `extractionTemplates.ts` — Extraction template definitions and field schemas
  - `clinicalNoteExtractor.ts` — AI-assisted clinical note extraction (ICD-10, test results, medical necessity) using Claude Sonnet
  - `sourceMonitor.ts` — Automated URL monitoring for external document changes (SHA-256 hash comparison)
  - `feeScheduleFetcher.ts` — CMS DME fee schedule auto-fetch and ingestion
  - `reindexer.ts` — Document change detection and re-ingestion service
- **Routes** (`backend/src/routes/`):
  - `query.ts` — RAG query (non-streaming + streaming SSE), query reformulation for follow-ups
  - `documents.ts` — Document upload, listing, deletion, clinical extraction, fee schedule fetch, reindex
  - `extraction.ts` — Structured document extraction with template selection + async job endpoints
  - `users.ts` — Admin user management CRUD (list, update role, delete, password reset)
  - `errors.ts` — Frontend error reporting endpoint
  - `feedback.ts` — User feedback and response flagging
  - `queryLog.ts` — Query log viewing and CSV export
  - `sourceMonitor.ts` — Admin CRUD API for monitored document sources
  - `usage.ts` — Usage stats and limits
- **Config** (`backend/src/config/`): `aws.ts` (AWS clients, model IDs), `formRules.ts` (CMN form type rules)
- **Middleware** (`backend/src/middleware/`): `auth.ts` (JWT auth with role support, account lockout)
- **Utils** (`backend/src/utils/`): `logger.ts` (structured JSON logging with correlation IDs), `correlationId.ts` (AsyncLocalStorage per-request tracing), `phiRedactor.ts` (PHI scrubbing), `envValidation.ts`, `fileValidation.ts`, `urlValidation.ts` (SSRF prevention), `resilience.ts` (shared retry with jitter, circuit breaker, timeout)
- **Storage abstraction** (`backend/src/storage/`): `interfaces.ts` (MetadataStore, DocumentStore, VectorStore interfaces), `s3MetadataStore.ts`, `s3DocumentStore.ts`, `index.ts` — decoupled from S3 for future database migration
- **Cache abstraction** (`backend/src/cache/`): `interfaces.ts` (CacheProvider, SetProvider), `memoryCache.ts` (in-memory with TTL and LRU eviction), `index.ts` — swap to Redis for horizontal scaling
- **Tests** (`backend/src/__tests__/`): `vectorStore.test.ts` (20), `phiRedactor.test.ts` (18), `urlValidation.test.ts` (13), `auth.test.ts` (14), `usage.test.ts` (6), `hipaaCompliance.test.ts` (30) — 101 total, vitest

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
- **Hooks**: `frontend/src/hooks/useAuth.ts`
- **API client**: `frontend/src/services/api.ts`
- **Types**: `frontend/src/types/index.ts`
- **Styling**: Inline styles + `index.css` (healthcare blue palette with hexagonal/molecular background pattern)

### AWS Services Used
- **S3**: Document storage, vector store, metadata, audit logs, form analysis cache
- **Bedrock**: Claude Haiku 4.5 (RAG generation + vision), Claude Sonnet 4.6 (structured extraction + clinical notes), Titan Embed V2 (embeddings)
- **Textract**: OCR for scanned PDFs and images

### Deployment
- Single Docker container via `Dockerfile` (serves both backend API and frontend static build)
- Configured for Render.com via `render.yaml`
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
- **Input truncation**: 8K chars for embeddings, 80K for extraction, 2K for user queries
- **Token right-sizing**: Max tokens set per task (150 reformulation, 4096 RAG, 8192 extraction)

## Recent Changes (reverse chronological)
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
