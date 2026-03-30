/**
 * Unit tests for the PPD routes (backend/src/routes/ppd.ts).
 *
 * All service dependencies are mocked. Auth middleware is a pass-through
 * that injects a test user. Tests exercise handler logic via supertest.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing any application code
// ---------------------------------------------------------------------------

vi.mock('../services/ppdQuestionnaire', () => ({
  getPpdQuestions: vi.fn(() => [
    { id: 'q1', text: 'Current mobility device?', spanishText: 'Dispositivo de movilidad actual?', type: 'text', group: 'Mobility', number: 1 },
    { id: 'q2', text: 'Can you walk?', spanishText: 'Puede caminar?', type: 'yes-no', group: 'Mobility', number: 2 },
  ]),
  getPpdQuestionGroups: vi.fn(() => ['Mobility']),
  determinePmdRecommendations: vi.fn(() => [
    { hcpcsCode: 'K0823', description: 'Power wheelchair', category: 'standard', justification: 'Mobility limitation' },
  ]),
  PPD_FORM_VERSION: '2.0',
}));

vi.mock('../services/ppdQueue', () => ({
  submitPpd: vi.fn(async (data: any) => ({
    id: 'ppd-001',
    status: 'pending',
    patientInfo: data.patientInfo,
    submittedBy: data.submittedBy,
    submittedAt: '2025-01-15T10:00:00Z',
  })),
  getPpdSubmission: vi.fn(async (id: string) => {
    if (id === 'not-found') return null;
    return {
      id,
      status: 'pending',
      patientInfo: 'John Doe / TRX-123',
      submittedBy: 'tester',
      submittedAt: '2025-01-15T10:00:00Z',
    };
  }),
  listPpdSubmissions: vi.fn(async () => [
    { id: 'ppd-001', status: 'pending', patientInfo: 'John Doe / TRX-123', submittedBy: 'tester' },
    { id: 'ppd-002', status: 'completed', patientInfo: 'Jane Doe / TRX-456', submittedBy: 'tester' },
  ]),
  updatePpdStatus: vi.fn(async (id: string, update: any) => {
    if (id === 'not-found') return null;
    return {
      id,
      status: update.status,
      reviewedBy: update.reviewedBy,
      reviewNotes: update.reviewNotes,
    };
  }),
  deletePpdSubmission: vi.fn(async (id: string) => {
    if (id === 'not-found') return false;
    return true;
  }),
  PpdStatus: {},
}));

vi.mock('../services/seatingEvaluation', () => ({
  generateSeatingEvaluation: vi.fn(() => ({
    sections: [],
    patientInfo: 'John Doe / TRX-123',
  })),
  renderSeatingEvalHtml: vi.fn(() => '<html>Seating Eval</html>'),
}));

vi.mock('../services/audit', () => ({
  logAuditEvent: vi.fn(async () => {}),
}));

vi.mock('../services/emailService', () => ({
  sendEmail: vi.fn(async () => ({ success: true, messageId: 'msg-001' })),
  isEmailConfigured: vi.fn(() => true),
}));

vi.mock('../utils/htmlEscape', () => ({
  escapeHtml: vi.fn((s: string) => s),
}));

vi.mock('../middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    if (!req.user) {
      req.user = { id: 'user-1', username: 'tester', role: 'admin' };
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

// Mock express-rate-limit to be a pass-through
vi.mock('express-rate-limit', () => ({
  default: () => (_req: any, _res: any, next: any) => next(),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import request from 'supertest';
import express from 'express';
import ppdRouter from '../routes/ppd';
import { getPpdQuestions } from '../services/ppdQuestionnaire';
import { submitPpd, listPpdSubmissions, updatePpdStatus, deletePpdSubmission } from '../services/ppdQueue';
import { generateSeatingEvaluation, renderSeatingEvalHtml } from '../services/seatingEvaluation';
import { logAuditEvent } from '../services/audit';
import { sendEmail, isEmailConfigured } from '../services/emailService';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/ppd', ppdRouter);
  return app;
}

function sampleResponses() {
  return [
    { questionId: 'q1', answer: 'walker' },
    { questionId: 'q2', answer: 'yes' },
  ];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PPD Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── GET /questions ───────────────────────────────────────────────────

  describe('GET /questions', () => {
    it('returns questionnaire with questions, groups, and version', async () => {
      const app = makeApp();
      const res = await request(app).get('/api/ppd/questions');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('formVersion', '2.0');
      expect(res.body).toHaveProperty('questions');
      expect(res.body).toHaveProperty('groups');
      expect(Array.isArray(res.body.questions)).toBe(true);
      expect(res.body.questions.length).toBe(2);
      expect(getPpdQuestions).toHaveBeenCalled();
    });
  });

  // ─── GET /questions/:language ─────────────────────────────────────────

  describe('GET /questions/:language', () => {
    it('returns english questions with displayText', async () => {
      const app = makeApp();
      const res = await request(app).get('/api/ppd/questions/english');
      expect(res.status).toBe(200);
      expect(res.body.language).toBe('english');
      expect(res.body.questions[0].displayText).toBe('Current mobility device?');
    });

    it('returns spanish questions with displayText', async () => {
      const app = makeApp();
      const res = await request(app).get('/api/ppd/questions/spanish');
      expect(res.status).toBe(200);
      expect(res.body.language).toBe('spanish');
      expect(res.body.questions[0].displayText).toBe('Dispositivo de movilidad actual?');
    });

    it('returns 400 for invalid language', async () => {
      const app = makeApp();
      const res = await request(app).get('/api/ppd/questions/french');
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/english.*spanish/i);
    });
  });

  // ─── POST /recommend ──────────────────────────────────────────────────

  describe('POST /recommend', () => {
    it('returns 400 without responses', async () => {
      const app = makeApp();
      const res = await request(app)
        .post('/api/ppd/recommend')
        .send({ patientInfo: 'John Doe / TRX-123' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/responses/i);
    });

    it('returns 400 without patientInfo', async () => {
      const app = makeApp();
      const res = await request(app)
        .post('/api/ppd/recommend')
        .send({ responses: sampleResponses() });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/patientInfo/i);
    });

    it('returns 200 with recommendations', async () => {
      const app = makeApp();
      const res = await request(app)
        .post('/api/ppd/recommend')
        .send({
          patientInfo: 'John Doe / TRX-123',
          responses: sampleResponses(),
        });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('patientInfo', 'John Doe / TRX-123');
      expect(res.body).toHaveProperty('recommendations');
      expect(res.body.recommendations).toHaveLength(1);
      expect(res.body.recommendations[0].hcpcsCode).toBe('K0823');
      expect(res.body).toHaveProperty('agentName', 'tester');
      expect(logAuditEvent).toHaveBeenCalled();
    });
  });

  // ─── POST /seating-eval ───────────────────────────────────────────────

  describe('POST /seating-eval', () => {
    it('returns 400 without required fields', async () => {
      const app = makeApp();
      const res = await request(app)
        .post('/api/ppd/seating-eval')
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/patientInfo.*responses/i);
    });

    it('returns 400 without responses array', async () => {
      const app = makeApp();
      const res = await request(app)
        .post('/api/ppd/seating-eval')
        .send({ patientInfo: 'John Doe / TRX-123' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/responses/i);
    });

    it('returns 200 with evaluation and html', async () => {
      const app = makeApp();
      const res = await request(app)
        .post('/api/ppd/seating-eval')
        .send({
          patientInfo: 'John Doe / TRX-123',
          responses: sampleResponses(),
          recommendations: [],
        });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('evaluation');
      expect(res.body).toHaveProperty('html');
      expect(generateSeatingEvaluation).toHaveBeenCalled();
      expect(renderSeatingEvalHtml).toHaveBeenCalled();
      expect(logAuditEvent).toHaveBeenCalled();
    });
  });

  // ─── POST /submit ─────────────────────────────────────────────────────

  describe('POST /submit', () => {
    it('returns 400 without patientInfo', async () => {
      const app = makeApp();
      const res = await request(app)
        .post('/api/ppd/submit')
        .send({ responses: sampleResponses() });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/patientInfo/i);
    });

    it('returns 400 without responses', async () => {
      const app = makeApp();
      const res = await request(app)
        .post('/api/ppd/submit')
        .send({ patientInfo: 'John Doe / TRX-123' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/responses/i);
    });

    it('returns 201 with submission record', async () => {
      const app = makeApp();
      const res = await request(app)
        .post('/api/ppd/submit')
        .send({
          patientInfo: 'John Doe / TRX-123',
          responses: sampleResponses(),
          recommendations: [],
        });
      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('submission');
      expect(res.body.submission.id).toBe('ppd-001');
      expect(res.body.submission.status).toBe('pending');
      expect(submitPpd).toHaveBeenCalled();
      expect(logAuditEvent).toHaveBeenCalled();
    });
  });

  // ─── GET /submissions ─────────────────────────────────────────────────

  describe('GET /submissions', () => {
    it('returns list of submissions', async () => {
      const app = makeApp();
      const res = await request(app).get('/api/ppd/submissions');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('submissions');
      expect(res.body).toHaveProperty('total', 2);
      expect(res.body.submissions).toHaveLength(2);
      expect(listPpdSubmissions).toHaveBeenCalled();
    });
  });

  // ─── PUT /submissions/:id/status ──────────────────────────────────────

  describe('PUT /submissions/:id/status', () => {
    it('returns 400 for invalid status', async () => {
      const app = makeApp();
      const res = await request(app)
        .put('/api/ppd/submissions/ppd-001/status')
        .send({ status: 'invalid_status' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/valid status/i);
    });

    it('returns 400 when status is missing', async () => {
      const app = makeApp();
      const res = await request(app)
        .put('/api/ppd/submissions/ppd-001/status')
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/valid status/i);
    });

    it('returns 200 with valid status update', async () => {
      const app = makeApp();
      const res = await request(app)
        .put('/api/ppd/submissions/ppd-001/status')
        .send({ status: 'in_review', reviewNotes: 'Looking good' });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('submission');
      expect(res.body.submission.status).toBe('in_review');
      expect(updatePpdStatus).toHaveBeenCalledWith('ppd-001', expect.objectContaining({
        status: 'in_review',
        reviewedBy: 'tester',
        reviewNotes: 'Looking good',
      }));
      expect(logAuditEvent).toHaveBeenCalled();
    });

    it('returns 404 when submission not found', async () => {
      const app = makeApp();
      const res = await request(app)
        .put('/api/ppd/submissions/not-found/status')
        .send({ status: 'completed' });
      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/not found/i);
    });
  });

  // ─── DELETE /submissions/:id ──────────────────────────────────────────

  describe('DELETE /submissions/:id', () => {
    it('returns 200 when submission is deleted', async () => {
      const app = makeApp();
      const res = await request(app).delete('/api/ppd/submissions/ppd-001');
      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/deleted/i);
      expect(deletePpdSubmission).toHaveBeenCalledWith('ppd-001');
      expect(logAuditEvent).toHaveBeenCalled();
    });

    it('returns 404 when submission not found', async () => {
      const app = makeApp();
      const res = await request(app).delete('/api/ppd/submissions/not-found');
      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/not found/i);
    });
  });

  // ─── GET /email-status ────────────────────────────────────────────────

  describe('GET /email-status', () => {
    it('returns configured status', async () => {
      const app = makeApp();
      const res = await request(app).get('/api/ppd/email-status');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('configured', true);
      expect(isEmailConfigured).toHaveBeenCalled();
    });
  });

  // ─── POST /send-email ─────────────────────────────────────────────────

  describe('POST /send-email', () => {
    it('returns 400 without to field', async () => {
      const app = makeApp();
      const res = await request(app)
        .post('/api/ppd/send-email')
        .send({ patientInfo: 'John Doe / TRX-123' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/to.*patientInfo/i);
    });

    it('returns 400 without patientInfo', async () => {
      const app = makeApp();
      const res = await request(app)
        .post('/api/ppd/send-email')
        .send({ to: 'test@example.com' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/to.*patientInfo/i);
    });

    it('returns 200 and sends email successfully', async () => {
      const app = makeApp();
      const res = await request(app)
        .post('/api/ppd/send-email')
        .send({
          to: 'test@example.com',
          patientInfo: 'John Doe / TRX-123',
          responses: sampleResponses(),
          recommendations: [],
        });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('success', true);
      expect(res.body).toHaveProperty('messageId', 'msg-001');
      expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({
        to: 'test@example.com',
      }));
      expect(logAuditEvent).toHaveBeenCalled();
    });

    it('returns 500 when email sending fails', async () => {
      vi.mocked(sendEmail).mockResolvedValueOnce({ success: false, error: 'SMTP error' });

      const app = makeApp();
      const res = await request(app)
        .post('/api/ppd/send-email')
        .send({
          to: 'test@example.com',
          patientInfo: 'John Doe / TRX-123',
          responses: sampleResponses(),
          recommendations: [],
        });
      expect(res.status).toBe(500);
      expect(res.body.error).toMatch(/SMTP error/);
    });
  });
});
