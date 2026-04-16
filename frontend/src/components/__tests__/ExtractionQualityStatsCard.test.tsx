/**
 * Tests for ExtractionQualityStatsCard.
 *
 * Covers: loading state, empty state, stat display with accuracy/overconfidence.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ExtractionQualityStatsCard } from '../ExtractionQualityStatsCard';

const mockGetStats = vi.fn();
vi.mock('../../services/api', () => ({
  getExtractionQualityStats: (...args: unknown[]) => mockGetStats(...args),
}));

describe('ExtractionQualityStatsCard', () => {
  beforeEach(() => {
    mockGetStats.mockReset();
  });

  it('shows empty-state message when no corrections exist', async () => {
    mockGetStats.mockResolvedValueOnce({
      stats: {
        total: 0,
        byActualQuality: { correct: 0, minor_errors: 0, major_errors: 0, unusable: 0 },
        accuracyRate: 0,
        overconfidenceRate: 0,
        totalFieldsCorrected: 0,
      },
    });

    render(<ExtractionQualityStatsCard />);
    await waitFor(() => {
      expect(screen.getByText(/no reviewer feedback yet/i)).toBeInTheDocument();
    });
  });

  it('displays accuracy and overconfidence when data exists', async () => {
    mockGetStats.mockResolvedValueOnce({
      stats: {
        total: 10,
        byActualQuality: { correct: 8, minor_errors: 1, major_errors: 1, unusable: 0 },
        accuracyRate: 0.8,
        overconfidenceRate: 0.1,
        totalFieldsCorrected: 5,
      },
    });

    render(<ExtractionQualityStatsCard />);
    await waitFor(() => {
      expect(screen.getByText('80%')).toBeInTheDocument();
      expect(screen.getByText('10%')).toBeInTheDocument();
      expect(screen.getByText('5')).toBeInTheDocument();
    });
  });

  it('shows error message on API failure', async () => {
    mockGetStats.mockRejectedValueOnce(new Error('Server down'));

    render(<ExtractionQualityStatsCard />);
    await waitFor(() => {
      expect(screen.getByText(/server down/i)).toBeInTheDocument();
    });
  });
});
