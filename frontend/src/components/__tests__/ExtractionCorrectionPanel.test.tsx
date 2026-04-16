/**
 * Tests for ExtractionCorrectionPanel.
 *
 * Focuses on the diff logic (useMemo that computes correctedFields)
 * and the submit flow (quality validation, API call, success state).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ExtractionCorrectionPanel } from '../ExtractionCorrectionPanel';

const mockSubmit = vi.fn();
vi.mock('../../services/api', () => ({
  submitExtractionCorrection: (...args: unknown[]) => mockSubmit(...args),
}));

const baseProps = {
  templateId: 'cmn-oxygen',
  reportedConfidence: 'high' as const,
  filename: 'test.pdf',
  originalData: { patientName: 'John', spO2: 88, diagnosis: null },
  editedData: { patientName: 'John', spO2: 88, diagnosis: null },
};

describe('ExtractionCorrectionPanel', () => {
  beforeEach(() => {
    mockSubmit.mockReset();
    mockSubmit.mockResolvedValue({ correction: { id: 'corr-1' } });
  });

  it('shows "No edits detected" when original and edited are identical', () => {
    render(<ExtractionCorrectionPanel {...baseProps} />);
    expect(screen.getByText(/no edits detected/i)).toBeInTheDocument();
  });

  it('shows diff count when fields have been changed', () => {
    render(
      <ExtractionCorrectionPanel
        {...baseProps}
        editedData={{ patientName: 'Jane', spO2: 92, diagnosis: 'COPD' }}
      />,
    );
    expect(screen.getByText(/3 fields? changed/i)).toBeInTheDocument();
  });

  it('normalizes empty string to null — changing "" to null is not a diff', () => {
    render(
      <ExtractionCorrectionPanel
        {...baseProps}
        originalData={{ field: '' }}
        editedData={{ field: null }}
      />,
    );
    expect(screen.getByText(/no edits detected/i)).toBeInTheDocument();
  });

  it('shows field labels in the diff list when provided', () => {
    render(
      <ExtractionCorrectionPanel
        {...baseProps}
        originalData={{ spO2: 88 }}
        editedData={{ spO2: 92 }}
        fieldLabels={{ spO2: 'Oxygen Saturation' }}
      />,
    );
    expect(screen.getByText('Oxygen Saturation')).toBeInTheDocument();
  });

  it('disables the submit button until a quality is selected', () => {
    render(
      <ExtractionCorrectionPanel
        {...baseProps}
        editedData={{ patientName: 'Jane', spO2: 88, diagnosis: null }}
      />,
    );

    const btn = screen.getByText('Submit correction');
    expect(btn).toBeDisabled();
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it('submits the correction with the selected quality and shows success', async () => {
    render(
      <ExtractionCorrectionPanel
        {...baseProps}
        editedData={{ patientName: 'Jane', spO2: 88, diagnosis: null }}
      />,
    );

    // Select quality
    fireEvent.click(screen.getByText('Minor errors'));
    // Submit
    fireEvent.click(screen.getByText('Submit correction'));

    await waitFor(() => {
      expect(mockSubmit).toHaveBeenCalledTimes(1);
    });

    expect(mockSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        templateId: 'cmn-oxygen',
        reportedConfidence: 'high',
        actualQuality: 'minor_errors',
        correctedFields: [{ key: 'patientName', originalValue: 'John', correctedValue: 'Jane' }],
      }),
    );

    await waitFor(() => {
      expect(screen.getByText(/correction saved/i)).toBeInTheDocument();
    });
  });

  it('shows API error message on submit failure', async () => {
    mockSubmit.mockRejectedValueOnce(new Error('Network error'));

    render(
      <ExtractionCorrectionPanel
        {...baseProps}
        editedData={{ patientName: 'X', spO2: 88, diagnosis: null }}
      />,
    );

    fireEvent.click(screen.getByText('Correct'));
    fireEvent.click(screen.getByText('Submit correction'));

    await waitFor(() => {
      expect(screen.getByText(/network error/i)).toBeInTheDocument();
    });
  });
});
