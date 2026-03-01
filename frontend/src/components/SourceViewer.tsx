import { SourceCitation } from '../types';

interface Props {
  source: SourceCitation;
  onClose: () => void;
}

export function SourceViewer({ source, onClose }: Props) {
  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={e => e.stopPropagation()}>
        <div style={styles.header}>
          <h3 style={styles.title}>{source.documentName}</h3>
          <button onClick={onClose} style={styles.closeButton}>X</button>
        </div>
        {source.pageNumber && (
          <div style={styles.meta}>Page {source.pageNumber}</div>
        )}
        {source.sectionHeader && (
          <div style={styles.meta}>Section: {source.sectionHeader}</div>
        )}
        <div style={styles.meta}>Relevance: {(source.score * 100).toFixed(1)}%</div>
        <div style={styles.textContent}>{source.text}</div>
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
    backgroundColor: 'rgba(0,0,0,0.5)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  modal: {
    backgroundColor: 'white',
    borderRadius: '8px',
    padding: '24px',
    maxWidth: '700px',
    width: '90%',
    maxHeight: '80vh',
    overflowY: 'auto',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '12px',
  },
  title: { margin: 0, fontSize: '18px' },
  closeButton: {
    background: 'none',
    border: 'none',
    fontSize: '18px',
    cursor: 'pointer',
    color: '#666',
  },
  meta: { fontSize: '13px', color: '#666', marginBottom: '4px' },
  textContent: {
    marginTop: '16px',
    padding: '16px',
    backgroundColor: '#f8f9fa',
    borderRadius: '6px',
    fontSize: '14px',
    lineHeight: '1.6',
    whiteSpace: 'pre-wrap',
  },
};
