import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ToastProvider, useToast } from '../Toast';

// Helper component that triggers toasts
function ToastTrigger({ type, message }: { type?: 'success' | 'error' | 'info' | 'warning'; message?: string }) {
  const { addToast } = useToast();
  return <button onClick={() => addToast(message || 'Test notification', type || 'info', 5000)}>Show Toast</button>;
}

describe('Toast', () => {
  it('renders toast message when triggered', () => {
    render(
      <ToastProvider>
        <ToastTrigger message="Upload complete" type="success" />
      </ToastProvider>
    );

    fireEvent.click(screen.getByText('Show Toast'));
    expect(screen.getByText('Upload complete')).toBeInTheDocument();
  });

  it('renders with role="alert" for accessibility', () => {
    render(
      <ToastProvider>
        <ToastTrigger />
      </ToastProvider>
    );

    fireEvent.click(screen.getByText('Show Toast'));
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('has aria-live="polite" container', () => {
    const { container } = render(
      <ToastProvider>
        <ToastTrigger />
      </ToastProvider>
    );

    const liveRegion = container.querySelector('[aria-live="polite"]');
    expect(liveRegion).toBeInTheDocument();
  });

  it('dismiss button removes the toast', () => {
    render(
      <ToastProvider>
        <ToastTrigger message="Dismissable toast" />
      </ToastProvider>
    );

    fireEvent.click(screen.getByText('Show Toast'));
    expect(screen.getByText('Dismissable toast')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Dismiss notification'));
    expect(screen.queryByText('Dismissable toast')).not.toBeInTheDocument();
  });

  it('auto-removes toast after duration', () => {
    vi.useFakeTimers();

    render(
      <ToastProvider>
        <ToastTrigger message="Auto-remove" />
      </ToastProvider>
    );

    fireEvent.click(screen.getByText('Show Toast'));
    expect(screen.getByText('Auto-remove')).toBeInTheDocument();

    // Advance past the 5000ms duration
    act(() => { vi.advanceTimersByTime(6000); });

    expect(screen.queryByText('Auto-remove')).not.toBeInTheDocument();

    vi.useRealTimers();
  });

  it('supports multiple toasts simultaneously', () => {
    function MultiTrigger() {
      const { addToast } = useToast();
      return (
        <>
          <button onClick={() => addToast('First toast', 'info')}>Toast 1</button>
          <button onClick={() => addToast('Second toast', 'error')}>Toast 2</button>
        </>
      );
    }

    render(
      <ToastProvider>
        <MultiTrigger />
      </ToastProvider>
    );

    fireEvent.click(screen.getByText('Toast 1'));
    fireEvent.click(screen.getByText('Toast 2'));

    expect(screen.getByText('First toast')).toBeInTheDocument();
    expect(screen.getByText('Second toast')).toBeInTheDocument();
  });
});
