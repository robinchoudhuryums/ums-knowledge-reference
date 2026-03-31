# UMS Knowledge Base — Comprehensive Codebase Audit Report

**Date:** 2026-03-31
**Scope:** Full codebase audit (~44K lines TypeScript, 705 tests, 48 test files)
**Auditor:** Automated deep analysis of all backend services, routes, middleware, config, utils, db, cache, storage, frontend components, hooks, services, types, styling, tests, Docker, CI/CD, migrations, and documentation.

---

## Executive Summary

This is a **mature, well-architected** internal tool that covers an impressive breadth: RAG pipeline, HIPAA compliance, forms workflow, structured data lookups, and admin analytics. The codebase shows evidence of **iterative hardening** — race conditions were fixed, PHI redaction was deepened, security was layered progressively. That said, there are areas where complexity has accumulated and opportunities for improvement exist.

---

## Ratings (Priority Order)

### 1. HIPAA Compliance — 8.0/10

| Sub-factor | Rating | Notes |
|---|---|---|
| PHI Redaction | 8/10 | 18 HIPAA identifiers covered (SSN, DOB, MRN, phone, email, address, Medicare/Medicaid, names). Deep recursive traversal in audit logs. Natural language DOB patterns. Inherent regex limits — unstructured patient names without prefix context will slip through. |
| Authentication/Authorization | 8.5/10 | httpOnly cookies, 30-min JWT expiry, account lockout (5 attempts/15min), password history (last 5), `mustChangePassword`, CSRF double-submit cookie, collection-level ACL, JWT_SECRET enforcement in prod, `revokeAllUserTokens` on password reset. |
| Audit Trail | 9/10 | SHA-256 hash chain with mutex-protected writes, deep PHI redaction, chain verification endpoint, recovery on restart. Excellent tamper-evidence. |
| Data Retention | 8.5/10 | HIPAA minimum floors hard-coded (audit ≥6yr), NaN-safe parseInt, validated date regex. Runs at 3AM daily. |
| Session Management | 8/10 | 15-min idle timeout with full-viewport interaction blocker. 30-min JWT expiry. Stream cancellation on logout. |
| Encryption | 7/10 | S3 AES-256, RDS SSL with `rejectUnauthorized: true` by default, HTTPS enforcement with HSTS. No application-layer encryption of PHI fields. |
| Prompt Injection Protection | 8/10 | 12 input patterns + Unicode normalization + output guardrails + XML context framing. Good layered defense. |

**Improvement paths:**
- Add **field-level encryption** for PHI stored in S3/RDS
- Implement **audit log immutability** via S3 Object Lock (WORM)
- Add **MFA** (multi-factor authentication) — currently single-factor only
- Add a **PHI discovery scan** for retroactive detection in stored data
- Add **BAA compliance checklist** endpoint for compliance officers

---

### 2. RAG Functionality — 7.5/10

| Sub-factor | Rating | Notes |
|---|---|---|
| Retrieval Quality | 7.5/10 | Hybrid search (cosine + BM25) with IDF, medical synonym expansion, re-ranking. BM25 normalization is per-query (divides by max in result set), which can amplify noise when all BM25 scores are low. |
| Chunking | 7/10 | Sentence-boundary-aware with overlap, table preservation, section header detection. 500-token chunks with 100-token overlap is reasonable. The ~4 chars/token heuristic is rough. |
| Embedding | 8/10 | Titan Embed V2 (1024 dims), LRU cache (200 entries), batch processing (parallel 20), model ID in cache key, dimension validation. |
| Generation | 7.5/10 | Claude Haiku 4.5 with good system prompt. Prompt caching saves 90% on cached tokens. Confidence scoring with reconciliation. Output guardrails detect system prompt leakage. Temperature 0.15 is appropriately conservative. |
| Query Processing | 8/10 | Reformulation of follow-up questions, conversation memory with summarization, structured reference enrichment (HCPCS/ICD-10/LCD). Input sanitization and prompt injection detection. |
| Reference Data | 8/10 | 332 HCPCS codes, 66 ICD-10 codes, 8 LCD checklists — automatically enriched into RAG context. |
| Observability | 8/10 | Per-query RAG traces with timing breakdowns, confidence tracking, token counts, failure drill-down. |

**Improvement paths:**
- **Replace Titan Embed V2 with a medical domain embedding model** (e.g., MedCPT, BioLORD)
- **Add cross-encoder re-ranking** with a fine-tuned model (vs. current heuristic boosting)
- **Add retrieval evaluation** — automated test suite with gold-standard Q&A pairs
- **Migrate to HNSW** index for pgvector (better recall than IVFFlat)
- **Add query routing** — detect when structured data alone suffices vs. RAG

---

### 3. Overall Quality — 7.5/10

