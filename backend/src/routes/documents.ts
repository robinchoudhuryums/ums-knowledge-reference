import { Router, Response } from 'express';
import multer from 'multer';
import { authenticate, requireAdmin, AuthRequest } from '../middleware/auth';
import { ingestDocument } from '../services/ingestion';
import {
  getDocumentsIndex,
  saveDocumentsIndex,
  deleteDocumentFromS3,
  getCollectionsIndex,
  saveCollectionsIndex,
} from '../services/s3Storage';
import { removeDocumentChunks, searchChunksByKeyword } from '../services/vectorStore';
import { logAuditEvent } from '../services/audit';
import { extractTextWithOcr } from '../services/ocr';
import { analyzeFormFields, analyzeFormFieldsBatch } from '../services/formAnalyzer';
import { createAnnotatedPdf } from '../services/pdfAnnotator';
import { checkForChanges } from '../services/reindexer';
import { fetchAndIngestFeeSchedule } from '../services/feeScheduleFetcher';
import { extractClinicalNotes } from '../services/clinicalNoteExtractor';
import { Collection } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';
import { validateFileContent } from '../utils/fileValidation';

const router = Router();

// Multer config: 50MB limit, memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowedMimes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv',
      'text/plain',
    ];
    // Also allow by extension
    const allowedExts = ['.pdf', '.docx', '.doc', '.xlsx', '.xls', '.csv', '.txt', '.md'];
    const ext = '.' + (file.originalname.split('.').pop() || '').toLowerCase();

    if (allowedMimes.includes(file.mimetype) || allowedExts.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype} (${file.originalname})`));
    }
  },
});

// Upload a document
router.post(
  '/upload',
  authenticate,
  requireAdmin,
  upload.single('file'),
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: 'No file provided' });
        return;
      }

      // Validate file content matches claimed MIME type (magic bytes check)
      const validationError = validateFileContent(req.file.buffer, req.file.mimetype, req.file.originalname);
      if (validationError) {
        res.status(400).json({ error: validationError });
        return;
      }

      const collectionId = req.body.collectionId || 'default';

      const result = await ingestDocument(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype,
        collectionId,
        req.user!.username
      );

      await logAuditEvent(req.user!.id, req.user!.username, 'upload', {
        documentId: result.document.id,
        filename: req.file.originalname,
        collectionId,
        chunkCount: result.chunkCount,
      });

      res.status(201).json(result);
    } catch (error) {
      logger.error('Upload failed', { error: String(error) });
      res.status(500).json({ error: error instanceof Error ? error.message : 'Upload failed' });
    }
  }
);

// List all documents
router.get('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const docs = await getDocumentsIndex();
    const collectionId = req.query.collectionId as string | undefined;

    // Show all non-replaced documents (ready, processing, error) so users see status
    const filtered = collectionId
      ? docs.filter(d => d.collectionId === collectionId && !d.errorMessage?.startsWith('Replaced by'))
      : docs.filter(d => !d.errorMessage?.startsWith('Replaced by'));

    res.json({ documents: filtered });
  } catch (error) {
    logger.error('Failed to list documents', { error: String(error) });
    res.status(500).json({ error: 'Failed to list documents' });
  }
});

// Get a single document's metadata
router.get('/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const docs = await getDocumentsIndex();
    const doc = docs.find(d => d.id === req.params.id);
    if (!doc) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }
    res.json({ document: doc });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get document' });
  }
});

// Delete a document
router.delete('/:id', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const docs = await getDocumentsIndex();
    const docIndex = docs.findIndex(d => d.id === req.params.id);

    if (docIndex === -1) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    const doc = docs[docIndex];

    // Remove from vector store
    await removeDocumentChunks(doc.id);

    // Remove from S3
    await deleteDocumentFromS3(doc.s3Key);

    // Remove from index
    docs.splice(docIndex, 1);
    await saveDocumentsIndex(docs);

    await logAuditEvent(req.user!.id, req.user!.username, 'delete', {
      documentId: doc.id,
      filename: doc.originalName,
    });

    res.json({ message: 'Document deleted' });
  } catch (error) {
    logger.error('Delete failed', { error: String(error) });
    res.status(500).json({ error: 'Failed to delete document' });
  }
});

// --- Collections ---

// List collections
router.get('/collections/list', authenticate, async (_req: AuthRequest, res: Response) => {
  try {
    const collections = await getCollectionsIndex();
    res.json({ collections });
  } catch (error) {
    res.status(500).json({ error: 'Failed to list collections' });
  }
});

// Create a collection
router.post('/collections', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { name, description } = req.body;
    if (!name) {
      res.status(400).json({ error: 'Collection name is required' });
      return;
    }

    const collections = await getCollectionsIndex();
    if (collections.find(c => c.name === name)) {
      res.status(409).json({ error: 'Collection with this name already exists' });
      return;
    }

    const collection: Collection = {
      id: uuidv4(),
      name,
      description: description || '',
      createdBy: req.user!.username,
      createdAt: new Date().toISOString(),
      documentCount: 0,
    };

    collections.push(collection);
    await saveCollectionsIndex(collections);

    await logAuditEvent(req.user!.id, req.user!.username, 'collection_create', {
      collectionId: collection.id,
      name,
    });

    res.status(201).json({ collection });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create collection' });
  }
});

// Delete a collection
router.delete('/collections/:id', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const collections = await getCollectionsIndex();
    const colIndex = collections.findIndex(c => c.id === req.params.id);

    if (colIndex === -1) {
      res.status(404).json({ error: 'Collection not found' });
      return;
    }

    // Check for documents in this collection
    const docs = await getDocumentsIndex();
    const collectionDocs = docs.filter(d => d.collectionId === req.params.id && d.status === 'ready');

    if (collectionDocs.length > 0) {
      res.status(400).json({
        error: `Collection still has ${collectionDocs.length} documents. Delete them first.`,
      });
      return;
    }

    const collection = collections[colIndex];
    collections.splice(colIndex, 1);
    await saveCollectionsIndex(collections);

    await logAuditEvent(req.user!.id, req.user!.username, 'collection_delete', {
      collectionId: collection.id,
      name: collection.name,
    });

    res.json({ message: 'Collection deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete collection' });
  }
});

// --- Document Tags ---

// Update tags for a document
router.put('/:id/tags', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { tags } = req.body;
    if (!Array.isArray(tags) || tags.some((t: unknown) => typeof t !== 'string')) {
      res.status(400).json({ error: 'Tags must be an array of strings' });
      return;
    }

    const docs = await getDocumentsIndex();
    const doc = docs.find(d => d.id === req.params.id);
    if (!doc) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    // Normalize tags: lowercase, trim, deduplicate
    doc.tags = [...new Set(tags.map((t: string) => t.toLowerCase().trim()).filter(Boolean))];
    await saveDocumentsIndex(docs);

    await logAuditEvent(req.user!.id, req.user!.username, 'upload', {
      documentId: doc.id,
      action: 'tags_updated',
      tags: doc.tags,
    });

    res.json({ document: doc });
  } catch (error) {
    logger.error('Failed to update tags', { error: String(error) });
    res.status(500).json({ error: 'Failed to update tags' });
  }
});

// List all unique tags across all documents
router.get('/tags/list', authenticate, async (_req: AuthRequest, res: Response) => {
  try {
    const docs = await getDocumentsIndex();
    const tagSet = new Set<string>();
    for (const doc of docs) {
      if (doc.tags) doc.tags.forEach(t => tagSet.add(t));
    }
    res.json({ tags: Array.from(tagSet).sort() });
  } catch (error) {
    res.status(500).json({ error: 'Failed to list tags' });
  }
});

// --- Document Search (keyword search across chunk text) ---

router.get('/search/text', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const query = req.query.q as string;
    if (!query?.trim()) {
      res.status(400).json({ error: 'Search query (q) is required' });
      return;
    }

    const collectionId = req.query.collectionId as string | undefined;
    const results = await searchChunksByKeyword(query.trim(), collectionId);

    res.json({ results });
  } catch (error) {
    logger.error('Document search failed', { error: String(error) });
    res.status(500).json({ error: 'Search failed' });
  }
});

// --- Re-indexing (admin trigger) ---

router.post('/reindex', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    logger.info('Manual re-index triggered', { userId: req.user!.id });
    const result = await checkForChanges();

    await logAuditEvent(req.user!.id, req.user!.username, 'upload', {
      action: 'reindex',
      checked: result.checked,
      reindexed: result.reindexed,
    });

    res.json({
      message: `Checked ${result.checked} documents, re-indexed ${result.reindexed.length}`,
      ...result,
    });
  } catch (error) {
    logger.error('Re-index failed', { error: String(error) });
    res.status(500).json({ error: 'Re-index check failed' });
  }
});

// --- OCR (extract text from scanned documents) ---

const ocrUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB — async Textract via S3 handles larger PDFs
  fileFilter: (_req, file, cb) => {
    const allowedMimes = ['application/pdf', 'image/png', 'image/jpeg', 'image/tiff'];
    const allowedExts = ['.pdf', '.png', '.jpg', '.jpeg', '.tiff', '.tif'];
    const ext = '.' + (file.originalname.split('.').pop() || '').toLowerCase();

    if (allowedMimes.includes(file.mimetype) || allowedExts.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`OCR only supports PDF, PNG, JPEG, and TIFF files (got ${file.mimetype})`));
    }
  },
});

router.post(
  '/ocr',
  authenticate,
  ocrUpload.single('file'),
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: 'No file provided' });
        return;
      }

      // Validate file content matches claimed MIME type
      const contentError = validateFileContent(req.file.buffer, req.file.mimetype, req.file.originalname);
      if (contentError) {
        res.status(400).json({ error: contentError });
        return;
      }

      const result = await extractTextWithOcr(req.file.buffer, req.file.originalname);

      await logAuditEvent(req.user!.id, req.user!.username, 'ocr', {
        filename: req.file.originalname,
        pageCount: result.pageCount,
        confidence: Math.round(result.confidence),
      });

      res.json({
        text: result.text,
        pageCount: result.pageCount,
        confidence: result.confidence,
        filename: req.file.originalname,
      });
    } catch (error) {
      logger.error('OCR extraction failed', { error: String(error) });
      res.status(500).json({ error: error instanceof Error ? error.message : 'OCR extraction failed' });
    }
  }
);

// --- Form Review (detect blank fields and create annotated PDF) ---

const formReviewUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowedMimes = ['application/pdf', 'image/png', 'image/jpeg', 'image/tiff'];
    const allowedExts = ['.pdf', '.png', '.jpg', '.jpeg', '.tiff', '.tif'];
    const ext = '.' + (file.originalname.split('.').pop() || '').toLowerCase();

    if (allowedMimes.includes(file.mimetype) || allowedExts.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Form review supports PDF, PNG, JPEG, and TIFF files (got ${file.mimetype})`));
    }
  },
});

