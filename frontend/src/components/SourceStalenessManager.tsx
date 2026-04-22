import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
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
  const [lastAudit, setLastAudit] = useState<{
    staleCount: number;
    alerted: number;
  } | null>(null);

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

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleRunAudit = async () => {
    setAuditing(true);
    setError(null);
    try {
      const res = await runSourceStalenessAudit();
      const alerted = res.stale.filter((s) => s.alertedNow).length;
      setLastAudit({ staleCount: res.total, alerted });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Audit failed');
    } finally {
      setAuditing(false);
    }
  };

  const staleCount = rows.filter((r) => r.isStale).length;

  return (
    <div className="rounded-sm border border-border bg-card p-5 shadow-sm">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-[14px] font-semibold text-foreground">
            Source staleness
          </h3>
          <p className="mt-1 max-w-[620px] text-[12px] leading-relaxed text-muted-foreground">
            Monitored URLs that haven't changed in longer than their expected
            cadence. A stale source usually means the upstream URL is broken or
            restructured.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={refresh}
            disabled={loading || auditing}
          >
            {loading ? 'Loading…' : 'Refresh'}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleRunAudit}
            disabled={auditing || loading}
          >
            {auditing ? 'Auditing…' : 'Run audit now'}
          </Button>
        </div>
      </div>

      {lastAudit && (
        <div
          className="mb-3 rounded-sm border px-3 py-2 text-[12px]"
          style={{
            background: 'var(--copper-soft)',
            borderColor: 'var(--accent)',
            color: 'var(--accent)',
          }}
        >
          Last audit: {lastAudit.staleCount} stale source
          {lastAudit.staleCount === 1 ? '' : 's'}, {lastAudit.alerted} email alert
          {lastAudit.alerted === 1 ? '' : 's'} sent.
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="mb-3 rounded-sm border px-3 py-2 text-[12px]"
          style={{
            background: 'var(--warm-red-soft)',
            borderColor: 'var(--warm-red)',
            color: 'var(--warm-red)',
          }}
        >
          {error}
        </div>
      )}

      {!loading && rows.length === 0 && (
        <div className="py-5 text-center text-[12px] italic text-muted-foreground">
          No sources have an expected cadence configured yet. Edit a monitored
          source to set an <code className="font-mono">expectedUpdateCadenceDays</code>{' '}
          value.
        </div>
      )}

      {rows.length > 0 && (
        <div className="mb-2.5 text-[13px] text-foreground">
          <strong className="tabular-nums">{staleCount}</strong> of {rows.length}{' '}
          tracked source{rows.length === 1 ? '' : 's'} stale
        </div>
      )}

      {rows.length > 0 && (
        <div className="overflow-hidden rounded-sm border border-border">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr className="border-b border-border bg-muted">
                  <th className="px-3 py-2 text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    Source
                  </th>
                  <th className="px-3 py-2 text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    Days since change
                  </th>
                  <th className="px-3 py-2 text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    Expected cadence
                  </th>
                  <th className="px-3 py-2 text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    Last change
                  </th>
                  <th className="px-3 py-2 text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    Last alert
                  </th>
                  <th className="px-3 py-2 text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows
                  .slice()
                  .sort(
                    (a, b) =>
                      Number(b.isStale) - Number(a.isStale) ||
                      b.daysSinceLastChange - a.daysSinceLastChange,
                  )
                  .map((r) => (
                    <tr
                      key={r.sourceId}
                      className="border-b border-border last:border-b-0"
                      style={
                        r.isStale
                          ? { background: 'var(--amber-soft)' }
                          : undefined
                      }
                    >
                      <td className="px-3 py-2 align-top">
                        <div className="font-medium text-foreground">{r.name}</div>
                        <div className="break-all text-[11px] text-muted-foreground">
                          {r.url}
                        </div>
                      </td>
                      <td className="px-3 py-2 align-top tabular-nums text-foreground">
                        {Number.isFinite(r.daysSinceLastChange)
                          ? r.daysSinceLastChange
                          : '∞'}
                      </td>
                      <td className="px-3 py-2 align-top tabular-nums text-foreground">
                        {r.expectedCadenceDays} d
                      </td>
                      <td className="px-3 py-2 align-top text-muted-foreground">
                        {r.lastContentChangeAt
                          ? new Date(r.lastContentChangeAt).toLocaleDateString()
                          : '(never)'}
                      </td>
                      <td className="px-3 py-2 align-top text-muted-foreground">
                        {r.lastStalenessAlertAt
                          ? new Date(r.lastStalenessAlertAt).toLocaleDateString()
                          : '—'}
                      </td>
                      <td className="px-3 py-2 align-top">
                        {r.isStale ? (
                          <span
                            className="inline-flex items-center rounded-sm px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider"
                            style={{
                              background: 'var(--amber-soft)',
                              color: 'var(--amber)',
                            }}
                          >
                            Stale
                          </span>
                        ) : (
                          <span
                            className="inline-flex items-center rounded-sm px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider"
                            style={{
                              background: 'var(--sage-soft)',
                              color: 'var(--sage)',
                            }}
                          >
                            Fresh
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
