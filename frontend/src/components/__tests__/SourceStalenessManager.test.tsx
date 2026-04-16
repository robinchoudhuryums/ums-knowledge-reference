/**
 * Tests for SourceStalenessManager.
 *
 * Covers: empty state, stale-count display, audit-now button.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SourceStalenessManager } from '../SourceStalenessManager';

const mockListStaleness = vi.fn();
const mockRunAudit = vi.fn();
vi.mock('../../services/api', () => ({
  listSourceStaleness: (...args: unknown[]) => mockListStaleness(...args),
  runSourceStalenessAudit: (...args: unknown[]) => mockRunAudit(...args),
}));

describe('SourceStalenessManager', () => {
  beforeEach(() => {
    mockListStaleness.mockReset();
    mockRunAudit.mockReset();
  });

  it('shows empty state when no sources have cadence configured', async () => {
    mockListStaleness.mockResolvedValueOnce({ sources: [], staleCount: 0 });

    render(<SourceStalenessManager />);
    await waitFor(() => {
      expect(screen.getByText(/no sources have an expected cadence/i)).toBeInTheDocument();
    });
  });

  it('displays stale count and source table', async () => {
    mockListStaleness.mockResolvedValueOnce({
      sources: [
        {
          sourceId: 's1', name: 'LCD Oxygen', url: 'https://cms.gov/lcd-o2',
          expectedCadenceDays: 90, daysSinceLastChange: 120,
          lastContentChangeAt: '2026-01-01T00:00:00Z', isStale: true,
        },
        {
          sourceId: 's2', name: 'LCD CPAP', url: 'https://cms.gov/lcd-cpap',
          expectedCadenceDays: 90, daysSinceLastChange: 30,
          lastContentChangeAt: '2026-03-17T00:00:00Z', isStale: false,
        },
      ],
      staleCount: 1,
    });

    render(<SourceStalenessManager />);
    await waitFor(() => {
      expect(screen.getByText('LCD Oxygen')).toBeInTheDocument();
    });
    expect(screen.getByText('Stale')).toBeInTheDocument();
    expect(screen.getByText('Fresh')).toBeInTheDocument();
    // Check the summary text contains the stale count (text spans <strong> + text nodes)
    expect(document.body.textContent).toMatch(/1.*of.*2.*stale/i);
  });

  it('triggers audit and shows result on Run audit now', async () => {
    mockListStaleness.mockResolvedValue({ sources: [], staleCount: 0 });
    mockRunAudit.mockResolvedValueOnce({
      stale: [{ sourceId: 's1', name: 'LCD', alertedNow: true }],
      total: 1,
    });

    render(<SourceStalenessManager />);
    await waitFor(() => screen.getByText('Run audit now'));

    fireEvent.click(screen.getByText('Run audit now'));
    await waitFor(() => {
      expect(mockRunAudit).toHaveBeenCalledTimes(1);
      expect(screen.getByText(/1 stale source/i)).toBeInTheDocument();
      expect(screen.getByText(/1 email alert/i)).toBeInTheDocument();
    });
  });
});
