# UMS Knowledge Base — Development Roadmap

**Last updated:** 2026-04-04
**Reference:** See `AUDIT_REPORT.md` for full audit findings and ratings.

---

## Sprint 1: Code Quality & Performance (Current)

### Completed
- [x] SPA fallback returns JSON 404 for unmatched API routes
- [x] Document selection resets on collection change
- [x] Medical synonym self-reference removed
- [x] Health check uses top-level imports (perf)
- [x] ConversationTurn.isError type safety
- [x] PopoutButton aria-label, ChangePasswordForm CSS variables
- [x] Source monitor SSRF prevention on redirects
- [x] Data retention date rollover fix
- [x] HTML entity Unicode decoding fix (fromCodePoint)
- [x] Collection ACL on 5 document endpoints
- [x] topK nullish coalescing fix
- [x] reset-admin.ts SSL validation
- [x] Email error message leak prevention

### Remaining This Sprint
- [x] **Extract shared query pipeline** — `processPostGeneration()` deduplicates ~56 lines between streaming/non-streaming endpoints
- [x] **ReactMarkdown XSS** — `skipHtml={true}` already present on both ChatInterface instances (verified)
- [ ] **Extract shared mutex utility** — `withMutex()` from repeated patterns in `ingestion.ts`, `audit.ts`, `usage.ts`
- [ ] **IDF rebuild optimization** — incremental updates instead of O(n) full rebuild on every corpus change
- [ ] **Audit log retrieval** — batch S3 GETs or use database for audit storage to avoid O(n) sequential reads
- [ ] **Frontend code duplication** — extract shared `useFocusTrap()` hook, shared auth utilities from `api.ts`/`errorReporting.ts`
- [ ] **Message list keys** — add `id` field to ConversationTurn, use as React key instead of array index

### Bug Fixes (April 2026 audit)
- [x] **useAuth.ts JSON.parse crash** — corrupted localStorage crashed the app on mount
- [x] **ChatInterface useEffect dependency** — `[selectedCollections]` → `[responseStyle]`
- [x] **auth.ts silent audit failure** — MFA recovery code audit log failure now logged
- [x] **Duplicate migration 004** — removed conflicting `004_add_foreign_keys.sql`

---

## Sprint 2: RAG Quality Improvements

### Medical Domain Embeddings
- [ ] **Evaluate medical embedding models** — benchmark MedCPT, BioLORD-2023, PubMedBERT against Titan Embed V2 on UMS-specific queries
- [ ] **Implement EmbeddingProvider for chosen model** — leverage existing `EmbeddingProvider` interface for swap
- [ ] **Re-index existing documents** — one-time migration to new embeddings
- [ ] **A/B comparison** — run parallel retrieval with old vs new embeddings to measure quality delta
- [ ] **Update dimension config** — different models may use different dimensions (768 vs 1024)

### Retrieval Quality
- [ ] **Cross-encoder re-ranking** — replace heuristic re-ranking with learned cross-encoder (e.g., MS MARCO MiniLM)
- [ ] **Query routing** — classify queries as structured-data-only, RAG, or hybrid to reduce unnecessary LLM calls
- [ ] **Chunk deduplication** — detect near-identical chunks from overlapping documents using SimHash/MinHash
- [ ] **Retrieval evaluation framework** — build gold-standard Q&A test set (50+ pairs), automate recall@K and MRR measurement
- [ ] **HNSW index migration** — switch pgvector from IVFFlat to HNSW for better recall at scale

### Generation Quality
- [ ] **Multi-document summarization** — for queries spanning many sources, synthesize a coherent summary
- [ ] **Answer grounding verification** — post-generation check that cited sources actually support claims
- [ ] **Confidence calibration** — fine-tune score thresholds based on actual user feedback data

---

## Sprint 3: HIPAA & Security Hardening

### Completed (April 2026 audit — ported from CallAnalyzer)
- [x] **WAF middleware** — `backend/src/middleware/waf.ts`: 13 SQLi + 13 XSS + 7 path traversal + 4 CRLF patterns, IP blocklist, anomaly scoring
- [x] **Incident response plan** — `backend/src/services/incidentResponse.ts`: HIPAA §164.308, 7-phase lifecycle, escalation contacts
- [x] **HMAC audit chain upgrade** — `backend/src/services/audit.ts`: SHA-256 → HMAC-SHA256 (attacker with DB access cannot recompute)
- [x] **Vulnerability scanner** — `backend/src/services/vulnerabilityScanner.ts`: daily automated security audits
- [x] **Sentry error tracking** — `backend/src/utils/sentry.ts`: PHI-safe scrubbing, 8 patterns
- [x] **Image metadata stripping** — `backend/src/utils/stripMetadata.ts`: EXIF/IPTC/XMP removal before S3 storage
- [x] **SSL hardening** — `backend/src/config/database.ts`: production enforces `rejectUnauthorized: true`
- [x] **Service-to-service auth** — `backend/src/middleware/auth.ts`: X-API-Key header for CallAnalyzer integration
- [x] **Error monitoring workflow** — `.github/workflows/error-monitor.yml`: Docker health, DB, disk, memory checks every 4 hours
- [x] **Blue-green deployment** — `deploy-bluegreen.sh` + CI/CD: staging port health check before swap, ~2s downtime

