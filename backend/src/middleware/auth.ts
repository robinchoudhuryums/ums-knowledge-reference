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
import { generateMfaSecret, verifyMfaCode, generateRecoveryCodes, verifyRecoveryCode } from '../services/mfa';
import { logAuditEvent } from '../services/audit';
import { sendEmail, isEmailConfigured } from '../services/emailService';
import { createMutex } from '../utils/asyncMutex';

// Per-username mutex so concurrent login attempts for the same user
// (e.g. two MFA-recovery-code submissions within milliseconds) are
// serialized. Without this, two logins could both read the same
// users snapshot, both splice the same recovery code, and both succeed
// — breaking the single-use guarantee (C2).
//
// Map entries are keyed by case-normalized username and live for the
// process lifetime; the memory footprint is negligible (one closure per
// active user). A distributed deployment would need Redis-backed
// locking, but the current architecture is single-instance.
const loginMutexesByUser = new Map<string, ReturnType<typeof createMutex>>();
function getLoginMutex(username: string): ReturnType<typeof createMutex> {
  const key = username.toLowerCase();
  let m = loginMutexesByUser.get(key);
  if (!m) {
    m = createMutex();
    loginMutexesByUser.set(key, m);
  }
  return m;
}

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
  REFRESH_COOKIE,
  setAuthCookie,
  setRefreshCookie,
  clearAuthCookie,
  revokeToken,
  revokeAllUserTokens,
} from './tokenService';

import {
  validatePassword,
  isPasswordReused,
  isAccountLocked,
  updateLockoutCache,
  isAccountLockedFromCache,
  MAX_FAILED_ATTEMPTS,
  LOCKOUT_DURATION_MS,
  PASSWORD_HISTORY_SIZE,
} from './authConfig';

