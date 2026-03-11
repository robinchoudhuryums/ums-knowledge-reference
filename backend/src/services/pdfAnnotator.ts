/**
 * PDF Annotator — marks up a PDF with highlights around missing form fields
 * and adds a watermark indicating it's an example copy.
 *
 * Uses pdf-lib for PDF manipulation. Textract bounding boxes are normalized
 * (0-1 range relative to page dimensions), so we convert them to PDF coordinates.
 *
 * Important coordinate note: Textract origin is top-left (Y increases downward),
 * while PDF origin is bottom-left (Y increases upward). We flip Y accordingly.
 */

import { PDFDocument, rgb, StandardFonts, degrees } from 'pdf-lib';
import { FormField } from './formAnalyzer';
import { logger } from '../utils/logger';

const WATERMARK_TEXT = 'EXAMPLE COPY - NOT FOR INSURANCE SUBMISSION';
const HIGHLIGHT_COLOR = rgb(1, 0, 0);          // Red
const HIGHLIGHT_FILL = rgb(1, 0.85, 0.85);     // Light red fill
const ARROW_COLOR = rgb(0.8, 0, 0);            // Dark red for labels
const LABEL_FONT_SIZE = 7;
const HIGHLIGHT_BORDER_WIDTH = 1.5;

/**
 * Create an annotated copy of a PDF with red highlights around blank fields
 * and a diagonal watermark on every page.
 */
export async function createAnnotatedPdf(
  originalPdfBuffer: Buffer,
  emptyFields: FormField[],
): Promise<Buffer> {
  const pdfDoc = await PDFDocument.load(originalPdfBuffer);
  const pages = pdfDoc.getPages();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // Group empty fields by page
  const fieldsByPage = new Map<number, FormField[]>();
  for (const field of emptyFields) {
    const pageFields = fieldsByPage.get(field.page) || [];
    pageFields.push(field);
    fieldsByPage.set(field.page, pageFields);
  }

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const page = pages[pageIndex];
    const { width, height } = page.getSize();
    const pageNum = pageIndex + 1;

    // Add watermark to every page
    drawWatermark(page, width, height, boldFont);

    // Add highlight rectangles around empty fields on this page
    const pageFields = fieldsByPage.get(pageNum) || [];

    for (let i = 0; i < pageFields.length; i++) {
      const field = pageFields[i];
      drawFieldHighlight(page, field, width, height, font, i + 1);
    }

    // Add summary box at the top of pages that have missing fields
    if (pageFields.length > 0) {
      drawSummaryBanner(page, width, height, pageFields.length, font, boldFont);
    }
  }

  const annotatedBytes = await pdfDoc.save();
  logger.info('Annotated PDF created', {
    pages: pages.length,
    totalHighlights: emptyFields.length,
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
    color: rgb(0.85, 0.15, 0.15),
    opacity: 0.18,
    rotate: degrees(35),
  });

  // Second watermark line offset
  page.drawText(WATERMARK_TEXT, {
    x: (width - textWidth * 0.7) / 2 - width * 0.15,
    y: height * 0.28,
    size: fontSize,
    font,
    color: rgb(0.85, 0.15, 0.15),
    opacity: 0.12,
    rotate: degrees(35),
  });
}

/**
 * Draw a red highlight rectangle around a blank field's value area,
 * with a small label indicating the field name.
 */
function drawFieldHighlight(
  page: ReturnType<PDFDocument['getPages']>[0],
  field: FormField,
  pageWidth: number,
  pageHeight: number,
  font: Awaited<ReturnType<PDFDocument['embedFont']>>,
  index: number,
): void {
  const bbox = field.valueBoundingBox;
  const padding = 3;

  // Convert Textract coordinates (top-left origin) to PDF coordinates (bottom-left origin)
  const x = bbox.left * pageWidth - padding;
  const y = pageHeight - (bbox.top * pageHeight) - (bbox.height * pageHeight) - padding;
  const w = bbox.width * pageWidth + padding * 2;
  const h = bbox.height * pageHeight + padding * 2;

  // Draw semi-transparent red fill
  page.drawRectangle({
    x,
    y,
    width: w,
    height: h,
    color: HIGHLIGHT_FILL,
    opacity: 0.35,
    borderColor: HIGHLIGHT_COLOR,
    borderWidth: HIGHLIGHT_BORDER_WIDTH,
  });

  // Draw small numbered label above the highlight
  const labelText = `#${index}: ${field.key}`;
  // Truncate long labels
  const displayLabel = labelText.length > 40 ? labelText.slice(0, 37) + '...' : labelText;
  const labelWidth = font.widthOfTextAtSize(displayLabel, LABEL_FONT_SIZE);

  // Label background
  const labelX = x;
  const labelY = y + h + 1;

  page.drawRectangle({
    x: labelX - 1,
    y: labelY - 1,
    width: labelWidth + 4,
    height: LABEL_FONT_SIZE + 3,
    color: rgb(1, 1, 1),
    opacity: 0.85,
  });

  page.drawText(displayLabel, {
    x: labelX + 1,
    y: labelY,
    size: LABEL_FONT_SIZE,
    font,
    color: ARROW_COLOR,
  });
}

/**
 * Draw a summary banner at the top of the page listing how many fields need attention.
 */
function drawSummaryBanner(
  page: ReturnType<PDFDocument['getPages']>[0],
  width: number,
  _height: number,
  emptyCount: number,
  font: Awaited<ReturnType<PDFDocument['embedFont']>>,
  boldFont: Awaited<ReturnType<PDFDocument['embedFont']>>,
): void {
  const bannerHeight = 22;
  const bannerY = page.getSize().height - bannerHeight - 2;

  // Banner background
  page.drawRectangle({
    x: 2,
    y: bannerY,
    width: width - 4,
    height: bannerHeight,
    color: rgb(1, 0.92, 0.92),
    opacity: 0.9,
    borderColor: rgb(0.9, 0.2, 0.2),
    borderWidth: 1,
  });

  const message = `ATTENTION: ${emptyCount} field${emptyCount !== 1 ? 's' : ''} marked in red require${emptyCount === 1 ? 's' : ''} completion`;
  const prefix = 'ATTENTION: ';
  const prefixWidth = boldFont.widthOfTextAtSize(prefix, 8);

  page.drawText(prefix, {
    x: 10,
    y: bannerY + 7,
    size: 8,
    font: boldFont,
    color: rgb(0.8, 0, 0),
  });

  page.drawText(message.slice(prefix.length), {
    x: 10 + prefixWidth,
    y: bannerY + 7,
    size: 8,
    font,
    color: rgb(0.5, 0.1, 0.1),
  });
}
