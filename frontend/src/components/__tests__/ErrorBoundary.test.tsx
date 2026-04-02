import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorBoundary } from '../ErrorBoundary';

// Mock error reporting to prevent actual network calls
vi.mock('../../services/errorReporting', () => ({
  reportError: vi.fn(),
}));

// Suppress console.error from React's error boundary logging during tests
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

function ThrowingComponent({ error }: { error: Error }): React.ReactNode {
  throw error;
}

function GoodComponent() {
  return <div>Content works</div>;
}

describe('ErrorBoundary', () => {
  it('renders children when no error', () => {
    render(
      <ErrorBoundary>
        <GoodComponent />
      </ErrorBoundary>
    );
    expect(screen.getByText('Content works')).toBeInTheDocument();
  });

  it('renders fallback UI when child throws', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent error={new Error('Test crash')} />
      </ErrorBoundary>
    );
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText('Test crash')).toBeInTheDocument();
  });

  it('renders custom fallback message when provided', () => {
    render(
      <ErrorBoundary fallbackMessage="Dashboard failed to load.">
        <ThrowingComponent error={new Error('Widget error')} />
      </ErrorBoundary>
    );
    expect(screen.getByText('Dashboard failed to load.')).toBeInTheDocument();
  });

  it('renders default message when no custom fallback', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent error={new Error('boom')} />
      </ErrorBoundary>
    );
    expect(screen.getByText(/unexpected error occurred/)).toBeInTheDocument();
  });

  it('recovers when Try Again is clicked', () => {
    // We need a component that throws conditionally
    let shouldThrow = true;
    function ConditionalThrow() {
      if (shouldThrow) throw new Error('temporary');
      return <div>Recovered</div>;
    }

    const { rerender } = render(
      <ErrorBoundary>
        <ConditionalThrow />
      </ErrorBoundary>
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();

    // Fix the error condition, then click retry
    shouldThrow = false;
    fireEvent.click(screen.getByText('Try Again'));

    rerender(
      <ErrorBoundary>
        <ConditionalThrow />
      </ErrorBoundary>
    );

    expect(screen.getByText('Recovered')).toBeInTheDocument();
  });

  it('reports error via errorReporting service', async () => {
    const { reportError } = await import('../../services/errorReporting');

    render(
      <ErrorBoundary>
        <ThrowingComponent error={new Error('reported error')} />
      </ErrorBoundary>
    );

    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'reported error' }),
      'ErrorBoundary'
    );
  });
});
