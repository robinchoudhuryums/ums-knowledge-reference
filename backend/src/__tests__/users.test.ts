/**
 * Unit tests for the user management routes (backend/src/routes/users.ts).
 *
 * Follows the same S3 mock pattern as auth.test.ts — we mock s3Storage,
 * then import the route handlers' dependencies (getUsers/saveUsers) and
 * exercise the Express router via supertest-style mock req/res objects.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import bcrypt from 'bcryptjs';

// ---------------------------------------------------------------------------
// Mock S3 storage (same pattern as auth.test.ts)
// ---------------------------------------------------------------------------
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

// Mock audit logging so it doesn't try to write to S3
vi.mock('../services/audit', () => ({
  logAuditEvent: vi.fn(async () => {}),
}));

// Mock logger to keep test output clean
vi.mock('../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ---------------------------------------------------------------------------
// Imports (must come after vi.mock calls)
// ---------------------------------------------------------------------------
import { getUsers } from '../middleware/auth';
import { User } from '../types';
import * as s3Mock from '../services/s3Storage';

const { __resetStore, __getStore } = s3Mock as any;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Seed the mock store with a set of users. */
async function seedUsers(users: User[]): Promise<void> {
  const store = __getStore();
  store['users.json'] = users;
}

/** Build a test user object. */
async function makeUser(overrides: Partial<User> & { id: string; username: string }): Promise<User> {
  return {
    passwordHash: await bcrypt.hash('Passw0rd!', 4),
    role: 'user',
    createdAt: new Date().toISOString(),
    ...overrides,
  } as User;
}

/**
 * We import the router and need to call its handler functions. Since the
 * router applies authenticate + requireAdmin middleware, it is simpler to
 * directly import and re-implement the handler logic from users.ts by
 * importing the route module dynamically. Instead, we test by directly
 * exercising the business logic via getUsers/saveUsers — the same functions
 * the route handlers call — and then validate the route handler behaviour
 * by dynamically importing the default export and using a lightweight
 * Express app.
 *
 * However, since supertest is not installed, we will test the route handlers
 * by re-creating the handler logic inline (calling the same getUsers/saveUsers).
 * This mirrors what auth.test.ts does.
 */

// We dynamically import the router module so we can access its handlers.
// Since the router uses authenticate + requireAdmin middleware, we need to
// bypass them. The cleanest approach: re-implement just the handler bodies
// by importing the module and manually invoking the route layer.
//
// Actually, the simplest approach is to mount the router in a tiny Express
// app and override the middleware. But without supertest we can't make HTTP
// calls. So let's test the business logic functions directly and then test
// a few integration scenarios by manually calling the route handler stack.

// We'll take a pragmatic approach: import the router, extract the route
// layer handlers, and call them with mock req/res after manually setting
// req.user (simulating that auth middleware already ran).

import express from 'express';

async function buildApp() {
  // Dynamically import to ensure mocks are in place
  const usersModule = await import('../routes/users');
  const app = express();
  app.use(express.json());

  // Bypass auth: inject req.user for every request
  app.use((req: any, _res, next) => {
    // Default: admin user making the request
    req.user = req.headers['x-test-user']
      ? JSON.parse(req.headers['x-test-user'] as string)
      : { id: 'admin-001', username: 'admin', role: 'admin' };
    next();
  });

  // Mount routes WITHOUT the authenticate/requireAdmin middleware.
  // The router applies them via router.use(), so we need to override.
  // Instead, let's mount a fresh router that skips middleware.
  // We can do this by iterating the router's stack... but that's fragile.
  //
  // Simplest: mock authenticate and requireAdmin to be pass-through.
  app.use('/api/users', usersModule.default);
  return app;
}

// We need to mock authenticate and requireAdmin BEFORE importing users router
vi.mock('../middleware/auth', async (importOriginal) => {
  const actual = await importOriginal() as any;
  return {
    ...actual,
    authenticate: vi.fn((_req: any, _res: any, next: any) => next()),
    requireAdmin: vi.fn((_req: any, _res: any, next: any) => next()),
  };
});

