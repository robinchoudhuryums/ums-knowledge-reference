import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import { parse as csvParse } from 'csv-parse/sync';
import { logger } from '../utils/logger';

export interface ExtractedText {
  text: string;
  pageBreaks?: number[]; // character offsets where page breaks occur
}

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

async function extractPdf(buffer: Buffer): Promise<ExtractedText> {
  const result = await pdfParse(buffer);

  // pdf-parse separates pages with \n\n, we can approximate page breaks
  const pages = result.text.split(/\f/); // form feed character
  const pageBreaks: number[] = [];
  let offset = 0;
  for (let i = 0; i < pages.length - 1; i++) {
    offset += pages[i].length;
    pageBreaks.push(offset);
    offset += 1; // for the form feed char
  }

  return {
    text: result.text,
    pageBreaks,
  };
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
