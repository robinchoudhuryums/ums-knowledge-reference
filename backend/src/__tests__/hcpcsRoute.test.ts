import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mock the auth middleware to be a passthrough
vi.mock('../middleware/auth', () => ({
  authenticate: (_req: any, _res: any, next: any) => {
    _req.user = { id: 'test-user', username: 'tester', role: 'user' };
    next();
  },
  AuthRequest: {},
}));

import hcpcsRouter from '../routes/hcpcs';

const app = express();
app.use(express.json());
app.use('/api/hcpcs', hcpcsRouter);

describe('HCPCS Route', () => {
  // --- GET /search ---
  describe('GET /api/hcpcs/search', () => {
    it('returns 400 when q parameter is missing', async () => {
      const res = await request(app).get('/api/hcpcs/search');
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/q.*required/i);
    });

    it('returns 400 when q parameter is empty string', async () => {
      const res = await request(app).get('/api/hcpcs/search?q=');
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/q.*required/i);
    });

    it('returns 400 when q parameter is whitespace only', async () => {
      const res = await request(app).get('/api/hcpcs/search?q=%20%20');
      expect(res.status).toBe(400);
    });

    it('returns 200 with results for a valid query', async () => {
      const res = await request(app).get('/api/hcpcs/search?q=oxygen');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('query', 'oxygen');
      expect(res.body).toHaveProperty('count');
      expect(res.body).toHaveProperty('results');
      expect(Array.isArray(res.body.results)).toBe(true);
      expect(res.body.count).toBeGreaterThan(0);
    });

    it('returns 200 with empty results for no-match query', async () => {
      const res = await request(app).get('/api/hcpcs/search?q=zzzznonexistent');
      expect(res.status).toBe(200);
      expect(res.body.count).toBe(0);
      expect(res.body.results).toEqual([]);
    });
  });

  // --- GET /code/:code ---
  describe('GET /api/hcpcs/code/:code', () => {
    it('returns 200 for a valid HCPCS code', async () => {
      const res = await request(app).get('/api/hcpcs/code/E0601');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('code');
      expect(res.body.code.code).toBe('E0601');
    });

    it('returns 404 for an invalid HCPCS code', async () => {
      const res = await request(app).get('/api/hcpcs/code/ZZZZZ');
      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/not found/i);
    });
  });

  // --- GET /categories ---
  describe('GET /api/hcpcs/categories', () => {
    it('returns 200 with an array of categories', async () => {
      const res = await request(app).get('/api/hcpcs/categories');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('categories');
      expect(Array.isArray(res.body.categories)).toBe(true);
      expect(res.body.categories.length).toBeGreaterThan(0);
    });
  });

  // --- GET /category/:category ---
  describe('GET /api/hcpcs/category/:category', () => {
    it('returns 200 with codes for a valid category', async () => {
      const res = await request(app).get('/api/hcpcs/category/Oxygen%20Equipment');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('category', 'Oxygen Equipment');
      expect(res.body).toHaveProperty('count');
      expect(res.body).toHaveProperty('results');
      expect(res.body.count).toBeGreaterThan(0);
    });

    it('returns 200 with empty results for a nonexistent category', async () => {
      const res = await request(app).get('/api/hcpcs/category/FakeCategory');
      expect(res.status).toBe(200);
      expect(res.body.count).toBe(0);
      expect(res.body.results).toEqual([]);
    });
  });
});
