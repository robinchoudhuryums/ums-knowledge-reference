import { useEffect, useState, useCallback } from 'react';
import {
  getBatchStatus,
  type BatchStatusSnapshot,
  type BatchStatusActiveJob,
} from '../services/api';

/**
 * Admin card surfacing Bedrock batch inference state:
 *   - whether batch mode is available (env-configured)
 *   - how many extraction prompts are queued in the pending/ prefix
 *   - which batch jobs are currently running on AWS
 *   - count of tracking files stranded in orphaned-submissions/ (alerts
 *     when > 0 — they self-heal on the next scheduler cycle but the
 *     count being nonzero is a signal S3 writes are flapping)
 *
 * Data comes from `GET /api/admin/batch-status` which is S3-listing-only
 * (no Bedrock API calls) so polling every 30s is cheap.
 */
export function BatchStatusCard() {
  const [snapshot, setSnapshot] = useState<BatchStatusSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await getBatchStatus();
      setSnapshot(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load batch status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // Refresh every 30s. The endpoint only does S3 LIST calls — no Bedrock
    // invocation — so this is safe to poll.
    const interval = setInterval(load, 30_000);
    return () => clearInterval(interval);
  }, [load]);

  return (
    <section
      className="rounded-sm border border-border bg-card p-5"
      aria-labelledby="batch-status-heading"
    >
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <div>
          <div
            className="font-mono uppercase text-muted-foreground"
            style={{ fontSize: 10, letterSpacing: '0.14em' }}
          >
            Cost optimization
          </div>
          <h2
            id="batch-status-heading"
            className="font-display text-foreground"
            style={{ fontSize: 18, letterSpacing: '-0.2px' }}
          >
            Bedrock batch inference
          </h2>
        </div>
        <button
          type="button"
          onClick={load}
          className="rounded-sm border border-border bg-background px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
          aria-label="Refresh batch status"
        >
          Refresh
        </button>
      </div>

      {loading && !snapshot && (
        <div className="text-[13px] text-muted-foreground">Loading…</div>
      )}

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

      {snapshot && !snapshot.available && (
        <div
          className="rounded-sm border border-border bg-background p-3 text-[13px] text-muted-foreground"
          aria-live="polite"
        >
          Batch mode is <span className="font-semibold">disabled</span>. Set{' '}
          <code className="font-mono text-[12px]">BEDROCK_BATCH_MODE=true</code>{' '}
          and <code className="font-mono text-[12px]">BEDROCK_BATCH_ROLE_ARN</code>{' '}
          to enable 50% cost savings on async extractions.
        </div>
      )}

      {snapshot && snapshot.available && (
        <>
          <div className="mb-3 grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-3">
            <Tile
              label="Pending items"
              value={snapshot.pending.toString()}
              hint={`next cycle in ≤${snapshot.intervalMinutes}m`}
            />
            <Tile
              label="Active jobs"
              value={snapshot.active.length.toString()}
              hint={
                snapshot.active.length === 0 ? 'none running' : 'submitted to AWS'
              }
            />
            <Tile
              label="Orphaned"
              value={snapshot.orphanedSubmissions.toString()}
              tone={snapshot.orphanedSubmissions > 0 ? 'alert' : 'ok'}
              hint={
                snapshot.orphanedSubmissions > 0
                  ? 'self-heal next cycle'
                  : 'S3 writes healthy'
              }
            />
          </div>

          {snapshot.active.length > 0 && (
            <div>
              <div className="mb-1.5 text-[12px] font-semibold text-foreground">
                Active jobs
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="border-b border-border text-left font-mono uppercase text-muted-foreground">
                      <th className="py-1.5 pr-3" style={{ fontSize: 10, letterSpacing: '0.08em' }}>
                        Job ID
                      </th>
                      <th className="py-1.5 pr-3" style={{ fontSize: 10, letterSpacing: '0.08em' }}>
                        Submitted
                      </th>
                      <th className="py-1.5 pr-3 text-right" style={{ fontSize: 10, letterSpacing: '0.08em' }}>
                        Items
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshot.active.map((job) => (
                      <ActiveJobRow key={job.jobId} job={job} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function Tile({
  label,
  value,
  hint,
  tone = 'ok',
}: {
  label: string;
  value: string;
  hint: string;
  tone?: 'ok' | 'alert';
}) {
  const valueColor = tone === 'alert' ? 'var(--warm-red)' : 'var(--foreground)';
  return (
    <div className="rounded-sm border border-border bg-background p-3 text-center">
      <div
        className="text-[28px] font-bold tabular-nums"
        style={{ color: valueColor }}
      >
        {value}
      </div>
      <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-[10px] text-muted-foreground">{hint}</div>
    </div>
  );
}

function ActiveJobRow({ job }: { job: BatchStatusActiveJob }) {
  // Short ID for display: batch-1734567890-abc123 → batch-…abc123
  const shortId =
    job.jobId.length > 20 ? `${job.jobId.slice(0, 6)}…${job.jobId.slice(-6)}` : job.jobId;
  const submitted = (() => {
    try {
      return new Date(job.createdAt).toLocaleString();
    } catch {
      return job.createdAt;
    }
  })();
  return (
    <tr className="border-b border-border last:border-0">
      <td
        className="py-1.5 pr-3 font-mono text-foreground"
        title={job.jobId}
        style={{ fontSize: 11 }}
      >
        {shortId}
      </td>
      <td className="py-1.5 pr-3 text-muted-foreground">{submitted}</td>
      <td className="py-1.5 pr-3 text-right font-mono tabular-nums text-foreground">
        {job.itemCount}
      </td>
    </tr>
  );
}
