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
| Unicode normalization in injection detection | 2026-03-31 | **Pending** | Cyrillic look-alike character mapping before regex matching |
| Conversation history injection validation | 2026-03-31 | **Pending** | User turns in history checked for injection before inclusion |
| SSL cert validation default true | 2026-03-31 | N/A | Observatory uses managed DB with valid certs |
| Malware scan fail-closed on ClamAV unreachable | 2026-04-15 | **Pending** | `utils/malwareScan.ts` throws `MalwareScanUnavailableError` instead of silently passing. Pattern: MALWARE_SCAN_FAIL_CLOSED env var default `true`, operational alert on unavailability, time-boxed 60s availability cache (INV-29) |
| MFA recovery code TOCTOU fix (per-user login mutex) | 2026-04-15 | **Pending** | Per-username `createMutex()` serializes read-modify-save of user state during login so concurrent attempts can't both consume the same recovery code. In-process only; multi-instance needs Redis. Applicable to any auth system with single-use codes (INV-28) |
| Session-expired event (no-reload logout) | 2026-04-15 | **Pending** | Frontend pattern: dispatch `SESSION_EXPIRED_EVENT` instead of `window.location.reload()` when refresh fails. Preserves React state and in-memory work. `useAuth` listens and transitions to LoginForm |

## RAG Quality

| Improvement | UMS Commit/Date | Observatory Status | Notes |
|---|---|---|---|
| BM25 with IDF weighting | 2026-03-28 | **Ported** | Optional `corpusSize` + `documentFrequencies` params |
| Dynamic BM25 normalization | 2026-03-28 | **Ported** | Computed from actual candidate chunk lengths |
| Re-ranking pipeline (header boost, noise penalty) | 2026-03-28 | **Ported** | +15% section header match, -10% short chunks |
| Medical-term-aware tokenizer | 2026-03-28 | **Ported** | Generalized: preserves ICD-10, CPT, CDT, HCPCS, 26 short clinical abbreviations |
| Blended confidence scoring (60% top + 40% avg) | 2026-03-28 | **Ported** | `computeConfidence()` with 4 levels |
| Conversation history validation (20 turns, 50K chars) | 2026-03-28 | **Ported** | `validateConversationHistory()` exported but not yet wired into call analysis |
| IDF cache invalidation fix (version increment) | 2026-03-31 | **Pending** | `removeDocumentChunks` must increment idfVersion, not just null cache |
| Minimum score threshold (0.1) | 2026-03-31 | **Pending** | Filter out noise results below relevance threshold |
| Embedding cache key includes model ID | 2026-03-31 | **Pending** | Auto-invalidates cache on model change |
| FormAnalyzer polling/pagination separation | 2026-03-31 | **Pending** | Prevents infinite loop from attempt-- on pagination |
| NaN guards on combined retrieval scores | 2026-03-28 | **Ported** | Falls back to semantic-only score |
| Prompt caching on Bedrock calls | 2026-03-28 | **Ported** | `cachePoint` on system prompt blocks, cache hit/miss logging |
| Content-hash deduplication (rejects identical uploads) | 2026-03-28 | **Ported** | SHA256 hash check in onboarding.ts before createReferenceDocument |
| Embedding model abstraction (`EmbeddingProvider` interface) | 2026-03-28 | **Ported** | `embedding-provider.ts` interface + `TitanEmbeddingProvider` in embeddings.ts |
| Table preservation in chunker | 2026-03-28 | **Ported** | `detectTable()` in chunker.ts, pipe/tab/separator detection, 2x size allowance |
| Usage rollback on failed queries | 2026-03-28 | **Ported** | Negative quantity trackUsage in postProcessing when call status is failed |
| Gold-standard RAG eval harness (JSON dataset + CI runner) | 2026-04-15 | **Pending** | `evalData/goldStandardRag.json` (51 pairs) + `scripts/evalRag.ts` emits JUnit XML / results.json with configurable recall/MRR thresholds. Scoring logic testable without Bedrock via `goldStandardEval.test.ts` |
| Full-lifecycle ingestion test (real chunker + rollback) | 2026-04-15 | **Pending** | `__tests__/ingestionLifecycle.test.ts` — exercises real chunker, asserts INV-07 rollback + INV-08 content-hash dedup with only S3/Bedrock stubbed |
| Prompt caching coverage extended (Converse API + rerank + A/B) | 2026-04-15 | **Pending** | Closes INV-05 gap: `cachePoint` on Bedrock Converse (vision extractor), `cache_control` lifted to system block in cross-encoder rerank, `cache_control` on A/B test system prompts |

## HIPAA / Compliance

| Improvement | UMS Commit/Date | Observatory Status | Notes |
|---|---|---|---|
| Audit log hash chain (SHA-256, tamper-evident) | 2026-03-28 | N/A | Observatory already has this |
| PHI redaction utility (`phiRedactor.ts`) | 2026-03-28 | **Ported** | SSN, phone, email, DOB, MRN, Medicare/Medicaid, addresses. Clinical code exclusion. |
| Deep PHI redaction on audit log detail field | 2026-03-28 | **Ported** | `redactPhi()` applied in `logPhiAccess()` |
| Data retention with HIPAA minimum floors | 2026-03-28 | N/A | Observatory already has 7-year retention |
| PHI scanning in RAG responses (log warning + flag) | 2026-03-28 | **Ported** | `scanAndRedactOutput()` in rag.ts, integrated into call-processing.ts RAG context |
| Reformulated query + conversation history redaction in traces | 2026-03-28 | **Ported** | `redactPhi()` applied to queryTextRedacted in all RAG trace logs |
| Human-in-the-loop extraction correction store | 2026-04-15 | **Pending** | Append-only S3 record of reviewer per-field corrections + overall quality rating. Pattern applies to any LLM extraction: `services/extractionFeedback.ts`, admin aggregate stats endpoint surfaces accuracy + overconfidence rates |
| Source staleness audit + operational alerting | 2026-04-15 | **Pending** | Distinguishes "healthy + unchanged" from "broken upstream" — `auditStaleSources()` runs daily, alerts via existing alertService with 24h per-source throttle when `lastContentChangeAt` is older than configured `expectedUpdateCadenceDays` |
| Server-side form drafts (cross-device partial save/resume) | 2026-04-15 | **Pending** | `services/formDrafts.ts` + `/api/form-drafts/*` endpoints. User-scoped ACL on load, 2MB payload guard. Frontend hook `useFormDraft` with debounced 2s auto-save. Generalizable to any long form workflow |

## Observability

| Improvement | UMS Commit/Date | Observatory Status | Notes |
|---|---|---|---|
| Per-request correlation IDs (AsyncLocalStorage) | 2026-03-28 | **Ported** | `correlation-id.ts` middleware, auto-injected into Pino |
| Structured JSON logging with correlation IDs | 2026-03-28 | **Ported** | Pino mixin function |
| Per-route request metrics (p50/p95/p99) | 2026-03-28 | **Ported** | `request-metrics.ts`, exported via `/api/health/metrics` |
| RAG observability tracing (per-query scores, timing) | 2026-03-28 | **Ported** | `rag-trace.ts` with per-query timing (embedding/retrieval/rerank), scores, confidence |
| Quality metrics dashboard (confidence distribution) | 2026-03-28 | **Pending** | Frontend dashboard — backend data available via rag-trace + faq-analytics |
| FAQ analytics (pattern detection from query logs) | 2026-03-28 | **Ported** | `faq-analytics.ts` with normalize/group/gap detection, endpoint at /api/health/faq-analytics |

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
