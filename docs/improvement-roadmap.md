# UMS Knowledge Base — Improvement Roadmap

**Last updated:** 2026-04-01
**Based on:** Comprehensive audit of 44K+ lines, 788 tests, 51 files

---

## Completed (This Sprint)

### P0 — Fixed Immediately
- [x] MFA fields (mfa_secret, mfa_enabled) missing from PostgreSQL layer — settings silently lost
- [x] Migration 005 adds columns, dbSaveUsers/dbGetUsers updated

### P1 — Fixed This Sprint
- [x] Admin MFA reset endpoint (DELETE /api/users/:id/mfa)
- [x] MFA audit trail for HIPAA (setup, verify, disable events logged)
- [x] Test mocks updated for auth.ts audit import chain
- [x] Collection ACL enforced on 5 document endpoints
- [x] SSRF redirect validation in source monitor
- [x] Email error messages no longer leaked to clients
- [x] reset-admin.ts SSL validation
- [x] Query pipeline deduplicated (runQueryPipeline)
- [x] Auth.ts split into 3 modules
- [x] Database startup retry (3x exponential backoff)
- [x] Bedrock circuit breaker
- [x] Redis integration (token revocation, rate limiting, embedding cache)
- [x] TOTP MFA
- [x] OpenTelemetry tracing
- [x] 788 tests across 51 files

---

## P2 — Improve Soon

### Security
- [ ] **Rate-limit MFA verification attempts** separately from login (currently shares the login lockout counter but not a dedicated MFA rate limit)
- [ ] **Encrypt mfa_secret at rest** — currently stored as plaintext base32 in database. Should use application-layer encryption with a KMS-managed key
- [ ] **MFA recovery codes** — currently no backup if authenticator is lost (admin must manually disable). Generate 10 one-time recovery codes during MFA setup
- [ ] **CSRF token rotation** — current CSRF token persists for 24h. Consider rotating on each state-changing request
- [ ] **Helmet CSP in production** — currently `undefined` (uses helmet defaults). Should configure explicit Content-Security-Policy

### Code Quality
- [ ] **Extract frontend shared utilities** — `useFocusTrap` hook from FeedbackForm/SourceViewer, token/CSRF helpers from api.ts/errorReporting.ts
- [ ] **Remove Proxy pattern in cache/index.ts** — the `cache` and `sets` proxy exports add complexity; direct `getCache()`/`getSets()` calls are cleaner
- [ ] **Consistent error response format** — some routes return `{ error: string }`, others `{ error: string, details: ... }`. Standardize.
- [ ] **Type-safe route params** — use zod or similar for runtime validation of req.body/req.params instead of manual checks

### Architecture
- [ ] **Shared types package** — frontend/backend types diverge (frontend User has `mfaEnabled?`, backend has `mfaSecret`/`mfaEnabled`). Extract shared types to a common package or generate from OpenAPI spec
- [ ] **Event-driven audit logging** — current pattern imports `logAuditEvent` into every handler. Consider an EventEmitter or middleware pattern
- [ ] **Background job processing** — migrate from in-memory job queue to Bull/BullMQ (depends on Redis, which is now available)

### Testing
- [ ] **MFA integration tests** — setup → verify → login with code → disable flow not yet covered by supertest tests
- [ ] **Redis cache integration tests** — verify cache/sets behavior with Redis (currently only tests in-memory provider)
- [ ] **E2E with Playwright** — browser-level tests for login flow, chat, document upload
- [ ] **Critical path coverage** — aim for 90%+ on auth, PHI redaction, data retention modules

---

## P3 — Long-Term

### Scalability
- [ ] **HNSW index for pgvector** — better recall than IVFFlat as corpus grows past 50K chunks
- [ ] **Worker queue (Bull/BullMQ)** — replace in-memory job queue for document ingestion, extraction
- [ ] **Horizontal auto-scaling** — ECS/Fargate with ALB, leveraging Redis for shared state
- [ ] **CDN for static assets** — CloudFront in front of the frontend build

### RAG Quality
- [ ] **Cross-encoder re-ranking** — replace heuristic `reRankResults()` with a learned MiniLM model
- [ ] **Multi-document summarization** — synthesize answers spanning many sources
- [ ] **Answer grounding verification** — post-generation check that citations support claims
- [ ] **Confidence calibration from feedback** — use thumbs-up/down data to tune score thresholds

### Security Hardening
- [ ] **Field-level encryption** for PHI in database (SSN, DOB, member ID columns)
- [ ] **Audit log immutability** via S3 Object Lock (WORM mode)
- [ ] **SSO/OIDC integration** for enterprise single sign-on
- [ ] **IP allowlisting** for admin endpoints
- [ ] **WAF rules** — AWS WAF in front of ALB for DDoS and bot protection

### UI/UX
- [ ] **Onboarding flow** — first-time user walkthrough
- [ ] **Keyboard shortcuts** — Ctrl+K for search, Escape for modals
- [ ] **Document versioning UI** — frontend for version comparison and rollback
- [ ] **MFA setup UI** — QR code display, recovery code download
- [ ] **Mobile-native improvements** — touch gestures, swipe between tabs

### Observability
- [ ] **Grafana dashboard** — pre-built panels for latency, error rate, RAG quality
- [ ] **CloudWatch alarms** — automated alerts on error rate spikes, health check failures
- [ ] **Cost tracking** — per-query Bedrock cost estimation in traces

---

## Metrics Tracking

| Metric | Current | Target |
|---|---|---|
| Test count | 788 | 1000+ |
| Test files | 51 | 60+ |
| Line coverage | ~60% | 75%+ |
| Branch coverage | ~50% | 65%+ |
| CI thresholds | 60/50/50% | 70/60/60% |
| Auth test coverage | ~70% | 90%+ |
| PHI redactor coverage | ~85% | 95%+ |
