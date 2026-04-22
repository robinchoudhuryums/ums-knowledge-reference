/**
 * UsageLimitsManager — Admin panel for viewing usage stats and adjusting limits.
 */

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { UsageLimits, UsageStats, getUsageStats, updateUsageLimits } from '../services/api';

export function UsageLimitsManager() {
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [limits, setLimits] = useState<UsageLimits>({
    dailyPerUser: 30,
    dailyTotal: 300,
    monthlyTotal: 5000,
  });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<UsageLimits>({
    dailyPerUser: 30,
    dailyTotal: 300,
    monthlyTotal: 5000,
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await getUsageStats();
      setStats(result);
      setLimits(result.limits);
      setDraft(result.limits);
    } catch {
      /* will fail if not admin */
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const result = await updateUsageLimits(draft);
      setLimits(result.limits);
      setEditing(false);
      setMessage({ type: 'success', text: 'Usage limits updated' });
    } catch (err) {
      setMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to update limits',
      });
    } finally {
      setSaving(false);
    }
  };

  const todayUsers = stats ? Object.entries(stats.today.users) : [];
  const todayTotal = stats?.today.totalQueries || 0;

  return (
    <div className="rounded-sm border border-border bg-card p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="text-[14px] font-semibold text-foreground">Usage & limits</h3>
        {!editing ? (
          <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}>
            Edit limits
          </Button>
        ) : (
          <div className="flex gap-2">
            <Button type="button" size="sm" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setEditing(false);
                setDraft(limits);
              }}
            >
              Cancel
            </Button>
          </div>
        )}
      </div>

      {message && (
        <Banner
          tone={message.type === 'success' ? 'sage' : 'warm-red'}
          onDismiss={() => setMessage(null)}
        >
          {message.text}
        </Banner>
      )}

      {/* Limits cards */}
      <div className="mb-5 grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
        <LimitCard
          label="Per user / day"
          value={limits.dailyPerUser}
          editing={editing}
          draft={draft.dailyPerUser}
          onDraft={(v) => setDraft({ ...draft, dailyPerUser: v })}
          description="queries per user per day"
        />
        <LimitCard
          label="Daily total"
          value={limits.dailyTotal}
          editing={editing}
          draft={draft.dailyTotal}
          onDraft={(v) => setDraft({ ...draft, dailyTotal: v })}
          description="queries across all users per day"
        />
        <LimitCard
          label="Monthly total"
          value={limits.monthlyTotal}
          editing={editing}
          draft={draft.monthlyTotal}
          onDraft={(v) => setDraft({ ...draft, monthlyTotal: v })}
          description="queries across all users per month"
        />
      </div>

      {/* Today's usage */}
      <div className="border-t border-border pt-4">
        <h4 className="mb-2 text-[13px] font-semibold text-foreground">
          Today's usage ({stats?.today.date || '—'})
        </h4>
        <div className="mb-3 flex flex-wrap gap-4 text-[12px] text-muted-foreground">
          <span>
            {todayTotal} / {limits.dailyTotal} total queries
          </span>
          <span>
            {todayUsers.length} active user{todayUsers.length !== 1 ? 's' : ''}
          </span>
        </div>
        {todayUsers.length > 0 ? (
          <div className="overflow-hidden rounded-sm border border-border">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-border bg-muted">
                    <th className="px-3 py-1.5 text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      User
                    </th>
                    <th className="px-3 py-1.5 text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      Queries
                    </th>
                    <th className="px-3 py-1.5 text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      Remaining
                    </th>
                    <th className="px-3 py-1.5 text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      Last query
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {todayUsers
                    .sort((a, b) => b[1].queryCount - a[1].queryCount)
                    .map(([userId, usage]) => {
                      const atCap = usage.queryCount >= limits.dailyPerUser;
                      return (
                        <tr
                          key={userId}
                          className="border-b border-border last:border-b-0"
                        >
                          <td className="px-3 py-1.5 text-foreground">{userId}</td>
                          <td className="px-3 py-1.5 tabular-nums">
                            <span
                              className="font-semibold"
                              style={
                                atCap
                                  ? { color: 'var(--warm-red)' }
                                  : undefined
                              }
                            >
                              {usage.queryCount}
                            </span>
                            <span className="text-muted-foreground">
                              {' '}
                              / {limits.dailyPerUser}
                            </span>
                          </td>
                          <td className="px-3 py-1.5 tabular-nums text-foreground">
                            {Math.max(0, limits.dailyPerUser - usage.queryCount)}
                          </td>
                          <td className="px-3 py-1.5 text-[12px] text-muted-foreground">
                            {usage.lastQuery
                              ? new Date(usage.lastQuery).toLocaleTimeString()
                              : '—'}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <p className="text-[13px] text-muted-foreground">No queries today.</p>
        )}
      </div>
    </div>
  );
}

function LimitCard({
  label,
  value,
  editing,
  draft,
  onDraft,
  description,
}: {
  label: string;
  value: number;
  editing: boolean;
  draft: number;
  onDraft: (v: number) => void;
  description: string;
}) {
  return (
    <div className="rounded-sm border border-border bg-background p-4 text-center">
      <div className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      {editing ? (
        <Input
          type="number"
          value={draft}
          onChange={(e) => onDraft(parseInt(e.target.value) || 0)}
          min={1}
          className="h-11 max-w-[120px] mx-auto text-center text-[18px] font-bold tabular-nums"
        />
      ) : (
        <div className="text-[28px] font-bold leading-none tabular-nums text-foreground">
          {value}
        </div>
      )}
      <div className="mt-1.5 text-[11px] text-muted-foreground">{description}</div>
    </div>
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
      className="mb-3 flex items-center justify-between rounded-sm border px-3 py-2 text-[13px]"
      style={{ background: bg, borderColor: fg, color: fg }}
    >
      <span>{children}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="bg-transparent text-[16px] leading-none"
        style={{ color: 'inherit' }}
      >
        ×
      </button>
    </div>
  );
}
