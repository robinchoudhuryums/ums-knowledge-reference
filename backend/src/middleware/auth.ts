import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { User } from '../types';
import { loadMetadata, saveMetadata } from '../services/s3Storage';
import { logger } from '../utils/logger';

const JWT_SECRET = process.env.JWT_SECRET || 'ums-kb-dev-secret-change-in-production';
export const USERS_KEY = 'users.json';

// JWT expiry: 30 minutes for HIPAA compliance (down from 8 hours)
const JWT_EXPIRY = (process.env.JWT_EXPIRY || '30m') as jwt.SignOptions['expiresIn'];

// Cookie name for httpOnly JWT token
export const AUTH_COOKIE = 'ums_auth_token';

/**
 * Set the JWT token as an httpOnly cookie on the response.
 * This prevents XSS attacks from stealing the token via JavaScript.
 */
export function setAuthCookie(res: Response, token: string): void {
  res.cookie(AUTH_COOKIE, token, {
    httpOnly: true,       // JS cannot read this cookie (XSS protection)
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

// Warn at startup if using the default JWT secret
if (!process.env.JWT_SECRET) {
  logger.warn('[SECURITY WARNING] JWT_SECRET not set — using insecure default. Set JWT_SECRET in production!');
}

const MIN_PASSWORD_LENGTH = 8;

// Account lockout settings
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

// Password history: prevent reuse of last N passwords
const PASSWORD_HISTORY_SIZE = 5;

function validatePassword(password: string): string | null {
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
async function isPasswordReused(password: string, user: User): Promise<boolean> {
  // Check current password
  if (await bcrypt.compare(password, user.passwordHash)) return true;

  // Check history
  if (user.passwordHistory) {
    for (const oldHash of user.passwordHistory) {
      if (await bcrypt.compare(password, oldHash)) return true;
    }
  }

  return false;
}

/**
 * Check if an account is currently locked out.
 */
function isAccountLocked(user: User): boolean {
  if (!user.lockedUntil) return false;
  return new Date(user.lockedUntil).getTime() > Date.now();
}

/**
 * Get remaining lockout time in seconds.
 */
function getLockoutRemainingSeconds(user: User): number {
  if (!user.lockedUntil) return 0;
  const remaining = new Date(user.lockedUntil).getTime() - Date.now();
  return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
}

// ---------------------------------------------------------------------------
// Server-side token revocation
// In-memory set of revoked JWT IDs. Cleared on server restart (acceptable since
// JWTs are short-lived at 30min). For multi-instance deployments, move to Redis.
// ---------------------------------------------------------------------------
const revokedTokens = new Set<string>();

export function revokeToken(jti: string): void {
  revokedTokens.add(jti);
  // Auto-clean after 35 minutes (JWT expiry + buffer)
  setTimeout(() => revokedTokens.delete(jti), 35 * 60 * 1000);
}

function isTokenRevoked(jti: string): boolean {
  return revokedTokens.has(jti);
}

// ---------------------------------------------------------------------------

export interface AuthRequest extends Request {
  user?: { id: string; username: string; role: 'admin' | 'user'; jti?: string };
}

/**
 * Get the list of collection IDs a user is allowed to access.
 * Admins can access all collections (returns null = no restriction).
 * Regular users with allowedCollections set are restricted to those collections.
 * Regular users with no allowedCollections set can access all collections (backwards-compatible).
 */
export async function getUserAllowedCollections(userId: string, role: string): Promise<string[] | null> {
  if (role === 'admin') return null; // admins bypass collection ACL
  const users = await getUsers();
  const user = users.find(u => u.id === userId);
  if (!user?.allowedCollections || user.allowedCollections.length === 0) return null;
  return user.allowedCollections;
}

export async function getUsers(): Promise<User[]> {
  const users = await loadMetadata<User[]>(USERS_KEY);
  return users || [];
}

export async function saveUsers(users: User[]): Promise<void> {
  await saveMetadata(USERS_KEY, users);
}

/**
 * Initialize default admin user if no users exist.
 * Default admin is flagged with mustChangePassword = true.
 */
export async function initializeAuth(): Promise<void> {
  const users = await getUsers();
  if (users.length === 0) {
    // Generate a random initial admin password instead of hardcoded 'admin'
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
    // Log the temporary password once — admin must change on first login
    logger.warn('Default admin user created (username: admin) — INITIAL PASSWORD (change immediately):', { initialPassword });
    logger.warn('╔══════════════════════════════════════════════════════════════╗');
    logger.warn(`║  Admin initial password: ${initialPassword.padEnd(34)} ║`);
    logger.warn('║  This password MUST be changed on first login.             ║');
    logger.warn('╚══════════════════════════════════════════════════════════════╝');
  }
}

/**
 * Login endpoint handler.
 * Returns mustChangePassword flag so frontend can force password change.
 */
export async function loginHandler(req: Request, res: Response): Promise<void> {
  const { username, password } = req.body;

  if (!username || !password) {
    res.status(400).json({ error: 'Username and password are required' });
    return;
  }

  const users = await getUsers();
  const user = users.find(u => u.username === username);

  // Check account lockout before anything else
  if (user && isAccountLocked(user)) {
    const remaining = getLockoutRemainingSeconds(user);
    logger.warn('Login attempt on locked account', { username, remainingSeconds: remaining });
    res.status(423).json({
      error: `Account is locked due to too many failed attempts. Try again in ${Math.ceil(remaining / 60)} minutes.`,
    });
    return;
  }

  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    // Track failed attempts
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

  // Successful login — reset failed attempts, lockout, and track lastLogin
  user.failedLoginAttempts = 0;
  user.lockedUntil = undefined;
  user.lastLogin = new Date().toISOString();
  await saveUsers(users);

  // Generate a unique token ID for revocation support
  const jti = `${user.id}-${Date.now()}`;

  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role, jti },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRY }
  );

  // Set httpOnly cookie (primary auth mechanism — immune to XSS)
  setAuthCookie(res, token);

  // Also return token in body for backwards compatibility during migration
  res.json({
    token,
    user: { id: user.id, username: user.username, role: user.role },
    mustChangePassword: !!user.mustChangePassword,
  });
}

/**
 * Change password endpoint handler.
 */
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

  // Check password history — prevent reuse of recent passwords
  if (await isPasswordReused(newPassword, user)) {
    res.status(400).json({
      error: `Cannot reuse any of your last ${PASSWORD_HISTORY_SIZE} passwords. Choose a different password.`,
    });
    return;
  }

  // Push current hash into history before overwriting
  const history = user.passwordHistory || [];
  history.unshift(user.passwordHash);
  user.passwordHistory = history.slice(0, PASSWORD_HISTORY_SIZE);

  user.passwordHash = await bcrypt.hash(newPassword, 12);
  user.mustChangePassword = false;
  await saveUsers(users);

  // Revoke current token so user must re-login with new password
  if (req.user?.jti) {
    revokeToken(req.user.jti);
  }

  // Issue new token
  const jti = `${user.id}-${Date.now()}`;
  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role, jti },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRY }
  );

  setAuthCookie(res, token);

  logger.info('Password changed', { userId: user.id, username: user.username });
  res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
}

