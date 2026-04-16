/**
 * Extraction Routes — upload a document + select a template → get structured data back.
 */

import { Router } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { authenticate, requireAdmin, AuthRequest } from '../middleware/auth';
import { extractDocumentData, BEDROCK_EXTRACTION_MODEL } from '../services/documentExtractor';
import { listTemplates, getTemplateById } from '../services/extractionTemplates';
import { logAuditEvent } from '../services/audit';
import { logger } from '../utils/logger';
import { validateFileContent } from '../utils/fileValidation';
import { resolveRateLimitKey } from '../utils/rateLimitKey';
import { createJob, getJob, updateJob, getUserJobs } from '../services/jobQueue';
import {
  submitExtractionCorrection,
  listExtractionCorrections,
  getExtractionCorrection,
  getExtractionQualityStats,
  ExtractionFeedbackRecord,
  CorrectedField,
} from '../services/extractionFeedback';

const router = Router();

// Stricter rate limit for extraction endpoints — each call triggers expensive
// Bedrock API invocations (Sonnet 4.6) and potentially Textract OCR.
// 10 extractions per 15 minutes per user prevents cost abuse.
const extractionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => resolveRateLimitKey(req),
  message: { error: 'Too many extraction requests. Please wait before submitting again.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// 50 MB upload limit
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/tiff',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
  'text/plain',
];

/**
 * GET /api/extraction/templates — list available extraction templates
 */
router.get('/templates', authenticate, (_req, res) => {
  res.json({ templates: listTemplates() });
});

/**
 * GET /api/extraction/templates/:id — get full template details (fields, etc.)
 */
router.get('/templates/:id', authenticate, (req, res): void => {
  const template = getTemplateById(req.params.id);
  if (!template) {
    res.status(404).json({ error: 'Template not found' });
    return;
  }
  // Return template info without the system prompt (internal)
  const { systemPrompt: _systemPrompt, ...publicTemplate } = template;
  res.json({ template: publicTemplate });
});

/**
 * POST /api/extraction/extract — upload file + templateId → structured data
 *
 * Body: multipart/form-data with:
 *   - file: the document to extract from
 *   - templateId: which template to use
 */
router.post('/extract', authenticate, extractionLimiter, upload.single('file'), async (req, res): Promise<void> => {
  const authReq = req as AuthRequest;
  const file = req.file;
  const templateId = req.body?.templateId;

  if (!file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }

  if (!templateId) {
    res.status(400).json({ error: 'templateId is required' });
    return;
  }

  const template = getTemplateById(templateId);
  if (!template) {
    res.status(400).json({ error: `Unknown template: ${templateId}` });
    return;
  }

  // Validate mime type
  if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    res.status(400).json({
      error: `Unsupported file type: ${file.mimetype}. Supported: PDF, PNG, JPEG, TIFF, DOCX, TXT`,
    });
    return;
  }

  // Validate file content matches claimed MIME type (magic bytes check)
  const contentError = validateFileContent(file.buffer, file.mimetype, file.originalname);
  if (contentError) {
    res.status(400).json({ error: contentError });
    return;
  }

  try {
    logger.info('Extraction request', {
      user: authReq.user?.username,
      filename: file.originalname,
      templateId,
      sizeBytes: file.size,
    });

    const result = await extractDocumentData(
      file.buffer,
      file.originalname,
      file.mimetype,
      templateId,
    );

    // Audit log the extraction
    await logAuditEvent(
      authReq.user!.id,
      authReq.user!.username,
      'ocr', // reuse 'ocr' action type for audit
      {
        operation: 'extraction',
        filename: file.originalname,
        templateId,
        templateName: template.name,
        confidence: result.confidence,
        modelUsed: result.modelUsed,
      },
    );

    res.json({ result });
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    logger.error('Extraction failed', {
      error: errMsg,
      filename: file.originalname,
      templateId,
    });
    // Sanitize error messages — don't expose internal AWS/Bedrock details to users
    const safeMsg = /aws|bedrock|credential|throttl|endpoint|region|arn:|accessdenied/i.test(errMsg)
      ? 'Extraction service temporarily unavailable. Please try again later.'
      : (errMsg || 'Extraction failed');
    res.status(500).json({ error: safeMsg });
  }
});

