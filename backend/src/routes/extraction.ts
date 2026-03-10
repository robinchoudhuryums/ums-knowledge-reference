/**
 * Extraction Routes — upload a document + select a template → get structured data back.
 */

import { Router } from 'express';
import multer from 'multer';
import { authenticate, AuthRequest } from '../middleware/auth';
import { extractDocumentData, BEDROCK_EXTRACTION_MODEL } from '../services/documentExtractor';
import { listTemplates, getTemplateById } from '../services/extractionTemplates';
import { logAuditEvent } from '../services/audit';
import { logger } from '../utils/logger';
import { validateFileContent } from '../utils/fileValidation';

const router = Router();

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
router.get('/templates/:id', authenticate, (req, res) => {
  const template = getTemplateById(req.params.id);
  if (!template) {
    return res.status(404).json({ error: 'Template not found' });
  }
  // Return template info without the system prompt (internal)
  const { systemPrompt, ...publicTemplate } = template;
  res.json({ template: publicTemplate });
});

/**
 * POST /api/extraction/extract — upload file + templateId → structured data
 *
 * Body: multipart/form-data with:
 *   - file: the document to extract from
 *   - templateId: which template to use
 */
router.post('/extract', authenticate, upload.single('file'), async (req, res) => {
  const authReq = req as AuthRequest;
  const file = req.file;
  const templateId = req.body?.templateId;

  if (!file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  if (!templateId) {
    return res.status(400).json({ error: 'templateId is required' });
  }

  const template = getTemplateById(templateId);
  if (!template) {
    return res.status(400).json({ error: `Unknown template: ${templateId}` });
  }

  // Validate mime type
  if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    return res.status(400).json({
      error: `Unsupported file type: ${file.mimetype}. Supported: PDF, PNG, JPEG, TIFF, DOCX, TXT`,
    });
  }

  // Validate file content matches claimed MIME type (magic bytes check)
  const contentError = validateFileContent(file.buffer, file.mimetype, file.originalname);
  if (contentError) {
    return res.status(400).json({ error: contentError });
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
  } catch (error: any) {
    logger.error('Extraction failed', {
      error: error.message,
      filename: file.originalname,
      templateId,
    });
    res.status(500).json({ error: error.message || 'Extraction failed' });
  }
});

/**
 * GET /api/extraction/model — return which model is used for extraction
 */
router.get('/model', authenticate, (_req, res) => {
  res.json({ model: BEDROCK_EXTRACTION_MODEL });
});

export default router;
