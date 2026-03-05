import { DocumentChunk, ExtractedText } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';

// Approximate tokens as ~4 characters per token (conservative estimate for English text)
const CHARS_PER_TOKEN = 4;
const DEFAULT_CHUNK_SIZE_TOKENS = 500;
const DEFAULT_OVERLAP_TOKENS = 100;

interface ChunkOptions {
  chunkSizeTokens?: number;
  overlapTokens?: number;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Determine which page a character offset falls on, given page break offsets.
 */
function getPageNumber(offset: number, pageBreaks?: number[]): number | undefined {
  if (!pageBreaks || pageBreaks.length === 0) return undefined;
  let page = 1;
  for (const breakOffset of pageBreaks) {
    if (offset >= breakOffset) {
      page++;
    } else {
      break;
    }
  }
  return page;
}

/**
 * Find a natural break point (sentence end, paragraph break) near the target position.
 * Looks backward from target within a window to find the best break.
 */
function findNaturalBreak(text: string, targetPos: number, windowChars: number = 200): number {
  const searchStart = Math.max(0, targetPos - windowChars);
  const searchText = text.slice(searchStart, targetPos);

  // Prefer paragraph breaks
  const lastParagraph = searchText.lastIndexOf('\n\n');
  if (lastParagraph !== -1) {
    return searchStart + lastParagraph + 2;
  }

  // Then sentence endings
  const sentenceEndPattern = /[.!?]\s+/g;
  let lastSentenceEnd = -1;
  let match;
  while ((match = sentenceEndPattern.exec(searchText)) !== null) {
    lastSentenceEnd = match.index + match[0].length;
  }
  if (lastSentenceEnd !== -1) {
    return searchStart + lastSentenceEnd;
  }

  // Then line breaks
  const lastNewline = searchText.lastIndexOf('\n');
  if (lastNewline !== -1) {
    return searchStart + lastNewline + 1;
  }

  // Fall back to target position
  return targetPos;
}

/**
 * Detect section headers in the text near a position.
 * Looks for lines that appear to be headers (short, capitalized, may end with colon).
 */
function detectSectionHeader(text: string, position: number): string | undefined {
  const lookBack = text.slice(Math.max(0, position - 500), position);
  const lines = lookBack.split('\n');

  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;

    const isMarkdownHeader = /^#{1,4}\s+\S/.test(line);
    const isAllCaps = line.length > 3 && line.length < 80 && line === line.toUpperCase() && /[A-Z]/.test(line);
    const isColonHeader = line.length < 80 && line.endsWith(':') && !line.includes('.');
    const isNumberedSection = /^\d+(\.\d+)*\s+[A-Z]/.test(line) && line.length < 100;

    if (isMarkdownHeader || isAllCaps || isColonHeader || isNumberedSection) {
      return line.replace(/^#+\s*/, '').replace(/:$/, '').trim();
    }

    if (line.length > 80) break;
  }

  return undefined;
}

/**
 * Chunk a document's extracted text into overlapping segments suitable for embedding.
 * Detects section headers and attaches them to chunks for better search relevance.
 */
export function chunkDocument(
  documentId: string,
  extracted: ExtractedText,
  options: ChunkOptions = {}
): DocumentChunk[] {
  const chunkSizeTokens = options.chunkSizeTokens || DEFAULT_CHUNK_SIZE_TOKENS;
  const overlapTokens = options.overlapTokens || DEFAULT_OVERLAP_TOKENS;

  const chunkSizeChars = chunkSizeTokens * CHARS_PER_TOKEN;
  const overlapChars = overlapTokens * CHARS_PER_TOKEN;
  const stepChars = chunkSizeChars - overlapChars;

  const text = extracted.text;

  if (!text.trim()) {
    logger.warn('Empty document text, no chunks generated', { documentId });
    return [];
  }

  const chunks: DocumentChunk[] = [];
  let position = 0;
  let chunkIndex = 0;

  while (position < text.length) {
    let endPos = Math.min(position + chunkSizeChars, text.length);

    // If not at the end, find a natural break point
    if (endPos < text.length) {
      endPos = findNaturalBreak(text, endPos);
    }

    const chunkText = text.slice(position, endPos).trim();

    if (chunkText.length > 0) {
      chunks.push({
        id: uuidv4(),
        documentId,
        chunkIndex,
        text: chunkText,
        tokenCount: estimateTokens(chunkText),
        startOffset: position,
        endOffset: endPos,
        pageNumber: getPageNumber(position, extracted.pageBreaks),
        sectionHeader: detectSectionHeader(text, position),
      });
      chunkIndex++;
    }

    // Move forward by step size, finding a natural break
    const nextRawPos = position + stepChars;
    if (nextRawPos >= text.length) break;

    position = findNaturalBreak(text, nextRawPos);

    // Safety: ensure forward progress
    if (position <= chunks[chunks.length - 1]?.startOffset) {
      position = nextRawPos;
    }
  }

  logger.info('Document chunked', {
    documentId,
    chunkCount: chunks.length,
    totalChars: text.length,
    estimatedTokens: estimateTokens(text),
  });

  return chunks;
}
