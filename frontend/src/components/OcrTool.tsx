import { useState, useRef, ChangeEvent } from 'react';
import { ocrDocument, OcrResponse } from '../services/api';

export function OcrTool() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<OcrResponse | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setError('');
    setResult(null);
    setCopied(false);

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
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.headerSection}>
        <div style={styles.iconBg}>
          <span style={styles.icon}>&#128247;</span>
        </div>
        <div>
          <h3 style={styles.title}>OCR — Scan Document</h3>
          <p style={styles.description}>
            Upload a scanned PDF or image to extract text using AWS Textract. Supports multi-page PDF, PNG, JPEG, and TIFF.
          </p>
        </div>
      </div>

      <label style={styles.uploadLabel}>
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.png,.jpg,.jpeg,.tiff,.tif"
          onChange={handleFileChange}
          style={{ display: 'none' }}
          disabled={loading}
        />
        <span style={loading ? styles.uploadButtonLoading : styles.uploadButton}>
          {loading ? 'Scanning document...' : 'Select File to Scan'}
        </span>
      </label>

      {loading && (
        <div style={styles.loadingBar}>
          <div style={styles.loadingBarFill} />
        </div>
      )}

      {error && <div style={styles.error}>{error}</div>}

      {result && (
        <div style={styles.resultContainer}>
          <div style={styles.resultHeader}>
            <div style={styles.resultMetaRow}>
              <span style={styles.resultFilename}>{result.filename}</span>
              <span style={styles.metaBadge}>{result.pageCount} page{result.pageCount !== 1 ? 's' : ''}</span>
              <span style={styles.metaBadge}>{Math.round(result.confidence)}% confidence</span>
            </div>
            <button onClick={handleCopy} style={styles.copyButton}>
              {copied ? 'Copied!' : 'Copy Text'}
            </button>
          </div>
          <pre style={styles.resultText}>{result.text}</pre>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { padding: '28px', maxWidth: '840px', background: '#ffffff', height: '100%', overflowY: 'auto' },
  headerSection: { display: 'flex', gap: '16px', marginBottom: '24px', alignItems: 'flex-start' },
  iconBg: {
    width: '48px',
    height: '48px',
    borderRadius: '14px',
    background: 'linear-gradient(135deg, #E3F2FD, #BBDEFB)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  icon: { fontSize: '24px' },
  title: { margin: '0 0 4px', fontSize: '18px', fontWeight: 700, color: '#0D2137', letterSpacing: '-0.2px' },
  description: { margin: 0, fontSize: '14px', color: '#6B8299', lineHeight: '1.5' },
  uploadLabel: { display: 'inline-block', cursor: 'pointer' },
  uploadButton: {
    display: 'inline-block',
    padding: '11px 24px',
    background: 'linear-gradient(135deg, #1B6FC9, #1565C0)',
    color: 'white',
    borderRadius: '10px',
    fontSize: '14px',
    fontWeight: 500,
    boxShadow: '0 2px 8px rgba(27, 111, 201, 0.25)',
    cursor: 'pointer',
  },
  uploadButtonLoading: {
    display: 'inline-block',
    padding: '11px 24px',
    background: '#8DA4B8',
    color: 'white',
    borderRadius: '10px',
    fontSize: '14px',
    fontWeight: 500,
    cursor: 'wait',
  },
  loadingBar: {
    marginTop: '16px',
    height: '4px',
    borderRadius: '2px',
    background: '#E8EFF5',
    overflow: 'hidden',
  },
  loadingBarFill: {
    height: '100%',
    width: '40%',
    borderRadius: '2px',
    background: 'linear-gradient(90deg, #1B6FC9, #42A5F5, #1B6FC9)',
    backgroundSize: '200% 100%',
    animation: 'shimmer 1.5s ease-in-out infinite',
  },
  error: { marginTop: '16px', padding: '12px 16px', background: '#fef2f2', color: '#dc2626', borderRadius: '10px', fontSize: '13px', border: '1px solid #fecaca' },
  resultContainer: { marginTop: '24px', border: '1px solid #E8EFF5', borderRadius: '14px', overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' },
  resultHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '14px 18px',
    background: '#F7FAFD',
    borderBottom: '1px solid #E8EFF5',
  },
  resultMetaRow: { display: 'flex', alignItems: 'center', gap: '8px' },
  resultFilename: { fontSize: '13px', fontWeight: 600, color: '#0D2137' },
  metaBadge: { fontSize: '11px', color: '#1B6FC9', background: '#E3F2FD', padding: '3px 8px', borderRadius: '6px', fontWeight: 500 },
  copyButton: {
    padding: '6px 14px',
    background: 'white',
    border: '1px solid #D6E4F0',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: 500,
    color: '#4A6274',
  },
  resultText: {
    padding: '18px',
    margin: 0,
    fontSize: '13px',
    lineHeight: '1.7',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    maxHeight: '400px',
    overflowY: 'auto',
    fontFamily: 'inherit',
    color: '#3D5A73',
    background: '#ffffff',
  },
};
