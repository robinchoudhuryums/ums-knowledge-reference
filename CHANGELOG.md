# Changelog

Consolidated history of improvements, grouped by category. For architectural details of current state, see the Architecture section in `CLAUDE.md`. For critical invariants that must not regress, see the Invariant Library in `CLAUDE.md`.

---

## RAG Query Pipeline

- **A/B model testing framework** — `services/abTesting.ts`, `routes/abTesting.ts`: compare Bedrock models on same query, Welch's t-test for significance
- **Adaptive search weighting** — query type classification (code_lookup, coverage_question, general) with auto-adjusted semantic/keyword weights
- **IDF-enhanced BM25** — proper IDF weighting with corpus-wide term frequency stats, dynamic normalization (replaces hardcoded /10)
- **Re-ranking pipeline** — header boost, noise penalty, token-overlap deduplication (>70% overlap penalized). Optional cross-encoder re-ranking via Claude Haiku (`CROSS_ENCODER_RERANK=true`): LLM scores query-chunk relevance, 60/40 blend with retrieval score, falls back on failure
- **Confidence scoring** — blended avg+top score (0.35/0.65), tuned thresholds (LOW=0.30, PARTIAL=0.42), reconciliation floor 0.30
- **Semantic dedup length-ratio pre-check** — fast `minSize/maxSize` check before O(n) Jaccard intersection
- **Medical-term-aware tokenizer** — preserves hyphenated terms, short tokens (IV, O2, 5mg)
- **Section header detection** — ALL CAPS, markdown, colon-terminated, numbered headers as chunk metadata
- **Prompt injection detection** — 15+ patterns, NFKD normalization, HTML entity decode, Cyrillic look-alikes, 10KB truncation, zero-width / invisible character stripping (U+200B-200D, FEFF, 2060, 00AD, 180E, 2061-2064) prior to normalization so hidden code points can't split trigger words (H4, INV-21)
- **Output guardrails** — detect system prompt leakage and role deviation in generated responses
- **Conversation history validation** — 20-turn and 50K-char budgets
- **Conversation memory with summarization** — older turns summarized, recent 4 kept verbatim
- **Structured reference enrichment** — auto-detects HCPCS/ICD-10 codes and coverage keywords, injects structured data into RAG context
- **Prompt caching** — `cache_control: ephemeral` on all Bedrock generation InvokeModel calls *and* Converse `cachePoint` on vision extractor (90% cached token savings). Coverage extended in a follow-up to include `abTesting.ts`, `crossEncoderRerank.ts`, and `visionExtractor.ts` — closes a prior INV-05 gap where only `query.ts`, `documentExtractor.ts`, `clinicalNoteExtractor.ts`, and `insuranceCardReader.ts` had the directive. Embedding models (Titan/Cohere) are exempt — they do not support prompt caching.
- **Embedding model abstraction** — `EmbeddingProvider` interface, swappable providers, dimension tracking in index
- **Embedding dimension validation** — mismatch detection on init, `reindexAllEmbeddings()` migration path
- **NaN guards** on combined retrieval scores in both S3 and pgvector paths (INV-27), MIN_SCORE_THRESHOLD 0.15, default topK raised to 8
- **Retrieval evaluation metrics** — `ragMetrics.ts`: recall@K, MRR, keyword coverage, formatted report output
- **Gold-standard RAG eval harness** — 51 Q&A pairs in `evalData/goldStandardRag.json` (validating loader at `evalData/loader.ts`), shape tests in `__tests__/goldStandardEval.test.ts`, CI-runnable harness `scripts/evalRag.ts` emits `eval-output/junit.xml` + `results.json` and exits non-zero when average recall@10 or MRR falls below configurable thresholds (RAG_EVAL_RECALL_THRESHOLD / RAG_EVAL_MRR_THRESHOLD)
- **Embedding cache write logging** — `.catch(() => {})` replaced with `logger.warn` for cost visibility
- **Chunk content dedup with embedding reuse** — SHA-256 hash per chunk, reuses existing pgvector embeddings
- **Configurable charsPerToken ratio** — 3.5 for medical docs, 3.8 for forms, 4.0 default

## Document Ingestion & Lifecycle