import {
  AUTH_COOKIE,
  REFRESH_COOKIE,
  setAuthCookie,
  setRefreshCookie,
  clearAuthCookie,
  createToken,
  createRefreshToken,
  verifyToken,
  revokeToken,
  revokeAllUserTokens,
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
  const { username, password, mfaCode } = req.body;

  if (!username || !password) {
    res.status(400).json({ error: 'Username and password are required' });
    return;
  }

  // Serialize per-username so concurrent login attempts cannot race on
  // MFA recovery-code consumption (C2) or on failedLoginAttempts counter
  // updates. All read-modify-write of the users list runs inside this
  // lock; response emission happens outside.
  type LoginOutcome =
    | { kind: 'locked' }
    | { kind: 'invalid_credentials' }
    | { kind: 'mfa_required' }
    | { kind: 'invalid_mfa' }
    | { kind: 'ok'; user: User };

  const outcome: LoginOutcome = await getLoginMutex(username)(async () => {
    const users = await getUsers();
    const user = users.find(u => u.username === username);

    if (user && isAccountLocked(user)) {
      // Log without timing details — revealing remaining lockout time aids brute-force timing attacks
      logger.warn('Login attempt on locked account', { username });
      return { kind: 'locked' };
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
      return { kind: 'invalid_credentials' };
    }

    // MFA check: if user has MFA enabled, require a valid TOTP code
    if (user.mfaEnabled && user.mfaSecret) {
      if (!mfaCode) {
        // Password correct but MFA code not provided — tell frontend to prompt for it
        return { kind: 'mfa_required' };
      }
      // Try TOTP code first, then recovery code
      let mfaValid = verifyMfaCode(user.mfaSecret, mfaCode);

      if (!mfaValid && user.mfaRecoveryCodes && user.mfaRecoveryCodes.length > 0) {
        // Check if it's a recovery code (format: XXXX-XXXX)
        const recoveryIdx = await verifyRecoveryCode(mfaCode, user.mfaRecoveryCodes);
        if (recoveryIdx >= 0) {
          // Atomic consume: splice + save inside the mutex guarantees
          // a recovery code authenticates at most one concurrent login.
          user.mfaRecoveryCodes.splice(recoveryIdx, 1);
          mfaValid = true;
          logger.info('MFA login via recovery code', { userId: user.id, remainingCodes: user.mfaRecoveryCodes.length });
          logAuditEvent(user.id, user.username, 'login', {
            action: 'mfa_recovery_code_used',
            remainingCodes: user.mfaRecoveryCodes.length,
          }).catch((err) => { logger.error('Failed to write MFA recovery audit event', { error: String(err) }); });
        }
      }

      if (!mfaValid) {
        user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;
        if (user.failedLoginAttempts >= MAX_FAILED_ATTEMPTS) {
          user.lockedUntil = new Date(Date.now() + LOCKOUT_DURATION_MS).toISOString();
        }
        await saveUsers(users);
        return { kind: 'invalid_mfa' };
      }
    }

    user.failedLoginAttempts = 0;
    user.lockedUntil = undefined;
    user.lastLogin = new Date().toISOString();
    await saveUsers(users);
    return { kind: 'ok', user };
  });

  if (outcome.kind === 'locked') {
    res.status(423).json({ error: 'Account is locked due to too many failed attempts. Please try again later.' });
    return;
  }
  if (outcome.kind === 'invalid_credentials') {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }
  if (outcome.kind === 'mfa_required') {
    res.status(200).json({ mfaRequired: true });
    return;
  }
  if (outcome.kind === 'invalid_mfa') {
    res.status(401).json({ error: 'Invalid MFA code or recovery code' });
    return;
  }

  const user = outcome.user;

  const jti = crypto.randomUUID();
  const token = createToken({ id: user.id, username: user.username, role: user.role, jti });
  setAuthCookie(res, token);

  // Issue refresh token (7-day lifetime) for long-running sessions
  const refreshJti = crypto.randomUUID();
  const refreshToken = createRefreshToken({ id: user.id, username: user.username, role: user.role, jti: refreshJti });
  setRefreshCookie(res, refreshToken);

  // Audit trail for successful login (HIPAA §164.308(a)(5)(ii)(C))
  logAuditEvent(user.id, user.username, 'login', {
    action: 'login_success',
    mfaUsed: !!user.mfaEnabled,
  }).catch(err => logger.warn('Failed to log login audit event', { error: String(err) }));

  res.json({
    token,
    user: { id: user.id, username: user.username, role: user.role },
    mustChangePassword: !!user.mustChangePassword,
    mfaEnabled: !!user.mfaEnabled,
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

  // Revoke ALL sessions, not just the current one — password change must
  // invalidate all tokens in case of compromise (INV-12)
  revokeAllUserTokens(user.id);

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

/**
 * Refresh access token using a valid refresh token.
 * The refresh token is in an httpOnly cookie scoped to /api/auth/refresh.
 * Issues a new short-lived access token without requiring re-authentication.
 * Checks revocation and lockout status before issuing.
 */
export async function refreshTokenHandler(req: Request, res: Response): Promise<void> {
  const refreshTokenValue = req.cookies?.[REFRESH_COOKIE];
  if (!refreshTokenValue) {
    res.status(401).json({ error: 'No refresh token' });
    return;
  }

  let decoded: { id: string; username: string; role: 'admin' | 'user'; jti?: string; type?: string };
  try {
    decoded = verifyToken(refreshTokenValue);
  } catch {
    res.status(401).json({ error: 'Invalid or expired refresh token' });
    return;
  }

  // Verify this is actually a refresh token, not an access token
  if ((decoded as Record<string, unknown>).type !== 'refresh') {
    res.status(401).json({ error: 'Invalid token type' });
    return;
  }

  // Check revocation (individual token or all tokens for user)
  if ((decoded.jti && await isTokenRevoked(decoded.jti)) || await isUserRevoked(decoded.id)) {
    res.status(401).json({ error: 'Token has been revoked' });
    return;
  }

  // Check account lockout
  try {
    const users = await getUsers();
    const user = users.find(u => u.id === decoded.id);
    if (!user) {
      res.status(401).json({ error: 'User not found' });
      return;
    }
    if (isAccountLocked(user)) {
      res.status(423).json({ error: 'Account is locked' });
      return;
    }
  } catch {
    if (isAccountLockedFromCache(decoded.id)) {
      res.status(423).json({ error: 'Account is locked' });
      return;
    }
  }

  // Issue new access token
  const jti = crypto.randomUUID();
  const token = createToken({ id: decoded.id, username: decoded.username, role: decoded.role, jti });
  setAuthCookie(res, token);

  res.json({ token, user: { id: decoded.id, username: decoded.username, role: decoded.role } });
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

// ─── MFA Handlers ───────────────────────────────────────────────────────────

/**
 * Start MFA setup — generates a secret and returns the otpauth URI.
 * The secret is stored on the user but mfaEnabled remains false until verified.
 */
export async function mfaSetupHandler(req: AuthRequest, res: Response): Promise<void> {
  const users = await getUsers();
  const user = users.find(u => u.id === req.user!.id);
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  if (user.mfaEnabled) {
    res.status(400).json({ error: 'MFA is already enabled. Disable it first to reconfigure.' });
    return;
  }

  const { secret, uri, rawSecret } = generateMfaSecret(user.username);
  user.mfaSecret = secret;  // Encrypted at rest (if FIELD_ENCRYPTION_KEY is set)
  user.mfaEnabled = false;
  await saveUsers(users);

  logAuditEvent(user.id, user.username, 'user_update', { action: 'mfa_setup_initiated' })
    .catch(err => logger.warn('Audit log failed', { error: String(err) }));
  logger.info('MFA setup initiated', { userId: user.id });
  // Return the raw (unencrypted) secret for the user to enter in their authenticator app.
  // This is the only time the raw secret is exposed — it's stored encrypted.
  res.json({ uri, secret: rawSecret });
}

/**
 * Verify MFA setup — confirms the user's authenticator app is working
 * by validating a TOTP code. Enables MFA on success.
 */
export async function mfaVerifyHandler(req: AuthRequest, res: Response): Promise<void> {
  const { code } = req.body;
  if (!code || typeof code !== 'string') {
    res.status(400).json({ error: 'MFA code is required' });
    return;
  }

  const users = await getUsers();
  const user = users.find(u => u.id === req.user!.id);
  if (!user || !user.mfaSecret) {
    res.status(400).json({ error: 'MFA setup has not been initiated. Call /api/auth/mfa/setup first.' });
    return;
  }

  if (user.mfaEnabled) {
    res.status(400).json({ error: 'MFA is already enabled.' });
    return;
  }

  if (!verifyMfaCode(user.mfaSecret, code)) {
    res.status(400).json({ error: 'Invalid code. Make sure your authenticator app shows the correct code and try again.' });
    return;
  }

  // Generate recovery codes when MFA is first enabled
  const { plainCodes, hashedCodes } = await generateRecoveryCodes();

  user.mfaEnabled = true;
  user.mfaRecoveryCodes = hashedCodes;
  await saveUsers(users);

  logAuditEvent(user.id, user.username, 'user_update', { action: 'mfa_enabled', recoveryCodesGenerated: plainCodes.length })
    .catch(err => logger.warn('Audit log failed', { error: String(err) }));
  logger.info('MFA enabled with recovery codes', { userId: user.id });
  res.json({
    message: 'MFA is now enabled. Save your recovery codes — they will not be shown again.',
    recoveryCodes: plainCodes,
  });
}

/**
 * Disable MFA for the current user. Requires the current password for security.
 */
export async function mfaDisableHandler(req: AuthRequest, res: Response): Promise<void> {
  const { password } = req.body;
  if (!password) {
    res.status(400).json({ error: 'Password is required to disable MFA' });
    return;
  }

  const users = await getUsers();
  const user = users.find(u => u.id === req.user!.id);
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  if (!user.mfaEnabled) {
    res.status(400).json({ error: 'MFA is not currently enabled.' });
    return;
  }

  if (!(await bcrypt.compare(password, user.passwordHash))) {
    res.status(401).json({ error: 'Incorrect password' });
    return;
  }

  user.mfaSecret = undefined;
  user.mfaEnabled = false;
  user.mfaRecoveryCodes = undefined;
  await saveUsers(users);

  logAuditEvent(user.id, user.username, 'user_update', { action: 'mfa_disabled_by_user' })
    .catch(err => logger.warn('Audit log failed', { error: String(err) }));
  logger.info('MFA disabled', { userId: user.id });
  res.json({ message: 'MFA has been disabled.' });
}

// ─── Forgot Password ────────────────────────────────────────────────────────

// Password reset codes stored via cache abstraction (in-memory or Redis).
// TTL-based expiration eliminates manual cleanup. Multi-instance safe when
// REDIS_URL is configured (codes set on instance A are visible on instance B).
import { getCache } from '../cache';
const RESET_CODE_PREFIX = 'reset-code:';
const RESET_CODE_TTL_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Request a password reset code sent via email.
 * Requires the user's username and email to be configured on the account.
 * Rate-limited by the login limiter to prevent abuse.
 */
export async function forgotPasswordHandler(req: Request, res: Response): Promise<void> {
  const { username } = req.body;

  if (!username) {
    res.status(400).json({ error: 'Username is required' });
    return;
  }

  // Always return success (don't reveal whether username exists)
  const successMsg = 'If this account exists and has email configured, a reset code has been sent.';

  if (!isEmailConfigured()) {
    logger.warn('Forgot password requested but SMTP not configured');
    res.json({ message: successMsg });
    return;
  }

  const users = await getUsers();
  const user = users.find(u => u.username === username);

  if (!user) {
    // Don't reveal that user doesn't exist — same response
    res.json({ message: successMsg });
    return;
  }

  // Generate a 6-digit numeric code (easy to type from email)
  const code = crypto.randomInt(100000, 999999).toString();

  // Store code with TTL — auto-expires, no manual cleanup needed
  await getCache().set(`${RESET_CODE_PREFIX}${code}`, { userId: user.id }, RESET_CODE_TTL_MS);

  // Send email with reset code — directly to user if they have an email,
  // otherwise fall back to admin email
  const recipientEmail = user.email || process.env.SMTP_FROM || process.env.SMTP_USER;
  if (recipientEmail) {
    try {
      await sendEmail({
        to: recipientEmail,
        subject: 'UMS Knowledge Base — Password Reset Code',
        html: `
          <h2>Password Reset Request</h2>
          <p>A password reset was requested for your account: <strong>${user.username}</strong></p>
          <p style="margin: 20px 0;">Your reset code:</p>
          <div style="text-align: center; padding: 16px; background: #f5f5f5; border-radius: 8px; margin: 12px 0;">
            <span style="font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #1565C0;">${code}</span>
          </div>
          <p>This code expires in <strong>15 minutes</strong>.</p>
          <p style="color: #666; font-size: 13px;">If you did not request this, no action is needed. Your password has not been changed.</p>
        `,
      });
    } catch (err) {
      logger.error('Failed to send password reset email', { error: String(err) });
    }
  }

  logAuditEvent(user.id, user.username, 'user_update', { action: 'password_reset_requested' })
    .catch(err => logger.warn('Audit log failed', { error: String(err) }));

  res.json({ message: successMsg });
}

/**
 * Reset password using a reset code.
 */
export async function resetPasswordWithCodeHandler(req: Request, res: Response): Promise<void> {
  const { username, code, newPassword } = req.body;

  if (!username || !code || !newPassword) {
    res.status(400).json({ error: 'Username, code, and new password are required' });
    return;
  }

  const passwordError = validatePassword(newPassword);
  if (passwordError) {
    res.status(400).json({ error: passwordError });
    return;
  }

  // Look up code from cache (TTL handles expiration automatically)
  const entry = await getCache().get<{ userId: string }>(`${RESET_CODE_PREFIX}${code}`);
  if (!entry) {
    res.status(400).json({ error: 'Invalid or expired reset code' });
    return;
  }

  const users = await getUsers();
  const user = users.find(u => u.username === username && u.id === entry.userId);

  if (!user) {
    res.status(400).json({ error: 'Invalid or expired reset code' });
    return;
  }

  // Consume the code (single use) — delete from cache
  await getCache().delete(`${RESET_CODE_PREFIX}${code}`);

  // Check password history
  if (await isPasswordReused(newPassword, user)) {
    res.status(400).json({
      error: `Cannot reuse any of your last ${PASSWORD_HISTORY_SIZE} passwords.`,
    });
    return;
  }

  const history = user.passwordHistory || [];
  history.unshift(user.passwordHash);
  user.passwordHistory = history.slice(0, PASSWORD_HISTORY_SIZE);

  user.passwordHash = await bcrypt.hash(newPassword, 12);
  user.mustChangePassword = false;
  user.failedLoginAttempts = 0;
  user.lockedUntil = undefined;
  await saveUsers(users);

  // Revoke all existing sessions — password reset must invalidate prior tokens (INV-12)
  revokeAllUserTokens(user.id);

  logAuditEvent(user.id, user.username, 'user_update', { action: 'password_reset_completed' })
    .catch(err => logger.warn('Audit log failed', { error: String(err) }));

  logger.info('Password reset via code', { userId: user.id, username: user.username });
  res.json({ message: 'Password has been reset. You can now log in with your new password.' });
}

// ─── Middleware ──────────────────────────────────────────────────────────────

/**
 * JWT authentication middleware.
 * Accepts token from httpOnly cookie (preferred) or Authorization header (fallback).
 * Also supports service-to-service API key via X-API-Key header (for external integrations).
 * Checks token validity, server-side revocation, AND account lockout status.
 */
export function authenticate(req: AuthRequest, res: Response, next: NextFunction): void {
  // Service-to-service API key auth (for external integrations like CallAnalyzer)
  const apiKey = req.headers['x-api-key'] as string | undefined;
  const serviceApiKey = process.env.SERVICE_API_KEY;
  if (apiKey && serviceApiKey && apiKey.length >= 32) {
    // Timing-safe comparison to prevent timing attacks
    const keyBuffer = Buffer.from(apiKey);
    const expectedBuffer = Buffer.from(serviceApiKey);
    if (keyBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(keyBuffer, expectedBuffer)) {
      req.user = {
        id: 'service-account',
        username: process.env.SERVICE_API_USERNAME || 'call-analyzer',
        role: 'user',
      };
      next();
      return;
    }
  }

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

  // Async revocation + lockout check
  (async () => {
    // Check server-side revocation (individual token or all tokens for user)
    if ((decoded.jti && await isTokenRevoked(decoded.jti)) || await isUserRevoked(decoded.id)) {
      res.status(401).json({ error: 'Token has been revoked' });
      return;
    }

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
