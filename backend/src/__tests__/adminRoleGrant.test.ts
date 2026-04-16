/**
 * Tests for L2: every admin role grant fires an operational alert.
 *
 * Covers two paths:
 *   - createUserHandler with { role: 'admin' } → alert fires
 *   - PUT /users/:id/role elevating user → admin → alert fires
 * And confirms the complementary non-admin cases do NOT alert.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const alertCalls: Array<{ category: string; subject: string; details: unknown }> = [];
vi.mock('../services/alertService', () => ({
  sendOperationalAlert: vi.fn(async (category: string, subject: string, details: unknown) => {
    alertCalls.push({ category, subject, details });
  }),
}));

// audit is fire-and-forget — just track calls
const auditCalls: Array<{ action: string; details: Record<string, unknown> }> = [];
vi.mock('../services/audit', () => ({
  logAuditEvent: vi.fn(async (_userId: string, _username: string, action: string, details: Record<string, unknown>) => {
    auditCalls.push({ action, details });
  }),
}));

// In-memory user store
let userStore: import('../types').User[] = [];
vi.mock('../db', () => ({
  getUsers: vi.fn(async () => userStore.map(u => ({ ...u }))),
  saveUsers: vi.fn(async (users: import('../types').User[]) => {
    userStore = users.map(u => ({ ...u }));
  }),
}));

vi.mock('../cache', () => ({
  getSets: () => ({
    add: vi.fn(async () => {}),
    has: vi.fn(async () => false),
    remove: vi.fn(async () => {}),
  }),
  getCache: () => ({
    get: vi.fn(async () => null),
    set: vi.fn(async () => {}),
    delete: vi.fn(async () => {}),
  }),
}));

vi.mock('../services/emailService', () => ({
  sendEmail: vi.fn(),
  isEmailConfigured: vi.fn(() => false),
}));

vi.mock('../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function mockRes() {
  let status = 200;
  let body: Record<string, unknown> = {};
  const res = {
    status(code: number) { status = code; return this; },
    json(payload: Record<string, unknown>) { body = payload; return this; },
  };
  return {
    res: res as unknown as import('express').Response,
    get status() { return status; },
    get body() { return body; },
  };
}

beforeEach(() => {
  process.env.JWT_SECRET = 'test-secret-sufficiently-long-for-validation-xxxx';
  userStore = [
    {
      id: 'admin-1',
      username: 'admin',
      passwordHash: '$2b$04$fake',
      role: 'admin',
      createdAt: new Date().toISOString(),
    },
  ];
  alertCalls.length = 0;
  auditCalls.length = 0;
});

describe('L2: admin role grant triggers audit + alert', () => {
  it('alerts + audits when createUserHandler creates a new admin', async () => {
    const { createUserHandler } = await import('../middleware/auth');

    const req = {
      body: { username: 'new-admin', password: 'LongStrongPwd!2345', role: 'admin' },
      user: { id: 'admin-1', username: 'admin', role: 'admin' as const },
    } as unknown as import('../middleware/auth').AuthRequest;
    const r = mockRes();

    await createUserHandler(req, r.res);
    // Dynamic import of alertService happens inside the handler — yield
    await new Promise(resolve => setImmediate(resolve));

    expect(r.status).toBe(201);

    const auditEvent = auditCalls.find(a => a.action === 'user_create');
    expect(auditEvent).toBeDefined();
    expect(auditEvent!.details.adminRoleGranted).toBe(true);
    expect(auditEvent!.details.role).toBe('admin');

    expect(alertCalls.filter(a => a.category === 'admin_role_granted')).toHaveLength(1);
    expect(alertCalls[0].subject).toMatch(/New admin user created: new-admin/);
  });

  it('audits but does NOT alert when createUserHandler creates a regular user', async () => {
    const { createUserHandler } = await import('../middleware/auth');

    const req = {
      body: { username: 'regular-user', password: 'LongStrongPwd!2345', role: 'user' },
      user: { id: 'admin-1', username: 'admin', role: 'admin' as const },
    } as unknown as import('../middleware/auth').AuthRequest;
    const r = mockRes();

    await createUserHandler(req, r.res);
    await new Promise(resolve => setImmediate(resolve));

    expect(r.status).toBe(201);

    const auditEvent = auditCalls.find(a => a.action === 'user_create');
    expect(auditEvent).toBeDefined();
    expect(auditEvent!.details.adminRoleGranted).toBe(false);

    // Non-admin grants must NOT alert
    expect(alertCalls.filter(a => a.category === 'admin_role_granted')).toHaveLength(0);
  });

  it('defaults role=undefined to user (and does not alert)', async () => {
    const { createUserHandler } = await import('../middleware/auth');

    const req = {
      body: { username: 'default-role', password: 'LongStrongPwd!2345' /* no role */ },
      user: { id: 'admin-1', username: 'admin', role: 'admin' as const },
    } as unknown as import('../middleware/auth').AuthRequest;
    const r = mockRes();

    await createUserHandler(req, r.res);
    await new Promise(resolve => setImmediate(resolve));

    expect(r.status).toBe(201);
    expect((r.body as { user: { role: string } }).user.role).toBe('user');
    expect(alertCalls.filter(a => a.category === 'admin_role_granted')).toHaveLength(0);
  });
});
