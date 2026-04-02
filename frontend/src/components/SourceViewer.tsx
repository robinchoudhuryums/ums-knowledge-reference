import { useEffect, useCallback, useRef } from 'react';
import { SourceCitation } from '../types';

interface Props {
  source: SourceCitation;
  onClose: () => void;
}

export function SourceViewer({ source, onClose }: Props) {
  const modalRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
    // Focus trap: cycle focus within modal
    if (e.key === 'Tab' && modalRef.current) {
      const focusable = modalRef.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }, [onClose]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    // Auto-focus the close button when modal opens
    const closeBtn = modalRef.current?.querySelector<HTMLElement>('button[aria-label="Close"]');
    closeBtn?.focus();
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const relevancePct = Math.round(source.score * 100);
  const relevanceColor = relevancePct >= 70 ? 'var(--ums-success-text, #166534)' : relevancePct >= 40 ? 'var(--ums-warning-text, #c2410c)' : 'var(--ums-text-muted)';
  const relevanceBg = relevancePct >= 70 ? 'var(--ums-success-light, #dcfce7)' : relevancePct >= 40 ? 'var(--ums-warning-light, #fff7ed)' : 'var(--ums-bg-surface-alt)';

  return (
    <div style={styles.overlay} onClick={onClose} role="dialog" aria-modal="true" aria-label={`Source: ${source.documentName}`}>
      <div ref={modalRef} style={styles.modal} onClick={e => e.stopPropagation()}>
        <div style={styles.header}>
          <div>
            <h3 style={styles.title}>{source.documentName}</h3>
            <div style={styles.metaRow}>
              {source.pageNumber !== null && source.pageNumber !== undefined && (
                <span style={styles.metaBadge}>Page {source.pageNumber}</span>
              )}
              {source.sectionHeader && (
                <span style={styles.metaBadge}>{source.sectionHeader}</span>
              )}
              <span style={{ ...styles.metaBadge, color: relevanceColor, background: relevanceBg, borderColor: relevanceColor + '40' }}>
                {relevancePct}% match
              </span>
            </div>
          </div>
          <button onClick={onClose} style={styles.closeButton} aria-label="Close">&#10005;</button>
        </div>
        <div style={styles.divider} />
        <div style={styles.label}>Extracted Passage</div>
        <div style={styles.textContent}>{source.text}</div>
        <div style={styles.footer}>
          <span style={styles.footerText}>Chunk ID: {source.chunkId.slice(0, 8)}...</span>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
    backdropFilter: 'blur(4px)',
  },
  modal: {
    backgroundColor: 'var(--ums-bg-surface)',
    borderRadius: '16px',
    padding: '28px',
    maxWidth: '720px',
    width: '92%',
    maxHeight: '80vh',
    overflowY: 'auto',
    boxShadow: '0 25px 60px rgba(0,0,0,0.2)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '16px',
  },
  title: { margin: '0 0 8px', fontSize: '18px', fontWeight: 700, color: 'var(--ums-text-primary)', letterSpacing: '-0.2px' },
  metaRow: { display: 'flex', gap: '6px', flexWrap: 'wrap' },
  metaBadge: { fontSize: '12px', color: 'var(--ums-brand-primary)', border: '1px solid var(--ums-border)', borderRadius: '6px', padding: '3px 10px', whiteSpace: 'nowrap', background: 'var(--ums-brand-light)', fontWeight: 500 },
  closeButton: {
    background: 'var(--ums-bg-surface-alt)',
    border: '1px solid var(--ums-border-light)',
    fontSize: '16px',
    cursor: 'pointer',
    color: 'var(--ums-text-muted)',
    padding: '6px 10px',
    borderRadius: '8px',
    lineHeight: 1,
    flexShrink: 0,
  },
  divider: { height: '1px', background: 'var(--ums-border-light)', margin: '18px 0' },
  label: { fontSize: '11px', fontWeight: 600, color: 'var(--ums-text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '10px' },
  textContent: {
    padding: '18px',
    backgroundColor: 'var(--ums-bg-surface-alt)',
    borderRadius: '12px',
    border: '1px solid var(--ums-border-light)',
    fontSize: '14px',
    lineHeight: '1.7',
    whiteSpace: 'pre-wrap',
    color: '#3D5A73',
  },
  footer: { marginTop: '14px', textAlign: 'right' },
  footerText: { fontSize: '11px', color: '#B0C4D8' },
};
