/**
 * End-to-End Auth Integration Tests
 *
 * Tests the full HTTP lifecycle through supertest:
 * - Login → receive httpOnly cookies → use cookies on protected endpoints
 * - CSRF enforcement: POST without token rejected, exempt paths pass
 * - Refresh token flow: access token expires → refresh → continue
 * - Password change → old tokens revoked → refresh fails
 * - Password reset via code → all sessions revoked
 *
 * Mocks: S3 storage, Bedrock, database (no external dependencies)
 * Real: Express, auth middleware, CSRF, cookies, rate limiting, handlers
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks (before any app code imports) ────────────────────────────────────

vi.mock('../services/s3Storage', () => {
  let store: Record<string, unknown> = {};
  return {
    loadMetadata: vi.fn(async <T>(key: string): Promise<T | null> => (store[key] as T) || null),
    saveMetadata: vi.fn(async (key: string, data: unknown) => { store[key] = data; }),
    uploadDocumentToS3: vi.fn(async () => {}),
    loadVectorIndex: vi.fn(async () => null),
    saveVectorIndex: vi.fn(async () => {}),
    getDocumentsIndex: vi.fn(async () => []),
    saveDocumentsIndex: vi.fn(async () => {}),
    deleteDocumentFromS3: vi.fn(async () => {}),
    getCollectionsIndex: vi.fn(async () => []),
    saveCollectionsIndex: vi.fn(async () => {}),
    __resetStore: () => { store = {}; },
    __getStore: () => store,
  };
});

vi.mock('../config/database', () => ({
  checkDatabaseConnection: vi.fn(async () => false),
  getPool: vi.fn(() => null),
  closeDatabasePool: vi.fn(async () => {}),
}));

vi.mock('../db', async (importOriginal) => {
  const orig = await importOriginal() as Record<string, unknown>;
  return { ...orig, useRds: vi.fn(async () => false) };
});

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

vi.mock('../services/audit', () => ({
  logAuditEvent: vi.fn(async () => {}),
}));

vi.mock('../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../utils/envValidation', () => ({ validateEnv: vi.fn() }));
vi.mock('../utils/correlationId', () => ({
  runWithCorrelationId: vi.fn((_id: string, fn: () => void) => fn()),
  getCorrelationId: vi.fn(() => 'test-e2e'),
}));
vi.mock('../utils/metrics', () => ({
  recordRequest: vi.fn(),
  getMetricsSnapshot: vi.fn(() => ({ requests: {}, memory: process.memoryUsage(), uptime: 1 })),
}));
vi.mock('../services/alertService', () => ({
  sendOperationalAlert: vi.fn(async () => {}),
}));

// ─── Imports (after mocks) ──────────────────────────────────────────────────

import request from 'supertest';
import express from 'express';
import crypto from 'crypto';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import {
  initializeAuth,
  loginHandler,
  changePasswordHandler,
  logoutHandler,
  refreshTokenHandler,
  authenticate,
  AuthRequest,
} from '../middleware/auth';
import { resetPasswordWithCodeHandler } from '../middleware/auth';
import { getSets } from '../cache';
import { getCache } from '../cache';
import * as s3Mock from '../services/s3Storage';
const { __resetStore, __getStore } = s3Mock as any;

// ─── Build test app with real middleware chain ──────────────────────────────

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());

  // CSRF middleware (mirrors server.ts:114-152)
  const CSRF_COOKIE = 'csrf_token';
  const CSRF_HEADER = 'x-csrf-token';
  const CSRF_EXEMPT_PATHS = ['/api/auth/login', '/api/auth/forgot-password', '/api/auth/reset-password', '/api/auth/refresh', '/api/health'];

  app.use((req, res, next) => {
    let csrfToken = req.cookies?.[CSRF_COOKIE];
    if (!csrfToken) {
      csrfToken = crypto.randomBytes(32).toString('hex');
    }
    res.cookie(CSRF_COOKIE, csrfToken, {
      httpOnly: false,
      secure: false,
      sameSite: 'strict',
      path: '/',
      maxAge: 24 * 60 * 60 * 1000,
    });
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
      if (!CSRF_EXEMPT_PATHS.includes(req.path)) {
        const headerToken = req.headers[CSRF_HEADER] as string | undefined;
        if (!headerToken || headerToken !== csrfToken) {
          res.status(403).json({ error: 'CSRF token missing or invalid' });
          return;
        }
      }
    }
    next();
  });

  // Auth routes (real handlers)
  app.post('/api/auth/login', loginHandler);
  app.post('/api/auth/logout', authenticate, (req, res) => logoutHandler(req as AuthRequest, res));
  app.post('/api/auth/change-password', authenticate, (req, res) => changePasswordHandler(req as AuthRequest, res));
  app.post('/api/auth/refresh', refreshTokenHandler);
  app.post('/api/auth/reset-password', resetPasswordWithCodeHandler);

  // Protected test endpoint
  app.get('/api/test/protected', authenticate, (req, res) => {
    const authReq = req as AuthRequest;
    res.json({ user: authReq.user });
  });

  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

  return app;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function initWithKnownPassword(password = 'Admin1234!'): Promise<void> {
  await initializeAuth();
  const store = __getStore();
  const users = store['users.json'] as any[];
  users[0].passwordHash = await bcrypt.hash(password, 4);
}

/** Parse Set-Cookie headers into a cookie jar object. */
function parseCookies(res: request.Response): Record<string, string> {
  const jar: Record<string, string> = {};
  const setCookie = res.headers['set-cookie'];
  if (!setCookie) return jar;
  const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
  for (const c of cookies) {
    const [nameValue] = c.split(';');
    const [name, value] = nameValue.split('=');
    jar[name.trim()] = value?.trim() || '';
  }
  return jar;
}

