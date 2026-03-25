import { useState, FormEvent } from 'react';

interface Props {
  onLogin: (username: string, password: string) => Promise<void>;
}

export function LoginForm({ onLogin }: Props) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await onLogin(username, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.container} className="hex-pattern-strong">
      <div style={styles.card}>
        <div style={styles.logoMark}>+</div>
        <h1 style={styles.title}>UMS Knowledge Base</h1>
        <p style={styles.subtitle}>Sign in to access the knowledge base</p>
        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.inputGroup}>
            <label style={styles.label}>Username</label>
            <input
              type="text"
              placeholder="Enter your username"
              value={username}
              onChange={e => setUsername(e.target.value)}
              onBlur={() => setTouched(prev => ({ ...prev, username: true }))}
              style={styles.input}
              required
            />
            {touched.username && !username && (
              <div style={{ fontSize: '12px', color: '#dc2626', marginTop: '4px' }}>Username is required</div>
            )}
          </div>
          <div style={styles.inputGroup}>
            <label style={styles.label}>Password</label>
            <input
              type="password"
              placeholder="Enter your password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onBlur={() => setTouched(prev => ({ ...prev, password: true }))}
              style={styles.input}
              required
            />
            {touched.password && !password && (
              <div style={{ fontSize: '12px', color: '#dc2626', marginTop: '4px' }}>Password is required</div>
            )}
          </div>
          {error && <div style={styles.error}>{error}</div>}
          <button type="submit" disabled={loading} style={styles.button}>
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: '100vh',
    background: 'linear-gradient(160deg, #E3F2FD 0%, #BBDEFB 40%, #90CAF9 100%)',
  },
  card: {
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    backdropFilter: 'blur(16px)',
    borderRadius: '20px',
    padding: '48px 40px',
    boxShadow: '0 8px 40px rgba(21, 101, 192, 0.15), 0 0 0 1px rgba(255,255,255,0.6) inset',
    width: '100%',
    maxWidth: '420px',
  },
  logoMark: {
    width: '52px',
    height: '52px',
    borderRadius: '14px',
    background: 'linear-gradient(135deg, #1B6FC9, #42A5F5)',
    color: 'white',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '24px',
    fontWeight: 700,
    margin: '0 auto 16px',
  },
  title: {
    margin: '0 0 6px',
    fontSize: '22px',
    fontWeight: 700,
    color: '#0D2137',
    textAlign: 'center' as const,
    letterSpacing: '-0.3px',
  },
  subtitle: {
    margin: '0 0 28px',
    color: '#6B8299',
    textAlign: 'center' as const,
    fontSize: '14px',
  },
  form: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '16px',
  },
  inputGroup: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '6px',
  },
  label: {
    fontSize: '13px',
    fontWeight: 500,
    color: '#4A6274',
  },
  input: {
    padding: '11px 14px',
    border: '1px solid #D6E4F0',
    borderRadius: '10px',
    fontSize: '14px',
    backgroundColor: '#F7FAFD',
    transition: 'all 0.15s ease',
  },
  button: {
    padding: '12px',
    background: 'linear-gradient(135deg, #1B6FC9, #1565C0)',
    color: 'white',
    border: 'none',
    borderRadius: '10px',
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'pointer',
    marginTop: '4px',
    boxShadow: '0 2px 8px rgba(27, 111, 201, 0.3)',
    letterSpacing: '0.2px',
  },
  error: {
    color: '#dc2626',
    fontSize: '13px',
    textAlign: 'center' as const,
    padding: '8px 12px',
    background: '#fef2f2',
    borderRadius: '8px',
    border: '1px solid #fecaca',
  },
};
