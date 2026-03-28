# Observatory Port Log

Tracks improvements made in UMS Knowledge Reference that are candidates for porting to the multi-tenant [Observatory QA](https://github.com/robinchoudhuryums/observatory-qa) platform. Updated alongside CLAUDE.md and README.md when significant changes land.

## Status Legend
- **Ported** — Applied to Observatory
- **Pending** — Not yet ported, applicable to Observatory
- **N/A** — UMS-specific, not applicable to Observatory

---

## Security

| Improvement | UMS Commit/Date | Observatory Status | Notes |
|---|---|---|---|
| SSRF prevention utility (`urlValidation.ts`) | 2026-03-28 | **Ported** | Applied to SSO OIDC, ref doc URLs, SIEM webhooks. Still needed on: notifications.ts webhooks, EHR adapter base URLs, admin settings URL writes. |
| HTML escaping in email templates (`htmlEscape.ts`) | 2026-03-28 | N/A | Observatory already had `escapeHtml()` in email.ts |
| CRLF injection prevention in email subjects | 2026-03-28 | **Ported** | `options.subject.replace(/[\r\n]/g, '')` in email.ts |
| CSRF timing-safe comparison | 2026-03-28 | **Ported** | `timingSafeEqual` replaces `===` in CSRF check |
| Account lockout timing disclosure prevention | 2026-03-28 | **Ported** | Generic error for lockout vs invalid creds |
| JWT `jti` collision prevention (`crypto.randomUUID()`) | 2026-03-28 | N/A | Observatory uses session-based auth, not JWT |
| CORS wildcard-with-credentials validation | 2026-03-28 | N/A | Observatory doesn't use CORS (single-origin) |
| Rate limiting on query endpoints | 2026-03-28 | N/A | Observatory already has comprehensive rate limiting |
| `requireAdmin` on PPD status update | 2026-03-28 | N/A | UMS-specific endpoint |
| Prompt injection detection (15 patterns) | 2026-03-28 | **Ported** | `ai-guardrails.ts`, integrated into RAG search |
| Output guardrails (prompt leakage, role deviation) | 2026-03-28 | **Ported** | `ai-guardrails.ts`, not yet wired into call analysis output |
| Frontend idle timeout (15min + 2min warning) | 2026-03-28 | **Ported** | `useIdleTimeout` hook + overlay component |
| Embedding dimension validation | 2026-03-28 | **Ported** | Validates 1024-dim response from Titan |

## RAG Quality

| Improvement | UMS Commit/Date | Observatory Status | Notes |
|---|---|---|---|
| BM25 with IDF weighting | 2026-03-28 | **Ported** | Optional `corpusSize` + `documentFrequencies` params |
| Dynamic BM25 normalization | 2026-03-28 | **Ported** | Computed from actual candidate chunk lengths |
| Re-ranking pipeline (header boost, noise penalty) | 2026-03-28 | **Ported** | +15% section header match, -10% short chunks |
| Medical-term-aware tokenizer | 2026-03-28 | **Ported** | Generalized: preserves ICD-10, CPT, CDT, HCPCS, 26 short clinical abbreviations |
| Blended confidence scoring (60% top + 40% avg) | 2026-03-28 | **Ported** | `computeConfidence()` with 4 levels |
| Conversation history validation (20 turns, 50K chars) | 2026-03-28 | **Ported** | `validateConversationHistory()` exported but not yet wired into call analysis |
| NaN guards on combined retrieval scores | 2026-03-28 | **Ported** | Falls back to semantic-only score |
| Prompt caching on Bedrock calls | 2026-03-28 | **Ported** | `cachePoint` on system prompt blocks, cache hit/miss logging |
| Content-hash deduplication (rejects identical uploads) | 2026-03-28 | **Pending** | Prevents duplicate docs in same collection/org |
| Embedding model abstraction (`EmbeddingProvider` interface) | 2026-03-28 | **Pending** | Allows swapping embedding models without code changes |
| Table preservation in chunker | 2026-03-28 | **Pending** | Detects and preserves table structures during chunking |
| Usage rollback on failed queries | 2026-03-28 | **Pending** | Decrements usage count if AI call fails after recording |

## HIPAA / Compliance

| Improvement | UMS Commit/Date | Observatory Status | Notes |
|---|---|---|---|
| Audit log hash chain (SHA-256, tamper-evident) | 2026-03-28 | N/A | Observatory already has this |
| PHI redaction utility (`phiRedactor.ts`) | 2026-03-28 | **Ported** | SSN, phone, email, DOB, MRN, Medicare/Medicaid, addresses. Clinical code exclusion. |
| Deep PHI redaction on audit log detail field | 2026-03-28 | **Ported** | `redactPhi()` applied in `logPhiAccess()` |
| Data retention with HIPAA minimum floors | 2026-03-28 | N/A | Observatory already has 7-year retention |
| PHI scanning in RAG responses (log warning + flag) | 2026-03-28 | **Pending** | Scan AI output for PHI before returning to client |
| Reformulated query + conversation history redaction in traces | 2026-03-28 | **Pending** | Redact PHI from RAG trace logs |

## Observability

| Improvement | UMS Commit/Date | Observatory Status | Notes |
|---|---|---|---|
| Per-request correlation IDs (AsyncLocalStorage) | 2026-03-28 | **Ported** | `correlation-id.ts` middleware, auto-injected into Pino |
| Structured JSON logging with correlation IDs | 2026-03-28 | **Ported** | Pino mixin function |
| Per-route request metrics (p50/p95/p99) | 2026-03-28 | **Ported** | `request-metrics.ts`, exported via `/api/health/metrics` |
| RAG observability tracing (per-query scores, timing) | 2026-03-28 | **Pending** | Per-query trace logging with retrieval scores, confidence, timing breakdown |
| Quality metrics dashboard (confidence distribution) | 2026-03-28 | **Pending** | Frontend dashboard for RAG query quality tracking |
| FAQ analytics (pattern detection from query logs) | 2026-03-28 | **Pending** | Detects frequently asked questions for knowledge base gaps |

## UMS-Specific (Not Applicable to Observatory)

These features are specific to the DME/medical supply domain and won't be ported:

- HCPCS code lookup (332 codes, 25 categories)
- ICD-10 to HCPCS crosswalk (66 diagnosis codes, 116+ mappings)
- LCD coverage checklists (8 CMS LCDs)
- Structured reference enrichment (auto-inject HCPCS/ICD-10 into RAG)
- PPD questionnaire and PMD recommendation engine
- Seating evaluation auto-fill
- CMN form analysis and rules
- Fee schedule fetcher
- Insurance card OCR

---

## How to Use This File

1. **When making improvements to UMS**: Add a row to the appropriate table with status **Pending**.
2. **When porting to Observatory**: Update status to **Ported** and add implementation notes.
3. **During CLAUDE.md updates**: Review this file and add any missing entries.
4. **When planning Observatory work**: Filter for **Pending** items to find the next batch.
