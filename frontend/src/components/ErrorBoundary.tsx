import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { reportError } from '../services/errorReporting';
import { Button } from '@/components/ui/button';

interface Props {
  children: ReactNode;
  fallbackMessage?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, _errorInfo: ErrorInfo): void {
    reportError(error, 'ErrorBoundary');
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
          <div
            aria-hidden="true"
            className="mb-4 flex h-12 w-12 items-center justify-center rounded-sm border"
            style={{
              background: 'var(--warm-red-soft)',
              borderColor: 'var(--warm-red)',
              color: 'var(--warm-red)',
            }}
          >
            <ExclamationTriangleIcon className="h-6 w-6" />
          </div>
          <h3 className="mb-2 font-display text-[18px] font-medium text-foreground">
            Something went wrong
          </h3>
          <p className="mb-4 max-w-[420px] text-sm leading-relaxed text-muted-foreground">
            {this.props.fallbackMessage ||
              'An unexpected error occurred. Please try refreshing the page.'}
          </p>
          {this.state.error && (
            <pre
              className="mb-4 max-w-[520px] overflow-auto rounded-sm border border-border bg-muted px-4 py-3 text-left font-mono text-[12px] text-muted-foreground"
            >
              {this.state.error.message}
            </pre>
          )}
          <Button onClick={() => this.setState({ hasError: false, error: null })}>
            Try again
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}
