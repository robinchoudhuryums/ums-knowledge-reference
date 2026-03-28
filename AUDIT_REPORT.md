# Codebase Audit Report — UMS Knowledge Base Reference Tool

**Date:** 2026-03-28
**Auditor:** Claude (Automated)
**Scope:** Full codebase — backend services, routes, middleware, config, database, frontend, tests, CI/CD

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
| 4 | **HIPAA** | `backend/src/services/insuranceCardReader.ts:102` | Unredacted PHI (insurance card OCR text with member IDs, names, DOB) sent to Bedrock LLM for field extraction. Should redact or use regex extraction instead. |

---

## High Findings (Fix Soon)

| # | Area | File | Issue |
|---|------|------|-------|
| 5 | Routes | `backend/src/routes/documents.ts:284-303` | Bulk delete mutates array with `splice()` mid-iteration — indices shift, wrong documents may be deleted. Use reverse iteration or `filter()`. |
| 6 | Routes | `backend/src/routes/documents.ts:153` | `GET /documents/:id` has no collection ACL check — any authenticated user can read any document's metadata. The list endpoint correctly enforces ACL. |
| 7 | HIPAA | `backend/src/services/ppdQueue.ts:142` | PPD submission logged with raw `patientInfo` (patient name, clinical details) without PHI redaction. |
| 8 | Auth | `backend/src/routes/users.ts:404` | User IDs generated with `user-${Date.now()}` — predictable/enumerable. Should use `uuid.v4()`. |
| 9 | DB | `backend/migrations/001_initial_schema.sql` | Missing indexes on frequently-queried FK columns: `usage_records.user_id`, `audit_logs.user_id`, `query_logs.user_id`, `feedback.user_id`. |
| 10 | Services | `backend/src/services/ppdQuestionnaire.ts:275` | HCPCS code parsing: `parseInt(p.hcpcs.replace(/\D/g, ''))` — corrupted HCPCS codes with no digits produce `NaN → 0`, silently bypassing weight capacity filtering. |
| 11 | Frontend | `frontend/src/services/api.ts:191-288` | No timeout on SSE streaming — if backend hangs, UI is stuck in loading state indefinitely. Add a configurable timeout (e.g., 120s). |
| 12 | CI/CD | `.github/workflows/ci.yml` | Coverage threshold is **30%** — dangerously low for a medical/HIPAA system. Industry standard is 70-80%; healthcare should target 80%+. |
| 13 | Routes | `backend/src/routes/queryLog.ts:190-194` | Date iteration loop using `d.setDate()` with Date object comparison — can produce infinite loop or incorrect iterations. Use timestamp arithmetic. |
| 14 | Routes | `backend/src/routes/accountCreation.ts:57`, `papAccountCreation.ts:45`, `ppd.ts:302` | Email `to` field from user input not validated — risk of header injection. |

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

### Overall: 7.5 / 10 (B+)

For a single-developer internal tool, this is exceptional in scope and ambition. The security hardening is above average (CSRF, SSRF prevention, prompt injection detection, audit hash chains, PHI redaction). The architecture is clean and well-documented. Docked points for: low test coverage, critical DB issues (no FKs, dangerous delete patterns, SSL disabled), and HIPAA gaps in the PHI handling pipeline.

### Detailed Ratings

| Category | Rating | Grade | Key Strengths | Key Weaknesses |
|----------|--------|-------|---------------|----------------|
| **RAG Functionality** | 8.0 | A- | Hybrid BM25+cosine with IDF, medical synonym expansion, re-ranking, prompt injection detection (12 patterns), output guardrails, prompt caching, reference enrichment | Char-based token estimation (not real tokenizer), conversation budget check after exceeding, no semantic caching |
| **OCR / Extraction** | 7.0 | B | Multi-format support (PDF, DOCX, XLSX, CSV, HTML), conditional Textract OCR, vision extraction, template-based structured extraction, async jobs | Zero tests for formAnalyzer/visionExtractor/insuranceCardReader, unredacted PHI sent to LLM, fragile CSV parser |
| **HIPAA Compliance** | 7.5 | B+ | Comprehensive PHI regex patterns, SHA-256 audit hash chain, JWT httpOnly cookies, account lockout, password history, idle timeout, data retention with HIPAA floors | SSL validation disabled, PPD logs unredacted PHI, insurance card sends raw PHI to Bedrock, no PHI scrubbing in embedding pipeline |
| **Form Functionality** | 7.5 | B+ | 45-question PPD with EN/ES, PMD recommendation engine, seating eval auto-fill, insurance card OCR, submission queue | No server-side validation exported, email address injection risk, weight parsing edge cases, spasticity false positives |
| **UI/UX & Design** | 7.0 | B | Healthcare blue palette, 60+ CSS variables, dark mode, code-split PDF viewer, toast system, loading skeletons | Missing focus traps, ARIA labels, no conversation virtualization, missing memoization, no streaming timeout |
| **Notable Features** | 8.0 | A- | 332 HCPCS codes / 66 ICD-10 / 8 LCDs, RAG tracing with p50/p95/p99, source monitoring, horizontal scaling prep | — |
| **Architecture & Code Quality** | 7.5 | B+ | Clean service/route/config/db layering, cache abstraction, embedding provider interface, storage abstraction | No FK constraints, dangerous delete patterns, inconsistent error handling, some fire-and-forget audit logs |
| **Documentation** | 9.0 | A | CLAUDE.md is extraordinarily detailed — architecture, tuning knobs, API endpoints, recent changes, SCALING.md, OBSERVATORY_PORT_LOG.md | — |
| **Test Coverage** | 5.5 | C | 533 tests, good mocking patterns, integration tests for critical paths | 30% threshold, 9/15 routes untested, 11/39 services untested, no concurrency tests |

---

## Top 10 Recommended Next Steps

1. **Fix SSL cert validation** on database connections — `rejectUnauthorized: true` + RDS CA bundle
2. **Add foreign key constraints** to all tables via new migration (003)
3. **Replace dangerous mass-delete pattern** in `db/users.ts` with explicit delete-by-ID
4. **Fix bulk delete array mutation** in `documents.ts` route (use `filter()` instead of `splice()`)
5. **Add collection ACL check** to `GET /documents/:id`
6. **Raise CI coverage threshold** to 60%+ and add tests for untested routes (documents, extraction, ppd)
7. **Add PHI redaction** to PPD queue logging and insurance card LLM calls
8. **Add streaming timeout** to frontend SSE handler (120s default)
9. **Add server-side form validation** for account creation forms + email address validation
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
