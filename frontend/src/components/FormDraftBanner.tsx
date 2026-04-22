import { useState } from 'react';
import type { FormDraft, FormDraftType } from '../services/api';
import { useAvailableDrafts } from '../hooks/useFormDraft';
import { cn } from '@/lib/utils';

interface Props {
  formType: FormDraftType;
  /** Draft ID currently attached to this session (from useFormDraft) */
  currentDraftId: string | null;
  lastSavedAt: Date | null;
  saving: boolean;
  error?: string | null;
  /** Called when the user chooses a draft to resume. Receives the full draft record. */
  onResume: (draft: FormDraft) => void;
  /** Called when the user clicks "Start over". The host form should reset state. */
  onStartOver: () => Promise<void> | void;
  /** Imperative resume callback wired from useFormDraft (loads and adopts a draft) */
  resume: (id: string) => Promise<FormDraft | null>;
  /** Label for the current in-progress work (e.g. patient name) — shown for context */
  currentLabel?: string;
}

function timeAgo(date: Date): string {
  const sec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (sec < 10) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  return date.toLocaleDateString();
}

/**
 * Draft status bar for long forms. Three concerns wrapped in one small
 * UI element so host forms don't have to re-implement resume logic:
 *   1. "Saved a few seconds ago" live indicator
 *   2. "Resume draft…" dropdown of the user's other in-progress work
 *   3. "Start over" that discards the current draft
 */
export function FormDraftBanner({
  formType,
  currentDraftId,
  lastSavedAt,
  saving,
  error,
  onResume,
  onStartOver,
  resume,
  currentLabel,
}: Props) {
  const { drafts, refresh } = useAvailableDrafts(formType);
  const [expanded, setExpanded] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [startingOver, setStartingOver] = useState(false);

  const otherDrafts = drafts.filter((d) => d.id !== currentDraftId);

  const handleResume = async (id: string) => {
    setResuming(true);
    try {
      const draft = await resume(id);
      if (draft) {
        onResume(draft);
        setExpanded(false);
      }
    } finally {
      setResuming(false);
    }
  };

  const handleStartOver = async () => {
    if (!confirm('Start over? Your current draft will be discarded.')) return;
    setStartingOver(true);
    try {
      await onStartOver();
      await refresh();
    } finally {
      setStartingOver(false);
    }
  };

  const statusText = saving
    ? 'Saving draft…'
    : lastSavedAt
      ? `Draft saved ${timeAgo(lastSavedAt)}`
      : currentDraftId
        ? 'Draft attached'
        : 'Not saved yet';

  return (
    <div className="relative mb-3 flex flex-wrap items-center gap-3 rounded-sm border border-border bg-muted px-3 py-2 text-[12px]">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span
          aria-hidden="true"
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ background: saving ? 'var(--amber)' : 'var(--sage)' }}
        />
        <span className="whitespace-nowrap text-muted-foreground">{statusText}</span>
        {currentLabel && (
          <span
            className="max-w-[220px] truncate rounded-sm border border-border bg-card px-2 py-0.5 text-[11px] text-foreground"
          >
            {currentLabel}
          </span>
        )}
      </div>
      <div className="flex gap-1.5">
        {otherDrafts.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setExpanded((e) => !e);
              void refresh();
            }}
            aria-expanded={expanded}
            className="rounded-sm border border-border bg-card px-2.5 py-1 text-[12px] text-foreground hover:bg-muted"
          >
            Resume draft… ({otherDrafts.length})
          </button>
        )}
        {currentDraftId && (
          <button
            type="button"
            onClick={handleStartOver}
            disabled={startingOver}
            className="rounded-sm border bg-card px-2.5 py-1 text-[12px] disabled:opacity-50"
            style={{ borderColor: 'var(--warm-red)', color: 'var(--warm-red)' }}
          >
            {startingOver ? 'Clearing…' : 'Start over'}
          </button>
        )}
      </div>

      {expanded && otherDrafts.length > 0 && (
        <div className="absolute right-3 top-full z-10 mt-1 max-h-[280px] min-w-[260px] overflow-y-auto rounded-sm border border-border bg-card shadow-md">
          {otherDrafts.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => void handleResume(d.id)}
              disabled={resuming}
              className={cn(
                'block w-full border-b border-border px-3 py-2 text-left last:border-b-0 hover:bg-muted',
                resuming && 'opacity-50',
              )}
            >
              <span className="block text-[13px] font-medium text-foreground">
                {d.label || '(unlabeled)'}
              </span>
              <span className="mt-0.5 block text-[11px] text-muted-foreground">
                {d.completionPercent !== undefined && d.completionPercent !== null
                  ? `${Math.round(d.completionPercent)}% · `
                  : ''}
                {timeAgo(new Date(d.updatedAt))}
              </span>
            </button>
          ))}
        </div>
      )}

      {error && (
        <div
          className="basis-full rounded-sm border px-2 py-1 text-[11px]"
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
