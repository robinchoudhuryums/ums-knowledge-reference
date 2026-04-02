/**
 * Extraction Routes — upload a document + select a template → get structured data back.
 */

import { Router } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { authenticate, AuthRequest } from '../middleware/auth';
import { extractDocumentData, BEDROCK_EXTRACTION_MODEL } from '../services/documentExtractor';
import { listTemplates, getTemplateById } from '../services/extractionTemplates';
import { logAuditEvent } from '../services/audit';
import { logger } from '../utils/logger';
import { validateFileContent } from '../utils/fileValidation';
import { createJob, getJob, updateJob, getUserJobs } from '../services/jobQueue';

const router = Router();

// Stricter rate limit for extraction endpoints — each call triggers expensive
// Bedrock API invocations (Sonnet 4.6) and potentially Textract OCR.
// 10 extractions per 15 minutes per user prevents cost abuse.
const extractionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => (req as AuthRequest).user?.id || req.ip || 'unknown',
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

export default router;
