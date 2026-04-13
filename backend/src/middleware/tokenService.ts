/**
 * JWT token management — creation, revocation, cookie handling.
 *
 * Token revocation uses the cache abstraction layer:
 * - Single instance: in-memory sets (cleared on restart, acceptable for 30min JWTs)
 * - Multi-instance: Redis sets (shared across instances via REDIS_URL)
 */

import { Response } from 'express';
import jwt from 'jsonwebtoken';
import type { SignOptions } from 'jsonwebtoken';
import { JWT_SECRET, JWT_EXPIRY } from './authConfig';
import { getSets } from '../cache';
import { logger } from '../utils/logger';

// Cookie name for httpOnly JWT token
export const AUTH_COOKIE = 'ums_auth_token';
export const REFRESH_COOKIE = 'ums_refresh_token';

const TOKEN_REVOCATION_TTL_MS = 35 * 60 * 1000; // 35 min (JWT expiry + buffer)
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const REFRESH_REVOCATION_TTL_MS = 7 * 24 * 60 * 60 * 1000 + 60 * 1000; // 7 days + buffer

// ─── Cookie Management ──────────────────────────────────────────────────────

export function setAuthCookie(res: Response, token: string): void {
  res.cookie(AUTH_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 30 * 60 * 1000,
  });
}

export function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/api/auth/refresh', // Only sent to refresh endpoint
    maxAge: REFRESH_TOKEN_TTL_MS,
  });
}

export function clearAuthCookie(res: Response): void {
  res.clearCookie(AUTH_COOKIE, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
  });
  res.clearCookie(REFRESH_COOKIE, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/api/auth/refresh',
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
}

export function revokeAllUserTokens(userId: string): void {
  // Use refresh token TTL since user-level revocations must outlast the longest token
  getSets().add('revoked-users', userId, REFRESH_REVOCATION_TTL_MS)
    .catch(err => logger.warn('User revocation cache write failed', { error: String(err) }));
}

export async function isTokenRevoked(jti: string): Promise<boolean> {
  return getSets().has('revoked-tokens', jti);
}

export async function isUserRevoked(userId: string): Promise<boolean> {
  return getSets().has('revoked-users', userId);
}
