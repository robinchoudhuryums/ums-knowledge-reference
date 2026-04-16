/**
 * Tests for RagEvalDatasetViewer.
 *
 * Covers: loading, dataset display, category filter, text search.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RagEvalDatasetViewer } from '../RagEvalDatasetViewer';

const mockGetDataset = vi.fn();
vi.mock('../../services/api', () => ({
  getEvalDataset: (...args: unknown[]) => mockGetDataset(...args),
}));

const sampleDataset = {
  version: '1.0.0',
  description: 'Gold-standard test set',
  lastUpdated: '2026-04-15',
  totalPairs: 3,
  categories: [
    { name: 'coverage', count: 2 },
    { name: 'billing', count: 1 },
  ],
  pairs: [
    { question: 'What SpO2 qualifies for oxygen?', category: 'coverage', expectedKeywords: ['SpO2', '88'], expectedCodes: ['E0424'] },
    { question: 'What docs for CPAP?', category: 'coverage', expectedKeywords: ['sleep study'], expectedCodes: ['E0601'] },
    { question: 'What is a CMN?', category: 'billing', expectedKeywords: ['certificate'], expectedCodes: [] },
  ],
};

describe('RagEvalDatasetViewer', () => {
  beforeEach(() => {
    mockGetDataset.mockReset();
  });

  it('shows dataset metadata on load', async () => {
    mockGetDataset.mockResolvedValueOnce(sampleDataset);

    render(<RagEvalDatasetViewer />);
    await waitFor(() => {
      expect(screen.getByText('v1.0.0')).toBeInTheDocument();
      expect(screen.getByText('3 pairs')).toBeInTheDocument();
    });
  });

  it('displays all pairs by default', async () => {
    mockGetDataset.mockResolvedValueOnce(sampleDataset);

    render(<RagEvalDatasetViewer />);
    await waitFor(() => {
      expect(screen.getByText('What SpO2 qualifies for oxygen?')).toBeInTheDocument();
      expect(screen.getByText('What is a CMN?')).toBeInTheDocument();
    });
  });

  it('filters by category chip', async () => {
    mockGetDataset.mockResolvedValueOnce(sampleDataset);

    render(<RagEvalDatasetViewer />);
    await waitFor(() => screen.getByText('billing (1)'));

    fireEvent.click(screen.getByText('billing (1)'));

    // Should show only the billing question
    expect(screen.getByText('What is a CMN?')).toBeInTheDocument();
    expect(screen.queryByText('What SpO2 qualifies for oxygen?')).not.toBeInTheDocument();
  });

  it('filters by text search across questions, keywords, and codes', async () => {
    mockGetDataset.mockResolvedValueOnce(sampleDataset);

    render(<RagEvalDatasetViewer />);
    await waitFor(() => screen.getByPlaceholderText(/filter by question/i));

    fireEvent.change(screen.getByPlaceholderText(/filter by question/i), {
      target: { value: 'E0601' },
    });

    expect(screen.getByText('What docs for CPAP?')).toBeInTheDocument();
    expect(screen.queryByText('What SpO2 qualifies for oxygen?')).not.toBeInTheDocument();
    expect(screen.queryByText('What is a CMN?')).not.toBeInTheDocument();
  });

  it('shows error on API failure', async () => {
    mockGetDataset.mockRejectedValueOnce(new Error('Auth failed'));

    render(<RagEvalDatasetViewer />);
    await waitFor(() => {
      expect(screen.getByText(/auth failed/i)).toBeInTheDocument();
    });
  });
});
