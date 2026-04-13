# Changelog

Consolidated history of improvements, grouped by category. For architectural details of current state, see the Architecture section in `CLAUDE.md`. For critical invariants that must not regress, see the Invariant Library in `CLAUDE.md`.

---

## RAG Query Pipeline

- **A/B model testing framework** — `services/abTesting.ts`, `routes/abTesting.ts`: compare Bedrock models on same query, Welch's t-test for significance
- **Adaptive search weighting** — query type classification (code_lookup, coverage_question, general) with auto-adjusted semantic/keyword weights
- **IDF-enhanced BM25** — proper IDF weighting with corpus-wide term frequency stats, dynamic normalization (replaces hardcoded /10)
- **Re-ranking pipeline** — header boost, noise penalty, token-overlap deduplication (>70% overlap penalized)
- **Confidence scoring** — blended avg+top score (0.35/0.65), tuned thresholds (LOW=0.30, PARTIAL=0.42), reconciliation floor 0.30
- **Semantic dedup length-ratio pre-check** — fast `minSize/maxSize` check before O(n) Jaccard intersection
- **Medical-term-aware tokenizer** — preserves hyphenated terms, short tokens (IV, O2, 5mg)
- **Section header detection** — ALL CAPS, markdown, colon-terminated, numbered headers as chunk metadata
- **Prompt injection detection** — 15+ patterns, NFKD normalization, HTML entity decode, Cyrillic look-alikes, 10KB truncation
- **Output guardrails** — detect system prompt leakage and role deviation in generated responses
- **Conversation history validation** — 20-turn and 50K-char budgets
- **Conversation memory with summarization** — older turns summarized, recent 4 kept verbatim
- **Structured reference enrichment** — auto-detects HCPCS/ICD-10 codes and coverage keywords, injects structured data into RAG context
- **Prompt caching** — `cache_control: ephemeral` on all Bedrock system prompt blocks (90% cached token savings)
- **Embedding model abstraction** — `EmbeddingProvider` interface, swappable providers, dimension tracking in index
- **Embedding dimension validation** — mismatch detection on init, `reindexAllEmbeddings()` migration path
- **NaN guards** on combined retrieval scores, MIN_SCORE_THRESHOLD 0.15, default topK raised to 8
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
- **Source monitor** — automated URL monitoring for external document changes (SHA-256 hash comparison, hourly scheduler)
- **LCD source monitor seeding** — one-call endpoint seeds 8 CMS LCD sources
- **Fee schedule fetcher** — auto-fetches CMS DME fee schedules
- **Document reindexer** — change detection and re-ingestion service
- **Document collections and tagging** — organize, tag, filter queries by collection
- **Document status tracking** — frontend shows ready/processing/error with colored badges

## Document Extraction & Analysis

- **Structured extraction** — templates (PPD, CMN, Prior Auth, General) with Claude Sonnet via Bedrock
- **Async extraction** — job queue with S3 persistence, status polling, auto-cleanup after 1 hour
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
- **JWT jti** — `crypto.randomUUID()` (not predictable values)
- **Token revocation** — `revokeAllUserTokens()` called on all password reset paths (admin reset, self-service reset via code, password change) per INV-12
- **Service-to-service auth** — X-API-Key with timing-safe comparison for CallAnalyzer
- **WAF middleware** — 13 SQLi + 13 XSS + 7 path traversal + 4 CRLF patterns, IP blocklist, anomaly scoring
- **CSRF** — double-submit cookie on all state-changing endpoints
- **SSRF prevention** — `urlValidation.ts` blocks private IPs, localhost, cloud metadata
- **Rate limiting** — per-endpoint limits (query 30/15min, forms 10/15min, email 5/15min)
- **Vulnerability scanner** — daily automated security audits
- **Incident response plan** — HIPAA 164.308, 7-phase lifecycle, escalation contacts
- **User management** — admin CRUD, role updates, force password reset, lastLogin tracking

## HIPAA Compliance & Data Protection

