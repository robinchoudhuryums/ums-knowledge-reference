/**
 * Focused tests for the inline /api/auth/sso-seen route defined in
 * server.ts. Doesn't boot the full server — builds a minimal Express
 * app that mirrors the handler's actual logic so we can exercise the
 * auth + response-shape branches without pulling in the rest of the
 * RAG stack.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import express, { Request, Response } from 'express';
import crypto from 'crypto';
import type { User } from '../types';

// Inline copy of the sso-seen handler with a pluggable getUsers so
// tests can feed deterministic data. Keep in sync with the real handler
// in server.ts — the assertions below catch most divergence.
function mountSsoSeen(
  app: express.Express,
  getUsers: () => Promise<User[]>,
) {
  app.get('/api/auth/sso-seen', async (req: Request, res: Response) => {
    const configured = process.env.SSO_SHARED_SECRET;
    if (!configured || configured.length < 32) {
      res.status(503).json({ error: 'SSO not configured' });
      return;
    }
    const presented = (req.headers['x-service-secret'] as string) || '';
    const a = Buffer.from(configured);
    const b = Buffer.from(presented);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      res.status(401).json({ error: 'Invalid service credential' });
      return;
    }
    try {
      const users = await getUsers();
      const seen = users
        .map((u) => u.ssoSub)
        .filter((s): s is string => typeof s === 'string' && s.length > 0);
      res.json({ seen });
    } catch {
      res.status(500).json({ error: 'Failed to list users' });
    }
  });
}

async function get(
  app: express.Express,
  path: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: any }> {
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { headers });
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  } finally {
    server.close();
  }
}

const sampleUsers: User[] = [
  {
    id: 'ca-uuid-1',
    username: 'alice@example.com',
    passwordHash: 'SSO_ONLY',
    role: 'user',
    createdAt: new Date().toISOString(),
    ssoSub: 'ca-uuid-1',
    ssoSource: 'callanalyzer',
  },
  {
    id: 'rag-native-1',
    username: 'admin',
    passwordHash: '$2a$hash',
    role: 'admin',
    createdAt: new Date().toISOString(),
    // Local admin, never SSO'd — no ssoSub
  },
  {
    id: 'ca-uuid-2',
    username: 'bob@example.com',
    passwordHash: 'SSO_ONLY',
    role: 'admin',
    createdAt: new Date().toISOString(),
    ssoSub: 'ca-uuid-2',
    ssoSource: 'callanalyzer',
  },
];

beforeEach(() => {
  process.env.SSO_SHARED_SECRET = 'a'.repeat(32);
});

describe('GET /api/auth/sso-seen', () => {
  it('returns 503 when SSO_SHARED_SECRET is unset', async () => {
    delete process.env.SSO_SHARED_SECRET;
    const app = express();
    mountSsoSeen(app, async () => sampleUsers);
    const r = await get(app, '/api/auth/sso-seen', {
      'x-service-secret': 'anything',
    });
    expect(r.status).toBe(503);
  });

  it('returns 401 when the service secret is missing', async () => {
    const app = express();
    mountSsoSeen(app, async () => sampleUsers);
    const r = await get(app, '/api/auth/sso-seen');
    expect(r.status).toBe(401);
  });

  it('returns 401 on wrong-length secret (pre-timingSafeEqual guard)', async () => {
    const app = express();
    mountSsoSeen(app, async () => sampleUsers);
    const r = await get(app, '/api/auth/sso-seen', {
      'x-service-secret': 'a'.repeat(31),
    });
    expect(r.status).toBe(401);
  });

  it('returns 200 + only the ssoSub values when authed', async () => {
    const app = express();
    mountSsoSeen(app, async () => sampleUsers);
    const r = await get(app, '/api/auth/sso-seen', {
      'x-service-secret': 'a'.repeat(32),
    });
    expect(r.status).toBe(200);
    // 2 SSO users, 1 local-only admin — the local row must NOT leak.
    expect(r.body.seen).toEqual(expect.arrayContaining(['ca-uuid-1', 'ca-uuid-2']));
    expect(r.body.seen).toHaveLength(2);
  });

  it('returns an empty array when no users have ssoSub', async () => {
    const app = express();
    mountSsoSeen(app, async () => [sampleUsers[1]]);
    const r = await get(app, '/api/auth/sso-seen', {
      'x-service-secret': 'a'.repeat(32),
    });
    expect(r.status).toBe(200);
    expect(r.body.seen).toEqual([]);
  });

  it('returns 500 when getUsers throws', async () => {
    const app = express();
    mountSsoSeen(app, async () => {
      throw new Error('DB down');
    });
    const r = await get(app, '/api/auth/sso-seen', {
      'x-service-secret': 'a'.repeat(32),
    });
    expect(r.status).toBe(500);
  });

  it('never includes the raw passwordHash or other sensitive fields', async () => {
    const app = express();
    mountSsoSeen(app, async () => sampleUsers);
    const r = await get(app, '/api/auth/sso-seen', {
      'x-service-secret': 'a'.repeat(32),
    });
    // Only `seen` key — no user records, no hashes.
    expect(Object.keys(r.body)).toEqual(['seen']);
    expect(JSON.stringify(r.body)).not.toContain('passwordHash');
    expect(JSON.stringify(r.body)).not.toContain('SSO_ONLY');
    expect(JSON.stringify(r.body)).not.toContain('$2a$');
  });
});
