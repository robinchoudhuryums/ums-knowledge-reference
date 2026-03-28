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

import icd10Router from '../routes/icd10';

const app = express();
app.use(express.json());
app.use('/api/icd10', icd10Router);

describe('ICD-10 Route', () => {
  // --- GET /for-diagnosis/:code ---
  describe('GET /api/icd10/for-diagnosis/:code', () => {
    it('returns 200 with mappings for a known ICD-10 code', async () => {
      const res = await request(app).get('/api/icd10/for-diagnosis/G47.30');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('icd10Code', 'G47.30');
      expect(res.body).toHaveProperty('count');
      expect(res.body).toHaveProperty('mappings');
      expect(Array.isArray(res.body.mappings)).toBe(true);
      expect(res.body.count).toBeGreaterThan(0);
    });

    it('returns 200 with empty mappings for an unknown ICD-10 code', async () => {
      const res = await request(app).get('/api/icd10/for-diagnosis/Z99.99');
      expect(res.status).toBe(200);
      expect(res.body.count).toBe(0);
      expect(res.body.mappings).toEqual([]);
    });
  });

  // --- GET /for-hcpcs/:code ---
  describe('GET /api/icd10/for-hcpcs/:code', () => {
    it('returns 200 with diagnoses for a known HCPCS code', async () => {
      const res = await request(app).get('/api/icd10/for-hcpcs/E0601');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('hcpcsCode', 'E0601');
      expect(res.body).toHaveProperty('count');
      expect(res.body).toHaveProperty('mappings');
      expect(Array.isArray(res.body.mappings)).toBe(true);
      expect(res.body.count).toBeGreaterThan(0);
    });

    it('returns 200 with empty mappings for an unknown HCPCS code', async () => {
      const res = await request(app).get('/api/icd10/for-hcpcs/ZZZZZ');
      expect(res.status).toBe(200);
      expect(res.body.count).toBe(0);
      expect(res.body.mappings).toEqual([]);
    });
  });

  // --- GET /search ---
  describe('GET /api/icd10/search', () => {
    it('returns 400 when q parameter is missing', async () => {
      const res = await request(app).get('/api/icd10/search');
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/q.*required/i);
    });

    it('returns 400 when q parameter is empty', async () => {
      const res = await request(app).get('/api/icd10/search?q=');
      expect(res.status).toBe(400);
    });

    it('returns 200 with results for a valid query', async () => {
      const res = await request(app).get('/api/icd10/search?q=sleep%20apnea');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('query', 'sleep apnea');
      expect(res.body).toHaveProperty('count');
      expect(res.body).toHaveProperty('results');
      expect(Array.isArray(res.body.results)).toBe(true);
      expect(res.body.count).toBeGreaterThan(0);
    });

    it('returns 200 with empty results for nonexistent query', async () => {
      const res = await request(app).get('/api/icd10/search?q=xyznonexistent');
      expect(res.status).toBe(200);
      expect(res.body.count).toBe(0);
      expect(res.body.results).toEqual([]);
    });
  });

  // --- GET /categories ---
  describe('GET /api/icd10/categories', () => {
    it('returns 200 with an array of categories', async () => {
      const res = await request(app).get('/api/icd10/categories');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('categories');
      expect(Array.isArray(res.body.categories)).toBe(true);
      expect(res.body.categories.length).toBeGreaterThan(0);
    });
  });
});
