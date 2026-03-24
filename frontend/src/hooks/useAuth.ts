import { useState, useCallback, useEffect, useRef } from 'react';
import { AuthState } from '../types';
import { login as apiLogin, logoutServer } from '../services/api';

// Auto-logout after 30 minutes of inactivity (HIPAA session timeout)
const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;

export function useAuth() {
  const [auth, setAuth] = useState<AuthState>(() => {
    // Token is now stored in an httpOnly cookie (not accessible to JS).
    // We still keep a flag in localStorage to know if the user is logged in
    // (the server will reject if the cookie is actually missing/expired).
    const isLoggedIn = localStorage.getItem('isLoggedIn') === 'true';
    const userStr = localStorage.getItem('user');
    return {
      token: isLoggedIn ? 'httponly' : null, // Sentinel — actual token is in cookie
      user: userStr ? JSON.parse(userStr) : null,
    };
  });

  const [mustChangePassword, setMustChangePassword] = useState(false);

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const logout = useCallback(async () => {
    // Revoke token server-side + clear httpOnly cookie (fire-and-forget)
    try { await logoutServer(); } catch { /* ignore if already expired */ }
    localStorage.removeItem('isLoggedIn');
    localStorage.removeItem('user');
    // Also clean up legacy token key if present
    localStorage.removeItem('token');
    setAuth({ token: null, user: null });
    setMustChangePassword(false);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  }, []);

  // Reset inactivity timer on user activity
  const resetInactivityTimer = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      logout();
    }, INACTIVITY_TIMEOUT_MS);
  }, [logout]);

  // Track user activity for inactivity timeout
  useEffect(() => {
    if (!auth.token) return;

    const events = ['mousedown', 'keydown', 'scroll', 'touchstart'];
    const handler = () => resetInactivityTimer();

    events.forEach(e => window.addEventListener(e, handler, { passive: true }));
    resetInactivityTimer(); // Start timer

    return () => {
      events.forEach(e => window.removeEventListener(e, handler));
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [auth.token, resetInactivityTimer]);

  const login = useCallback(async (username: string, password: string) => {
    const result = await apiLogin(username, password);
    // Token is now set as httpOnly cookie by the server; we just store user info
    localStorage.setItem('isLoggedIn', 'true');
    localStorage.setItem('user', JSON.stringify(result.user));
    setAuth({ token: 'httponly', user: result.user });

    // Check if server says password must be changed
    if ((result as any).mustChangePassword) {
      setMustChangePassword(true);
    }
  }, []);

  const handlePasswordChanged = useCallback((_token: string, user: { id: string; username: string; role: 'admin' | 'user' }) => {
    // Token cookie is set by server; just update local state
    localStorage.setItem('isLoggedIn', 'true');
    localStorage.setItem('user', JSON.stringify(user));
    setAuth({ token: 'httponly', user });
    setMustChangePassword(false);
  }, []);

  const isAuthenticated = !!auth.token;
  const isAdmin = auth.user?.role === 'admin';

  return { auth, login, logout, isAuthenticated, isAdmin, mustChangePassword, handlePasswordChanged };
}