| Sub-factor | Rating | Notes |
|---|---|---|
| Architecture | 7.5/10 | Clean separation of concerns. Hybrid S3/RDS pattern. Storage/cache/embedding abstraction layers ready for scaling. |
| Code Quality | 7/10 | Well-structured with consistent patterns. Some files are large (auth.ts 488 lines, query.ts 791 lines). Good TypeScript with strict flags. |
| Testing | 7/10 | 705 tests is substantial. Good coverage of critical paths. Tests are unit-only — no E2E or integration tests against real services. |
| Error Handling | 8/10 | Resilience utilities (retry with jitter, circuit breaker, timeout), graceful shutdown with buffer flushing, usage rollback on failed queries. |
| DevOps | 7.5/10 | Docker with tini + non-root user + health check. CI with lint/type-check/test/coverage/audit. Auto-deploy via SSH. |
| Documentation | 8/10 | Exceptional CLAUDE.md. Good README. OpenAPI spec. SCALING.md. |
| Security | 8/10 | SSRF prevention, rate limiting, CSRF, CORS hardening, helmet, HTML escaping, header injection prevention, file extension whitelist. |

---

### 4. Forms & Workflow Tools — 7.5/10

| Sub-factor | Rating | Notes |
|---|---|---|
| PPD Questionnaire | 8/10 | 45 questions, EN/ES, pain body map, PMD recommendation engine, seating evaluation auto-fill, submission queue. |
| Account Creation | 7.5/10 | PMD + PAP forms with insurance card OCR. Conditional formatting badges. Server-side validation. |
| Email Integration | 7/10 | Gmail SMTP with HTML templates. Header injection prevention. No email retry on SMTP failure. |
| OCR/Extraction | 7.5/10 | Textract + Claude for structured extraction. Templates for PPD, CMN, Prior Auth. Clinical note extraction. |

---

### 5. UI/UX & Design — 7.0/10

| Sub-factor | Rating | Notes |
|---|---|---|
| Visual Design | 7.5/10 | Healthcare blue palette with molecular pattern. 60+ CSS variables for theming. Semantic status colors. |
| Accessibility | 6/10 | ARIA labels on feedback buttons, role="dialog" on modals, focus traps. Missing: skip-to-content link, complete focus-visible styles, WCAG AA color contrast audit, screen reader testing. |
| Responsiveness | 5.5/10 | Inline styles (CSSProperties objects) limit responsive design. No media queries. Nav tabs will overflow on mobile. |
| Performance | 7/10 | Code-split PDF viewer. Memoized functions. 2MB SSE buffer cap. But: no virtualization for long lists. |
| User Experience | 7.5/10 | Streaming SSE, markdown rendering, source citations, confidence badges, collection persistence, idle timeout warning. Toast notifications. |
| Information Architecture | 7/10 | 8 tabs is a lot — could overwhelm new users. |

---

### 6. Scalability & Performance — 6.5/10

| Sub-factor | Rating | Notes |
|---|---|---|
| Horizontal Scaling | 5/10 | Documented but not implemented. In-memory state everywhere. Single-instance only. |
| Database | 7/10 | pgvector with IVFFlat. Connection pooling with timeouts. IVFFlat recall degrades at scale. |
| Caching | 6/10 | In-memory only. No distributed caching. |
| Vector Store | 6/10 | Dual-path (S3 JSON / pgvector). S3 JSON loads entire index into RAM. |

---

## Specific Issues Found

### Critical / High Priority

#### 1. SPA Fallback Serves HTML for Missing API Routes
**File:** `backend/src/server.ts:307`
**Issue:** `app.get('*')` doesn't exclude `/api/*` routes, so a 404 on an API endpoint serves `index.html` instead of JSON error.
**Fix:** Add guard: `if (req.path.startsWith('/api/')) { res.status(404).json({ error: 'Not found' }); return; }`

#### 2. Health Check Uses Dynamic Imports on Every Request
**File:** `backend/src/server.ts:203-233`
**Issue:** `await import(...)` for HeadBucketCommand, s3Client, checkDatabaseConnection on every health check request. Should be imported at module level.

#### 3. ReactMarkdown XSS Surface
**File:** `frontend/src/components/ChatInterface.tsx:375,429`
**Issue:** Raw API response text rendered with ReactMarkdown without `skipHtml={true}` or disallowed elements.
**Fix:** Add `<ReactMarkdown skipHtml={true}>` to prevent raw HTML rendering.

#### 4. Message List Key Anti-Pattern
**File:** `frontend/src/components/ChatInterface.tsx:291`
**Issue:** Conversation array mapped with numeric index as key (`key={i}`). If messages are reordered/inserted, React will incorrectly recycle component state.
**Fix:** Add `id` field to ConversationTurn and use as key.

