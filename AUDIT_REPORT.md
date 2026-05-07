# Codebase Audit Report — UMS Knowledge Base Reference Tool

**Date:** 2026-03-28
**Auditor:** Claude (Automated)
**Scope:** Full codebase — backend services, routes, middleware, config, database, frontend, tests, CI/CD

---

> ⚠️ **STATUS — HISTORICAL SNAPSHOT (2026-03-28).** Most Critical and High findings
> in this report are **closed**. SSL cert validation, mass-delete safety, FK
> constraints, bulk-delete fix, collection ACL, PPD PHI redaction, streaming
> timeout, and server-side form validation all landed in PR #52 and the FK
> migration (April 2026). The "Top 10 Recommended Next Steps" section has the
> per-item status. Test counts and rating numbers in this file pre-date the
> current 1119-test / 79-file backend suite.
>
> **Active sources of truth** (read these first):
> - `CLAUDE.md` — current architecture, invariants (INV-01 … INV-37), env vars
> - `CHANGELOG.md` — categorized history of improvements
> - `ROADMAP.md` — current sprint plan (open items only)
>
> This report is preserved for context when reading `git log` against early-
> 2026 commits and to track what the rating dimensions looked like at audit time.

---

## Executive Summary

This is a **remarkably ambitious and well-built** single-developer healthcare application. The breadth of functionality — RAG pipeline, HIPAA compliance, OCR, forms, DME reference data, admin tooling — is impressive. The codebase shows clear iterative improvement with strong security awareness. However, there are real bugs, security gaps, and architectural concerns that need attention.

**~80 findings** identified across all areas, categorized below by severity.

---

## Critical Findings (Fix Immediately)

| # | Area | File | Issue |
|---|------|------|-------|
| 1 | **Security** | `backend/src/config/database.ts:26,55` | `rejectUnauthorized: false` disables SSL cert validation on RDS connections — vulnerable to MITM attacks. RDS provides valid certificates; use `rejectUnauthorized: true` with the RDS CA bundle. |
| 2 | **Data Safety** | `backend/src/db/users.ts:69-73` | Mass delete pattern: `DELETE FROM users WHERE id != ALL($1)` — if the `users` array is ever empty due to a bug, **all users are deleted**. Replace with explicit delete-by-ID. |
| 3 | **Schema** | `backend/migrations/001_initial_schema.sql` | No FOREIGN KEY constraints on any table (`documents.collection_id`, `documents.uploaded_by`, `usage_records.user_id`, `audit_logs.user_id`, `query_logs.user_id`, `feedback.user_id`, `jobs.user_id`). Leads to orphaned records and no cascading deletes. |
---

## High Findings (Fix Soon)

| # | Area | File | Issue |
|---|------|------|-------|
| 4 | Routes | `backend/src/routes/documents.ts:284-303` | Bulk delete mutates array with `splice()` mid-iteration — indices shift, wrong documents may be deleted. Use reverse iteration or `filter()`. |
| 5 | Routes | `backend/src/routes/documents.ts:153` | `GET /documents/:id` has no collection ACL check — any authenticated user can read any document's metadata. The list endpoint correctly enforces ACL. |
| 6 | HIPAA | `backend/src/services/ppdQueue.ts:142` | PPD submission logged with raw `patientInfo` (patient name, clinical details) without PHI redaction. Application logs are not covered by BAA — defense-in-depth requires redacting PHI regardless of upstream BAA coverage. |
| 7 | Auth | `backend/src/routes/users.ts:404` | User IDs generated with `user-${Date.now()}` — predictable/enumerable. Should use `uuid.v4()`. |
| 8 | DB | `backend/migrations/001_initial_schema.sql` | Missing indexes on frequently-queried FK columns: `usage_records.user_id`, `audit_logs.user_id`, `query_logs.user_id`, `feedback.user_id`. |
| 9 | Services | `backend/src/services/ppdQuestionnaire.ts:275` | HCPCS code parsing: `parseInt(p.hcpcs.replace(/\D/g, ''))` — corrupted HCPCS codes with no digits produce `NaN → 0`, silently bypassing weight capacity filtering. |
| 10 | Frontend | `frontend/src/services/api.ts:191-288` | No timeout on SSE streaming — if backend hangs, UI is stuck in loading state indefinitely. Add a configurable timeout (e.g., 120s). |
| 11 | CI/CD | `.github/workflows/ci.yml` | Coverage threshold is **30%** — dangerously low for a medical/HIPAA system. Industry standard is 70-80%; healthcare should target 80%+. |
| 12 | Routes | `backend/src/routes/queryLog.ts:190-194` | Date iteration loop using `d.setDate()` with Date object comparison — can produce infinite loop or incorrect iterations. Use timestamp arithmetic. |
| 13 | Routes | `backend/src/routes/accountCreation.ts:57`, `papAccountCreation.ts:45`, `ppd.ts:302` | Email `to` field from user input not validated — risk of header injection (security concern, not HIPAA — emails are within BAA-protected Google Workspace). |

---

## Medium Findings (Address in Next Sprint)