/**
 * POST /api/extraction/extract/async — start an async extraction job.
 *
 * Accepts the same multipart upload as /extract. Returns 202 with { jobId }.
 * The extraction runs in the background; poll GET /jobs/:id for status.
 */
router.post('/extract/async', authenticate, extractionLimiter, upload.single('file'), async (req, res): Promise<void> => {
  const authReq = req as AuthRequest;
  const file = req.file;
  const templateId = req.body?.templateId;

  if (!file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }

  if (!templateId) {
    res.status(400).json({ error: 'templateId is required' });
    return;
  }

  const template = getTemplateById(templateId);
  if (!template) {
    res.status(400).json({ error: `Unknown template: ${templateId}` });
    return;
  }

  // Validate mime type
  if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    res.status(400).json({
      error: `Unsupported file type: ${file.mimetype}. Supported: PDF, PNG, JPEG, TIFF, DOCX, TXT`,
    });
    return;
  }

  // Validate file content matches claimed MIME type (magic bytes check)
  const contentError = validateFileContent(file.buffer, file.mimetype, file.originalname);
  if (contentError) {
    res.status(400).json({ error: contentError });
    return;
  }

  // Create the job
  const job = createJob('extraction', authReq.user!.id, {
    filename: file.originalname,
    templateId,
    mimeType: file.mimetype,
    sizeBytes: file.size,
  });

  // Return 202 immediately
  res.status(202).json({ jobId: job.id });

  // Process in the background
  const fileBuffer = file.buffer;
  const filename = file.originalname;
  const mimeType = file.mimetype;
  const userId = authReq.user!.id;
  const username = authReq.user!.username;

  setImmediate(async () => {
    try {
      updateJob(job.id, { status: 'processing', progress: 10 });

      logger.info('Async extraction started', {
        jobId: job.id,
        user: username,
        filename,
        templateId,
        sizeBytes: file.size,
      });

      updateJob(job.id, { progress: 30 });

      const result = await extractDocumentData(
        fileBuffer,
        filename,
        mimeType,
        templateId,
      );

      updateJob(job.id, { progress: 90 });

      // Audit log the extraction
      await logAuditEvent(
        userId,
        username,
        'ocr',
        {
          operation: 'extraction-async',
          filename,
          templateId,
          templateName: template.name,
          confidence: result.confidence,
          modelUsed: result.modelUsed,
          jobId: job.id,
        },
      );

      updateJob(job.id, {
        status: 'completed',
        completedAt: new Date().toISOString(),
        result,
        progress: 100,
      });

      logger.info('Async extraction completed', { jobId: job.id, filename, templateId });
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger.error('Async extraction failed', {
        jobId: job.id,
        error: errMsg,
        filename,
        templateId,
      });

      // Sanitize error — don't expose internal AWS/Bedrock details in job results
      const safeMsg = /aws|bedrock|credential|throttl|endpoint|region|arn:|accessdenied/i.test(errMsg)
        ? 'Extraction service temporarily unavailable. Please try again later.'
        : (errMsg || 'Extraction failed');
      updateJob(job.id, {
        status: 'failed',
        completedAt: new Date().toISOString(),
        error: safeMsg,
        progress: undefined,
      });
    }
  });
});

/**
 * GET /api/extraction/jobs/:id — get job status and result
 */
router.get('/jobs/:id', authenticate, (req, res): void => {
  const authReq = req as AuthRequest;
  const job = getJob(req.params.id);

  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }

  // Users can only see their own jobs
  if (job.userId !== authReq.user!.id) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }

  res.json({ job });
});

/**
 * GET /api/extraction/jobs — list the current user's extraction jobs
 */
