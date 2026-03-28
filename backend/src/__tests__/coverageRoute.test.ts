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

// Mock logger to suppress noise during tests
vi.mock('../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import coverageRouter from '../routes/coverage';

const app = express();
app.use(express.json());
app.use('/api/coverage', coverageRouter);

describe('Coverage Route', () => {
  // --- GET /checklist/:hcpcsCode ---
  describe('GET /api/coverage/checklist/:hcpcsCode', () => {
    it('returns 200 with checklist for a valid HCPCS code', async () => {
      const res = await request(app).get('/api/coverage/checklist/E0601');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('checklist');
      expect(res.body.checklist).toHaveProperty('hcpcsCode');
    });

    it('returns 404 for a HCPCS code without a checklist', async () => {
      const res = await request(app).get('/api/coverage/checklist/ZZZZZ');
      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/no coverage checklist/i);
    });
  });

  // --- GET /search ---
  describe('GET /api/coverage/search', () => {
    it('returns 400 when q parameter is missing', async () => {
      const res = await request(app).get('/api/coverage/search');
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/q.*required/i);
    });

    it('returns 400 when q parameter is empty', async () => {
      const res = await request(app).get('/api/coverage/search?q=');
      expect(res.status).toBe(400);
    });

    it('returns 200 with results for a valid query', async () => {
      const res = await request(app).get('/api/coverage/search?q=oxygen');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('query', 'oxygen');
      expect(res.body).toHaveProperty('count');
      expect(res.body).toHaveProperty('results');
      expect(Array.isArray(res.body.results)).toBe(true);
      expect(res.body.count).toBeGreaterThan(0);
    });

    it('returns 200 with empty results for nonexistent query', async () => {
      const res = await request(app).get('/api/coverage/search?q=xyznonexistent');
      expect(res.status).toBe(200);
      expect(res.body.count).toBe(0);
      expect(res.body.results).toEqual([]);
    });
  });

  // --- GET /list ---
  describe('GET /api/coverage/list', () => {
    it('returns 200 with an array of checklists', async () => {
      const res = await request(app).get('/api/coverage/list');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('checklists');
      expect(Array.isArray(res.body.checklists)).toBe(true);
      expect(res.body.checklists.length).toBeGreaterThan(0);
    });
  });

  // --- POST /validate ---
  describe('POST /api/coverage/validate', () => {
    it('returns 400 when hcpcsCode is missing', async () => {
      const res = await request(app)
        .post('/api/coverage/validate')
        .send({ completedItems: ['item1'] });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/hcpcsCode.*completedItems.*required/i);
    });

    it('returns 400 when completedItems is not an array', async () => {
      const res = await request(app)
        .post('/api/coverage/validate')
        .send({ hcpcsCode: 'E0601', completedItems: 'not-array' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/required/i);
    });

    it('returns 400 when body is empty', async () => {
      const res = await request(app)
        .post('/api/coverage/validate')
        .send({});
      expect(res.status).toBe(400);
    });

    it('returns 404 when HCPCS code has no checklist', async () => {
      const res = await request(app)
        .post('/api/coverage/validate')
        .send({ hcpcsCode: 'ZZZZZ', completedItems: [] });
      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/no coverage checklist/i);
    });

    it('returns 200 with validation result for valid input', async () => {
      const res = await request(app)
        .post('/api/coverage/validate')
        .send({ hcpcsCode: 'E0601', completedItems: [] });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('hcpcsCode', 'E0601');
      expect(res.body).toHaveProperty('totalRequired');
      expect(res.body).toHaveProperty('completedCount');
    });
  });
});
