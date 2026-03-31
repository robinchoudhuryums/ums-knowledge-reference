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
