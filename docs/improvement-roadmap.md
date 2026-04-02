# UMS Knowledge Base — Improvement Roadmap

**Last updated:** 2026-04-02
**Based on:** Comprehensive audit of 48K+ lines, 861 tests, 54 files

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
- [x] Auth.ts split into 3 modules (authConfig, tokenService, auth)
- [x] Database startup retry (3x exponential backoff)
- [x] Bedrock circuit breaker
- [x] Redis integration (token revocation, rate limiting, embedding cache)
- [x] TOTP MFA with recovery codes
- [x] OpenTelemetry tracing
- [x] MFA recovery codes (10 one-time XXXX-XXXX codes)
- [x] MFA secret encrypted at rest (AES-256-GCM)
- [x] Prompt injection fuzzer tests (Unicode homoglyphs, delimiter evasion, false positive prevention)
- [x] Admin user management UI panel
- [x] Forgot password self-service email flow with direct user delivery
- [x] User email field for password resets
- [x] S3-backed product images (migrated from jsDelivr CDN)
- [x] Admin product image upload/manage panel
- [x] RAG product image integration (auto-detect HCPCS codes → show product images)
- [x] Admin usage limits UI panel
- [x] Per-user response style toggle (Brief/Detailed/Full)
- [x] Favicon (SVG brain icon)
- [x] Multi-instance audit chain coordination (DB-backed SELECT FOR UPDATE)
- [x] Forms glassmorphism styling + dark mode header text fixes
- [x] Progress circle cards + SVG fill fix
- [x] PPD Queue restructured into per-form sub-pages
- [x] Tab consolidation (8→5 tabs)
- [x] WCAG AA color contrast fixes
- [x] Helmet CSP configured for production
- [x] Temp password entropy increased (128-bit)
- [x] CSRF cookie parser centralized
- [x] CI coverage thresholds raised (60/50/50%)
- [x] CI xmldom vulnerability exempted
- [x] 861 tests across 54 files

---

## P2 — Improve Soon

### Testing
- [ ] **Add remaining service unit tests** (12 untested services) — formAnalyzer, insuranceCardReader, pdfAnnotator, queryLog, reindexer, sourceMonitor, visionExtractor, feeScheduleFetcher, titanEmbeddingProvider
- [ ] **E2E tests with Playwright** — browser-level tests for login → MFA → chat → document upload → admin flows
- [ ] **MFA integration tests** — full setup → verify → login with code → recovery code → disable flow via supertest

### Security
- [ ] **CSRF token rotation** — rotate on each state-changing request instead of 24h TTL
- [ ] **MFA setup QR code display** — render otpauth URI as QR code in browser for easy scanning

### Code Quality
- [ ] **Shared constants package** — frontend hardcodes password min length, lockout timing. Share via API config endpoint
- [ ] **Remove Proxy pattern in cache/index.ts** — direct getCache()/getSets() calls are cleaner
- [ ] **Type-safe route params** — use zod for runtime validation of req.body/req.params

### Architecture
- [ ] **Extend product image resolver** to non-PMD categories (oxygen, CPAP, beds, etc.)
- [ ] **Event-driven audit logging** — middleware pattern instead of importing logAuditEvent into every handler
- [ ] **Background job processing** — migrate from in-memory job queue to Bull/BullMQ (Redis now available)

---

## P3 — Long-Term

### RAG Quality
- [ ] **Cross-encoder re-ranking** — replace heuristic reRankResults() with learned MiniLM model
- [ ] **Multi-document summarization** — synthesize answers spanning many sources
- [ ] **Answer grounding verification** — post-generation check that citations support claims
- [ ] **Confidence calibration from feedback** — use thumbs-up/down data to tune thresholds

### Scalability
- [ ] **HNSW index for pgvector** — better recall than IVFFlat as corpus grows past 50K chunks
- [ ] **Worker queue (Bull/BullMQ)** — replace in-memory job queue for document ingestion
- [ ] **Horizontal auto-scaling** — ECS/Fargate with ALB
- [ ] **CDN for static assets** — CloudFront in front of frontend build

### Security Hardening
- [ ] **Audit log immutability** via S3 Object Lock (WORM mode)
- [ ] **SSO/OIDC integration** for enterprise single sign-on
- [ ] **IP allowlisting** for admin endpoints
- [ ] **WAF rules** — AWS WAF for DDoS and bot protection

### UI/UX
- [ ] **Onboarding flow** for new users
- [ ] **Keyboard shortcuts** — Ctrl+K for search, Escape for modals
- [ ] **Document versioning UI** — frontend version comparison and rollback
- [ ] **Skeleton loading** on all data-fetching components

### Observability
- [ ] **Grafana/CloudWatch dashboard** — pre-built panels for latency, error rate, RAG quality
- [ ] **CloudWatch alarms** — automated alerts on error rate spikes
- [ ] **Per-query Bedrock cost estimation** in traces

---

## Metrics Tracking

| Metric | Current | Target |
|---|---|---|
| Test count | 861 | 1000+ |
| Test files | 54 | 65+ |
| Line coverage | ~60% | 75%+ |
| Branch coverage | ~50% | 65%+ |
| CI thresholds | 60/50/50% | 70/60/60% |
| Auth test coverage | ~75% | 90%+ |
| PHI redactor coverage | ~85% | 95%+ |

---

## Post-Deploy Checklist

After merging to main and deploying:

1. **Run product image migration** (one-time):
   ```bash
   cd backend && env $(cat ~/ums-knowledge.env | grep -v '^#' | xargs) npx tsx src/scripts/migrateProductImages.ts
   ```

2. **Set FIELD_ENCRYPTION_KEY** for MFA secret encryption:
   ```bash
   echo "FIELD_ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")" >> ~/ums-knowledge.env
   ```

3. **Upload knowledge base documents** via the Documents tab

4. **Set user emails** in Admin → User Management for password reset delivery

5. **Set up MFA** for admin accounts via the login flow
