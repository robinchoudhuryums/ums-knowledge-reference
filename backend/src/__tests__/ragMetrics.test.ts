/**
 * Tests for RAG retrieval metrics (recall@K, MRR, keyword coverage).
 */
import { describe, it, expect } from 'vitest';
import { recallAtK, meanReciprocalRank, keywordCoverage, formatEvalReport } from '../services/ragMetrics';

describe('recallAtK', () => {
  it('returns 1.0 when all expected items are found', () => {
    expect(recallAtK(['E0601', 'E0424', 'K0001'], ['E0601', 'E0424'])).toBe(1.0);
  });

  it('returns 0.5 when half the expected items are found', () => {
    expect(recallAtK(['E0601', 'K0001'], ['E0601', 'E0424'])).toBe(0.5);
  });

  it('returns 0.0 when no expected items are found', () => {
    expect(recallAtK(['K0001', 'K0003'], ['E0601'])).toBe(0.0);
  });

  it('respects the K parameter', () => {
    // E0424 is at position 3 (index 2), outside top-2
    expect(recallAtK(['K0001', 'K0003', 'E0424'], ['E0424'], 2)).toBe(0.0);
    expect(recallAtK(['K0001', 'K0003', 'E0424'], ['E0424'], 3)).toBe(1.0);
  });

  it('is case-insensitive', () => {
    expect(recallAtK(['e0601'], ['E0601'])).toBe(1.0);
  });

  it('returns 1.0 for empty expected set', () => {
    expect(recallAtK(['anything'], [])).toBe(1.0);
  });
});

describe('meanReciprocalRank', () => {
  it('returns 1.0 when relevant item is always first', () => {
    const mrr = meanReciprocalRank([
      { retrieved: ['E0601', 'K0001'], expected: ['E0601'] },
      { retrieved: ['E0424', 'K0003'], expected: ['E0424'] },
    ]);
    expect(mrr).toBe(1.0);
  });

  it('returns 0.5 when relevant item is always second', () => {
    const mrr = meanReciprocalRank([
      { retrieved: ['K0001', 'E0601'], expected: ['E0601'] },
      { retrieved: ['K0003', 'E0424'], expected: ['E0424'] },
    ]);
    expect(mrr).toBe(0.5);
  });

  it('returns 0.0 when nothing is found', () => {
    const mrr = meanReciprocalRank([
      { retrieved: ['K0001'], expected: ['E0601'] },
    ]);
    expect(mrr).toBe(0.0);
  });

  it('averages correctly across queries', () => {
    const mrr = meanReciprocalRank([
      { retrieved: ['E0601'], expected: ['E0601'] },  // RR = 1.0
      { retrieved: ['K0001', 'E0424'], expected: ['E0424'] },  // RR = 0.5
    ]);
    expect(mrr).toBe(0.75);
  });

  it('returns 0 for empty input', () => {
    expect(meanReciprocalRank([])).toBe(0);
  });
});

describe('keywordCoverage', () => {
  it('returns 1.0 when all keywords are present', () => {
    expect(keywordCoverage('CPAP coverage requires sleep study with AHI score', ['cpap', 'sleep study', 'AHI'])).toBe(1.0);
  });

  it('returns 0.0 when no keywords are present', () => {
    expect(keywordCoverage('unrelated text about widgets', ['cpap', 'oxygen'])).toBe(0.0);
  });

  it('handles partial coverage', () => {
    expect(keywordCoverage('CPAP device for home use', ['cpap', 'oxygen', 'nebulizer'])).toBeCloseTo(1 / 3);
  });

  it('is case-insensitive', () => {
    expect(keywordCoverage('cpap DEVICE', ['CPAP', 'device'])).toBe(1.0);
  });

  it('returns 1.0 for empty keyword list', () => {
    expect(keywordCoverage('anything', [])).toBe(1.0);
  });
});

describe('formatEvalReport', () => {
  it('produces a readable report', () => {
    const report = formatEvalReport([
      {
        category: 'hcpcs',
        question: 'What is E0601?',
        recall: 1.0,
        keywordCov: 0.8,
        retrievedCodes: ['E0601'],
        expectedCodes: ['E0601'],
      },
      {
        category: 'coverage',
        question: 'What are the oxygen requirements?',
        recall: 0.5,
        keywordCov: 0.6,
        retrievedCodes: ['E0424'],
        expectedCodes: ['E0424', 'E1390'],
      },
    ]);

    expect(report).toContain('HCPCS');
    expect(report).toContain('COVERAGE');
    expect(report).toContain('What is E0601?');
    expect(report).toContain('Missing: E1390');
    expect(report).toContain('Average Recall');
  });
});
