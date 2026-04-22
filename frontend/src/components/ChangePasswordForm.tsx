import { useState, type FormEvent } from 'react';
import { LockClosedIcon } from '@heroicons/react/24/outline';
import { changePassword } from '../services/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface Props {
  onPasswordChanged: (token: string, user: { id: string; username: string; role: 'admin' | 'user' }) => void;
}

interface PasswordRule {
  label: string;
  met: boolean;
}

function RuleRow({ rule }: { rule: PasswordRule }) {
  const tone = rule.met ? 'var(--sage)' : 'var(--muted-foreground)';
  return (
    <div className="flex items-center gap-1.5 text-[12px]" style={{ color: tone }}>
      <span aria-hidden="true">{rule.met ? '✓' : '•'}</span>
      <span>{rule.label}</span>
    </div>
  );
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

  const rules: PasswordRule[] = [
    { label: 'At least 8 characters', met: newPassword.length >= 8 },
    { label: 'At least one uppercase letter', met: /[A-Z]/.test(newPassword) },
    { label: 'At least one lowercase letter', met: /[a-z]/.test(newPassword) },
    { label: 'At least one number', met: /[0-9]/.test(newPassword) },
  ];

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10 text-foreground">
      <div className="w-full max-w-[440px] rounded-sm border border-border bg-card p-8 sm:p-10 shadow-sm">
        <div className="mb-6 flex items-start gap-3">
          <div
            aria-hidden="true"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-sm"
            style={{ background: 'var(--copper-soft)', color: 'var(--accent)' }}
          >
            <LockClosedIcon className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div
              className="font-mono uppercase text-muted-foreground"
              style={{ fontSize: 10, letterSpacing: '0.12em' }}
            >
              Security
            </div>
            <h2
              className="font-display font-medium text-foreground"
              style={{ fontSize: 20, lineHeight: 1.15, letterSpacing: '-0.3px' }}
            >
              Password change required
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              For security, you must change your password before continuing.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="chpwd-current">Current password</Label>
            <Input
              id="chpwd-current"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              onBlur={() => setTouched((prev) => ({ ...prev, currentPassword: true }))}
              required
              autoFocus
              aria-invalid={touched.currentPassword && !currentPassword}
              aria-describedby={touched.currentPassword && !currentPassword ? 'chpwd-current-error' : undefined}
            />
            {touched.currentPassword && !currentPassword && (
              <div
                id="chpwd-current-error"
                role="alert"
                className="mt-1 text-[12px]"
                style={{ color: 'var(--warm-red)' }}
              >
                Current password is required
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="chpwd-new">New password</Label>
            <Input
              id="chpwd-new"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              onBlur={() => setTouched((prev) => ({ ...prev, newPassword: true }))}
              required
              minLength={8}
              aria-describedby="chpwd-new-requirements"
            />
            {touched.newPassword && (
              <div id="chpwd-new-requirements" aria-live="polite" className="mt-1 flex flex-col gap-0.5">
                {rules.map((rule) => (
                  <RuleRow key={rule.label} rule={rule} />
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="chpwd-confirm">Confirm new password</Label>
            <Input
              id="chpwd-confirm"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              onBlur={() => setTouched((prev) => ({ ...prev, confirmPassword: true }))}
              required
              aria-invalid={touched.confirmPassword && confirmPassword !== newPassword}
              aria-describedby={touched.confirmPassword && confirmPassword !== newPassword ? 'chpwd-confirm-error' : undefined}
            />
            {touched.confirmPassword && confirmPassword && newPassword !== confirmPassword && (
              <div
                id="chpwd-confirm-error"
                role="alert"
                className="mt-1 text-[12px]"
                style={{ color: 'var(--warm-red)' }}
              >
                Passwords do not match
              </div>
            )}
          </div>

          {/* Static requirements panel — redundant with live checklist above,
              but useful as a reference before the user starts typing. */}
          <div className="rounded-sm border border-border bg-muted px-3 py-2">
            <div
              className="font-mono uppercase text-muted-foreground"
              style={{ fontSize: 10, letterSpacing: '0.08em' }}
            >
              Password requirements
            </div>
            <ul className="mt-1 list-disc pl-4 text-[12px] leading-relaxed text-muted-foreground">
              <li>At least 8 characters</li>
              <li>At least one uppercase letter</li>
              <li>At least one lowercase letter</li>
              <li>At least one number</li>
            </ul>
          </div>

          {error && (
            <div
              role="alert"
              className="rounded-sm border px-3 py-2 text-[13px]"
              style={{
                background: 'var(--warm-red-soft)',
                borderColor: 'var(--warm-red)',
                color: 'var(--warm-red)',
              }}
            >
              {error}
            </div>
          )}

          <Button type="submit" disabled={loading} className="w-full">
            {loading ? 'Changing…' : 'Change password'}
          </Button>
        </form>
      </div>
    </div>
  );
}
