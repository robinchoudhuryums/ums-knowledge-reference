/**
 * Tests for the SLO forwarder used by RAG's logoutHandler to terminate
 * the sibling CA session via POST /api/auth/sso-logout.
 *
 * All paths are non-throwing — the helper's contract says callers can
 * ignore the promise.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock authConfig so ENABLE_SSO and CA_BASE_URL are set at import time.
vi.mock('../middleware/authConfig', async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    ENABLE_SSO: true,
    CA_BASE_URL: 'http://mock-ca.test',
  };
});

import { forwardSsoLogout } from '../middleware/ssoLogout';

beforeEach(() => {
  vi.unstubAllGlobals();
  process.env.SSO_SHARED_SECRET = 'a'.repeat(32);
});

describe('forwardSsoLogout', () => {
  it('no-ops when cookie header is undefined', async () => {
    const fetchSpy = vi.fn() as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchSpy);
    await forwardSsoLogout(undefined);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('no-ops when cookie header has no connect.sid', async () => {
    const fetchSpy = vi.fn() as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchSpy);
    await forwardSsoLogout('csrf_token=xyz; something_else=1');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('no-ops when SSO_SHARED_SECRET is unset', async () => {
    delete process.env.SSO_SHARED_SECRET;
    const fetchSpy = vi.fn() as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchSpy);
    await forwardSsoLogout('connect.sid=abc');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('POSTs to /api/auth/sso-logout with forwarded cookie + service secret', async () => {
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 200 })) as unknown as typeof fetch;
    vi.stubGlobal('fetch', fetchSpy);
    await forwardSsoLogout('connect.sid=s:abc.xyz; csrf_token=xyz');
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://mock-ca.test/api/auth/sso-logout',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          cookie: 'connect.sid=s:abc.xyz; csrf_token=xyz',
          'x-service-secret': 'a'.repeat(32),
        }),
      }),
    );
  });

  it('does not throw when CA returns 401 (session already gone)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 401 })) as unknown as typeof fetch,
    );
    // Should complete without throwing
    await expect(forwardSsoLogout('connect.sid=x')).resolves.toBeUndefined();
  });

  it('does not throw on network error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('econnrefused');
      }) as unknown as typeof fetch,
    );
    await expect(forwardSsoLogout('connect.sid=x')).resolves.toBeUndefined();
  });

  it('does not throw on timeout (AbortController fires)', async () => {
    // Simulate a fetch that takes forever; AbortController should cut it off.
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError')),
            );
          }),
      ) as unknown as typeof fetch,
    );
    await expect(forwardSsoLogout('connect.sid=x')).resolves.toBeUndefined();
  }, 3000);
});
