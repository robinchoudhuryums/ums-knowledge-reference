import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockTextractSend, mockS3Send } = vi.hoisted(() => {
  return {
    mockTextractSend: vi.fn(),
    mockS3Send: vi.fn().mockResolvedValue({}),
  };
});

// Mock @aws-sdk/client-s3
vi.mock('@aws-sdk/client-s3', () => {
  function S3Client() { return { send: vi.fn() }; }
  return {
    S3Client,
    PutObjectCommand: vi.fn(),
    DeleteObjectCommand: vi.fn(),
    GetBucketEncryptionCommand: vi.fn(),
    GetPublicAccessBlockCommand: vi.fn(),
    GetBucketVersioningCommand: vi.fn(),
  };
});

// Mock @aws-sdk/client-textract
vi.mock('@aws-sdk/client-textract', () => {
  function TextractClient() { return { send: mockTextractSend }; }
  function DetectDocumentTextCommand(input: unknown) { return { _type: 'DetectDocumentText', input }; }
  function StartDocumentTextDetectionCommand(input: unknown) { return { _type: 'StartDocumentTextDetection', input }; }
  function GetDocumentTextDetectionCommand(input: unknown) { return { _type: 'GetDocumentTextDetection', input }; }
  function AnalyzeDocumentCommand(input: unknown) { return { _type: 'AnalyzeDocument', input }; }
  return {
    TextractClient,
    DetectDocumentTextCommand,
    StartDocumentTextDetectionCommand,
    GetDocumentTextDetectionCommand,
    AnalyzeDocumentCommand,
  };
});

// Mock the aws config module
vi.mock('../config/aws', () => ({
  s3Client: { send: mockS3Send },
  S3_BUCKET: 'test-bucket',
  bedrockClient: {},
  S3_PREFIXES: { documents: 'documents/', vectors: 'vectors/', metadata: 'metadata/', audit: 'audit/' },
  BEDROCK_EMBEDDING_MODEL: 'amazon.titan-embed-text-v2:0',
  BEDROCK_GENERATION_MODEL: 'test-model',
  BEDROCK_EXTRACTION_MODEL: 'test-extraction-model',
}));

