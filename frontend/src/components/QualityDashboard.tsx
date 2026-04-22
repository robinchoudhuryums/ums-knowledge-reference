import { useState, useEffect } from 'react';
import { getQualityMetrics, QualityMetrics } from '../services/api';
import { cn } from '@/lib/utils';

export function QualityDashboard() {
  const [metrics, setMetrics] = useState<QualityMetrics | null>(null);
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    getQualityMetrics(days)
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
        Loading quality metrics…
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

  const maxDayQueries = Math.max(...metrics.dailyStats.map((d) => d.queries), 1);

  return (
    <div className="p-6 sm:p-7">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <div
            className="font-mono uppercase text-muted-foreground"
            style={{ fontSize: 10, letterSpacing: '0.14em' }}
          >
            Quality
          </div>
          <h2
            className="mt-1 font-display font-medium text-foreground"
            style={{ fontSize: 20, lineHeight: 1.15, letterSpacing: '-0.3px' }}
          >
            Answer quality metrics
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
        <SummaryCard value={`${metrics.qualityScore}%`} label="Quality score" />
        <SummaryCard value={metrics.totalQueries} label="Total queries" />
        <SummaryCard value={metrics.totalFlagged} label="Flagged responses" />
        <SummaryCard
          value={metrics.confidenceCounts.high}
          label="High confidence"
          valueColor="var(--conf-high)"
        />
        <SummaryCard
          value={metrics.confidenceCounts.partial}
          label="Partial"
          valueColor="var(--conf-partial)"
        />
        <SummaryCard
          value={metrics.confidenceCounts.low}
          label="Low / unanswered"
          valueColor="var(--conf-low)"
        />
      </div>

      {/* Daily trend */}
      <div className="mb-6 rounded-sm border border-border bg-card p-4 shadow-sm">
        <h3 className="mb-3 text-[14px] font-semibold text-foreground">Daily trend</h3>
        <div className="flex flex-col gap-1">
          {metrics.dailyStats.map((day) => (
            <div key={day.date} className="flex items-center gap-2 text-[12px]">
              <span className="w-12 text-right font-mono text-[11px] text-muted-foreground tabular-nums">
                {day.date.slice(5)}
              </span>
              <div className="h-5 flex-1 overflow-hidden rounded-sm bg-muted">
                <div
                  className="flex h-full items-center pl-1.5 font-mono text-[10px] text-background transition-all duration-300"
                  style={{
                    width: `${(day.queries / maxDayQueries) * 100}%`,
                    background: 'var(--accent)',
                    minWidth: 2,
                  }}
                >
                  <span className="whitespace-nowrap">{day.queries}q</span>
                </div>
              </div>
              <span
                className="w-16 text-[11px] tabular-nums"
                style={{ color: 'var(--conf-high)' }}
              >
                {day.highPct}% high
              </span>
              {day.flagged > 0 && (
                <span
                  className="text-[11px] tabular-nums"
                  style={{ color: 'var(--warm-red)' }}
                >
                  {day.flagged} flagged
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Knowledge gaps */}
      {metrics.unansweredQuestions.length > 0 && (
        <div className="rounded-sm border border-border bg-card p-4 shadow-sm">
          <h3 className="mb-3 text-[14px] font-semibold text-foreground">
            Knowledge gaps (low-confidence questions)
          </h3>
          <div className="flex flex-col gap-1.5">
            {metrics.unansweredQuestions.map((q, i) => (
              <div
                key={i}
                className="flex justify-between rounded-sm border px-3 py-2 text-[13px]"
                style={{
                  background: 'var(--warm-red-soft)',
                  borderColor: 'var(--warm-red)',
                  color: 'var(--warm-red)',
                }}
              >
                <span className="flex-1">{q.question}</span>
                <span className="ml-3 text-[11px] opacity-80">{q.date}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  value,
  label,
  valueColor,
}: {
  value: string | number;
  label: string;
  valueColor?: string;
}) {
  return (
    <div className="rounded-sm border border-border bg-card p-4 text-center shadow-sm">
      <div
        className="text-[24px] font-bold tabular-nums text-foreground"
        style={valueColor ? { color: valueColor } : undefined}
      >
        {value}
      </div>
      <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
    </div>
  );
}
