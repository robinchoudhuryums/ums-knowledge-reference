/**
 * Integration tests for the SSO introspection middleware + resolveSsoUser.
 *
 * Mocks the network call to CA's /sso-verify via a vi.stubGlobal on fetch.
 * Mocks the S3 storage + DB layer the same way auth.test.ts does so user
 * state is in-memory and isolated per test.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';

// Override authConfig BEFORE sso imports it so ENABLE_SSO is true and
// CA_BASE_URL is a stable test URL. vi.mock is hoisted above imports.
vi.mock('../middleware/authConfig', async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    ENABLE_SSO: true,
    CA_BASE_URL: 'http://mock-ca.test',
  };
});

// Mock S3 storage (same pattern as auth.test.ts — gives getUsers/saveUsers
// an in-memory backing store).
vi.mock('../services/s3Storage', () => {
  let store: Record<string, unknown> = {};
  return {
    loadMetadata: vi.fn(async <T>(key: string): Promise<T | null> => {
      return (store[key] as T) || null;
    }),
    saveMetadata: vi.fn(async (key: string, data: unknown) => {
      store[key] = data;
    }),
    __resetStore: () => {
      store = {};
    },
    __getStore: () => store,
  };
});

vi.mock('../config/database', () => ({
  checkDatabaseConnection: vi.fn(async () => false),
  getPool: vi.fn(() => null),
  closeDatabasePool: vi.fn(async () => {}),
}));

vi.mock('../db', async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return { ...orig, useRds: vi.fn(async () => false) };
});

vi.mock('../config/aws', () => ({
  s3Client: { send: vi.fn(async () => ({})) },
  bedrockClient: { send: vi.fn(async () => ({})) },
  bedrockCircuitBreaker: { execute: (fn: () => Promise<unknown>) => fn() },
  S3_BUCKET: 'test-bucket',
  S3_PREFIXES: {
    documents: 'documents/',
    vectors: 'vectors/',
    metadata: 'metadata/',
    audit: 'audit/',
    cache: 'cache/',
  },
  BEDROCK_EMBEDDING_MODEL: 'test-model',
  BEDROCK_GENERATION_MODEL: 'test-model',
  BEDROCK_EXTRACTION_MODEL: 'test-model',
}));

vi.mock('../services/audit', () => ({
  logAuditEvent: vi.fn(async () => {}),
}));

// Imports AFTER mocks
import { trySsoIntrospection, resolveSsoUser } from '../middleware/sso';
import { saveUsers, getUsers } from '../middleware/auth';
import { AUTH_COOKIE } from '../middleware/tokenService';
import { logAuditEvent } from '../services/audit';
import * as s3Mock from '../services/s3Storage';
const { __resetStore } = s3Mock as unknown as { __resetStore: () => void };

function mockRes(): Response {
  const res: Partial<Response> = {
    status: vi.fn().mockReturnThis() as Response['status'],
    json: vi.fn().mockReturnThis() as Response['json'],
    cookie: vi.fn().mockReturnThis() as Response['cookie'],
  };
  return res as Response;
}

function mockReq(opts: {
  cookies?: Record<string, string>;
  cookieHeader?: string;
} = {}): Request {
  return {
    cookies: opts.cookies ?? {},
    headers: opts.cookieHeader ? { cookie: opts.cookieHeader } : {},
  } as unknown as Request;
}

function mockCaOk(user: {
  id: string;
  username: string;
  name?: string;
  role: string;
}): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ user, mfaVerified: true, source: 'callanalyzer' }),
    })) as unknown as typeof fetch,
  );
}

function mockCaStatus(status: number): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => ({}),
    })) as unknown as typeof fetch,
  );
}

function mockCaThrow(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('network error');
    }) as unknown as typeof fetch,
  );
}

beforeEach(() => {
  __resetStore();
  vi.unstubAllGlobals();
  process.env.SSO_SHARED_SECRET = 'a'.repeat(32);
  vi.mocked(logAuditEvent).mockClear();
});

// ───────────────────────────────────────────────────────────────────────────
// resolveSsoUser
// ───────────────────────────────────────────────────────────────────────────

describe('resolveSsoUser', () => {
  it('matches by ssoSub on fast path (returns existing user, jitProvisioned=false)', async () => {
    await saveUsers([
      {
        id: 'rag-existing-id',
        username: 'alice@example.com',
        passwordHash: 'SSO_ONLY',
        role: 'user',
        createdAt: new Date().toISOString(),
        ssoSub: 'ca-uuid-alice',
        ssoSource: 'callanalyzer',
      },
    ]);

    const result = await resolveSsoUser({
      id: 'ca-uuid-alice',
      username: 'alice@example.com',
      role: 'viewer',
    });

    expect(result.jitProvisioned).toBe(false);
    expect(result.user.id).toBe('rag-existing-id');
  });

  it('falls back to username match for first SSO login of existing user (populates ssoSub)', async () => {
    await saveUsers([
      {
        id: 'legacy-rag-id',
        username: 'bob@example.com',
        passwordHash: '$2a$hash',
        role: 'admin',
        createdAt: new Date().toISOString(),
      },
    ]);

    const result = await resolveSsoUser({
      id: 'ca-uuid-bob',
      username: 'bob@example.com',
      role: 'admin',
    });

    expect(result.jitProvisioned).toBe(false);
    expect(result.user.id).toBe('legacy-rag-id');
    expect(result.user.ssoSub).toBe('ca-uuid-bob');
    expect(result.user.ssoSource).toBe('callanalyzer');

    const stored = (await getUsers()).find((u) => u.id === 'legacy-rag-id');
    expect(stored?.ssoSub).toBe('ca-uuid-bob');
  });

  it('falls back to email match (case-insensitive) when username differs', async () => {
    await saveUsers([
      {
        id: 'legacy-rag-id',
        username: 'carol_smith',
        email: 'CAROL@example.com',
        passwordHash: '$2a$hash',
        role: 'user',
        createdAt: new Date().toISOString(),
      },
    ]);

    const result = await resolveSsoUser({
      id: 'ca-uuid-carol',
      username: 'carol@example.com',
      role: 'viewer',
    });

    expect(result.jitProvisioned).toBe(false);
    expect(result.user.id).toBe('legacy-rag-id');
    expect(result.user.ssoSub).toBe('ca-uuid-carol');
  });

  it('JIT-provisions a new user with CA UUID as RAG id on complete miss', async () => {
    await saveUsers([]);

    const result = await resolveSsoUser({
      id: 'ca-uuid-dan',
      username: 'dan@example.com',
      role: 'manager',
    });

    expect(result.jitProvisioned).toBe(true);
    expect(result.user.id).toBe('ca-uuid-dan'); // CRITICAL: CA id flows through
    expect(result.user.username).toBe('dan@example.com');
    expect(result.user.email).toBe('dan@example.com');
    expect(result.user.passwordHash).toBe('SSO_ONLY');
    expect(result.user.ssoSub).toBe('ca-uuid-dan');
    expect(result.user.ssoSource).toBe('callanalyzer');
  });

  it('maps CA admin → RAG admin', async () => {
    await saveUsers([]);
    const r = await resolveSsoUser({
      id: 'ca-admin',
      username: 'admin@example.com',
      role: 'admin',
    });
    expect(r.user.role).toBe('admin');
  });

  it('maps CA manager → RAG user (not admin)', async () => {
    await saveUsers([]);
    const r = await resolveSsoUser({
      id: 'ca-mgr',
      username: 'mgr@example.com',
      role: 'manager',
    });
    expect(r.user.role).toBe('user');
  });

  it('maps CA viewer → RAG user', async () => {
    await saveUsers([]);
    const r = await resolveSsoUser({
      id: 'ca-viewer',
      username: 'v@example.com',
      role: 'viewer',
    });
    expect(r.user.role).toBe('user');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// trySsoIntrospection middleware
// ───────────────────────────────────────────────────────────────────────────

describe('trySsoIntrospection middleware', () => {
  it('passes through when RAG auth cookie already present (fast path)', async () => {
    mockCaOk({ id: 'ca-x', username: 'x@example.com', role: 'admin' });
    const req = mockReq({ cookies: { [AUTH_COOKIE]: 'existing-token' } });
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;

    await trySsoIntrospection(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.cookie).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('passes through when no connect.sid cookie is present', async () => {
    mockCaOk({ id: 'ca-x', username: 'x@example.com', role: 'admin' });
    const req = mockReq({ cookies: {}, cookieHeader: 'other=value' });
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;

    await trySsoIntrospection(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('passes through when CA returns 401 — does not mint RAG token', async () => {
    mockCaStatus(401);
    const req = mockReq({ cookieHeader: 'connect.sid=abc123' });
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;

    await trySsoIntrospection(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.cookie).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('passes through when CA fetch throws (network error / timeout)', async () => {
    mockCaThrow();
    const req = mockReq({ cookieHeader: 'connect.sid=abc123' });
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;

    await trySsoIntrospection(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.cookie).not.toHaveBeenCalled();
  });

  it('happy path: bootstraps RAG session cookie + populates req.cookies + audits', async () => {
    mockCaOk({
      id: 'ca-uuid-eve',
      username: 'eve@example.com',
      role: 'manager',
    });
    const cookies: Record<string, string> = {};
    const req = mockReq({
      cookies,
      cookieHeader: 'connect.sid=s:abc.xyz',
    });
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;

    await trySsoIntrospection(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    // Set-Cookie emitted for future requests
    expect(res.cookie).toHaveBeenCalledWith(
      AUTH_COOKIE,
      expect.any(String),
      expect.objectContaining({ httpOnly: true, path: '/' }),
    );
    // req.cookies mutated so same-request authenticate can verify
    expect(cookies[AUTH_COOKIE]).toEqual(expect.any(String));
    // Audit written
    expect(logAuditEvent).toHaveBeenCalledWith(
      'ca-uuid-eve',
      'eve@example.com',
      'login',
      expect.objectContaining({
        action: 'sso_login',
        source: 'callanalyzer',
        caUserId: 'ca-uuid-eve',
        jitProvisioned: true,
        mfaVerified: true,
      }),
    );
  });

  it('forwards cookie header + shared secret on the introspection call', async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        user: { id: 'ca-f', username: 'f@example.com', role: 'admin' },
        mfaVerified: true,
        source: 'callanalyzer',
      }),
    })) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchSpy);

    const req = mockReq({
      cookieHeader: 'connect.sid=s:original; csrf_token=abc',
    });
    await trySsoIntrospection(req, mockRes(), vi.fn() as unknown as NextFunction);

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://mock-ca.test/api/auth/sso-verify',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          cookie: 'connect.sid=s:original; csrf_token=abc',
          'x-service-secret': 'a'.repeat(32),
        }),
      }),
    );
  });

  it('skips introspection when SSO_SHARED_SECRET is missing', async () => {
    delete process.env.SSO_SHARED_SECRET;
    const fetchSpy = vi.fn() as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchSpy);

    const req = mockReq({ cookieHeader: 'connect.sid=abc' });
    await trySsoIntrospection(req, mockRes(), vi.fn() as unknown as NextFunction);

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
