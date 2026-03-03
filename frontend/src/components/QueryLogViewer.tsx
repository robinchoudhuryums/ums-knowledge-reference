import { useState } from 'react';
import { downloadQueryLogCsv } from '../services/api';

export function QueryLogViewer() {
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');

  const handleDownload = async () => {
    setDownloading(true);
    setError('');
    try {
      await downloadQueryLogCsv(date);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div style={styles.container}>
      <h3 style={styles.title}>Query Log Export</h3>
      <p style={styles.description}>
        Download a CSV of all queries, responses, and confidence levels for a given date.
        Includes agent username, question, answer (truncated), confidence, and source documents.
      </p>

      <div style={styles.row}>
        <label style={styles.label}>
          Date:
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            style={styles.dateInput}
          />
        </label>
        <button
          onClick={handleDownload}
          disabled={downloading}
          style={{
            ...styles.downloadButton,
            opacity: downloading ? 0.6 : 1,
          }}
        >
          {downloading ? 'Downloading...' : 'Download CSV'}
        </button>
      </div>

      {error && <div style={styles.error}>{error}</div>}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { padding: '24px', maxWidth: '600px' },
  title: { margin: '0 0 8px', fontSize: '18px', fontWeight: 600, color: '#1a1a2e' },
  description: { margin: '0 0 16px', fontSize: '14px', color: '#666', lineHeight: '1.5' },
  row: { display: 'flex', alignItems: 'center', gap: '12px' },
  label: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', color: '#333' },
  dateInput: { padding: '8px 12px', border: '1px solid #ccc', borderRadius: '6px', fontSize: '14px' },
  downloadButton: {
    padding: '8px 18px',
    backgroundColor: '#1a1a2e',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 500,
  },
  error: { marginTop: '12px', padding: '10px 14px', background: '#fce4ec', color: '#c62828', borderRadius: '6px', fontSize: '13px' },
};
