import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import { parse as csvParse } from 'csv-parse/sync';
import { logger } from '../utils/logger';
import { extractTextWithOcr } from './ocr';
import { ExtractedText } from '../types';

// Re-export for backward compatibility
export type { ExtractedText };

export async function extractText(buffer: Buffer, mimeType: string, filename: string): Promise<ExtractedText> {
  logger.info('Extracting text', { mimeType, filename });

  switch (mimeType) {
    case 'application/pdf':
      return extractPdf(buffer);

    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    case 'application/msword':
      return extractDocx(buffer);

    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
    case 'application/vnd.ms-excel':
      return extractXlsx(buffer);

    case 'text/csv':
      return extractCsv(buffer);

    case 'text/plain':
      return { text: buffer.toString('utf-8') };

    default:
      // Try plain text as fallback
      if (filename.endsWith('.txt') || filename.endsWith('.md')) {
        return { text: buffer.toString('utf-8') };
      }
      if (filename.endsWith('.csv')) {
        return extractCsv(buffer);
      }
      throw new Error(`Unsupported file type: ${mimeType} (${filename})`);
  }
}

// Minimum characters from pdf-parse before we consider it a real text PDF.
// Below this threshold the PDF is likely scanned/image-based and we try OCR.
const OCR_FALLBACK_THRESHOLD = 50;

async function extractPdf(buffer: Buffer): Promise<ExtractedText> {
  // Run both pdf-parse (text layer) and Textract OCR (captures text in images) in parallel.
  // This ensures we don't miss text embedded in images, diagrams, or charts.
  const [pdfResult, ocrResult] = await Promise.allSettled([
    pdfParse(buffer),
    extractTextWithOcr(buffer, 'document.pdf'),
  ]);

  const pdfText = pdfResult.status === 'fulfilled' ? pdfResult.value.text : '';
  const ocrText = ocrResult.status === 'fulfilled' ? ocrResult.value.text : '';

  const trimmedPdf = pdfText.replace(/\s+/g, ' ').trim();
  const trimmedOcr = ocrText.replace(/\s+/g, ' ').trim();

  // If pdf-parse got almost nothing, use OCR
  if (trimmedPdf.length < OCR_FALLBACK_THRESHOLD && trimmedOcr.length > trimmedPdf.length) {
    logger.info('PDF has minimal text layer, using OCR result', {
      pdfParseChars: trimmedPdf.length,
      ocrChars: trimmedOcr.length,
    });
    return { text: ocrText };
  }

  // If OCR captured significantly more text (>20% more), it likely found text in images
  if (trimmedOcr.length > trimmedPdf.length * 1.2) {
    logger.info('OCR captured more text than pdf-parse (likely text in images), using OCR result', {
      pdfParseChars: trimmedPdf.length,
      ocrChars: trimmedOcr.length,
    });
    return { text: ocrText };
  }

  // pdf-parse has good text with page breaks — prefer it for better formatting
  if (pdfResult.status === 'fulfilled') {
    const pages = pdfResult.value.text.split(/\f/);
    const pageBreaks: number[] = [];
    let offset = 0;
    for (let i = 0; i < pages.length - 1; i++) {
      offset += pages[i].length;
      pageBreaks.push(offset);
      offset += 1;
    }
    return { text: pdfResult.value.text, pageBreaks };
  }

  // Both failed — nothing we can do
  if (!trimmedOcr && !trimmedPdf) {
    throw new Error('Failed to extract text from PDF via both pdf-parse and OCR');
  }

  return { text: ocrText || pdfText };
}

async function extractDocx(buffer: Buffer): Promise<ExtractedText> {
  const result = await mammoth.extractRawText({ buffer });
  return { text: result.value };
}

function extractXlsx(buffer: Buffer): ExtractedText {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const textParts: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    textParts.push(`--- Sheet: ${sheetName} ---`);

    const jsonData = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { header: 1 });
    for (const row of jsonData) {
      const values = Object.values(row).map(v => String(v ?? '')).join('\t');
      if (values.trim()) {
        textParts.push(values);
      }
    }

    textParts.push('');
  }

  return { text: textParts.join('\n') };
}

function extractCsv(buffer: Buffer): ExtractedText {
  const records = csvParse(buffer.toString('utf-8'), {
    skip_empty_lines: true,
    relax_column_count: true,
  }) as string[][];

  const lines = records.map(row => row.join('\t'));
  return { text: lines.join('\n') };
}
