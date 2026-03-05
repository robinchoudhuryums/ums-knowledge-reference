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
import { checkForChanges } from '../services/reindexer';
import { Collection } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';

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

export default router;
