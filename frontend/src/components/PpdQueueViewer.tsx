/**
 * PpdQueueViewer — Queue viewer for the Pre-Appointment Kit team to review
 * submitted PPD (Patient Provided Data) questionnaires.
 */

import { useState, useEffect, useCallback } from 'react';
import { ChevronLeftIcon } from '@heroicons/react/24/outline';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type SubmissionStatus = 'pending' | 'in_review' | 'completed' | 'returned';

interface PpdSubmission {
  id: string;
  patientName: string;
  patientDob?: string;
  patientPhone?: string;
  submittedBy: string;
  submittedAt: string;
  status: SubmissionStatus;
  reviewNotes?: string;
  responses: Record<string, Record<string, string>>;
  recommendations: {
    complexRehab: RecommendationProduct[];
    standard: RecommendationProduct[];
  };
}

interface RecommendationProduct {
  hcpcsCode: string;
  description: string;
  justification: string;
  category: 'complex_rehab' | 'standard';
  imageUrl?: string;
}

const sectionLabels: Record<string, string> = {
  mobility: 'Current mobility',
  mradl: 'Mobility-related activities of daily living (MRADLs)',
  extremity: 'Extremity strength',
  falls: 'Falls & safety',
  pain: 'Consistent pain',
  additional: 'Additional information',
  diagnoses: 'Diagnoses',
};

// Status tone uses warm-paper confidence aliases: pending→amber, in_review→copper,
// completed→sage, returned→warm-red. Each pairs a soft background with the full
// ink of the same hue so the chip reads as a single quiet accent.
const statusConfig: Record<SubmissionStatus, { label: string; bg: string; fg: string }> = {
  pending: { label: 'Pending', bg: 'var(--amber-soft)', fg: 'var(--amber)' },
  in_review: { label: 'In review', bg: 'var(--copper-soft)', fg: 'var(--accent)' },
  completed: { label: 'Completed', bg: 'var(--sage-soft)', fg: 'var(--sage)' },
  returned: { label: 'Returned', bg: 'var(--warm-red-soft)', fg: 'var(--warm-red)' },
};

const allStatuses: Array<SubmissionStatus | 'all'> = [
  'all',
  'pending',
  'in_review',
  'completed',
  'returned',
];

function formatDate(iso: string): string {
  const d = new Date(iso);
  return (
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' ' +
    d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  );
}

function getCsrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)csrf=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : '';
}

function StatusChip({ status }: { status: SubmissionStatus }) {
  const cfg = statusConfig[status];
  return (
    <span
      className="inline-flex items-center rounded-sm px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider"
      style={{ background: cfg.bg, color: cfg.fg }}
    >
      {cfg.label}
    </span>
  );
}