- **Ingestion mutex** — async mutex on document index updates prevents concurrent corruption
- **Chunk rollback on failure** — deletes orphan chunks if ingestion fails after write
- **Content-hash deduplication** — rejects identical SHA-256 uploads in same collection; verified inside mutex lock to prevent concurrent duplicate race (F-05)
- **Document version audit trail** — `document_replaced` action logged
- **File extension whitelist** — rejects unsupported file types
- **Conditional OCR** — word-count threshold skips Textract for text-native PDFs
- **Vision-based image description** — Bedrock Converse API + Haiku 4.5 for PDF images
- **Source monitor** — automated URL monitoring for external document changes (SHA-256 hash comparison, hourly scheduler). Omits misleading HTTP 200 on ingestion-only failures
- **Reindexer failure marking** — sets `errorMessage` on document when re-index fails so users see stale content warnings
- **LCD source monitor seeding** — one-call endpoint seeds 8 CMS LCD sources
- **Fee schedule fetcher** — auto-fetches CMS DME fee schedules
- **Document reindexer** — change detection and re-ingestion service
- **Document collections and tagging** — organize, tag, filter queries by collection
- **Document status tracking** — frontend shows ready/processing/error with colored badges

## Document Extraction & Analysis

- **Structured extraction** — templates (PPD, CMN, Prior Auth, General) with Claude Sonnet via Bedrock
- **Async extraction** — job queue with S3 persistence, status polling, auto-cleanup after 1 hour. Job creation and status transitions persist immediately (`persistNow()`); progress-only updates still debounced. Closes a 30s crash-window that could silently drop a queued job (M7)
- **Clinical note extraction** — Claude Sonnet extracts ICD-10, test results, medical necessity, HCPCS
- **Form review** — CMN auto-detection, blank detection, confidence categories, template caching, batch review
- **PDF annotation editor** — client-side PDF.js viewer with SVG overlay, drag/move, undo/redo, color choices
- **FormAnalyzer pagination fix** — separated polling from pagination, capped MAX_RESULT_PAGES=100
- **Extraction error sanitization** — AWS/Bedrock internal details stripped from error responses
- **Extraction text limit** — raised to 100K with truncation warning

## Auth, Security & Access Control

