/**
 * Tests for token revocation primitives (S2-1).
 *
 * Covers:
 *   - revokeAllUserTokens persists the userId in the revoked-users set
 *   - isUserRevoked correctly reports the revocation afterward
 *   - A revoked user is rejected by the authenticate middleware even though
 *     their JWT is otherwise valid — this is the INV-12 invariant in action
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Minimal cache mock — an in-memory SetProvider so revocations actually land.
// Typed loosely so the spy's call-arg tuples can be introspected in tests.
const memSets = new Map<string, Set<string>>();
const setsProvider = {
  add: vi.fn(async (...args: unknown[]) => {
    const ns = args[0] as string;
    const member = args[1] as string;
    const s = memSets.get(ns) || new Set<string>();
    s.add(member);
    memSets.set(ns, s);
  }),
  has: vi.fn(async (...args: unknown[]) => {
    const ns = args[0] as string;
    const member = args[1] as string;
    return memSets.get(ns)?.has(member) ?? false;
  }),
  remove: vi.fn(async () => {}),
};

vi.mock('../cache', () => ({
  getSets: () => setsProvider,
  getCache: () => ({
    get: vi.fn(async () => null),
    set: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
  }),
}));

vi.mock('../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Prevent authConfig startup fail-fast on missing JWT_SECRET
beforeEach(() => {
  process.env.JWT_SECRET = 'test-secret-sufficiently-long-for-validation-xxxx';
  memSets.clear();
  setsProvider.add.mockClear();
  setsProvider.has.mockClear();
});

describe('revokeAllUserTokens (INV-12)', () => {
  it('marks the user as revoked and isUserRevoked returns true', async () => {
    const { revokeAllUserTokens, isUserRevoked } = await import('../middleware/tokenService');

    expect(await isUserRevoked('user-123')).toBe(false);

    revokeAllUserTokens('user-123');

    // revokeAllUserTokens is fire-and-forget (returns void), but the cache
    // write promise still needs to resolve before we check
    await new Promise(r => setImmediate(r));

    expect(await isUserRevoked('user-123')).toBe(true);
    expect(await isUserRevoked('different-user')).toBe(false);
  });

  it('tracks revocation namespace separately from revoked-tokens set', async () => {
    const { revokeAllUserTokens, isTokenRevoked } = await import('../middleware/tokenService');

    revokeAllUserTokens('user-1');
    await new Promise(r => setImmediate(r));

    // user-1 in revoked-users set should NOT appear in revoked-tokens set
    expect(await isTokenRevoked('user-1')).toBe(false);
  });

  it('calls the cache add with the full refresh-token TTL', async () => {
    const { revokeAllUserTokens } = await import('../middleware/tokenService');

    revokeAllUserTokens('user-ttl-test');
    await new Promise(r => setImmediate(r));

    expect(setsProvider.add).toHaveBeenCalledWith(
      'revoked-users',
      'user-ttl-test',
      expect.any(Number),
    );
    const ttl = setsProvider.add.mock.calls[0][2];
    // Must outlast the access-token TTL (30m) — should be >= 7 days
    expect(ttl).toBeGreaterThanOrEqual(7 * 24 * 60 * 60 * 1000);
  });
});

describe('authenticate middleware honors revokeAllUserTokens (INV-12 integration)', () => {
  it('rejects a valid JWT once the user has been revoked', async () => {
    const { revokeAllUserTokens, createToken } = await import('../middleware/tokenService');
    const { authenticate } = await import('../middleware/auth');

    // Bypass the user list lookup in the middleware — return an empty list
    // so the only check that can reject the request is the revocation check.
    const dbMock = await import('../db');
    vi.spyOn(dbMock, 'getUsers').mockResolvedValue([]);

    const token = createToken({
      id: 'user-revoked',
      username: 'bob',
      role: 'user',
      jti: 'some-jti',
    });

    // Revoke BEFORE the request
    revokeAllUserTokens('user-revoked');
    await new Promise(r => setImmediate(r));

    const req = {
      cookies: { ums_auth_token: token },
      headers: {},
    } as unknown as Parameters<typeof authenticate>[0];

    let status = 0;
    let body: unknown = null;
    const res = {
      status(code: number) { status = code; return this; },
      json(payload: unknown) { body = payload; return this; },
    } as unknown as Parameters<typeof authenticate>[1];

    const next = vi.fn();

    authenticate(req, res, next);
    // Give the async IIFE time to run
    await new Promise(r => setTimeout(r, 30));

    expect(status).toBe(401);
    expect(body).toMatchObject({ error: expect.stringMatching(/revoked/i) });
    expect(next).not.toHaveBeenCalled();
  });

  it('lets a non-revoked user through (happy path sanity check)', async () => {
    const { createToken } = await import('../middleware/tokenService');
    const { authenticate } = await import('../middleware/auth');

    const dbMock = await import('../db');
    vi.spyOn(dbMock, 'getUsers').mockResolvedValue([
      {
        id: 'user-ok',
        username: 'alice',
        passwordHash: '',
        role: 'user',
        createdAt: new Date().toISOString(),
      },
    ]);

    const token = createToken({
      id: 'user-ok',
      username: 'alice',
      role: 'user',
      jti: 'jti-ok',
    });

    const req = {
      cookies: { ums_auth_token: token },
      headers: {},
    } as unknown as Parameters<typeof authenticate>[0];

    let status = 0;
    const res = {
      status(code: number) { status = code; return this; },
      json() { return this; },
    } as unknown as Parameters<typeof authenticate>[1];

    const next = vi.fn();

    authenticate(req, res, next);
    await new Promise(r => setTimeout(r, 30));

    expect(next).toHaveBeenCalled();
    expect(status).toBe(0);
  });
});