// ---------------------------------------------------------------------------
// Inline request helper (no supertest needed)
// ---------------------------------------------------------------------------
async function request(app: express.Express, method: string, path: string, body?: any, userOverride?: any) {
  return new Promise<{ status: number; body: any }>((resolve) => {
    // Use a real HTTP request via the app's handler
    const http = require('http');
    const server = http.createServer(app);
    server.listen(0, () => {
      const port = server.address().port;
      const options = {
        hostname: '127.0.0.1',
        port,
        path,
        method: method.toUpperCase(),
        headers: {
          'Content-Type': 'application/json',
          ...(userOverride ? { 'x-test-user': JSON.stringify(userOverride) } : {}),
        },
      };

      const httpReq = http.request(options, (res: any) => {
        let data = '';
        res.on('data', (chunk: string) => { data += chunk; });
        res.on('end', () => {
          server.close();
          let parsed;
          try { parsed = JSON.parse(data); } catch { parsed = data; }
          resolve({ status: res.statusCode, body: parsed });
        });
      });

      if (body) httpReq.write(JSON.stringify(body));
      httpReq.end();
    });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('User Management Routes', () => {
  let app: express.Express;

  beforeEach(async () => {
    __resetStore();
    app = await buildApp();
  });

  // 1. GET /api/users returns sanitized user list (no passwordHash)
  it('GET /api/users returns sanitized user list without passwordHash', async () => {
    const admin = await makeUser({ id: 'admin-001', username: 'admin', role: 'admin', lastLogin: '2025-01-01T00:00:00Z' });
    const user1 = await makeUser({ id: 'user-001', username: 'agent1' });
    await seedUsers([admin, user1]);

    const res = await request(app, 'GET', '/api/users');

    expect(res.status).toBe(200);
    expect(res.body.users).toHaveLength(2);
    // Verify no passwordHash is leaked
    for (const u of res.body.users) {
      expect(u).not.toHaveProperty('passwordHash');
      expect(u).not.toHaveProperty('passwordHistory');
    }
    // Verify fields present
    expect(res.body.users[0]).toHaveProperty('id');
    expect(res.body.users[0]).toHaveProperty('username');
    expect(res.body.users[0]).toHaveProperty('role');
    expect(res.body.users[0]).toHaveProperty('createdAt');
    expect(res.body.users[0]).toHaveProperty('lastLogin');
    expect(res.body.users[0]).toHaveProperty('mustChangePassword');
  });

  // 2. PUT /api/users/:id/role updates role successfully
  it('PUT /api/users/:id/role updates role successfully', async () => {
    const admin1 = await makeUser({ id: 'admin-001', username: 'admin', role: 'admin' });
    const admin2 = await makeUser({ id: 'admin-002', username: 'admin2', role: 'admin' });
    const user1 = await makeUser({ id: 'user-001', username: 'agent1', role: 'user' });
    await seedUsers([admin1, admin2, user1]);

    const res = await request(app, 'PUT', '/api/users/user-001/role', { role: 'admin' });

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('admin');

    // Verify persisted
    const users = await getUsers();
    const updated = users.find(u => u.id === 'user-001');
    expect(updated!.role).toBe('admin');
  });

  // 3. PUT /api/users/:id/role prevents demoting last admin
  it('PUT /api/users/:id/role prevents demoting the last admin', async () => {
    const admin = await makeUser({ id: 'admin-001', username: 'admin', role: 'admin' });
    const user1 = await makeUser({ id: 'user-001', username: 'agent1', role: 'user' });
    await seedUsers([admin, user1]);

    const res = await request(app, 'PUT', '/api/users/admin-001/role', { role: 'user' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('last admin');
  });

  // 4. PUT /api/users/:id/role rejects invalid role
  it('PUT /api/users/:id/role rejects invalid role', async () => {
    const admin = await makeUser({ id: 'admin-001', username: 'admin', role: 'admin' });
    await seedUsers([admin]);

    const res = await request(app, 'PUT', '/api/users/admin-001/role', { role: 'superadmin' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('role must be');
  });

  // 5. DELETE /api/users/:id deletes user
  it('DELETE /api/users/:id deletes a user', async () => {
    const admin = await makeUser({ id: 'admin-001', username: 'admin', role: 'admin' });
    const user1 = await makeUser({ id: 'user-001', username: 'agent1', role: 'user' });
    await seedUsers([admin, user1]);

    const res = await request(app, 'DELETE', '/api/users/user-001');

    expect(res.status).toBe(200);
    expect(res.body.message).toContain('agent1');

    // Verify user was removed from store
    const users = await getUsers();
    expect(users).toHaveLength(1);
    expect(users[0].id).toBe('admin-001');
  });

  // 6. DELETE /api/users/:id prevents self-deletion
  it('DELETE /api/users/:id prevents self-deletion', async () => {
    const admin = await makeUser({ id: 'admin-001', username: 'admin', role: 'admin' });
    await seedUsers([admin]);

    const res = await request(app, 'DELETE', '/api/users/admin-001');

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Cannot delete your own account');
  });

  // 7. DELETE /api/users/:id prevents deleting last admin
  it('DELETE /api/users/:id prevents deleting the last admin', async () => {
    const admin = await makeUser({ id: 'admin-001', username: 'admin', role: 'admin' });
    const admin2 = await makeUser({ id: 'admin-002', username: 'admin2', role: 'admin' });
    await seedUsers([admin, admin2]);

    // Delete admin-002 while logged in as admin-001 — should succeed (two admins)
    const res1 = await request(app, 'DELETE', '/api/users/admin-002');
    expect(res1.status).toBe(200);

    // Now try to delete admin-001 from a different admin session — but admin-001 is last
    // We need a different user making the request
    // Re-seed with only admin-001 plus a regular user
    __resetStore();
    const adminOnly = await makeUser({ id: 'admin-001', username: 'admin', role: 'admin' });
    const regularUser = await makeUser({ id: 'user-001', username: 'agent1', role: 'user' });
    await seedUsers([adminOnly, regularUser]);

    // Request from user-001 (pretend they're admin for the test middleware)
    const res2 = await request(app, 'DELETE', '/api/users/admin-001', undefined, { id: 'user-001', username: 'agent1', role: 'admin' });
    expect(res2.status).toBe(400);
    expect(res2.body.error).toContain('last admin');
  });

  // 8. POST /api/users/:id/reset-password generates temp password
  it('POST /api/users/:id/reset-password generates a temporary password', async () => {
    const admin = await makeUser({ id: 'admin-001', username: 'admin', role: 'admin' });
    const user1 = await makeUser({ id: 'user-001', username: 'agent1', role: 'user' });
    await seedUsers([admin, user1]);

    const res = await request(app, 'POST', '/api/users/user-001/reset-password');

    expect(res.status).toBe(200);
    expect(res.body.temporaryPassword).toBeDefined();
    expect(typeof res.body.temporaryPassword).toBe('string');
    expect(res.body.temporaryPassword.length).toBeGreaterThanOrEqual(1);
    expect(res.body.message).toContain('agent1');
  });

  // 9. POST /api/users/:id/reset-password sets mustChangePassword=true
  it('POST /api/users/:id/reset-password sets mustChangePassword=true', async () => {
    const admin = await makeUser({ id: 'admin-001', username: 'admin', role: 'admin' });
    const user1 = await makeUser({ id: 'user-001', username: 'agent1', role: 'user' });
    await seedUsers([admin, user1]);

    await request(app, 'POST', '/api/users/user-001/reset-password');

    const users = await getUsers();
    const updated = users.find(u => u.id === 'user-001');
    expect(updated!.mustChangePassword).toBe(true);

    // Also verify old password was pushed to history
    expect(updated!.passwordHistory).toBeDefined();
    expect(updated!.passwordHistory!.length).toBeGreaterThanOrEqual(1);
  });

  // 10. PUT /api/users/:id/collections sets allowed collections
  it('PUT /api/users/:id/collections sets allowed collections', async () => {
    const admin = await makeUser({ id: 'admin-001', username: 'admin', role: 'admin' });
    const user1 = await makeUser({ id: 'user-001', username: 'agent1', role: 'user' });
    await seedUsers([admin, user1]);

    const res = await request(app, 'PUT', '/api/users/user-001/collections', {
      allowedCollections: ['col-1', 'col-2'],
    });

    expect(res.status).toBe(200);
    expect(res.body.user.allowedCollections).toEqual(['col-1', 'col-2']);

    // Verify persisted
    const users = await getUsers();
    const updated = users.find(u => u.id === 'user-001');
    expect(updated!.allowedCollections).toEqual(['col-1', 'col-2']);
  });

  // 11. PUT /api/users/:id/collections with empty array clears restrictions
  it('PUT /api/users/:id/collections with empty array clears restrictions', async () => {
    const admin = await makeUser({ id: 'admin-001', username: 'admin', role: 'admin' });
    const user1 = await makeUser({ id: 'user-001', username: 'agent1', role: 'user', allowedCollections: ['col-1'] });
    await seedUsers([admin, user1]);

    const res = await request(app, 'PUT', '/api/users/user-001/collections', {
      allowedCollections: [],
    });

    expect(res.status).toBe(200);
    // Empty array means "all collections" — returned as empty array
    expect(res.body.user.allowedCollections).toEqual([]);

    // Verify persisted as undefined (unrestricted)
    const users = await getUsers();
    const updated = users.find(u => u.id === 'user-001');
    expect(updated!.allowedCollections).toBeUndefined();
  });

  // 12. PUT /api/users/:id/collections rejects non-array input
  it('PUT /api/users/:id/collections rejects non-array input', async () => {
    const admin = await makeUser({ id: 'admin-001', username: 'admin', role: 'admin' });
    const user1 = await makeUser({ id: 'user-001', username: 'agent1', role: 'user' });
    await seedUsers([admin, user1]);

    const res = await request(app, 'PUT', '/api/users/user-001/collections', {
      allowedCollections: 'not-an-array',
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('array');
  });
});
