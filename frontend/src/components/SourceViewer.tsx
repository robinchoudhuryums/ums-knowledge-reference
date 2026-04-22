import { useEffect, useCallback, useRef } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import type { SourceCitation } from '../types';

interface Props {
  source: SourceCitation;
  onClose: () => void;
}

export function SourceViewer({ source, onClose }: Props) {
  const modalRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && modalRef.current) {
        const focusable = modalRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    },
    [onClose],
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    const closeBtn = modalRef.current?.querySelector<HTMLElement>('button[aria-label="Close"]');
    closeBtn?.focus();
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const relevancePct = Math.round(source.score * 100);

  // Relevance tone maps to confidence aliases set in index.css.
  const relevanceTone =
    relevancePct >= 70 ? 'high' : relevancePct >= 40 ? 'partial' : 'low';
  const tonePalette: Record<'high' | 'partial' | 'low', { fg: string; bg: string; border: string }> = {
    high: { fg: 'var(--conf-high)', bg: 'var(--conf-high-bg)', border: 'var(--conf-high-border)' },
    partial: { fg: 'var(--conf-partial)', bg: 'var(--conf-partial-bg)', border: 'var(--conf-partial-border)' },
    low: { fg: 'var(--conf-low)', bg: 'var(--conf-low-bg)', border: 'var(--conf-low-border)' },
  };
  const tone = tonePalette[relevanceTone];

  return (
    <div
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Source: ${source.documentName}`}
      className="fixed inset-0 z-[1000] flex items-center justify-center px-4"
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.45)' }}
    >
      <div
        ref={modalRef}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[80vh] w-full max-w-[720px] overflow-y-auto rounded-sm border border-border bg-card p-6 shadow-lg sm:p-7"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div
              className="font-mono uppercase text-muted-foreground"
              style={{ fontSize: 10, letterSpacing: '0.12em' }}
            >
              Source
            </div>
            <h3
              className="mt-1 font-display font-medium text-foreground"
              style={{ fontSize: 18, lineHeight: 1.2, letterSpacing: '-0.2px' }}
            >
              {source.documentName}
            </h3>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {source.pageNumber !== null && source.pageNumber !== undefined && (
                <MetaBadge>Page {source.pageNumber}</MetaBadge>
              )}
              {source.sectionHeader && <MetaBadge>{source.sectionHeader}</MetaBadge>}
              <span
                className="inline-flex items-center rounded-sm border px-2 py-0.5 font-mono text-[11px] uppercase tracking-wider"
                style={{ background: tone.bg, borderColor: tone.border, color: tone.fg }}
              >
                {relevancePct}% match
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm border border-border bg-card text-muted-foreground hover:text-foreground"
          >
            <XMarkIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="my-5 h-px bg-border" />

        <div
          className="font-mono uppercase text-muted-foreground"
          style={{ fontSize: 10, letterSpacing: '0.14em' }}
        >
          Extracted passage
        </div>
        <div className="mt-2 whitespace-pre-wrap rounded-sm border border-border bg-muted p-4 text-[14px] leading-relaxed text-foreground">
          {source.text}
        </div>

        <div className="mt-3 text-right">
          <span className="font-mono text-[11px] text-muted-foreground">
            Chunk ID {source.chunkId.slice(0, 8)}…
          </span>
        </div>
      </div>
    </div>
  );
}

function MetaBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-sm border border-border bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
      {children}
    </span>
  );
}
