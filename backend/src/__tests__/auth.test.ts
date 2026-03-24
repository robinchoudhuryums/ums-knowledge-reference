/**
 * Integration tests for the authentication flow.
 *
 * These tests mock the S3 storage layer and test the auth handlers
 * as pure functions (without starting an HTTP server).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response } from 'express';

// Mock S3 storage before importing auth
vi.mock('../services/s3Storage', () => {
  let store: Record<string, unknown> = {};
  return {
    loadMetadata: vi.fn(async <T>(key: string): Promise<T | null> => {
      return (store[key] as T) || null;
    }),
    saveMetadata: vi.fn(async (key: string, data: unknown) => {
      store[key] = data;
    }),
    __resetStore: () => { store = {}; },
    __getStore: () => store,
  };
});

// Must import after mocks are set up
import { initializeAuth, loginHandler, changePasswordHandler, authenticate, createUserHandler, AuthRequest } from '../middleware/auth';
import * as s3Mock from '../services/s3Storage';
const { __resetStore } = s3Mock as any;

function mockRes(): Response {
  const res: Partial<Response> = {
    status: vi.fn().mockReturnThis() as any,
    json: vi.fn().mockReturnThis() as any,
    cookie: vi.fn().mockReturnThis() as any,
    clearCookie: vi.fn().mockReturnThis() as any,
  };
  return res as Response;
}

function mockReq(body: Record<string, unknown> = {}, headers: Record<string, string> = {}): Request {
  return {
    body,
    headers,
    cookies: {},
  } as unknown as Request;
}

describe('Auth Flow', () => {
  beforeEach(() => {
    __resetStore();
  });

  it('initializes default admin user on first run', async () => {
    await initializeAuth();
    const { __getStore } = s3Mock as any;
    const store = __getStore();
    const users = store['users.json'] as any[];
    expect(users).toHaveLength(1);
    expect(users[0].username).toBe('admin');
    expect(users[0].role).toBe('admin');
    expect(users[0].mustChangePassword).toBe(true);
  });

  it('does not recreate admin if users already exist', async () => {
    // First init creates admin
    await initializeAuth();
    // Second init should not duplicate
    await initializeAuth();
    const { __getStore } = s3Mock as any;
    const users = __getStore()['users.json'] as any[];
    expect(users).toHaveLength(1);
  });

  it('rejects login with missing credentials', async () => {
    const req = mockReq({});
    const res = mockRes();
    await loginHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rejects login with wrong password', async () => {
    await initializeAuth();
    const req = mockReq({ username: 'admin', password: 'wrong' });
    const res = mockRes();
    await loginHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid credentials' });
  });

  it('succeeds login with correct password', async () => {
    await initializeAuth();
    const req = mockReq({ username: 'admin', password: 'admin' });
    const res = mockRes();
    await loginHandler(req, res);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        token: expect.any(String),
        user: expect.objectContaining({ username: 'admin', role: 'admin' }),
        mustChangePassword: true,
      })
    );
    // Should set httpOnly cookie
    expect(res.cookie).toHaveBeenCalled();
  });

  it('locks account after 5 failed attempts', async () => {
    await initializeAuth();
    for (let i = 0; i < 5; i++) {
      const req = mockReq({ username: 'admin', password: 'wrong' });
      const res = mockRes();
      await loginHandler(req, res);
    }
    // 6th attempt should be locked
    const req = mockReq({ username: 'admin', password: 'admin' });
    const res = mockRes();
    await loginHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(423);
  });

  it('rejects login for non-existent user', async () => {
    await initializeAuth();
    const req = mockReq({ username: 'ghost', password: 'pass' });
    const res = mockRes();
    await loginHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('authenticate middleware accepts valid token', async () => {
    await initializeAuth();
    // Login to get a token
    const loginReq = mockReq({ username: 'admin', password: 'admin' });
    const loginRes = mockRes();
    await loginHandler(loginReq, loginRes);
    const token = (loginRes.json as any).mock.calls[0][0].token;

    // Use token in authenticate middleware
    const req = mockReq({}, { authorization: `Bearer ${token}` }) as AuthRequest;
    const res = mockRes();
    const next = vi.fn();
    authenticate(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.user).toBeDefined();
    expect(req.user!.username).toBe('admin');
  });

  it('authenticate middleware rejects invalid token', () => {
    const req = mockReq({}, { authorization: 'Bearer invalid.token.here' }) as AuthRequest;
    const res = mockRes();
    const next = vi.fn();
    authenticate(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('authenticate middleware rejects missing token', () => {
    const req = mockReq({}) as AuthRequest;
    const res = mockRes();
    const next = vi.fn();
    authenticate(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('change password rejects weak password', async () => {
    await initializeAuth();
    // Login first
    const loginReq = mockReq({ username: 'admin', password: 'admin' });
    const loginRes = mockRes();
    await loginHandler(loginReq, loginRes);

    const req = {
      body: { currentPassword: 'admin', newPassword: 'weak' },
      user: { id: 'admin-001', username: 'admin', role: 'admin' },
      headers: {},
      cookies: {},
    } as unknown as AuthRequest;
    const res = mockRes();
    await changePasswordHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('change password succeeds with strong password', async () => {
    await initializeAuth();
    const req = {
      body: { currentPassword: 'admin', newPassword: 'StrongP4ss!' },
      user: { id: 'admin-001', username: 'admin', role: 'admin' },
      headers: {},
      cookies: {},
    } as unknown as AuthRequest;
    const res = mockRes();
    await changePasswordHandler(req, res);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        token: expect.any(String),
        user: expect.objectContaining({ username: 'admin' }),
      })
    );
  });

  it('create user rejects duplicate username', async () => {
    await initializeAuth();
    const req = {
      body: { username: 'admin', password: 'StrongP4ss!' },
      user: { id: 'admin-001', username: 'admin', role: 'admin' },
      headers: {},
      cookies: {},
    } as unknown as AuthRequest;
    const res = mockRes();
    await createUserHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('create user succeeds with valid input', async () => {
    await initializeAuth();
    const req = {
      body: { username: 'agent1', password: 'StrongP4ss!', role: 'user' },
      user: { id: 'admin-001', username: 'admin', role: 'admin' },
      headers: {},
      cookies: {},
    } as unknown as AuthRequest;
    const res = mockRes();
    await createUserHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        user: expect.objectContaining({ username: 'agent1', role: 'user' }),
      })
    );
  });
});