/**
 * Logout endpoint handler — revokes the current token server-side.
 */
export async function logoutHandler(req: AuthRequest, res: Response): Promise<void> {
  if (req.user?.jti) {
    revokeToken(req.user.jti);
  }
  clearAuthCookie(res);
  res.json({ message: 'Logged out' });
}

/**
 * Create a new user (admin only).
 */
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
    id: `user-${Date.now()}`,
    username,
    passwordHash,
    role: role === 'admin' ? 'admin' : 'user',
    createdAt: new Date().toISOString(),
  };

  users.push(newUser);
  await saveUsers(users);

  res.status(201).json({ user: { id: newUser.id, username: newUser.username, role: newUser.role } });
}

/**
 * JWT authentication middleware.
 * Accepts token from httpOnly cookie (preferred) or Authorization header (fallback).
 * Checks token validity AND server-side revocation.
 */
export function authenticate(req: AuthRequest, res: Response, next: NextFunction): void {
  // Prefer httpOnly cookie (immune to XSS), fall back to Authorization header
  const cookieToken = req.cookies?.[AUTH_COOKIE];
  const authHeader = req.headers.authorization;
  const token = cookieToken || (authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null);

  if (!token) {
    res.status(401).json({ error: 'No token provided' });
    return;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { id: string; username: string; role: 'admin' | 'user'; jti?: string };

    // Check server-side revocation
    if (decoded.jti && isTokenRevoked(decoded.jti)) {
      res.status(401).json({ error: 'Token has been revoked' });
      return;
    }

    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
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
