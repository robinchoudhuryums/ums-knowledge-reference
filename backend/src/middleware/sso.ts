/**
 * SSO Introspection Middleware
 *
 * Option-A SSO with CallAnalyzer: RAG keeps its own users table but trusts CA
 * as the auth authority via server-side cookie introspection. Flow:
 *
 *   1. User visits RAG page with shared `.umscallanalyzer.com` cookies set
 *   2. Browser forwards CA's `connect.sid` to RAG's backend
 *   3. This middleware runs BEFORE `authenticate`. If RAG's own
 *      `ums_auth_token` is absent but CA's `connect.sid` is present,
 *      it calls CA's /api/auth/sso-verify with forwarded cookie +
 *      X-Service-Secret to resolve the user
 *   4. On success: mints a RAG JWT via `setAuthCookie`, mutates
 *      `req.cookies[AUTH_COOKIE]` so the downstream `authenticate`
 *      middleware picks it up this request, and writes an audit entry
 *   5. On failure: silently passes through — the normal 401 flow handles it
 *
 * After the first SSO bootstrap, every subsequent request uses the fast
 * RAG JWT path (30-min expiry). Re-introspection happens only after token
 * expiry. Off by default via `ENABLE_SSO=false` in authConfig.
 */

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import {
  ENABLE_SSO,
  CA_BASE_URL,
} from './authConfig';
import { AUTH_COOKIE, createToken, setAuthCookie } from './tokenService';
import { getUsers, saveUsers } from './auth';
import { logAuditEvent } from '../services/audit';
import { logger } from '../utils/logger';
import { User } from '../types';

const CA_SSO_COOKIE = 'connect.sid';
const SSO_VERIFY_PATH = '/api/auth/sso-verify';
const SSO_VERIFY_TIMEOUT_MS = 3000;

interface CaVerifiedUser {
  id: string;
  username: string;
  name?: string;
  role: string; // CA: 'admin' | 'manager' | 'viewer'
}

interface CaVerifyResponse {
  user: CaVerifiedUser;
  mfaVerified: boolean;
  source: string;
}

/**
 * Map CA's 3-role hierarchy (admin/manager/viewer) into RAG's 2-role model
 * (admin/user). Only CA admins get RAG admin; managers and viewers both map
 * to RAG user. Managers can be promoted in RAG manually if they need
 * privileged access to query logs / usage / dashboards.
 */
function mapRole(caRole: string): 'admin' | 'user' {
  return caRole === 'admin' ? 'admin' : 'user';
}

/**
 * Resolve a CA-verified user into a local RAG user row. Lookup order:
 *   1. By ssoSub = caUser.id (fast path after first successful SSO login)
 *   2. By username or email match (first SSO login for an existing RAG user
 *      — populates ssoSub on the matched row)
 *   3. JIT-provision a fresh row using CA's user.id as RAG's user.id
 *
 * CRITICAL: JIT-provisioned users use CA's UUID as their RAG id, not a
 * fresh UUID. RAG's existing FKs (query_logs.user_id, documents.uploadedBy,
 * audit_logs.userId) reference user.id. A mismatch here would orphan future
 * audit + usage + draft records from the provisioned user. This matches the
 * audit's "CA's user UUID must flow through as RAG's user.id" invariant.
 */
