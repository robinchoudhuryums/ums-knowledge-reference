/**
 * JWT token management — creation, revocation, cookie handling.
 *
 * Server-side token revocation uses in-memory sets (acceptable for single-instance
 * deployments since JWTs are short-lived at 30min). For multi-instance deployments,
 * move to Redis.
 */

import { Response } from 'express';
import jwt from 'jsonwebtoken';
import type { SignOptions } from 'jsonwebtoken';
import { JWT_SECRET, JWT_EXPIRY } from './authConfig';

// Cookie name for httpOnly JWT token
export const AUTH_COOKIE = 'ums_auth_token';

// ─── Cookie Management ──────────────────────────────────────────────────────

/**
 * Set the JWT token as an httpOnly cookie on the response.
 * This prevents XSS attacks from stealing the token via JavaScript.
 */
export function setAuthCookie(res: Response, token: string): void {
  res.cookie(AUTH_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 30 * 60 * 1000, // 30 minutes (matches JWT expiry)
  });
}

/**
 * Clear the auth cookie on logout.
 */
export function clearAuthCookie(res: Response): void {
  res.clearCookie(AUTH_COOKIE, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
  });
}

// ─── Token Creation ─────────────────────────────────────────────────────────

export function createToken(payload: { id: string; username: string; role: string; jti: string }): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY } as SignOptions);
}

export function verifyToken(token: string): { id: string; username: string; role: 'admin' | 'user'; jti?: string } {
  return jwt.verify(token, JWT_SECRET) as { id: string; username: string; role: 'admin' | 'user'; jti?: string };
}

// ─── Token Revocation ───────────────────────────────────────────────────────
// In-memory sets cleared on server restart (acceptable since JWTs are short-lived).

const revokedTokens = new Set<string>();
const revokedUserIds = new Set<string>();

export function revokeToken(jti: string): void {
  revokedTokens.add(jti);
  setTimeout(() => revokedTokens.delete(jti), 35 * 60 * 1000);
}

/**
 * Revoke all tokens for a user (used after admin password reset).
 */
export function revokeAllUserTokens(userId: string): void {
  revokedUserIds.add(userId);
  setTimeout(() => revokedUserIds.delete(userId), 35 * 60 * 1000);
}

export function isTokenRevoked(jti: string): boolean {
  return revokedTokens.has(jti);
}

export function isUserRevoked(userId: string): boolean {
  return revokedUserIds.has(userId);
}
