/**
 * Tests for A/B model testing service.
 * Covers statistical helpers (Welch's t-test, aggregate stats).
 * Adapted from Observatory QA's ab-testing statistical analysis.
 */
import { describe, it, expect } from 'vitest';
import { welchTTest, computeAggregateStats } from '../services/abTesting';

describe('A/B Model Testing', () => {
  describe('welchTTest', () => {
    it('returns not significant for identical samples', () => {
      const result = welchTTest([100, 100, 100], [100, 100, 100]);
      expect(result.tStatistic).toBe(0);
      expect(result.isSignificant).toBe(false);
      expect(result.confidenceLevel).toBe('not significant');
    });

    it('detects significant difference in clearly different samples', () => {
      // Very different distributions should produce significant result
      const result = welchTTest(
        [100, 102, 98, 101, 99, 103, 97, 100, 101, 99],
        [200, 198, 202, 201, 199, 203, 197, 200, 201, 199],
      );
      expect(result.isSignificant).toBe(true);
      expect(result.pValue).toBeLessThan(0.05);
      expect(result.tStatistic).toBeLessThan(0); // sample1 < sample2
    });

    it('returns not significant for overlapping distributions', () => {
      const result = welchTTest(
        [100, 105, 95, 110, 90],
        [102, 108, 92, 107, 93],
      );
      expect(result.isSignificant).toBe(false);
      expect(result.pValue).toBeGreaterThan(0.05);
    });

    it('handles small samples gracefully', () => {
      const result = welchTTest([1], [2]);
      expect(result.pValue).toBe(1);
      expect(result.isSignificant).toBe(false);
    });

    it('returns correct confidence levels', () => {
      // Create a very significant result
      const result = welchTTest(
        [10, 10, 10, 10, 10, 10, 10, 10, 10, 10],
        [50, 50, 50, 50, 50, 50, 50, 50, 50, 50],
      );
      expect(result.pValue).toBeLessThan(0.01);
      expect(result.confidenceLevel).toBe('99%');
    });
  });

  describe('computeAggregateStats', () => {
    it('returns null with insufficient tests', () => {
      const stats = computeAggregateStats('nonexistent-model');
      expect(stats).toBeNull();
    });
  });
});
