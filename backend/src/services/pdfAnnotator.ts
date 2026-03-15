/**
 * PDF Annotator — marks up a PDF with highlights around missing form fields
 * and adds a watermark indicating it's an example copy.
 *
 * Uses pdf-lib for PDF manipulation. Textract bounding boxes are normalized
 * (0-1 range relative to page dimensions), so we convert them to PDF coordinates.
 *
 * Important coordinate note: Textract origin is top-left (Y increases downward),
 * while PDF origin is bottom-left (Y increases upward). We flip Y accordingly.
 *
 * Confidence-based coloring:
 *  - Red: missing/blank field (high confidence detection)
 *  - Yellow/amber: low-confidence field (Textract uncertain — verify manually)
 *  - Orange outline: required field that is missing
 */

import { PDFDocument, rgb, StandardFonts, degrees } from 'pdf-lib';
import { FormField } from './formAnalyzer';
import { logger } from '../utils/logger';

const WATERMARK_TEXT = 'EXAMPLE COPY - NOT FOR INSURANCE SUBMISSION';

// Colors for different field states
const COLORS = {
  missingFill: rgb(1, 0.85, 0.85),       // Light red fill
  missingBorder: rgb(1, 0, 0),            // Red border
  missingLabel: rgb(0.8, 0, 0),           // Dark red for labels
  lowConfFill: rgb(1, 0.97, 0.82),        // Light amber fill
  lowConfBorder: rgb(0.85, 0.65, 0),      // Amber border
  lowConfLabel: rgb(0.6, 0.45, 0),        // Dark amber for labels
  requiredBorder: rgb(0.9, 0.3, 0),       // Orange border for required
  white: rgb(1, 1, 1),
  watermark: rgb(0.85, 0.15, 0.15),
  bannerBg: rgb(1, 0.92, 0.92),
  bannerBorder: rgb(0.9, 0.2, 0.2),
  bannerBold: rgb(0.8, 0, 0),
  bannerText: rgb(0.5, 0.1, 0.1),
};

const LABEL_FONT_SIZE = 7;
const HIGHLIGHT_BORDER_WIDTH = 1.5;
const REQUIRED_BORDER_WIDTH = 2.5;

/**
 * Create an annotated copy of a PDF with red highlights around blank fields,
 * amber highlights for low-confidence fields, and a diagonal watermark on every page.
 */
export async function createAnnotatedPdf(
  originalPdfBuffer: Buffer,
  emptyFields: FormField[],
  lowConfidenceFields?: FormField[],
): Promise<Buffer> {
  const pdfDoc = await PDFDocument.load(originalPdfBuffer);
  const pages = pdfDoc.getPages();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // Group empty fields by page
  const emptyByPage = new Map<number, FormField[]>();
  for (const field of emptyFields) {
    const pageFields = emptyByPage.get(field.page) || [];
    pageFields.push(field);
    emptyByPage.set(field.page, pageFields);
  }

  // Group low-confidence fields by page (only non-empty ones that aren't already in emptyFields)
  const lowConfByPage = new Map<number, FormField[]>();
  if (lowConfidenceFields) {
    const emptyKeys = new Set(emptyFields.map(f => `${f.page}:${f.key}`));
    for (const field of lowConfidenceFields) {
      const fieldKey = `${field.page}:${field.key}`;
      if (emptyKeys.has(fieldKey)) continue; // Already highlighted as missing
      const pageFields = lowConfByPage.get(field.page) || [];
      pageFields.push(field);
      lowConfByPage.set(field.page, pageFields);
    }
  }

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const page = pages[pageIndex];
    const { width, height } = page.getSize();
    const pageNum = pageIndex + 1;

    // Add watermark to every page
    drawWatermark(page, width, height, boldFont);

    // Draw highlights for missing fields (red)
    const pageEmptyFields = emptyByPage.get(pageNum) || [];
    for (let i = 0; i < pageEmptyFields.length; i++) {
      const field = pageEmptyFields[i];
      drawFieldHighlight(page, field, width, height, font, i + 1, 'missing');
    }

    // Draw highlights for low-confidence fields (amber)
    const pageLowConfFields = lowConfByPage.get(pageNum) || [];
    for (let i = 0; i < pageLowConfFields.length; i++) {
      const field = pageLowConfFields[i];
      drawFieldHighlight(page, field, width, height, font, i + 1, 'low-confidence');
    }

    // Add summary box at the top of pages that have issues
    const totalIssues = pageEmptyFields.length + pageLowConfFields.length;
    if (totalIssues > 0) {
      drawSummaryBanner(page, width, height, pageEmptyFields.length, pageLowConfFields.length, font, boldFont);
    }
  }

  const annotatedBytes = await pdfDoc.save();
  logger.info('Annotated PDF created', {
    pages: pages.length,
    totalMissing: emptyFields.length,
    totalLowConf: lowConfidenceFields?.length || 0,
  });

  return Buffer.from(annotatedBytes);
}

/**
 * Draw a diagonal watermark across the page.
 */
