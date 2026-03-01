import { useState, useCallback } from 'react';
import { AuthState } from '../types';
import { login as apiLogin } from '../services/api';

export function useAuth() {
  const [auth, setAuth] = useState<AuthState>(() => {
    const token = localStorage.getItem('token');
    const userStr = localStorage.getItem('user');
    return {
      token,
      user: userStr ? JSON.parse(userStr) : null,
    };
  });

  const login = useCallback(async (username: string, password: string) => {
    const result = await apiLogin(username, password);
    localStorage.setItem('token', result.token);
    localStorage.setItem('user', JSON.stringify(result.user));
    setAuth({ token: result.token, user: result.user });
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setAuth({ token: null, user: null });
  }, []);

  const isAuthenticated = !!auth.token;
  const isAdmin = auth.user?.role === 'admin';

  return { auth, login, logout, isAuthenticated, isAdmin };
}
