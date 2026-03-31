/**
 * Authentication & Authorization Middleware
 *
 * Handles JWT validation, role-based access control, login/logout, user creation,
 * and password management. Split into three modules:
 * - authConfig.ts — JWT config, password validation, lockout logic
 * - tokenService.ts — Token creation, revocation, cookie management
 * - auth.ts (this file) — Middleware and route handlers
 */

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { writeFileSync } from 'fs';
import bcrypt from 'bcryptjs';
import { User } from '../types';
import { getUsers as dbGetUsers, saveUsers as dbSaveUsers } from '../db';
import { logger } from '../utils/logger';

// Re-export from sub-modules so existing callers don't break
export {
  validatePassword,
  isPasswordReused,
  isAccountLocked,
  getLockoutRemainingSeconds,
  MAX_FAILED_ATTEMPTS,
  LOCKOUT_DURATION_MS,
  PASSWORD_HISTORY_SIZE,
} from './authConfig';

export {
  AUTH_COOKIE,
  setAuthCookie,
  clearAuthCookie,
  revokeToken,
  revokeAllUserTokens,
} from './tokenService';

import {
  validatePassword,
  isPasswordReused,
  isAccountLocked,
  getLockoutRemainingSeconds,
  updateLockoutCache,
  isAccountLockedFromCache,
  MAX_FAILED_ATTEMPTS,
  LOCKOUT_DURATION_MS,
  PASSWORD_HISTORY_SIZE,
} from './authConfig';

import {
  AUTH_COOKIE,
  setAuthCookie,
  clearAuthCookie,
  createToken,
  verifyToken,
  revokeToken,
  isTokenRevoked,
  isUserRevoked,
} from './tokenService';

// ─── User Data Access ───────────────────────────────────────────────────────

export const USERS_KEY = 'users.json';

export async function getUsers(): Promise<User[]> {
  return dbGetUsers();
}

export async function saveUsers(users: User[]): Promise<void> {
  return dbSaveUsers(users);
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AuthRequest extends Request {
  user?: { id: string; username: string; role: 'admin' | 'user'; jti?: string };
}

/**
 * Get the list of collection IDs a user is allowed to access.
 * Admins can access all collections (returns null = no restriction).
 */
export async function getUserAllowedCollections(userId: string, role: string): Promise<string[] | null> {
  if (role === 'admin') return null;
  const users = await getUsers();
  const user = users.find(u => u.id === userId);
  if (!user?.allowedCollections || user.allowedCollections.length === 0) return null;
  return user.allowedCollections;
}

// ─── Initialization ─────────────────────────────────────────────────────────

/**
 * Initialize default admin user if no users exist.
 */
export async function initializeAuth(): Promise<void> {
  const users = await getUsers();
  if (users.length === 0) {
    const initialPassword = crypto.randomBytes(16).toString('base64url').slice(0, 20);
    const passwordHash = await bcrypt.hash(initialPassword, 12);
    const adminUser: User = {
      id: 'admin-001',
      username: 'admin',
      passwordHash,
      role: 'admin',
      createdAt: new Date().toISOString(),
      mustChangePassword: true,
    };
    await saveUsers([adminUser]);
    const passwordFilePath = '/tmp/ums-admin-initial-password.txt';
    try {
      writeFileSync(passwordFilePath, `Admin initial password: ${initialPassword}\nThis password MUST be changed on first login.\n`, { mode: 0o600 });
      logger.warn('Default admin user created (username: admin). Initial password written to: ' + passwordFilePath);
      logger.warn('Read the password from that file, then delete it immediately.');
    } catch {
      process.stdout.write(`\n[ADMIN SETUP] Initial password for admin: ${initialPassword}\n`);
      process.stdout.write('[ADMIN SETUP] Change this password immediately on first login.\n\n');
      logger.warn('Default admin user created (username: admin). Initial password printed to stdout.');
    }
  }
}

// ─── Route Handlers ─────────────────────────────────────────────────────────

export async function loginHandler(req: Request, res: Response): Promise<void> {
  const { username, password } = req.body;

  if (!username || !password) {
    res.status(400).json({ error: 'Username and password are required' });
    return;
  }

  const users = await getUsers();
  const user = users.find(u => u.username === username);

  if (user && isAccountLocked(user)) {
    const remaining = getLockoutRemainingSeconds(user);
    logger.warn('Login attempt on locked account', { username, remainingSeconds: remaining });
    res.status(423).json({ error: 'Account is locked due to too many failed attempts. Please try again later.' });
    return;
  }

  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    if (user) {
      user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;
      if (user.failedLoginAttempts >= MAX_FAILED_ATTEMPTS) {
        user.lockedUntil = new Date(Date.now() + LOCKOUT_DURATION_MS).toISOString();
        logger.warn('Account locked due to failed attempts', {
          username,
          attempts: user.failedLoginAttempts,
          lockedUntil: user.lockedUntil,
        });
      }
      await saveUsers(users);
    }
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  user.failedLoginAttempts = 0;
  user.lockedUntil = undefined;
  user.lastLogin = new Date().toISOString();
  await saveUsers(users);

  const jti = crypto.randomUUID();
  const token = createToken({ id: user.id, username: user.username, role: user.role, jti });
  setAuthCookie(res, token);

  res.json({
    token,
    user: { id: user.id, username: user.username, role: user.role },
    mustChangePassword: !!user.mustChangePassword,
  });
}

export async function changePasswordHandler(req: AuthRequest, res: Response): Promise<void> {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: 'Current password and new password are required' });
    return;
  }

  const passwordError = validatePassword(newPassword);
  if (passwordError) {
    res.status(400).json({ error: passwordError });
    return;
  }

  const users = await getUsers();
  const user = users.find(u => u.id === req.user!.id);

  if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
    res.status(401).json({ error: 'Current password is incorrect' });
    return;
  }

  if (await isPasswordReused(newPassword, user)) {
    res.status(400).json({
      error: `Cannot reuse any of your last ${PASSWORD_HISTORY_SIZE} passwords. Choose a different password.`,
    });
    return;
  }

  const history = user.passwordHistory || [];
  history.unshift(user.passwordHash);
  user.passwordHistory = history.slice(0, PASSWORD_HISTORY_SIZE);

  user.passwordHash = await bcrypt.hash(newPassword, 12);
  user.mustChangePassword = false;
  await saveUsers(users);

  if (req.user?.jti) {
    revokeToken(req.user.jti);
  }

  const jti = crypto.randomUUID();
  const token = createToken({ id: user.id, username: user.username, role: user.role, jti });
  setAuthCookie(res, token);

  logger.info('Password changed', { userId: user.id, username: user.username });
  res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
}