/**
 * POST /api/documents/form-review — Analyze a form for blank fields.
 * Returns JSON with field analysis and optionally generates annotated + original PDFs.
 *
 * Query params:
 *   ?output=json (default) — returns field analysis only
 *   ?output=annotated — returns the annotated PDF (with highlights and watermark)
 *   ?output=original — returns the original clean PDF
 */
router.post(
  '/form-review',
  authenticate,
  formReviewUpload.single('file'),
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: 'No file provided' });
        return;
      }

      // Validate file content
      const contentError = validateFileContent(req.file.buffer, req.file.mimetype, req.file.originalname);
      if (contentError) {
        res.status(400).json({ error: contentError });
        return;
      }

      const output = (req.query.output as string) || 'json';

      // Step 1: Analyze the form with Textract FORMS
      const analysis = await analyzeFormFields(req.file.buffer, req.file.originalname);

      await logAuditEvent(req.user!.id, req.user!.username, 'ocr', {
        operation: 'form_review',
        filename: req.file.originalname,
        totalFields: analysis.totalFields,
        emptyFields: analysis.emptyCount,
        output,
      });

      if (output === 'json') {
        // Return the field analysis as JSON
        res.json({
          filename: req.file.originalname,
          totalFields: analysis.totalFields,
          emptyCount: analysis.emptyCount,
          lowConfidenceCount: analysis.lowConfidenceCount,
          requiredMissingCount: analysis.requiredMissingCount,
          completionPercentage: analysis.completionPercentage,
          pageCount: analysis.pageCount,
          cached: analysis.cached,
          formType: analysis.formType,
          emptyFields: analysis.emptyFields.map(f => ({
            key: f.key,
            page: f.page,
            confidence: Math.round(f.confidence),
            confidenceCategory: f.confidenceCategory,
            isRequired: f.isRequired,
            requiredLabel: f.requiredLabel,
            section: f.section,
            isCheckbox: f.isCheckbox,
          })),
          filledFields: analysis.filledFields.map(f => ({
            key: f.key,
            value: f.value,
            page: f.page,
            confidence: Math.round(f.confidence),
            confidenceCategory: f.confidenceCategory,
            isRequired: f.isRequired,
            section: f.section,
          })),
          lowConfidenceFields: analysis.lowConfidenceFields.map(f => ({
            key: f.key,
            value: f.value,
            page: f.page,
            confidence: Math.round(f.confidence),
            isEmpty: f.isEmpty,
          })),
          requiredMissingFields: analysis.requiredMissingFields.map(f => ({
            key: f.key,
            requiredLabel: f.requiredLabel,
            section: f.section,
            page: f.page,
          })),
        });
        return;
      }

      // For PDF outputs, the source must be a PDF
      const isPdf = req.file.mimetype === 'application/pdf' ||
        req.file.originalname.toLowerCase().endsWith('.pdf');

      if (!isPdf) {
        res.status(400).json({
          error: 'Annotated and original PDF outputs require a PDF input file. Use output=json for images.',
        });
        return;
      }

      if (output === 'annotated') {
        // Step 2: Generate annotated PDF with highlights around empty fields + low-confidence
        const annotatedPdf = await createAnnotatedPdf(req.file.buffer, analysis.emptyFields, analysis.lowConfidenceFields);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="REVIEW-${req.file.originalname}"`,
        );
        res.send(annotatedPdf);
        return;
      }

      if (output === 'original') {
        // Return the original PDF unchanged
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="${req.file.originalname}"`,
        );
        res.send(req.file.buffer);
        return;
      }

      res.status(400).json({ error: 'Invalid output parameter. Use: json, annotated, or original' });
    } catch (error) {
      logger.error('Form review failed', { error: String(error) });
      res.status(500).json({ error: error instanceof Error ? error.message : 'Form review failed' });
    }
  },
);

