import { describe, it, expect } from 'vitest';
import { validateFileContent } from '../utils/fileValidation';

describe('File Validation — Magic Bytes', () => {
  it('accepts valid PDF magic bytes (%PDF-)', () => {
    const buf = Buffer.from('%PDF-1.7 fake pdf content');
    const result = validateFileContent(buf, 'application/pdf', 'test.pdf');
    expect(result).toBeNull();
  });

  it('accepts valid DOCX (PK zip header 50 4B 03 04)', () => {
    const buf = Buffer.from([0x50, 0x4B, 0x03, 0x04, 0x00, 0x00, 0x00]);
    const result = validateFileContent(
      buf,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'test.docx',
    );
    expect(result).toBeNull();
  });

  it('accepts valid XLSX (PK zip header 50 4B 03 04)', () => {
    const buf = Buffer.from([0x50, 0x4B, 0x03, 0x04, 0x00]);
    const result = validateFileContent(
      buf,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'report.xlsx',
    );
    expect(result).toBeNull();
  });

  it('accepts valid PNG (89 50 4E 47)', () => {
    const buf = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    const result = validateFileContent(buf, 'image/png', 'image.png');
    expect(result).toBeNull();
  });

  it('accepts valid JPEG (FF D8 FF)', () => {
    const buf = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00]);
    const result = validateFileContent(buf, 'image/jpeg', 'photo.jpg');
    expect(result).toBeNull();
  });

  it('accepts plain text for .txt/.csv (no null bytes)', () => {
    const buf = Buffer.from('Name,Age,City\nAlice,30,NYC\n');
    expect(validateFileContent(buf, 'text/csv', 'data.csv')).toBeNull();
    expect(validateFileContent(buf, 'text/plain', 'notes.txt')).toBeNull();
  });

  it('rejects empty buffer', () => {
    const buf = Buffer.alloc(0);
    const result = validateFileContent(buf, 'application/pdf', 'empty.pdf');
    expect(result).toBe('File is empty');
  });

  it('rejects executable disguised as PDF (wrong magic bytes)', () => {
    // ELF executable header
    const buf = Buffer.from([0x7F, 0x45, 0x4C, 0x46, 0x02, 0x01, 0x01, 0x00]);
    const result = validateFileContent(buf, 'application/pdf', 'evil.pdf');
    expect(result).toContain('does not match its claimed type');
    expect(result).toContain('application/pdf');
  });

  it('rejects binary file uploaded as text (contains null bytes)', () => {
    const buf = Buffer.from([0x48, 0x65, 0x6C, 0x00, 0x6C, 0x6F]); // "Hel\0lo"
    const result = validateFileContent(buf, 'text/plain', 'data.txt');
    expect(result).toContain('appears to be binary');
    expect(result).toContain('text/plain');
  });

  it('accepts TIFF files (little-endian II and big-endian MM)', () => {
    const littleEndian = Buffer.from([0x49, 0x49, 0x2A, 0x00, 0x08, 0x00]);
    expect(validateFileContent(littleEndian, 'image/tiff', 'scan.tiff')).toBeNull();

    const bigEndian = Buffer.from([0x4D, 0x4D, 0x00, 0x2A, 0x00, 0x08]);
    expect(validateFileContent(bigEndian, 'image/tiff', 'scan2.tiff')).toBeNull();
  });

  it('handles buffer too small for magic byte check gracefully', () => {
    // PDF needs 4 bytes but we only provide 2
    const buf = Buffer.from([0x25, 0x50]);
    const result = validateFileContent(buf, 'application/pdf', 'tiny.pdf');
    expect(result).toContain('does not match its claimed type');
  });
});