export async function logoutHandler(req: AuthRequest, res: Response): Promise<void> {
  if (req.user?.jti) {
    revokeToken(req.user.jti);
  }
  clearAuthCookie(res);
  res.json({ message: 'Logged out' });
}

export async function createUserHandler(req: AuthRequest, res: Response): Promise<void> {
  const { username, password, role } = req.body;

  if (!username || !password) {
    res.status(400).json({ error: 'Username and password are required' });
    return;
  }

  const passwordError = validatePassword(password);
  if (passwordError) {
    res.status(400).json({ error: passwordError });
    return;
  }

  const users = await getUsers();
  if (users.find(u => u.username === username)) {
    res.status(409).json({ error: 'Username already exists' });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const newUser: User = {
    id: crypto.randomUUID(),
    username,
    passwordHash,
    role: role === 'admin' ? 'admin' : 'user',
    createdAt: new Date().toISOString(),
  };

  users.push(newUser);
  await saveUsers(users);

  res.status(201).json({ user: { id: newUser.id, username: newUser.username, role: newUser.role } });
}

// ─── Middleware ──────────────────────────────────────────────────────────────

/**
 * JWT authentication middleware.
 * Accepts token from httpOnly cookie (preferred) or Authorization header (fallback).
 * Checks token validity, server-side revocation, AND account lockout status.
 */
export function authenticate(req: AuthRequest, res: Response, next: NextFunction): void {
  const cookieToken = req.cookies?.[AUTH_COOKIE];
  const authHeader = req.headers.authorization;
  const token = cookieToken || (authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null);

  if (!token) {
    res.status(401).json({ error: 'No token provided' });
    return;
  }

  let decoded: { id: string; username: string; role: 'admin' | 'user'; jti?: string };
  try {
    decoded = verifyToken(token);
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  if ((decoded.jti && isTokenRevoked(decoded.jti)) || isUserRevoked(decoded.id)) {
    res.status(401).json({ error: 'Token has been revoked' });
    return;
  }

  // Async lockout check
  (async () => {
    try {
      const users = await getUsers();
      updateLockoutCache(users);
      const user = users.find(u => u.id === decoded.id);
      if (user && isAccountLocked(user)) {
        res.status(423).json({ error: 'Account is locked due to too many failed login attempts' });
        return;
      }
    } catch {
      if (isAccountLockedFromCache(decoded.id)) {
        res.status(423).json({ error: 'Account is locked due to too many failed login attempts' });
        return;
      }
    }
    req.user = decoded;
    next();
  })().catch(next);
}

/**
 * Admin-only authorization middleware.
 */
export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction): void {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  next();
}
