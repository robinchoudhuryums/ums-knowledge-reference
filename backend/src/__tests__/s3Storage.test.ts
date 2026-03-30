import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoist mock functions so they are available inside vi.mock factories
const { mockSend, mockUploadDone } = vi.hoisted(() => ({
  mockSend: vi.fn(),
  mockUploadDone: vi.fn().mockResolvedValue({}),
}));

// Mock aws config
vi.mock('../config/aws', () => ({
  s3Client: { send: mockSend },
  S3_BUCKET: 'test-bucket',
  S3_PREFIXES: {
    documents: 'documents/',
    vectors: 'vectors/',
    metadata: 'metadata/',
    audit: 'audit/',
  },
}));

// Mock @aws-sdk/lib-storage Upload as a constructor class
vi.mock('@aws-sdk/lib-storage', () => ({
  Upload: vi.fn().mockImplementation(function (this: any) {
    this.done = mockUploadDone;
  }),
}));

vi.mock('../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock the db re-exports used by s3Storage
vi.mock('../db', () => ({
  getDocumentsIndex: vi.fn().mockResolvedValue([]),
  saveDocumentsIndex: vi.fn().mockResolvedValue(undefined),
  getCollectionsIndex: vi.fn().mockResolvedValue([]),
  saveCollectionsIndex: vi.fn().mockResolvedValue(undefined),
}));

import {
  uploadDocumentToS3,
  getDocumentFromS3,
  getDocumentETag,
  deleteDocumentFromS3,
  saveMetadata,
  loadMetadata,
  deleteMetadata,
  saveVectorIndex,
  loadVectorIndex,
  getDocumentsIndex,
  saveDocumentsIndex,
  getCollectionsIndex,
  saveCollectionsIndex,
} from '../services/s3Storage';
import { Upload } from '@aws-sdk/lib-storage';
import { VectorStoreIndex } from '../types';

// Helper to create a mock S3 GetObject response body
function mockS3Body(content: string) {
  return {
    Body: {
      transformToString: vi.fn().mockResolvedValue(content),
    },
  };
}

// Helper to create a mock readable stream for getDocumentFromS3
function mockReadableStream(data: Buffer) {
  return {
    Body: {
      [Symbol.asyncIterator]: async function* () {
        yield data;
      },
    },
  };
}

describe('s3Storage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // --- loadMetadata ---

  describe('loadMetadata', () => {
    it('returns null when key does not exist (NoSuchKey)', async () => {
      mockSend.mockRejectedValueOnce(Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' }));
      const result = await loadMetadata('nonexistent.json');
      expect(result).toBeNull();
    });

    it('returns null when key does not exist (NotFound)', async () => {
      mockSend.mockRejectedValueOnce(Object.assign(new Error('NotFound'), { name: 'NotFound' }));
      const result = await loadMetadata('nonexistent.json');
      expect(result).toBeNull();
    });

    it('returns null when S3 returns 404 via httpStatusCode', async () => {
      mockSend.mockRejectedValueOnce(
        Object.assign(new Error('Not Found'), { name: 'SomeError', $metadata: { httpStatusCode: 404 } })
      );
      const result = await loadMetadata('missing.json');
      expect(result).toBeNull();
    });

    it('returns parsed JSON on success', async () => {
      const data = { foo: 'bar', count: 42 };
      mockSend.mockResolvedValueOnce(mockS3Body(JSON.stringify(data)));
      const result = await loadMetadata<typeof data>('test.json');
      expect(result).toEqual(data);
    });

    it('returns null when Body.transformToString returns empty', async () => {
      mockSend.mockResolvedValueOnce({
        Body: { transformToString: vi.fn().mockResolvedValue('') },
      });
      const result = await loadMetadata('empty.json');
      expect(result).toBeNull();
    });

    it('returns null when Body is undefined', async () => {
      mockSend.mockResolvedValueOnce({ Body: undefined });
      const result = await loadMetadata('nobody.json');
      expect(result).toBeNull();
    });

    it('throws on metadata exceeding 50MB size guard', async () => {
      const oversizeBytes = 51 * 1024 * 1024;
      mockSend.mockResolvedValueOnce({
        ContentLength: oversizeBytes,
        Body: { transformToString: vi.fn().mockResolvedValue('{}') },
      });
      await expect(loadMetadata('huge.json')).rejects.toThrow('Metadata object too large');
    });

    it('re-throws unexpected S3 errors', async () => {
      mockSend.mockRejectedValueOnce(new Error('InternalServerError'));
      await expect(loadMetadata('test.json')).rejects.toThrow('InternalServerError');
    });

    it('sends GetObjectCommand with correct prefixed key', async () => {
      mockSend.mockResolvedValueOnce(mockS3Body('{"a":1}'));
      await loadMetadata('docs.json');
      const command = mockSend.mock.calls[0][0];
      expect(command.input).toEqual({
        Bucket: 'test-bucket',
        Key: 'metadata/docs.json',
      });
    });
  });

  // --- saveMetadata ---

  describe('saveMetadata', () => {
    it('saves JSON with correct params', async () => {
      mockSend.mockResolvedValueOnce({});
      const data = { items: [1, 2, 3] };
      await saveMetadata('test.json', data);

      const command = mockSend.mock.calls[0][0];
      expect(command.input).toEqual({
        Bucket: 'test-bucket',
        Key: 'metadata/test.json',
        Body: JSON.stringify(data, null, 2),
        ContentType: 'application/json',
        ServerSideEncryption: 'AES256',
      });
    });

    it('propagates S3 errors', async () => {
      mockSend.mockRejectedValueOnce(new Error('AccessDenied'));
      await expect(saveMetadata('test.json', {})).rejects.toThrow('AccessDenied');
    });
  });

  // --- deleteMetadata ---

  describe('deleteMetadata', () => {
    it('sends DeleteObjectCommand with correct prefixed key', async () => {
      mockSend.mockResolvedValueOnce({});
      await deleteMetadata('old.json');
      const command = mockSend.mock.calls[0][0];
      expect(command.input).toEqual({
        Bucket: 'test-bucket',
        Key: 'metadata/old.json',
      });
    });
  });

  // --- getDocumentsIndex / saveDocumentsIndex (delegated to db layer) ---

  describe('getDocumentsIndex', () => {
    it('returns empty array when no documents exist', async () => {
      const result = await getDocumentsIndex();
      expect(result).toEqual([]);
    });

    it('returns saved documents', async () => {
      const docs = [{ id: 'doc-1', name: 'test.pdf' }];
      (getDocumentsIndex as ReturnType<typeof vi.fn>).mockResolvedValueOnce(docs);
      const result = await getDocumentsIndex();
      expect(result).toEqual(docs);
    });
  });

  describe('saveDocumentsIndex', () => {
    it('calls through to db layer', async () => {
      const docs = [{ id: 'doc-1', name: 'test.pdf' }];
      await saveDocumentsIndex(docs as any);
      expect(saveDocumentsIndex).toHaveBeenCalledWith(docs);
    });
  });

  // --- getCollectionsIndex / saveCollectionsIndex (delegated to db layer) ---

  describe('getCollectionsIndex', () => {
    it('returns empty array when no collections exist', async () => {
      const result = await getCollectionsIndex();
      expect(result).toEqual([]);
    });

    it('returns saved collections', async () => {
      const collections = [{ id: 'col-1', name: 'Test Collection' }];
      (getCollectionsIndex as ReturnType<typeof vi.fn>).mockResolvedValueOnce(collections);
      const result = await getCollectionsIndex();
      expect(result).toEqual(collections);
    });
  });

  describe('saveCollectionsIndex', () => {
    it('calls through to db layer', async () => {
      const collections = [{ id: 'col-1', name: 'Policies' }];
      await saveCollectionsIndex(collections as any);
      expect(saveCollectionsIndex).toHaveBeenCalledWith(collections);
    });
  });

  // --- uploadDocumentToS3 ---

  describe('uploadDocumentToS3', () => {
    it('creates Upload with correct params and calls done()', async () => {
      const buffer = Buffer.from('file contents');
      await uploadDocumentToS3(buffer, 'documents/test.pdf', 'application/pdf');

      expect(Upload).toHaveBeenCalledWith({
        client: expect.anything(),
        params: {
          Bucket: 'test-bucket',
          Key: 'documents/test.pdf',
          Body: buffer,
          ContentType: 'application/pdf',
          ServerSideEncryption: 'AES256',
        },
      });
      expect(mockUploadDone).toHaveBeenCalled();
    });

    it('propagates upload errors', async () => {
      mockUploadDone.mockRejectedValueOnce(new Error('Upload failed'));
      await expect(
        uploadDocumentToS3(Buffer.from('x'), 'documents/fail.pdf', 'application/pdf')
      ).rejects.toThrow('Upload failed');
    });
  });

  // --- getDocumentFromS3 ---

  describe('getDocumentFromS3', () => {
    it('returns document buffer from S3', async () => {
      const content = Buffer.from('PDF file content');
      mockSend.mockResolvedValueOnce(mockReadableStream(content));

      const result = await getDocumentFromS3('documents/test.pdf');
      expect(Buffer.compare(result, content)).toBe(0);
    });

    it('sends GetObjectCommand with correct key', async () => {
      mockSend.mockResolvedValueOnce(mockReadableStream(Buffer.from('data')));
      await getDocumentFromS3('documents/myfile.docx');

      const command = mockSend.mock.calls[0][0];
      expect(command.input).toEqual({
        Bucket: 'test-bucket',
        Key: 'documents/myfile.docx',
      });
    });

    it('concatenates multiple stream chunks', async () => {
      const chunk1 = Buffer.from('Hello ');
      const chunk2 = Buffer.from('World');
      mockSend.mockResolvedValueOnce({
        Body: {
          [Symbol.asyncIterator]: async function* () {
            yield chunk1;
            yield chunk2;
          },
        },
      });

      const result = await getDocumentFromS3('documents/multi.txt');
      expect(result.toString()).toBe('Hello World');
    });
  });

  // --- getDocumentETag ---

  describe('getDocumentETag', () => {
    it('returns ETag without quotes', async () => {
      mockSend.mockResolvedValueOnce({ ETag: '"abc123def"' });
      const result = await getDocumentETag('documents/test.pdf');
      expect(result).toBe('abc123def');
    });

    it('returns ETag when no quotes present', async () => {
      mockSend.mockResolvedValueOnce({ ETag: 'abc123' });
      const result = await getDocumentETag('documents/test.pdf');
      expect(result).toBe('abc123');
    });

    it('returns null when ETag is undefined', async () => {
      mockSend.mockResolvedValueOnce({});
      const result = await getDocumentETag('documents/test.pdf');
      expect(result).toBeNull();
    });

    it('returns null when object does not exist (NotFound)', async () => {
      mockSend.mockRejectedValueOnce(Object.assign(new Error('NotFound'), { name: 'NotFound' }));
      const result = await getDocumentETag('documents/missing.pdf');
      expect(result).toBeNull();
    });

    it('returns null when object does not exist (NoSuchKey)', async () => {
      mockSend.mockRejectedValueOnce(Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' }));
      const result = await getDocumentETag('documents/missing.pdf');
      expect(result).toBeNull();
    });

    it('re-throws unexpected errors', async () => {
      mockSend.mockRejectedValueOnce(new Error('AccessDenied'));
      await expect(getDocumentETag('documents/test.pdf')).rejects.toThrow('AccessDenied');
    });
  });

  // --- deleteDocumentFromS3 ---

  describe('deleteDocumentFromS3', () => {
    it('sends DeleteObjectCommand with correct key', async () => {
      mockSend.mockResolvedValueOnce({});
      await deleteDocumentFromS3('documents/test.pdf');

      const command = mockSend.mock.calls[0][0];
      expect(command.input).toEqual({
        Bucket: 'test-bucket',
        Key: 'documents/test.pdf',
      });
    });

    it('does not throw when deleting non-existent key (S3 is idempotent)', async () => {
      mockSend.mockResolvedValueOnce({});
      await expect(deleteDocumentFromS3('documents/ghost.pdf')).resolves.toBeUndefined();
    });
  });

  // --- saveVectorIndex ---

  describe('saveVectorIndex', () => {
    it('saves vector index with correct params', async () => {
      mockSend.mockResolvedValueOnce({});
      const index: VectorStoreIndex = {
        version: 1,
        lastUpdated: '2026-01-01T00:00:00Z',
        chunks: [],
        embeddingModel: 'amazon.titan-embed-text-v2:0',
        embeddingDimensions: 1024,
      };
      await saveVectorIndex(index);

      const command = mockSend.mock.calls[0][0];
      expect(command.input).toEqual({
        Bucket: 'test-bucket',
        Key: 'vectors/index.json',
        Body: JSON.stringify(index),
        ContentType: 'application/json',
        ServerSideEncryption: 'AES256',
      });
    });

    it('logs chunk count on save', async () => {
      mockSend.mockResolvedValueOnce({});
      const { logger } = await import('../utils/logger');
      const index: VectorStoreIndex = {
        version: 1,
        lastUpdated: '2026-01-01T00:00:00Z',
        chunks: [{ id: 'c1' } as any, { id: 'c2' } as any],
      };
      await saveVectorIndex(index);
      expect(logger.info).toHaveBeenCalledWith('Vector index saved to S3', { chunkCount: 2 });
    });
  });

  // --- loadVectorIndex ---

  describe('loadVectorIndex', () => {
    it('returns null when index does not exist (NoSuchKey)', async () => {
      mockSend.mockRejectedValueOnce(Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' }));
      const result = await loadVectorIndex();
      expect(result).toBeNull();
    });

    it('returns null when index does not exist (NotFound)', async () => {
      mockSend.mockRejectedValueOnce(Object.assign(new Error('NotFound'), { name: 'NotFound' }));
      const result = await loadVectorIndex();
      expect(result).toBeNull();
    });

    it('returns null when S3 returns 404 via httpStatusCode', async () => {
      mockSend.mockRejectedValueOnce(
        Object.assign(new Error('Not Found'), { name: 'SomeErr', $metadata: { httpStatusCode: 404 } })
      );
      const result = await loadVectorIndex();
      expect(result).toBeNull();
    });

    it('returns parsed vector index on success', async () => {
      const index: VectorStoreIndex = {
        version: 1,
        lastUpdated: '2026-01-01T00:00:00Z',
        chunks: [],
      };
      mockSend.mockResolvedValueOnce(mockS3Body(JSON.stringify(index)));
      const result = await loadVectorIndex();
      expect(result).toEqual(index);
    });

    it('returns null when body is empty', async () => {
      mockSend.mockResolvedValueOnce({
        Body: { transformToString: vi.fn().mockResolvedValue('') },
      });
      const result = await loadVectorIndex();
      expect(result).toBeNull();
    });

    it('throws on vector index exceeding 500MB size guard', async () => {
      const oversizeBytes = 501 * 1024 * 1024;
      mockSend.mockResolvedValueOnce({
        ContentLength: oversizeBytes,
        Body: { transformToString: vi.fn().mockResolvedValue('{}') },
      });
      await expect(loadVectorIndex()).rejects.toThrow('Vector index too large');
    });

    it('includes migration hint in size guard error message', async () => {
      const oversizeBytes = 501 * 1024 * 1024;
      mockSend.mockResolvedValueOnce({
        ContentLength: oversizeBytes,
        Body: { transformToString: vi.fn().mockResolvedValue('{}') },
      });
      await expect(loadVectorIndex()).rejects.toThrow('Consider migrating to pgvector');
    });

    it('re-throws unexpected S3 errors', async () => {
      mockSend.mockRejectedValueOnce(new Error('ServiceUnavailable'));
      await expect(loadVectorIndex()).rejects.toThrow('ServiceUnavailable');
    });

    it('sends GetObjectCommand with correct vector index key', async () => {
      mockSend.mockResolvedValueOnce(mockS3Body('{"version":1,"lastUpdated":"now","chunks":[]}'));
      await loadVectorIndex();
      const command = mockSend.mock.calls[0][0];
      expect(command.input).toEqual({
        Bucket: 'test-bucket',
        Key: 'vectors/index.json',
      });
    });
  });
});
