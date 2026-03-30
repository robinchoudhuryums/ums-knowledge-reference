/**
 * Tests for the documents route handlers.
 *
 * Uses supertest to send requests through the Express router with all
 * service dependencies mocked via vi.mock().
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Mock all service dependencies at module level (before imports) ---

vi.mock('../services/s3Storage', () => ({
  getDocumentsIndex: vi.fn().mockResolvedValue([]),
  saveDocumentsIndex: vi.fn().mockResolvedValue(undefined),
  deleteDocumentFromS3: vi.fn().mockResolvedValue(undefined),
  getCollectionsIndex: vi.fn().mockResolvedValue([]),
  saveCollectionsIndex: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/vectorStore', () => ({
  removeDocumentChunks: vi.fn().mockResolvedValue(undefined),
  searchChunksByKeyword: vi.fn().mockResolvedValue([]),
}));

vi.mock('../services/audit', () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/ingestion', () => ({
  ingestDocument: vi.fn().mockResolvedValue({
    document: { id: 'doc-new', originalName: 'test.pdf' },
    chunkCount: 3,
  }),
}));

vi.mock('../services/ocr', () => ({
  extractTextWithOcr: vi.fn().mockResolvedValue({ text: 'ocr text', pageCount: 1, confidence: 95 }),
}));

vi.mock('../services/formAnalyzer', () => ({
  analyzeFormFields: vi.fn().mockResolvedValue({
    totalFields: 10,
    emptyCount: 2,
    lowConfidenceCount: 1,
    requiredMissingCount: 1,
    completionPercentage: 80,
    pageCount: 1,
    cached: false,
    formType: 'general',
    emptyFields: [],
    filledFields: [],
    lowConfidenceFields: [],
    requiredMissingFields: [],
  }),
  analyzeFormFieldsBatch: vi.fn().mockResolvedValue([]),
}));

vi.mock('../services/pdfAnnotator', () => ({
  createAnnotatedPdf: vi.fn().mockResolvedValue(Buffer.from('annotated-pdf')),
}));

vi.mock('../services/reindexer', () => ({
  checkForChanges: vi.fn().mockResolvedValue({ checked: 5, reindexed: ['doc-1'] }),
}));

vi.mock('../services/feeScheduleFetcher', () => ({
  fetchAndIngestFeeSchedule: vi.fn().mockResolvedValue({ status: 'fetched', documentsIngested: 1 }),
}));

vi.mock('../services/clinicalNoteExtractor', () => ({
  extractClinicalNotes: vi.fn().mockResolvedValue({
    extraction: { confidence: 0.9, icdCodes: ['J44.1'] },
    fieldMappings: [{ field: 'diagnosis', value: 'COPD' }],
  }),
}));

vi.mock('../utils/fileValidation', () => ({
  validateFileContent: vi.fn().mockReturnValue(null),
}));

vi.mock('../utils/malwareScan', () => ({
  scanFileForMalware: vi.fn().mockResolvedValue({ scanned: true, clean: true }),
}));

vi.mock('../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock auth middleware to pass through with a test user
vi.mock('../middleware/auth', () => ({
  authenticate: vi.fn((_req: any, _res: any, next: any) => {
    _req.user = { id: 'user-1', username: 'testadmin', role: 'admin' };
    next();
  }),
  requireAdmin: vi.fn((_req: any, _res: any, next: any) => {
    next();
  }),
  getUserAllowedCollections: vi.fn().mockResolvedValue(null),
  AuthRequest: {},
}));

// Mock express-rate-limit to be a passthrough
vi.mock('express-rate-limit', () => ({
  default: vi.fn(() => (_req: any, _res: any, next: any) => next()),
}));

// Mock dynamic imports used in purge route
vi.mock('../services/queryLog', () => ({
  purgeDocumentFromQueryLogs: vi.fn().mockResolvedValue(3),
}));

vi.mock('../services/ragTrace', () => ({
  purgeDocumentFromTraces: vi.fn().mockResolvedValue(2),
}));

vi.mock('../services/feedback', () => ({
  purgeDocumentFromFeedback: vi.fn().mockResolvedValue(1),
}));

// --- Imports after mocks ---

import express from 'express';
import request from 'supertest';
import documentsRouter from '../routes/documents';
import {
  getDocumentsIndex,
  saveDocumentsIndex,
  deleteDocumentFromS3,
  getCollectionsIndex,
  saveCollectionsIndex,
} from '../services/s3Storage';
import { removeDocumentChunks, searchChunksByKeyword } from '../services/vectorStore';
import { logAuditEvent } from '../services/audit';
import { getUserAllowedCollections } from '../middleware/auth';
import { Document, Collection } from '../types';

// --- Test app setup ---

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/documents', documentsRouter);
  return app;
}

// --- Helpers ---

function makeDoc(overrides: Partial<Document> = {}): Document {
  return {
    id: 'doc-1',
    filename: 'test.pdf',
    originalName: 'test.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    s3Key: 'documents/doc-1/test.pdf',
    collectionId: 'default',
    uploadedBy: 'admin',
    uploadedAt: '2025-01-01T00:00:00Z',
    status: 'ready',
    chunkCount: 5,
    version: 1,
    ...overrides,
  };
}

function makeCollection(overrides: Partial<Collection> = {}): Collection {
  return {
    id: 'col-1',
    name: 'Test Collection',
    description: 'A test collection',
    createdBy: 'admin',
    createdAt: '2025-01-01T00:00:00Z',
    documentCount: 0,
    ...overrides,
  };
}

// --- Tests ---

describe('Documents Route', () => {
  const app = createApp();

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset default mock returns
    (getDocumentsIndex as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (getCollectionsIndex as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (getUserAllowedCollections as ReturnType<typeof vi.fn>).mockResolvedValue(null);
  });

  // =============================================
  // GET / — List documents
  // =============================================

  describe('GET / — List documents', () => {
    it('returns all non-replaced documents', async () => {
      const docs = [
        makeDoc({ id: 'doc-1' }),
        makeDoc({ id: 'doc-2', originalName: 'other.pdf' }),
      ];
      (getDocumentsIndex as ReturnType<typeof vi.fn>).mockResolvedValue(docs);

      const res = await request(app).get('/api/documents');

      expect(res.status).toBe(200);
      expect(res.body.documents).toHaveLength(2);
    });

    it('excludes documents marked as replaced', async () => {
      const docs = [
        makeDoc({ id: 'doc-1' }),
        makeDoc({ id: 'doc-old', errorMessage: 'Replaced by doc-1', status: 'replaced' }),
      ];
      (getDocumentsIndex as ReturnType<typeof vi.fn>).mockResolvedValue(docs);

      const res = await request(app).get('/api/documents');

      expect(res.status).toBe(200);
      expect(res.body.documents).toHaveLength(1);
      expect(res.body.documents[0].id).toBe('doc-1');
    });

    it('filters by collectionId query param', async () => {
      const docs = [
        makeDoc({ id: 'doc-1', collectionId: 'col-a' }),
        makeDoc({ id: 'doc-2', collectionId: 'col-b' }),
      ];
      (getDocumentsIndex as ReturnType<typeof vi.fn>).mockResolvedValue(docs);

      const res = await request(app).get('/api/documents?collectionId=col-a');

      expect(res.status).toBe(200);
      expect(res.body.documents).toHaveLength(1);
      expect(res.body.documents[0].id).toBe('doc-1');
    });

    it('applies collection ACL for non-admin users', async () => {
      const docs = [
        makeDoc({ id: 'doc-1', collectionId: 'col-a' }),
        makeDoc({ id: 'doc-2', collectionId: 'col-b' }),
        makeDoc({ id: 'doc-3', collectionId: 'col-c' }),
      ];
      (getDocumentsIndex as ReturnType<typeof vi.fn>).mockResolvedValue(docs);
      (getUserAllowedCollections as ReturnType<typeof vi.fn>).mockResolvedValue(['col-a', 'col-c']);

      const res = await request(app).get('/api/documents');

      expect(res.status).toBe(200);
      expect(res.body.documents).toHaveLength(2);
      const ids = res.body.documents.map((d: any) => d.id);
      expect(ids).toContain('doc-1');
      expect(ids).toContain('doc-3');
      expect(ids).not.toContain('doc-2');
    });
  });

  // =============================================
  // GET /:id — Get single document
  // =============================================

  describe('GET /:id — Get document', () => {
    it('returns 404 for non-existent document', async () => {
      (getDocumentsIndex as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const res = await request(app).get('/api/documents/nonexistent');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Document not found');
    });

    it('returns document metadata', async () => {
      const doc = makeDoc({ id: 'doc-42' });
      (getDocumentsIndex as ReturnType<typeof vi.fn>).mockResolvedValue([doc]);

      const res = await request(app).get('/api/documents/doc-42');

      expect(res.status).toBe(200);
      expect(res.body.document.id).toBe('doc-42');
      expect(res.body.document.originalName).toBe('test.pdf');
    });
  });

  // =============================================
  // DELETE /:id — Delete document
  // =============================================

  describe('DELETE /:id — Delete document', () => {
    it('returns 404 for non-existent document', async () => {
      (getDocumentsIndex as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const res = await request(app).delete('/api/documents/nonexistent');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Document not found');
    });

    it('deletes from vector store, S3, and index then logs audit', async () => {
      const doc = makeDoc({ id: 'doc-del', s3Key: 'documents/doc-del/file.pdf', originalName: 'file.pdf' });
      (getDocumentsIndex as ReturnType<typeof vi.fn>).mockResolvedValue([doc]);

      const res = await request(app).delete('/api/documents/doc-del');

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Document deleted');
      expect(removeDocumentChunks).toHaveBeenCalledWith('doc-del');
      expect(deleteDocumentFromS3).toHaveBeenCalledWith('documents/doc-del/file.pdf');
      expect(saveDocumentsIndex).toHaveBeenCalledWith([]);
      expect(logAuditEvent).toHaveBeenCalledWith(
        'user-1',
        'testadmin',
        'delete',
        expect.objectContaining({ documentId: 'doc-del', filename: 'file.pdf' }),
      );
    });
  });

  // =============================================
  // POST /bulk-delete — Bulk delete
  // =============================================

  describe('POST /bulk-delete — Bulk delete', () => {
    it('returns 400 for empty array', async () => {
      const res = await request(app)
        .post('/api/documents/bulk-delete')
        .send({ documentIds: [] });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/non-empty array/);
    });

    it('returns 400 for missing documentIds', async () => {
      const res = await request(app)
        .post('/api/documents/bulk-delete')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/non-empty array/);
    });

    it('returns 400 for more than 50 documents', async () => {
      const ids = Array.from({ length: 51 }, (_, i) => `doc-${i}`);

      const res = await request(app)
        .post('/api/documents/bulk-delete')
        .send({ documentIds: ids });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Maximum 50/);
    });

    it('handles mix of found and not_found documents', async () => {
      const docs = [
        makeDoc({ id: 'doc-a', originalName: 'a.pdf', s3Key: 'documents/doc-a/a.pdf' }),
        makeDoc({ id: 'doc-b', originalName: 'b.pdf', s3Key: 'documents/doc-b/b.pdf' }),
      ];
      (getDocumentsIndex as ReturnType<typeof vi.fn>).mockResolvedValue(docs);

      const res = await request(app)
        .post('/api/documents/bulk-delete')
        .send({ documentIds: ['doc-a', 'doc-missing', 'doc-b'] });

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/Deleted 2 of 3/);
      expect(res.body.results).toHaveLength(3);

      const statuses = res.body.results.map((r: any) => r.status);
      expect(statuses).toContain('deleted');
      expect(statuses).toContain('not_found');
      expect(removeDocumentChunks).toHaveBeenCalledTimes(2);
      expect(deleteDocumentFromS3).toHaveBeenCalledTimes(2);
      expect(saveDocumentsIndex).toHaveBeenCalled();
      expect(logAuditEvent).toHaveBeenCalled();
    });

    it('reports errors for individual document failures', async () => {
      const doc = makeDoc({ id: 'doc-err', s3Key: 'documents/doc-err/file.pdf' });
      (getDocumentsIndex as ReturnType<typeof vi.fn>).mockResolvedValue([doc]);
      (removeDocumentChunks as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('chunk removal failed'));

      const res = await request(app)
        .post('/api/documents/bulk-delete')
        .send({ documentIds: ['doc-err'] });

      expect(res.status).toBe(200);
      expect(res.body.results[0].status).toBe('error');
      expect(res.body.results[0].error).toMatch(/chunk removal failed/);
    });
  });

  // =============================================
  // GET /:id/versions — Version history
  // =============================================

  describe('GET /:id/versions — Version history', () => {
    it('returns 404 for non-existent document', async () => {
      (getDocumentsIndex as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const res = await request(app).get('/api/documents/nonexistent/versions');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Document not found');
    });

    it('returns version history sorted by version descending', async () => {
      const docs = [
        makeDoc({ id: 'doc-v1', version: 1, originalName: 'report.pdf', collectionId: 'default', uploadedAt: '2025-01-01T00:00:00Z' }),
        makeDoc({ id: 'doc-v2', version: 2, originalName: 'report.pdf', collectionId: 'default', previousVersionId: 'doc-v1', uploadedAt: '2025-02-01T00:00:00Z' }),
        makeDoc({ id: 'doc-other', version: 1, originalName: 'other.pdf', collectionId: 'default' }),
      ];
      (getDocumentsIndex as ReturnType<typeof vi.fn>).mockResolvedValue(docs);

      const res = await request(app).get('/api/documents/doc-v2/versions');

      expect(res.status).toBe(200);
      expect(res.body.documentName).toBe('report.pdf');
      expect(res.body.currentVersion).toBe(2);
      expect(res.body.versions).toHaveLength(2);
      // Sorted descending by version
      expect(res.body.versions[0].version).toBe(2);
      expect(res.body.versions[1].version).toBe(1);
    });
  });

  // =============================================
  // Collections
  // =============================================

  describe('GET /collections/list — List collections', () => {
    it('returns collections', async () => {
      const cols = [makeCollection({ id: 'col-1', name: 'Policies' })];
      (getCollectionsIndex as ReturnType<typeof vi.fn>).mockResolvedValue(cols);

      const res = await request(app).get('/api/documents/collections/list');

      expect(res.status).toBe(200);
      expect(res.body.collections).toHaveLength(1);
      expect(res.body.collections[0].name).toBe('Policies');
    });
  });

  describe('POST /collections — Create collection', () => {
    it('creates a new collection', async () => {
      (getCollectionsIndex as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const res = await request(app)
        .post('/api/documents/collections')
        .send({ name: 'New Collection', description: 'Desc' });

      expect(res.status).toBe(201);
      expect(res.body.collection.name).toBe('New Collection');
      expect(res.body.collection.description).toBe('Desc');
      expect(res.body.collection.createdBy).toBe('testadmin');
      expect(saveCollectionsIndex).toHaveBeenCalled();
      expect(logAuditEvent).toHaveBeenCalledWith(
        'user-1',
        'testadmin',
        'collection_create',
        expect.objectContaining({ name: 'New Collection' }),
      );
    });

    it('returns 400 when name is missing', async () => {
      const res = await request(app)
        .post('/api/documents/collections')
        .send({ description: 'No name' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/name is required/);
    });

    it('returns 409 for duplicate collection name', async () => {
      (getCollectionsIndex as ReturnType<typeof vi.fn>).mockResolvedValue([
        makeCollection({ name: 'Existing' }),
      ]);

      const res = await request(app)
        .post('/api/documents/collections')
        .send({ name: 'Existing' });

      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/already exists/);
    });
  });

  describe('DELETE /collections/:id — Delete collection', () => {
    it('returns 404 for non-existent collection', async () => {
      (getCollectionsIndex as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const res = await request(app).delete('/api/documents/collections/nonexistent');

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Collection not found');
    });

    it('returns 400 when collection still has ready documents', async () => {
      (getCollectionsIndex as ReturnType<typeof vi.fn>).mockResolvedValue([
        makeCollection({ id: 'col-with-docs' }),
      ]);
      (getDocumentsIndex as ReturnType<typeof vi.fn>).mockResolvedValue([
        makeDoc({ collectionId: 'col-with-docs', status: 'ready' }),
      ]);

      const res = await request(app).delete('/api/documents/collections/col-with-docs');

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/still has 1 documents/);
    });

    it('deletes an empty collection', async () => {
      (getCollectionsIndex as ReturnType<typeof vi.fn>).mockResolvedValue([
        makeCollection({ id: 'col-empty', name: 'Empty' }),
      ]);
      (getDocumentsIndex as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const res = await request(app).delete('/api/documents/collections/col-empty');

      expect(res.status).toBe(200);
      expect(res.body.message).toBe('Collection deleted');
      expect(saveCollectionsIndex).toHaveBeenCalledWith([]);
      expect(logAuditEvent).toHaveBeenCalledWith(
        'user-1',
        'testadmin',
        'collection_delete',
        expect.objectContaining({ name: 'Empty' }),
      );
    });
  });

  // =============================================
  // Tags
  // =============================================

  describe('PUT /:id/tags — Update tags', () => {
    it('normalizes tags to lowercase, trims, and deduplicates', async () => {
      const doc = makeDoc({ id: 'doc-tags' });
      (getDocumentsIndex as ReturnType<typeof vi.fn>).mockResolvedValue([doc]);

      const res = await request(app)
        .put('/api/documents/doc-tags/tags')
        .send({ tags: ['Medicare', ' MEDICARE ', 'oxygen', 'Oxygen'] });

      expect(res.status).toBe(200);
      const tags = res.body.document.tags;
      expect(tags).toEqual(['medicare', 'oxygen']);
      expect(saveDocumentsIndex).toHaveBeenCalled();
      expect(logAuditEvent).toHaveBeenCalled();
    });

    it('returns 400 for non-array tags', async () => {
      const res = await request(app)
        .put('/api/documents/doc-1/tags')
        .send({ tags: 'not-an-array' });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/array of strings/);
    });

    it('returns 400 for tags containing non-strings', async () => {
      const res = await request(app)
        .put('/api/documents/doc-1/tags')
        .send({ tags: ['valid', 123] });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/array of strings/);
    });

    it('returns 404 for non-existent document', async () => {
      (getDocumentsIndex as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const res = await request(app)
        .put('/api/documents/nonexistent/tags')
        .send({ tags: ['test'] });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Document not found');
    });
  });

  describe('GET /tags/list — List all unique tags', () => {
    it('returns sorted unique tags across all documents', async () => {
      const docs = [
        makeDoc({ id: 'doc-1', tags: ['oxygen', 'cpap'] }),
        makeDoc({ id: 'doc-2', tags: ['cpap', 'wheelchair'] }),
        makeDoc({ id: 'doc-3' }), // no tags
      ];
      (getDocumentsIndex as ReturnType<typeof vi.fn>).mockResolvedValue(docs);

      const res = await request(app).get('/api/documents/tags/list');

      expect(res.status).toBe(200);
      expect(res.body.tags).toEqual(['cpap', 'oxygen', 'wheelchair']);
    });

    it('returns empty array when no documents have tags', async () => {
      (getDocumentsIndex as ReturnType<typeof vi.fn>).mockResolvedValue([makeDoc()]);

      const res = await request(app).get('/api/documents/tags/list');

      expect(res.status).toBe(200);
      expect(res.body.tags).toEqual([]);
    });
  });

  // =============================================
  // Search
  // =============================================

  describe('GET /search/text — Keyword search', () => {
    it('returns 400 for empty query', async () => {
      const res = await request(app).get('/api/documents/search/text');

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/query.*required/i);
    });

    it('returns 400 for whitespace-only query', async () => {
      const res = await request(app).get('/api/documents/search/text?q=   ');

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/query.*required/i);
    });

    it('returns search results for a valid query', async () => {
      const mockResults = [
        { chunk: { id: 'chunk-1', text: 'oxygen therapy' }, document: { id: 'doc-1' }, score: 0.9 },
      ];
      (searchChunksByKeyword as ReturnType<typeof vi.fn>).mockResolvedValue(mockResults);

      const res = await request(app).get('/api/documents/search/text?q=oxygen');

      expect(res.status).toBe(200);
      expect(res.body.results).toHaveLength(1);
      expect(searchChunksByKeyword).toHaveBeenCalledWith('oxygen', undefined);
    });

    it('passes collectionId filter to search', async () => {
      (searchChunksByKeyword as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      await request(app).get('/api/documents/search/text?q=oxygen&collectionId=col-x');

      expect(searchChunksByKeyword).toHaveBeenCalledWith('oxygen', 'col-x');
    });
  });

  // =============================================
  // Reindex
  // =============================================

  describe('POST /reindex — Trigger re-index', () => {
    it('returns reindex results and logs audit event', async () => {
      const res = await request(app).post('/api/documents/reindex');

      expect(res.status).toBe(200);
      expect(res.body.checked).toBe(5);
      expect(res.body.reindexed).toEqual(['doc-1']);
      expect(logAuditEvent).toHaveBeenCalledWith(
        'user-1',
        'testadmin',
        'upload',
        expect.objectContaining({ action: 'reindex', checked: 5 }),
      );
    });
  });

  // =============================================
  // Fee schedule
  // =============================================

  describe('POST /fee-schedule/fetch — Fetch fee schedule', () => {
    it('returns fetch result', async () => {
      const res = await request(app)
        .post('/api/documents/fee-schedule/fetch')
        .send({ forceRefresh: true });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('fetched');
    });
  });

  // =============================================
  // Purge
  // =============================================

  describe('POST /:id/purge — HIPAA data purge', () => {
    it('purges document and all references', async () => {
      const doc = makeDoc({ id: 'doc-purge', s3Key: 'documents/doc-purge/file.pdf', originalName: 'file.pdf' });
      (getDocumentsIndex as ReturnType<typeof vi.fn>).mockResolvedValue([doc]);

      const res = await request(app).post('/api/documents/doc-purge/purge');

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/purged/);
      expect(res.body.purgedItems.vectorChunks).toBe(1);
      expect(res.body.purgedItems.s3Document).toBe(1);
      expect(res.body.purgedItems.queryLogEntries).toBe(3);
      expect(res.body.purgedItems.ragTraceEntries).toBe(2);
      expect(res.body.purgedItems.feedbackEntries).toBe(1);
      expect(removeDocumentChunks).toHaveBeenCalledWith('doc-purge');
      expect(deleteDocumentFromS3).toHaveBeenCalledWith('documents/doc-purge/file.pdf');
      expect(logAuditEvent).toHaveBeenCalledWith(
        'user-1',
        'testadmin',
        'data_purge',
        expect.objectContaining({ documentId: 'doc-purge' }),
      );
    });

    it('purges even when document is not in index (already deleted)', async () => {
      (getDocumentsIndex as ReturnType<typeof vi.fn>).mockResolvedValue([]);

      const res = await request(app).post('/api/documents/doc-gone/purge');

      expect(res.status).toBe(200);
      expect(res.body.purgedItems.vectorChunks).toBe(1);
      // s3Document should not be present since doc was not found
      expect(res.body.purgedItems.s3Document).toBeUndefined();
    });
  });
});
