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
| Admin-role-grant operational alert | 2026-04-16 | **Pending** | `createUserHandler` + `updateUserRole` fire `admin_role_granted` alert whenever a user gains admin role. Portable to any RBAC system where privilege escalation is a key detective control. Throttled per-category (1/hr); audit log captures every event (L2) |
| Document-size guard at ingestion + S3 fetch | 2026-04-16 | **Pending** | 100MB cap at `ingestDocument()` entry (service-account uploads bypass multer). `getDocumentFromS3()` HEADs first + stream-length fallback. Prevents OOM on large payloads from untrusted integrations (M12) |
| Rate-limit key resolution (no 'unknown' pooling) | 2026-04-16 | **Pending** | `utils/rateLimitKey.ts` `resolveRateLimitKey(req)` replaces `req.ip \|\| 'unknown'` fallbacks. Resolution ladder: user.id → req.ip → SHA-256(XFF + User-Agent) → per-request UUID. Distinct clients never pool into one bucket even on misconfigured trust-proxy. Throttled warn on fallback (INV-30, H3) |
| CSRF exempt list exact-match | 2026-04-16 | **Pending** | Prefix-match (`startsWith`) on CSRF exemptions is a trap door — `/api/auth/login-sso` would silently inherit `/api/auth/login`'s exemption. Use exact-equality array lookup instead (H1, INV-11) |
| Zero-width / invisible character stripping in prompt-injection detector | 2026-04-16 | **Pending** | Strip U+200B-200D, U+FEFF, U+2060, U+00AD, U+180E, U+2061-2064 BEFORE NFKD normalization. Defeats `ign\u200Bore all previous instructions` bypasses where Claude reads the full phrase but the regex fails on literal tokens (INV-21, H4) |
| Unicode-aware patient name redaction | 2026-04-16 | **Pending** | Name regex uses `\p{Lu}[\p{L}'\-\.]+` with `u` flag (no `i` — it case-folds `\p{Lu}`). Prefix keywords handled via explicit `[Pp]atient` alternation. Catches Spanish/Portuguese accents, Irish apostrophes, French hyphens, middle initials. Imported pattern for any PHI scrubber (M1) |
| Error report URL scrub (frontend) | 2026-04-16 | **Pending** | `safeLocationHref()` returns `${origin}${pathname}` only — strips query and hash. Query strings routinely carry PHI (`?patientId=123`); hash fragments sometimes do. Apply everywhere a URL ships to error tracking / Sentry (M9) |
| SSO MFA gate on introspection bootstrap | 2026-05-07 | **Pending** | `middleware/sso.ts` refuses to mint a local session when upstream IdP reports `mfaVerified !== true`. Closes a path where, with native MFA disabled, the SSO bootstrap could silently accept a session that hadn't completed MFA at the IdP. Applies to any introspection-style SSO where the IdP returns an MFA flag (F1) |
| perUserLimiter signature verification | 2026-05-07 | **Pending** | `server.ts` keyGenerator runs before auth middleware, so it has to derive a key from the raw token. Calling `verifyToken()` (full signature check) instead of base64-decoding the payload closes a targeted-DoS vector where a forged Bearer with `{id: "victim"}` could pool into the victim's rate-limit bucket. Falls back to `resolveRateLimitKey(req)` on verify failure (F5, INV-30 spirit) |
| logRagFeedback PHI redaction (split-path symmetry) | 2026-05-07 | **Pending** | When the same user-typed `notes` field flows through two persistence paths and only one redacts, the unredacted path becomes the leak. Audit any place where saveX redacts but logX doesn't and vice versa (F2 / INV-02). Direct port to any service splitting between user-facing storage and observability traces |
| Query route logger PHI redaction | 2026-05-07 | **Pending** | `routes/query.ts` `logger.info('Query reformulated', ...)` and `logger.info('… query received', ...)` now wrap question/reformulated text with `redactPhi`. Audit + trace persistence already redacted; this closed the last unredacted log path in the RAG hot path. Highest-volume PHI leak per query (F3) |
| Vision/OCR partial-failure warnings on document | 2026-05-07 | **Pending** | Extractors that can produce partial output (`visionExtractor`, `textExtractor.extractPdf`) return `{text, warnings}` instead of bare string. `ingestion.ts` collects warnings and stamps them on `Document.extractionWarnings`; UI renders an amber `⚠ N` badge so users see when a "ready" document is missing image/page content. Migration 012 adds `extraction_warnings TEXT[]` (F9) |
| chunks.content_hash column + embedding reuse | 2026-05-07 | **Pending** | The reuse-existing-embedding-on-duplicate-chunk SELECT was failing silently because the column referenced by ingestion.ts didn't exist on the schema. Migration 011 + INSERT plumbing closes the cost leak. Lesson worth porting: don't trust silent `try/catch` around an SELECT — instrument cache-hit metrics so a 0% hit rate is visible (F4) |
| Audit chain S3 fallback recovery window | 2026-05-07 | **Pending** | `recoverHashChain` scans back N days (default 30, env: `AUDIT_CHAIN_RECOVERY_DAYS`) instead of just today + yesterday. When older entries exist beyond the window, fires `audit_chain_fork` operational alert before falling back to GENESIS so multi-day downtime in S3-only mode doesn't silently fork the chain. DB-backed path (SELECT FOR UPDATE on chain head) takes precedence when available (F6) |
| Gold-standard RAG eval — scheduled CI workflow | 2026-05-07 | **Pending** | `.github/workflows/eval-rag.yml` runs the harness weekly + on demand against the live index. Uploads junit.xml/results.json. Not a deploy gate yet — separate signal channel. Pattern: scheduled retrieval-quality smoke test independent of the main CI / deploy gate, with adjustable thresholds via `workflow_dispatch` inputs |
| ClamAV PING NUL-handling fix | 2026-05-14 | N/A | UMS-specific. Observatory doesn't run malware scanning on its inputs (call transcripts come from AssemblyAI, not user uploads). Worth keeping the pattern in mind if Observatory ever adds an upload path: ClamAV's `z`-prefixed protocol returns NUL-terminated responses (`PONG\0`), and `String.prototype.trim()` does NOT strip NULs. Equality checks need an explicit `.replace(/\0/g, '')`. |
| `ensureDefaultCollection` startup-seeder pattern | 2026-05-14 | **Pending** | When a UI literal (`'default'`) is referenced by both a fallback and an FK-enforced column, seed the row at startup *after* the user-creating step (so the FK on `created_by → users(id)` resolves). Idempotent + deterministic creator selection (lowest-id admin) survives reboots. Plus lazy re-ensure on the write path for the case where someone deletes the seeded row. Observatory may have analogous "default workspace" or "default queue" rows worth seeding similarly. |
| user.id-vs-username FK bug class | 2026-05-14 | **Pending — audit Observatory writers** | Four UMS route writers passed `req.user!.username` to columns FK'd to `users(id)`. Silent in dev (no FK enforcement) and on the S3-only path; failed every insert once RDS enforced the constraints. Worth scanning Observatory for the same pattern: every column FK'd to users(id) — likely `documents`, `submissions`, `audit_logs`, anything with a `*_by` suffix — should be written from `req.user.id`, not `req.user.username`. Locked down in UMS by new INV-38. The safe-pattern is `logAuditEvent(req.user.id, req.user.username, …)` — id flows to FK columns, username flows to display fields. |

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
| PDF info-dictionary metadata stripping | 2026-04-16 | **Pending** | `stripPdfMetadata()` via `pdf-lib` clears /Author, /Creator, /Producer, /Title, /Subject, /Keywords before storage. `stripDocumentMetadata` dispatcher routes images + PDFs. Preserves visible content byte-identically. Generalizable to any HIPAA-adjacent upload path (M10) |
| Per-state-machine-record mutex (admin-workflow queue) | 2026-04-16 | **Pending** | Same pattern as the MFA-recovery lock but keyed by record ID instead of user. Applied to `updatePpdStatus` so two admins racing on the same submission ID cannot both pass validation + save. In-process only; multi-instance needs Redis. Reusable anywhere a read-modify-write state transition touches shared S3/DB state (H6, INV-31) |
| Job queue persist on state transition | 2026-04-16 | **Pending** | Debounced periodic S3 persists silently lose jobs if a crash lands in the debounce window. Pattern: add `persistNow()` that fires immediately on create + every status transition; keep debounce only for progress updates. Applies to any S3-backed async queue (M7) |
| OOXML (DOCX/XLSX/PPTX) metadata stripping via jszip | 2026-04-16 | **Pending** | Opens OOXML as ZIP, replaces `docProps/core.xml` + `docProps/app.xml` with empty-field XML, re-zips. Clears dc:creator, cp:lastModifiedBy, Company, Manager, etc. Preserves all document body entries. Portable pattern for any system accepting Office uploads with PHI in metadata |
| Index-based data-retention sweep | 2026-04-16 | **Pending** | Standard retention cleanup parses YYYY-MM-DD from S3 keys. Form drafts use an index file with `updatedAt` timestamps instead. Pattern: load index → filter by cutoff → delete S3 objects → save pruned index. Portable to any queue/store where the key doesn't embed a date (e.g., job queues, submission queues). HIPAA floor enforced via Math.max (30 days minimum) |

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
