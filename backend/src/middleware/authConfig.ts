/**
 * Authentication configuration and password utilities.
 *
 * Constants, password validation, and lockout logic shared across auth modules.
 */

import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { User } from '../types';
import { logger } from '../utils/logger';

// ─── JWT Config ─────────────────────────────────────────────────────────────

export const JWT_SECRET = process.env.JWT_SECRET || 'ums-kb-dev-secret-change-in-production';
export const JWT_EXPIRY = (process.env.JWT_EXPIRY || '30m') as jwt.SignOptions['expiresIn'];

// Enforce secure JWT_SECRET in production — refuse to start with the default
if (!process.env.JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    logger.error('FATAL: JWT_SECRET environment variable is not set. Refusing to start in production with default secret.');
    process.exit(1);
  }
  logger.warn('[SECURITY WARNING] JWT_SECRET not set — using insecure default. Set JWT_SECRET in production!');
} else if (process.env.JWT_SECRET.length < 32) {
  if (process.env.NODE_ENV === 'production') {
    logger.error('FATAL: JWT_SECRET must be at least 32 characters in production.');
    process.exit(1);
  }
  logger.warn('[SECURITY WARNING] JWT_SECRET is shorter than 32 characters — use a stronger secret in production.');
}

// ─── SSO Config ─────────────────────────────────────────────────────────────
//
// Option-A SSO with CallAnalyzer: RAG keeps its own users table but trusts CA
// as auth authority via cookie introspection. All flags default OFF so
// introducing the code is a no-op until ops flips them in a coordinated
// cutover with CA's matching domain/CORS flags.

/** Enable shared-cookie SSO introspection against CA. Off by default. */
export const ENABLE_SSO = process.env.ENABLE_SSO === 'true';

/** Parent domain for the shared session cookie (e.g. '.umscallanalyzer.com').
 *  When set, RAG's auth + refresh + csrf cookies scope to this domain so the
 *  browser sends them across subdomains. Empty string = exact host. */
export const SHARED_COOKIE_DOMAIN = process.env.SHARED_COOKIE_DOMAIN || '';

/** CA base URL (e.g. 'https://umscallanalyzer.com'). Used for server-side
 *  /api/auth/sso-verify introspection calls. Required when ENABLE_SSO=true. */
export const CA_BASE_URL = process.env.CA_BASE_URL || '';

/** Keep RAG's native TOTP MFA gate active. When SSO is on, CA has already
 *  enforced MFA before the session exists so double-gating adds friction
 *  without security benefit. Default ON for rollback safety — flip off after
 *  SSO is stable in prod. */
export const ENABLE_NATIVE_MFA = process.env.ENABLE_NATIVE_MFA !== 'false';

if (ENABLE_SSO) {
  if (!CA_BASE_URL) {
    if (process.env.NODE_ENV === 'production') {
      logger.error('FATAL: ENABLE_SSO=true requires CA_BASE_URL to be set.');
      process.exit(1);
    }
    logger.warn('[SSO WARNING] ENABLE_SSO=true but CA_BASE_URL is empty — introspection will fail.');
  }
  if (!SHARED_COOKIE_DOMAIN && process.env.NODE_ENV === 'production') {
    logger.warn('[SSO WARNING] ENABLE_SSO=true in production without SHARED_COOKIE_DOMAIN — the browser will not send CA session cookies to this host.');
  }
}

// ─── Password Policy ────────────────────────────────────────────────────────

export const MIN_PASSWORD_LENGTH = 8;
export const PASSWORD_HISTORY_SIZE = 5;

export function validatePassword(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  if (!/[A-Z]/.test(password)) {
    return 'Password must contain at least one uppercase letter';
  }
  if (!/[a-z]/.test(password)) {
    return 'Password must contain at least one lowercase letter';
  }
  if (!/[0-9]/.test(password)) {
    return 'Password must contain at least one number';
  }
  return null;
}

/**
 * Check if a password matches any of the user's previous passwords.
 */
export async function isPasswordReused(password: string, user: User): Promise<boolean> {
  if (await bcrypt.compare(password, user.passwordHash)) return true;
  if (user.passwordHistory) {
    for (const oldHash of user.passwordHistory) {
      if (await bcrypt.compare(password, oldHash)) return true;
    }
  }
  return false;
}

// ─── Account Lockout ────────────────────────────────────────────────────────

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

export function isAccountLocked(user: User): boolean {
  if (!user.lockedUntil) return false;
  return new Date(user.lockedUntil).getTime() > Date.now();
}

export function getLockoutRemainingSeconds(user: User): number {
  if (!user.lockedUntil) return 0;
  const remaining = new Date(user.lockedUntil).getTime() - Date.now();
  return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
}

// In-memory lockout cache — populated from S3/DB on every successful getUsers() call,
// used as fallback when storage is unavailable so locked accounts stay locked.
const lockedAccountCache = new Map<string, string>(); // userId → lockedUntil ISO string

export function updateLockoutCache(users: User[]): void {
  lockedAccountCache.clear();
  for (const u of users) {
    if (u.lockedUntil) {
      lockedAccountCache.set(u.id, u.lockedUntil);
    }
  }
}

export function isAccountLockedFromCache(userId: string): boolean {
  const lockedUntil = lockedAccountCache.get(userId);
  if (!lockedUntil) return false;
  return new Date(lockedUntil).getTime() > Date.now();
}
