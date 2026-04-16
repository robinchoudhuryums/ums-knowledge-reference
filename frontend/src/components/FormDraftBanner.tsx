import { useState } from 'react';
import { FormDraft, FormDraftType } from '../services/api';
import { useAvailableDrafts } from '../hooks/useFormDraft';

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

  const otherDrafts = drafts.filter(d => d.id !== currentDraftId);

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

  return (
    <div style={styles.container}>
      <div style={styles.leftGroup}>
        <span style={styles.statusDot(saving)} aria-hidden="true" />
        <span style={styles.statusText}>
          {saving
            ? 'Saving draft…'
            : lastSavedAt
              ? `Draft saved ${timeAgo(lastSavedAt)}`
              : currentDraftId
                ? 'Draft attached'
                : 'Not saved yet'}
        </span>
        {currentLabel && <span style={styles.labelChip}>{currentLabel}</span>}
      </div>
      <div style={styles.rightGroup}>
        {otherDrafts.length > 0 && (
          <button
            type="button"
            onClick={() => { setExpanded(e => !e); void refresh(); }}
            style={styles.resumeBtn}
            aria-expanded={expanded}
          >
            Resume draft… ({otherDrafts.length})
          </button>
        )}
        {currentDraftId && (
          <button
            type="button"
            onClick={handleStartOver}
            disabled={startingOver}
            style={styles.startOverBtn}
          >
            {startingOver ? 'Clearing…' : 'Start over'}
          </button>
        )}
      </div>

      {expanded && otherDrafts.length > 0 && (
        <div style={styles.dropdown}>
          {otherDrafts.map(d => (
            <button
              key={d.id}
              type="button"
              onClick={() => void handleResume(d.id)}
              disabled={resuming}
              style={styles.dropdownItem}
            >
              <span style={styles.dropdownLabel}>{d.label || '(unlabeled)'}</span>
              <span style={styles.dropdownMeta}>
                {d.completionPercent != null ? `${Math.round(d.completionPercent)}% · ` : ''}
                {timeAgo(new Date(d.updatedAt))}
              </span>
            </button>
          ))}
        </div>
      )}

      {error && <div style={styles.errorBar}>{error}</div>}
    </div>
  );
}

const styles = {
  container: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    alignItems: 'center',
    gap: 12,
    padding: '8px 12px',
    margin: '0 0 12px',
    background: 'var(--ums-bg-app, #f9fafb)',
    border: '1px solid var(--ums-border-light, #e5e7eb)',
    borderRadius: 6,
    fontSize: 12,
    position: 'relative' as const,
  } as React.CSSProperties,
  leftGroup: { display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 } as React.CSSProperties,
  statusDot: (saving: boolean): React.CSSProperties => ({
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: saving ? '#f59e0b' : '#10b981',
    flexShrink: 0,
  }),
  statusText: { color: 'var(--ums-text-muted, #6b7280)', whiteSpace: 'nowrap' as const },
  labelChip: {
    padding: '2px 8px',
    background: 'var(--ums-bg-surface, #ffffff)',
    border: '1px solid var(--ums-border-light, #e5e7eb)',
    borderRadius: 999,
    fontSize: 11,
    color: 'var(--ums-text-primary, #111827)',
    maxWidth: 220,
    overflow: 'hidden' as const,
    textOverflow: 'ellipsis' as const,
    whiteSpace: 'nowrap' as const,
  },
  rightGroup: { display: 'flex', gap: 6 },
  resumeBtn: {
    padding: '4px 10px',
    background: 'var(--ums-bg-surface, #ffffff)',
    border: '1px solid var(--ums-border-light, #e5e7eb)',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 12,
    color: 'var(--ums-text-primary, #111827)',
  },
  startOverBtn: {
    padding: '4px 10px',
    background: 'var(--ums-bg-surface, #ffffff)',
    border: '1px solid #fca5a5',
    color: '#b91c1c',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 12,
  },
  dropdown: {
    position: 'absolute' as const,
    top: '100%',
    right: 12,
    marginTop: 4,
    minWidth: 260,
    maxHeight: 280,
    overflowY: 'auto' as const,
    background: 'var(--ums-bg-surface, #ffffff)',
    border: '1px solid var(--ums-border-light, #e5e7eb)',
    borderRadius: 6,
    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
    zIndex: 10,
  },
  dropdownItem: {
    display: 'block',
    width: '100%',
    padding: '8px 12px',
    background: 'transparent',
    border: 'none',
    borderBottom: '1px solid var(--ums-border-light, #e5e7eb)',
    cursor: 'pointer',
    textAlign: 'left' as const,
  } as React.CSSProperties,
  dropdownLabel: {
    display: 'block',
    fontWeight: 500,
    color: 'var(--ums-text-primary, #111827)',
    fontSize: 13,
  },
  dropdownMeta: {
    display: 'block',
    color: 'var(--ums-text-muted, #6b7280)',
    fontSize: 11,
    marginTop: 2,
  },
  errorBar: {
    flexBasis: '100%',
    padding: '4px 8px',
    background: '#fef2f2',
    color: '#b91c1c',
    borderRadius: 4,
    fontSize: 11,
  } as React.CSSProperties,
};
