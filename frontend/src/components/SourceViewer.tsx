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
  const relevanceColor = relevancePct >= 70 ? '#166534' : relevancePct >= 40 ? '#c2410c' : '#8DA4B8';
  const relevanceBg = relevancePct >= 70 ? '#dcfce7' : relevancePct >= 40 ? '#fff7ed' : '#F7FAFD';

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
    backgroundColor: 'white',
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
  title: { margin: '0 0 8px', fontSize: '18px', fontWeight: 700, color: '#0D2137', letterSpacing: '-0.2px' },
  metaRow: { display: 'flex', gap: '6px', flexWrap: 'wrap' },
  metaBadge: { fontSize: '12px', color: '#1B6FC9', border: '1px solid #BBDEFB', borderRadius: '6px', padding: '3px 10px', whiteSpace: 'nowrap', background: '#E3F2FD', fontWeight: 500 },
  closeButton: {
    background: '#F7FAFD',
    border: '1px solid #E8EFF5',
    fontSize: '16px',
    cursor: 'pointer',
    color: '#8DA4B8',
    padding: '6px 10px',
    borderRadius: '8px',
    lineHeight: 1,
    flexShrink: 0,
  },
  divider: { height: '1px', background: '#E8EFF5', margin: '18px 0' },
  label: { fontSize: '11px', fontWeight: 600, color: '#8DA4B8', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '10px' },
  textContent: {
    padding: '18px',
    backgroundColor: '#F7FAFD',
    borderRadius: '12px',
    border: '1px solid #E8EFF5',
    fontSize: '14px',
    lineHeight: '1.7',
    whiteSpace: 'pre-wrap',
    color: '#3D5A73',
  },
  footer: { marginTop: '14px', textAlign: 'right' },
  footerText: { fontSize: '11px', color: '#B0C4D8' },
};
