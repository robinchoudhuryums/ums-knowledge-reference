/**
 * Regression test for C2: MFA recovery code TOCTOU.
 *
 * Before the fix, two concurrent login attempts with the same recovery
 * code could both pass `verifyRecoveryCode` and both produce a success
 * response, breaking the single-use guarantee.
 *
 * With the per-username login mutex in place, one wins and the other
 * gets Invalid MFA.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// In-memory user store that persists across the two concurrent calls
let userStore: import('../types').User[] = [];

vi.mock('../db', () => ({
  getUsers: vi.fn(async () => userStore.map(u => ({ ...u, mfaRecoveryCodes: u.mfaRecoveryCodes ? [...u.mfaRecoveryCodes] : undefined }))),
  saveUsers: vi.fn(async (users: import('../types').User[]) => {
    userStore = users.map(u => ({ ...u, mfaRecoveryCodes: u.mfaRecoveryCodes ? [...u.mfaRecoveryCodes] : undefined }));
  }),
}));

vi.mock('../services/mfa', () => ({
  generateMfaSecret: vi.fn(),
  generateRecoveryCodes: vi.fn(),
  // TOTP code not used in these tests — always return false so only
  // recovery code matching succeeds
  verifyMfaCode: vi.fn(() => false),
  // The recovery code in the test is literally 'RECOV-0001'. Return its
  // index whenever the supplied code matches AND it's still present in
  // the hashed list. The real implementation bcrypt-compares; for the
  // race test we simulate the same "looks up in-place" semantics.
  verifyRecoveryCode: vi.fn(async (code: string, hashedCodes: string[]) => {
    if (code !== 'RECOV-0001') return -1;
    return hashedCodes.findIndex(h => h === 'hash:RECOV-0001');
  }),
}));

vi.mock('../services/audit', () => ({
  logAuditEvent: vi.fn(async () => {}),
}));

vi.mock('../services/emailService', () => ({
  sendEmail: vi.fn(async () => ({ success: true, messageId: 'x' })),
  isEmailConfigured: vi.fn(() => false),
}));

vi.mock('../cache', () => ({
  getSets: () => ({
    add: vi.fn(async () => {}),
    has: vi.fn(async () => false),
    remove: vi.fn(async () => {}),
  }),
  getCache: () => ({
    get: vi.fn(async () => null),
    set: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
  }),
}));

// logAuditEvent etc from audit already mocked; tokenService needs env
beforeEach(() => {
  process.env.JWT_SECRET = 'test-secret-sufficiently-long-for-validation-xxxx';
  userStore = [{
    id: 'u1',
    username: 'alice',
    passwordHash: '$2b$04$fake', // we override bcrypt.compare below
    role: 'user',
    createdAt: new Date().toISOString(),
    mfaEnabled: true,
    mfaSecret: 'SECRET',
    mfaRecoveryCodes: ['hash:RECOV-0001', 'hash:RECOV-0002'],
  }];
});

vi.mock('bcryptjs', async () => {
  const actual = await vi.importActual<typeof import('bcryptjs')>('bcryptjs');
  return {
    ...actual,
    default: {
      ...actual,
      compare: vi.fn(async () => true),
      hash: vi.fn(async (pw: string) => `hashed:${pw}`),
    },
    compare: vi.fn(async () => true),
    hash: vi.fn(async (pw: string) => `hashed:${pw}`),
  };
});

function mockRes() {
  let status = 200;
  let body: Record<string, unknown> = {};
  const res = {
    status(code: number) { status = code; return this; },
    json(payload: Record<string, unknown>) { body = payload; return this; },
    cookie: vi.fn(() => res),
    clearCookie: vi.fn(() => res),
    setHeader: vi.fn(),
  };
  return {
    res: res as unknown as import('express').Response,
    get status() { return status; },
    get body() { return body; },
  };
}

describe('MFA recovery code TOCTOU (C2)', () => {
  it('concurrent logins with the same recovery code — only one succeeds', async () => {
    const { loginHandler } = await import('../middleware/auth');

    const req1 = { body: { username: 'alice', password: 'pw', mfaCode: 'RECOV-0001' } } as import('express').Request;
    const req2 = { body: { username: 'alice', password: 'pw', mfaCode: 'RECOV-0001' } } as import('express').Request;
    const r1 = mockRes();
    const r2 = mockRes();

    // Fire both in parallel so they truly contend
    await Promise.all([
      loginHandler(req1, r1.res),
      loginHandler(req2, r2.res),
    ]);

    // Outcomes must be exactly one OK and one invalid
    const statuses = [r1.status, r2.status].sort();
    // 200 on success-no-MFA-required, but here we supplied mfaCode so OK gives success
    // OK responses get a token + userInfo body; the handler sets status to default 200
    // Invalid MFA → 401
    expect(statuses).toEqual([200, 401]);

    // Recovery code must be gone from the store (consumed exactly once)
    const remaining = userStore[0].mfaRecoveryCodes || [];
    expect(remaining).not.toContain('hash:RECOV-0001');
    expect(remaining).toContain('hash:RECOV-0002');
  });

  it('sequential reuse of the same recovery code — second attempt rejected', async () => {
    const { loginHandler } = await import('../middleware/auth');

    const req = { body: { username: 'alice', password: 'pw', mfaCode: 'RECOV-0001' } } as import('express').Request;
    const r1 = mockRes();
    await loginHandler(req, r1.res);
    expect(r1.status).toBe(200);

    // Second use of the now-consumed code must fail
    const r2 = mockRes();
    await loginHandler(req, r2.res);
    expect(r2.status).toBe(401);
  });
});
