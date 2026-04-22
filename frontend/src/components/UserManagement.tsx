/**
 * UserManagement — Admin panel for managing users.
 * CRUD operations: create, list, update role, reset password, delete, disable MFA.
 */

import { useState, useEffect, useCallback } from 'react';
import {
  UserPlusIcon,
  TrashIcon,
  KeyIcon,
  ShieldCheckIcon,
} from '@heroicons/react/24/outline';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  AdminUser,
  listUsers,
  createUser,
  updateUserRole,
  deleteUser,
  resetUserPassword,
  disableUserMfa,
  updateUserEmail,
} from '../services/api';
import { useConfirm } from './ConfirmDialog';

function formatDate(iso?: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function UserManagement() {
  const { confirm } = useConfirm();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<'user' | 'admin'>('user');
  const [creating, setCreating] = useState(false);
  const [actionResult, setActionResult] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const [editingEmail, setEditingEmail] = useState<{
    userId: string;
    value: string;
  } | null>(null);

  const loadUsers = useCallback(async () => {
    try {
      setLoading(true);
      const result = await listUsers();
      setUsers(result.users);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const handleEmailSave = async (userId: string) => {
    if (!editingEmail) return;
    try {
      await updateUserEmail(userId, editingEmail.value || null);
      setEditingEmail(null);
      setActionResult({ type: 'success', message: 'Email updated' });
      await loadUsers();
    } catch (err) {
      setActionResult({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to update email',
      });
    }
  };

  const handleCreate = async () => {
    if (!newUsername.trim() || !newPassword.trim()) return;
    setCreating(true);
    setActionResult(null);
    try {
      await createUser(newUsername.trim(), newPassword, newRole);
      setActionResult({
        type: 'success',
        message: `User "${newUsername}" created successfully`,
      });
      setNewUsername('');
      setNewPassword('');
      setNewRole('user');
      setShowCreate(false);
      await loadUsers();
    } catch (err) {
      setActionResult({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to create user',
      });
    } finally {
      setCreating(false);
    }
  };

  const handleRoleChange = async (user: AdminUser, role: 'admin' | 'user') => {
    try {
      await updateUserRole(user.id, role);
      setActionResult({
        type: 'success',
        message: `${user.username} role changed to ${role}`,
      });
      await loadUsers();
    } catch (err) {
      setActionResult({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to update role',
      });
    }
  };

  const handleResetPassword = async (user: AdminUser) => {
    const ok = await confirm({
      title: 'Reset password',
      message: `Generate a new temporary password for "${user.username}"? They will be required to change it on next login.`,
      confirmLabel: 'Reset password',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      const result = await resetUserPassword(user.id);
      setActionResult({
        type: 'success',
        message: `Temporary password for ${user.username}: ${result.temporaryPassword}`,
      });
      await loadUsers();
    } catch (err) {
      setActionResult({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to reset password',
      });
    }
  };

  const handleDelete = async (user: AdminUser) => {
    const ok = await confirm({
      title: 'Delete user',
      message: `Permanently delete "${user.username}"? This cannot be undone.`,
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await deleteUser(user.id);
      setActionResult({ type: 'success', message: `User "${user.username}" deleted` });
      await loadUsers();
    } catch (err) {
      setActionResult({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to delete user',
      });
    }
  };

  const handleDisableMfa = async (user: AdminUser) => {
    const ok = await confirm({
      title: 'Disable MFA',
      message: `Disable multi-factor authentication for "${user.username}"? They will need to set it up again.`,
      confirmLabel: 'Disable MFA',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await disableUserMfa(user.id);
      setActionResult({ type: 'success', message: `MFA disabled for ${user.username}` });
      await loadUsers();
    } catch (err) {
      setActionResult({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to disable MFA',
      });
    }
  };

  return (
    <div className="rounded-sm border border-border bg-card p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="text-[14px] font-semibold text-foreground">User management</h3>
        <Button
          type="button"
          size="sm"
          onClick={() => setShowCreate(!showCreate)}
        >
          <UserPlusIcon className="h-4 w-4" />
          {showCreate ? 'Cancel' : 'Create user'}
        </Button>
      </div>

      {actionResult && (
        <Banner
          tone={actionResult.type === 'success' ? 'sage' : 'warm-red'}
          onDismiss={() => setActionResult(null)}
        >
          {actionResult.message}
        </Banner>
      )}

      {showCreate && (
        <div className="mb-4 rounded-sm border border-border bg-background p-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="text"
              placeholder="Username"
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              className="min-w-[140px] flex-1"
            />
            <Input
              type="password"
              placeholder="Password (min 8, upper + lower + number)"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="min-w-[220px] flex-[2]"
            />
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as 'admin' | 'user')}
              className="h-10 rounded-md border border-border bg-background px-3 text-[14px] text-foreground"
            >
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
            <Button
              type="button"
              onClick={handleCreate}
              disabled={creating || !newUsername.trim() || !newPassword.trim()}
            >
              {creating ? 'Creating…' : 'Create'}
            </Button>
          </div>
        </div>
      )}

      {loading && <p className="text-[13px] text-muted-foreground">Loading users…</p>}
      {error && (
        <Banner tone="warm-red" onDismiss={() => setError('')}>
          {error}
        </Banner>
      )}

      {!loading && (
        <div className="overflow-hidden rounded-sm border border-border">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-border bg-muted">
                  <Th>Username</Th>
                  <Th>Role</Th>
                  <Th>Email</Th>
                  <Th>MFA</Th>
                  <Th>Status</Th>
                  <Th>Last login</Th>
                  <Th>Created</Th>
                  <Th>Actions</Th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => {
                  const isLocked =
                    user.lockedUntil && new Date(user.lockedUntil) > new Date();
                  return (
                    <tr
                      key={user.id}
                      className="border-b border-border last:border-b-0 align-middle"
                    >
                      <Td>
                        <span className="font-medium text-foreground">
                          {user.username}
                        </span>
                        {user.mustChangePassword && (
                          <span
                            className="ml-1.5 inline-block rounded-sm px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider"
                            style={{
                              background: 'var(--amber-soft)',
                              color: 'var(--amber)',
                            }}
                          >
                            must change pw
                          </span>
                        )}
                      </Td>
                      <Td>
                        <select
                          value={user.role}
                          onChange={(e) =>
                            handleRoleChange(
                              user,
                              e.target.value as 'admin' | 'user',
                            )
                          }
                          className="h-8 rounded-md border border-border bg-background px-2 text-[12px] text-foreground"
                        >
                          <option value="user">user</option>
                          <option value="admin">admin</option>
                        </select>
                      </Td>
                      <Td>
                        {editingEmail?.userId === user.id ? (
                          <div className="flex items-center gap-1">
                            <Input
                              type="email"
                              value={editingEmail.value}
                              onChange={(e) =>
                                setEditingEmail({
                                  userId: user.id,
                                  value: e.target.value,
                                })
                              }
                              onKeyDown={(e) =>
                                e.key === 'Enter' && handleEmailSave(user.id)
                              }
                              placeholder="user@example.com"
                              autoFocus
                              className="h-8 w-40 text-[12px]"
                            />
                            <IconBtn
                              onClick={() => handleEmailSave(user.id)}
                              title="Save"
                            >
                              ✓
                            </IconBtn>
                            <IconBtn
                              onClick={() => setEditingEmail(null)}
                              title="Cancel"
                            >
                              ✕
                            </IconBtn>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() =>
                              setEditingEmail({
                                userId: user.id,
                                value: user.email || '',
                              })
                            }
                            className="cursor-pointer text-[13px]"
                            style={{
                              color: user.email
                                ? 'var(--foreground)'
                                : 'var(--muted-foreground)',
                            }}
                            title="Click to edit email"
                          >
                            {user.email || 'Set email…'}
                          </button>
                        )}
                      </Td>
                      <Td>
                        {user.mfaEnabled ? (
                          <span
                            className="inline-flex items-center gap-1 font-mono text-[10px] font-semibold uppercase tracking-wider"
                            style={{ color: 'var(--sage)' }}
                          >
                            <ShieldCheckIcon className="h-3.5 w-3.5" />
                            Enabled
                          </span>
                        ) : (
                          <span className="text-[12px] text-muted-foreground">Off</span>
                        )}
                      </Td>
                      <Td>
                        {isLocked ? (
                          <span
                            className="font-mono text-[10px] font-semibold uppercase tracking-wider"
                            style={{ color: 'var(--warm-red)' }}
                          >
                            Locked
                          </span>
                        ) : (
                          <span
                            className="font-mono text-[10px] font-semibold uppercase tracking-wider"
                            style={{ color: 'var(--sage)' }}
                          >
                            Active
                          </span>
                        )}
                      </Td>
                      <Td className="text-[12px] text-muted-foreground">
                        {formatDate(user.lastLogin)}
                      </Td>
                      <Td className="text-[12px] text-muted-foreground">
                        {formatDate(user.createdAt)}
                      </Td>
                      <Td>
                        <div className="flex gap-1">
                          <IconBtn
                            onClick={() => handleResetPassword(user)}
                            title="Reset password"
                          >
                            <KeyIcon className="h-4 w-4" />
                          </IconBtn>
                          {user.mfaEnabled && (
                            <IconBtn
                              onClick={() => handleDisableMfa(user)}
                              title="Disable MFA"
                            >
                              <ShieldCheckIcon className="h-4 w-4" />
                            </IconBtn>
                          )}
                          <IconBtn
                            onClick={() => handleDelete(user)}
                            title="Delete user"
                            tone="warm-red"
                          >
                            <TrashIcon className="h-4 w-4" />
                          </IconBtn>
                        </div>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="whitespace-nowrap px-3 py-2 text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
      {children}
    </th>
  );
}

function Td({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const cls = ['px-3 py-2 align-middle', className].filter(Boolean).join(' ');
  return <td className={cls}>{children}</td>;
}

function IconBtn({
  onClick,
  title,
  tone,
  children,
}: {
  onClick: () => void;
  title: string;
  tone?: 'warm-red';
  children: React.ReactNode;
}) {
  const style: React.CSSProperties =
    tone === 'warm-red'
      ? {
          background: 'var(--warm-red-soft)',
          borderColor: 'var(--warm-red)',
          color: 'var(--warm-red)',
        }
      : {};
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="flex h-7 w-7 items-center justify-center rounded-sm border border-border bg-background text-muted-foreground hover:text-foreground"
      style={style}
    >
      {children}
    </button>
  );
}

function Banner({
  tone,
  children,
  onDismiss,
}: {
  tone: 'sage' | 'warm-red';
  children: React.ReactNode;
  onDismiss: () => void;
}) {
  const bg = tone === 'sage' ? 'var(--sage-soft)' : 'var(--warm-red-soft)';
  const fg = tone === 'sage' ? 'var(--sage)' : 'var(--warm-red)';
  return (
    <div
      className="mb-3 flex items-center justify-between break-all rounded-sm border px-3 py-2 text-[13px]"
      style={{ background: bg, borderColor: fg, color: fg }}
    >
      <span>{children}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="ml-2 bg-transparent text-[16px] leading-none"
        style={{ color: 'inherit' }}
      >
        ×
      </button>
    </div>
  );
}
