/**
 * Tests for ENABLE_NATIVE_MFA gate in loginHandler.
 *
 * When the flag is off (intended post-SSO-cutover state), the native MFA
 * check in the login flow is skipped — CA enforces MFA before its session
 * exists, so double-gating adds friction without security benefit for the
 * SSO'd user population.
 *
 * When the flag is on (default), the existing MFA flow is preserved
 * unchanged: users with mfaEnabled get an mfa_required response until
 * they supply a valid TOTP or recovery code.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';

// The two runs of this file must hit different authConfig values — we use
// vi.doMock inside each test and vi.resetModules() to re-import auth with
// the swapped config. This avoids polluting other suites that import
// auth/sso (which both read ENABLE_NATIVE_MFA).
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
  S3_PREFIXES: { documents: '', vectors: '', metadata: '', audit: '', cache: '' },
  BEDROCK_EMBEDDING_MODEL: 'm',
  BEDROCK_GENERATION_MODEL: 'm',
  BEDROCK_EXTRACTION_MODEL: 'm',
}));

vi.mock('../services/audit', () => ({
  logAuditEvent: vi.fn(async () => {}),
}));

function mockRes(): { res: Response; status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> } {
  const status = vi.fn().mockReturnThis();
  const json = vi.fn().mockReturnThis();
  const res = {
    status,
    json,
    cookie: vi.fn().mockReturnThis(),
    clearCookie: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return { res, status, json };
}

function mockReq(body: Record<string, unknown>): Request {
  return { body, headers: {}, cookies: {} } as unknown as Request;
}

/**
 * Seed an MFA-enrolled user, then call loginHandler with password only.
 * Returns what loginHandler wrote to res via the json/status spies.
 */
async function seedAndLogin(config: { enableNativeMfa: boolean; withMfaCode?: string }) {
  vi.resetModules();
  vi.doMock('../middleware/authConfig', async (importOriginal) => {
    const orig = (await importOriginal()) as Record<string, unknown>;
    return { ...orig, ENABLE_NATIVE_MFA: config.enableNativeMfa };
  });

  const s3Mock = await import('../services/s3Storage');
  const { __resetStore } = s3Mock as unknown as { __resetStore: () => void };
  __resetStore();

  const {
    initializeAuth,
    saveUsers,
    loginHandler,
  } = await import('../middleware/auth');
  await initializeAuth();

  const passwordHash = await bcrypt.hash('Password1!', 4);
  await saveUsers([
    {
      id: 'u1',
      username: 'alice',
      passwordHash,
      role: 'user',
      createdAt: new Date().toISOString(),
      mfaEnabled: true,
      // base32 secret for "abcdef" — any non-empty string triggers the gate
      mfaSecret: 'JBSWY3DPEHPK3PXP',
    },
  ]);

  const { res, status, json } = mockRes();
  const body: Record<string, unknown> = { username: 'alice', password: 'Password1!' };
  if (config.withMfaCode) body.mfaCode = config.withMfaCode;
  await loginHandler(mockReq(body), res);
  return { status, json };
}

beforeEach(() => {
  vi.resetModules();
});

describe('ENABLE_NATIVE_MFA gate', () => {
  it('returns mfa_required when gate is ON (default) and no code supplied', async () => {
    const { json } = await seedAndLogin({ enableNativeMfa: true });
    const payload = (json.mock.calls[0]?.[0] ?? {}) as Record<string, unknown>;
    expect(payload.mfaRequired).toBe(true);
  });

  it('completes login WITHOUT mfa_required when gate is OFF (post-SSO state)', async () => {
    const { status, json } = await seedAndLogin({ enableNativeMfa: false });
    // Success path: 200 + token cookie set, no mfaRequired flag on the
    // response body.
    const lastCall = json.mock.calls[json.mock.calls.length - 1];
    const payload = (lastCall?.[0] ?? {}) as Record<string, unknown>;
    expect(payload.mfaRequired).toBeUndefined();
    expect(status).not.toHaveBeenCalledWith(401);
  });

  it('preserves existing user.mfaEnabled + mfaSecret so flipping the gate back restores the check', async () => {
    // With gate off, login succeeds but MFA state is untouched.
    const s3Mock = await import('../services/s3Storage');
    await seedAndLogin({ enableNativeMfa: false });
    const store = (s3Mock as unknown as { __getStore: () => Record<string, unknown> }).__getStore();
    const users = store['users.json'] as Array<{
      username: string;
      mfaEnabled?: boolean;
      mfaSecret?: string;
    }>;
    const alice = users.find((u) => u.username === 'alice');
    expect(alice?.mfaEnabled).toBe(true);
    expect(alice?.mfaSecret).toBe('JBSWY3DPEHPK3PXP');
  });
});
