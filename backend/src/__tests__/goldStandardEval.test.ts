import { describe, it, expect } from 'vitest';
import { loadGoldStandard } from '../evalData/loader';
import { recallAtK, meanReciprocalRank, keywordCoverage } from '../services/ragMetrics';

describe('gold-standard RAG eval set', () => {
  const dataset = loadGoldStandard();

  it('loads a non-trivial dataset', () => {
    expect(dataset.version).toBeTruthy();
    expect(dataset.pairs.length).toBeGreaterThanOrEqual(10);
  });

  it('every pair has a question, category, and arrays', () => {
    for (const p of dataset.pairs) {
      expect(p.question.trim().length).toBeGreaterThan(5);
      expect(p.category).toBeTruthy();
      expect(Array.isArray(p.expectedKeywords)).toBe(true);
      expect(Array.isArray(p.expectedCodes)).toBe(true);
    }
  });

  it('covers the core categories operators query', () => {
    const cats = new Set(dataset.pairs.map(p => p.category));
    expect(cats.has('coverage')).toBe(true);
    expect(cats.has('clinical')).toBe(true);
    expect(cats.has('equipment')).toBe(true);
    expect(cats.has('billing')).toBe(true);
  });

  it('expectedCodes follow HCPCS pattern when present', () => {
    const codePattern = /^[A-Z]\d{4}$/;
    for (const p of dataset.pairs) {
      for (const code of p.expectedCodes) {
        expect(code).toMatch(codePattern);
      }
    }
  });

  it('questions are unique (no duplicate test cases)', () => {
    const seen = new Set<string>();
    for (const p of dataset.pairs) {
      const key = p.question.toLowerCase().trim();
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });
});

describe('RAG metric functions — eval-harness behavior', () => {
  it('recallAtK is 1.0 on perfect retrieval', () => {
    expect(recallAtK(['E0424', 'E1390'], ['E0424', 'E1390'])).toBe(1.0);
  });

  it('recallAtK is 0.5 on half retrieval', () => {
    expect(recallAtK(['E0424'], ['E0424', 'E1390'])).toBe(0.5);
  });

  it('recallAtK respects K cutoff', () => {
    // expected E1390 is at rank 5, but k=3 cuts it off
    expect(recallAtK(['A', 'B', 'C', 'D', 'E1390'], ['E1390'], 3)).toBe(0);
    expect(recallAtK(['A', 'B', 'C', 'D', 'E1390'], ['E1390'], 5)).toBe(1);
  });

  it('recallAtK returns 1 when no expectations (trivially satisfied)', () => {
    expect(recallAtK(['A'], [])).toBe(1.0);
  });

  it('MRR gives 1.0 when first result is relevant', () => {
    expect(meanReciprocalRank([{ retrieved: ['E0601'], expected: ['E0601'] }])).toBe(1);
  });

  it('MRR gives 0.5 when relevant result is at rank 2', () => {
    expect(meanReciprocalRank([{ retrieved: ['X', 'E0601'], expected: ['E0601'] }])).toBe(0.5);
  });

  it('MRR is 0 when relevant result is missing', () => {
    expect(meanReciprocalRank([{ retrieved: ['X', 'Y'], expected: ['E0601'] }])).toBe(0);
  });

  it('keywordCoverage is case-insensitive and substring', () => {
    expect(keywordCoverage('Patient requires FACE-to-face exam and CMN.', ['face-to-face', 'CMN'])).toBe(1);
    expect(keywordCoverage('AHI of 15 on sleep study', ['15', 'AHI'])).toBe(1);
  });

  it('keywordCoverage returns 1 on empty expectation', () => {
    expect(keywordCoverage('anything', [])).toBe(1);
  });
});
