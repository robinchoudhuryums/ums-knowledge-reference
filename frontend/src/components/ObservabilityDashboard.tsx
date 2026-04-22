import { useState, useEffect } from 'react';
import { getObservabilityMetrics, ObservabilityMetrics } from '../services/api';
import { cn } from '@/lib/utils';

export function ObservabilityDashboard() {
  const [metrics, setMetrics] = useState<ObservabilityMetrics | null>(null);
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeFailureTab, setActiveFailureTab] = useState<'retrieval' | 'generation'>(
    'retrieval',
  );

  useEffect(() => {
    setLoading(true);
    getObservabilityMetrics(days)
      .then((data) => {
        setMetrics(data);
        setError('');
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [days]);

  if (loading) {
    return (
      <div className="p-6 text-center text-[13px] text-muted-foreground">
        Loading observability data…
      </div>
    );
  }
  if (error) {
    return (
      <div
        role="alert"
        className="mx-7 mt-6 rounded-sm border px-3 py-2 text-[13px]"
        style={{
          background: 'var(--warm-red-soft)',
          borderColor: 'var(--warm-red)',
          color: 'var(--warm-red)',
        }}
      >
        {error}
      </div>
    );
  }
  if (!metrics) return null;

  const maxResponseTime = Math.max(
    ...metrics.dailyStats.map((d) => d.avgResponseTimeMs),
    1,
  );

  const approvalColor =
    metrics.thumbsUpRatio >= 80
      ? 'var(--conf-high)'
      : metrics.thumbsUpRatio >= 50
        ? 'var(--conf-partial)'
        : 'var(--conf-low)';

  return (
    <div className="p-6 sm:p-7">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <div
            className="font-mono uppercase text-muted-foreground"
            style={{ fontSize: 10, letterSpacing: '0.14em' }}
          >
            Observability
          </div>
          <h2
            className="mt-1 font-display font-medium text-foreground"
            style={{ fontSize: 20, lineHeight: 1.15, letterSpacing: '-0.3px' }}
          >
            RAG observability
          </h2>
        </div>
        <div className="inline-flex rounded-sm border border-border bg-card p-0.5">
          {[7, 14, 30].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              aria-pressed={days === d}
              className={cn(
                'rounded-sm px-3 py-1 font-mono text-[11px] uppercase tracking-wider transition-colors',
                days === d
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* Summary cards */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-6">
        <Tile value={metrics.totalTraces} label="Total traces" />
        <Tile
          value={
            metrics.avgResponseTimeMs > 0
              ? `${(metrics.avgResponseTimeMs / 1000).toFixed(1)}s`
              : '—'
          }
          label="Avg response time"
        />
        <Tile
          value={
            metrics.avgRetrievalScore > 0
              ? `${Math.round(metrics.avgRetrievalScore * 100)}%`
              : '—'
          }
          label="Avg retrieval score"
        />
        <Tile value={metrics.thumbsUp} label="Thumbs up" color="var(--conf-high)" />
        <Tile value={metrics.thumbsDown} label="Thumbs down" color="var(--conf-low)" />
        <Tile
          value={
            metrics.thumbsUp + metrics.thumbsDown > 0
              ? `${metrics.thumbsUpRatio}%`
              : '—'
          }
          label="Approval rate"
          color={approvalColor}
        />
      </div>

      {/* Daily retrieval score trend */}
      <div className="mb-6 rounded-sm border border-border bg-card p-4 shadow-sm">
        <h3 className="mb-3 text-[14px] font-semibold text-foreground">
          Daily retrieval score
        </h3>
        <div className="flex flex-col gap-1">
          {metrics.dailyStats.map((day) => {
            const scorePct = Math.round(day.avgRetrievalScore * 100);
            const scoreColor =
              scorePct >= 50
                ? 'var(--sage)'
                : scorePct >= 30
                  ? 'var(--amber)'
                  : 'var(--warm-red)';
            return (
              <div key={day.date} className="flex items-center gap-2 text-[12px]">
                <span className="w-12 text-right font-mono text-[11px] text-muted-foreground tabular-nums">
                  {day.date.slice(5)}
                </span>
                <div className="h-5 flex-1 overflow-hidden rounded-sm bg-muted">
                  <div
                    className="flex h-full items-center pl-1.5 font-mono text-[10px] text-background transition-all duration-300"
                    style={{
                      width: `${scorePct}%`,
                      background: scoreColor,
                      minWidth: 2,
                    }}
                  >
                    {day.traceCount > 0 && (
                      <span className="whitespace-nowrap">{scorePct}%</span>
                    )}
                  </div>
                </div>
                <span className="w-9 font-mono text-[11px] text-muted-foreground tabular-nums">
                  {day.traceCount}q
                </span>
                {day.thumbsUp + day.thumbsDown > 0 && (
                  <span className="whitespace-nowrap text-[11px]">
                    {day.thumbsUp > 0 && (
                      <span style={{ color: 'var(--conf-high)' }}>
                        👍{day.thumbsUp}
                      </span>
                    )}
                    {day.thumbsDown > 0 && (
                      <span style={{ color: 'var(--conf-low)', marginLeft: 4 }}>
                        👎{day.thumbsDown}
                      </span>
                    )}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Daily response time trend */}
      <div className="mb-6 rounded-sm border border-border bg-card p-4 shadow-sm">
        <h3 className="mb-3 text-[14px] font-semibold text-foreground">
          Daily avg response time
        </h3>
        <div className="flex flex-col gap-1">
          {metrics.dailyStats.map((day) => {
            const bg =
              day.avgResponseTimeMs > 10000
                ? 'var(--warm-red)'
                : day.avgResponseTimeMs > 5000
                  ? 'var(--amber)'
                  : 'var(--accent)';
            return (
              <div key={day.date} className="flex items-center gap-2 text-[12px]">
                <span className="w-12 text-right font-mono text-[11px] text-muted-foreground tabular-nums">
                  {day.date.slice(5)}
                </span>
                <div className="h-5 flex-1 overflow-hidden rounded-sm bg-muted">
                  <div
                    className="flex h-full items-center pl-1.5 font-mono text-[10px] text-background transition-all duration-300"
                    style={{
                      width: `${(day.avgResponseTimeMs / maxResponseTime) * 100}%`,
                      background: bg,
                      minWidth: 2,
                    }}
                  >
                    {day.traceCount > 0 && (
                      <span className="whitespace-nowrap">
                        {(day.avgResponseTimeMs / 1000).toFixed(1)}s
                      </span>
                    )}
                  </div>
                </div>
                <span className="w-9 font-mono text-[11px] text-muted-foreground tabular-nums">
                  {day.traceCount}q
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Failure correlation */}
      {(metrics.retrievalFailures.length > 0 ||
        metrics.generationFailures.length > 0) && (
        <div className="mb-6 rounded-sm border border-border bg-card p-4 shadow-sm">
          <h3 className="mb-1.5 text-[14px] font-semibold text-foreground">
            Thumbs-down diagnosis
          </h3>
          <p className="mb-3 text-[12px] leading-relaxed text-muted-foreground">
            Correlates negative feedback with retrieval scores to distinguish
            retrieval failures (documents not found) from generation failures
            (documents found but answer was poor).
          </p>
          <div className="mb-3 flex gap-1.5">
            {(['retrieval', 'generation'] as const).map((tab) => {
              const active = activeFailureTab === tab;
              const count =
                tab === 'retrieval'
                  ? metrics.retrievalFailures.length
                  : metrics.generationFailures.length;
              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveFailureTab(tab)}
                  aria-pressed={active}
                  className={cn(
                    'rounded-sm border px-3 py-1 font-mono text-[11px] uppercase tracking-wider transition-colors',
                    active
                      ? 'border-foreground bg-foreground text-background'
                      : 'border-border bg-card text-muted-foreground hover:text-foreground',
                  )}
                >
                  {tab} failures ({count})
                </button>
              );
            })}
          </div>
          <div className="mb-3 text-[11px] italic text-muted-foreground">
            {activeFailureTab === 'retrieval'
              ? 'Low retrieval score (< 40%) + thumbs down = relevant documents are missing or poorly chunked.'
              : 'Good retrieval score (≥ 40%) + thumbs down = model generated a poor answer despite having good context.'}
          </div>
          <div className="flex flex-col gap-2">
            {(activeFailureTab === 'retrieval'
              ? metrics.retrievalFailures
              : metrics.generationFailures
            ).map((entry, i) => (
              <div
                key={i}
                className="rounded-sm border border-border bg-background p-3"
              >
                <div className="mb-1.5 text-[13px] font-medium text-foreground">
                  {entry.queryText}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                  <Chip>Score {Math.round(entry.avgRetrievalScore * 100)}%</Chip>
                  <Chip>Confidence {entry.confidence}</Chip>
                  <Chip>{(entry.responseTimeMs / 1000).toFixed(1)}s</Chip>
                  <span className="text-muted-foreground">{entry.date}</span>
                </div>
                {entry.feedbackNotes && (
                  <div className="mt-2 text-[12px] italic text-muted-foreground">
                    Note: {entry.feedbackNotes}
                  </div>
                )}
              </div>
            ))}
            {(activeFailureTab === 'retrieval'
              ? metrics.retrievalFailures
              : metrics.generationFailures
            ).length === 0 && (
              <div className="py-6 text-center text-[13px] text-muted-foreground">
                No {activeFailureTab} failures in this period.
              </div>
            )}
          </div>
        </div>
      )}

      {metrics.totalTraces === 0 && (
        <div className="p-6 text-center text-[13px] text-muted-foreground">
          No RAG traces recorded yet. Traces will appear here after users start
          querying the knowledge base.
        </div>
      )}
    </div>
  );
}

function Tile({
  value,
  label,
  color,
}: {
  value: string | number;
  label: string;
  color?: string;
}) {
  return (
    <div className="rounded-sm border border-border bg-card p-4 text-center shadow-sm">
      <div
        className="text-[24px] font-bold tabular-nums text-foreground"
        style={color ? { color } : undefined}
      >
        {value}
      </div>
      <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-sm bg-muted px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
      {children}
    </span>
  );
}
