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
      return extractPdf(buffer, filename);

    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    case 'application/msword':
      return extractDocx(buffer);

    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
    case 'application/vnd.ms-excel':
      return extractXlsx(buffer);

    case 'text/csv':
      return extractCsv(buffer);

    case 'text/html':
      return extractHtml(buffer);

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
// Below this threshold the PDF is likely scanned/image-based and we fall back to OCR.
const OCR_FALLBACK_THRESHOLD = 50;

// Minimum WORD count (not character count) from pdf-parse to skip OCR.
// Using word count avoids false positives from whitespace inflation (page breaks, \f,
// excessive newlines) that inflate character counts without representing real content.
// 100 words ≈ a paragraph of real text; below that, the PDF likely has minimal text.
const OCR_SKIP_WORD_COUNT = 100;

async function extractPdf(buffer: Buffer, filename: string = 'document.pdf'): Promise<ExtractedText> {
  // Phase 1: Try pdf-parse first (fast, free, no API call)
  let pdfText = '';
  let pdfParsed: Awaited<ReturnType<typeof pdfParse>> | null = null;
  try {
    pdfParsed = await pdfParse(buffer);
    pdfText = pdfParsed!.text;
  } catch (err) {
    logger.warn('pdf-parse failed, will try OCR', { error: String(err) });
  }

  const trimmedPdf = pdfText.replace(/\s+/g, ' ').trim();
  // Use word count for the skip decision to avoid whitespace inflation (page breaks, \f).
  // A PDF with 500 chars but only 10 real words shouldn't skip OCR.
  const pdfWordCount = trimmedPdf.split(/\s+/).filter(w => w.length > 0).length;

  // Phase 2: Only call OCR if pdf-parse yielded insufficient text.
  // For text-native PDFs with a strong text layer, this avoids unnecessary Textract calls.
  let ocrText = '';
  let ocrConfidence: number | undefined;
  if (pdfWordCount < OCR_SKIP_WORD_COUNT) {
    logger.info('PDF text layer below word threshold, running OCR', {
      pdfParseChars: trimmedPdf.length,
      pdfWordCount,
      threshold: OCR_SKIP_WORD_COUNT,
    });

    try {
      const ocrResult = await extractTextWithOcr(buffer, filename);
      ocrText = ocrResult.text;
      ocrConfidence = ocrResult.confidence;

      // Warn on low-confidence OCR results — indicates poor scan quality
      if (ocrConfidence > 0 && ocrConfidence < 70) {
        logger.warn('Low OCR confidence — document may be poorly scanned', {
          filename, confidence: Math.round(ocrConfidence), pageCount: ocrResult.pageCount,
        });
      }
    } catch (err) {
      logger.warn('OCR extraction failed', { error: String(err) });
    }
  } else {
    logger.info('PDF has strong text layer, skipping OCR', { pdfParseChars: trimmedPdf.length, pdfWordCount });
  }

  const trimmedOcr = ocrText.replace(/\s+/g, ' ').trim();

  // If pdf-parse got almost nothing, use OCR
  if (trimmedPdf.length < OCR_FALLBACK_THRESHOLD && trimmedOcr.length > trimmedPdf.length) {
    logger.info('PDF has minimal text layer, using OCR result', {
      pdfParseChars: trimmedPdf.length,
      ocrChars: trimmedOcr.length,
    });
    return { text: ocrText, ocrConfidence };
  }

  // If OCR captured significantly more text (>20% more), it likely found text in images.
  // Merge both: pdf-parse text (better formatting/page breaks) + OCR-only text (images).
  if (trimmedOcr.length > trimmedPdf.length * 1.2) {
    logger.info('OCR captured more text than pdf-parse, merging results', {
      pdfParseChars: trimmedPdf.length,
      ocrChars: trimmedOcr.length,
    });
    // If pdf-parse had meaningful text, append OCR supplement at the end
    if (pdfParsed && trimmedPdf.length >= OCR_FALLBACK_THRESHOLD) {
      const mergedText = pdfParsed.text + '\n\n--- Additional Text from Images (OCR) ---\n' + ocrText;
      return { text: mergedText, ocrConfidence };
    }
    return { text: ocrText, ocrConfidence };
  }

  // pdf-parse has good text with page breaks — prefer it for better formatting
  if (pdfParsed) {
    const pages = pdfParsed.text.split(/\f/);
    const pageBreaks: number[] = [];
    let offset = 0;
    for (let i = 0; i < pages.length - 1; i++) {
      offset += pages[i].length;
      pageBreaks.push(offset);
      offset += 1;
    }
    return { text: pdfParsed.text, pageBreaks };
  }

  // Both failed — nothing we can do
  if (!trimmedOcr && !trimmedPdf) {
    throw new Error('Failed to extract text from PDF via both pdf-parse and OCR');
  }

  return { text: ocrText || pdfText, ocrConfidence };
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

/**
 * Extract text from HTML by stripping tags, scripts, styles, and normalizing whitespace.
 * Preserves semantic structure (headings, paragraphs, list items) as line breaks.
 */
function extractHtml(buffer: Buffer): ExtractedText {
  let html = buffer.toString('utf-8');

  // Remove script and style blocks entirely
  html = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  html = html.replace(/<style[\s\S]*?<\/style>/gi, '');
  html = html.replace(/<noscript[\s\S]*?<\/noscript>/gi, '');

  // Remove HTML comments
  html = html.replace(/<!--[\s\S]*?-->/g, '');

  // Convert block-level elements to newlines for readability
  html = html.replace(/<\/(p|div|h[1-6]|li|tr|br|hr|blockquote|section|article|header|footer|nav|main)>/gi, '\n');
  html = html.replace(/<br\s*\/?>/gi, '\n');
  html = html.replace(/<hr\s*\/?>/gi, '\n---\n');

  // Strip all remaining HTML tags
  html = html.replace(/<[^>]+>/g, ' ');

  // Decode common HTML entities
  html = html
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#\d+;/g, ' ')
    .replace(/&\w+;/g, ' ');

  // Normalize whitespace: collapse multiple spaces/tabs, trim lines, collapse blank lines
  const lines = html.split('\n')
    .map(line => line.replace(/[ \t]+/g, ' ').trim())
    .filter(line => line.length > 0);

  // Collapse runs of 3+ empty lines into 2
  const text = lines.join('\n').replace(/\n{3,}/g, '\n\n');

  return { text };
}

function extractCsv(buffer: Buffer): ExtractedText {
  const records = csvParse(buffer.toString('utf-8'), {
    skip_empty_lines: true,
    relax_column_count: true,
  }) as string[][];

  const lines = records.map(row => row.join('\t'));
  return { text: lines.join('\n') };
}
