/**
 * Integration tests for the authentication flow.
 *
 * These tests mock the S3 storage layer and test the auth handlers
 * as pure functions (without starting an HTTP server).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response } from 'express';

// Mock S3 storage before importing auth
vi.mock('../services/s3Storage', () => {
  let store: Record<string, unknown> = {};
  return {
    loadMetadata: vi.fn(async <T>(key: string): Promise<T | null> => {
      return (store[key] as T) || null;
    }),
    saveMetadata: vi.fn(async (key: string, data: unknown) => {
      store[key] = data;
    }),
    __resetStore: () => { store = {}; },
    __getStore: () => store,
  };
});

// Mock database to prevent real connection attempts
vi.mock('../config/database', () => ({
  checkDatabaseConnection: vi.fn(async () => false),
  getPool: vi.fn(() => null),
  closeDatabasePool: vi.fn(async () => {}),
}));

// Mock db layer
vi.mock('../db', async (importOriginal) => {
  const orig = await importOriginal() as Record<string, unknown>;
  return {
    ...orig,
    useRds: vi.fn(async () => false),
  };
});

// Mock config/aws to prevent real AWS SDK initialization
vi.mock('../config/aws', () => ({
  s3Client: { send: vi.fn(async () => ({})) },
  bedrockClient: { send: vi.fn(async () => ({})) },
  bedrockCircuitBreaker: { execute: (fn: () => Promise<unknown>) => fn() },
  S3_BUCKET: 'test-bucket',
  S3_PREFIXES: { documents: 'documents/', vectors: 'vectors/', metadata: 'metadata/', audit: 'audit/', cache: 'cache/' },
  BEDROCK_EMBEDDING_MODEL: 'test-model',
  BEDROCK_GENERATION_MODEL: 'test-model',
  BEDROCK_EXTRACTION_MODEL: 'test-model',
}));

// Mock audit service (imported by auth.ts for MFA audit logging)
vi.mock('../services/audit', () => ({
  logAuditEvent: vi.fn(async () => {}),
}));

// Must import after mocks are set up
import bcrypt from 'bcryptjs';
import { initializeAuth, loginHandler, changePasswordHandler, authenticate, createUserHandler, refreshTokenHandler, resetPasswordWithCodeHandler, AuthRequest } from '../middleware/auth';
import { isUserRevoked } from '../middleware/tokenService';
import { logAuditEvent } from '../services/audit';
import { getCache, getSets } from '../cache';
import * as s3Mock from '../services/s3Storage';
const { __resetStore, __getStore } = s3Mock as any;

/**
 * Helper: initialize auth and set the admin password to a known value for testing.
 * Since initializeAuth now generates a random password, tests need a known password.
 */
async function initAuthWithKnownPassword(password = 'Admin1234!'): Promise<void> {
  await initializeAuth();
  const store = __getStore();
  const users = store['users.json'] as any[];
  users[0].passwordHash = await bcrypt.hash(password, 4); // low rounds for speed
}

function mockRes(): Response {
  const res: Partial<Response> = {
    status: vi.fn().mockReturnThis() as any,
    json: vi.fn().mockReturnThis() as any,
    cookie: vi.fn().mockReturnThis() as any,
    clearCookie: vi.fn().mockReturnThis() as any,
  };
  return res as Response;
}

function mockReq(body: Record<string, unknown> = {}, headers: Record<string, string> = {}): Request {
  return {
    body,
    headers,
    cookies: {},
  } as unknown as Request;
}