export function PpdQueueViewer() {
  const [submissions, setSubmissions] = useState<PpdSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<SubmissionStatus | 'all'>('all');
  const [selected, setSelected] = useState<PpdSubmission | null>(null);
  const [editStatus, setEditStatus] = useState<SubmissionStatus>('pending');
  const [editNotes, setEditNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchSubmissions = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/ppd/submissions', { credentials: 'same-origin' });
      if (!res.ok) throw new Error(`Failed to load submissions (${res.status})`);
      const data = await res.json();
      setSubmissions(data.submissions ?? data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load submissions');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSubmissions();
  }, [fetchSubmissions]);

  const counts: Record<string, number> = { all: submissions.length };
  for (const s of submissions) counts[s.status] = (counts[s.status] ?? 0) + 1;

  const filtered =
    filter === 'all' ? submissions : submissions.filter((s) => s.status === filter);

  const openDetail = (sub: PpdSubmission) => {
    setSelected(sub);
    setEditStatus(sub.status);
    setEditNotes(sub.reviewNotes ?? '');
  };

  const handleStatusSave = async () => {
    if (!selected) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/ppd/submissions/${selected.id}/status`, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'x-csrf-token': getCsrfToken(),
        },
        body: JSON.stringify({ status: editStatus, notes: editNotes }),
      });
      if (!res.ok) throw new Error(`Failed to update status (${res.status})`);
      setSelected({ ...selected, status: editStatus, reviewNotes: editNotes });
      setSubmissions((prev) =>
        prev.map((s) =>
          s.id === selected.id ? { ...s, status: editStatus, reviewNotes: editNotes } : s,
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update status');
    } finally {
      setSaving(false);
    }
  };

  // ── Detail view ────────────────────────────────────────────────────────────
  if (selected) {
    const recs = [
      ...(selected.recommendations?.complexRehab ?? []),
      ...(selected.recommendations?.standard ?? []),
    ];
    const recCount = recs.length;

    return (
      <div className="mx-auto max-w-3xl px-4 py-5 sm:px-7">
        <div className="mb-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setSelected(null)}
          >
            <ChevronLeftIcon className="h-4 w-4" />
            Back to queue
          </Button>
        </div>

        <div className="mb-4">
          <div
            className="font-mono uppercase text-muted-foreground"
            style={{ fontSize: 10, letterSpacing: '0.14em' }}
          >
            PPD submission
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2.5">
            <h2
              className="font-display font-medium text-foreground"
              style={{ fontSize: 22, lineHeight: 1.15, letterSpacing: '-0.4px' }}
            >
              {selected.patientName}
            </h2>
            <StatusChip status={selected.status} />
          </div>
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted-foreground">
            {selected.patientDob && <span>DOB: {selected.patientDob}</span>}
            {selected.patientPhone && <span>Phone: {selected.patientPhone}</span>}
            <span>
              Submitted by {selected.submittedBy} on {formatDate(selected.submittedAt)}
            </span>
          </div>
        </div>

        {Object.entries(selected.responses ?? {}).map(([sectionId, answers]) => (
          <div
            key={sectionId}
            className="mb-3.5 rounded-sm border border-border bg-card p-4 shadow-sm"
          >
            <h3 className="mb-2.5 text-[14px] font-semibold text-foreground">
              {sectionLabels[sectionId] ?? sectionId}
            </h3>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
              {Object.entries(answers).map(([qId, val]) => (
                <div key={qId} className="contents">
                  <dt className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                    {qId}
                  </dt>
                  <dd className="text-foreground">{val}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}

        {recCount > 0 && (
          <div className="mb-3.5 rounded-sm border border-border bg-card p-4 shadow-sm">
            <h3 className="mb-2.5 text-[14px] font-semibold text-foreground">
              Recommendations ({recCount} product{recCount !== 1 ? 's' : ''})
            </h3>
            <div className="flex flex-col gap-2">
              {recs.map((p, i) => (
                <div
                  key={i}
                  className="flex gap-3 rounded-sm border border-border bg-background p-2.5"
                >
                  {p.imageUrl && (
                    <img
                      src={p.imageUrl}
                      alt={p.description}
                      className="h-20 w-20 flex-shrink-0 rounded-sm object-cover"
                    />
                  )}
                  <div className="min-w-0">
                    <div className="text-[13px] text-foreground">
                      <span className="font-mono font-semibold">{p.hcpcsCode}</span>
                      <span className="text-muted-foreground"> — </span>
                      {p.description}
                    </div>
                    <div className="mt-1 text-[12px] text-muted-foreground">
                      {p.justification}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mb-3.5 rounded-sm border border-border bg-card p-4 shadow-sm">
          <h3 className="mb-2.5 text-[14px] font-semibold text-foreground">
            Update status
          </h3>
          <div className="mb-2.5">
            <select
              value={editStatus}
              onChange={(e) => setEditStatus(e.target.value as SubmissionStatus)}
              className="h-10 w-full max-w-xs rounded-md border border-border bg-background px-3 text-[14px] text-foreground"
            >
              <option value="pending">Pending</option>
              <option value="in_review">In review</option>
              <option value="completed">Completed</option>
              <option value="returned">Returned</option>
            </select>
          </div>
          <textarea
            value={editNotes}
            onChange={(e) => setEditNotes(e.target.value)}
            placeholder="Review notes…"
            rows={3}
            className="mb-3 min-h-[80px] w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-[13px] text-foreground"
          />
          <Button type="button" onClick={handleStatusSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save status'}
          </Button>
        </div>

        {error && (
          <div
            role="alert"
            className="mt-3 rounded-sm border px-3 py-2 text-[13px]"
            style={{
              background: 'var(--warm-red-soft)',
              borderColor: 'var(--warm-red)',
              color: 'var(--warm-red)',
            }}
          >
            {error}
          </div>
        )}
      </div>
    );
  }

  // ── List view ──────────────────────────────────────────────────────────────
  return (
    <div className="mx-auto max-w-5xl px-4 py-5 sm:px-7">
      <div className="mb-4">
        <div
          className="font-mono uppercase text-muted-foreground"
          style={{ fontSize: 10, letterSpacing: '0.14em' }}
        >
          PPD review
        </div>
        <h2
          className="mt-1 font-display font-medium text-foreground"
          style={{ fontSize: 22, lineHeight: 1.15, letterSpacing: '-0.4px' }}
        >
          PPD submission queue
        </h2>
      </div>

      <div className="mb-4 flex flex-wrap gap-1.5">
        {allStatuses.map((s) => {
          const active = filter === s;
          const label = s === 'all' ? 'All' : statusConfig[s].label;
          const count = counts[s] ?? 0;
          return (
            <button
              key={s}
              type="button"
              onClick={() => setFilter(s)}
              aria-pressed={active}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider transition-colors',
                active
                  ? 'border-foreground bg-foreground text-background'
                  : 'border-border bg-card text-muted-foreground hover:text-foreground',
              )}
            >
              <span>{label}</span>
              <span
                className={cn(
                  'rounded-sm px-1 tabular-nums',
                  active ? 'bg-background/20' : 'bg-muted',
                )}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {loading && (
        <p className="text-[13px] text-muted-foreground">Loading submissions…</p>
      )}
      {error && (
        <div
          role="alert"
          className="mb-3 rounded-sm border px-3 py-2 text-[13px]"
          style={{
            background: 'var(--warm-red-soft)',
            borderColor: 'var(--warm-red)',
            color: 'var(--warm-red)',
          }}
        >
          {error}
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div className="rounded-sm border border-border bg-card px-6 py-10 text-center shadow-sm">
          <p className="text-[14px] font-semibold text-foreground">
            No submissions found
          </p>
          <p className="mt-1 text-[12px] text-muted-foreground">
            PPD submissions appear here once submitted from the PPD questionnaire.
          </p>
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="overflow-hidden rounded-sm border border-border bg-card shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-border bg-muted">
                  <th className="px-3 py-2 text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    Patient
                  </th>
                  <th className="px-3 py-2 text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    Submitted by
                  </th>
                  <th className="px-3 py-2 text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    Submitted at
                  </th>
                  <th className="px-3 py-2 text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    Recs
                  </th>
                  <th className="px-3 py-2 text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    Status
                  </th>
                  <th className="px-3 py-2 text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    &nbsp;
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((sub) => {
                  const recCount =
                    (sub.recommendations?.complexRehab?.length ?? 0) +
                    (sub.recommendations?.standard?.length ?? 0);
                  return (
                    <tr
                      key={sub.id}
                      className="border-b border-border last:border-b-0 hover:bg-muted/50"
                    >
                      <td className="px-3 py-2.5 align-top">
                        <div className="font-medium text-foreground">
                          {sub.patientName}
                        </div>
                        {sub.patientDob && (
                          <div className="text-[11px] text-muted-foreground">
                            DOB: {sub.patientDob}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 align-top text-foreground">
                        {sub.submittedBy}
                      </td>
                      <td className="px-3 py-2.5 align-top text-muted-foreground">
                        {formatDate(sub.submittedAt)}
                      </td>
                      <td className="px-3 py-2.5 align-top tabular-nums text-foreground">
                        {recCount}
                      </td>
                      <td className="px-3 py-2.5 align-top">
                        <StatusChip status={sub.status} />
                      </td>
                      <td className="px-3 py-2.5 align-top text-right">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => openDetail(sub)}
                        >
                          View
                        </Button>
                      </td>
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
