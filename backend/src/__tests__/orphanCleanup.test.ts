/**
 * Unit tests for the orphan cleanup service (backend/src/services/orphanCleanup.ts).
 *
 * Mocks S3 storage (getDocumentsIndex / saveDocumentsIndex) and the vector
 * store (removeDocumentChunks) to test cleanup logic without real AWS calls.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Document } from '../types';

// ---------------------------------------------------------------------------
// Mock S3 storage
// ---------------------------------------------------------------------------
let mockDocs: Document[] = [];

vi.mock('../services/s3Storage', () => ({
  getDocumentsIndex: vi.fn(async () => mockDocs),
  saveDocumentsIndex: vi.fn(async (docs: Document[]) => { mockDocs = docs; }),
  loadMetadata: vi.fn(async () => null),
  saveMetadata: vi.fn(async () => {}),
}));

// Mock vector store
vi.mock('../services/vectorStore', () => ({
  removeDocumentChunks: vi.fn(async () => {}),
}));

// Mock logger
vi.mock('../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Import after mocks
import { cleanupOrphanedDocuments } from '../services/orphanCleanup';
import { removeDocumentChunks } from '../services/vectorStore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ONE_HOUR_MS = 60 * 60 * 1000;
const TWENTY_FIVE_HOURS_AGO = new Date(Date.now() - 25 * ONE_HOUR_MS).toISOString();
const TWO_HOURS_AGO = new Date(Date.now() - 2 * ONE_HOUR_MS).toISOString();
const NOW = new Date().toISOString();

function makeDoc(overrides: Partial<Document> & { id: string }): Document {
  return {
    filename: `${overrides.id}.pdf`,
    originalName: `${overrides.id}.pdf`,
    mimeType: 'application/pdf',
    sizeBytes: 1024,
    s3Key: `documents/${overrides.id}.pdf`,
    collectionId: 'col-1',
    uploadedBy: 'user-001',
    uploadedAt: NOW,
    status: 'ready',
    chunkCount: 5,
    version: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Orphan Cleanup Service', () => {
  beforeEach(() => {
    mockDocs = [];
    vi.clearAllMocks();
  });

  // 1. Marks stuck 'uploading' docs as error after 24h
  it('marks stuck uploading documents as error after 24 hours', async () => {
    mockDocs = [
      makeDoc({ id: 'doc-1', status: 'uploading', uploadedAt: TWENTY_FIVE_HOURS_AGO }),
    ];

    const cleaned = await cleanupOrphanedDocuments();

    expect(cleaned).toBe(1);
    expect(mockDocs[0].status).toBe('error');
    expect(mockDocs[0].errorMessage).toContain('Orphaned');
    expect(removeDocumentChunks).toHaveBeenCalledWith('doc-1');
  });

  // 2. Marks stuck 'processing' docs as error after 24h
  it('marks stuck processing documents as error after 24 hours', async () => {
    mockDocs = [
      makeDoc({ id: 'doc-2', status: 'processing', uploadedAt: TWENTY_FIVE_HOURS_AGO }),
    ];

    const cleaned = await cleanupOrphanedDocuments();

    expect(cleaned).toBe(1);
    expect(mockDocs[0].status).toBe('error');
    expect(mockDocs[0].errorMessage).toContain('Orphaned');
  });

  // 3. Ignores recent uploads (less than 24h)
  it('ignores recent uploads that are less than 24 hours old', async () => {
    mockDocs = [
      makeDoc({ id: 'doc-3', status: 'uploading', uploadedAt: TWO_HOURS_AGO }),
      makeDoc({ id: 'doc-4', status: 'processing', uploadedAt: TWO_HOURS_AGO }),
    ];

    const cleaned = await cleanupOrphanedDocuments();

    expect(cleaned).toBe(0);
    expect(mockDocs[0].status).toBe('uploading');
    expect(mockDocs[1].status).toBe('processing');
    // saveDocumentsIndex should NOT be called when nothing was cleaned
    const { saveDocumentsIndex } = await import('../services/s3Storage');
    expect(saveDocumentsIndex).not.toHaveBeenCalled();
  });

  // 4. Ignores 'ready' and 'error' status docs regardless of age
  it('ignores documents with ready or error status', async () => {
    mockDocs = [
      makeDoc({ id: 'doc-5', status: 'ready', uploadedAt: TWENTY_FIVE_HOURS_AGO }),
      makeDoc({ id: 'doc-6', status: 'error', uploadedAt: TWENTY_FIVE_HOURS_AGO }),
    ];

    const cleaned = await cleanupOrphanedDocuments();

    expect(cleaned).toBe(0);
    expect(mockDocs[0].status).toBe('ready');
    expect(mockDocs[1].status).toBe('error');
  });

  // 5. Returns correct count of cleaned documents
  it('returns the count of cleaned documents', async () => {
    mockDocs = [
      makeDoc({ id: 'doc-7', status: 'uploading', uploadedAt: TWENTY_FIVE_HOURS_AGO }),
      makeDoc({ id: 'doc-8', status: 'processing', uploadedAt: TWENTY_FIVE_HOURS_AGO }),
      makeDoc({ id: 'doc-9', status: 'ready', uploadedAt: TWENTY_FIVE_HOURS_AGO }),
      makeDoc({ id: 'doc-10', status: 'uploading', uploadedAt: TWO_HOURS_AGO }), // too recent
      makeDoc({ id: 'doc-11', status: 'processing', uploadedAt: TWENTY_FIVE_HOURS_AGO }),
    ];

    const cleaned = await cleanupOrphanedDocuments();

    expect(cleaned).toBe(3); // doc-7, doc-8, doc-11
    // Verify only the orphaned ones were changed
    expect(mockDocs.find(d => d.id === 'doc-7')!.status).toBe('error');
    expect(mockDocs.find(d => d.id === 'doc-8')!.status).toBe('error');
    expect(mockDocs.find(d => d.id === 'doc-9')!.status).toBe('ready');
    expect(mockDocs.find(d => d.id === 'doc-10')!.status).toBe('uploading');
    expect(mockDocs.find(d => d.id === 'doc-11')!.status).toBe('error');
    // removeDocumentChunks called for each orphan
    expect(removeDocumentChunks).toHaveBeenCalledTimes(3);
  });
});