#### 5. Document Selection Not Reset on Collection Change
**File:** `frontend/src/components/DocumentManager.tsx`
**Issue:** When `selectedCollection` changes, `selectedIds` is not cleared. User can have IDs selected from the old collection, leading to bulk operations on wrong documents.
**Fix:** Add `useEffect(() => setSelectedIds(new Set()), [selectedCollection])`.

#### 6. Medical Synonym Self-Reference
**File:** `backend/src/services/vectorStore.ts:39`
**Issue:** `'hospital bed'` maps to `['hospital bed', ...]` — the key is the same as the first synonym, creating a self-referential entry that wastes processing.

### Medium Priority

#### 7. Query Route Duplication
**File:** `backend/src/routes/query.ts`
**Issue:** ~200 lines of near-identical code between streaming and non-streaming endpoints. Should extract shared pipeline logic.

#### 8. Repeated Mutex Pattern
**Files:** `ingestion.ts`, `audit.ts`, `usage.ts`
**Issue:** Nearly identical mutex lock implementations. Should extract shared `withMutex()` utility.

#### 9. Repeated Fire-and-Forget Pattern
**Multiple files**
**Issue:** `.catch(err => logger.warn('Fire-and-forget operation failed', { error: String(err) }))` repeated verbatim many times. Extract as utility.

#### 10. IDF Rebuild is O(n) on Every Corpus Change
**File:** `backend/src/services/vectorStore.ts`
**Issue:** `buildIdfMap` iterates ALL chunks on every add/remove. For large corpora, consider incremental IDF updates.

#### 11. Audit Log Retrieval is O(n) S3 GETs
**File:** `backend/src/services/audit.ts:170-206`
**Issue:** `getAuditLogs` fetches ALL individual S3 objects sequentially for a date. For high-volume days, very slow.

#### 12. Frontend Token/CSRF Code Duplication
**Files:** `api.ts`, `errorReporting.ts`
**Issue:** `getLegacyToken()` and `getCsrfToken()` defined in both files. Extract to shared utility.

#### 13. Focus Trap Duplication
**Files:** `FeedbackForm.tsx`, `SourceViewer.tsx`
**Issue:** Nearly identical focus trap implementations. Extract to `useFocusTrap()` hook.

#### 14. ChangePasswordForm Hardcoded Colors
**File:** `frontend/src/components/ChangePasswordForm.tsx:87-91`
**Issue:** Password requirement validation uses hardcoded hex colors instead of CSS variables. Doesn't respect dark mode.

#### 15. ConversationTurn Type Safety
**File:** `frontend/src/components/ChatInterface.tsx:160`
**Issue:** Adds `isError: true` property to ConversationTurn that doesn't exist in `types/index.ts`. Type-unsafe cast.

### Low Priority

#### 16. PopoutButton Missing aria-label
**File:** `frontend/src/components/PopoutButton.tsx:22-27`

#### 17. Clipboard API Error Not Handled
**File:** `frontend/src/components/ChatInterface.tsx:344`

#### 18. Silent Collection Load Failure
**File:** `frontend/src/App.tsx:83-90`
**Issue:** Error caught silently with no user feedback.

#### 19. PHI Detection Uses window.confirm()
**File:** `frontend/src/components/ChatInterface.tsx:100-104`
**Issue:** Blocking `window.confirm()` should be replaced with modal dialog.

---

## Future Development Paths (Priority Order)

1. **Redis integration** — Immediately unlocks horizontal scaling. Replace in-memory caches, token revocation, rate limiting, session management.

2. **Medical domain embeddings** — Swap Titan Embed for a medical-specific model. Single highest-impact change for RAG quality.

3. **Evaluation framework** — Build a test set of gold-standard Q&A pairs to measure retrieval quality.

4. **Mobile-responsive UI** — Many UMS employees access this from tablets during patient interactions.

5. **MFA** — Required for true HIPAA compliance in most audits. Add TOTP-based 2FA.

6. **Worker queue** — Replace in-memory job queue with Redis-backed Bull/BullMQ for reliability.

7. **E2E tests** — Add Playwright/Cypress for frontend, supertest for API integration tests.

8. **Document versioning UI** — Backend tracks versions but no frontend version comparison/rollback interface.

9. **Audit log immutability** — S3 Object Lock for compliance-grade audit trail.

10. **Fine-tuned query routing** — Route queries to structured data vs. RAG vs. hybrid for cost optimization.

---

## Rating Summary

| Category | Rating | Priority |
|---|---|---|
| **HIPAA Compliance** | 8.0/10 | 1 (mission-critical) |
| **RAG Functionality** | 7.5/10 | 2 (core value prop) |
| **Overall Quality** | 7.5/10 | 3 |
| **Forms & Workflow** | 7.5/10 | 4 |
| **UI/UX & Design** | 7.0/10 | 5 |
| **Scalability** | 6.5/10 | 6 (important as usage grows) |
