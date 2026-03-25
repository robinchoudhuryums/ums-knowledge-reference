import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { chunkDocument } from '../services/chunker';
import { ExtractedText } from '../types';

describe('chunkDocument', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns no chunks for empty text', () => {
    const extracted: ExtractedText = { text: '   ' };
    const chunks = chunkDocument('doc-1', extracted);
    expect(chunks).toHaveLength(0);
  });

  it('produces a single chunk for short text', () => {
    const shortText = 'This is a short document about oxygen concentrators.';
    const extracted: ExtractedText = { text: shortText };
    const chunks = chunkDocument('doc-2', extracted);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe(shortText);
    expect(chunks[0].documentId).toBe('doc-2');
    expect(chunks[0].chunkIndex).toBe(0);
  });

  it('produces multiple chunks with overlap for long text', () => {
    // Default chunk size is 500 tokens * 4 chars = 2000 chars
    // Default overlap is 100 tokens * 4 chars = 400 chars
    // Step = 2000 - 400 = 1600 chars
    // Generate text well over 2000 chars
    const sentence = 'This is a sentence about medical equipment and supplies. ';
    const longText = sentence.repeat(80); // ~4480 chars
    const extracted: ExtractedText = { text: longText };
    const chunks = chunkDocument('doc-3', extracted);

    expect(chunks.length).toBeGreaterThan(1);

    // Check that chunks overlap: the start of chunk N+1 should be before the end of chunk N
    if (chunks.length >= 2) {
      expect(chunks[1].startOffset).toBeLessThan(chunks[0].endOffset);
    }
  });

  it('sets correct documentId and sequential chunkIndex', () => {
    const sentence = 'A sentence about patient care and DME equipment ordering. ';
    const longText = sentence.repeat(80);
    const extracted: ExtractedText = { text: longText };
    const chunks = chunkDocument('my-doc-id', extracted);

    expect(chunks.length).toBeGreaterThan(1);
    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i].documentId).toBe('my-doc-id');
      expect(chunks[i].chunkIndex).toBe(i);
    }
  });

  it('estimates token count at roughly 4 chars per token', () => {
    const text = 'abcd'.repeat(100); // 400 chars => ~100 tokens
    const extracted: ExtractedText = { text };
    const chunks = chunkDocument('doc-5', extracted);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].tokenCount).toBe(100);
  });

  it('detects markdown section headers', () => {
    // detectSectionHeader iterates lines backwards from the chunk start, but stops
    // if it encounters a line longer than 80 chars. Use short lines after the header
    // so the function can reach it.
    // With chunkSize=200 tokens (800 chars), overlap=50 (200 chars), step=600 chars.
    // Chunk 2 starts at ~600. Place header within 500-char lookback, with short lines after.
    const filler = 'Some filler sentence about DME.\n'; // 32 chars per line
    const before = filler.repeat(15); // ~480 chars
    const after = filler.repeat(30);  // ~960 chars => forces a second chunk
    const text = before + '## Equipment Requirements\n' + after;
    const extracted: ExtractedText = { text };
    const chunks = chunkDocument('doc-6', extracted, { chunkSizeTokens: 200, overlapTokens: 50 });

    const headerChunks = chunks.filter(c => c.sectionHeader === 'Equipment Requirements');
    expect(headerChunks.length).toBeGreaterThanOrEqual(1);
  });

  it('detects ALL CAPS section headers', () => {
    const filler = 'Some filler sentence about DME.\n';
    const before = filler.repeat(15);
    const after = filler.repeat(30);
    const text = before + 'MEDICAL NECESSITY\n' + after;
    const extracted: ExtractedText = { text };
    const chunks = chunkDocument('doc-7', extracted, { chunkSizeTokens: 200, overlapTokens: 50 });

    const headerChunks = chunks.filter(c => c.sectionHeader === 'MEDICAL NECESSITY');
    expect(headerChunks.length).toBeGreaterThanOrEqual(1);
  });

  it('tracks page numbers using pageBreaks array', () => {
    // pageBreaks = [100, 200] means page 2 starts at offset 100, page 3 at 200
    const text = 'A'.repeat(100) + 'B'.repeat(100) + 'C'.repeat(100);
    const extracted: ExtractedText = { text, pageBreaks: [100, 200] };
    const chunks = chunkDocument('doc-8', extracted);

    // Single chunk starting at offset 0 should be page 1
    expect(chunks).toHaveLength(1);
    expect(chunks[0].pageNumber).toBe(1);

    // Now make text long enough for multiple chunks across page breaks
    const longPage1 = 'Word on page one. '.repeat(120); // ~2160 chars
    const longPage2 = 'Word on page two. '.repeat(120);
    const combined = longPage1 + longPage2;
    const extracted2: ExtractedText = {
      text: combined,
      pageBreaks: [longPage1.length],
    };
    const chunks2 = chunkDocument('doc-8b', extracted2);

    expect(chunks2.length).toBeGreaterThan(1);
    expect(chunks2[0].pageNumber).toBe(1);
    // Last chunk should start on page 2
    const lastChunk = chunks2[chunks2.length - 1];
    expect(lastChunk.pageNumber).toBe(2);
  });
});