// --- Batch Form Review ---

const batchFormReviewUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowedMimes = ['application/pdf', 'image/png', 'image/jpeg', 'image/tiff'];
    const allowedExts = ['.pdf', '.png', '.jpg', '.jpeg', '.tiff', '.tif'];
    const ext = '.' + (file.originalname.split('.').pop() || '').toLowerCase();

    if (allowedMimes.includes(file.mimetype) || allowedExts.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Form review supports PDF, PNG, JPEG, and TIFF files (got ${file.mimetype})`));
    }
  },
});

/**
 * POST /api/documents/form-review/batch — Analyze multiple forms at once.
 * Returns a summary array with per-file results.
 * Accepts up to 10 files via multipart form data (field name: "files").
 */
router.post(
  '/form-review/batch',
  authenticate,
  batchFormReviewUpload.array('files', 10),
  async (req: AuthRequest, res: Response) => {
    try {
      const files = req.files as Express.Multer.File[];
      if (!files || files.length === 0) {
        res.status(400).json({ error: 'No files provided' });
        return;
      }

      const fileInputs = files.map(f => ({
        buffer: f.buffer,
        filename: f.originalname,
      }));

      const results = await analyzeFormFieldsBatch(fileInputs);

      await logAuditEvent(req.user!.id, req.user!.username, 'ocr', {
        operation: 'form_review_batch',
        fileCount: files.length,
        filenames: files.map(f => f.originalname),
      });

      const summary = results.map((r, i) => ({
        filename: files[i].originalname,
        totalFields: r.totalFields,
        emptyCount: r.emptyCount,
        requiredMissingCount: r.requiredMissingCount,
        lowConfidenceCount: r.lowConfidenceCount,
        completionPercentage: r.completionPercentage,
        pageCount: r.pageCount,
        cached: r.cached,
        formType: r.formType,
        emptyFields: r.emptyFields.map(f => ({
          key: f.key,
          page: f.page,
          confidence: Math.round(f.confidence),
          confidenceCategory: f.confidenceCategory,
          isRequired: f.isRequired,
          requiredLabel: f.requiredLabel,
          section: f.section,
          isCheckbox: f.isCheckbox,
        })),
        requiredMissingFields: r.requiredMissingFields.map(f => ({
          key: f.key,
          requiredLabel: f.requiredLabel,
          section: f.section,
          page: f.page,
        })),
      }));

      res.json({
        fileCount: files.length,
        totalCachedCount: results.filter(r => r.cached).length,
        results: summary,
      });
    } catch (error) {
      logger.error('Batch form review failed', { error: String(error) });
      res.status(500).json({ error: error instanceof Error ? error.message : 'Batch form review failed' });
    }
  },
);

// --- Clinical Note Extraction (AI-assisted) ---

const clinicalUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowedMimes = ['application/pdf', 'image/png', 'image/jpeg', 'image/tiff',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain'];
    const allowedExts = ['.pdf', '.png', '.jpg', '.jpeg', '.tiff', '.tif', '.docx', '.txt'];
    const ext = '.' + (file.originalname.split('.').pop() || '').toLowerCase();

    if (allowedMimes.includes(file.mimetype) || allowedExts.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Clinical note extraction supports PDF, images, DOCX, and TXT files (got ${file.mimetype})`));
    }
  },
});

