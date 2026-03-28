/**
 * Tests for the extraction route handlers.
 *
 * Mounts the extraction router on a minimal Express app and uses supertest
 * to exercise each endpoint. All service dependencies are vi.mock'd.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be declared before imports
// ---------------------------------------------------------------------------

vi.mock('../services/documentExtractor', () => ({
  extractDocumentData: vi.fn(),
  BEDROCK_EXTRACTION_MODEL: 'us.anthropic.claude-sonnet-4-6-20250514-v1:0',
}));

vi.mock('../services/extractionTemplates', () => ({
  listTemplates: vi.fn(),
  getTemplateById: vi.fn(),
}));

vi.mock('../services/audit', () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/jobQueue', () => ({
  createJob: vi.fn(),
  getJob: vi.fn(),
  updateJob: vi.fn(),
  getUserJobs: vi.fn(),
}));

vi.mock('../utils/fileValidation', () => ({
  validateFileContent: vi.fn(),
}));

vi.mock('../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock authenticate middleware to always pass through with a test user
vi.mock('../middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { id: 'user-1', username: 'testuser', role: 'user' };
    next();
  },
  AuthRequest: {},
}));

// Mock express-rate-limit to be a passthrough
vi.mock('express-rate-limit', () => ({
  default: () => (_req: any, _res: any, next: any) => next(),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import express from 'express';
import supertest from 'supertest';
import extractionRouter from '../routes/extraction';
import { extractDocumentData } from '../services/documentExtractor';
import { listTemplates, getTemplateById } from '../services/extractionTemplates';
import { logAuditEvent } from '../services/audit';
import { createJob, getJob, getUserJobs } from '../services/jobQueue';
import { validateFileContent } from '../utils/fileValidation';

// Build a minimal Express app with the router mounted
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/extraction', extractionRouter);
  return app;
}

// A valid PDF buffer (starts with %PDF magic bytes)
const PDF_BUFFER = Buffer.from('%PDF-1.4 fake content');

describe('Extraction Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // GET /api/extraction/templates
  // -----------------------------------------------------------------------
  describe('GET /templates', () => {
    it('returns template list', async () => {
      const mockList = [
        { id: 'ppd', name: 'PPD', description: 'PPD template', category: 'clinical', fieldCount: 30 },
        { id: 'cmn', name: 'CMN', description: 'CMN template', category: 'billing', fieldCount: 15 },
      ];
      vi.mocked(listTemplates).mockReturnValue(mockList);

      const app = buildApp();
      const res = await supertest(app).get('/api/extraction/templates');

      expect(res.status).toBe(200);
      expect(res.body.templates).toEqual(mockList);
      expect(listTemplates).toHaveBeenCalledOnce();
    });
  });

  // -----------------------------------------------------------------------
  // GET /api/extraction/templates/:id
  // -----------------------------------------------------------------------
  describe('GET /templates/:id', () => {
    it('returns template details without systemPrompt', async () => {
      vi.mocked(getTemplateById).mockReturnValue({
        id: 'ppd',
        name: 'PPD',
        description: 'PPD template',
        category: 'clinical',
        fields: [{ key: 'patientName', label: 'Name', type: 'text', required: true }],
        systemPrompt: 'SECRET PROMPT DO NOT EXPOSE',
      });

      const app = buildApp();
      const res = await supertest(app).get('/api/extraction/templates/ppd');

      expect(res.status).toBe(200);
      expect(res.body.template.id).toBe('ppd');
      expect(res.body.template.fields).toHaveLength(1);
      // systemPrompt must NOT be in the response
      expect(res.body.template.systemPrompt).toBeUndefined();
    });

    it('returns 404 for unknown template', async () => {
      vi.mocked(getTemplateById).mockReturnValue(undefined);

      const app = buildApp();
      const res = await supertest(app).get('/api/extraction/templates/nonexistent');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Template not found');
    });
  });

  // -----------------------------------------------------------------------
  // POST /api/extraction/extract (sync)
  // -----------------------------------------------------------------------
  describe('POST /extract', () => {
    it('returns 400 when no file uploaded', async () => {
      const app = buildApp();
      const res = await supertest(app)
        .post('/api/extraction/extract')
        .field('templateId', 'ppd');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('No file uploaded');
    });

    it('returns 400 when no templateId provided', async () => {
      const app = buildApp();
      const res = await supertest(app)
        .post('/api/extraction/extract')
        .attach('file', PDF_BUFFER, { filename: 'test.pdf', contentType: 'application/pdf' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('templateId is required');
    });

    it('returns 400 for unknown template', async () => {
      vi.mocked(getTemplateById).mockReturnValue(undefined);

      const app = buildApp();
      const res = await supertest(app)
        .post('/api/extraction/extract')
        .attach('file', PDF_BUFFER, { filename: 'test.pdf', contentType: 'application/pdf' })
        .field('templateId', 'unknown');

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Unknown template');
    });

    it('returns 400 for unsupported MIME type', async () => {
      vi.mocked(getTemplateById).mockReturnValue({
        id: 'ppd', name: 'PPD', description: 'PPD', category: 'clinical',
        fields: [], systemPrompt: '',
      });

      const app = buildApp();
      const res = await supertest(app)
        .post('/api/extraction/extract')
        .attach('file', Buffer.from('binary'), { filename: 'test.exe', contentType: 'application/octet-stream' })
        .field('templateId', 'ppd');

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Unsupported file type');
    });

    it('returns 400 for invalid file content (magic bytes mismatch)', async () => {
      vi.mocked(getTemplateById).mockReturnValue({
        id: 'ppd', name: 'PPD', description: 'PPD', category: 'clinical',
        fields: [], systemPrompt: '',
      });
      vi.mocked(validateFileContent).mockReturnValue('File content does not match claimed type');

      const app = buildApp();
      const res = await supertest(app)
        .post('/api/extraction/extract')
        .attach('file', PDF_BUFFER, { filename: 'test.pdf', contentType: 'application/pdf' })
        .field('templateId', 'ppd');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('File content does not match claimed type');
    });

    it('returns extraction result on success', async () => {
      vi.mocked(getTemplateById).mockReturnValue({
        id: 'ppd', name: 'PPD', description: 'PPD', category: 'clinical',
        fields: [], systemPrompt: '',
      });
      vi.mocked(validateFileContent).mockReturnValue(null);
      const mockResult = {
        templateId: 'ppd',
        templateName: 'PPD',
        data: { patientName: 'John Doe' },
        confidence: 'high' as const,
        extractionNotes: 'All fields extracted',
        modelUsed: 'us.anthropic.claude-sonnet-4-6-20250514-v1:0',
      };
      vi.mocked(extractDocumentData).mockResolvedValue(mockResult);

      const app = buildApp();
      const res = await supertest(app)
        .post('/api/extraction/extract')
        .attach('file', PDF_BUFFER, { filename: 'test.pdf', contentType: 'application/pdf' })
        .field('templateId', 'ppd');

      expect(res.status).toBe(200);
      expect(res.body.result).toEqual(mockResult);
      expect(extractDocumentData).toHaveBeenCalledWith(
        expect.any(Buffer),
        'test.pdf',
        'application/pdf',
        'ppd',
      );
    });

    it('logs audit event on successful extraction', async () => {
      vi.mocked(getTemplateById).mockReturnValue({
        id: 'ppd', name: 'PPD', description: 'PPD', category: 'clinical',
        fields: [], systemPrompt: '',
      });
      vi.mocked(validateFileContent).mockReturnValue(null);
      vi.mocked(extractDocumentData).mockResolvedValue({
        templateId: 'ppd',
        templateName: 'PPD',
        data: {},
        confidence: 'medium',
        extractionNotes: '',
        modelUsed: 'test-model',
      });

      const app = buildApp();
      await supertest(app)
        .post('/api/extraction/extract')
        .attach('file', PDF_BUFFER, { filename: 'audit.pdf', contentType: 'application/pdf' })
        .field('templateId', 'ppd');

      expect(logAuditEvent).toHaveBeenCalledWith(
        'user-1',
        'testuser',
        'ocr',
        expect.objectContaining({
          operation: 'extraction',
          filename: 'audit.pdf',
          templateId: 'ppd',
          templateName: 'PPD',
        }),
      );
    });

    it('returns 500 when extraction throws', async () => {
      vi.mocked(getTemplateById).mockReturnValue({
        id: 'ppd', name: 'PPD', description: 'PPD', category: 'clinical',
        fields: [], systemPrompt: '',
      });
      vi.mocked(validateFileContent).mockReturnValue(null);
      vi.mocked(extractDocumentData).mockRejectedValue(new Error('Bedrock timeout'));

      const app = buildApp();
      const res = await supertest(app)
        .post('/api/extraction/extract')
        .attach('file', PDF_BUFFER, { filename: 'test.pdf', contentType: 'application/pdf' })
        .field('templateId', 'ppd');

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Bedrock timeout');
    });
  });

  // -----------------------------------------------------------------------
  // POST /api/extraction/extract/async
  // -----------------------------------------------------------------------
  describe('POST /extract/async', () => {
    it('returns 202 with jobId', async () => {
      vi.mocked(getTemplateById).mockReturnValue({
        id: 'ppd', name: 'PPD', description: 'PPD', category: 'clinical',
        fields: [], systemPrompt: '',
      });
      vi.mocked(validateFileContent).mockReturnValue(null);
      vi.mocked(createJob).mockReturnValue({
        id: 'job-123',
        type: 'extraction',
        status: 'pending',
        createdAt: new Date().toISOString(),
        userId: 'user-1',
        input: {},
      });

      const app = buildApp();
      const res = await supertest(app)
        .post('/api/extraction/extract/async')
        .attach('file', PDF_BUFFER, { filename: 'test.pdf', contentType: 'application/pdf' })
        .field('templateId', 'ppd');

      expect(res.status).toBe(202);
      expect(res.body.jobId).toBe('job-123');
      expect(createJob).toHaveBeenCalledWith('extraction', 'user-1', expect.objectContaining({
        filename: 'test.pdf',
        templateId: 'ppd',
      }));
    });

    it('returns 400 when no file uploaded', async () => {
      const app = buildApp();
      const res = await supertest(app)
        .post('/api/extraction/extract/async')
        .field('templateId', 'ppd');

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('No file uploaded');
    });

    it('returns 400 for unknown template', async () => {
      vi.mocked(getTemplateById).mockReturnValue(undefined);

      const app = buildApp();
      const res = await supertest(app)
        .post('/api/extraction/extract/async')
        .attach('file', PDF_BUFFER, { filename: 'test.pdf', contentType: 'application/pdf' })
        .field('templateId', 'bad-template');

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Unknown template');
    });
  });

  // -----------------------------------------------------------------------
  // GET /api/extraction/jobs/:id
  // -----------------------------------------------------------------------
  describe('GET /jobs/:id', () => {
    it('returns job for owner', async () => {
      const mockJob = {
        id: 'job-1',
        type: 'extraction' as const,
        status: 'completed' as const,
        createdAt: '2026-01-01T00:00:00Z',
        userId: 'user-1',
        input: { filename: 'test.pdf', templateId: 'ppd' },
        result: { data: {} },
        progress: 100,
      };
      vi.mocked(getJob).mockReturnValue(mockJob);

      const app = buildApp();
      const res = await supertest(app).get('/api/extraction/jobs/job-1');

      expect(res.status).toBe(200);
      expect(res.body.job).toEqual(mockJob);
    });

    it('returns 404 for non-existent job', async () => {
      vi.mocked(getJob).mockReturnValue(undefined);

      const app = buildApp();
      const res = await supertest(app).get('/api/extraction/jobs/no-such-job');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Job not found');
    });

    it('returns 404 for a different user\'s job', async () => {
      vi.mocked(getJob).mockReturnValue({
        id: 'job-2',
        type: 'extraction',
        status: 'completed',
        createdAt: '2026-01-01T00:00:00Z',
        userId: 'other-user',
        input: {},
      });

      const app = buildApp();
      const res = await supertest(app).get('/api/extraction/jobs/job-2');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Job not found');
    });
  });

  // -----------------------------------------------------------------------
  // GET /api/extraction/jobs
  // -----------------------------------------------------------------------
  describe('GET /jobs', () => {
    it('returns user\'s jobs', async () => {
      const mockJobs = [
        { id: 'j1', type: 'extraction', status: 'completed', createdAt: '2026-01-01', userId: 'user-1', input: {} },
        { id: 'j2', type: 'extraction', status: 'pending', createdAt: '2026-01-02', userId: 'user-1', input: {} },
      ];
      vi.mocked(getUserJobs).mockReturnValue(mockJobs as any);

      const app = buildApp();
      const res = await supertest(app).get('/api/extraction/jobs');

      expect(res.status).toBe(200);
      expect(res.body.jobs).toHaveLength(2);
      expect(getUserJobs).toHaveBeenCalledWith('user-1', undefined);
    });

    it('filters by type query parameter', async () => {
      vi.mocked(getUserJobs).mockReturnValue([]);

      const app = buildApp();
      const res = await supertest(app).get('/api/extraction/jobs?type=clinical-extraction');

      expect(res.status).toBe(200);
      expect(getUserJobs).toHaveBeenCalledWith('user-1', 'clinical-extraction');
    });
  });

  // -----------------------------------------------------------------------
  // GET /api/extraction/model
  // -----------------------------------------------------------------------
  describe('GET /model', () => {
    it('returns model name', async () => {
      const app = buildApp();
      const res = await supertest(app).get('/api/extraction/model');

      expect(res.status).toBe(200);
      expect(res.body.model).toBe('us.anthropic.claude-sonnet-4-6-20250514-v1:0');
    });
  });
});
