/**
 * Unit tests for the query log routes (backend/src/routes/queryLog.ts).
 *
 * All service dependencies are mocked. Auth middleware is a pass-through
 * that injects a test admin user. Tests exercise handler logic via supertest.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing any application code
// ---------------------------------------------------------------------------

vi.mock('../services/queryLog', () => ({
  getQueryLog: vi.fn(async () => []),
  queryLogToCsv: vi.fn(() => 'header\nrow1'),
  flushQueryLog: vi.fn(async () => {}),
}));

vi.mock('../services/faqAnalytics', () => ({
  buildFaqDashboard: vi.fn(async () => ({
    topQuestions: [],
    clusters: [],
    totalQueries: 0,
  })),
}));

vi.mock('../services/feedback', () => ({
  getFeedbackByDate: vi.fn(async () => []),
}));

vi.mock('../services/ragTrace', () => ({
  getObservabilityMetrics: vi.fn(async () => ({
    dailyStats: [],
    recentFailures: [],
    avgLatency: 0,
  })),
}));

vi.mock('../services/audit', () => ({
  logAuditEvent: vi.fn(async () => {}),
  getAuditLogs: vi.fn(async () => []),
  verifyAuditChain: vi.fn(async () => ({ valid: true, entries: 5 })),
}));

vi.mock('../middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    if (!req.user) {
      req.user = { id: 'admin-1', username: 'admin', role: 'admin' };
    }
    next();
  },
  requireAdmin: (_req: any, _res: any, next: any) => next(),
  AuthRequest: {},
}));

vi.mock('../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import request from 'supertest';
import express from 'express';
import queryLogRouter from '../routes/queryLog';
import { getQueryLog, queryLogToCsv, flushQueryLog } from '../services/queryLog';
import { buildFaqDashboard } from '../services/faqAnalytics';
import { getFeedbackByDate } from '../services/feedback';
import { getObservabilityMetrics } from '../services/ragTrace';
import { getAuditLogs, verifyAuditChain } from '../services/audit';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/query-log', queryLogRouter);
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Query Log Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── GET /:date ──────────────────────────────────────────────────────

  describe('GET /:date', () => {
    it('returns 400 for invalid date format', async () => {
      const app = makeApp();
      const res = await request(app).get('/api/query-log/not-a-date');
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/YYYY-MM-DD/);
    });

    it('returns 200 with entries for valid date', async () => {
      const mockEntries = [
        { question: 'What is HCPCS?', answer: 'A code system', confidence: 'high', timestamp: '2025-01-15T10:00:00Z' },
        { question: 'Oxygen coverage?', answer: 'LCD L33797', confidence: 'partial', timestamp: '2025-01-15T11:00:00Z' },
      ];
      vi.mocked(getQueryLog).mockResolvedValueOnce(mockEntries as any);

      const app = makeApp();
      const res = await request(app).get('/api/query-log/2025-01-15');
      expect(res.status).toBe(200);
      expect(res.body.date).toBe('2025-01-15');
      expect(res.body.count).toBe(2);
      expect(res.body.entries).toHaveLength(2);
      expect(flushQueryLog).toHaveBeenCalled();
    });
  });

  // ─── GET /:date/csv ─────────────────────────────────────────────────

  describe('GET /:date/csv', () => {
    it('returns CSV content-type for valid date', async () => {
      vi.mocked(getQueryLog).mockResolvedValueOnce([]);
      vi.mocked(queryLogToCsv).mockReturnValueOnce('question,answer\n');

      const app = makeApp();
      const res = await request(app).get('/api/query-log/2025-03-01/csv');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toContain('query-log-2025-03-01.csv');
      expect(res.text).toBe('question,answer\n');
    });

    it('returns 400 for invalid date', async () => {
      const app = makeApp();
      const res = await request(app).get('/api/query-log/13-2025-01/csv');
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/YYYY-MM-DD/);
    });
  });

  // ─── GET /audit/:date/json ──────────────────────────────────────────

  describe('GET /audit/:date/json', () => {
    it('returns 200 with audit entries', async () => {
      const mockEntries = [
        { action: 'login', userId: 'u1', timestamp: '2025-01-15T08:00:00Z' },
      ];
      vi.mocked(getAuditLogs).mockResolvedValueOnce(mockEntries as any);

      const app = makeApp();
      const res = await request(app).get('/api/query-log/audit/2025-01-15/json');
      expect(res.status).toBe(200);
      expect(res.body.date).toBe('2025-01-15');
      expect(res.body.count).toBe(1);
      expect(res.body.entries).toHaveLength(1);
    });

    it('returns 400 for invalid date', async () => {
      const app = makeApp();
      const res = await request(app).get('/api/query-log/audit/bad-date/json');
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/YYYY-MM-DD/);
    });
  });

  // ─── GET /audit/:startDate/:endDate/json ────────────────────────────

  describe('GET /audit/:startDate/:endDate/json', () => {
    it('returns 200 with range entries', async () => {
      const entries1 = [{ action: 'login', userId: 'u1' }];
      const entries2 = [{ action: 'query', userId: 'u2' }];
      vi.mocked(getAuditLogs)
        .mockResolvedValueOnce(entries1 as any)
        .mockResolvedValueOnce(entries2 as any);

      const app = makeApp();
      const res = await request(app).get('/api/query-log/audit/2025-01-15/2025-01-16/json');
      expect(res.status).toBe(200);
      expect(res.body.startDate).toBe('2025-01-15');
      expect(res.body.endDate).toBe('2025-01-16');
      expect(res.body.count).toBe(2);
      expect(res.body.entries).toHaveLength(2);
    });

    it('returns 400 for invalid dates', async () => {
      const app = makeApp();
      const res = await request(app).get('/api/query-log/audit/bad/2025-01-16/json');
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/YYYY-MM-DD/);
    });
  });

  // ─── GET /audit/:date/verify ────────────────────────────────────────

  describe('GET /audit/:date/verify', () => {
    it('returns 200 with verification result', async () => {
      vi.mocked(verifyAuditChain).mockResolvedValueOnce({ valid: true, entries: 10 } as any);

      const app = makeApp();
      const res = await request(app).get('/api/query-log/audit/2025-01-15/verify');
      expect(res.status).toBe(200);
      expect(res.body.date).toBe('2025-01-15');
      expect(res.body.valid).toBe(true);
      expect(res.body.entries).toBe(10);
    });

    it('returns 400 for invalid date format', async () => {
      const app = makeApp();
      const res = await request(app).get('/api/query-log/audit/2025_01_15/verify');
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/YYYY-MM-DD/);
    });
  });

  // ─── GET /observability/metrics ─────────────────────────────────────

  describe('GET /observability/metrics', () => {
    it('returns 200 with metrics', async () => {
      const mockMetrics = {
        dailyStats: [{ date: '2025-01-15', totalQueries: 10 }],
        recentFailures: [],
        avgLatency: 250,
      };
      vi.mocked(getObservabilityMetrics).mockResolvedValueOnce(mockMetrics as any);

      const app = makeApp();
      const res = await request(app).get('/api/query-log/observability/metrics');
      expect(res.status).toBe(200);
      expect(res.body.dailyStats).toHaveLength(1);
      expect(res.body.avgLatency).toBe(250);
    });

    it('passes days query parameter', async () => {
      vi.mocked(getObservabilityMetrics).mockResolvedValueOnce({ dailyStats: [], recentFailures: [], avgLatency: 0 } as any);

      const app = makeApp();
      await request(app).get('/api/query-log/observability/metrics?days=14');
      expect(getObservabilityMetrics).toHaveBeenCalledWith(14);
    });
  });

  // ─── GET /faq/dashboard ─────────────────────────────────────────────

  describe('GET /faq/dashboard', () => {
    it('returns 200 with dashboard data', async () => {
      const mockDashboard = {
        topQuestions: [{ question: 'What is CPAP?', count: 5 }],
        clusters: [],
        totalQueries: 50,
      };
      vi.mocked(buildFaqDashboard).mockResolvedValueOnce(mockDashboard as any);

      const app = makeApp();
      const res = await request(app).get('/api/query-log/faq/dashboard');
      expect(res.status).toBe(200);
      expect(res.body.topQuestions).toHaveLength(1);
      expect(res.body.totalQueries).toBe(50);
    });

    it('returns 400 for invalid start date format', async () => {
      const app = makeApp();
      const res = await request(app).get('/api/query-log/faq/dashboard?start=not-a-date');
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/YYYY-MM-DD/);
    });

    it('returns 400 for invalid end date format', async () => {
      const app = makeApp();
      const res = await request(app).get('/api/query-log/faq/dashboard?end=2025/01/15');
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/YYYY-MM-DD/);
    });

    it('passes start and end dates to buildFaqDashboard', async () => {
      vi.mocked(buildFaqDashboard).mockResolvedValueOnce({ topQuestions: [], clusters: [], totalQueries: 0 } as any);

      const app = makeApp();
      await request(app).get('/api/query-log/faq/dashboard?start=2025-01-01&end=2025-01-31');
      expect(buildFaqDashboard).toHaveBeenCalledWith('2025-01-01', '2025-01-31');
    });
  });

  // ─── GET /quality/metrics ───────────────────────────────────────────

  describe('GET /quality/metrics', () => {
    it('returns 200 with quality data', async () => {
      const mockLogs = [
        { question: 'Q1', confidence: 'high' },
        { question: 'Q2', confidence: 'partial' },
        { question: 'Q3', confidence: 'low' },
      ];
      vi.mocked(getQueryLog).mockResolvedValue(mockLogs as any);
      vi.mocked(getFeedbackByDate).mockResolvedValue([{ id: 'fb1' }] as any);

      const app = makeApp();
      const res = await request(app).get('/api/query-log/quality/metrics?days=1');
      expect(res.status).toBe(200);
      expect(res.body.totalQueries).toBe(3);
      expect(res.body.confidenceCounts).toBeDefined();
      expect(res.body.confidenceCounts.high).toBe(1);
      expect(res.body.confidenceCounts.partial).toBe(1);
      expect(res.body.confidenceCounts.low).toBe(1);
      expect(res.body.qualityScore).toBeDefined();
      expect(res.body.dailyStats).toBeInstanceOf(Array);
      expect(res.body.unansweredQuestions).toBeInstanceOf(Array);
      expect(res.body.unansweredQuestions.length).toBeGreaterThan(0);
    });

    it('returns qualityScore 0 when no queries exist', async () => {
      vi.mocked(getQueryLog).mockResolvedValue([]);
      vi.mocked(getFeedbackByDate).mockResolvedValue([]);

      const app = makeApp();
      const res = await request(app).get('/api/query-log/quality/metrics?days=1');
      expect(res.status).toBe(200);
      expect(res.body.totalQueries).toBe(0);
      expect(res.body.qualityScore).toBe(0);
    });
  });
});
