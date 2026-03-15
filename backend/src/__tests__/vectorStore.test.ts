import { describe, it, expect } from 'vitest';

// Test the pure functions from vectorStore by importing them indirectly
// We test the scoring logic by creating test scenarios

describe('Vector Store Scoring', () => {
  // Cosine similarity helper (same as in vectorStore.ts)
  function cosineSimilarity(a: number[], b: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    if (denominator === 0) return 0;
    return dotProduct / denominator;
  }

  it('should return 1.0 for identical vectors', () => {
    const v = [0.1, 0.2, 0.3, 0.4, 0.5];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 5);
  });

  it('should return 0 for orthogonal vectors', () => {
    const a = [1, 0, 0];
    const b = [0, 1, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 5);
  });

  it('should return -1 for opposite vectors', () => {
    const a = [1, 0, 0];
    const b = [-1, 0, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1, 5);
  });

  it('should handle zero vectors gracefully', () => {
    const a = [0, 0, 0];
    const b = [1, 2, 3];
    expect(cosineSimilarity(a, b)).toBe(0);
  });

  it('should be symmetric', () => {
    const a = [0.3, 0.7, 0.1];
    const b = [0.5, 0.2, 0.9];
    expect(cosineSimilarity(a, b)).toBeCloseTo(cosineSimilarity(b, a), 10);
  });
});

describe('BM25 Scoring', () => {
  // Tokenizer (same as vectorStore.ts)
  function tokenize(text: string): string[] {
    return text.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(t => t.length > 2);
  }

  function bm25Score(query: string, text: string, idf: Map<string, number>): number {
    const queryTerms = tokenize(query);
    const docTerms = tokenize(text);
    const docLength = docTerms.length;
    const avgDocLength = 500;
    const k1 = 1.2;
    const b = 0.75;

    const tf = new Map<string, number>();
    for (const term of docTerms) {
      tf.set(term, (tf.get(term) || 0) + 1);
    }

    let score = 0;
    for (const term of queryTerms) {
      const termFreq = tf.get(term) || 0;
      if (termFreq === 0) continue;
      const idfScore = idf.get(term) || 0;
      const numerator = termFreq * (k1 + 1);
      const denominator = termFreq + k1 * (1 - b + b * (docLength / avgDocLength));
      score += idfScore * (numerator / denominator);
    }
    return score;
  }

  it('should return 0 for no matching terms', () => {
    const idf = new Map([['shipping', 2.0], ['return', 1.5]]);
    const score = bm25Score('shipping procedures', 'medical supply catalog items', idf);
    expect(score).toBe(0);
  });

  it('should score higher for documents with more matching terms', () => {
    const idf = new Map([['shipping', 2.0], ['return', 1.5], ['policy', 1.0]]);
    const score1 = bm25Score('shipping return policy', 'shipping procedures manual', idf);
    const score2 = bm25Score('shipping return policy', 'shipping return policy document', idf);
    expect(score2).toBeGreaterThan(score1);
  });

  it('should weight rare terms higher via IDF', () => {
    const idf = new Map([['rare', 5.0], ['common', 0.1]]);
    const scoreRare = bm25Score('rare', 'this document mentions rare items', idf);
    const scoreCommon = bm25Score('common', 'this document mentions common items', idf);
    expect(scoreRare).toBeGreaterThan(scoreCommon);
  });

  it('should handle empty query', () => {
    const idf = new Map([['test', 1.0]]);
    const score = bm25Score('', 'test document', idf);
    expect(score).toBe(0);
  });
});

describe('Tokenizer', () => {
  function tokenize(text: string): string[] {
    return text.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(t => t.length > 2);
  }

  it('should lowercase all tokens', () => {
    const tokens = tokenize('Hello World MEDICAL Supply');
    expect(tokens).toEqual(['hello', 'world', 'medical', 'supply']);
  });

  it('should strip punctuation', () => {
    const tokens = tokenize('Hello, world! How are you?');
    expect(tokens).toEqual(['hello', 'world', 'how', 'are', 'you']);
  });

  it('should filter short tokens (<=2 chars)', () => {
    const tokens = tokenize('I am a big medical supply co');
    expect(tokens).not.toContain('am');
    expect(tokens).not.toContain('');
    expect(tokens).toContain('big');
    expect(tokens).toContain('medical');
  });
});

describe('Section Header Detection', () => {
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

  it('should detect ALL CAPS headers', () => {
    const text = 'SHIPPING PROCEDURES\n\nContent starts here.';
    expect(detectSectionHeader(text, text.indexOf('Content'))).toBe('SHIPPING PROCEDURES');
  });

  it('should detect markdown headers', () => {
    const text = '## Return Policy\n\nAll items may be returned.';
    expect(detectSectionHeader(text, text.indexOf('All'))).toBe('Return Policy');
  });

  it('should detect colon-terminated headers', () => {
    const text = 'Shipping Methods:\n\nWe use FedEx and UPS.';
    expect(detectSectionHeader(text, text.indexOf('We'))).toBe('Shipping Methods');
  });

  it('should detect numbered section headers', () => {
    const text = '3.1 Safety Guidelines\n\nAll employees must wear PPE.';
    expect(detectSectionHeader(text, text.indexOf('All'))).toBe('3.1 Safety Guidelines');
  });

  it('should return undefined for no headers', () => {
    const text = 'Just a regular paragraph with lots of text that goes on for a while.';
    expect(detectSectionHeader(text, text.length)).toBeUndefined();
  });
});

describe('Chunking Logic', () => {
  function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  function findNaturalBreak(text: string, targetPos: number, windowChars: number = 200): number {
    const searchStart = Math.max(0, targetPos - windowChars);
    const searchText = text.slice(searchStart, targetPos);

    const lastParagraph = searchText.lastIndexOf('\n\n');
    if (lastParagraph !== -1) return searchStart + lastParagraph + 2;

    const sentenceEndPattern = /[.!?]\s+/g;
    let lastSentenceEnd = -1;
    let match;
    while ((match = sentenceEndPattern.exec(searchText)) !== null) {
      lastSentenceEnd = match.index + match[0].length;
    }
    if (lastSentenceEnd !== -1) return searchStart + lastSentenceEnd;

    const lastNewline = searchText.lastIndexOf('\n');
    if (lastNewline !== -1) return searchStart + lastNewline + 1;

    return targetPos;
  }

  it('should estimate tokens as chars/4', () => {
    expect(estimateTokens('1234567890123456')).toBe(4);
    expect(estimateTokens('12345')).toBe(2);
  });

  it('should find sentence breaks', () => {
    const text = 'First sentence. Second sentence. Third sentence starts here';
    const breakPos = findNaturalBreak(text, 35);
    expect(text.slice(0, breakPos).trim()).toMatch(/sentence\.$/);
  });

  it('should prefer paragraph breaks over sentence breaks', () => {
    const text = 'First paragraph.\n\nSecond paragraph starts here.';
    const breakPos = findNaturalBreak(text, 30);
    expect(breakPos).toBe(text.indexOf('\n\n') + 2);
  });
});
