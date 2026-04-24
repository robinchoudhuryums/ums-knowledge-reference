import { useState, useCallback, useEffect } from 'react';
import { AuthState } from '../types';
import { login as apiLogin, logoutServer, cancelActiveStream, fetchMe, SESSION_EXPIRED_EVENT } from '../services/api';

export function useAuth() {
  const [auth, setAuth] = useState<AuthState>(() => {
    const isLoggedIn = localStorage.getItem('isLoggedIn') === 'true';
    const userStr = localStorage.getItem('user');
    return {
      token: isLoggedIn ? 'httponly' : null,
      user: userStr ? (() => { try { return JSON.parse(userStr); } catch { return null; } })() : null,
    };
  });

  // Hydrate auth state from the server on mount. The JWT cookie is httpOnly
  // so localStorage is our only client-readable auth signal — but localStorage
  // only gets set by RAG's own login flow, so SSO-minted sessions (where the
  // server mints the JWT via sso.ts middleware on first request) are invisible
  // to the frontend's initial render. Calling /api/auth/me catches those.
  // Runs exactly once; failures are silent (falls through to LoginForm).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await fetchMe();
      if (cancelled) return;
      if (result?.user) {
        localStorage.setItem('isLoggedIn', 'true');
        localStorage.setItem('user', JSON.stringify(result.user));
        setAuth({ token: 'httponly', user: result.user });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaCredentials, setMfaCredentials] = useState<{ username: string; password: string } | null>(null);

  const logout = useCallback(async () => {
    cancelActiveStream();
    try { await logoutServer(); } catch { /* ignore if already expired */ }
    localStorage.removeItem('isLoggedIn');
    localStorage.removeItem('user');
    localStorage.removeItem('token');
    setAuth({ token: null, user: null });
    setMustChangePassword(false);
    setMfaRequired(false);
    setMfaCredentials(null);
  }, []);

  const login = useCallback(async (username: string, password: string, mfaCode?: string) => {
    const result = await apiLogin(username, password, mfaCode);

    // Server says MFA is required — store credentials so frontend can re-submit with code
    if (result.mfaRequired) {
      setMfaRequired(true);
      setMfaCredentials({ username, password });
      return;
    }

    // Full login success
    localStorage.setItem('isLoggedIn', 'true');
    localStorage.setItem('user', JSON.stringify(result.user));
    setAuth({ token: 'httponly', user: result.user });
    setMfaRequired(false);
    setMfaCredentials(null);

    if ((result as Record<string, unknown>).mustChangePassword) {
      setMustChangePassword(true);
    }
  }, []);

  const submitMfaCode = useCallback(async (code: string) => {
    if (!mfaCredentials) throw new Error('No pending MFA login');
    await login(mfaCredentials.username, mfaCredentials.password, code);
  }, [mfaCredentials, login]);

  const handlePasswordChanged = useCallback((_token: string, user: { id: string; username: string; role: 'admin' | 'user' }) => {
    localStorage.setItem('isLoggedIn', 'true');
    localStorage.setItem('user', JSON.stringify(user));
    setAuth({ token: 'httponly', user });
    setMustChangePassword(false);
  }, []);

  // H7: when the API client dispatches SESSION_EXPIRED_EVENT (silent refresh
  // failed), drop back to LoginForm without a full-page reload. Unlike
  // window.location.reload() this preserves React subtree state elsewhere
  // in the app — critically, unsaved form drafts stay in memory until the
  // user logs back in and can be inspected via the FormDraftBanner.
  useEffect(() => {
    const onExpired = () => {
      cancelActiveStream();
      setAuth({ token: null, user: null });
      setMustChangePassword(false);
      setMfaRequired(false);
      setMfaCredentials(null);
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => { window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired); };
  }, []);

  const isAuthenticated = !!auth.token;
  const isAdmin = auth.user?.role === 'admin';

  return {
    auth, login, logout, isAuthenticated, isAdmin,
    mustChangePassword, handlePasswordChanged,
    mfaRequired, submitMfaCode,
  };
}