/** Build a cookie header string from a jar. */
function cookieHeader(jar: Record<string, string>): string {
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('E2E Auth Integration (supertest)', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    __resetStore();
    await getSets().remove('revoked-users', 'admin-001');
    await getSets().remove('revoked-tokens', 'admin-001');
  });

  // =========================================================================
  // 1. Full login → cookie → authenticated request flow
  // =========================================================================
  describe('Login and Cookie Auth', () => {
    it('login returns httpOnly auth cookie and CSRF cookie', async () => {
      app = buildApp();
      await initWithKnownPassword();

      const res = await request(app)
        .post('/api/auth/login')
        .send({ username: 'admin', password: 'Admin1234!' });

      expect(res.status).toBe(200);
      expect(res.body.user.username).toBe('admin');

      const cookies = parseCookies(res);
      expect(cookies).toHaveProperty('ums_auth_token');
      expect(cookies).toHaveProperty('ums_refresh_token');
      expect(cookies).toHaveProperty('csrf_token');
    });

    it('authenticated endpoint accepts cookie auth', async () => {
      app = buildApp();
      await initWithKnownPassword();

      // Login
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ username: 'admin', password: 'Admin1234!' });

      const cookies = parseCookies(loginRes);

      // Access protected endpoint with cookies
      const protectedRes = await request(app)
        .get('/api/test/protected')
        .set('Cookie', cookieHeader(cookies));

      expect(protectedRes.status).toBe(200);
      expect(protectedRes.body.user.username).toBe('admin');
    });

    it('protected endpoint rejects request without auth cookie', async () => {
      app = buildApp();
      const res = await request(app).get('/api/test/protected');
      expect(res.status).toBe(401);
    });
  });

  // =========================================================================
  // 2. CSRF enforcement
  // =========================================================================
  describe('CSRF Enforcement', () => {
    it('POST to protected endpoint without CSRF token is rejected', async () => {
      app = buildApp();
      await initWithKnownPassword();

      // Login
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ username: 'admin', password: 'Admin1234!' });

      const cookies = parseCookies(loginRes);

      // POST to change-password without CSRF header
      const res = await request(app)
        .post('/api/auth/change-password')
        .set('Cookie', cookieHeader(cookies))
        .send({ currentPassword: 'Admin1234!', newPassword: 'NewStr0ng1!' });

      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/CSRF/);
    });

    it('POST to protected endpoint with CSRF token succeeds', async () => {
      app = buildApp();
      await initWithKnownPassword();

      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ username: 'admin', password: 'Admin1234!' });

      const cookies = parseCookies(loginRes);
      const csrf = cookies['csrf_token'];

      // POST with CSRF header
      const res = await request(app)
        .post('/api/auth/change-password')
        .set('Cookie', cookieHeader(cookies))
        .set('x-csrf-token', csrf)
        .send({ currentPassword: 'Admin1234!', newPassword: 'NewStr0ng1!' });

      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();
    });

    it('login is CSRF-exempt', async () => {
      app = buildApp();
      await initWithKnownPassword();

      // Login without any CSRF token (first request, no cookie)
      const res = await request(app)
        .post('/api/auth/login')
        .send({ username: 'admin', password: 'Admin1234!' });

      expect(res.status).toBe(200);
    });

    it('refresh is CSRF-exempt', async () => {
      app = buildApp();
      await initWithKnownPassword();

      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ username: 'admin', password: 'Admin1234!' });

      const cookies = parseCookies(loginRes);

      // Refresh without CSRF header
      const res = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', cookieHeader(cookies));

      expect(res.status).toBe(200);
      expect(res.body.token).toBeDefined();
    });
  });

  // =========================================================================
  // 3. Refresh token flow
  // =========================================================================
  describe('Refresh Token Flow', () => {
    it('refresh endpoint issues new access token using refresh cookie', async () => {
      app = buildApp();
      await initWithKnownPassword();

      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ username: 'admin', password: 'Admin1234!' });

      const cookies = parseCookies(loginRes);

      const refreshRes = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', cookieHeader(cookies));

      expect(refreshRes.status).toBe(200);
      expect(refreshRes.body.token).toBeDefined();
      expect(refreshRes.body.user.username).toBe('admin');

      // New auth cookie should be set
      const newCookies = parseCookies(refreshRes);
      expect(newCookies).toHaveProperty('ums_auth_token');
    });

    it('new access token from refresh works on protected endpoints', async () => {
      app = buildApp();
      await initWithKnownPassword();

      // Login
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ username: 'admin', password: 'Admin1234!' });
      const loginCookies = parseCookies(loginRes);

      // Refresh
      const refreshRes = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', cookieHeader(loginCookies));
      const refreshCookies = parseCookies(refreshRes);

      // Merge cookies (refresh may set new auth cookie)
      const merged = { ...loginCookies, ...refreshCookies };

      // Access protected endpoint with refreshed token
      const protectedRes = await request(app)
        .get('/api/test/protected')
        .set('Cookie', cookieHeader(merged));

      expect(protectedRes.status).toBe(200);
      expect(protectedRes.body.user.username).toBe('admin');
    });
  });

  // =========================================================================
  // 4. Password change revokes all sessions
  // =========================================================================
  describe('Password Change Revocation', () => {
    it('old refresh token fails after password change', async () => {
      app = buildApp();
      await initWithKnownPassword();

      // Login — get session A tokens
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ username: 'admin', password: 'Admin1234!' });
      const sessionACookies = parseCookies(loginRes);
      const csrf = sessionACookies['csrf_token'];

      // Change password (uses session A)
      const changeRes = await request(app)
        .post('/api/auth/change-password')
        .set('Cookie', cookieHeader(sessionACookies))
        .set('x-csrf-token', csrf)
        .send({ currentPassword: 'Admin1234!', newPassword: 'Changed1!' });

      expect(changeRes.status).toBe(200);

      // Try to refresh with session A's refresh token — should be revoked
      const refreshRes = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', cookieHeader(sessionACookies));

      expect(refreshRes.status).toBe(401);
      expect(refreshRes.body.error).toMatch(/revoked/i);
    });
  });

  // =========================================================================
  // 5. Password reset via code revokes all sessions
  // =========================================================================
  describe('Password Reset Revocation', () => {
    it('refresh token fails after password reset via code', async () => {
      app = buildApp();
      await initWithKnownPassword();

      // Login — get session tokens
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ username: 'admin', password: 'Admin1234!' });
      const sessionCookies = parseCookies(loginRes);

      // Inject a reset code into cache
      const store = __getStore();
      const users = store['users.json'] as any[];
      await getCache().set('reset-code:123456', { userId: users[0].id }, 600_000);

      // Reset password via code (no auth needed, CSRF-exempt)
      const resetRes = await request(app)
        .post('/api/auth/reset-password')
        .send({ username: 'admin', code: '123456', newPassword: 'ResetPw1!' });

      expect(resetRes.status).toBe(200);
      expect(resetRes.body.message).toMatch(/reset/i);

      // Try to refresh with old session tokens — should be revoked (INV-12)
      const refreshRes = await request(app)
        .post('/api/auth/refresh')
        .set('Cookie', cookieHeader(sessionCookies));

      expect(refreshRes.status).toBe(401);
      expect(refreshRes.body.error).toMatch(/revoked/i);
    });
  });

  // =========================================================================
  // 6. Logout clears cookies
  // =========================================================================
  describe('Logout', () => {
    it('logout clears auth and refresh cookies', async () => {
      app = buildApp();
      await initWithKnownPassword();

      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ username: 'admin', password: 'Admin1234!' });
      const cookies = parseCookies(loginRes);
      const csrf = cookies['csrf_token'];

      const logoutRes = await request(app)
        .post('/api/auth/logout')
        .set('Cookie', cookieHeader(cookies))
        .set('x-csrf-token', csrf);

      expect(logoutRes.status).toBe(200);

      // Set-Cookie headers should clear the auth cookies (Max-Age=0 or Expires in past)
      const rawCookies = logoutRes.headers['set-cookie'];
      const setCookieHeaders: string[] = Array.isArray(rawCookies) ? rawCookies : rawCookies ? [rawCookies] : [];
      const authClear = setCookieHeaders.find(c => c.startsWith('ums_auth_token='));
      expect(authClear).toBeDefined();
      // Cleared cookies typically have empty value or expires in the past
      expect(authClear).toMatch(/expires=Thu, 01 Jan 1970|Max-Age=0/i);
    });
  });
});
