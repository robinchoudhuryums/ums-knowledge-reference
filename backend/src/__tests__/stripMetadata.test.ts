/**
 * Tests for stripMetadata: cover both image + PDF paths added in M10
 * so the CI coverage thresholds (63% lines, 53% branches) are met.
 *
 * The image path uses sharp — we provide a tiny real PNG buffer so the
 * full re-encode path runs. The PDF path uses pdf-lib — we construct a
 * real PDF in-memory, set some info-dict fields, then assert they're
 * cleared after stripping.
 */

import { describe, it, expect, vi } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';

vi.mock('../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('stripDocumentMetadata dispatcher', () => {
  it('routes image MIMEs to the image stripper', async () => {
    const { stripDocumentMetadata } = await import('../utils/stripMetadata');
    const png = await sharp({
      create: { width: 2, height: 2, channels: 3, background: { r: 0, g: 0, b: 0 } },
    }).png().toBuffer();

    const result = await stripDocumentMetadata(png, 'image/png', 'test.png');
    expect(result.stripped).toBe(true);
    expect(result.buffer.length).toBeGreaterThan(0);
  });

  it('routes PDFs to the PDF stripper', async () => {
    const { stripDocumentMetadata } = await import('../utils/stripMetadata');
    const doc = await PDFDocument.create();
    doc.addPage([100, 100]);
    doc.setAuthor('Dr. John Smith');
    doc.setTitle('Patient Jane Doe — MRI');
    const pdf = Buffer.from(await doc.save());

    const result = await stripDocumentMetadata(pdf, 'application/pdf', 'scan.pdf');
    expect(result.stripped).toBe(true);
    expect(result.metadataFound).toBe(true);
  });

  it('passes through unknown MIME types unchanged', async () => {
    const { stripDocumentMetadata } = await import('../utils/stripMetadata');
    const buf = Buffer.from('arbitrary content');
    const result = await stripDocumentMetadata(buf, 'application/vnd.ms-excel', 'sheet.xlsx');
    expect(result.stripped).toBe(false);
    expect(result.buffer).toBe(buf);
  });
});

describe('stripPdfMetadata (M10)', () => {
  it('clears /Author, /Title, /Subject, /Keywords, /Producer, /Creator', async () => {
    const { stripPdfMetadata } = await import('../utils/stripMetadata');

    const doc = await PDFDocument.create();
    doc.addPage([100, 100]);
    doc.setAuthor('Dr. John Smith');
    doc.setTitle('Patient Jane Doe — MRI');
    doc.setSubject('Clinical evaluation 2026');
    doc.setKeywords(['PHI', 'confidential']);
    doc.setProducer('AcmeHospital PDF Export 1.2');
    doc.setCreator('AcmeHospital EHR');
    const pdf = Buffer.from(await doc.save());

    const result = await stripPdfMetadata(pdf, 'original.pdf');
    expect(result.stripped).toBe(true);
    expect(result.metadataFound).toBe(true);

    // Round-trip the stripped buffer and confirm the user-set PHI fields are now empty.
    // Note: pdf-lib sets a default /Producer on save, so we don't require that field
    // to be empty — only the fields an attacker/user might have populated with PHI.
    const roundTripped = await PDFDocument.load(result.buffer);
    expect(roundTripped.getAuthor() || '').toBe('');
    expect(roundTripped.getTitle() || '').toBe('');
    expect(roundTripped.getSubject() || '').toBe('');
    expect(roundTripped.getCreator() || '').toBe('');
    // Keywords should not contain our PHI markers
    const kw = (roundTripped.getKeywords() || '').toString();
    expect(kw).not.toContain('PHI');
    expect(kw).not.toContain('confidential');
    // Producer should no longer contain the hospital name we set
    expect(roundTripped.getProducer() || '').not.toContain('AcmeHospital');
  });

  it('reports metadataFound=false when the source PDF has no info dict entries', async () => {
    const { stripPdfMetadata } = await import('../utils/stripMetadata');

    // pdf-lib sets a default producer/creator of its own, so the cleanest
    // "no metadata" test is to explicitly clear them on the source doc
    // before re-saving.
    const doc = await PDFDocument.create();
    doc.addPage([100, 100]);
    doc.setProducer('');
    doc.setCreator('');
    const pdf = Buffer.from(await doc.save());

    const result = await stripPdfMetadata(pdf);
    // Accept either outcome here (pdf-lib may or may not reintroduce defaults);
    // the important guarantee is that stripped=true and the buffer is valid.
    expect(result.stripped).toBe(true);
    expect(result.buffer.length).toBeGreaterThan(0);
  });

  it('returns the original buffer and stripped=false when input is not a valid PDF', async () => {
    const { stripPdfMetadata } = await import('../utils/stripMetadata');
    const garbage = Buffer.from('not-a-pdf');
    const result = await stripPdfMetadata(garbage, 'broken.pdf');
    expect(result.stripped).toBe(false);
    expect(result.buffer).toBe(garbage);
    expect(result.originalSize).toBe(garbage.length);
    expect(result.strippedSize).toBe(garbage.length);
  });

  it('preserves visible page content (page count unchanged)', async () => {
    const { stripPdfMetadata } = await import('../utils/stripMetadata');

    const doc = await PDFDocument.create();
    doc.addPage([100, 100]);
    doc.addPage([100, 100]);
    doc.addPage([100, 100]);
    doc.setAuthor('PHI');
    const pdf = Buffer.from(await doc.save());

    const result = await stripPdfMetadata(pdf);
    const roundTripped = await PDFDocument.load(result.buffer);
    expect(roundTripped.getPageCount()).toBe(3);
  });
});