function drawWatermark(
  page: ReturnType<PDFDocument['getPages']>[0],
  width: number,
  height: number,
  font: Awaited<ReturnType<PDFDocument['embedFont']>>,
): void {
  const fontSize = Math.min(width, height) * 0.045;
  const textWidth = font.widthOfTextAtSize(WATERMARK_TEXT, fontSize);

  // Draw diagonal watermark from bottom-left to top-right
  page.drawText(WATERMARK_TEXT, {
    x: (width - textWidth * 0.7) / 2,
    y: height / 2 - fontSize / 2,
    size: fontSize,
    font,
    color: COLORS.watermark,
    opacity: 0.18,
    rotate: degrees(35),
  });

  // Second watermark line offset
  page.drawText(WATERMARK_TEXT, {
    x: (width - textWidth * 0.7) / 2 - width * 0.15,
    y: height * 0.28,
    size: fontSize,
    font,
    color: COLORS.watermark,
    opacity: 0.12,
    rotate: degrees(35),
  });
}

/**
 * Draw a highlight rectangle around a field's value area,
 * color-coded by type (missing=red, low-confidence=amber).
 */
function drawFieldHighlight(
  page: ReturnType<PDFDocument['getPages']>[0],
  field: FormField,
  pageWidth: number,
  pageHeight: number,
  font: Awaited<ReturnType<PDFDocument['embedFont']>>,
  index: number,
  type: 'missing' | 'low-confidence',
): void {
  const bbox = field.valueBoundingBox;
  const padding = 3;

  // Convert Textract coordinates (top-left origin) to PDF coordinates (bottom-left origin)
  const x = bbox.left * pageWidth - padding;
  const y = pageHeight - (bbox.top * pageHeight) - (bbox.height * pageHeight) - padding;
  const w = bbox.width * pageWidth + padding * 2;
  const h = bbox.height * pageHeight + padding * 2;

  const isMissing = type === 'missing';
  const fillColor = isMissing ? COLORS.missingFill : COLORS.lowConfFill;
  const borderColor = field.isRequired && isMissing ? COLORS.requiredBorder : (isMissing ? COLORS.missingBorder : COLORS.lowConfBorder);
  const labelColor = isMissing ? COLORS.missingLabel : COLORS.lowConfLabel;
  const borderWidth = field.isRequired && isMissing ? REQUIRED_BORDER_WIDTH : HIGHLIGHT_BORDER_WIDTH;

  // Draw semi-transparent fill
  page.drawRectangle({
    x,
    y,
    width: w,
    height: h,
    color: fillColor,
    opacity: 0.35,
    borderColor,
    borderWidth,
  });

  // Draw small numbered label above the highlight
  const prefix = isMissing
    ? (field.isRequired ? `REQ #${index}` : `#${index}`)
    : `?${index}`;
  const labelText = `${prefix}: ${field.key}`;
  const displayLabel = labelText.length > 45 ? labelText.slice(0, 42) + '...' : labelText;
  const labelWidth = font.widthOfTextAtSize(displayLabel, LABEL_FONT_SIZE);

  // Label background
  const labelX = x;
  const labelY = y + h + 1;

  page.drawRectangle({
    x: labelX - 1,
    y: labelY - 1,
    width: labelWidth + 4,
    height: LABEL_FONT_SIZE + 3,
    color: COLORS.white,
    opacity: 0.85,
  });

  page.drawText(displayLabel, {
    x: labelX + 1,
    y: labelY,
    size: LABEL_FONT_SIZE,
    font,
    color: labelColor,
  });
}

/**
 * Draw a summary banner at the top of the page.
 */
function drawSummaryBanner(
  page: ReturnType<PDFDocument['getPages']>[0],
  width: number,
  _height: number,
  emptyCount: number,
  lowConfCount: number,
  font: Awaited<ReturnType<PDFDocument['embedFont']>>,
  boldFont: Awaited<ReturnType<PDFDocument['embedFont']>>,
): void {
  const bannerHeight = lowConfCount > 0 ? 30 : 22;
  const bannerY = page.getSize().height - bannerHeight - 2;

  // Banner background
  page.drawRectangle({
    x: 2,
    y: bannerY,
    width: width - 4,
    height: bannerHeight,
    color: COLORS.bannerBg,
    opacity: 0.9,
    borderColor: COLORS.bannerBorder,
    borderWidth: 1,
  });

  // Missing fields line
  if (emptyCount > 0) {
    const prefix = 'ATTENTION: ';
    const message = `${emptyCount} field${emptyCount !== 1 ? 's' : ''} marked in red require${emptyCount === 1 ? 's' : ''} completion`;
    const prefixWidth = boldFont.widthOfTextAtSize(prefix, 8);

    const lineY = lowConfCount > 0 ? bannerY + 16 : bannerY + 7;

    page.drawText(prefix, {
      x: 10,
      y: lineY,
      size: 8,
      font: boldFont,
      color: COLORS.bannerBold,
    });

    page.drawText(message, {
      x: 10 + prefixWidth,
      y: lineY,
      size: 8,
      font,
      color: COLORS.bannerText,
    });
  }

  // Low confidence line
  if (lowConfCount > 0) {
    const lcMessage = `${lowConfCount} field${lowConfCount !== 1 ? 's' : ''} in amber have low detection confidence — verify manually`;
    const lineY = emptyCount > 0 ? bannerY + 5 : bannerY + 7;

    page.drawText(lcMessage, {
      x: 10,
      y: lineY,
      size: 7,
      font,
      color: COLORS.lowConfLabel,
    });
  }
}