- **Audit log HMAC chain** — HMAC-SHA256 with app secret (not raw SHA-256), mutex-protected writes, S3 write retry with backoff (F-11)
- **Login audit trail** — successful logins logged via `logAuditEvent` (HIPAA §164.308(a)(5)(ii)(C)) (F-04)
- **PHI redaction** — 14 HIPAA identifiers, deep recursive traversal, applied to query logs/traces/feedback/audit
- **Data retention** — automated cleanup (audit 7yr, query logs 1yr, traces 90d), HIPAA floor enforcement via Math.max
- **JWT_SECRET fail-fast** — production refuses to start with default/weak secret
- **HTTPS enforcement** — HSTS 1-year max-age
- **SSL hardening** — `rejectUnauthorized: true` enforced in production
- **Image metadata stripping** — EXIF/IPTC/XMP removal before S3 storage
- **Sentry integration** — PHI-safe error tracking (8 scrubbing patterns)
- **Insurance card OCR audit trail** — immediate rawText redaction after extraction
- **Frontend idle timeout** — 15-min auto-logout with 2-min warning, full-viewport overlay

## Reference Data & Medical Codes

- **HCPCS lookup** — 332 real DME codes across 25 categories
- **ICD-10 to HCPCS crosswalk** — 66 diagnosis codes, 116+ mappings, forward/reverse lookup
- **LCD coverage checklists** — 8 CMS LCDs with per-item required/optional flags and validation
- **PMD product catalog** — 22 products with images, brochures, weight capacities, seat types

## Forms & Workflows

- **PPD questionnaire** — 45 questions (EN/ES), API-driven, phone interview workflow
- **PMD recommendation engine** — weight-class routing, solid seat logic, stroke/hemiplegia, neuro/SPO/MPO, oxygen conflict, substitution rules
- **Seating evaluation auto-fill** — maps 45 PPD answers to 10-section form, generates printable HTML
- **PPD submission queue** — S3-backed, status workflow (pending/in_review/completed/returned)
- **PMD Account Creation** — 25 questions, 4 sections, EN/ES toggle
- **PAP Account Creation** — 24 questions, 4 sections, conditional formatting badges
- **Insurance card OCR** — Textract + Claude extracts structured fields, auto-fill, mismatch detection
- **Gmail SMTP email** — nodemailer with HTML templates, header injection prevention
- **Spasticity detection** — negation check + clinical context keywords (not bare match)
- **Seating eval guards** — numeric armStrength comparison with NaN guard, word-boundary MRADL classification
- **Weight range validation** — 70-700 lbs with NaN guards
- **Forms tab** — sub-navigation housing PPD, PMD Account, PAP Account, PPD Queue

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
- **CI/CD** — GitHub Actions: lint + type-check + tests + coverage + deploy, Dependabot weekly updates
- **Error monitoring** — GitHub Actions workflow every 4 hours (Docker, HTTP, logs, disk, DB, memory)
- **OpenAPI spec** — 50+ endpoints, 11 tags, reusable schemas

## Frontend

- **Streaming SSE** — ref-based pattern (not nested setState), 2MB buffer cap, 120s timeout, AbortController cancellation
- **CSS variables design system** — 60+ tokens, light/dark themes, semantic status/confidence colors
- **Accessibility** — ARIA labels, focus traps in modals, `role="dialog"`, `aria-pressed` on feedback
- **Error boundaries** — wraps all tab content and LoginForm
- **Idle timeout** — 15-min auto-logout with full-viewport interaction blocker
- **Auto-logout** on 401 responses, SSE stream cancellation on logout
- **Healthcare blue palette** — hexagonal/molecular background pattern
- **Loading skeletons** — shimmer animation, search hints, empty states
- **Toast notifications** — Heroicons with semantic CSS variable theming
- **Confirm dialogs** — Escape dismiss, danger variant, auto-focus
- **Document search** — filtering, collection selection persisted to localStorage
- **Select All 3-state** — page/all/deselect with indeterminate checkbox
- **Popout windows** — utility for opening components in new windows

## Test Coverage

725 tests across 49 files (vitest). Key coverage areas: vector store, PHI redaction, URL validation, auth flows, usage tracking, HIPAA compliance, extraction templates, document extractor, orphan cleanup, job queue, ingestion, audit, embeddings, dimension validation, OCR, email, data retention, metrics, seating evaluation, PPD questionnaire, integration tests, HTML escaping, HCPCS lookup, ICD-10 mapping, PMD catalog, coverage checklists, form rules, account creation, PAP account creation, reference enrichment, FAQ analytics, and route-level tests (documents, extraction, HCPCS, ICD-10, coverage, queryLog, PPD, s3Storage). CI thresholds: 50% lines, 40% branches.
