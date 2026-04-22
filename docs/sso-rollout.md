# SSO Rollout Runbook — RAG + CallAnalyzer

Option-A shared-cookie SSO: CallAnalyzer (CA) is the auth authority, RAG
trusts a session cookie scoped to `.umscallanalyzer.com` and JIT-provisions
local user rows on first login. This runbook covers the coordinated
deploy + cutover across both services.

## Current state (before rollout)

Everything lands behind env flags defaulting to OFF. On both services
the existing auth behavior is unchanged until ops flips the flags in
the order below.

| Flag | Repo | Default | Purpose |
|------|------|---------|---------|
| `SSO_SHARED_SECRET` | both | unset | Service-to-service auth on `/api/auth/sso-verify`. Must be ≥32 chars, identical on both services. |
| `SHARED_COOKIE_DOMAIN` | both | `""` | Parent domain for session + CSRF cookies (e.g. `.umscallanalyzer.com`). Unset = host-scoped (current). |
| `ENABLE_SSO` | RAG | `false` | Activates the introspection middleware. Requires `CA_BASE_URL`. |
| `CA_BASE_URL` | RAG | `""` | Where RAG sends `/api/auth/sso-verify` calls (e.g. `https://umscallanalyzer.com`). |
| `ENABLE_NATIVE_MFA` | RAG | `true` | Gates RAG's TOTP check at login. Keep ON during initial rollout; flip OFF once SSO is stable. |

## Prerequisites

- Both CA and RAG are behind the same reverse proxy on the same eTLD+1
  (`umscallanalyzer.com` + `knowledge.umscallanalyzer.com`).
- Both services run over HTTPS (required for `Secure` cookies + HSTS with
  `includeSubDomains`).
- Operator has a break-glass RAG admin with a known password — see
  `backend/src/scripts/reset-admin.ts` for the reset path if needed.
- A low-traffic window scheduled. Setting `SHARED_COOKIE_DOMAIN`
  invalidates every existing session on both services because browsers
  treat host-scoped and domain-scoped cookies as distinct entries — all
  users will be signed out once at the moment of cutover.

## Rollout order

Flags are flipped in stages so each step can be rolled back independently.

### Stage 1 — Generate the shared secret

```
openssl rand -hex 32
```

Set `SSO_SHARED_SECRET=<same-value>` on **both** services. Deploy both.
No behavior change: CA's new `/api/auth/sso-verify` now returns the user
when called correctly, but nothing calls it yet. RAG's `ENABLE_SSO` is
still false so the middleware no-ops.

Verify on CA:
```
curl -i https://umscallanalyzer.com/api/auth/sso-verify -H "X-Service-Secret: <secret>"
# expect: 401 "Not authenticated"  (no session cookie on this curl)
curl -i https://umscallanalyzer.com/api/auth/sso-verify -H "X-Service-Secret: wrong"
# expect: 401 "Invalid service credential"
curl -i https://umscallanalyzer.com/api/auth/sso-verify
# expect: 401 "Invalid service credential"
```

### Stage 2 — Shared cookie domain (both services, same deploy window)

Set on **both**:
```
SHARED_COOKIE_DOMAIN=.umscallanalyzer.com
```

Deploy both within the same window. At deploy, all existing sessions on
both services become invalid — users will be signed out exactly once.

Verify with a fresh browser session after deploy:
- Log into CA. Inspect the `connect.sid` cookie — `Domain` column
  should read `.umscallanalyzer.com`, not `umscallanalyzer.com`.
- Navigate to RAG (which still uses its own login — SSO not yet
  enabled). Inspect `ums_auth_token` — same domain attribute.

### Stage 3 — Enable SSO on RAG

Set on **RAG only**:
```
ENABLE_SSO=true
CA_BASE_URL=https://umscallanalyzer.com
```

Deploy RAG. The introspection middleware activates.

Verify:
- Log into CA first.
- Navigate to RAG. You should land directly on the app without seeing
  RAG's login form. RAG's `ums_auth_token` cookie is now set by the
  middleware.
- Check RAG's audit log: there should be a `login` entry with
  `details.action=sso_login` and `details.jitProvisioned=true` (first
  time) or `false` (subsequent).

### Stage 4 — Frontend SSO panel

No new env flag. The frontend reads `/api/auth/config` on the login
page and renders "Sign in with CallAnalyzer" when SSO is enabled server-
side. With Stage 3 deployed, users who sign out of RAG and hit the login
page see the SSO button by default; the `?local=1` URL param keeps the
username/password form reachable for break-glass.

### Stage 5 — Retire RAG native MFA (optional, after 1-2 weeks)

Only after Stage 4 is stable in prod.

Set on **RAG**:
```
ENABLE_NATIVE_MFA=false
```

Deploy RAG. RAG's TOTP check at login is skipped. CA still enforces MFA
before its session exists, so the overall security posture is
preserved. Users stay enrolled; flipping the flag back on restores the
check without re-enrollment.

## Rollback paths

Each stage rolls back by unsetting its flag and redeploying the affected
service. No data migration is required.

- **Stage 5 rollback**: set `ENABLE_NATIVE_MFA=true`. Native MFA prompt
  returns on next login.
- **Stage 3 rollback**: set `ENABLE_SSO=false`. Introspection middleware
  no-ops. RAG falls back to its own login form (frontend /api/auth/config
  returns `sso.enabled=false`, LoginForm shows username/password).
- **Stage 2 rollback**: unset `SHARED_COOKIE_DOMAIN` on both. All
  sessions invalidate again; users sign back in once.
- **Stage 1 rollback**: unset `SSO_SHARED_SECRET` on both. CA's
  `/api/auth/sso-verify` returns 503. RAG's middleware skips
  introspection.