router.get('/jobs', authenticate, (req, res) => {
  const authReq = req as AuthRequest;
  const type = req.query.type as 'extraction' | 'clinical-extraction' | undefined;
  const userJobs = getUserJobs(authReq.user!.id, type);
  res.json({ jobs: userJobs });
});

/**
 * GET /api/extraction/model — return which model is used for extraction
 */
router.get('/model', authenticate, (_req, res) => {
  res.json({ model: BEDROCK_EXTRACTION_MODEL });
});

// ─── Human-in-the-Loop Extraction Correction ──────────────────────────
//
// After an extraction runs, reviewers can submit corrections so the team
// has a ground-truth record of how often the model is right. Corrections
// are append-only audit records — existing feedback is never mutated.

const feedbackLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  keyGenerator: (req) => resolveRateLimitKey(req),
  message: { error: 'Too many feedback submissions. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const MAX_CORRECTED_FIELDS = 100;
const MAX_NOTE_LEN = 2000;
const VALID_QUALITY = new Set(['correct', 'minor_errors', 'major_errors', 'unusable']);
const VALID_CONFIDENCE = new Set(['high', 'medium', 'low']);

function isFieldValue(v: unknown): boolean {
  return v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
}

/**
 * POST /api/extraction/correct — submit a correction for an extraction result
 */
router.post('/correct', authenticate, feedbackLimiter, async (req, res): Promise<void> => {
  const authReq = req as AuthRequest;
  const {
    templateId,
    reportedConfidence,
    actualQuality,
    correctedFields,
    reviewerNote,
    filename,
  } = req.body as {
    templateId?: string;
    reportedConfidence?: ExtractionFeedbackRecord['reportedConfidence'];
    actualQuality?: ExtractionFeedbackRecord['actualQuality'];
    correctedFields?: unknown;
    reviewerNote?: string;
    filename?: string;
  };

  if (!templateId || typeof templateId !== 'string') {
    res.status(400).json({ error: 'templateId is required' });
    return;
  }
  const template = getTemplateById(templateId);
  if (!template) {
    res.status(400).json({ error: `Unknown template: ${templateId}` });
    return;
  }
  if (!reportedConfidence || !VALID_CONFIDENCE.has(reportedConfidence)) {
    res.status(400).json({ error: 'reportedConfidence must be one of: high, medium, low' });
    return;
  }
  if (!actualQuality || !VALID_QUALITY.has(actualQuality)) {
    res.status(400).json({ error: 'actualQuality must be one of: correct, minor_errors, major_errors, unusable' });
    return;
  }
  if (!Array.isArray(correctedFields)) {
    res.status(400).json({ error: 'correctedFields must be an array' });
    return;
  }
  if (correctedFields.length > MAX_CORRECTED_FIELDS) {
    res.status(400).json({ error: `correctedFields cannot exceed ${MAX_CORRECTED_FIELDS} entries` });
    return;
  }
  if (reviewerNote !== undefined && (typeof reviewerNote !== 'string' || reviewerNote.length > MAX_NOTE_LEN)) {
    res.status(400).json({ error: `reviewerNote must be a string under ${MAX_NOTE_LEN} chars` });
    return;
  }

  // Validate every corrected field matches the template's field set and has scalar values
  const templateKeys = new Set(template.fields.map(f => f.key));
  const normalized: CorrectedField[] = [];
  for (const cf of correctedFields as unknown[]) {
    if (!cf || typeof cf !== 'object') {
      res.status(400).json({ error: 'Each corrected field must be an object' });
      return;
    }
    const obj = cf as { key?: unknown; originalValue?: unknown; correctedValue?: unknown };
    if (typeof obj.key !== 'string' || !templateKeys.has(obj.key)) {
      res.status(400).json({ error: `Unknown field key: ${String(obj.key)}` });
      return;
    }
    if (!isFieldValue(obj.originalValue) || !isFieldValue(obj.correctedValue)) {
      res.status(400).json({ error: `Field "${obj.key}": originalValue and correctedValue must be string/number/boolean/null` });
      return;
    }
    normalized.push({
      key: obj.key,
      originalValue: obj.originalValue as CorrectedField['originalValue'],
      correctedValue: obj.correctedValue as CorrectedField['correctedValue'],
    });
  }

  try {
    const record = await submitExtractionCorrection({
      templateId,
      templateName: template.name,
      modelUsed: BEDROCK_EXTRACTION_MODEL,
      reportedConfidence,
      actualQuality,
      correctedFields: normalized,
      reviewerNote,
      submittedBy: authReq.user!.username,
      filename: typeof filename === 'string' ? filename.slice(0, 200) : undefined,
    });

    await logAuditEvent(authReq.user!.id, authReq.user!.username, 'feedback', {
      action: 'extraction_correction',
      correctionId: record.id,
      templateId,
      actualQuality,
      correctedFieldCount: normalized.length,
    });

    res.status(201).json({ correction: record });
  } catch (err) {
    logger.error('Failed to submit extraction correction', { error: String(err), templateId });
    res.status(500).json({ error: 'Failed to submit correction' });
  }
});

/**
 * GET /api/extraction/corrections — list correction index entries
 */
router.get('/corrections', authenticate, async (req, res): Promise<void> => {
  const authReq = req as AuthRequest;
  const templateId = typeof req.query.templateId === 'string' ? req.query.templateId : undefined;
  const actualQuality = typeof req.query.actualQuality === 'string' ? req.query.actualQuality : undefined;
  const limitStr = typeof req.query.limit === 'string' ? req.query.limit : undefined;

  if (actualQuality && !VALID_QUALITY.has(actualQuality)) {
    res.status(400).json({ error: 'actualQuality filter must be correct, minor_errors, major_errors, or unusable' });
    return;
  }
  const limit = limitStr ? Math.min(Math.max(parseInt(limitStr, 10) || 50, 1), 500) : 50;

  try {
    // Non-admin users only see their own corrections
    const submittedBy = authReq.user!.role === 'admin' ? undefined : authReq.user!.username;
    const entries = await listExtractionCorrections({
      templateId,
      actualQuality: actualQuality as ExtractionFeedbackRecord['actualQuality'] | undefined,
      submittedBy,
      limit,
    });
    res.json({ corrections: entries, total: entries.length });
  } catch (err) {
    logger.error('Failed to list extraction corrections', { error: String(err) });
    res.status(500).json({ error: 'Failed to list corrections' });
  }
});

/**
 * GET /api/extraction/corrections/:templateId/:id — full correction record
 */
router.get('/corrections/:templateId/:id', authenticate, async (req, res): Promise<void> => {
  const authReq = req as AuthRequest;
  const { templateId, id } = req.params;
  try {
    const record = await getExtractionCorrection(id, templateId);
    if (!record) {
      res.status(404).json({ error: 'Correction not found' });
      return;
    }
    // Non-admin users can only see their own records
    if (authReq.user!.role !== 'admin' && record.submittedBy !== authReq.user!.username) {
      res.status(404).json({ error: 'Correction not found' });
      return;
    }
    res.json({ correction: record });
  } catch (err) {
    logger.error('Failed to get extraction correction', { error: String(err), id });
    res.status(500).json({ error: 'Failed to load correction' });
  }
});

/**
 * GET /api/extraction/corrections/stats — aggregate quality stats (admin only)
 */
router.get('/corrections-stats', authenticate, requireAdmin, async (req, res): Promise<void> => {
  const templateId = typeof req.query.templateId === 'string' ? req.query.templateId : undefined;
  try {
    const stats = await getExtractionQualityStats(templateId);
    res.json({ stats });
  } catch (err) {
    logger.error('Failed to compute extraction quality stats', { error: String(err) });
    res.status(500).json({ error: 'Failed to compute stats' });
  }
});

export default router;