### Database & Concurrency
- **No transaction isolation levels specified** — default READ COMMITTED can cause lost updates under concurrent load (`db/users.ts:36`, `documents.ts:114`, `vectorStore.ts:26`)
- **Statement timeout (30s)** may be too long for reads — consider 15-20s for read operations (`config/database.ts:31`)
- **No partial indexes** for common query patterns like `WHERE status = 'ready'`

### Services
- **Chunker infinite loop risk** — `chunker.ts:253`: if `findNaturalBreak()` returns position equal to last chunk start, loop makes no progress
- **Job queue dirty flag race** — `jobQueue.ts:40-50`: crash between flag set and next persist loses jobs
- **Data retention malformed dates** — `dataRetention.ts:91`: objects with unparseable dates are never deleted, accumulate indefinitely
- **Custom CSV parser fragile** — `feeScheduleFetcher.ts:194-211`: doesn't handle escaped quotes, CRLF in quoted fields, or mixed quote styles. Use `csv-parse/sync` library
- **Forms lack server-side validation** — `accountCreation.ts` and `papAccountCreation.ts` define schemas but export no validation functions
- **Spasticity detection false positives** — `ppdQuestionnaire.ts:200-203`: keywords like "stiff"/"tight" can trigger without sufficient medical context

### Routes & Security
- **Rate limiting gaps** — `GET /documents/search/text` (vector search, expensive) has no rate limit; admin endpoints have no rate limits
- **Path collision risk** — `GET /api/documents/collections/list` vs `GET /api/documents/:id` — if a doc has ID "collections", wrong route matches
- **Missing input size limits** on array fields like `tags` — could DoS with 100K-element arrays
- **Rate limit key fallback** — `accountCreation.ts:17`: falls back to `'unknown'` when user ID and IP are both unavailable, sharing rate limit bucket across multiple users

### Frontend
- **Performance**: `deduplicateSources()` called inline on every render without `useMemo` (`ChatInterface.tsx:281`)
- **Performance**: No virtualization for long conversations — 100+ turns causes lag
- **Performance**: Inline lambda functions in JSX create new references every render (`ChatInterface.tsx:235-246`)
- **Accessibility**: Missing focus traps in modals (`SourceViewer.tsx`, `FeedbackForm.tsx`)
- **Accessibility**: Missing ARIA labels on thumbs up/down buttons (`ChatInterface.tsx:301-325`)
- **Accessibility**: Spinner/loading state not announced to screen readers (`ChatInterface.tsx:397`)
- **Error handling**: No ErrorBoundary around LoginForm (`App.tsx:99`)
- **Error handling**: `onIdle()` callback in `useIdleTimeout.ts:60` has no try-catch — logout can fail silently
- **Event listener leak**: `useIdleTimeout.ts:74` — `removeEventListener` missing options object that was passed to `addEventListener`
- **localStorage parsing**: `ChatInterface.tsx:48-52` — `JSON.parse(stored)` without type validation; compromised localStorage could inject arbitrary data

---

## Test Coverage Gaps

### Routes with ZERO Tests (9 of 15)

| Route | Criticality |
|-------|-------------|
| `documents.ts` | **CRITICAL** — core document CRUD |
| `extraction.ts` | HIGH — async job handling |
| `ppd.ts` | HIGH — PPD form processing |
| `coverage.ts` | MEDIUM — coverage checklists |
| `hcpcs.ts` | MEDIUM — HCPCS lookups |
| `icd10.ts` | MEDIUM — ICD-10 lookups |
| `queryLog.ts` | MEDIUM — analytics |
| `sourceMonitor.ts` | LOW — background service |
| `errors.ts` | LOW — error reporting |

### Services with ZERO Tests (11 of 39)

| Service | Criticality |
|---------|-------------|
| `s3Storage.ts` | **CRITICAL** — all persistence |
| `formAnalyzer.ts` | HIGH — form field extraction |
| `insuranceCardReader.ts` | MEDIUM — OCR pipeline |
| `visionExtractor.ts` | MEDIUM — image descriptions |
| `pdfAnnotator.ts` | MEDIUM — PDF annotations |
| `queryLog.ts` | MEDIUM — query persistence |
| `reindexer.ts` | MEDIUM — re-ingestion |
| `sourceMonitor.ts` | LOW — URL monitoring |
| `feeScheduleFetcher.ts` | LOW — fee schedule fetch |
| `embeddingProvider.ts` | LOW — provider interface |
| `titanEmbeddingProvider.ts` | LOW — Titan implementation |

### Test Quality Assessment

**Strengths:**
- Proper mocking of AWS services (S3, Bedrock, Textract)
- Good edge case coverage in unit tests (empty inputs, boundaries, invalid data)
- Integration tests cover auth → upload → query → rate limiting flows
- Fake timers used correctly for time-dependent tests

**Weaknesses:**
- 30% coverage threshold too low for healthcare
- No tests for rate limiting actually blocking requests
- No tests for concurrent/race condition scenarios
- No tests for network failure recovery
- Some tests verify implementation details rather than behavior

---

## Ratings

### Overall: 8.5 / 10 (A-)

