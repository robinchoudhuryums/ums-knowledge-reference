import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAuth } from '../useAuth';

// Mock the API module. SESSION_EXPIRED_EVENT must be exported because
// useAuth imports it for the "silent logout on refresh failure" path (H7).
vi.mock('../../services/api', () => ({
  login: vi.fn(),
  logoutServer: vi.fn().mockResolvedValue(undefined),
  cancelActiveStream: vi.fn(),
  SESSION_EXPIRED_EVENT: 'ums:session-expired',
}));

describe('useAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('initializes as unauthenticated when no localStorage data', () => {
    const { result } = renderHook(() => useAuth());
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.auth.user).toBeNull();
  });

  it('initializes as authenticated when localStorage has isLoggedIn', () => {
    localStorage.setItem('isLoggedIn', 'true');
    localStorage.setItem('user', JSON.stringify({ id: 'u1', username: 'admin', role: 'admin' }));

    const { result } = renderHook(() => useAuth());
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.auth.user?.username).toBe('admin');
    expect(result.current.isAdmin).toBe(true);
  });

  it('login sets auth state and localStorage on success', async () => {
    const { login: apiLogin } = await import('../../services/api');
    vi.mocked(apiLogin).mockResolvedValue({
      token: 'jwt-token',
      user: { id: 'u1', username: 'agent1', role: 'user' },
    });

    const { result } = renderHook(() => useAuth());

    await act(async () => {
      await result.current.login('agent1', 'Password1!');
    });

    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.auth.user?.username).toBe('agent1');
    expect(result.current.isAdmin).toBe(false);
    expect(localStorage.getItem('isLoggedIn')).toBe('true');
  });

  it('login sets mustChangePassword when flagged', async () => {
    const { login: apiLogin } = await import('../../services/api');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(apiLogin).mockResolvedValue({
      token: 'jwt-token',
      user: { id: 'u1', username: 'admin', role: 'admin' },
      mustChangePassword: true,
    } as any);

    const { result } = renderHook(() => useAuth());

    await act(async () => {
      await result.current.login('admin', 'Temp1234!');
    });

    expect(result.current.mustChangePassword).toBe(true);
  });

  it('login sets mfaRequired when server demands MFA', async () => {
    const { login: apiLogin } = await import('../../services/api');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(apiLogin).mockResolvedValue({ mfaRequired: true } as any);

    const { result } = renderHook(() => useAuth());

    await act(async () => {
      await result.current.login('admin', 'Password1!');
    });

    expect(result.current.mfaRequired).toBe(true);
    expect(result.current.isAuthenticated).toBe(false); // Not yet authenticated
  });

  it('logout clears auth state and localStorage', async () => {
    localStorage.setItem('isLoggedIn', 'true');
    localStorage.setItem('user', JSON.stringify({ id: 'u1', username: 'admin', role: 'admin' }));

    const { result } = renderHook(() => useAuth());
    expect(result.current.isAuthenticated).toBe(true);

    await act(async () => {
      await result.current.logout();
    });

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.auth.user).toBeNull();
    expect(localStorage.getItem('isLoggedIn')).toBeNull();
  });

  it('logout cancels active streams', async () => {
    const { cancelActiveStream } = await import('../../services/api');
    localStorage.setItem('isLoggedIn', 'true');

    const { result } = renderHook(() => useAuth());

    await act(async () => {
      await result.current.logout();
    });

    expect(cancelActiveStream).toHaveBeenCalled();
  });

  it('handlePasswordChanged updates auth and clears mustChangePassword', () => {
    const { result } = renderHook(() => useAuth());

    act(() => {
      result.current.handlePasswordChanged('new-token', { id: 'u1', username: 'admin', role: 'admin' });
    });

    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.mustChangePassword).toBe(false);
    expect(localStorage.getItem('isLoggedIn')).toBe('true');
  });
});
