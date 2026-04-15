/**
 * Tests for H3: rate-limit key resolution must never pool distinct clients
 * into a single shared bucket.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request } from 'express';

vi.mock('../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function makeReq(overrides: Partial<Request> & { user?: { id?: string }; headers?: Request['headers'] }): Request {
  return {
    method: 'POST',
    path: '/api/test',
    headers: {},
    ...overrides,
  } as unknown as Request;
}

describe('resolveRateLimitKey (H3)', () => {
  beforeEach(async () => {
    vi.resetModules();
    const { __resetRateLimitKeyCounters } = await import('../utils/rateLimitKey');
    __resetRateLimitKeyCounters();
  });

  it('returns the user id when authenticated', async () => {
    const { resolveRateLimitKey } = await import('../utils/rateLimitKey');
    const key = resolveRateLimitKey(makeReq({ user: { id: 'alice' }, ip: '10.0.0.1' }));
    expect(key).toBe('u:alice');
  });

  it('falls back to req.ip when user is missing', async () => {
    const { resolveRateLimitKey } = await import('../utils/rateLimitKey');
    const key = resolveRateLimitKey(makeReq({ ip: '203.0.113.5' }));
    expect(key).toBe('ip:203.0.113.5');
  });

  it('falls back to a stable hash of XFF + UA when user and ip are both missing', async () => {
    const { resolveRateLimitKey } = await import('../utils/rateLimitKey');
    const req = makeReq({
      headers: { 'x-forwarded-for': '198.51.100.7', 'user-agent': 'Mozilla/5.0' },
    });
    const k1 = resolveRateLimitKey(req);
    const k2 = resolveRateLimitKey(req);
    expect(k1).toMatch(/^h:[0-9a-f]{16}$/);
    expect(k1).toBe(k2); // stable across calls with same inputs
  });

  it('produces DIFFERENT hash keys for distinct XFF+UA pairs (no pooling)', async () => {
    const { resolveRateLimitKey } = await import('../utils/rateLimitKey');
    const a = resolveRateLimitKey(makeReq({ headers: { 'x-forwarded-for': '1.1.1.1', 'user-agent': 'A' } }));
    const b = resolveRateLimitKey(makeReq({ headers: { 'x-forwarded-for': '2.2.2.2', 'user-agent': 'B' } }));
    expect(a).not.toBe(b);
  });

  it('as a last resort, returns a per-request UUID so distinct clients never share a bucket', async () => {
    const { resolveRateLimitKey } = await import('../utils/rateLimitKey');
    const req1 = makeReq({});
    const req2 = makeReq({});
    const k1 = resolveRateLimitKey(req1);
    const k2 = resolveRateLimitKey(req2);
    expect(k1).toMatch(/^r:[0-9a-f-]{36}$/);
    expect(k2).toMatch(/^r:[0-9a-f-]{36}$/);
    expect(k1).not.toBe(k2);
  });

  it('never returns the literal string "unknown"', async () => {
    const { resolveRateLimitKey } = await import('../utils/rateLimitKey');
    const scenarios = [
      makeReq({}),
      makeReq({ headers: { 'user-agent': 'X' } }),
      makeReq({ ip: '127.0.0.1' }),
      makeReq({ user: { id: 'u' } }),
    ];
    for (const req of scenarios) {
      const key = resolveRateLimitKey(req);
      expect(key).not.toBe('unknown');
      expect(key).not.toContain('unknown');
    }
  });
});
