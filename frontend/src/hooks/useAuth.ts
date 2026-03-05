import { useState, useCallback, useEffect, useRef } from 'react';
import { AuthState } from '../types';
import { login as apiLogin } from '../services/api';

// Auto-logout after 30 minutes of inactivity (HIPAA session timeout)
const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;

export function useAuth() {
  const [auth, setAuth] = useState<AuthState>(() => {
    const token = localStorage.getItem('token');
    const userStr = localStorage.getItem('user');
    return {
      token,
      user: userStr ? JSON.parse(userStr) : null,
    };
  });

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const logout = useCallback(() => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setAuth({ token: null, user: null });
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
    localStorage.setItem('token', result.token);
    localStorage.setItem('user', JSON.stringify(result.user));
    setAuth({ token: result.token, user: result.user });
  }, []);

  const isAuthenticated = !!auth.token;
  const isAdmin = auth.user?.role === 'admin';

  return { auth, login, logout, isAuthenticated, isAdmin };
}
