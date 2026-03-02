import { useEffect, useCallback } from 'react';
import { SourceCitation } from '../types';

interface Props {
  source: SourceCitation;
  onClose: () => void;
}

export function SourceViewer({ source, onClose }: Props) {
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
  }, [onClose]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const relevancePct = Math.round(source.score * 100);
  const relevanceColor = relevancePct >= 70 ? '#2e7d32' : relevancePct >= 40 ? '#f57c00' : '#999';

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        <div style={styles.header}>
          <div>
            <h3 style={styles.title}>{source.documentName}</h3>
            <div style={styles.metaRow}>
              {source.pageNumber != null && (
                <span style={styles.metaBadge}>Page {source.pageNumber}</span>
              )}
              {source.sectionHeader && (
                <span style={styles.metaBadge}>{source.sectionHeader}</span>
              )}
              <span style={{ ...styles.metaBadge, color: relevanceColor, borderColor: relevanceColor }}>
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
    backgroundColor: 'rgba(0,0,0,0.45)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
    backdropFilter: 'blur(2px)',
  },
  modal: {
    backgroundColor: 'white',
    borderRadius: '12px',
    padding: '24px',
    maxWidth: '720px',
    width: '92%',
    maxHeight: '80vh',
    overflowY: 'auto',
    boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '16px',
  },
  title: { margin: '0 0 6px', fontSize: '18px', fontWeight: 600, color: '#1a1a2e' },
  metaRow: { display: 'flex', gap: '6px', flexWrap: 'wrap' },
  metaBadge: { fontSize: '12px', color: '#666', border: '1px solid #ddd', borderRadius: '4px', padding: '2px 8px', whiteSpace: 'nowrap' },
  closeButton: {
    background: 'none',
    border: 'none',
    fontSize: '18px',
    cursor: 'pointer',
    color: '#999',
    padding: '4px 8px',
    borderRadius: '4px',
    lineHeight: 1,
    flexShrink: 0,
  },
  divider: { height: '1px', background: '#eee', margin: '16px 0' },
  label: { fontSize: '12px', fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '8px' },
  textContent: {
    padding: '16px',
    backgroundColor: '#fafbfc',
    borderRadius: '8px',
    border: '1px solid #eee',
    fontSize: '14px',
    lineHeight: '1.7',
    whiteSpace: 'pre-wrap',
    color: '#333',
  },
  footer: { marginTop: '12px', textAlign: 'right' },
  footerText: { fontSize: '11px', color: '#bbb' },
};
