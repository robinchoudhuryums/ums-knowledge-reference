import { useState, FormEvent } from 'react';
import { changePassword } from '../services/api';

interface Props {
  onPasswordChanged: (token: string, user: { id: string; username: string; role: 'admin' | 'user' }) => void;
}

export function ChangePasswordForm({ onPasswordChanged }: Props) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    setLoading(true);
    try {
      const result = await changePassword(currentPassword, newPassword);
      onPasswordChanged(result.token, result.user);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to change password');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.overlay}>
      <div style={styles.card}>
        <div style={styles.iconWrap}>
          <div style={styles.icon}>🔒</div>
        </div>
        <h2 style={styles.title}>Password Change Required</h2>
        <p style={styles.subtitle}>
          For security, you must change your password before continuing.
        </p>

        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.field}>
            <label style={styles.label}>Current Password</label>
            <input
              type="password"
              value={currentPassword}
              onChange={e => setCurrentPassword(e.target.value)}
              onBlur={() => setTouched(prev => ({ ...prev, currentPassword: true }))}
              style={styles.input}
              required
              autoFocus
            />
            {touched.currentPassword && !currentPassword && (
              <div style={{ fontSize: '12px', color: '#dc2626', marginTop: '4px' }}>Current password is required</div>
            )}
          </div>
          <div style={styles.field}>
            <label style={styles.label}>New Password</label>
            <input
              type="password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              onBlur={() => setTouched(prev => ({ ...prev, newPassword: true }))}
              style={styles.input}
              required
              minLength={8}
            />
            {touched.newPassword && (
              <div style={{ marginTop: '4px' }}>
                {[
                  { label: 'At least 8 characters', met: newPassword.length >= 8 },
                  { label: 'At least one uppercase letter', met: /[A-Z]/.test(newPassword) },
                  { label: 'At least one lowercase letter', met: /[a-z]/.test(newPassword) },
                  { label: 'At least one number', met: /[0-9]/.test(newPassword) },
                ].map(rule => (
                  <div key={rule.label} style={{ fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px' }}>
                    <span style={{ color: rule.met ? '#16a34a' : '#dc2626' }}>{rule.met ? '\u2713' : '\u2717'}</span>
                    <span style={{ color: rule.met ? '#16a34a' : '#dc2626' }}>{rule.label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Confirm New Password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              onBlur={() => setTouched(prev => ({ ...prev, confirmPassword: true }))}
              style={styles.input}
              required
            />
            {touched.confirmPassword && confirmPassword && newPassword !== confirmPassword && (
              <div style={{ fontSize: '12px', color: '#dc2626', marginTop: '4px' }}>Passwords do not match</div>
            )}
          </div>

          <div style={styles.requirements}>
            <div style={styles.reqTitle}>Password requirements:</div>
            <ul style={styles.reqList}>
              <li>At least 8 characters</li>
              <li>At least one uppercase letter</li>
              <li>At least one lowercase letter</li>
              <li>At least one number</li>
            </ul>
          </div>

          {error && <div style={styles.error}>{error}</div>}

          <button type="submit" disabled={loading} style={styles.button}>
            {loading ? 'Changing...' : 'Change Password'}
          </button>
        </form>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100vh',
    background: 'var(--ums-bg-surface-alt)',
  },
  card: {
    background: 'var(--ums-bg-surface)',
    borderRadius: '16px',
    padding: '40px',
    width: '400px',
    maxWidth: '90vw',
    boxShadow: '0 4px 24px rgba(0, 0, 0, 0.08)',
    border: '1px solid var(--ums-border-light)',
  },
  iconWrap: {
    textAlign: 'center' as const,
    marginBottom: '16px',
  },
  icon: {
    fontSize: '40px',
  },
  title: {
    margin: '0 0 8px',
    fontSize: '22px',
    fontWeight: 700,
    color: 'var(--ums-text-primary)',
    textAlign: 'center' as const,
  },
  subtitle: {
    margin: '0 0 24px',
    fontSize: '14px',
    color: 'var(--ums-text-muted)',
    textAlign: 'center' as const,
    lineHeight: '1.5',
  },
  form: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '16px',
  },
  field: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '4px',
  },
  label: {
    fontSize: '13px',
    fontWeight: 600,
    color: 'var(--ums-text-secondary)',
  },
  input: {
    padding: '10px 12px',
    border: '1px solid var(--ums-border)',
    borderRadius: '8px',
    fontSize: '14px',
    outline: 'none',
  },
  requirements: {
    background: 'var(--ums-bg-surface-alt)',
    borderRadius: '8px',
    padding: '12px 16px',
    border: '1px solid var(--ums-border-light)',
  },
  reqTitle: {
    fontSize: '12px',
    fontWeight: 600,
    color: 'var(--ums-text-muted)',
    marginBottom: '4px',
  },
  reqList: {
    margin: 0,
    paddingLeft: '18px',
    fontSize: '12px',
    color: 'var(--ums-text-muted)',
    lineHeight: '1.8',
  },
  error: {
    padding: '10px 14px',
    background: '#FEF2F2',
    border: '1px solid #FECACA',
    borderRadius: '8px',
    color: '#DC2626',
    fontSize: '13px',
  },
  button: {
    padding: '12px',
    background: 'var(--ums-brand-gradient)',
    color: 'var(--ums-bg-surface)',
    border: 'none',
    borderRadius: '10px',
    fontSize: '15px',
    fontWeight: 600,
    cursor: 'pointer',
  },
};
