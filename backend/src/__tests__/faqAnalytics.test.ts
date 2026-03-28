/**
 * Unit tests for the FAQ analytics service (backend/src/services/faqAnalytics.ts).
 *
 * Tests buildFaqDashboard() by mocking the queryLog dependency and verifying
 * aggregation logic: question grouping, confidence breakdown, agent activity,
 * daily counts, and sorting.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryLogEntry } from '../types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetQueryLog = vi.fn<(date: string) => Promise<QueryLogEntry[]>>();
const mockFlushQueryLog = vi.fn<() => Promise<void>>();

vi.mock('../services/queryLog', () => ({
  getQueryLog: (...args: unknown[]) => mockGetQueryLog(...(args as [string])),
  flushQueryLog: (...args: unknown[]) => mockFlushQueryLog(...(args as [])),
}));

vi.mock('../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { buildFaqDashboard } from '../services/faqAnalytics';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(overrides: Partial<QueryLogEntry> = {}): QueryLogEntry {
  return {
    timestamp: '2026-03-25T10:00:00Z',
    userId: 'user-1',
    username: 'alice',
    question: 'What is HCPCS code E1390?',
    answer: 'E1390 is for oxygen concentrators.',
    confidence: 'high',
    sourceDocuments: 'doc1.pdf',
    sourceCount: 1,
    ...overrides,
  };
}

/**
 * Set up mockGetQueryLog to return specific entries per date string.
 * Dates not in the map return an empty array.
 */
