import { useState, useRef, ChangeEvent } from 'react';
import { ocrDocument, OcrResponse } from '../services/api';

export function OcrTool() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<OcrResponse | null>(null);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setError('');
    setResult(null);

    try {
      const ocrResult = await ocrDocument(file);
      setResult(ocrResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'OCR extraction failed');
    } finally {
      setLoading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleCopy = () => {
    if (result?.text) {
      navigator.clipboard.writeText(result.text);
    }
  };

  return (
    <div style={styles.container}>
      <h3 style={styles.title}>OCR — Scan Document</h3>
      <p style={styles.description}>
        Upload a scanned PDF or image to extract text using AWS Textract. Supports PDF, PNG, JPEG, and TIFF (max 10 MB).
      </p>

      <label style={styles.uploadLabel}>
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.png,.jpg,.jpeg,.tiff,.tif"
          onChange={handleFileChange}
          style={{ display: 'none' }}
          disabled={loading}
        />
        <span style={styles.uploadButton}>
          {loading ? 'Scanning...' : 'Select File to Scan'}
        </span>
      </label>

      {error && <div style={styles.error}>{error}</div>}

      {result && (
        <div style={styles.resultContainer}>
          <div style={styles.resultHeader}>
            <span style={styles.resultMeta}>
              {result.filename} — {result.pageCount} page(s) — {Math.round(result.confidence)}% confidence
            </span>
            <button onClick={handleCopy} style={styles.copyButton}>Copy Text</button>
          </div>
          <pre style={styles.resultText}>{result.text}</pre>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { padding: '24px', maxWidth: '800px' },
  title: { margin: '0 0 8px', fontSize: '18px', fontWeight: 600, color: '#1a1a2e' },
  description: { margin: '0 0 16px', fontSize: '14px', color: '#666', lineHeight: '1.5' },
  uploadLabel: { display: 'inline-block', cursor: 'pointer' },
  uploadButton: {
    display: 'inline-block',
    padding: '10px 20px',
    backgroundColor: '#1a1a2e',
    color: 'white',
    borderRadius: '6px',
    fontSize: '14px',
    fontWeight: 500,
  },
  error: { marginTop: '12px', padding: '10px 14px', background: '#fce4ec', color: '#c62828', borderRadius: '6px', fontSize: '13px' },
  resultContainer: { marginTop: '20px', border: '1px solid #ddd', borderRadius: '8px', overflow: 'hidden' },
  resultHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '10px 14px',
    background: '#f5f6f8',
    borderBottom: '1px solid #ddd',
  },
  resultMeta: { fontSize: '13px', color: '#555' },
  copyButton: {
    padding: '4px 12px',
    background: 'white',
    border: '1px solid #ccc',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '12px',
  },
  resultText: {
    padding: '14px',
    margin: 0,
    fontSize: '13px',
    lineHeight: '1.6',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    maxHeight: '400px',
    overflowY: 'auto',
    fontFamily: 'inherit',
  },
};
