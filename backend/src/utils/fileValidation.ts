/**
 * Magic bytes validation — ensures file content matches the claimed MIME type.
 * Prevents content-type spoofing attacks (e.g., uploading an executable as a PDF).
 */

interface MagicSignature {
  bytes: number[];
  offset: number;
}

const MAGIC_BYTES: Record<string, MagicSignature[]> = {
  'application/pdf': [
    { bytes: [0x25, 0x50, 0x44, 0x46], offset: 0 }, // %PDF
  ],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [
    { bytes: [0x50, 0x4B, 0x03, 0x04], offset: 0 }, // PK zip header (DOCX is a zip)
  ],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': [
    { bytes: [0x50, 0x4B, 0x03, 0x04], offset: 0 }, // PK zip header (XLSX is a zip)
  ],
  'application/msword': [
    { bytes: [0xD0, 0xCF, 0x11, 0xE0], offset: 0 }, // OLE compound file (DOC)
  ],
  'application/vnd.ms-excel': [
    { bytes: [0xD0, 0xCF, 0x11, 0xE0], offset: 0 }, // OLE compound file (XLS)
  ],
  'image/png': [
    { bytes: [0x89, 0x50, 0x4E, 0x47], offset: 0 }, // PNG
  ],
  'image/jpeg': [
    { bytes: [0xFF, 0xD8, 0xFF], offset: 0 }, // JPEG
  ],
  'image/tiff': [
    { bytes: [0x49, 0x49, 0x2A, 0x00], offset: 0 }, // TIFF little-endian
    { bytes: [0x4D, 0x4D, 0x00, 0x2A], offset: 0 }, // TIFF big-endian
  ],
};

// Text-based formats don't have magic bytes — just check they're valid UTF-8 text
const TEXT_MIMES = new Set([
  'text/plain',
  'text/csv',
]);

function matchesSignature(buffer: Buffer, sig: MagicSignature): boolean {
  if (buffer.length < sig.offset + sig.bytes.length) return false;
  for (let i = 0; i < sig.bytes.length; i++) {
    if (buffer[sig.offset + i] !== sig.bytes[i]) return false;
  }
  return true;
}

/**
 * Validates that the file buffer content matches the claimed MIME type.
 * Returns null if valid, or an error message if the content doesn't match.
 */
export function validateFileContent(buffer: Buffer, claimedMime: string, filename: string): string | null {
  if (buffer.length === 0) {
    return 'File is empty';
  }

  // Text-based formats: just check it's not binary
  if (TEXT_MIMES.has(claimedMime)) {
    // Check first 8KB for null bytes (binary indicator)
    const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
    if (sample.includes(0x00)) {
      return `File "${filename}" appears to be binary but was uploaded as ${claimedMime}`;
    }
    return null;
  }

  // Check if we have magic bytes for this MIME type
  const signatures = MAGIC_BYTES[claimedMime];
  if (!signatures) {
    // No magic bytes defined for this type — allow it (extension-based types)
    return null;
  }

  // Check if any signature matches
  const matches = signatures.some(sig => matchesSignature(buffer, sig));
  if (!matches) {
    return `File "${filename}" content does not match its claimed type (${claimedMime}). The file may be corrupted or mislabeled.`;
  }

  return null;
}