describe('Auth Flow', () => {
  beforeEach(async () => {
    __resetStore();
    // Clear token revocation state between tests (admin-001 is reused across tests)
    await getSets().remove('revoked-tokens', 'admin-001');
    await getSets().remove('revoked-users', 'admin-001');
  });

  it('initializes default admin user on first run', async () => {
    await initializeAuth();
    const { __getStore } = s3Mock as any;
    const store = __getStore();
    const users = store['users.json'] as any[];
    expect(users).toHaveLength(1);
    expect(users[0].username).toBe('admin');
    expect(users[0].role).toBe('admin');
    expect(users[0].mustChangePassword).toBe(true);
  });

  it('does not recreate admin if users already exist', async () => {
    // First init creates admin
    await initializeAuth();
    // Second init should not duplicate
    await initializeAuth();
    const { __getStore } = s3Mock as any;
    const users = __getStore()['users.json'] as any[];
    expect(users).toHaveLength(1);
  });

  it('rejects login with missing credentials', async () => {
    const req = mockReq({});
    const res = mockRes();
    await loginHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rejects login with wrong password', async () => {
    await initializeAuth();
    const req = mockReq({ username: 'admin', password: 'wrong' });
    const res = mockRes();
    await loginHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid credentials' });
  });

  it('succeeds login with correct password', async () => {
    await initAuthWithKnownPassword('Admin1234!');
    const req = mockReq({ username: 'admin', password: 'Admin1234!' });
    const res = mockRes();
    await loginHandler(req, res);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        token: expect.any(String),
        user: expect.objectContaining({ username: 'admin', role: 'admin' }),
        mustChangePassword: true,
      })
    );
    // Should set httpOnly cookie
    expect(res.cookie).toHaveBeenCalled();
  });

  it('locks account after 5 failed attempts', async () => {
    await initAuthWithKnownPassword('Admin1234!');
    for (let i = 0; i < 5; i++) {
      const req = mockReq({ username: 'admin', password: 'wrong' });
      const res = mockRes();
      await loginHandler(req, res);
    }
    // 6th attempt should be locked
    const req = mockReq({ username: 'admin', password: 'Admin1234!' });
    const res = mockRes();
    await loginHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(423);
  });

  it('rejects login for non-existent user', async () => {
    await initializeAuth();
    const req = mockReq({ username: 'ghost', password: 'pass' });
    const res = mockRes();
    await loginHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('authenticate middleware accepts valid token', async () => {
    await initAuthWithKnownPassword('Admin1234!');
    // Login to get a token
    const loginReq = mockReq({ username: 'admin', password: 'Admin1234!' });
    const loginRes = mockRes();
    await loginHandler(loginReq, loginRes);
    const token = (loginRes.json as any).mock.calls[0][0].token;

    // Use token in authenticate middleware.
    // authenticate() now performs an async lockout check (getUsers().then(...)),
    // so we need to wait for the promise chain to resolve before asserting.
    const req = mockReq({}, { authorization: `Bearer ${token}` }) as AuthRequest;
    const res = mockRes();
    const next = vi.fn();
    authenticate(req, res, next);
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(next).toHaveBeenCalled();
    expect(req.user).toBeDefined();
    expect(req.user!.username).toBe('admin');
  });

  it('authenticate middleware rejects invalid token', () => {
    const req = mockReq({}, { authorization: 'Bearer invalid.token.here' }) as AuthRequest;
    const res = mockRes();
    const next = vi.fn();
    authenticate(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('authenticate middleware rejects missing token', () => {
    const req = mockReq({}) as AuthRequest;
    const res = mockRes();
    const next = vi.fn();
    authenticate(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('change password rejects weak password', async () => {
    await initAuthWithKnownPassword('Admin1234!');

    const req = {
      body: { currentPassword: 'Admin1234!', newPassword: 'weak' },
      user: { id: 'admin-001', username: 'admin', role: 'admin' },
      headers: {},
      cookies: {},
    } as unknown as AuthRequest;
    const res = mockRes();
    await changePasswordHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('change password succeeds with strong password', async () => {
    await initAuthWithKnownPassword('Admin1234!');
    const req = {
      body: { currentPassword: 'Admin1234!', newPassword: 'StrongP4ss!' },
      user: { id: 'admin-001', username: 'admin', role: 'admin' },
      headers: {},
      cookies: {},
    } as unknown as AuthRequest;
    const res = mockRes();
    await changePasswordHandler(req, res);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        token: expect.any(String),
        user: expect.objectContaining({ username: 'admin' }),
      })
    );
  });

  it('change password issues token with cryptographically random jti (not predictable)', async () => {
    await initAuthWithKnownPassword('Admin1234!');
    const req = {
      body: { currentPassword: 'Admin1234!', newPassword: 'NewStr0ng!' },
      user: { id: 'admin-001', username: 'admin', role: 'admin' },
      headers: {},
      cookies: {},
    } as unknown as AuthRequest;
    const res = mockRes();
    await changePasswordHandler(req, res);

    // Extract token from response and decode its payload
    const { token } = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());

    // jti must be a valid UUID v4 format (not the old user-id-timestamp pattern)
    expect(payload.jti).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    // Must NOT contain the user ID (old predictable pattern was `${userId}-${timestamp}`)
    expect(payload.jti).not.toContain('admin-001');
  });

  it('create user rejects duplicate username', async () => {
    await initializeAuth();
    const req = {
      body: { username: 'admin', password: 'StrongP4ss!' },
      user: { id: 'admin-001', username: 'admin', role: 'admin' },
      headers: {},
      cookies: {},
    } as unknown as AuthRequest;
    const res = mockRes();
    await createUserHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('create user succeeds with valid input', async () => {
    await initializeAuth();
    const req = {
      body: { username: 'agent1', password: 'StrongP4ss!', role: 'user' },
      user: { id: 'admin-001', username: 'admin', role: 'admin' },
      headers: {},
      cookies: {},
    } as unknown as AuthRequest;
    const res = mockRes();
    await createUserHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        user: expect.objectContaining({ username: 'agent1', role: 'user' }),
      })
    );
  });

  // =========================================================================
  // Login Audit Trail (F-04 / INV-26)
  // =========================================================================
  it('successful login calls logAuditEvent with action login', async () => {
    await initAuthWithKnownPassword('Admin1234!');
    const req = mockReq({ username: 'admin', password: 'Admin1234!' });
    const res = mockRes();
    await loginHandler(req, res);
    expect(res.json).toHaveBeenCalled();
    // logAuditEvent should have been called with 'login' action
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.any(String),       // userId
      'admin',                  // username
      'login',                  // action
      expect.objectContaining({ action: 'login_success' })
    );
  });

  // =========================================================================
  // Login sets refresh token cookie
  // =========================================================================
  it('successful login sets both auth and refresh cookies', async () => {
    await initAuthWithKnownPassword('Admin1234!');
    const req = mockReq({ username: 'admin', password: 'Admin1234!' });
    const res = mockRes();
    await loginHandler(req, res);
    // Should set at least 2 cookies: ums_auth_token and ums_refresh_token
    const cookieCalls = (res.cookie as ReturnType<typeof vi.fn>).mock.calls;
    const cookieNames = cookieCalls.map((c: unknown[]) => c[0]);
    expect(cookieNames).toContain('ums_auth_token');
    expect(cookieNames).toContain('ums_refresh_token');
  });

  // =========================================================================
  // Refresh Token Handler
  // =========================================================================
  it('refresh handler issues new access token from valid refresh token', async () => {
    await initAuthWithKnownPassword('Admin1234!');
    // Login to get tokens
    const loginReq = mockReq({ username: 'admin', password: 'Admin1234!' });
    const loginRes = mockRes();
    await loginHandler(loginReq, loginRes);

    // Extract refresh token from cookie calls
    const cookieCalls = (loginRes.cookie as ReturnType<typeof vi.fn>).mock.calls;
    const refreshCall = cookieCalls.find((c: unknown[]) => c[0] === 'ums_refresh_token');
    expect(refreshCall).toBeDefined();
    const refreshToken = refreshCall![1] as string;

    // Call refresh handler with refresh token in cookie
    const refreshReq = { body: {}, headers: {}, cookies: { ums_refresh_token: refreshToken } } as unknown as Request;
    const refreshRes = mockRes();
    await refreshTokenHandler(refreshReq, refreshRes);

    // Should issue a new access token
    expect(refreshRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        token: expect.any(String),
        user: expect.objectContaining({ username: 'admin' }),
      })
    );
    // New auth cookie should be set
    expect(refreshRes.cookie).toHaveBeenCalled();
  });

  it('refresh handler rejects missing refresh token', async () => {
    const req = { body: {}, headers: {}, cookies: {} } as unknown as Request;
    const res = mockRes();
    await refreshTokenHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('refresh handler rejects access token used as refresh token', async () => {
    await initAuthWithKnownPassword('Admin1234!');
    const loginReq = mockReq({ username: 'admin', password: 'Admin1234!' });
    const loginRes = mockRes();
    await loginHandler(loginReq, loginRes);

    // Extract the ACCESS token (not refresh) and try to use it as a refresh token
    const accessToken = (loginRes.json as ReturnType<typeof vi.fn>).mock.calls[0][0].token;
    const req = { body: {}, headers: {}, cookies: { ums_refresh_token: accessToken } } as unknown as Request;
    const res = mockRes();
    await refreshTokenHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid token type' });
  });

  // =========================================================================
  // Password Reset via Code — Token Revocation (F-01 / INV-12)
  // =========================================================================
  it('password reset via code revokes all user tokens (INV-12)', async () => {
    await initAuthWithKnownPassword('Admin1234!');
    // Get the admin user's ID
    const store = __getStore();
    const users = store['users.json'] as any[];
    const userId = users[0].id;

    // Inject a reset code into cache
    await getCache().set('reset-code:999999', { userId }, 600_000);

    const req = mockReq({ username: 'admin', code: '999999', newPassword: 'NewStr0ng!' });
    const res = mockRes();
    await resetPasswordWithCodeHandler(req, res);

    // Should succeed
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('reset') })
    );

    // User should be revoked (all existing tokens invalidated)
    const revoked = await isUserRevoked(userId);
    expect(revoked).toBe(true);
  });

  // =========================================================================
  // Password Change — All Sessions Revoked (F-02 / INV-12)
  // =========================================================================
  it('password change revokes all user tokens, not just current (INV-12)', async () => {
    await initAuthWithKnownPassword('Admin1234!');
    const store = __getStore();
    const users = store['users.json'] as any[];
    const userId = users[0].id;

    const req = {
      body: { currentPassword: 'Admin1234!', newPassword: 'Changed1!' },
      user: { id: userId, username: 'admin', role: 'admin', jti: 'test-jti-123' },
      headers: {},
      cookies: {},
    } as unknown as AuthRequest;
    const res = mockRes();
    await changePasswordHandler(req, res);

    // Should succeed
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ token: expect.any(String) })
    );

    // User-level revocation should be active (covers all sessions)
    const revoked = await isUserRevoked(userId);
    expect(revoked).toBe(true);
  });
});
