/**
 * Rate-limit key resolution.
 *
 * All per-endpoint `express-rate-limit` instances historically fell back to
 * the literal string `'unknown'` when both authenticated user ID and
 * `req.ip` were missing. That pools every such request into a single shared
 * bucket, so one attacker (or one misconfigured deploy with a broken trust-
 * proxy setup) exhausts the quota for everyone (H3).
 *
 * This helper resolves keys in descending strength:
 *   1. Authenticated user ID (strongest signal)
 *   2. req.ip (express's resolved client IP, respects trust proxy config)
 *   3. Stable hash of X-Forwarded-For + User-Agent (weak but non-pooling)
 *   4. Per-request random UUID (last resort — disables rate limiting for
 *      that request, but never pools distinct clients into one bucket)
 *
 * When the function falls back to #3 or #4 it logs a warning so operators
 * notice that trust-proxy or IP resolution is broken upstream.
 */

import type { Request } from 'express';
import crypto from 'crypto';
import { logger } from './logger';

interface MaybeUserReq extends Request {
  user?: { id?: string };
}

let fallbackWarningCount = 0;
const FALLBACK_WARN_THROTTLE = 100; // Log once per 100 fallback uses

export function resolveRateLimitKey(req: Request): string {
  const userId = (req as MaybeUserReq).user?.id;
  if (userId) return `u:${userId}`;

  if (req.ip) return `ip:${req.ip}`;

  // Neither authenticated user nor express-resolved IP is available.
  // Try to build a stable-but-non-pooling key from request headers.
  const xff = (req.headers['x-forwarded-for'] as string | undefined) || '';
  const ua = (req.headers['user-agent'] as string | undefined) || '';
  if (xff || ua) {
    const hash = crypto.createHash('sha256').update(`${xff}|${ua}`).digest('hex').slice(0, 16);
    fallbackWarningCount++;
    if (fallbackWarningCount % FALLBACK_WARN_THROTTLE === 1) {
      logger.warn('Rate limit falling back to header hash (user + req.ip both missing)', {
        hashPrefix: hash.slice(0, 8),
        method: req.method,
        path: req.path,
        occurrences: fallbackWarningCount,
      });
    }
    return `h:${hash}`;
  }

  // Absolute last resort — per-request random UUID ensures this request
  // doesn't pool with any other. Rate limiting is effectively off for this
  // one call but we never share a bucket across clients.
  fallbackWarningCount++;
  if (fallbackWarningCount % FALLBACK_WARN_THROTTLE === 1) {
    logger.warn('Rate limit could not resolve any stable key — issuing per-request UUID', {
      method: req.method,
      path: req.path,
      occurrences: fallbackWarningCount,
    });
  }
  return `r:${crypto.randomUUID()}`;
}

/** Reset the fallback warning counter. Exposed for tests only. */
export function __resetRateLimitKeyCounters(): void {
  fallbackWarningCount = 0;
}
