import { useState, useCallback } from 'react';
import { AuthState } from '../types';
import { login as apiLogin, logoutServer, cancelActiveStream } from '../services/api';

export function useAuth() {
  const [auth, setAuth] = useState<AuthState>(() => {
    const isLoggedIn = localStorage.getItem('isLoggedIn') === 'true';
    const userStr = localStorage.getItem('user');
    return {
      token: isLoggedIn ? 'httponly' : null,
      user: userStr ? JSON.parse(userStr) : null,
    };
  });

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

  const isAuthenticated = !!auth.token;
  const isAdmin = auth.user?.role === 'admin';

  return {
    auth, login, logout, isAuthenticated, isAdmin,
    mustChangePassword, handlePasswordChanged,
    mfaRequired, submitMfaCode,
  };
}
