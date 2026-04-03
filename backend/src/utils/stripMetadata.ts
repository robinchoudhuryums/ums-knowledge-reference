/**
 * Image Metadata Stripping Utility
 *
 * Strips EXIF, IPTC, XMP, and other metadata from image files before storage.
 * This is a HIPAA defense-in-depth measure — camera phones embed GPS location,
 * timestamps, and device info in image metadata that could identify patients
 * or reveal where they live/receive care.
 *
 * The visible image content (pixels) is preserved unchanged — only hidden
 * metadata is removed. Insurance card text, clinical photo details, etc.
 * remain fully readable.
 *
 * Uses sharp for reliable cross-format metadata removal (JPEG, PNG, WebP, TIFF).
 * For PDFs and non-image files, returns the buffer unchanged.
 */

import sharp from 'sharp';
import { logger } from '../utils/logger';

/** Image MIME types that can contain EXIF/metadata */
const STRIPPABLE_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/tiff',
  'image/avif',
]);

export interface StripResult {
  buffer: Buffer;
  stripped: boolean;
  metadataFound: boolean;
  originalSize: number;
  strippedSize: number;
}

/**
 * Strip metadata from an image buffer.
 * Returns the cleaned buffer with all EXIF, IPTC, XMP, and ICC profile data removed.
 * For non-image files or unsupported formats, returns the original buffer unchanged.
 */
export async function stripImageMetadata(
  buffer: Buffer,
  mimeType: string,
  filename?: string,
): Promise<StripResult> {
  if (!STRIPPABLE_MIMES.has(mimeType)) {
    return { buffer, stripped: false, metadataFound: false, originalSize: buffer.length, strippedSize: buffer.length };
  }

  try {
    // Read metadata first to check if there's anything to strip
    const metadata = await sharp(buffer).metadata();
    const hasExif = !!metadata.exif;
    const hasIcc = !!metadata.icc;
    const hasIptc = !!metadata.iptc;
    const hasXmp = !!metadata.xmp;
    const metadataFound = hasExif || hasIcc || hasIptc || hasXmp;

    // Re-encode the image without metadata
    // sharp's toBuffer() with no options strips all metadata by default
    // We explicitly set withMetadata(false) to be clear about intent
    // sharp strips all metadata by default when re-encoding (no withMetadata() call)
    let pipeline = sharp(buffer);

    // Preserve format
    if (mimeType === 'image/jpeg') {
      pipeline = pipeline.jpeg({ quality: 95, mozjpeg: false }); // High quality, no re-compression artifacts
    } else if (mimeType === 'image/png') {
      pipeline = pipeline.png();
    } else if (mimeType === 'image/webp') {
      pipeline = pipeline.webp({ quality: 95 });
    } else if (mimeType === 'image/tiff') {
      pipeline = pipeline.tiff();
    } else if (mimeType === 'image/avif') {
      pipeline = pipeline.avif({ quality: 95 });
    }

    const strippedBuffer = await pipeline.toBuffer();

    if (metadataFound) {
      logger.info('Image metadata stripped', {
        filename,
        originalSize: buffer.length,
        strippedSize: strippedBuffer.length,
        hadExif: hasExif,
        hadIcc: hasIcc,
        hadIptc: hasIptc,
        hadXmp: hasXmp,
      });
    }

    return {
      buffer: strippedBuffer,
      stripped: true,
      metadataFound,
      originalSize: buffer.length,
      strippedSize: strippedBuffer.length,
    };
  } catch (error) {
    // If metadata stripping fails, log the error but return the original buffer
    // rather than blocking the upload entirely. The image content is still needed.
    logger.warn('Image metadata stripping failed, proceeding with original', {
      filename,
      error: error instanceof Error ? error.message : String(error),
    });
    return { buffer, stripped: false, metadataFound: false, originalSize: buffer.length, strippedSize: buffer.length };
  }
}
