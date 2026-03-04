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
  container: { padding: '28px', maxWidth: '620px' },
  title: { margin: '0 0 8px', fontSize: '18px', fontWeight: 700, color: '#0D2137', letterSpacing: '-0.2px' },
  description: { margin: '0 0 20px', fontSize: '14px', color: '#6B8299', lineHeight: '1.5' },
  row: { display: 'flex', alignItems: 'center', gap: '12px' },
  label: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', color: '#4A6274', fontWeight: 500 },
  dateInput: { padding: '9px 14px', border: '1px solid #D6E4F0', borderRadius: '10px', fontSize: '14px', background: '#F7FAFD' },
  downloadButton: {
    padding: '9px 22px',
    background: 'linear-gradient(135deg, #1B6FC9, #1565C0)',
    color: 'white',
    border: 'none',
    borderRadius: '10px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: 500,
    boxShadow: '0 2px 8px rgba(27, 111, 201, 0.25)',
  },
  error: { marginTop: '16px', padding: '12px 16px', background: '#fef2f2', color: '#dc2626', borderRadius: '10px', fontSize: '13px', border: '1px solid #fecaca' },
};
