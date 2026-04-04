import { DocumentChunk, ExtractedText } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';

// Default chars-per-token ratio (conservative estimate for English text).
// Can be overridden per-document via ChunkOptions for domain-specific text.
const DEFAULT_CHARS_PER_TOKEN = 4;
const DEFAULT_CHUNK_SIZE_TOKENS = 500;
const DEFAULT_OVERLAP_TOKENS = 100;

// Module-level ratio for estimateTokens (set per chunkDocument call)
let _activeCharsPerToken = DEFAULT_CHARS_PER_TOKEN;

export interface ChunkOptions {
  chunkSizeTokens?: number;
  overlapTokens?: number;
  /**
   * Characters-per-token ratio for token estimation.
   * Medical/clinical text with abbreviations (ICD-10, HCPCS) may use ~3.5.
   * General English text uses ~4.0 (default).
   * Adapted from Observatory QA's getCharsPerTokenForIndustry().
   */
  charsPerToken?: number;
}

/**
 * Get recommended charsPerToken for a document type.
 * Adapted from Observatory QA's industry-specific token ratios.
 */
export function getCharsPerTokenForDocType(docType?: string): number {
  switch (docType) {
    case 'medical':
    case 'clinical':
    case 'lcd':      // LCD coverage criteria have dense clinical codes
    case 'hcpcs':    // HCPCS/CPT reference docs
      return 3.5;
    case 'form':     // CMN forms, prior auth templates
      return 3.8;
    default:
      return DEFAULT_CHARS_PER_TOKEN;
  }
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / _activeCharsPerToken);
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
 * Detect table boundaries in text. Returns array of { start, end } character offsets
 * for contiguous table regions (pipe-delimited, tab-delimited, or consistent column structure).
 * Tables are kept intact as single chunks to preserve row/column relationships.
 */
function detectTables(text: string): Array<{ start: number; end: number }> {
  const tables: Array<{ start: number; end: number }> = [];
  const lines = text.split('\n');
  let offset = 0;
  let tableStart = -1;
  let tableLineCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Detect pipe-delimited table rows (markdown-style): "| col1 | col2 |" or "col1 | col2"
    // A pipe row has 3+ pipe-separated segments, OR has at least one pipe with word chars and is not a separator line
    const isPipeRow = (trimmed.split('|').length >= 3) ||
      (trimmed.includes('|') && /\w/.test(trimmed) && !/^[|:\-\s]+$/.test(trimmed));
    // Detect separator rows: "|---|---|" or "--- | ---"
    const isSeparator = /^[|:\-\s]+$/.test(trimmed) && trimmed.includes('-');
    // Detect tab-delimited rows with multiple columns
    const isTabRow = (line.split('\t').length >= 3);

    const isTableLine = (isPipeRow || isSeparator || isTabRow) && trimmed.length > 0;

    if (isTableLine) {
      if (tableStart === -1) {
        tableStart = offset;
      }
      tableLineCount++;
    } else {
      // End of table region — require at least 3 lines to count as a table
      if (tableStart !== -1 && tableLineCount >= 3) {
        tables.push({ start: tableStart, end: offset });
      }
      tableStart = -1;
      tableLineCount = 0;
    }

    offset += line.length + 1; // +1 for the newline
  }

  // Handle table at end of text
  if (tableStart !== -1 && tableLineCount >= 3) {
    tables.push({ start: tableStart, end: text.length });
  }

  return tables;
}

/**
 * Check if a position falls inside a table region.
 * Returns the table's end position if inside, or -1 if not.
 */
function getTableEnd(position: number, tables: Array<{ start: number; end: number }>): number {
  for (const table of tables) {
    if (position >= table.start && position < table.end) {
      return table.end;
    }
  }
  return -1;
}

/**
 * Chunk a document's extracted text into overlapping segments suitable for embedding.
 * Detects section headers and attaches them to chunks for better search relevance.
 * Tables are kept as intact chunks to preserve structure.
 */
export function chunkDocument(
  documentId: string,
  extracted: ExtractedText,
  options: ChunkOptions = {}
): DocumentChunk[] {
  const chunkSizeTokens = options.chunkSizeTokens || DEFAULT_CHUNK_SIZE_TOKENS;
  const overlapTokens = options.overlapTokens || DEFAULT_OVERLAP_TOKENS;
  const cpt = options.charsPerToken || DEFAULT_CHARS_PER_TOKEN;

  // Set module-level ratio so estimateTokens() uses the correct ratio for this call
  _activeCharsPerToken = cpt;

  const chunkSizeChars = chunkSizeTokens * cpt;
  const overlapChars = overlapTokens * cpt;
  const stepChars = chunkSizeChars - overlapChars;

  // Allow table chunks to be up to 2x normal size to avoid splitting
  const maxTableChars = chunkSizeChars * 2;

  const text = extracted.text;

  if (!text.trim()) {
    logger.warn('Empty document text, no chunks generated', { documentId });
    return [];
  }

  // Pre-detect table regions
  const tables = detectTables(text);
  if (tables.length > 0) {
    logger.info('Tables detected in document', { documentId, tableCount: tables.length });
  }

  const chunks: DocumentChunk[] = [];
  let position = 0;
  let chunkIndex = 0;

  while (position < text.length) {
    // Check if we're at the start of a table — if so, include the full table
    const tableEnd = getTableEnd(position, tables);

    let endPos: number;
    if (tableEnd !== -1 && (tableEnd - position) <= maxTableChars) {
      // Keep the entire table as one chunk
      endPos = tableEnd;
    } else {
      endPos = Math.min(position + chunkSizeChars, text.length);

      // If not at the end, find a natural break point
      if (endPos < text.length) {
        // Avoid breaking inside a table
        const breakTableEnd = getTableEnd(endPos, tables);
        if (breakTableEnd !== -1 && (breakTableEnd - position) <= maxTableChars) {
          // Extend to include the full table
          endPos = breakTableEnd;
        } else {
          endPos = findNaturalBreak(text, endPos);
        }
      }
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

    // Skip overlap into tables — start from the end of the table if next position is mid-table
    const nextTableEnd = getTableEnd(nextRawPos, tables);
    if (nextTableEnd !== -1) {
      position = nextTableEnd;
    } else {
      position = findNaturalBreak(text, nextRawPos);
    }

    // Safety: ensure forward progress — if natural break or table detection
    // returned a position at or before the last chunk's start, force advance
    // to nextRawPos to avoid an infinite loop or skipping content
    if (chunks.length > 0 && position <= chunks[chunks.length - 1].startOffset) {
      logger.warn('Chunker forward progress forced', {
        documentId,
        stuckAt: position,
        lastChunkStart: chunks[chunks.length - 1].startOffset,
        forcedTo: nextRawPos,
      });
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
