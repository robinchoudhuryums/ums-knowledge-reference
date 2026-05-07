import { ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { PDFDocument } from 'pdf-lib';
import { bedrockClient, BEDROCK_GENERATION_MODEL } from '../config/aws';
import { logger } from '../utils/logger';
import { redactPhi } from '../utils/phiRedactor';

/** Max document size for Bedrock Converse API (bytes) */
const MAX_CONVERSE_DOC_SIZE = 4.5 * 1024 * 1024;

/**
 * M2: Filenames uploaded by users commonly embed PHI — e.g.
 * "john-doe-mri-scan.pdf" or "patient_jane_123456_demographics.pdf".
 * Redact before any structured log so the filename can't leak into
 * CloudWatch or other log aggregators as free-text PHI.
 *
 * Image descriptions themselves are NEVER logged here; they're returned
 * to the ingestion pipeline where they become vector-store chunks.
 * If a future maintainer adds a `logger.info('description', { text })`
 * call, that text must also go through redactPhi first.
 */
function safeFilename(name: string): string {
  return redactPhi(name).text;
}

const VISION_PROMPT = `Examine this document and describe ONLY the visual elements — images, photos, diagrams, charts, graphs, tables shown as images, logos, and illustrations. For each visual element:
- Describe what it shows in detail (subject, labels, data, layout)
- Note the page number or location if apparent
- Include any text/labels visible within the visual element

If there are NO visual elements (images, photos, diagrams, charts) in the document, respond with exactly: NO_VISUAL_ELEMENTS

Do NOT describe or repeat regular text content — only visual elements.`;

/**
 * Sanitize a filename for the Bedrock Converse API document name field.
 * Allowed: alphanumeric, whitespace, hyphens, parentheses, square brackets.
 * No consecutive whitespace. No dots, underscores, or other special chars.
 */
function sanitizeDocName(filename: string): string {
  // Strip file extension first
  const nameWithoutExt = filename.replace(/\.[^.]+$/, '');
  // Replace disallowed characters with spaces
  const cleaned = nameWithoutExt.replace(/[^a-zA-Z0-9\s\-\(\)\[\]]/g, ' ');
  // Collapse consecutive whitespace
  return cleaned.replace(/\s{2,}/g, ' ').trim().substring(0, 200) || 'document';
}

/**
 * Send a single PDF buffer to Claude Haiku via Bedrock Converse API.
 * Returns the raw response text or empty string if no visual elements.
 */
async function analyzeChunk(pdfBuffer: Buffer, docName: string): Promise<string> {
  const command = new ConverseCommand({
    modelId: BEDROCK_GENERATION_MODEL,
    messages: [
      {
        role: 'user',
        content: [
          {
            document: {
              format: 'pdf',
              name: docName,
              source: {
                bytes: pdfBuffer,
              },
            },
          },
          {
            text: VISION_PROMPT,
          },
        ],
      },
    ],
    system: [
      {
        text: 'You are a document analysis assistant. Your job is to describe visual elements in documents accurately and concisely.',
      },
      // Bedrock Converse API prompt caching: a cachePoint block marks the
      // preceding system content as cacheable. Cast needed because older
      // @aws-sdk/client-bedrock-runtime versions don't include cachePoint
      // in SystemContentBlock. Satisfies INV-05.
      ({ cachePoint: { type: 'default' } } as unknown as { text: string }),
    ],
    inferenceConfig: {
      maxTokens: 4096,
      temperature: 0.1,
    },
  });

  const response = await bedrockClient.send(command);

  const outputText =
    response.output?.message?.content
      ?.map(block => ('text' in block ? block.text : ''))
      .join('\n')
      .trim() || '';

  if (outputText === 'NO_VISUAL_ELEMENTS' || outputText.includes('NO_VISUAL_ELEMENTS')) {
    return '';
  }
  return outputText;
}

/**
 * Split a large PDF into page-range chunks that each fit under the Converse API size limit.
 * Returns an array of { buffer, label } objects.
 */
async function splitPdfIntoChunks(
  pdfBuffer: Buffer,
  filename: string
): Promise<Array<{ buffer: Buffer; label: string }>> {
  const srcDoc = await PDFDocument.load(pdfBuffer);
  const totalPages = srcDoc.getPageCount();
  const chunks: Array<{ buffer: Buffer; label: string }> = [];

  // Binary-search style: start with half the pages, shrink if still too large
  let startPage = 0;
  while (startPage < totalPages) {
    let endPage = totalPages; // exclusive
    let chunkBytes: Uint8Array | null = null;

    while (endPage > startPage) {
      const chunkDoc = await PDFDocument.create();
      const pageIndices = Array.from(
        { length: endPage - startPage },
        (_, i) => startPage + i
      );
      const copiedPages = await chunkDoc.copyPages(srcDoc, pageIndices);
      copiedPages.forEach(p => chunkDoc.addPage(p));
      chunkBytes = await chunkDoc.save();

      if (chunkBytes.length <= MAX_CONVERSE_DOC_SIZE) {
        break;
      }
      // Too large — halve the page range (but at least 1 page)
      endPage = startPage + Math.max(1, Math.floor((endPage - startPage) / 2));
      if (endPage === startPage + 1) {
        // Single page still too large — skip this page
        const singleDoc = await PDFDocument.create();
        const [singlePage] = await singleDoc.copyPages(srcDoc, [startPage]);
        singleDoc.addPage(singlePage);
        const singleBytes = await singleDoc.save();
        if (singleBytes.length > MAX_CONVERSE_DOC_SIZE) {
          logger.warn('Vision extraction: single page too large, skipping', {
            filename: safeFilename(filename),
            page: startPage + 1,
            sizeBytes: singleBytes.length,
          });
          chunkBytes = null;
        }
        break;
      }
    }

    if (chunkBytes && chunkBytes.length <= MAX_CONVERSE_DOC_SIZE) {
      chunks.push({
        buffer: Buffer.from(chunkBytes),
        label: `pages ${startPage + 1}-${endPage}`,
      });
    }

    startPage = endPage;
  }

  return chunks;
}

export interface VisionExtractionResult {
  /** Concatenated descriptions of visual elements, prefixed/suffixed for chunking. Empty if none found. */
  text: string;
  /** Operator-readable, PHI-safe warnings from partial failures: oversized
   *  pages skipped, individual chunks that errored, the whole pass failing.
   *  Empty array means clean run. Bubbled up to Document.extractionWarnings
   *  so users see when a "ready" document is missing image content (F9). */
  warnings: string[];
}

/**
 * Send a PDF to Claude Haiku via Bedrock Converse API to describe images/diagrams.
 * For PDFs over the API size limit, splits into page-range chunks.
 * Returns descriptive text for all visual elements found and any warnings
 * accumulated from partial failures.
 */
export async function extractImageDescriptions(
  pdfBuffer: Buffer,
  filename: string
): Promise<VisionExtractionResult> {
  const warnings: string[] = [];
  try {
    logger.info('Vision extraction: analyzing PDF for visual elements', {
      filename: safeFilename(filename),
      sizeBytes: pdfBuffer.length,
    });

    const docName = sanitizeDocName(filename);

    // If small enough, process in one call
    if (pdfBuffer.length <= MAX_CONVERSE_DOC_SIZE) {
      const result = await analyzeChunk(pdfBuffer, docName);
      if (!result) {
        logger.info('Vision extraction: no visual elements found', { filename: safeFilename(filename) });
        return { text: '', warnings };
      }
      logger.info('Vision extraction: described visual elements', {
        filename: safeFilename(filename),
        descriptionLength: result.length,
      });
      return {
        text: `\n\n--- Image and Visual Element Descriptions ---\n${result}\n--- End Visual Descriptions ---\n`,
        warnings,
      };
    }

    // Large PDF — split into chunks and process each
    logger.info('Vision extraction: PDF exceeds size limit, splitting into page chunks', {
      filename: safeFilename(filename),
      sizeBytes: pdfBuffer.length,
    });

    const chunks = await splitPdfIntoChunks(pdfBuffer, filename);
    if (chunks.length === 0) {
      logger.warn('Vision extraction: could not produce any chunks under size limit', { filename: safeFilename(filename) });
      warnings.push('Vision analysis skipped: PDF too large to chunk under the API size limit. Image content not indexed.');
      return { text: '', warnings };
    }

    logger.info('Vision extraction: processing page chunks', {
      filename: safeFilename(filename),
      chunkCount: chunks.length,
      chunkLabels: chunks.map(c => c.label),
    });

    const descriptions: string[] = [];
    const failedChunkLabels: string[] = [];
    for (const chunk of chunks) {
      try {
        const chunkName = `${docName} ${chunk.label}`;
        const result = await analyzeChunk(chunk.buffer, sanitizeDocName(chunkName));
        if (result) {
          descriptions.push(`[${chunk.label}]\n${result}`);
        }
      } catch (chunkError) {
        logger.warn('Vision extraction: chunk failed, continuing with remaining', {
          filename: safeFilename(filename),
          chunk: chunk.label,
          error: String(chunkError),
        });
        failedChunkLabels.push(chunk.label);
      }
    }

    if (failedChunkLabels.length > 0) {
      // List failed page ranges; cap the message length so a 50-chunk PDF
      // with widespread failures doesn't blow up the warning array.
      const sample = failedChunkLabels.slice(0, 5).join('; ');
      const more = failedChunkLabels.length > 5 ? ` (+${failedChunkLabels.length - 5} more)` : '';
      warnings.push(`Vision analysis failed for ${failedChunkLabels.length} page range${failedChunkLabels.length === 1 ? '' : 's'}: ${sample}${more}.`);
    }

    if (descriptions.length === 0) {
      logger.info('Vision extraction: no visual elements found in any chunk', { filename: safeFilename(filename) });
      return { text: '', warnings };
    }

    const combined = descriptions.join('\n\n');
    logger.info('Vision extraction: described visual elements across chunks', {
      filename: safeFilename(filename),
      descriptionLength: combined.length,
      chunksWithVisuals: descriptions.length,
    });

    return {
      text: `\n\n--- Image and Visual Element Descriptions ---\n${combined}\n--- End Visual Descriptions ---\n`,
      warnings,
    };
  } catch (error) {
    // Vision extraction is optional — log and continue without it
    logger.warn('Vision extraction failed, continuing without image descriptions', {
      filename: safeFilename(filename),
      error: String(error),
    });
    warnings.push('Vision analysis failed entirely — document was indexed without image content.');
    return { text: '', warnings };
  }
}