## What to watch post-cutover

- **RAG audit log**: `details.action=sso_login` entries with
  `jitProvisioned` counts. A burst of `jitProvisioned=true` is normal
  on day 1 (each existing CA user gets one local row on first RAG
  visit). After that it should trend to zero as the ssoSub fast path
  takes over.
- **RAG logs**: `logger.warn` entries mentioning
  `SSO introspection failed` indicate CA is unreachable or returned a
  non-200. A few is fine (e.g. expired CA sessions); sustained output
  points at a CA outage or a CORS/secret mismatch.
- **RAG usage stats**: per-user daily query limits now key on CA's
  UUID (for SSO'd users) — a user who was previously at their local
  daily limit gets a fresh budget on first SSO login because
  `usage_records` has no row for the new user id. Expected. Do not
  try to "merge" old and new rows; the FK-stability invariant is the
  whole point of JIT-provisioning with CA's UUID.
- **CA audit log**: unchanged. `/api/auth/sso-verify` does not write
  CA-side audit entries — the session itself was already audited at
  CA login.

## Closed gaps (shipped post-Track-2)

- **Single sign-out** — shipped. RAG's `logoutHandler` fires a
  best-effort `POST /api/auth/sso-logout` to CA with the forwarded
  cookie + `SSO_SHARED_SECRET`. CA's new endpoint bypasses the UA
  fingerprint check, destroys the session via `req.logout()` +
  `session.destroy()`, and writes a `sso_logout` HIPAA audit entry.
  Fire-and-forget from RAG's side; non-throwing, 1.5s timeout, all
  failure modes log at `warn` without blocking the user's logout.
- **Return-to after CA login** — shipped. CA's login page reads
  `?return_to=<url>` and redirects post-login. SSRF-guarded via
  `client/src/lib/return-to.ts`: only `http(s)://` URLs whose
  hostname is `umscallanalyzer.com` or a subdomain are accepted;
  open-redirect lookalikes rejected.
- **CA admin visibility** — shipped (P2-2). New
  `GET /api/admin/users/unseen-by-rag` on CA + accent-stripe banner
  on the Users tab lists users who exist in CA but have never logged
  into RAG. Reads RAG's new `GET /api/auth/sso-seen` endpoint which
  returns the set of known `ssoSub` values.
- **Auth column on RAG user management** — shipped (P2-3). RAG's
  admin User Management table now has an "Auth" column with SSO /
  Local pills; hover on the SSO pill shows the full `ssoSub` (CA
  user ID) for compliance audits.

## Known gaps (deferred — not blockers)

- **Embedded RAG chat in CA** (Track 3): shipped separately. Once SSO
  is enabled (Stage 3 above), enable the embed by setting
  `EMBED_ALLOWED_ORIGIN=https://umscallanalyzer.com` on RAG and
  `RAG_SERVICE_URL=https://knowledge.umscallanalyzer.com` +
  `RAG_ENABLED=true` on CA. A floating "Ask KB" button appears on
  CA's transcript detail pages; clicking it opens a side-drawer
  iframing RAG at `/?embed=1`. The iframe auto-authenticates via the
  shared session cookie. See the Track 3 section below.

---

## Track 3 — Embedded KB chat in CallAnalyzer

Adds a floating "Ask KB" button on CA's transcript detail pages. Clicking
it opens a side-drawer iframing RAG at `/?embed=1`. The iframe inherits
the shared `.umscallanalyzer.com` session cookie from Track 2, so users
see no additional login.

### Prerequisites

- Track 2 Stages 1-3 are live (shared session cookie working; users on
  knowledge.* are auto-authenticated via CA's session).

### Enable sequence

Set on **RAG**:
```
EMBED_ALLOWED_ORIGIN=https://umscallanalyzer.com
```

Deploy RAG. This extends CSP `frame-ancestors` to allow CA's origin and
disables `X-Frame-Options` (CSP supersedes XFO in modern browsers). With
this unset, the browser hard-refuses to load the iframe.

Set on **CA**:
```
RAG_SERVICE_URL=https://knowledge.umscallanalyzer.com
RAG_ENABLED=true
```

Deploy CA. The frontend reads `/api/config`, sees `kb.enabled=true`, and
renders the floating trigger on transcript detail pages.

Verify:
- Log into CA (via normal flow).
- Open any call → transcript detail page.
- Look for the bottom-right "Ask KB" button.
- Click it → the drawer slides in from the right; after ~1s the iframe
  finishes loading and the ChatInterface is usable without any login
  prompt.
- Ask a test question; verify the answer lands and source citations
  render.

### Rollback

Unset either flag:
- Unset `EMBED_ALLOWED_ORIGIN` on RAG → browsers refuse to load the
  iframe; CA's drawer shows a blank iframe. (Not graceful; set
  `RAG_ENABLED=false` on CA at the same time to hide the trigger.)
- Unset `RAG_SERVICE_URL` or `RAG_ENABLED=false` on CA → `/api/config`
  returns `kb.enabled=false`, trigger disappears. Cleaner user-facing
  rollback; CA-side only.

### Known limitations

- **Escape inside the iframe does not close the drawer.** Key events
  don't bubble across the iframe boundary. Users click the × button.
- **Source citations open within the iframe.** They don't break out
  to a new tab. Could be added later with an `embed:open-source`
  postMessage → `window.open` in CA; low priority.
- **No height autoresize.** The drawer is a fixed 100vh × 420px
  regardless of chat content. Keeps the layout stable; dynamic resizing
  would require a ResizeObserver inside the iframe posting height
  upward.