- **httpOnly cookie auth** — JWT in cookies (XSS-immune), Authorization header fallback
- **Account lockout** — 5 failed attempts, 15-min cooldown, enforced via async IIFE in middleware
- **Lockout cache** — prevents fail-open on S3 outage
- **Password history** — prevents reuse of last 5 passwords
- **MFA (TOTP)** — with recovery codes
- **MFA recovery code TOCTOU fix** — per-username login mutex in `auth.ts` serializes read-modify-save of the users list during login; two concurrent login attempts can no longer both consume the same recovery code (regression test in `__tests__/mfaRecoveryTocTou.test.ts`). In-process only — multi-instance deploys would need Redis (INV-28)
- **MFA verify rate limit** — dedicated `mfaVerifyLimiter` (10 attempts / 15 min per user) on `/api/auth/mfa/verify`. Previously sat only behind the 120/min global apiLimiter, allowing TOTP / recovery-code brute-force through a stolen access token (H2)
- **JWT jti** — `crypto.randomUUID()` (not predictable values)
- **Token revocation** — `revokeAllUserTokens()` called on all password reset paths (admin reset, self-service reset via code, password change) per INV-12
- **Refresh tokens** — 7-day httpOnly refresh cookie (`ums_refresh_token`, scoped to `/api/auth/refresh`), silent 401 retry on frontend (both request() and SSE streaming), `POST /api/auth/refresh` endpoint
- **Revocation persistence** — S3-backed save/restore of revocation state on graceful shutdown/startup (skipped when Redis configured). User-level revocation TTL extended to 7 days for refresh token coverage
- **Service-to-service auth** — X-API-Key with timing-safe comparison for CallAnalyzer
- **WAF middleware** — 13 SQLi + 13 XSS + 7 path traversal + 4 CRLF patterns, IP blocklist, anomaly scoring
- **CSRF** — double-submit cookie on all state-changing endpoints. Exempt list is **exact-match only** (no prefix matching) so a future route like `/api/auth/login-sso` cannot silently inherit a login-path exemption (H1, INV-11)
- **SSRF prevention** — `urlValidation.ts` blocks private IPs, localhost, cloud metadata
- **Rate limiting** — per-endpoint limits (query 30/15min, forms 10/15min, email 5/15min)
- **Rate-limit key resolution** — `utils/rateLimitKey.ts` `resolveRateLimitKey(req)` replaces all previous `req.ip || 'unknown'` fallbacks across 10 route files. Resolves user.id → req.ip → SHA-256(XFF + User-Agent) → per-request UUID. Never pools distinct clients into one bucket (H3, INV-30)
- **Session-expired event (no-reload logout)** — frontend 401 handler dispatches a `SESSION_EXPIRED_EVENT` instead of calling `window.location.reload()`; `useAuth` listens and transitions to LoginForm without losing React state or in-memory form drafts (H7)
- **Admin role grant alert** — `createUserHandler` and `updateUserRole` fire `admin_role_granted` operational alert (throttled 1/hr) whenever a user gains admin role. Every creation also audit-logged with `adminRoleGranted` flag (L2)
- **Document size guard** — 100MB cap at `ingestDocument` entry (catches service-account uploads bypassing multer's 50MB browser limit). `getDocumentFromS3` HEADs first + stream-length fallback to reject oversized objects before buffering (M12)
- **Vulnerability scanner** — daily automated security audits
- **Incident response plan** — HIPAA 164.308, 7-phase lifecycle, escalation contacts
- **User management** — admin CRUD, role updates, force password reset, lastLogin tracking

## HIPAA Compliance & Data Protection

- **Audit log HMAC chain** — HMAC-SHA256 with app secret (not raw SHA-256), mutex-protected writes, S3 write retry with backoff (F-11)
- **Audit log immutability** — optional S3 Object Lock COMPLIANCE mode (`AUDIT_OBJECT_LOCK=true`), 6-year HIPAA minimum retention floor enforced via `Math.max`
- **Login audit trail** — successful logins logged via `logAuditEvent` (HIPAA §164.308(a)(5)(ii)(C)) (F-04)
- **PHI redaction** — 14 HIPAA identifiers, deep recursive traversal, applied to query logs/traces/feedback/audit. Name regex uses Unicode property escapes (`\p{Lu}` + `\p{L}`) + apostrophe/hyphen/period support so Spanish ("José García"), Irish ("Mary O'Brien"), French ("Jean-Paul"), and middle-initial ("John Q. Public") names are all redacted (M1)
- **Data retention** — automated cleanup (audit 7yr, query logs 1yr, traces 90d), HIPAA floor enforcement via Math.max
- **JWT_SECRET fail-fast** — production refuses to start with default/weak secret
- **HTTPS enforcement** — HSTS 1-year max-age
- **SSL hardening** — `rejectUnauthorized: true` enforced in production
- **Document metadata stripping** — Images (EXIF/IPTC/XMP/ICC via sharp), PDFs (info dictionary via pdf-lib), and DOCX/XLSX/PPTX (docProps/core.xml + docProps/app.xml via jszip round-trip) are scrubbed before S3 storage. `stripDocumentMetadata` dispatcher routes by MIME type. Visible content preserved byte-identically (M10)
- **Form drafts retention sweep** — daily cleanup removes abandoned form drafts (PPD/PMD/PAP) whose `updatedAt` exceeds `RETENTION_FORM_DRAFT_DAYS` (default 90, HIPAA floor 30). Uses index-based sweep (reads draft index, prunes entries, deletes S3 objects, saves pruned index) since draft keys don't embed YYYY-MM-DD dates
- **Sentry integration** — PHI-safe error tracking (8 scrubbing patterns)
- **Insurance card OCR audit trail** — immediate rawText redaction after extraction
- **Frontend idle timeout** — 15-min auto-logout with 2-min warning, full-viewport overlay
- **Field encryption startup warning** — `logger.warn` when `FIELD_ENCRYPTION_KEY` is not set, alerting operators that MFA secrets are stored in plaintext
- **Operational alerting** — `alertService.ts`: email alerts for audit write drops, reindex failures, ingestion errors, source staleness, malware scanner unavailability. 1-hour throttle per category. Configurable via `ALERT_EMAIL`
- **Malware scan fail-closed** — `utils/malwareScan.ts` now throws `MalwareScanUnavailableError` when `MALWARE_SCAN_ENABLED=true` and the ClamAV daemon is unreachable; the documents route returns 503 so uploads cannot silently bypass scanning. Availability check is time-boxed to 60s (was cached indefinitely) so a recovered daemon rejoins automatically. Opt-out via `MALWARE_SCAN_FAIL_CLOSED=false` (dev only). Operational alert fired via `alertService` (INV-29, H5)
- **Source staleness audit** — `services/sourceMonitor.ts` `auditStaleSources()` runs daily and flags sources that haven't produced fresh content in longer than their configured `expectedUpdateCadenceDays`. Sends a `source_stale` operational alert with a per-source 24h throttle. Admin endpoints `GET /api/sources/staleness` (read-only) and `POST /api/sources/audit-staleness` (triggers alerts)
- **Human-in-the-loop extraction correction** — `services/extractionFeedback.ts` stores reviewer per-field corrections + overall quality rating as an append-only S3 audit record. Admin endpoint `GET /api/extraction/corrections-stats` exposes aggregate accuracy + LLM overconfidence rate
- **Server-side form drafts** — `services/formDrafts.ts` + `/api/form-drafts/*` endpoints provide cross-device partial save/resume for PPD, PMD Account, and PAP Account forms. 2MB payload guard, user-scoped ACL on load, debounced 2s auto-save on the frontend via `useFormDraft` hook

## Reference Data & Medical Codes

- **HCPCS lookup** — 334 real DME codes across 25 categories
- **ICD-10 to HCPCS crosswalk** — 66 diagnosis codes, 116+ mappings, forward/reverse lookup
- **LCD coverage checklists** — 8 CMS LCDs with per-item required/optional flags and validation
- **PMD product catalog** — 22 products with images, brochures, weight capacities, seat types

## Forms & Workflows

- **PPD questionnaire** — 45 questions (EN/ES), API-driven, phone interview workflow
- **PMD recommendation engine** — weight-class routing, solid seat logic, stroke/hemiplegia, neuro/SPO/MPO, oxygen conflict, substitution rules
- **Seating evaluation auto-fill** — maps 45 PPD answers to 10-section form, generates printable HTML
- **PPD submission queue** — S3-backed, status workflow (pending/in_review/completed/returned). `updatePpdStatus` runs under a per-submission mutex so two admins racing on the same ID cannot clobber each other's review action (H6, INV-31)
- **PMD Account Creation** — 25 questions, 4 sections, EN/ES toggle
- **PAP Account Creation** — 24 questions, 4 sections, conditional formatting badges
- **Insurance card OCR** — Textract + Claude extracts structured fields, auto-fill, mismatch detection
- **Gmail SMTP email** — nodemailer with HTML templates, header injection prevention
- **Spasticity detection** — negation check + clinical context keywords (not bare match)
- **Seating eval guards** — numeric armStrength comparison with NaN guard, word-boundary MRADL classification
- **Weight range validation** — 70-700 lbs with NaN guards
- **Forms tab** — sub-navigation housing PPD, PMD Account, PAP Account, PPD Queue
- **Email URL protocol validation** — product imageUrl/brochureUrl require `http://` or `https://` before rendering in email HTML templates

## Observability & Analytics

- **RAG observability tracing** — per-query scores, timing, confidence; dashboard with drill-down
- **Quality metrics dashboard** — confidence distribution, flagged responses, unanswered tracking
- **FAQ analytics** — pattern detection from query logs
- **Query logging** — with CSV export (UTF-8 BOM, RFC 4180 multiline)
- **Usage tracking** — atomic `checkAndRecordQuery()` (no TOCTOU race), per-user daily limits with rollback
- **Structured JSON logging** — ISO timestamps, levels, AsyncLocalStorage correlation IDs
- **Per-route metrics** — `/api/metrics` with p50/p95/p99 latency, memory usage
- **Frontend error tracking** — `POST /api/errors/report` with dedup, global handlers, ErrorBoundary

## Infrastructure

- **PostgreSQL (RDS)** — 13 tables, pgvector for embeddings, 5 migrations, FK constraints with HIPAA-aware RESTRICT/CASCADE
- **S3 fallback** — hybrid storage when DATABASE_URL not configured, size guards (50MB metadata, 500MB vector index)
- **Cache abstraction** — `CacheProvider`/`SetProvider` interfaces, in-memory with TTL/LRU, Redis-ready
- **Storage abstraction** — `MetadataStore`/`DocumentStore`/`VectorStore` interfaces, S3 implementations
- **Retry/circuit breaker** — shared `withRetry` (exponential backoff + jitter), `withTimeout`, `CircuitBreaker`
- **Textract polling utility** — shared async polling from `ocr.ts` and `formAnalyzer.ts` with transient error retry
- **Race condition fixes** — vector store init lock, day-boundary double-check pattern, atomic usage tracking
- **Docker** — multi-stage build, tini init, non-root user (UID 1000), health check
- **Blue-green deployment** — staging port health check, ~2s downtime, automatic rollback on failure
- **CI/CD** — GitHub Actions: TruffleHog secret scanning, axe-core WCAG 2.0 A+AA accessibility audit, lint + type-check + tests + coverage + deploy, Dependabot weekly updates
- **Shared mutex consolidation** — queryLog, ragTrace, usage services migrated from inline `ensurePromise` pattern to `createOnceLock()` from asyncMutex.ts
- **OpenTelemetry span instrumentation** — custom spans for `rag.generation.stream` (query.ts), `ingestion.extract_text`, `ingestion.embed`, `ingestion.store_chunks` (ingestion.ts). Combined with auto-instrumentation (HTTP/Express) for full distributed tracing when `OTEL_ENABLED=true`
- **Embedding model evaluation script** — `scripts/evalEmbeddings.ts`: side-by-side Titan vs Cohere comparison with recall@K, MRR, keyword coverage report
- **Error monitoring** — GitHub Actions workflow every 4 hours (Docker, HTTP, logs, disk, DB, memory)
- **OpenAPI spec** — 50+ endpoints, 11 tags, reusable schemas
- **HNSW index migration** — `009_hnsw_index.sql` replaces IVFFlat with HNSW for better recall without periodic REINDEX (m=16, ef_construction=64)

## Frontend

- **Streaming SSE** — ref-based pattern (not nested setState), 2MB buffer cap, 120s timeout, AbortController cancellation
- **CSS variables design system** — 60+ tokens, light/dark themes, semantic status/confidence colors
- **Responsive layout** — tablet breakpoint (900px): icon-only tabs, compact header, hidden user badge name/role. Mobile breakpoint (640px): stacked header, full-width sections, wrapped tabs with labels
- **Accessibility** — ARIA labels, focus traps in modals, `role="dialog"`, `aria-pressed` on feedback
- **Error boundaries** — wraps all tab content and LoginForm
- **Idle timeout** — 15-min auto-logout with full-viewport interaction blocker
- **Silent token refresh** — 401 responses trigger automatic refresh token exchange before login redirect (both request() and SSE streaming paths), with coalesced concurrent attempts
- **Auto-logout** on 401 responses (after refresh failure), SSE stream cancellation on logout
- **Error report URL scrub** — `safeLocationHref()` in `errorReporting.ts` strips query strings and hash fragments before reporting to `/api/errors/report` so PHI in URL parameters (e.g. `?patientId=123`) never reaches error logs or Sentry (M9)
- **Input hygiene** — `maxLength` on PPD patient-info (200), account-creation text/textarea inputs (500/5000); blob URL revoked on success + error in `convertToPng` (S2-6/S2-7); client-side 50MB pre-upload size check in DocumentManager with friendly per-file error (S2-8)
- **Healthcare blue palette** — hexagonal/molecular background pattern
- **Loading skeletons** — shimmer animation, search hints, empty states
- **Toast notifications** — Heroicons with semantic CSS variable theming
- **Confirm dialogs** — Escape dismiss, danger variant, auto-focus
- **Document search** — filtering, collection selection persisted to localStorage
- **Select All 3-state** — page/all/deselect with indeterminate checkbox
- **Popout windows** — utility for opening components in new windows

## Test Coverage

1019 tests across 69 files (vitest). Recent additions: admin-role grant audit (`adminRoleGrant.test.ts`), document size guard + S3 fetch HEAD (s3Storage, ingestionLifecycle oversize case), OOXML metadata stripping + form-draft retention sweep (stripMetadata, dataRetention), rate-limit key resolution (`rateLimitKey.test.ts`), zero-width prompt-injection bypass coverage, Unicode patient-name redaction (Spanish / Irish / French / middle-initial), malware fail-closed (`malwareScan.test.ts`), token revocation + INV-12 integration (`tokenRevocation.test.ts`), MFA recovery code TOCTOU regression (`mfaRecoveryTocTou.test.ts`), real-chunker ingestion lifecycle with dedup + rollback (`ingestionLifecycle.test.ts`), extraction feedback store (`extractionFeedback.test.ts`), form drafts service (`formDrafts.test.ts`), source staleness audit + alerting (`sourceStaleness.test.ts`), gold-standard eval dataset shape + scoring (`goldStandardEval.test.ts`). Ongoing coverage: vector store, PHI redaction, URL validation, auth flows, usage tracking, HIPAA compliance, extraction templates, document extractor, orphan cleanup, job queue, ingestion, audit, embeddings, dimension validation, OCR, email, data retention, metrics, seating evaluation, PPD questionnaire, integration tests, HTML escaping, HCPCS lookup, ICD-10 mapping, PMD catalog, coverage checklists, form rules, account creation, PAP account creation, reference enrichment, FAQ analytics, RAG evaluation metrics, E2E auth (supertest: login/cookies/CSRF/refresh/revocation/logout), and route-level tests (documents, extraction, HCPCS, ICD-10, coverage, queryLog, PPD, s3Storage). CI thresholds: 50% lines, 40% branches.
