import { useEffect, useState, type FormEvent } from 'react';
import { Brain } from 'lucide-react';
import { forgotPassword, resetPasswordWithCode } from '../services/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

interface Props {
  onLogin: (username: string, password: string, mfaCode?: string) => Promise<void>;
  mfaRequired?: boolean;
  onMfaSubmit?: (code: string) => Promise<void>;
}

interface SsoConfig {
  enabled: boolean;
  loginUrl: string | null;
  provider: string;
}

/**
 * Fetch public auth config from the backend. Returns null on any failure
 * so the form gracefully falls back to the local username/password path.
 */
async function fetchSsoConfig(): Promise<SsoConfig | null> {
  try {
    const res = await fetch('/api/auth/config', { credentials: 'same-origin' });
    if (!res.ok) return null;
    const body = await res.json();
    return body?.sso ?? null;
  } catch {
    return null;
  }
}

function FieldError({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <div
      id={id}
      role="alert"
      className="mt-1 text-[12px]"
      style={{ color: 'var(--warm-red)' }}
    >
      {children}
    </div>
  );
}

export function LoginForm({ onLogin, mfaRequired, onMfaSubmit }: Props) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  // SSO discovery — fetched once on mount. The button surfaces as a
  // secondary option below the primary username/password form when
  // SSO is configured server-side. No forceLocal escape hatch needed
  // anymore because the local-credentials form is always primary.
  const [ssoConfig, setSsoConfig] = useState<SsoConfig | null>(null);
  const [ssoChecked, setSsoChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchSsoConfig().then((cfg) => {
      if (!cancelled) {
        setSsoConfig(cfg);
        setSsoChecked(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const ssoAvailable =
    ssoChecked &&
    ssoConfig?.enabled === true &&
    !!ssoConfig.loginUrl;

  const handleSsoRedirect = () => {
    if (!ssoConfig?.loginUrl) return;
    // Land the user back here after CA sign-in. CA doesn't currently honor a
    // return_to param, but passing it is forward-compatible + harmless.
    const returnTo = encodeURIComponent(window.location.origin + window.location.pathname);
    window.location.href = `${ssoConfig.loginUrl}?return_to=${returnTo}`;
  };

  // Forgot password flow
  const [forgotMode, setForgotMode] = useState<'off' | 'request' | 'code' | 'done'>('off');
  const [resetCode, setResetCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [forgotMessage, setForgotMessage] = useState('');

  const handleForgotRequest = async () => {
    if (!username.trim()) { setError('Enter your username first'); return; }
    setLoading(true); setError('');
    try {
      const result = await forgotPassword(username);
      setForgotMessage(result.message);
      setForgotMode('code');
    } catch (err) { setError(err instanceof Error ? err.message : 'Request failed'); }
    finally { setLoading(false); }
  };

  const handleResetSubmit = async () => {
    if (!resetCode || !newPassword) { setError('Code and new password are required'); return; }
    setLoading(true); setError('');
    try {
      const result = await resetPasswordWithCode(username, resetCode, newPassword);
      setForgotMessage(result.message);
      setForgotMode('done');
    } catch (err) { setError(err instanceof Error ? err.message : 'Reset failed'); }
    finally { setLoading(false); }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (forgotMode === 'request') { await handleForgotRequest(); return; }
      if (forgotMode === 'code') { await handleResetSubmit(); return; }
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

  const subtitle =
    forgotMode === 'request' ? 'Enter your username to receive a reset code via email'
    : forgotMode === 'code' ? 'Enter the reset code and your new password'
    : forgotMode === 'done' ? 'Password reset complete'
    : mfaRequired ? 'Enter the code from your authenticator app'
    : 'Sign in to access the knowledge base';

  const errorHeading =
    error.includes('locked') ? 'Account locked'
    : error.includes('MFA') ? 'Invalid code'
    : 'Sign-in failed';

  const submitLabel =
    loading ? 'Verifying…'
    : forgotMode === 'request' ? 'Send reset code'
    : forgotMode === 'code' ? 'Reset password'
    : mfaRequired ? 'Verify code'
    : 'Sign in';

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10 text-foreground">
      <div className="w-full max-w-[420px] rounded-sm border border-border bg-card p-8 sm:p-10 shadow-sm">
        {/* Brand mark — accent dot + display title (warm-paper pattern) */}
        <div className="mb-6 flex items-center gap-3">
          <span
            aria-hidden="true"
            style={{
              display: 'inline-block',
              width: 2,
              height: 28,
              backgroundColor: 'var(--accent)',
              borderRadius: 1,
            }}
          />
          <Brain size={22} className="text-foreground" />
          <div>
            <div
              className="font-mono uppercase text-muted-foreground"
              style={{ fontSize: 10, letterSpacing: '0.12em' }}
            >
              UMS Knowledge
            </div>
            <h1
              className="font-display font-medium text-foreground"
              style={{ fontSize: 22, lineHeight: 1.1, letterSpacing: '-0.3px' }}
            >
              Sign in
            </h1>
          </div>
        </div>

        <p className="mb-6 text-sm text-muted-foreground">{subtitle}</p>

        {forgotMessage && (
          <div
            role="status"
            className="mb-4 rounded-sm border px-3 py-2 text-[13px]"
            style={{
              background: 'var(--sage-soft)',
              borderColor: 'var(--sage)',
              color: 'var(--sage)',
            }}
          >
            {forgotMessage}
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {forgotMode === 'done' ? (
            <Button
              type="button"
              onClick={() => { setForgotMode('off'); setForgotMessage(''); setError(''); }}
              className="w-full"
            >
              Back to sign in
            </Button>
          ) : forgotMode === 'request' ? (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="login-username-fr">Username</Label>
              <Input
                id="login-username-fr"
                type="text"
                placeholder="Enter your username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoFocus
              />
            </div>
          ) : forgotMode === 'code' ? (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="login-reset-code">Reset code</Label>
                <Input
                  id="login-reset-code"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  placeholder="6-digit code from email"
                  value={resetCode}
                  onChange={(e) => setResetCode(e.target.value.replace(/\D/g, ''))}
                  className="text-center font-mono text-[20px] font-semibold tracking-[6px]"
                  autoFocus
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="login-new-pwd">New password</Label>
                <Input
                  id="login-new-pwd"
                  type="password"
                  placeholder="Min 8 chars, upper+lower+number"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                />
              </div>
            </>
          ) : !mfaRequired ? (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="login-username">Username</Label>
                <Input
                  id="login-username"
                  type="text"
                  placeholder="Enter your username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  onBlur={() => setTouched((prev) => ({ ...prev, username: true }))}
                  required
                  aria-invalid={touched.username && !username}
                  aria-describedby={touched.username && !username ? 'login-username-error' : undefined}
                />
                {touched.username && !username && (
                  <FieldError id="login-username-error">Username is required</FieldError>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="login-password">Password</Label>
                <Input
                  id="login-password"
                  type="password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onBlur={() => setTouched((prev) => ({ ...prev, password: true }))}
                  required
                  aria-invalid={touched.password && !password}
                  aria-describedby={touched.password && !password ? 'login-password-error' : undefined}
                />
                {touched.password && !password && (
                  <FieldError id="login-password-error">Password is required</FieldError>
                )}
              </div>
            </>
          ) : (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="login-mfa">Authenticator code</Label>
              <Input
                id="login-mfa"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                placeholder="6-digit code"
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ''))}
                className="text-center font-mono text-[24px] font-semibold tracking-[8px]"
                autoFocus
                required
              />
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="rounded-sm border px-3 py-2 text-[13px] leading-snug"
              style={{
                background: 'var(--warm-red-soft)',
                borderColor: 'var(--warm-red)',
                color: 'var(--warm-red)',
              }}
            >
              <strong className="mb-0.5 block font-semibold">{errorHeading}</strong>
              {error}
            </div>
          )}

          <Button type="submit" disabled={loading} className="w-full">
            {submitLabel}
          </Button>

          {forgotMode === 'off' && !mfaRequired && (
            <button
              type="button"
              onClick={() => { setForgotMode('request'); setError(''); setForgotMessage(''); }}
              className={cn(
                'w-full bg-transparent py-1 text-[13px] text-muted-foreground hover:text-foreground'
              )}
            >
              Forgot password?
            </button>
          )}

          {(forgotMode === 'request' || forgotMode === 'code') && (
            <button
              type="button"
              onClick={() => {
                setForgotMode('off');
                setError('');
                setForgotMessage('');
                setResetCode('');
                setNewPassword('');
              }}
              className="w-full bg-transparent py-1 text-[13px] text-muted-foreground hover:text-foreground"
            >
              Back to sign in
            </button>
          )}
        </form>

        {/* Secondary SSO entry point. Shown only on the default sign-in step
            (not during MFA / forgot-password flows) so the user has a clean
            either/or choice: fill the credentials form above OR bounce to
            CallAnalyzer. Auto-login for already-authenticated CA users still
            works regardless of this button — the /api/auth/me probe in
            useAuth hydrates the session on mount (PR #129). */}
        {ssoAvailable && forgotMode === 'off' && !mfaRequired && (
          <>
            <div
              className="mt-6 mb-4 flex items-center gap-3 font-mono uppercase text-muted-foreground"
              style={{ fontSize: 10, letterSpacing: '0.14em' }}
              role="separator"
            >
              <div className="h-px flex-1 bg-border" />
              <span>or</span>
              <div className="h-px flex-1 bg-border" />
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={handleSsoRedirect}
              className="w-full"
            >
              Sign in with CallAnalyzer
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