/**
 * POST /api/documents/clinical-extract — Extract structured clinical data from
 * physician notes, face-to-face encounters, or other clinical documents.
 *
 * Returns extracted diagnoses, test results, medical necessity language,
 * and mappings to CMN/prior-auth form fields.
 */
router.post(
  '/clinical-extract',
  authenticate,
  clinicalUpload.single('file'),
  async (req: AuthRequest, res: Response) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: 'No file provided' });
        return;
      }

      const contentError = validateFileContent(req.file.buffer, req.file.mimetype, req.file.originalname);
      if (contentError) {
        res.status(400).json({ error: contentError });
        return;
      }

      const result = await extractClinicalNotes(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype,
      );

      await logAuditEvent(req.user!.id, req.user!.username, 'ocr', {
        operation: 'clinical_extract',
        filename: req.file.originalname,
        confidence: result.extraction.confidence,
        icdCodesFound: result.extraction.icdCodes.length,
        mappingsGenerated: result.fieldMappings.length,
      });

      res.json(result);
    } catch (error) {
      logger.error('Clinical note extraction failed', { error: String(error) });
      res.status(500).json({ error: error instanceof Error ? error.message : 'Clinical note extraction failed' });
    }
  },
);

// --- Fee Schedule ---

/**
 * POST /api/documents/fee-schedule/fetch — Manually trigger CMS fee schedule fetch (admin only)
 */
router.post('/fee-schedule/fetch', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const forceRefresh = req.body?.forceRefresh === true;
    const result = await fetchAndIngestFeeSchedule(forceRefresh);
    res.json(result);
  } catch (error) {
    logger.error('Fee schedule fetch failed', { error: String(error) });
    res.status(500).json({ error: 'Fee schedule fetch failed' });
  }
});

export default router;
