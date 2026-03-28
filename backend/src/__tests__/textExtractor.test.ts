/**
 * Tests for the text extraction pipeline.
 *
 * Tests cover: MIME type routing, HTML cleaning, CSV parsing, plain text,
 * unsupported types, and PDF extraction logic (pdf-parse + OCR fallback).
 * External dependencies (pdf-parse, mammoth, xlsx, OCR) are mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock OCR service
const mockExtractTextWithOcr = vi.fn();
vi.mock('../services/ocr', () => ({
  extractTextWithOcr: (...args: unknown[]) => mockExtractTextWithOcr(...args),
}));

// Mock pdf-parse
const mockPdfParse = vi.fn();
vi.mock('pdf-parse', () => ({
  default: (...args: unknown[]) => mockPdfParse(...args),
}));

// Mock mammoth
const mockMammoth = vi.fn();
vi.mock('mammoth', () => ({
  default: { extractRawText: (...args: unknown[]) => mockMammoth(...args) },
}));

// Mock xlsx
vi.mock('xlsx', () => ({
  read: vi.fn(() => ({
    SheetNames: ['Sheet1'],
    Sheets: { Sheet1: {} },
  })),
  utils: {
    sheet_to_json: vi.fn(() => [
      { '0': 'Name', '1': 'Value' },
      { '0': 'Item A', '1': '100' },
    ]),
  },
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

import { extractText } from '../services/textExtractor';
import { logger } from '../utils/logger';

describe('Text Extractor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // MIME Type Routing
  // -------------------------------------------------------------------------

  describe('MIME type routing', () => {
    it('should extract plain text directly', async () => {
      const buffer = Buffer.from('Hello, world!');
      const result = await extractText(buffer, 'text/plain', 'readme.txt');
      expect(result.text).toBe('Hello, world!');
    });

    it('should treat .txt files as plain text even with unknown MIME type', async () => {
      const buffer = Buffer.from('Fallback text content');
      const result = await extractText(buffer, 'application/octet-stream', 'notes.txt');
      expect(result.text).toBe('Fallback text content');
    });

    it('should treat .md files as plain text', async () => {
      const buffer = Buffer.from('# Heading\nSome markdown');
      const result = await extractText(buffer, 'application/octet-stream', 'README.md');
      expect(result.text).toBe('# Heading\nSome markdown');
    });

    it('should route CSV by MIME type', async () => {
      const buffer = Buffer.from('name,value\nItem A,100\n');
      const result = await extractText(buffer, 'text/csv', 'data.csv');
      expect(result.text).toContain('name');
      expect(result.text).toContain('Item A');
    });

    it('should route .csv files with unknown MIME type', async () => {
      const buffer = Buffer.from('col1,col2\na,b\n');
      const result = await extractText(buffer, 'application/octet-stream', 'data.csv');
      expect(result.text).toContain('col1');
    });

    it('should throw on unsupported file type', async () => {
      const buffer = Buffer.from('binary data');
      await expect(extractText(buffer, 'application/octet-stream', 'file.xyz'))
        .rejects.toThrow('Unsupported file type');
    });

    it('should route DOCX to mammoth', async () => {
      mockMammoth.mockResolvedValue({ value: 'Extracted DOCX text' });
      const buffer = Buffer.from('fake-docx');
      const result = await extractText(buffer, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'doc.docx');
      expect(result.text).toBe('Extracted DOCX text');
      expect(mockMammoth).toHaveBeenCalledTimes(1);
    });

    it('should route XLSX to xlsx parser', async () => {
      const buffer = Buffer.from('fake-xlsx');
      const result = await extractText(buffer, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'data.xlsx');
      expect(result.text).toContain('Sheet1');
    });
  });

  // -------------------------------------------------------------------------
  // HTML Extraction
  // -------------------------------------------------------------------------

  describe('HTML extraction', () => {
    it('should strip script and style blocks', async () => {
      const html = '<html><head><style>body{color:red}</style></head><body><script>alert(1)</script><p>Hello</p></body></html>';
      const result = await extractText(Buffer.from(html), 'text/html', 'page.html');
      expect(result.text).not.toContain('alert');
      expect(result.text).not.toContain('color:red');
      expect(result.text).toContain('Hello');
    });

    it('should strip noscript blocks', async () => {
      const html = '<p>Content</p><noscript>Enable JS</noscript>';
      const result = await extractText(Buffer.from(html), 'text/html', 'page.html');
      expect(result.text).not.toContain('Enable JS');
      expect(result.text).toContain('Content');
    });

    it('should strip HTML comments', async () => {
      const html = '<p>Visible</p><!-- hidden comment -->';
      const result = await extractText(Buffer.from(html), 'text/html', 'page.html');
      expect(result.text).not.toContain('hidden comment');
      expect(result.text).toContain('Visible');
    });

    it('should convert block elements to newlines', async () => {
      const html = '<h1>Title</h1><p>Paragraph one</p><p>Paragraph two</p>';
      const result = await extractText(Buffer.from(html), 'text/html', 'page.html');
      expect(result.text).toContain('Title');
      expect(result.text).toContain('Paragraph one');
      expect(result.text).toContain('Paragraph two');
    });

    it('should decode HTML entities', async () => {
      const html = '<p>5 &lt; 10 &amp; 20 &gt; 15</p>';
      const result = await extractText(Buffer.from(html), 'text/html', 'page.html');
      expect(result.text).toContain('5 < 10 & 20 > 15');
    });

    it('should handle &nbsp; and &#39;', async () => {
      const html = '<p>It&#39;s&nbsp;great</p>';
      const result = await extractText(Buffer.from(html), 'text/html', 'page.html');
      expect(result.text).toContain("It's");
      expect(result.text).toContain('great');
    });

    it('should collapse excessive blank lines', async () => {
      const html = '<p>Line1</p><br><br><br><br><br><p>Line2</p>';
      const result = await extractText(Buffer.from(html), 'text/html', 'page.html');
      // Should not have 3+ consecutive newlines
      expect(result.text).not.toMatch(/\n{3,}/);
    });
  });

  // -------------------------------------------------------------------------
  // CSV Extraction
  // -------------------------------------------------------------------------

  describe('CSV extraction', () => {
    it('should parse CSV into tab-delimited lines', async () => {
      const csv = 'name,age,city\nAlice,30,NYC\nBob,25,LA\n';
      const result = await extractText(Buffer.from(csv), 'text/csv', 'people.csv');
      expect(result.text).toContain('name\tage\tcity');
      expect(result.text).toContain('Alice\t30\tNYC');
      expect(result.text).toContain('Bob\t25\tLA');
    });

    it('should skip empty lines', async () => {
      const csv = 'a,b\n\n\nc,d\n';
      const result = await extractText(Buffer.from(csv), 'text/csv', 'data.csv');
      const lines = result.text.split('\n');
      expect(lines).toHaveLength(2);
    });

    it('should handle ragged rows (relax_column_count)', async () => {
      const csv = 'a,b,c\n1,2\n4,5,6,7\n';
      const result = await extractText(Buffer.from(csv), 'text/csv', 'ragged.csv');
      expect(result.text).toContain('a\tb\tc');
      expect(result.text).toContain('1\t2');
    });
  });

  // -------------------------------------------------------------------------
  // PDF Extraction Logic
  // -------------------------------------------------------------------------

  describe('PDF extraction', () => {
    it('should use pdf-parse result when text layer is strong (>100 words)', async () => {
      const longText = Array(120).fill('word').join(' ');
      mockPdfParse.mockResolvedValue({ text: longText });

      const result = await extractText(Buffer.from('fake-pdf'), 'application/pdf', 'doc.pdf');
      expect(result.text).toBe(longText);
      // OCR should NOT be called
      expect(mockExtractTextWithOcr).not.toHaveBeenCalled();
    });

    it('should fall back to OCR when pdf-parse yields minimal text', async () => {
      mockPdfParse.mockResolvedValue({ text: 'tiny' });
      mockExtractTextWithOcr.mockResolvedValue({
        text: 'Full OCR text from scanned document with enough content to be useful for analysis.',
        pageCount: 1,
        confidence: 95,
      });

      const result = await extractText(Buffer.from('fake-pdf'), 'application/pdf', 'scanned.pdf');
      expect(result.text).toContain('Full OCR text');
      expect(result.ocrConfidence).toBe(95);
    });

    it('should merge pdf-parse + OCR when OCR finds 20%+ more text', async () => {
      // pdf-parse has 60 chars (above fallback threshold) but only 10 words (below skip threshold)
      const pdfText = 'This is the text layer of the PDF document with some words.';
      const ocrText = pdfText + ' Plus additional text found in embedded images and diagrams that OCR detected.';
      mockPdfParse.mockResolvedValue({ text: pdfText });
      mockExtractTextWithOcr.mockResolvedValue({
        text: ocrText,
        pageCount: 1,
        confidence: 90,
      });

      const result = await extractText(Buffer.from('fake-pdf'), 'application/pdf', 'mixed.pdf');
      // Should contain the pdf-parse text AND the OCR supplement marker
      expect(result.text).toContain(pdfText);
      expect(result.text).toContain('--- Additional Text from Images (OCR) ---');
      expect(result.ocrConfidence).toBe(90);
    });

    it('should log warning on low OCR confidence', async () => {
      mockPdfParse.mockResolvedValue({ text: '' });
      mockExtractTextWithOcr.mockResolvedValue({
        text: 'Blurry scanned text that is hard to read.',
        pageCount: 1,
        confidence: 45,
      });

      await extractText(Buffer.from('fake-pdf'), 'application/pdf', 'blurry.pdf');

      expect(logger.warn).toHaveBeenCalledWith(
        'Low OCR confidence — document may be poorly scanned',
        expect.objectContaining({ confidence: 45 }),
      );
    });

    it('should handle pdf-parse failure gracefully', async () => {
      mockPdfParse.mockRejectedValue(new Error('PDF parsing failed'));
      mockExtractTextWithOcr.mockResolvedValue({
        text: 'OCR fallback text content.',
        pageCount: 1,
        confidence: 88,
      });

      const result = await extractText(Buffer.from('fake-pdf'), 'application/pdf', 'corrupt.pdf');
      expect(result.text).toContain('OCR fallback');
      expect(logger.warn).toHaveBeenCalledWith('pdf-parse failed, will try OCR', expect.anything());
    });

    it('should throw when both pdf-parse and OCR fail', async () => {
      mockPdfParse.mockRejectedValue(new Error('Parse failed'));
      mockExtractTextWithOcr.mockRejectedValue(new Error('OCR failed'));

      await expect(extractText(Buffer.from('fake-pdf'), 'application/pdf', 'bad.pdf'))
        .rejects.toThrow('Failed to extract text from PDF');
    });

    it('should pass actual filename to OCR (not hardcoded)', async () => {
      mockPdfParse.mockResolvedValue({ text: '' });
      mockExtractTextWithOcr.mockResolvedValue({
        text: 'Some text',
        pageCount: 1,
        confidence: 90,
      });

      await extractText(Buffer.from('fake-pdf'), 'application/pdf', 'my-report.pdf');
      expect(mockExtractTextWithOcr).toHaveBeenCalledWith(expect.anything(), 'my-report.pdf');
    });

    it('should compute page breaks from pdf-parse when text layer is strong', async () => {
      const page1 = 'Page one content with enough words to exceed the threshold easily and skip OCR checks';
      const page2 = 'Page two content continues here with more words to ensure we are well above a hundred total';
      const fullText = page1 + '\f' + page2;
      mockPdfParse.mockResolvedValue({ text: fullText });

      const result = await extractText(Buffer.from('fake-pdf'), 'application/pdf', 'multi.pdf');
      expect(result.pageBreaks).toBeDefined();
      expect(result.pageBreaks).toHaveLength(1);
      expect(result.pageBreaks![0]).toBe(page1.length);
    });
  });
});
