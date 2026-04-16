/**
 * Tests for FormDraftBanner.
 *
 * Covers: save status display, start-over confirm, resume dropdown.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FormDraftBanner } from '../FormDraftBanner';

const mockListDrafts = vi.fn();
vi.mock('../../services/api', () => ({
  listFormDrafts: (...args: unknown[]) => mockListDrafts(...args),
}));

const baseBannerProps = {
  formType: 'ppd' as const,
  currentDraftId: null,
  lastSavedAt: null,
  saving: false,
  error: null,
  onResume: vi.fn(),
  onStartOver: vi.fn(),
  resume: vi.fn(),
};

describe('FormDraftBanner', () => {
  it('shows "Not saved yet" when no draft is attached', () => {
    mockListDrafts.mockResolvedValue({ drafts: [], total: 0 });

    render(<FormDraftBanner {...baseBannerProps} />);
    expect(screen.getByText(/not saved yet/i)).toBeInTheDocument();
  });

  it('shows "Saving draft…" while save is in progress', () => {
    mockListDrafts.mockResolvedValue({ drafts: [], total: 0 });

    render(<FormDraftBanner {...baseBannerProps} saving={true} />);
    expect(screen.getByText(/saving draft/i)).toBeInTheDocument();
  });

  it('shows "Draft saved" with timeAgo when lastSavedAt is set', () => {
    mockListDrafts.mockResolvedValue({ drafts: [], total: 0 });

    render(
      <FormDraftBanner
        {...baseBannerProps}
        currentDraftId="d-1"
        lastSavedAt={new Date()}
      />,
    );
    expect(screen.getByText(/draft saved/i)).toBeInTheDocument();
  });

  it('shows Start over button when a draft is attached, confirms before calling onStartOver', async () => {
    mockListDrafts.mockResolvedValue({ drafts: [], total: 0 });
    const onStartOver = vi.fn().mockResolvedValue(undefined);
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(
      <FormDraftBanner
        {...baseBannerProps}
        currentDraftId="d-1"
        onStartOver={onStartOver}
      />,
    );

    fireEvent.click(screen.getByText('Start over'));
    await waitFor(() => {
      expect(confirmSpy).toHaveBeenCalled();
      expect(onStartOver).toHaveBeenCalled();
    });

    confirmSpy.mockRestore();
  });

  it('does NOT call onStartOver if confirm is cancelled', async () => {
    mockListDrafts.mockResolvedValue({ drafts: [], total: 0 });
    const onStartOver = vi.fn();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(
      <FormDraftBanner
        {...baseBannerProps}
        currentDraftId="d-1"
        onStartOver={onStartOver}
      />,
    );

    fireEvent.click(screen.getByText('Start over'));
    expect(onStartOver).not.toHaveBeenCalled();

    confirmSpy.mockRestore();
  });

  it('shows Resume dropdown when other drafts exist', async () => {
    mockListDrafts.mockResolvedValue({
      drafts: [
        { id: 'd-other', formType: 'ppd', label: 'Jane Doe', completionPercent: 60, createdBy: 'alice', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      ],
      total: 1,
    });

    render(<FormDraftBanner {...baseBannerProps} />);

    await waitFor(() => {
      expect(screen.getByText(/resume draft/i)).toBeInTheDocument();
    });
  });

  it('shows error bar when error is set', () => {
    mockListDrafts.mockResolvedValue({ drafts: [], total: 0 });

    render(<FormDraftBanner {...baseBannerProps} error="Save failed" />);
    expect(screen.getByText('Save failed')).toBeInTheDocument();
  });

  it('displays the current label chip when provided', () => {
    mockListDrafts.mockResolvedValue({ drafts: [], total: 0 });

    render(
      <FormDraftBanner
        {...baseBannerProps}
        currentLabel="John Smith / Trx-5678"
      />,
    );
    expect(screen.getByText('John Smith / Trx-5678')).toBeInTheDocument();
  });
});
