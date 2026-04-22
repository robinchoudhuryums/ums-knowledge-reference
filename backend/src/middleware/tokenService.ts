/**
 * JWT token management — creation, revocation, cookie handling.
 *
 * Token revocation uses the cache abstraction layer:
 * - Single instance: in-memory sets with S3-backed persistence (survives restarts)
 * - Multi-instance: Redis sets (shared across instances via REDIS_URL)
 */

import { Response } from 'express';
import jwt from 'jsonwebtoken';
import type { SignOptions } from 'jsonwebtoken';
import { JWT_SECRET, JWT_EXPIRY, SHARED_COOKIE_DOMAIN } from './authConfig';
import { getSets } from '../cache';
import { logger } from '../utils/logger';

// Cookie name for httpOnly JWT token
export const AUTH_COOKIE = 'ums_auth_token';
export const REFRESH_COOKIE = 'ums_refresh_token';

const TOKEN_REVOCATION_TTL_MS = 35 * 60 * 1000; // 35 min (JWT expiry + buffer)
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const REFRESH_REVOCATION_TTL_MS = 7 * 24 * 60 * 60 * 1000 + 60 * 1000; // 7 days + buffer

// ─── Cookie Management ──────────────────────────────────────────────────────

// When SHARED_COOKIE_DOMAIN is set (e.g. ".umscallanalyzer.com"), all three
// cookies (auth, refresh, CSRF) are scoped to the parent domain so they ride
// with the shared session cookie across subdomains. sameSite:strict still
// works because strict is about cross-SITE (registrable domain), not cross-
// subdomain. Unset = exact host (default, current behavior).
const sharedDomain = SHARED_COOKIE_DOMAIN
  ? { domain: SHARED_COOKIE_DOMAIN }
  : {};

export function setAuthCookie(res: Response, token: string): void {
  res.cookie(AUTH_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 30 * 60 * 1000,
    ...sharedDomain,
  });
}

export function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/api/auth/refresh', // Only sent to refresh endpoint
    maxAge: REFRESH_TOKEN_TTL_MS,
    ...sharedDomain,
  });
}

export function clearAuthCookie(res: Response): void {
  // clearCookie must match the original cookie's domain + path exactly, or the
  // browser keeps the old entry. Passing the same sharedDomain as the setter
  // guarantees a clean removal.
  res.clearCookie(AUTH_COOKIE, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    ...sharedDomain,
  });
  res.clearCookie(REFRESH_COOKIE, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/api/auth/refresh',
    ...sharedDomain,
  });
}

// ─── Token Creation ─────────────────────────────────────────────────────────

export function createToken(payload: { id: string; username: string; role: string; jti: string }): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY } as SignOptions);
}

export function createRefreshToken(payload: { id: string; username: string; role: string; jti: string }): string {
  return jwt.sign({ ...payload, type: 'refresh' }, JWT_SECRET, { expiresIn: '7d' } as SignOptions);
}

export function verifyToken(token: string): { id: string; username: string; role: 'admin' | 'user'; jti?: string } {
  return jwt.verify(token, JWT_SECRET) as { id: string; username: string; role: 'admin' | 'user'; jti?: string };
}

// ─── Token Revocation ───────────────────────────────────────────────────────
// Uses SetProvider — automatically backed by Redis when REDIS_URL is configured,
// falls back to in-memory for single-instance deployments.

export function revokeToken(jti: string): void {
  getSets().add('revoked-tokens', jti, TOKEN_REVOCATION_TTL_MS)
    .catch(err => logger.warn('Token revocation cache write failed', { error: String(err) }));
  // Track for S3 persistence (only used when Redis is not configured)
  revokedTokensList.push({ member: jti, expiresAt: Date.now() + TOKEN_REVOCATION_TTL_MS, ttlMs: TOKEN_REVOCATION_TTL_MS });
}

export function revokeAllUserTokens(userId: string): void {
  // Use refresh token TTL since user-level revocations must outlast the longest token
  getSets().add('revoked-users', userId, REFRESH_REVOCATION_TTL_MS)
    .catch(err => logger.warn('User revocation cache write failed', { error: String(err) }));
  // Track for S3 persistence (only used when Redis is not configured)
  revokedUsersList.push({ member: userId, expiresAt: Date.now() + REFRESH_REVOCATION_TTL_MS, ttlMs: REFRESH_REVOCATION_TTL_MS });
}

export async function isTokenRevoked(jti: string): Promise<boolean> {
  return getSets().has('revoked-tokens', jti);
}

export async function isUserRevoked(userId: string): Promise<boolean> {
  return getSets().has('revoked-users', userId);
}

// ─── S3-backed Revocation Persistence ───────────────────────────────────────
// Tracks revoked tokens/users locally so they can be persisted to S3 on shutdown
// and restored on startup. This prevents revocations from being lost when running
// without Redis (in-memory sets are cleared on process restart).

interface RevocationEntry { member: string; expiresAt: number; ttlMs: number }
const revokedTokensList: RevocationEntry[] = [];
const revokedUsersList: RevocationEntry[] = [];

/**
 * Save current revocation state to S3 for crash recovery.
 * Called during graceful shutdown.
 */
export async function persistRevocations(): Promise<void> {
  if (process.env.REDIS_URL) return; // Redis handles persistence; skip S3

  try {
    const { saveMetadata } = await import('../services/s3Storage');
    const now = Date.now();
    // Only persist entries that haven't expired yet
    const state = {
      tokens: revokedTokensList.filter(e => e.expiresAt > now),
      users: revokedUsersList.filter(e => e.expiresAt > now),
      savedAt: new Date().toISOString(),
    };
    await saveMetadata('revocation-state.json', state);
    logger.info('Revocation state persisted to S3', {
      tokens: state.tokens.length,
      users: state.users.length,
    });
  } catch (err) {
    logger.error('Failed to persist revocation state', { error: String(err) });
  }
}

/**
 * Restore revocation state from S3 on startup.
 * Re-populates the in-memory sets with non-expired entries.
 */
export async function restoreRevocations(): Promise<void> {
  if (process.env.REDIS_URL) return; // Redis handles persistence; skip S3

  try {
    const { loadMetadata } = await import('../services/s3Storage');
    const state = await loadMetadata<{
      tokens: RevocationEntry[];
      users: RevocationEntry[];
      savedAt: string;
    }>('revocation-state.json');

    if (!state) return;

    const now = Date.now();
    let restoredTokens = 0;
    let restoredUsers = 0;

    for (const entry of state.tokens) {
      if (entry.expiresAt > now) {
        const remainingTtl = entry.expiresAt - now;
        await getSets().add('revoked-tokens', entry.member, remainingTtl);
        revokedTokensList.push(entry);
        restoredTokens++;
      }
    }

    for (const entry of state.users) {
      if (entry.expiresAt > now) {
        const remainingTtl = entry.expiresAt - now;
        await getSets().add('revoked-users', entry.member, remainingTtl);
        revokedUsersList.push(entry);
        restoredUsers++;
      }
    }

    if (restoredTokens > 0 || restoredUsers > 0) {
      logger.info('Revocation state restored from S3', {
        tokens: restoredTokens,
        users: restoredUsers,
        savedAt: state.savedAt,
      });
    }
  } catch (err) {
    logger.warn('Failed to restore revocation state from S3', { error: String(err) });
  }
}