### Authentication
- [ ] **Session management upgrade** — migrate token revocation from in-memory Set to Redis
- [ ] **SSO integration** — SAML/OIDC for enterprise SSO (if needed)

### Data Protection
- [ ] **Field-level encryption** — encrypt PHI columns (SSN, DOB, member ID) at application layer before storage
- [ ] **Audit log immutability** — enable S3 Object Lock (WORM) for compliance-grade audit trail
- [ ] **PHI discovery scan** — retroactive scan of stored data for unredacted PHI
- [ ] **BAA compliance checklist endpoint** — API endpoint listing compliance status for auditors

### Infrastructure Security
- [ ] **SAST/secret scanning in CI** — add truffleHog or similar to prevent credential leaks
- [ ] **SCA (Software Composition Analysis)** — automated vulnerability scanning beyond npm audit
- [ ] **EC2 env-file hardening** — verify file permissions in deploy script

---

## Sprint 4: Scalability & Performance

### Redis Integration (Highest Priority for Scaling)
- [ ] **Redis for session/token store** — replace in-memory `revokedTokens` Set
- [ ] **Redis for rate limiting** — replace express-rate-limit in-memory store
- [ ] **Redis for caching** — implement `CacheProvider` interface with Redis backend
- [ ] **Redis for job queue** — replace in-memory job queue with Bull/BullMQ

### Database
- [ ] **Add missing FK constraints** — migration 004 with cascading deletes
- [ ] **Transaction isolation** — use SERIALIZABLE for critical user operations
- [ ] **Connection pool metrics** — expose pool utilization to /api/metrics
- [ ] **Read/write timeout split** — 10s for reads, 20s for writes (currently 30s for all)

### Vector Store
- [ ] **HNSW index** — better recall than IVFFlat, especially as corpus grows
- [ ] **Incremental IDF** — avoid full corpus rebuild on every add/remove
- [ ] **Vector store sharding** — partition by collection for faster search

---

## Sprint 5: UI/UX & Accessibility

### Mobile Responsiveness
- [ ] **Responsive layout** — replace inline CSSProperties with CSS Grid/Flexbox + media queries
- [ ] **Tab overflow** — collapsible nav for mobile (8 tabs won't fit on tablet)
- [ ] **Touch-friendly controls** — larger tap targets for mobile use during patient interactions

### Accessibility (WCAG AA)
- [ ] **axe-core audit** — automated WCAG AA scanning in CI
- [ ] **Skip-to-content link** — keyboard navigation improvement
- [ ] **Focus-visible styles** — ensure all interactive elements have visible focus indicators
- [ ] **Color contrast audit** — verify all text/background combinations meet 4.5:1 ratio
- [ ] **Screen reader testing** — manual testing with NVDA/VoiceOver

### UX Improvements
- [ ] **Reduce tab count** — combine Search into Chat, Extract/OCR into "Tools"
- [ ] **Onboarding flow** — first-time user walkthrough
- [ ] **Keyboard shortcuts** — Ctrl+K for search, Escape for modals
- [ ] **Document versioning UI** — frontend for version comparison/rollback
- [ ] **Skeleton loading** — add to all data-fetching components

---

## Sprint 6: Testing & Observability

### Test Coverage
- [ ] **Raise CI thresholds** — 60% lines / 50% branches (from current 50%/40%)
- [ ] **E2E tests** — Playwright for frontend, supertest for API integration
- [ ] **Race condition tests** — concurrent operation scenarios
- [ ] **Critical path coverage** — 90%+ on auth, PHI redaction, data retention

### Observability
- [ ] **OpenTelemetry tracing** — distributed tracing across services
- [ ] **Alerting** — CloudWatch alarms on error rate, latency, and health check failures
- [ ] **Dashboard** — Grafana or CloudWatch dashboard for key metrics

---

## Future Considerations (Not Yet Scheduled)

- **Worker queue** — Bull/BullMQ for background processing (depends on Redis)
- **Webhooks/notifications** — alerts for document source changes, PPD submissions, extraction jobs
- **Fine-tuned query routing** — lightweight classifier for cost optimization
- **Multi-tenant architecture** — if expanding beyond UMS (see Observatory QA port log)
- **Serverless form endpoints** — Lambda + API Gateway for auto-scaling form submissions
- **Document graph** — knowledge graph connecting related documents for better retrieval