// Mock logger
vi.mock('../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock uuid
vi.mock('uuid', () => ({
  v4: () => 'test-uuid-1234',
}));

import { extractTextWithOcr } from '../services/ocr';

describe('OCR Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  describe('extractTextWithOcr routing', () => {
    it('should route PDFs to async OCR (StartDocumentTextDetection)', async () => {
      const buffer = Buffer.from('fake-pdf-content');

      // Mock S3 upload and cleanup
      mockS3Send.mockResolvedValue({});

      // Set up textract mock responses in sequence:
      // 1. StartDocumentTextDetection -> returns JobId
      // 2. GetDocumentTextDetection (poll) -> SUCCEEDED with blocks
      // 3. GetDocumentTextDetection (re-fetch for NextToken check) -> no NextToken
      mockTextractSend
        .mockResolvedValueOnce({ JobId: 'job-123' })
        .mockResolvedValueOnce({
          JobStatus: 'SUCCEEDED',
          Blocks: [
            { BlockType: 'LINE', Text: 'Hello from PDF', Confidence: 95.5, Page: 1 },
          ],
        })
        .mockResolvedValueOnce({
          // Re-fetch for pagination: no NextToken means no more pages
          Blocks: [
            { BlockType: 'LINE', Text: 'Hello from PDF', Confidence: 95.5, Page: 1 },
          ],
        });

      vi.useFakeTimers();
      const promise = extractTextWithOcr(buffer, 'document.pdf');
      // Advance past the poll sleep (2000ms)
      await vi.advanceTimersByTimeAsync(3000);
      const result = await promise;

      // Verify StartDocumentTextDetection was called first
      expect(mockTextractSend.mock.calls[0][0]._type).toBe('StartDocumentTextDetection');

      expect(result.text).toBe('Hello from PDF');
      expect(result.confidence).toBeCloseTo(95.5, 1);
      expect(result.pageCount).toBe(1);
    });

    it('should route images to sync OCR (DetectDocumentText)', async () => {
      const buffer = Buffer.from('fake-image-content');

      mockTextractSend.mockResolvedValueOnce({
        Blocks: [
          { BlockType: 'LINE', Text: 'Line one', Confidence: 98.0, Page: 1 },
          { BlockType: 'LINE', Text: 'Line two', Confidence: 92.0, Page: 1 },
          { BlockType: 'WORD', Text: 'ignored', Confidence: 99.0, Page: 1 },
        ],
      });

      const result = await extractTextWithOcr(buffer, 'scan.png');

      // Verify DetectDocumentText was called
      expect(mockTextractSend).toHaveBeenCalledTimes(1);
      expect(mockTextractSend.mock.calls[0][0]._type).toBe('DetectDocumentText');

      // S3 should NOT have been called (no upload needed for sync OCR)
      expect(mockS3Send).not.toHaveBeenCalled();

      expect(result.text).toBe('Line one\nLine two');
    });
  });

  describe('parseTextractBlocks (tested indirectly)', () => {
    it('should extract only LINE blocks and compute average confidence', async () => {
      const buffer = Buffer.from('fake-image');

      mockTextractSend.mockResolvedValueOnce({
        Blocks: [
          { BlockType: 'PAGE', Text: '', Confidence: 100, Page: 1 },
          { BlockType: 'LINE', Text: 'First line', Confidence: 90.0, Page: 1 },
          { BlockType: 'WORD', Text: 'First', Confidence: 95.0, Page: 1 },
          { BlockType: 'LINE', Text: 'Second line', Confidence: 80.0, Page: 1 },
          { BlockType: 'WORD', Text: 'Second', Confidence: 85.0, Page: 1 },
        ],
      });

      const result = await extractTextWithOcr(buffer, 'test.jpg');

      // Only LINE blocks should be in the text
      expect(result.text).toBe('First line\nSecond line');

      // Average confidence should be (90 + 80) / 2 = 85
      expect(result.confidence).toBeCloseTo(85.0, 1);
    });

    it('should count unique pages', async () => {
      const buffer = Buffer.from('fake-image');

      mockTextractSend.mockResolvedValueOnce({
        Blocks: [
          { BlockType: 'LINE', Text: 'Page 1 line 1', Confidence: 90.0, Page: 1 },
          { BlockType: 'LINE', Text: 'Page 1 line 2', Confidence: 85.0, Page: 1 },
          { BlockType: 'LINE', Text: 'Page 2 line 1', Confidence: 92.0, Page: 2 },
          { BlockType: 'LINE', Text: 'Page 3 line 1', Confidence: 88.0, Page: 3 },
        ],
      });

      const result = await extractTextWithOcr(buffer, 'multipage.tiff');

      expect(result.pageCount).toBe(3);
      expect(result.text).toContain('Page 1 line 1');
      expect(result.text).toContain('Page 3 line 1');
    });
  });

  describe('Async OCR failure handling', () => {
    it('should throw an error when Textract job fails', async () => {
      const buffer = Buffer.from('fake-pdf');

      // S3 upload and cleanup succeed
      mockS3Send.mockResolvedValue({});

      // Start returns a JobId, first poll returns FAILED
      mockTextractSend
        .mockResolvedValueOnce({ JobId: 'fail-job-456' })
        .mockResolvedValueOnce({
          JobStatus: 'FAILED',
          StatusMessage: 'Invalid document format',
        });

      await expect(extractTextWithOcr(buffer, 'bad.pdf'))
        .rejects.toThrow('Textract OCR job failed: Invalid document format');
    });

    it('should throw when StartDocumentTextDetection returns no JobId', async () => {
      const buffer = Buffer.from('fake-pdf');

      mockS3Send.mockResolvedValue({});
      mockTextractSend.mockResolvedValueOnce({}); // No JobId

      await expect(extractTextWithOcr(buffer, 'nojob.pdf'))
        .rejects.toThrow('Textract did not return a JobId');
    });
  });
});
