/**
 * UsageLimitsManager — Admin panel for viewing usage stats and adjusting limits.
 */

import { useState, useEffect, useCallback } from 'react';
import { UsageLimits, UsageStats, getUsageStats, updateUsageLimits } from '../services/api';

export function UsageLimitsManager() {
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [limits, setLimits] = useState<UsageLimits>({ dailyPerUser: 30, dailyTotal: 300, monthlyTotal: 5000 });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<UsageLimits>({ dailyPerUser: 30, dailyTotal: 300, monthlyTotal: 5000 });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await getUsageStats();
      setStats(result);
      setLimits(result.limits);
      setDraft(result.limits);
    } catch {
      // Will fail if not admin
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const result = await updateUsageLimits(draft);
      setLimits(result.limits);
      setEditing(false);
      setMessage({ type: 'success', text: 'Usage limits updated' });
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to update limits' });
    } finally {
      setSaving(false);
    }
  };

  const todayUsers = stats ? Object.entries(stats.today.users) : [];
  const todayTotal = stats?.today.totalQueries || 0;

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h3 style={styles.title}>Usage & Limits</h3>
        {!editing ? (
          <button onClick={() => setEditing(true)} style={styles.editButton}>Edit Limits</button>
        ) : (
          <div style={{ display: 'flex', gap: '6px' }}>
            <button onClick={handleSave} disabled={saving} style={styles.saveButton}>
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button onClick={() => { setEditing(false); setDraft(limits); }} style={styles.cancelButton}>Cancel</button>
          </div>
        )}
      </div>

      {message && (
        <div style={message.type === 'success' ? styles.successBanner : styles.errorBanner}>
          {message.text}
          <button onClick={() => setMessage(null)} style={styles.dismiss}>×</button>
        </div>
      )}

      {/* Limits cards */}
      <div style={styles.limitsGrid}>
        <div style={styles.limitCard}>
          <div style={styles.limitLabel}>Per User / Day</div>
          {editing ? (
            <input type="number" value={draft.dailyPerUser} onChange={e => setDraft({ ...draft, dailyPerUser: parseInt(e.target.value) || 0 })} style={styles.limitInput} min={1} />
          ) : (
            <div style={styles.limitValue}>{limits.dailyPerUser}</div>
          )}
          <div style={styles.limitDesc}>queries per user per day</div>
        </div>
        <div style={styles.limitCard}>
          <div style={styles.limitLabel}>Daily Total</div>
          {editing ? (
            <input type="number" value={draft.dailyTotal} onChange={e => setDraft({ ...draft, dailyTotal: parseInt(e.target.value) || 0 })} style={styles.limitInput} min={1} />
          ) : (
            <div style={styles.limitValue}>{limits.dailyTotal}</div>
          )}
          <div style={styles.limitDesc}>queries across all users per day</div>
        </div>
        <div style={styles.limitCard}>
          <div style={styles.limitLabel}>Monthly Total</div>
          {editing ? (
            <input type="number" value={draft.monthlyTotal} onChange={e => setDraft({ ...draft, monthlyTotal: parseInt(e.target.value) || 0 })} style={styles.limitInput} min={1} />
          ) : (
            <div style={styles.limitValue}>{limits.monthlyTotal}</div>
          )}
          <div style={styles.limitDesc}>queries across all users per month</div>
        </div>
      </div>

      {/* Today's usage */}
      <div style={styles.usageSection}>
        <h4 style={styles.usageTitle}>Today's Usage ({stats?.today.date || '—'})</h4>
        <div style={styles.usageSummary}>
          <span style={styles.usageStat}>{todayTotal} / {limits.dailyTotal} total queries</span>
          <span style={styles.usageStat}>{todayUsers.length} active user{todayUsers.length !== 1 ? 's' : ''}</span>
        </div>
        {todayUsers.length > 0 ? (
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>User</th>
                <th style={styles.th}>Queries</th>
                <th style={styles.th}>Remaining</th>
                <th style={styles.th}>Last Query</th>
              </tr>
            </thead>
            <tbody>
              {todayUsers.sort((a, b) => b[1].queryCount - a[1].queryCount).map(([userId, usage]) => (
                <tr key={userId} style={styles.tr}>
                  <td style={styles.td}>{userId}</td>
                  <td style={styles.td}>
                    <span style={{ fontWeight: 600, color: usage.queryCount >= limits.dailyPerUser ? 'var(--ums-error-text)' : 'var(--ums-text-primary)' }}>
                      {usage.queryCount}
                    </span>
                    <span style={{ color: 'var(--ums-text-muted)' }}> / {limits.dailyPerUser}</span>
                  </td>
                  <td style={styles.td}>
                    {Math.max(0, limits.dailyPerUser - usage.queryCount)}
                  </td>
                  <td style={styles.td}>
                    <span style={{ fontSize: '12px', color: 'var(--ums-text-muted)' }}>
                      {usage.lastQuery ? new Date(usage.lastQuery).toLocaleTimeString() : '—'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p style={{ fontSize: '13px', color: 'var(--ums-text-muted)', margin: '8px 0 0' }}>No queries today.</p>
        )}
      </div>
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
  editButton: {
    padding: '6px 14px', background: 'var(--ums-bg-surface-alt)', border: '1px solid var(--ums-border)',
    borderRadius: '8px', fontSize: '13px', fontWeight: 500, cursor: 'pointer', color: 'var(--ums-text-secondary)',
  },
  saveButton: {
    padding: '6px 14px', background: 'var(--ums-brand-gradient)', color: '#fff',
    border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
  },
  cancelButton: {
    padding: '6px 14px', background: 'transparent', border: '1px solid var(--ums-border)',
    borderRadius: '8px', fontSize: '13px', cursor: 'pointer', color: 'var(--ums-text-muted)',
  },
  successBanner: {
    padding: '8px 14px', background: 'var(--ums-success-light)', color: 'var(--ums-success-text)',
    borderRadius: '8px', border: '1px solid var(--ums-success-border)', fontSize: '13px',
    marginBottom: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  },
  errorBanner: {
    padding: '8px 14px', background: 'var(--ums-error-light)', color: 'var(--ums-error-text)',
    borderRadius: '8px', border: '1px solid var(--ums-error-border)', fontSize: '13px',
    marginBottom: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  },
  dismiss: { background: 'none', border: 'none', fontSize: '16px', cursor: 'pointer', color: 'inherit' },
  limitsGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '12px', marginBottom: '20px' },
  limitCard: {
    padding: '16px', background: 'var(--ums-bg-surface-alt)', borderRadius: '10px',
    border: '1px solid var(--ums-border)', textAlign: 'center' as const,
  },
  limitLabel: { fontSize: '11px', fontWeight: 600, color: 'var(--ums-text-muted)', textTransform: 'uppercase' as const, letterSpacing: '0.5px', marginBottom: '8px' },
  limitValue: { fontSize: '28px', fontWeight: 700, color: 'var(--ums-text-primary)', lineHeight: 1 },
  limitInput: {
    width: '100%', maxWidth: '120px', padding: '8px', fontSize: '20px', fontWeight: 700,
    textAlign: 'center' as const, border: '2px solid var(--ums-brand-primary)', borderRadius: '8px',
    background: 'var(--ums-bg-input)', color: 'var(--ums-text-primary)',
  },
  limitDesc: { fontSize: '11px', color: 'var(--ums-text-muted)', marginTop: '6px' },
  usageSection: { borderTop: '1px solid var(--ums-border)', paddingTop: '16px' },
  usageTitle: { margin: '0 0 8px', fontSize: '14px', fontWeight: 600, color: 'var(--ums-text-primary)' },
  usageSummary: { display: 'flex', gap: '16px', marginBottom: '12px' },
  usageStat: { fontSize: '13px', color: 'var(--ums-text-muted)' },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: '13px' },
  th: {
    textAlign: 'left' as const, padding: '6px 10px', background: 'var(--ums-bg-surface-alt)',
    color: 'var(--ums-text-muted)', fontWeight: 600, fontSize: '11px',
    textTransform: 'uppercase' as const, letterSpacing: '0.5px', borderBottom: '1px solid var(--ums-border)',
  },
  tr: { borderBottom: '1px solid var(--ums-border-light)' },
  td: { padding: '6px 10px', color: 'var(--ums-text-secondary)' },
};
