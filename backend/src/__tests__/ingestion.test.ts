import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies at module level
vi.mock('../services/s3Storage', () => ({
  getDocumentsIndex: vi.fn().mockResolvedValue([]),
  saveDocumentsIndex: vi.fn().mockResolvedValue(undefined),
  uploadDocumentToS3: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/textExtractor', () => ({
  extractText: vi.fn().mockResolvedValue({ text: 'Sample text content for testing' }),
}));

vi.mock('../services/visionExtractor', () => ({
  extractImageDescriptions: vi.fn().mockResolvedValue(''),
}));

vi.mock('../services/chunker', () => ({
  chunkDocument: vi.fn().mockReturnValue([
    {
      id: 'chunk-1',
      documentId: 'doc-1',
      chunkIndex: 0,
      text: 'Sample text content for testing',
      tokenCount: 6,
      startOffset: 0,
      endOffset: 30,
    },
  ]),
}));

vi.mock('../services/embeddings', () => ({
  generateEmbeddingsBatch: vi.fn().mockResolvedValue([[0.1, 0.2]]),
}));

vi.mock('../services/vectorStore', () => ({
  addChunksToStore: vi.fn().mockResolvedValue(undefined),
  removeDocumentChunks: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/audit', () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { ingestDocument } from '../services/ingestion';
import { getDocumentsIndex, saveDocumentsIndex } from '../services/s3Storage';

describe('Ingestion Pipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getDocumentsIndex as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (saveDocumentsIndex as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  });

  describe('Extension validation', () => {
    it('should reject .exe files', async () => {
      const buffer = Buffer.from('malicious content');
      await expect(
        ingestDocument(buffer, 'malware.exe', 'application/octet-stream', 'col-1', 'user-1')
      ).rejects.toThrow('Unsupported file extension: .exe');
    });

    it('should reject .bat files', async () => {
      const buffer = Buffer.from('batch script');
      await expect(
        ingestDocument(buffer, 'script.bat', 'application/octet-stream', 'col-1', 'user-1')
      ).rejects.toThrow('Unsupported file extension: .bat');
    });

    it('should accept .pdf files', async () => {
      const buffer = Buffer.from('pdf content');
      const result = await ingestDocument(buffer, 'report.pdf', 'application/pdf', 'col-1', 'user-1');
      expect(result).toBeDefined();
      expect(result.document.originalName).toBe('report.pdf');
    });

    it('should accept .docx files', async () => {
      const buffer = Buffer.from('docx content');
      const result = await ingestDocument(buffer, 'doc.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'col-1', 'user-1');
      expect(result).toBeDefined();
      expect(result.document.originalName).toBe('doc.docx');
    });

    it('should accept .csv files', async () => {
      const buffer = Buffer.from('a,b,c\n1,2,3');
      const result = await ingestDocument(buffer, 'data.csv', 'text/csv', 'col-1', 'user-1');
      expect(result).toBeDefined();
      expect(result.document.originalName).toBe('data.csv');
    });
  });

  describe('ALLOWED_EXTENSIONS set', () => {
    const expectedExtensions = ['pdf', 'docx', 'doc', 'xlsx', 'xls', 'csv', 'txt', 'md', 'html', 'htm'];

    it.each(expectedExtensions)('should allow .%s files', async (ext) => {
      const buffer = Buffer.from('test content');
      const result = await ingestDocument(buffer, `file.${ext}`, 'application/octet-stream', 'col-1', 'user-1');
      expect(result).toBeDefined();
    });

    const blockedExtensions = ['exe', 'bat', 'sh', 'js', 'py', 'zip', 'tar', 'gz', 'dll', 'so'];

    it.each(blockedExtensions)('should reject .%s files', async (ext) => {
      const buffer = Buffer.from('test content');
      await expect(
        ingestDocument(buffer, `file.${ext}`, 'application/octet-stream', 'col-1', 'user-1')
      ).rejects.toThrow(`Unsupported file extension: .${ext}`);
    });
  });

  describe('Document record creation', () => {
    it('should create a document with version 1 for new uploads', async () => {
      const buffer = Buffer.from('document content');
      const result = await ingestDocument(buffer, 'new-doc.pdf', 'application/pdf', 'col-1', 'user-1');

      expect(result.document.version).toBe(1);
      expect(result.document.previousVersionId).toBeUndefined();
    });

    it('should set contentHash as a SHA-256 hex string', async () => {
      const buffer = Buffer.from('document content');
      const result = await ingestDocument(buffer, 'doc.pdf', 'application/pdf', 'col-1', 'user-1');

      expect(result.document.contentHash).toBeDefined();
      expect(result.document.contentHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should set status to ready on successful ingestion', async () => {
      const buffer = Buffer.from('document content');
      const result = await ingestDocument(buffer, 'doc.txt', 'text/plain', 'col-1', 'user-1');

      expect(result.document.status).toBe('ready');
    });

    it('should set correct fields on the document record', async () => {
      const buffer = Buffer.from('document content');
      const result = await ingestDocument(buffer, 'report.pdf', 'application/pdf', 'col-1', 'user-1');
      const doc = result.document;

      expect(doc.id).toBeDefined();
      expect(doc.originalName).toBe('report.pdf');
      expect(doc.mimeType).toBe('application/pdf');
      expect(doc.sizeBytes).toBe(buffer.length);
      expect(doc.collectionId).toBe('col-1');
      expect(doc.uploadedBy).toBe('user-1');
      expect(doc.uploadedAt).toBeDefined();
      expect(doc.chunkCount).toBe(1);
    });

    it('should reject duplicate content in the same collection', async () => {
      const buffer = Buffer.from('identical content');
      await ingestDocument(buffer, 'a.txt', 'text/plain', 'col-1', 'user-1');

      await expect(
        ingestDocument(buffer, 'b.txt', 'text/plain', 'col-1', 'user-1')
      ).rejects.toThrow('identical content already exists');
    });

    it('should allow same content in different collections', async () => {
      const buffer = Buffer.from('identical content');
      const result1 = await ingestDocument(buffer, 'a.txt', 'text/plain', 'col-1', 'user-1');
      const result2 = await ingestDocument(buffer, 'a.txt', 'text/plain', 'col-2', 'user-1');

      expect(result1.document.contentHash).toBe(result2.document.contentHash);
    });

    it('should return correct chunkCount', async () => {
      const buffer = Buffer.from('document content');
      const result = await ingestDocument(buffer, 'doc.txt', 'text/plain', 'col-1', 'user-1');

      expect(result.chunkCount).toBe(1);
    });
  });
});
