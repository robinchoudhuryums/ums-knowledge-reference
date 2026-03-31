import { useState, FormEvent } from 'react';
import { Brain } from 'lucide-react';

interface Props {
  onLogin: (username: string, password: string, mfaCode?: string) => Promise<void>;
  mfaRequired?: boolean;
  onMfaSubmit?: (code: string) => Promise<void>;
}

export function LoginForm({ onLogin, mfaRequired, onMfaSubmit }: Props) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (mfaRequired && onMfaSubmit) {
        await onMfaSubmit(mfaCode);
      } else {
        await onLogin(username, password);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.container} className="hex-pattern-strong">
      <div style={styles.card}>
        <div style={styles.logoMark}><Brain size={28} /></div>
        <h1 style={styles.title}>UMS Knowledge Base</h1>
        <p style={styles.subtitle}>
          {mfaRequired ? 'Enter the code from your authenticator app' : 'Sign in to access the knowledge base'}
        </p>
        <form onSubmit={handleSubmit} style={styles.form}>
          {!mfaRequired ? (
            <>
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
                  <div style={{ fontSize: '12px', color: 'var(--ums-error-text)', marginTop: '4px' }}>Username is required</div>
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
                  <div style={{ fontSize: '12px', color: 'var(--ums-error-text)', marginTop: '4px' }}>Password is required</div>
                )}
              </div>
            </>
          ) : (
            <div style={styles.inputGroup}>
              <label style={styles.label}>Authenticator Code</label>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                placeholder="6-digit code"
                value={mfaCode}
                onChange={e => setMfaCode(e.target.value.replace(/\D/g, ''))}
                style={{ ...styles.input, textAlign: 'center', fontSize: '24px', letterSpacing: '8px', fontWeight: 600 }}
                autoFocus
                required
              />
            </div>
          )}
          {error && (
            <div style={styles.error} role="alert">
              <strong style={{ display: 'block', marginBottom: '2px' }}>
                {error.includes('locked') ? 'Account Locked' : error.includes('MFA') ? 'Invalid Code' : 'Login Failed'}
              </strong>
              {error}
            </div>
          )}
          <button type="submit" disabled={loading} style={styles.button}>
            {loading ? 'Verifying...' : mfaRequired ? 'Verify Code' : 'Sign In'}
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
    background: 'var(--ums-bg-app)',
  },
  card: {
    backgroundColor: 'var(--ums-bg-surface)',
    backdropFilter: 'blur(16px)',
    borderRadius: '20px',
    padding: '48px 40px',
    boxShadow: 'var(--ums-shadow-md)',
    border: '1px solid var(--ums-border-light)',
    width: '100%',
    maxWidth: '420px',
    transition: 'background-color 0.2s ease',
  },
  logoMark: {
    width: '52px',
    height: '52px',
    borderRadius: '14px',
    background: 'var(--ums-brand-gradient)',
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
    color: 'var(--ums-text-primary)',
    textAlign: 'center' as const,
    letterSpacing: '-0.3px',
  },
  subtitle: {
    margin: '0 0 28px',
    color: 'var(--ums-text-muted)',
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
    color: 'var(--ums-text-muted)',
  },
  input: {
    padding: '11px 14px',
    border: '1px solid var(--ums-border)',
    borderRadius: '10px',
    fontSize: '14px',
    backgroundColor: 'var(--ums-bg-input)',
    color: 'var(--ums-text-secondary)',
    transition: 'all 0.15s ease',
  },
  button: {
    padding: '12px',
    background: 'var(--ums-brand-gradient)',
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
    color: 'var(--ums-error-text)',
    fontSize: '13px',
    textAlign: 'center' as const,
    padding: '12px 16px',
    background: 'var(--ums-error-light)',
    borderRadius: '10px',
    border: '1px solid var(--ums-error-border)',
    lineHeight: '1.4',
  },
};
