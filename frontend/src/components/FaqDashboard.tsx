import { useState, useEffect } from 'react';
import { getFaqDashboard, FaqDashboardData } from '../services/api';
import { cn } from '@/lib/utils';

function confidenceTone(c: string): { fg: string; bg: string } {
  if (c === 'high') return { fg: 'var(--conf-high)', bg: 'var(--sage-soft)' };
  if (c === 'partial') return { fg: 'var(--conf-partial)', bg: 'var(--amber-soft)' };
  return { fg: 'var(--conf-low)', bg: 'var(--warm-red-soft)' };
}

function ConfChip({ value }: { value: string }) {
  const tone = confidenceTone(value);
  return (
    <span
      className="inline-flex items-center rounded-sm px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider"
      style={{ background: tone.bg, color: tone.fg }}
    >
      {value}
    </span>
  );
}

export function FaqDashboard() {
  const [data, setData] = useState<FaqDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [days, setDays] = useState(7);

  useEffect(() => {
    loadDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  const loadDashboard = async () => {
    setLoading(true);
    setError('');
    try {
      const end = new Date().toISOString().split('T')[0];
      const startD = new Date();
      startD.setDate(startD.getDate() - (days - 1));
      const start = startD.toISOString().split('T')[0];
      const result = await getFaqDashboard(start, end);
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="p-7 text-[13px] text-muted-foreground">Loading dashboard…</div>
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

  if (!data) return null;

  const maxCount = Math.max(...data.queriesByDay.map((x) => x.count), 1);

  return (
    <div className="max-w-[920px] h-full overflow-y-auto p-6 sm:p-7">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div
            className="font-mono uppercase text-muted-foreground"
            style={{ fontSize: 10, letterSpacing: '0.14em' }}
          >
            Analytics
          </div>
          <h2
            className="mt-1 font-display font-medium text-foreground"
            style={{ fontSize: 20, lineHeight: 1.15, letterSpacing: '-0.3px' }}
          >
            FAQ & analytics dashboard
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

      <p className="mt-1 mb-6 text-[12px] text-muted-foreground">
        {data.period.start} to {data.period.end}
      </p>

      {/* Summary tiles */}
      <div className="mb-7 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
        <Tile value={data.totalQueries} label="Total queries" />
        <Tile value={data.uniqueAgents} label="Active agents" />
        <Tile
          value={data.confidenceBreakdown.high}
          label="High confidence"
          color="var(--conf-high)"
        />
        <Tile
          value={data.confidenceBreakdown.partial}
          label="Partial"
          color="var(--conf-partial)"
        />
        <Tile
          value={data.confidenceBreakdown.low}
          label="Low confidence"
          color="var(--conf-low)"
        />
      </div>

      {/* Daily query volume */}
      {data.queriesByDay.length > 0 && (
        <Section title="Daily query volume">
          <div className="flex flex-col gap-1">
            {data.queriesByDay.map((d) => {
              const pct = (d.count / maxCount) * 100;
              return (
                <div key={d.date} className="flex items-center gap-2.5">
                  <span className="w-11 text-right font-mono text-[11px] font-medium text-muted-foreground tabular-nums">
                    {d.date.slice(5)}
                  </span>
                  <div className="h-5 flex-1 overflow-hidden rounded-sm bg-muted">
                    <div
                      className="h-full transition-all duration-300"
                      style={{
                        width: `${Math.max(pct, 2)}%`,
                        background: 'var(--accent)',
                      }}
                    />
                  </div>
                  <span className="w-8 font-mono text-[11px] font-semibold text-muted-foreground tabular-nums">
                    {d.count}
                  </span>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* Top questions */}
      {data.topQuestions.length > 0 && (
        <Section
          title="Most frequently asked questions"
          hint="Questions asked multiple times indicate topics that could benefit from clearer documentation or a quick-reference guide."
        >
          <DashboardTable>
            <thead>
              <tr className="border-b border-border bg-muted">
                <Th>Question</Th>
                <Th className="w-16 text-center">Count</Th>
                <Th className="w-24 text-center">Confidence</Th>
                <Th className="w-32">Agents</Th>
              </tr>
            </thead>
            <tbody>
              {data.topQuestions.map((q, i) => (
                <tr key={i} className="border-b border-border last:border-b-0">
                  <Td>{q.question}</Td>
                  <Td className="text-center font-mono font-semibold tabular-nums text-accent">
                    {q.frequency}
                  </Td>
                  <Td className="text-center">
                    <ConfChip value={q.avgConfidence} />
                  </Td>
                  <Td className="text-muted-foreground">{q.agents.join(', ')}</Td>
                </tr>
              ))}
            </tbody>
          </DashboardTable>
        </Section>
      )}

      {/* Low confidence — knowledge gaps */}
      {data.lowConfidenceQuestions.length > 0 && (
        <Section
          title="Knowledge gaps (low-confidence questions)"
          hint="These questions consistently receive low or partial confidence. Adding documents that address these topics will improve answer quality."
        >
          <DashboardTable>
            <thead>
              <tr className="border-b border-border bg-muted">
                <Th>Question</Th>
                <Th className="w-16 text-center">Count</Th>
                <Th className="w-24 text-center">Confidence</Th>
              </tr>
            </thead>
            <tbody>
              {data.lowConfidenceQuestions.map((q, i) => (
                <tr key={i} className="border-b border-border last:border-b-0">
                  <Td>{q.question}</Td>
                  <Td className="text-center font-mono font-semibold tabular-nums text-accent">
                    {q.frequency}
                  </Td>
                  <Td className="text-center">
                    <ConfChip value={q.avgConfidence} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </DashboardTable>
        </Section>
      )}

      {/* Agent activity */}
      {data.agentActivity.length > 0 && (
        <Section title="Agent activity">
          <DashboardTable>
            <thead>
              <tr className="border-b border-border bg-muted">
                <Th>Agent</Th>
                <Th className="w-24 text-center">Queries</Th>
                <Th className="w-32 text-center">Avg. confidence</Th>
              </tr>
            </thead>
            <tbody>
              {data.agentActivity.map((a, i) => (
                <tr key={i} className="border-b border-border last:border-b-0">
                  <Td>{a.username}</Td>
                  <Td className="text-center font-mono font-semibold tabular-nums">
                    {a.queryCount}
                  </Td>
                  <Td className="text-center">
                    <ConfChip value={a.avgConfidence} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </DashboardTable>
        </Section>
      )}

      {data.totalQueries === 0 && (
        <p className="py-12 text-center text-[14px] text-muted-foreground">
          No queries recorded for this period. The dashboard will populate as
          agents use the tool.
        </p>
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
        className="text-[28px] font-bold tabular-nums text-foreground"
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

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-8">
      <h3 className="mb-1 text-[15px] font-semibold text-foreground">{title}</h3>
      {hint && (
        <p className="mb-3 text-[12px] leading-relaxed text-muted-foreground">{hint}</p>
      )}
      {children}
    </div>
  );
}

function DashboardTable({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-sm border border-border shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px]">{children}</table>
      </div>
    </div>
  );
}

function Th({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={cn(
        'px-3 py-2.5 text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground',
        className,
      )}
    >
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
  return (
    <td className={cn('px-3 py-2.5 align-top text-foreground', className)}>
      {children}
    </td>
  );
}