function setupQueryLog(dateEntries: Record<string, QueryLogEntry[]>): void {
  mockGetQueryLog.mockImplementation(async (date: string) => {
    return dateEntries[date] || [];
  });
  mockFlushQueryLog.mockResolvedValue(undefined);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('faqAnalytics', () => {
  beforeEach(() => {
    mockGetQueryLog.mockReset();
    mockFlushQueryLog.mockReset();
    mockFlushQueryLog.mockResolvedValue(undefined);
  });

  describe('return structure', () => {
    it('returns all expected fields with correct types', async () => {
      setupQueryLog({
        '2026-03-25': [makeEntry()],
      });

      const result = await buildFaqDashboard('2026-03-25', '2026-03-25');

      expect(result).toHaveProperty('period');
      expect(result.period).toEqual({ start: '2026-03-25', end: '2026-03-25' });
      expect(typeof result.totalQueries).toBe('number');
      expect(typeof result.uniqueAgents).toBe('number');
      expect(result.confidenceBreakdown).toHaveProperty('high');
      expect(result.confidenceBreakdown).toHaveProperty('partial');
      expect(result.confidenceBreakdown).toHaveProperty('low');
      expect(Array.isArray(result.topQuestions)).toBe(true);
      expect(Array.isArray(result.lowConfidenceQuestions)).toBe(true);
      expect(Array.isArray(result.agentActivity)).toBe(true);
      expect(Array.isArray(result.queriesByDay)).toBe(true);
    });
  });

  describe('empty date range', () => {
    it('returns zeros and empty arrays when no entries exist', async () => {
      setupQueryLog({});

      const result = await buildFaqDashboard('2026-03-20', '2026-03-22');

      expect(result.totalQueries).toBe(0);
      expect(result.uniqueAgents).toBe(0);
      expect(result.confidenceBreakdown).toEqual({ high: 0, partial: 0, low: 0 });
      expect(result.topQuestions).toEqual([]);
      expect(result.lowConfidenceQuestions).toEqual([]);
      expect(result.agentActivity).toEqual([]);
      // queriesByDay should still have entries for each date in the range, all with count 0
      expect(result.queriesByDay).toHaveLength(3);
      expect(result.queriesByDay.every(d => d.count === 0)).toBe(true);
    });

    it('handles getQueryLog throwing errors gracefully (count 0 for that day)', async () => {
      mockFlushQueryLog.mockResolvedValue(undefined);
      mockGetQueryLog.mockRejectedValue(new Error('S3 error'));

      const result = await buildFaqDashboard('2026-03-25', '2026-03-25');

      expect(result.totalQueries).toBe(0);
      expect(result.queriesByDay).toEqual([{ date: '2026-03-25', count: 0 }]);
    });
  });

  describe('question normalization and grouping', () => {
    it('groups questions by normalized form (lowercased, punctuation stripped)', async () => {
      setupQueryLog({
        '2026-03-25': [
          makeEntry({ question: 'What is HCPCS code E1390?', timestamp: '2026-03-25T09:00:00Z' }),
          makeEntry({ question: 'what is hcpcs code e1390', timestamp: '2026-03-25T10:00:00Z' }),
          makeEntry({ question: 'What is HCPCS code E1390!', timestamp: '2026-03-25T11:00:00Z' }),
        ],
      });

      const result = await buildFaqDashboard('2026-03-25', '2026-03-25');

      expect(result.topQuestions).toHaveLength(1);
      expect(result.topQuestions[0].frequency).toBe(3);
    });

    it('keeps the most recent wording as the display question', async () => {
      setupQueryLog({
        '2026-03-25': [
          makeEntry({ question: 'What is E1390?', timestamp: '2026-03-25T08:00:00Z' }),
          makeEntry({ question: 'what is e1390', timestamp: '2026-03-25T12:00:00Z' }),
        ],
      });

      const result = await buildFaqDashboard('2026-03-25', '2026-03-25');

      // The most recent timestamp entry's question should be kept
      expect(result.topQuestions[0].question).toBe('what is e1390');
      expect(result.topQuestions[0].lastAsked).toBe('2026-03-25T12:00:00Z');
    });

    it('treats questions with different words as separate groups', async () => {
      setupQueryLog({
        '2026-03-25': [
          makeEntry({ question: 'What is E1390?' }),
          makeEntry({ question: 'How do I bill for oxygen?' }),
        ],
      });

      const result = await buildFaqDashboard('2026-03-25', '2026-03-25');

      expect(result.topQuestions).toHaveLength(2);
    });
  });

  describe('confidence breakdown', () => {
    it('counts high, partial, and low confidence entries correctly', async () => {
      setupQueryLog({
        '2026-03-25': [
          makeEntry({ confidence: 'high' }),
          makeEntry({ confidence: 'high' }),
          makeEntry({ confidence: 'partial', question: 'Q2' }),
          makeEntry({ confidence: 'low', question: 'Q3' }),
          makeEntry({ confidence: 'low', question: 'Q4' }),
          makeEntry({ confidence: 'low', question: 'Q5' }),
        ],
      });

      const result = await buildFaqDashboard('2026-03-25', '2026-03-25');

      expect(result.confidenceBreakdown).toEqual({ high: 2, partial: 1, low: 3 });
    });

    it('all high confidence yields only high count', async () => {
      setupQueryLog({
        '2026-03-25': [
          makeEntry({ confidence: 'high' }),
          makeEntry({ confidence: 'high', question: 'Q2' }),
        ],
      });

      const result = await buildFaqDashboard('2026-03-25', '2026-03-25');

      expect(result.confidenceBreakdown).toEqual({ high: 2, partial: 0, low: 0 });
    });
  });

  describe('top questions sorting', () => {
    it('sorts top questions by frequency descending', async () => {
      setupQueryLog({
        '2026-03-25': [
          makeEntry({ question: 'Rare question' }),
          makeEntry({ question: 'Common question' }),
          makeEntry({ question: 'Common question' }),
          makeEntry({ question: 'Common question' }),
          makeEntry({ question: 'Medium question' }),
          makeEntry({ question: 'Medium question' }),
        ],
      });

      const result = await buildFaqDashboard('2026-03-25', '2026-03-25');

      expect(result.topQuestions[0].question).toBe('Common question');
      expect(result.topQuestions[0].frequency).toBe(3);
      expect(result.topQuestions[1].question).toBe('Medium question');
      expect(result.topQuestions[1].frequency).toBe(2);
      expect(result.topQuestions[2].question).toBe('Rare question');
      expect(result.topQuestions[2].frequency).toBe(1);
    });

    it('limits top questions to 20', async () => {
      const entries: QueryLogEntry[] = [];
      for (let i = 0; i < 25; i++) {
        entries.push(makeEntry({ question: `Question number ${i}` }));
      }
      setupQueryLog({ '2026-03-25': entries });

      const result = await buildFaqDashboard('2026-03-25', '2026-03-25');

      expect(result.topQuestions.length).toBeLessThanOrEqual(20);
    });
  });

  describe('low confidence questions', () => {
    it('includes questions where >50% of answers are low or partial', async () => {
      setupQueryLog({
        '2026-03-25': [
          // This question has 2/3 low/partial => 66% => included
          makeEntry({ question: 'Bad question', confidence: 'low' }),
          makeEntry({ question: 'Bad question', confidence: 'partial' }),
          makeEntry({ question: 'Bad question', confidence: 'high' }),
          // This question has 1/3 low/partial => 33% => excluded
          makeEntry({ question: 'Good question', confidence: 'high' }),
          makeEntry({ question: 'Good question', confidence: 'high' }),
          makeEntry({ question: 'Good question', confidence: 'low' }),
        ],
      });

      const result = await buildFaqDashboard('2026-03-25', '2026-03-25');

      expect(result.lowConfidenceQuestions).toHaveLength(1);
      expect(result.lowConfidenceQuestions[0].question).toBe('Bad question');
    });

    it('excludes questions with exactly 50% low/partial (not >50%)', async () => {
      setupQueryLog({
        '2026-03-25': [
          makeEntry({ question: 'Borderline', confidence: 'low' }),
          makeEntry({ question: 'Borderline', confidence: 'high' }),
        ],
      });

      const result = await buildFaqDashboard('2026-03-25', '2026-03-25');

      expect(result.lowConfidenceQuestions).toHaveLength(0);
    });

    it('limits low confidence questions to 15', async () => {
      const entries: QueryLogEntry[] = [];
      for (let i = 0; i < 20; i++) {
        entries.push(makeEntry({ question: `Low conf question ${i}`, confidence: 'low' }));
      }
      setupQueryLog({ '2026-03-25': entries });

      const result = await buildFaqDashboard('2026-03-25', '2026-03-25');

      expect(result.lowConfidenceQuestions.length).toBeLessThanOrEqual(15);
    });
  });

  describe('avgConfidence calculation', () => {
    it('returns "high" when >=70% of confidences are high', async () => {
      setupQueryLog({
        '2026-03-25': [
          makeEntry({ question: 'Q', confidence: 'high' }),
          makeEntry({ question: 'Q', confidence: 'high' }),
          makeEntry({ question: 'Q', confidence: 'high' }),
          makeEntry({ question: 'Q', confidence: 'low' }),
        ],
      });

      const result = await buildFaqDashboard('2026-03-25', '2026-03-25');

      // 3/4 = 75% high => "high"
      expect(result.topQuestions[0].avgConfidence).toBe('high');
    });

    it('returns "partial" when 30-69% of confidences are high', async () => {
      setupQueryLog({
        '2026-03-25': [
          makeEntry({ question: 'Q', confidence: 'high' }),
          makeEntry({ question: 'Q', confidence: 'low' }),
          makeEntry({ question: 'Q', confidence: 'low' }),
        ],
      });

      const result = await buildFaqDashboard('2026-03-25', '2026-03-25');

      // 1/3 = 33% high => "partial"
      expect(result.topQuestions[0].avgConfidence).toBe('partial');
    });

    it('returns "low" when <30% of confidences are high', async () => {
      setupQueryLog({
        '2026-03-25': [
          makeEntry({ question: 'Q', confidence: 'low' }),
          makeEntry({ question: 'Q', confidence: 'low' }),
          makeEntry({ question: 'Q', confidence: 'low' }),
          makeEntry({ question: 'Q', confidence: 'partial' }),
        ],
      });

      const result = await buildFaqDashboard('2026-03-25', '2026-03-25');

      // 0/4 = 0% high => "low"
      expect(result.topQuestions[0].avgConfidence).toBe('low');
    });
  });

  describe('agent activity', () => {
    it('tracks per-username query counts', async () => {
      setupQueryLog({
        '2026-03-25': [
          makeEntry({ username: 'alice' }),
          makeEntry({ username: 'alice', question: 'Q2' }),
          makeEntry({ username: 'alice', question: 'Q3' }),
          makeEntry({ username: 'bob', question: 'Q4' }),
        ],
      });

      const result = await buildFaqDashboard('2026-03-25', '2026-03-25');

      expect(result.uniqueAgents).toBe(2);
      expect(result.agentActivity).toHaveLength(2);
      // Sorted by queryCount descending
      expect(result.agentActivity[0].username).toBe('alice');
      expect(result.agentActivity[0].queryCount).toBe(3);
      expect(result.agentActivity[1].username).toBe('bob');
      expect(result.agentActivity[1].queryCount).toBe(1);
    });

    it('calculates per-agent avgConfidence', async () => {
      setupQueryLog({
        '2026-03-25': [
          makeEntry({ username: 'alice', confidence: 'high' }),
          makeEntry({ username: 'alice', confidence: 'high', question: 'Q2' }),
          makeEntry({ username: 'alice', confidence: 'high', question: 'Q3' }),
          makeEntry({ username: 'bob', confidence: 'low', question: 'Q4' }),
          makeEntry({ username: 'bob', confidence: 'low', question: 'Q5' }),
        ],
      });

      const result = await buildFaqDashboard('2026-03-25', '2026-03-25');

      const alice = result.agentActivity.find(a => a.username === 'alice');
      const bob = result.agentActivity.find(a => a.username === 'bob');
      expect(alice?.avgConfidence).toBe('high');
      expect(bob?.avgConfidence).toBe('low');
    });

    it('collects agents across grouped questions', async () => {
      setupQueryLog({
        '2026-03-25': [
          makeEntry({ username: 'alice', question: 'Same question' }),
          makeEntry({ username: 'bob', question: 'Same question' }),
        ],
      });

      const result = await buildFaqDashboard('2026-03-25', '2026-03-25');

      expect(result.topQuestions[0].agents).toContain('alice');
      expect(result.topQuestions[0].agents).toContain('bob');
      expect(result.topQuestions[0].agents).toHaveLength(2);
    });
  });

  describe('daily query counts', () => {
    it('aggregates counts per day across a multi-day range', async () => {
      setupQueryLog({
        '2026-03-24': [makeEntry(), makeEntry({ question: 'Q2' })],
        '2026-03-25': [makeEntry()],
        '2026-03-26': [],
      });

      const result = await buildFaqDashboard('2026-03-24', '2026-03-26');

      expect(result.queriesByDay).toHaveLength(3);
      expect(result.queriesByDay[0]).toEqual({ date: '2026-03-24', count: 2 });
      expect(result.queriesByDay[1]).toEqual({ date: '2026-03-25', count: 1 });
      expect(result.queriesByDay[2]).toEqual({ date: '2026-03-26', count: 0 });
      expect(result.totalQueries).toBe(3);
    });

    it('includes all dates in the range even if some have no data', async () => {
      setupQueryLog({
        '2026-03-20': [makeEntry()],
      });

      const result = await buildFaqDashboard('2026-03-20', '2026-03-23');

      expect(result.queriesByDay).toHaveLength(4);
      const dates = result.queriesByDay.map(d => d.date);
      expect(dates).toEqual(['2026-03-20', '2026-03-21', '2026-03-22', '2026-03-23']);
    });
  });

  describe('flushQueryLog', () => {
    it('calls flushQueryLog before reading entries', async () => {
      setupQueryLog({});

      await buildFaqDashboard('2026-03-25', '2026-03-25');

      expect(mockFlushQueryLog).toHaveBeenCalledTimes(1);
      // flushQueryLog should be called before any getQueryLog call
      const flushOrder = mockFlushQueryLog.mock.invocationCallOrder[0];
      if (mockGetQueryLog.mock.invocationCallOrder.length > 0) {
        const firstGetOrder = mockGetQueryLog.mock.invocationCallOrder[0];
        expect(flushOrder).toBeLessThan(firstGetOrder);
      }
    });
  });
});
