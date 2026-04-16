import { useCallback, useEffect, useState } from 'react';
import {
  listSourceStaleness,
  runSourceStalenessAudit,
  SourceStalenessEntry,
} from '../services/api';

/**
 * Admin dashboard card showing which monitored sources haven't produced
 * fresh content in longer than their configured cadence. Combines:
 *   - Read-only view (GET /api/sources/staleness) on mount
 *   - "Run audit now" (POST /api/sources/audit-staleness) — triggers alerts
 */
export function SourceStalenessManager() {
  const [rows, setRows] = useState<SourceStalenessEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [auditing, setAuditing] = useState(false);
  const [lastAudit, setLastAudit] = useState<{ staleCount: number; alerted: number } | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listSourceStaleness();
      setRows(res.sources);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load staleness');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const handleRunAudit = async () => {
    setAuditing(true);
    setError(null);
    try {
      const res = await runSourceStalenessAudit();
      const alerted = res.stale.filter(s => s.alertedNow).length;
      setLastAudit({ staleCount: res.total, alerted });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Audit failed');
    } finally {
      setAuditing(false);
    }
  };

  const staleCount = rows.filter(r => r.isStale).length;

  return (
    <div style={styles.card}>
      <div style={styles.header}>
        <div>
          <h3 style={styles.title}>Source staleness</h3>
          <p style={styles.subtitle}>
            Monitored URLs that haven't changed in longer than their expected cadence.
            A stale source usually means the upstream URL is broken or restructured.
          </p>
        </div>
        <div style={styles.headerActions}>
          <button
            type="button"
            onClick={refresh}
            disabled={loading || auditing}
            style={styles.secondaryBtn}
          >
            {loading ? 'Loading…' : 'Refresh'}
          </button>
          <button
            type="button"
            onClick={handleRunAudit}
            disabled={auditing || loading}
            style={styles.primaryBtn}
          >
            {auditing ? 'Auditing…' : 'Run audit now'}
          </button>
        </div>
      </div>

      {lastAudit && (
        <div style={styles.banner}>
          Last audit: {lastAudit.staleCount} stale source{lastAudit.staleCount === 1 ? '' : 's'},
          {' '}{lastAudit.alerted} email alert{lastAudit.alerted === 1 ? '' : 's'} sent.
        </div>
      )}

      {error && <div style={styles.errorBanner}>{error}</div>}

      {!loading && rows.length === 0 && (
        <div style={styles.empty}>
          No sources have an expected cadence configured yet. Edit a monitored source to set
          an "expectedUpdateCadenceDays" value.
        </div>
      )}

      {rows.length > 0 && (
        <div style={styles.summary}>
          <strong>{staleCount}</strong> of {rows.length} tracked source{rows.length === 1 ? '' : 's'} stale
        </div>
      )}

      {rows.length > 0 && (
        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr style={styles.trHead}>
                <th style={styles.th}>Source</th>
                <th style={styles.th}>Days since change</th>
                <th style={styles.th}>Expected cadence</th>
                <th style={styles.th}>Last change</th>
                <th style={styles.th}>Last alert</th>
                <th style={styles.th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows
                .slice()
                .sort((a, b) => Number(b.isStale) - Number(a.isStale) || b.daysSinceLastChange - a.daysSinceLastChange)
                .map(r => (
                  <tr key={r.sourceId} style={r.isStale ? styles.trStale : styles.tr}>
                    <td style={styles.td}>
                      <div style={styles.nameCell}>{r.name}</div>
                      <div style={styles.urlCell}>{r.url}</div>
                    </td>
                    <td style={styles.td}>{Number.isFinite(r.daysSinceLastChange) ? r.daysSinceLastChange : '∞'}</td>
                    <td style={styles.td}>{r.expectedCadenceDays} d</td>
                    <td style={styles.td}>{r.lastContentChangeAt ? new Date(r.lastContentChangeAt).toLocaleDateString() : '(never)'}</td>
                    <td style={styles.td}>{r.lastStalenessAlertAt ? new Date(r.lastStalenessAlertAt).toLocaleDateString() : '—'}</td>
                    <td style={styles.td}>
                      {r.isStale
                        ? <span style={styles.badgeStale}>Stale</span>
                        : <span style={styles.badgeFresh}>Fresh</span>}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  card: { padding: 20, background: 'var(--ums-bg-surface, #fff)' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 12, flexWrap: 'wrap' as const },
  title: { margin: '0 0 4px', fontSize: 16, fontWeight: 600, color: 'var(--ums-text-primary, #111827)' },
  subtitle: { margin: 0, fontSize: 12, color: 'var(--ums-text-muted, #6b7280)', maxWidth: 620 },
  headerActions: { display: 'flex', gap: 8 },
  primaryBtn: { padding: '6px 14px', background: 'var(--ums-accent, #2563eb)', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer' },
  secondaryBtn: { padding: '6px 14px', background: 'var(--ums-bg-app, #f3f4f6)', color: 'var(--ums-text-primary, #111827)', border: '1px solid var(--ums-border-light, #e5e7eb)', borderRadius: 6, fontSize: 13, cursor: 'pointer' },
  banner: { padding: 10, background: '#eff6ff', color: '#1e40af', borderRadius: 6, fontSize: 12, marginBottom: 12 },
  errorBanner: { padding: 10, background: '#fef2f2', color: '#b91c1c', borderRadius: 6, fontSize: 12, marginBottom: 12 },
  empty: { padding: 20, textAlign: 'center' as const, color: 'var(--ums-text-muted, #6b7280)', fontSize: 13, fontStyle: 'italic' as const },
  summary: { marginBottom: 10, fontSize: 13, color: 'var(--ums-text-primary, #111827)' },
  tableWrap: { overflowX: 'auto' as const },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 12 },
  trHead: { background: 'var(--ums-bg-app, #f9fafb)' },
  th: { textAlign: 'left' as const, padding: '8px 10px', borderBottom: '1px solid var(--ums-border-light, #e5e7eb)', fontWeight: 600, color: 'var(--ums-text-primary, #111827)' },
  tr: { borderBottom: '1px solid var(--ums-border-light, #e5e7eb)' },
  trStale: { borderBottom: '1px solid var(--ums-border-light, #e5e7eb)', background: '#fffbeb' },
  td: { padding: '8px 10px', verticalAlign: 'top' as const },
  nameCell: { fontWeight: 500, color: 'var(--ums-text-primary, #111827)' },
  urlCell: { fontSize: 11, color: 'var(--ums-text-muted, #6b7280)', wordBreak: 'break-all' as const },
  badgeStale: { display: 'inline-block', padding: '2px 8px', background: '#fef3c7', color: '#b45309', borderRadius: 999, fontSize: 11, fontWeight: 600 },
  badgeFresh: { display: 'inline-block', padding: '2px 8px', background: '#ecfdf5', color: '#047857', borderRadius: 999, fontSize: 11, fontWeight: 600 },
};
