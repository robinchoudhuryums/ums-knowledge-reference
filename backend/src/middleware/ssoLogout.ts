/**
 * Single sign-out (SLO) forwarder.
 *
 * When RAG logs a user out, we best-effort fire `POST /api/auth/logout`
 * to CA with the user's forwarded Cookie header so the CA session
 * terminates too. Without this, a user who signed in via SSO and
 * clicks "Log out" on RAG would still have an active CA session,
 * which is surprising and a minor HIPAA concern.
 *
 * Contract: non-throwing, short timeout, log-and-swallow on any
 * failure. RAG's own logout response must NEVER block or fail
 * because the CA call failed — we clear RAG's cookie first, then
 * fire this in the background.
 */

import { ENABLE_SSO, CA_BASE_URL } from './authConfig';
import { logger } from '../utils/logger';

const CA_SSO_COOKIE = 'connect.sid';
const SSO_LOGOUT_PATH = '/api/auth/sso-logout';
const LOGOUT_TIMEOUT_MS = 1500;

/**
 * Fire-and-forget POST to CA's sso-logout endpoint. Returns a Promise that
 * resolves regardless of outcome — never rejects, never throws. Safe
 * to `.catch(() => {})` or ignore the return value.
 *
 * Targets /api/auth/sso-logout (not /api/auth/logout) because the former
 * is designed for service-to-service calls: it requires X-Service-Secret
 * and bypasses CA's UA+accept-language fingerprint check, which would
 * otherwise destroy the session as a side effect of the mismatch. Hitting
 * the generic /logout from RAG's backend would nominally work (the
 * fingerprint-mismatch destroy-session path cleans up) but relying on a
 * side effect for correctness is fragile.
 */
export async function forwardSsoLogout(cookieHeader: string | undefined): Promise<void> {
  if (!ENABLE_SSO) return;
  if (!CA_BASE_URL) return;
  if (!cookieHeader || !cookieHeader.includes(`${CA_SSO_COOKIE}=`)) return;

  const serviceSecret = process.env.SSO_SHARED_SECRET;
  if (!serviceSecret || serviceSecret.length < 32) {
    logger.warn('SSO logout forward skipped: SSO_SHARED_SECRET not set or too short');
    return;
  }

  const url = `${CA_BASE_URL.replace(/\/$/, '')}${SSO_LOGOUT_PATH}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOGOUT_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        cookie: cookieHeader,
        'x-service-secret': serviceSecret,
      },
      signal: controller.signal,
    });
    // CA returns 200 whether the session was destroyed or already gone.
    // Anything else is a warn-worthy surprise.
    if (res.status !== 200) {
      logger.warn('SSO logout forward: unexpected CA status', {
        status: res.status,
      });
    }
  } catch (err) {
    // Timeouts, network errors all land here. Don't let them surface —
    // the user's RAG-side logout has already completed.
    logger.warn('SSO logout forward failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    clearTimeout(timer);
  }
}