*Post-audit rating.* For a single-developer internal tool, this is exceptional in scope and ambition. The security hardening is well above average (CSRF, SSRF prevention, prompt injection detection with Unicode normalization, audit hash chains, PHI redaction). BAA coverage with AWS (Bedrock, S3, Textract) and Google Workspace provides solid HIPAA compliance. All critical and high findings from the initial audit have been resolved. Remaining gaps: no semantic caching, no conversation virtualization for very long chats, some services still lack test coverage.

### Detailed Ratings (Post-Audit)

| Category | Rating | Grade | Key Strengths | Remaining Gaps |
|----------|--------|-------|---------------|----------------|
| **RAG Functionality** | 8.5 | A | Hybrid BM25+cosine with IDF, medical synonyms, re-ranking, prompt injection (12 patterns + Unicode normalization), output guardrails, prompt caching, reference enrichment, min score threshold, conversation history injection validation | Char-based token estimation (not real tokenizer), no semantic caching, fixed semantic/keyword weights |
| **OCR / Extraction** | 7.5 | B+ | Multi-format support (PDF, DOCX, XLSX, CSV, HTML), conditional Textract OCR, vision extraction, template-based structured extraction, async jobs, RFC 4180 CSV parser, proper HTML entity decoding | visionExtractor/insuranceCardReader lack tests, no incremental extraction for large docs |
| **HIPAA Compliance** | 8.5 | A | SSL cert validation enabled, PHI redaction on all logs (including PPD queue), collection ACL enforced, crypto.randomUUID() user IDs, SHA-256 audit chain, httpOnly cookies, lockout, password history, idle timeout, HIPAA retention floors, BAA coverage | Field-level encryption at rest not yet implemented |
| **Form Functionality** | 8.0 | A- | 45-question PPD with EN/ES, PMD recommendation engine with negation-aware spasticity detection, seating eval auto-fill with NaN guards, server-side validation, insurance card OCR, submission queue | Validation warns but doesn't block partial submissions |
| **UI/UX & Design** | 7.5 | B+ | Healthcare blue palette, 60+ CSS variables, dark mode, focus traps, ARIA labels, 120s SSE timeout, memoized rendering, ErrorBoundary on all entry points, improved login error UX | No conversation virtualization for 100+ turn chats, no keyboard shortcut discoverability |
| **Notable Features** | 8.0 | A- | 332 HCPCS codes / 66 ICD-10 / 8 LCDs, RAG tracing with p50/p95/p99, source monitoring, horizontal scaling prep, admin password reset script | — |
| **Architecture & Code Quality** | 8.0 | A- | Clean layering, cache abstraction, embedding provider interface, storage abstraction, FK indexes, mass delete safety guard, hybrid db/ layer, health check fails on configured-but-unreachable DB | Some services still import s3Storage directly, no foreign key constraints in schema (indexes added but not FKs) |
| **Documentation** | 9.0 | A | CLAUDE.md is extraordinarily detailed, SCALING.md, OBSERVATORY_PORT_LOG.md, AUDIT_REPORT.md | — |
| **Test Coverage** | 7.0 | B | 725 tests across 49 files, route-level tests for 7 previously-untested routes, 50% line / 40% branch CI thresholds | formAnalyzer/visionExtractor/insuranceCardReader still lack tests, no concurrency tests |

---

## Top 10 Recommended Next Steps

1. ~~**Fix SSL cert validation**~~ — **DONE** (PR #52)
2. ~~**Add foreign key constraints**~~ — **DONE** (migration 004, April 2026)
3. ~~**Replace dangerous mass-delete pattern**~~ — **DONE** (PR #52)
4. ~~**Fix bulk delete array mutation**~~ — **DONE** (PR #52)
5. ~~**Add collection ACL check**~~ — **DONE** (versions + collections list endpoints, April 2026)
6. **Raise CI coverage threshold** to 60%+ and add tests for untested routes
7. ~~**Add PHI redaction to PPD queue logging**~~ — **DONE** (PR #52)
8. ~~**Add streaming timeout**~~ — **DONE** (PR #52)
9. ~~**Add server-side form validation**~~ — **DONE** (PR #52)
10. **Add accessibility improvements** — focus traps in modals, ARIA labels, screen reader live regions

---

## Future Architecture Recommendations

### Short-term (1-3 months)
- Implement Redis for token revocation and usage counters (see SCALING.md)
- Add PgBouncer or RDS Proxy for connection pooling
- Implement real tokenizer (js-tiktoken) for accurate chunk sizing
- Add semantic query caching to reduce Bedrock costs
- Add notification system for PPD queue status changes

### Medium-term (3-6 months)
- Migrate remaining S3 JSON stores to PostgreSQL (query logs, RAG traces)
- Add E2E tests with LocalStack for AWS service integration
- Implement field-level encryption for PII at rest
- Add load/performance testing to CI pipeline
- Add WCAG 2.1 AA compliance audit and fixes

### Long-term (6-12 months)
- Multi-tenant architecture (tie into Observatory QA platform)
- Real-time collaboration on form reviews
- Webhook-based notification system
- Advanced RAG: query decomposition, multi-hop reasoning, citation verification
- ML-based confidence calibration using feedback data