export async function resolveSsoUser(
  caUser: CaVerifiedUser,
): Promise<{ user: User; jitProvisioned: boolean }> {
  const users = await getUsers();

  // (1) Match on ssoSub — fast path after first login
  const bySsoSub = users.find((u) => u.ssoSub === caUser.id);
  if (bySsoSub) return { user: bySsoSub, jitProvisioned: false };

  // (2) Match on username or email (CA's username is the user's email)
  const caUsernameLc = caUser.username.toLowerCase();
  const byLocalIdentity = users.find(
    (u) =>
      u.username.toLowerCase() === caUsernameLc ||
      (u.email ?? '').toLowerCase() === caUsernameLc,
  );
  if (byLocalIdentity) {
    byLocalIdentity.ssoSub = caUser.id;
    byLocalIdentity.ssoSource = 'callanalyzer';
    await saveUsers(users);
    return { user: byLocalIdentity, jitProvisioned: false };
  }

  // (3) JIT provision
  const newUser: User = {
    id: caUser.id,
    username: caUser.username,
    email: caUser.username,
    // Non-bcrypt sentinel: bcrypt.compare returns false on malformed hashes,
    // so SSO-only users can never be phished via the local password form.
    passwordHash: 'SSO_ONLY',
    role: mapRole(caUser.role),
    createdAt: new Date().toISOString(),
    ssoSub: caUser.id,
    ssoSource: 'callanalyzer',
  };
  users.push(newUser);
  await saveUsers(users);
  return { user: newUser, jitProvisioned: true };
}

/**
 * Call CA's /api/auth/sso-verify with the user's forwarded cookie + our
 * shared service secret. Returns the verified user or null on any failure
 * (401, network error, timeout, non-JSON body). Non-throwing — the caller
 * treats null as "pass through to normal auth flow".
 */
async function introspectCaSession(
  cookieHeader: string,
): Promise<CaVerifyResponse | null> {
  const serviceSecret = process.env.SSO_SHARED_SECRET;
  if (!serviceSecret || serviceSecret.length < 32) {
    logger.warn('SSO introspection skipped: SSO_SHARED_SECRET not set or too short');
    return null;
  }
  if (!CA_BASE_URL) return null;

  const url = `${CA_BASE_URL.replace(/\/$/, '')}${SSO_VERIFY_PATH}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SSO_VERIFY_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        cookie: cookieHeader,
        'x-service-secret': serviceSecret,
      },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const body = (await res.json()) as CaVerifyResponse;
    if (!body?.user?.id || !body?.user?.username) return null;
    return body;
  } catch (err) {
    logger.warn('SSO introspection failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Global middleware. Runs before `authenticate` and no-ops unless the
 * conditions below are met:
 *   - ENABLE_SSO=true
 *   - Request has NO valid ums_auth_token (RAG's own session is absent)
 *   - Request HAS a connect.sid (CA's session cookie)
 *
 * On success, mints a RAG JWT + sets req.cookies so `authenticate` sees
 * it this same request. On failure, passes through silently.
 */
export async function trySsoIntrospection(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (!ENABLE_SSO) return next();

  // Short-circuit: RAG session already present — use the fast path.
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
  if (cookies?.[AUTH_COOKIE]) return next();

  // Need CA's cookie to introspect against.
  const rawCookie = req.headers.cookie;
  if (!rawCookie || !rawCookie.includes(`${CA_SSO_COOKIE}=`)) return next();

  try {
    const verified = await introspectCaSession(rawCookie);
    if (!verified) return next();

    const { user, jitProvisioned } = await resolveSsoUser(verified.user);

    // Mint RAG JWT + set cookie for future requests + populate req.cookies
    // so the downstream authenticate middleware verifies it this request.
    const jti = crypto.randomUUID();
    const token = createToken({
      id: user.id,
      username: user.username,
      role: user.role,
      jti,
    });
    setAuthCookie(res, token);
    if (cookies) cookies[AUTH_COOKIE] = token;

    // Fire-and-forget audit — failure to log must not block the login.
    logAuditEvent(user.id, user.username, 'login', {
      action: 'sso_login',
      source: 'callanalyzer',
      caUserId: verified.user.id,
      jitProvisioned,
      mfaVerified: verified.mfaVerified,
    }).catch((err) =>
      logger.warn('Failed to log SSO login audit event', {
        error: err instanceof Error ? err.message : String(err),
      }),
    );

    return next();
  } catch (err) {
    // Any unexpected error — pass through, let normal 401 fire.
    logger.warn('trySsoIntrospection error', {
      error: err instanceof Error ? err.message : String(err),
    });
    return next();
  }
}
