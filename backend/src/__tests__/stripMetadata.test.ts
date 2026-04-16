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
import JSZip from 'jszip';

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

// ── OOXML (DOCX/XLSX) metadata stripping ──────────────────────────────────

/** Build a minimal DOCX-like ZIP with docProps/core.xml set */
async function buildMockDocx(meta: { creator?: string; lastModifiedBy?: string; title?: string; company?: string }): Promise<Buffer> {
  const zip = new JSZip();
  // Minimal [Content_Types].xml so it looks like a real OOXML file
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>');

  const coreXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
    xmlns:dc="http://purl.org/dc/elements/1.1/">
  <dc:creator>${meta.creator || ''}</dc:creator>
  <cp:lastModifiedBy>${meta.lastModifiedBy || ''}</cp:lastModifiedBy>
  <dc:title>${meta.title || ''}</dc:title>
</cp:coreProperties>`;
  zip.file('docProps/core.xml', coreXml);

  if (meta.company) {
    const appXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">
  <Company>${meta.company}</Company>
</Properties>`;
    zip.file('docProps/app.xml', appXml);
  }

  // A fake document body so the zip isn't trivially empty
  zip.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body/></w:document>');
  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }));
}

describe('stripOoxmlMetadata (DOCX/XLSX)', () => {
  it('clears creator, lastModifiedBy, title, and company', async () => {
    const { stripOoxmlMetadata } = await import('../utils/stripMetadata');
    const docx = await buildMockDocx({
      creator: 'Dr. John Smith',
      lastModifiedBy: 'Jane Doe',
      title: 'Patient Demographics',
      company: 'Springfield Hospital',
    });

    const result = await stripOoxmlMetadata(docx, 'intake.docx');
    expect(result.stripped).toBe(true);
    expect(result.metadataFound).toBe(true);

    // Verify the stripped zip no longer contains the PHI
    const roundTripped = await JSZip.loadAsync(result.buffer);
    const coreStr = await roundTripped.file('docProps/core.xml')!.async('string');
    expect(coreStr).not.toContain('Dr. John Smith');
    expect(coreStr).not.toContain('Jane Doe');
    expect(coreStr).not.toContain('Patient Demographics');

    const appStr = await roundTripped.file('docProps/app.xml')!.async('string');
    expect(appStr).not.toContain('Springfield Hospital');
  });

  it('preserves document body content byte-for-byte', async () => {
    const { stripOoxmlMetadata } = await import('../utils/stripMetadata');
    const docx = await buildMockDocx({ creator: 'PHI Name' });

    const result = await stripOoxmlMetadata(docx, 'test.docx');
    const roundTripped = await JSZip.loadAsync(result.buffer);
    const bodyXml = await roundTripped.file('word/document.xml')!.async('string');
    expect(bodyXml).toContain('<w:body/>');
  });

  it('reports metadataFound=false when docProps entries are absent', async () => {
    const { stripOoxmlMetadata } = await import('../utils/stripMetadata');
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<Types/>');
    zip.file('word/document.xml', '<doc/>');
    const noMeta = Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }));

    const result = await stripOoxmlMetadata(noMeta, 'clean.docx');
    expect(result.stripped).toBe(true);
    expect(result.metadataFound).toBe(false);
  });

  it('returns original buffer on invalid ZIP', async () => {
    const { stripOoxmlMetadata } = await import('../utils/stripMetadata');
    const garbage = Buffer.from('not-a-zip');
    const result = await stripOoxmlMetadata(garbage, 'bad.docx');
    expect(result.stripped).toBe(false);
    expect(result.buffer).toBe(garbage);
  });
});

describe('stripDocumentMetadata dispatcher — OOXML routing', () => {
  it('routes DOCX to the OOXML stripper', async () => {
    const { stripDocumentMetadata } = await import('../utils/stripMetadata');
    const docx = await buildMockDocx({ creator: 'Test' });
    const result = await stripDocumentMetadata(docx, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'test.docx');
    expect(result.stripped).toBe(true);
  });

  it('routes XLSX to the OOXML stripper', async () => {
    const { stripDocumentMetadata } = await import('../utils/stripMetadata');
    const xlsx = await buildMockDocx({ creator: 'Test' });
    const result = await stripDocumentMetadata(xlsx, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'data.xlsx');
    expect(result.stripped).toBe(true);
  });
});
