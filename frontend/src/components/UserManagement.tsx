/**
 * UserManagement — Admin panel for managing users.
 * CRUD operations: create, list, update role, reset password, delete, disable MFA.
 */

import { useState, useEffect, useCallback } from 'react';
import { AdminUser, listUsers, createUser, updateUserRole, deleteUser, resetUserPassword, disableUserMfa, updateUserEmail } from '../services/api';
import { useConfirm } from './ConfirmDialog';
import {
  UserPlusIcon,
  TrashIcon,
  KeyIcon,
  ShieldCheckIcon,
} from '@heroicons/react/24/outline';

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
  const [actionResult, setActionResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const [editingEmail, setEditingEmail] = useState<{ userId: string; value: string } | null>(null);

  const handleEmailSave = async (userId: string) => {
    if (!editingEmail) return;
    try {
      await updateUserEmail(userId, editingEmail.value || null);
      setEditingEmail(null);
      setActionResult({ type: 'success', message: 'Email updated' });
      await loadUsers();
    } catch (err) {
      setActionResult({ type: 'error', message: err instanceof Error ? err.message : 'Failed to update email' });
    }
  };

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

  useEffect(() => { loadUsers(); }, [loadUsers]);

  const handleCreate = async () => {
    if (!newUsername.trim() || !newPassword.trim()) return;
    setCreating(true);
    setActionResult(null);
    try {
      await createUser(newUsername.trim(), newPassword, newRole);
      setActionResult({ type: 'success', message: `User "${newUsername}" created successfully` });
      setNewUsername('');
      setNewPassword('');
      setNewRole('user');
      setShowCreate(false);
      await loadUsers();
    } catch (err) {
      setActionResult({ type: 'error', message: err instanceof Error ? err.message : 'Failed to create user' });
    } finally {
      setCreating(false);
    }
  };

  const handleRoleChange = async (user: AdminUser, newRole: 'admin' | 'user') => {
    try {
      await updateUserRole(user.id, newRole);
      setActionResult({ type: 'success', message: `${user.username} role changed to ${newRole}` });
      await loadUsers();
    } catch (err) {
      setActionResult({ type: 'error', message: err instanceof Error ? err.message : 'Failed to update role' });
    }
  };

  const handleResetPassword = async (user: AdminUser) => {
    const ok = await confirm({
      title: 'Reset Password',
      message: `Generate a new temporary password for "${user.username}"? They will be required to change it on next login.`,
      confirmLabel: 'Reset Password',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      const result = await resetUserPassword(user.id);
      setActionResult({ type: 'success', message: `Temporary password for ${user.username}: ${result.temporaryPassword}` });
      await loadUsers();
    } catch (err) {
      setActionResult({ type: 'error', message: err instanceof Error ? err.message : 'Failed to reset password' });
    }
  };

  const handleDelete = async (user: AdminUser) => {
    const ok = await confirm({
      title: 'Delete User',
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
      setActionResult({ type: 'error', message: err instanceof Error ? err.message : 'Failed to delete user' });
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
      setActionResult({ type: 'error', message: err instanceof Error ? err.message : 'Failed to disable MFA' });
    }
  };

  const formatDate = (iso?: string) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h3 style={styles.title}>User Management</h3>
        <button onClick={() => setShowCreate(!showCreate)} style={styles.createButton}>
          <UserPlusIcon className="w-4 h-4" />
          {showCreate ? 'Cancel' : 'Create User'}
        </button>
      </div>

      {actionResult && (
        <div style={actionResult.type === 'success' ? styles.successBanner : styles.errorBanner}>
          {actionResult.message}
          <button onClick={() => setActionResult(null)} style={styles.dismissButton}>×</button>
        </div>
      )}

      {showCreate && (
        <div style={styles.createForm}>
          <div style={styles.formRow}>
            <input
              type="text"
              placeholder="Username"
              value={newUsername}
              onChange={e => setNewUsername(e.target.value)}
              style={styles.input}
            />
            <input
              type="password"
              placeholder="Password (min 8, upper+lower+number)"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              style={{ ...styles.input, flex: 2 }}
            />
            <select value={newRole} onChange={e => setNewRole(e.target.value as 'admin' | 'user')} style={styles.select}>
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
            <button onClick={handleCreate} disabled={creating || !newUsername.trim() || !newPassword.trim()} style={styles.submitButton}>
              {creating ? 'Creating...' : 'Create'}
            </button>
          </div>
        </div>
      )}

      {loading && <p style={styles.meta}>Loading users...</p>}
      {error && <div style={styles.errorBanner}>{error}</div>}

      {!loading && (
        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Username</th>
                <th style={styles.th}>Role</th>
                <th style={styles.th}>Email</th>
                <th style={styles.th}>MFA</th>
                <th style={styles.th}>Status</th>
                <th style={styles.th}>Last Login</th>
                <th style={styles.th}>Created</th>
                <th style={styles.th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map(user => {
                const isLocked = user.lockedUntil && new Date(user.lockedUntil) > new Date();
                return (
                  <tr key={user.id} style={styles.tr}>
                    <td style={styles.td}>
                      <span style={{ fontWeight: 600, color: 'var(--ums-text-primary)' }}>{user.username}</span>
                      {user.mustChangePassword && <span style={styles.badge}> must change pw</span>}
                    </td>
                    <td style={styles.td}>
                      <select
                        value={user.role}
                        onChange={e => handleRoleChange(user, e.target.value as 'admin' | 'user')}
                        style={styles.roleSelect}
                      >
                        <option value="user">user</option>
                        <option value="admin">admin</option>
                      </select>
                    </td>
                    <td style={styles.td}>
                      {editingEmail?.userId === user.id ? (
                        <div style={{ display: 'flex', gap: '4px' }}>
                          <input
                            type="email"
                            value={editingEmail.value}
                            onChange={e => setEditingEmail({ userId: user.id, value: e.target.value })}
                            onKeyDown={e => e.key === 'Enter' && handleEmailSave(user.id)}
                            style={{ ...styles.roleSelect, width: '160px' }}
                            placeholder="user@example.com"
                            autoFocus
                          />
                          <button onClick={() => handleEmailSave(user.id)} style={styles.actionBtn} title="Save">&#10003;</button>
                          <button onClick={() => setEditingEmail(null)} style={styles.actionBtn} title="Cancel">&#10005;</button>
                        </div>
                      ) : (
                        <span
                          onClick={() => setEditingEmail({ userId: user.id, value: user.email || '' })}
                          style={{ fontSize: '13px', color: user.email ? 'var(--ums-text-secondary)' : 'var(--ums-text-placeholder)', cursor: 'pointer' }}
                          title="Click to edit email"
                        >
                          {user.email || 'Set email...'}
                        </span>
                      )}
                    </td>
                    <td style={styles.td}>
                      {user.mfaEnabled ? (
                        <span style={styles.mfaBadge}>
                          <ShieldCheckIcon className="w-3.5 h-3.5" /> Enabled
                        </span>
                      ) : (
                        <span style={{ color: 'var(--ums-text-muted)', fontSize: '13px' }}>Off</span>
                      )}
                    </td>
                    <td style={styles.td}>
                      {isLocked ? (
                        <span style={{ color: 'var(--ums-error-text)', fontSize: '13px', fontWeight: 600 }}>Locked</span>
                      ) : (
                        <span style={{ color: 'var(--ums-success-text)', fontSize: '13px' }}>Active</span>
                      )}
                    </td>
                    <td style={styles.td}>
                      <span style={{ fontSize: '13px', color: 'var(--ums-text-muted)' }}>{formatDate(user.lastLogin)}</span>
                    </td>
                    <td style={styles.td}>
                      <span style={{ fontSize: '13px', color: 'var(--ums-text-muted)' }}>{formatDate(user.createdAt)}</span>
                    </td>
                    <td style={styles.td}>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <button onClick={() => handleResetPassword(user)} style={styles.actionBtn} title="Reset password">
                          <KeyIcon className="w-4 h-4" />
                        </button>
                        {user.mfaEnabled && (
                          <button onClick={() => handleDisableMfa(user)} style={styles.actionBtn} title="Disable MFA">
                            <ShieldCheckIcon className="w-4 h-4" />
                          </button>
                        )}
                        <button onClick={() => handleDelete(user)} style={styles.actionBtnDanger} title="Delete user">
                          <TrashIcon className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    background: 'var(--ums-bg-surface)', borderRadius: '12px',
    border: '1px solid var(--ums-border)', padding: '20px 24px',
    boxShadow: 'var(--ums-shadow-sm)',
  },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' },
  title: { margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--ums-text-primary)' },
  createButton: {
    display: 'flex', alignItems: 'center', gap: '6px',
    padding: '7px 14px', background: 'var(--ums-brand-gradient)', color: '#fff',
    border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
  },
  createForm: {
    padding: '14px', background: 'var(--ums-bg-surface-alt)', borderRadius: '10px',
    border: '1px solid var(--ums-border)', marginBottom: '16px',
  },
  formRow: { display: 'flex', gap: '8px', flexWrap: 'wrap' as const, alignItems: 'center' },
  input: {
    flex: 1, minWidth: '140px', padding: '8px 12px', border: '1px solid var(--ums-border)',
    borderRadius: '8px', fontSize: '14px', background: 'var(--ums-bg-input)', color: 'var(--ums-text-primary)',
  },
  select: {
    padding: '8px 12px', border: '1px solid var(--ums-border)', borderRadius: '8px',
    fontSize: '14px', background: 'var(--ums-bg-input)', color: 'var(--ums-text-primary)',
  },
  submitButton: {
    padding: '8px 18px', background: 'var(--ums-brand-gradient)', color: '#fff',
    border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 600, cursor: 'pointer',
  },
  meta: { fontSize: '13px', color: 'var(--ums-text-muted)' },
  successBanner: {
    padding: '10px 14px', background: 'var(--ums-success-light)', color: 'var(--ums-success-text)',
    borderRadius: '8px', border: '1px solid var(--ums-success-border)', fontSize: '13px',
    marginBottom: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    wordBreak: 'break-all' as const,
  },
  errorBanner: {
    padding: '10px 14px', background: 'var(--ums-error-light)', color: 'var(--ums-error-text)',
    borderRadius: '8px', border: '1px solid var(--ums-error-border)', fontSize: '13px', marginBottom: '12px',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  },
  dismissButton: {
    background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer',
    color: 'inherit', padding: '0 4px', lineHeight: 1,
  },
  tableWrap: { overflowX: 'auto' as const },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: '14px' },
  th: {
    textAlign: 'left' as const, padding: '8px 10px', background: 'var(--ums-bg-surface-alt)',
    color: 'var(--ums-text-muted)', fontWeight: 600, fontSize: '11px', whiteSpace: 'nowrap' as const,
    textTransform: 'uppercase' as const, letterSpacing: '0.5px', borderBottom: '1px solid var(--ums-border)',
  },
  tr: { borderBottom: '1px solid var(--ums-border-light)' },
  td: { padding: '8px 10px', verticalAlign: 'middle' as const },
  badge: {
    fontSize: '10px', padding: '2px 6px', background: 'var(--ums-warning-light)',
    color: 'var(--ums-warning-text)', borderRadius: '4px', marginLeft: '6px', fontWeight: 600,
  },
  roleSelect: {
    padding: '4px 8px', border: '1px solid var(--ums-border)', borderRadius: '6px',
    fontSize: '13px', background: 'var(--ums-bg-input)', color: 'var(--ums-text-primary)',
  },
  mfaBadge: {
    display: 'inline-flex', alignItems: 'center', gap: '3px',
    fontSize: '12px', color: 'var(--ums-success-text)', fontWeight: 600,
  },
  actionBtn: {
    padding: '5px', background: 'var(--ums-bg-surface-alt)', border: '1px solid var(--ums-border)',
    borderRadius: '6px', cursor: 'pointer', color: 'var(--ums-text-muted)',
    display: 'flex', alignItems: 'center',
  },
  actionBtnDanger: {
    padding: '5px', background: 'var(--ums-error-light)', border: '1px solid var(--ums-error-border)',
    borderRadius: '6px', cursor: 'pointer', color: 'var(--ums-error-text)',
    display: 'flex', alignItems: 'center',
  },
};
