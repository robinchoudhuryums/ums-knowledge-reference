import { Component, ReactNode } from 'react';

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

  render() {
    if (this.state.hasError) {
      return (
        <div style={styles.container}>
          <div style={styles.icon}>!</div>
          <h3 style={styles.title}>Something went wrong</h3>
          <p style={styles.message}>
            {this.props.fallbackMessage || 'An unexpected error occurred. Please try refreshing the page.'}
          </p>
          {this.state.error && (
            <pre style={styles.details}>{this.state.error.message}</pre>
          )}
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={styles.retryButton}
          >
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '48px 24px',
    textAlign: 'center',
  },
  icon: {
    width: '48px',
    height: '48px',
    borderRadius: '50%',
    background: '#fef2f2',
    color: '#dc2626',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '24px',
    fontWeight: 700,
    marginBottom: '16px',
    border: '2px solid #fecaca',
  },
  title: { margin: '0 0 8px', fontSize: '18px', fontWeight: 700, color: '#0D2137' },
  message: { margin: '0 0 16px', fontSize: '14px', color: '#6B8299', maxWidth: '400px', lineHeight: '1.5' },
  details: {
    margin: '0 0 16px',
    padding: '12px 16px',
    background: '#F7FAFD',
    borderRadius: '8px',
    fontSize: '12px',
    color: '#6B8299',
    maxWidth: '500px',
    overflow: 'auto',
    border: '1px solid #E8EFF5',
  },
  retryButton: {
    padding: '8px 20px',
    background: 'linear-gradient(135deg, #1B6FC9, #1565C0)',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 500,
  },
};
