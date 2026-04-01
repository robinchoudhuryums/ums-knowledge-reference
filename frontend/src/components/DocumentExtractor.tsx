import { useState, useEffect, useRef, ChangeEvent } from 'react';
import {
  listExtractionTemplates,
  getExtractionTemplate,
  extractDocument,
  ExtractionTemplateInfo,
  ExtractionTemplateDetail,
  ExtractionTemplateField,
  ExtractionResult,
} from '../services/api';

export function DocumentExtractor() {
  const [templates, setTemplates] = useState<ExtractionTemplateInfo[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [templateDetail, setTemplateDetail] = useState<ExtractionTemplateDetail | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [result, setResult] = useState<ExtractionResult | null>(null);
  const [editedData, setEditedData] = useState<Record<string, string | number | boolean | null>>({});
  const [error, setError] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [copied, setCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Load templates on mount
  useEffect(() => {
    listExtractionTemplates()
      .then(res => setTemplates(res.templates))
      .catch(() => setError('Failed to load extraction templates'));
  }, []);

  // Load template detail when selection changes
  useEffect(() => {
    if (!selectedTemplateId) {
      setTemplateDetail(null);
      return;
    }
    getExtractionTemplate(selectedTemplateId)
      .then(res => setTemplateDetail(res.template))
      .catch(() => setError('Failed to load template details'));
  }, [selectedTemplateId]);

  const handleFileSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setResult(null);
      setEditedData({});
      setError('');
    }
  };

  const handleExtract = async () => {
    if (!selectedFile || !selectedTemplateId) return;

    setExtracting(true);
    setError('');
    setResult(null);
    setEditedData({});

    try {
      const res = await extractDocument(selectedFile, selectedTemplateId);
      setResult(res.result);
      setEditedData({ ...res.result.data });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Extraction failed');
    } finally {
      setExtracting(false);
    }
  };

  const handleFieldChange = (key: string, value: string | number | boolean | null) => {
    setEditedData(prev => ({ ...prev, [key]: value }));
  };

  const handleCopyJson = () => {
    navigator.clipboard.writeText(JSON.stringify(editedData, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleExportCsv = () => {
    if (!templateDetail) return;

    // CSV-escape a single field value: wrap in quotes if it contains
    // commas, double quotes, newlines, or carriage returns (RFC 4180).
    const escapeCsvField = (raw: unknown): string => {
      if (raw === null || raw === undefined) return '';
      const str = String(raw);
      if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const headers = templateDetail.fields.map(f => escapeCsvField(f.label));
    const values = templateDetail.fields.map(f => escapeCsvField(editedData[f.key]));
    const csv = headers.join(',') + '\n' + values.join(',');
    // Prepend UTF-8 BOM (\uFEFF) so Excel on Windows correctly interprets the file
    // as UTF-8 instead of ANSI, which would corrupt non-ASCII characters.
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `extraction-${result?.templateId || 'data'}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExportJson = () => {
    const blob = new Blob([JSON.stringify(editedData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `extraction-${result?.templateId || 'data'}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleReset = () => {
    setResult(null);
    setEditedData({});
    setSelectedFile(null);
    setError('');
    if (fileRef.current) fileRef.current.value = '';
  };

  // Group fields by group name
  const groupedFields = templateDetail?.fields.reduce<Record<string, ExtractionTemplateField[]>>((acc, field) => {
    const group = field.group || 'Other';
    if (!acc[group]) acc[group] = [];
    acc[group].push(field);
    return acc;
  }, {}) || {};

  const confidenceColors: Record<string, { bg: string; text: string; border: string }> = {
    high: { bg: '#ecfdf5', text: '#059669', border: '#a7f3d0' },
    medium: { bg: '#fffbeb', text: '#d97706', border: '#fde68a' },
    low: { bg: '#fef2f2', text: '#dc2626', border: '#fecaca' },
  };

  const categoryIcons: Record<string, string> = {
    clinical: '\u{1F3E5}',
    billing: '\u{1F4B3}',
    compliance: '\u{1F6E1}',
    general: '\u{1F4CB}',
  };

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.headerSection}>
        <div style={styles.iconBg}>
          <span style={styles.icon}>{'\u{1F4DD}'}</span>
        </div>
        <div>
          <h3 style={styles.title}>Document Extractor</h3>
          <p style={styles.description}>
            Upload a document and select an extraction template. The AI will read the document and fill out a structured form with the extracted data.
          </p>
        </div>
      </div>

      {/* PHI Warning */}
      <div style={styles.phiWarning}>
        <strong>HIPAA Notice:</strong> If this document contains PHI, ensure you have proper authorization. Extracted data is processed via AWS Bedrock (Sonnet) and is not stored unless you explicitly save it.
      </div>

      {/* Template Selection */}
      {!result && (
        <div style={styles.section}>
          <label style={styles.label}>1. Select Extraction Type</label>
          <div style={styles.templateGrid}>
            {templates.map(t => (
              <button
                key={t.id}
                onClick={() => setSelectedTemplateId(t.id)}
                style={selectedTemplateId === t.id ? styles.templateCardActive : styles.templateCard}
              >
                <div style={styles.templateCardHeader}>
                  <span style={styles.templateIcon}>{categoryIcons[t.category] || '\u{1F4C4}'}</span>
                  <span style={styles.templateCategory}>{t.category}</span>
                </div>
                <div style={styles.templateName}>{t.name}</div>
                <div style={styles.templateDesc}>{t.description}</div>
                <div style={styles.templateMeta}>{t.fieldCount} fields</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* File Upload */}
      {!result && selectedTemplateId && (
        <div style={styles.section}>
          <label style={styles.label}>2. Upload Document</label>
          <div style={styles.uploadRow}>
            <label style={styles.uploadLabel}>
              <input
                ref={fileRef}
                type="file"
                accept=".pdf,.png,.jpg,.jpeg,.tiff,.tif,.docx,.txt"
                onChange={handleFileSelect}
                style={{ display: 'none' }}
                disabled={extracting}
              />
              <span style={styles.uploadButton}>
                {selectedFile ? selectedFile.name : 'Choose File'}
              </span>
            </label>
            {selectedFile && (
              <span style={styles.fileMeta}>
                {(selectedFile.size / 1024).toFixed(0)} KB
              </span>
            )}
          </div>

          {selectedFile && (
            <button
              onClick={handleExtract}
              disabled={extracting}
              style={extracting ? styles.extractButtonDisabled : styles.extractButton}
            >
              {extracting ? 'Extracting data...' : `Extract with ${templateDetail?.name || 'template'}`}
            </button>
          )}

          {extracting && (
            <div style={styles.loadingBar}>
              <div style={styles.loadingBarFill} />
            </div>
          )}
          {extracting && (
            <p style={styles.extractingHint}>
              Analyzing document with Claude Sonnet — this may take 15-30 seconds for large documents.
            </p>
          )}
        </div>
      )}

      {error && <div style={styles.error}>{error}</div>}

      {/* Results Form */}
      {result && templateDetail && (
        <div style={styles.resultSection}>
          {/* Result Header */}
          <div style={styles.resultHeader}>
            <div>
              <h4 style={styles.resultTitle}>{result.templateName} — Extraction Results</h4>
              <p style={styles.resultSubtitle}>
                Source: {selectedFile?.name} | Model: {result.modelUsed.split(':')[0].split('.').pop()}
              </p>
            </div>
            <div style={styles.resultActions}>
              <div style={{
                ...styles.confidenceBadge,
                backgroundColor: confidenceColors[result.confidence].bg,
                color: confidenceColors[result.confidence].text,
                borderColor: confidenceColors[result.confidence].border,
              }}>
                {result.confidence} confidence
              </div>
              <button onClick={handleCopyJson} style={styles.copyButton}>
                {copied ? 'Copied!' : 'Copy JSON'}
              </button>
              <button onClick={handleExportJson} style={styles.copyButton}>
                Export JSON
              </button>
              <button onClick={handleExportCsv} style={styles.copyButton}>
                Export CSV
              </button>
              <button onClick={handleReset} style={styles.resetButton}>
                New Extraction
              </button>
            </div>
          </div>

          {/* Extraction Notes */}
          {result.extractionNotes && (
            <div style={styles.notesBar}>
              <strong>AI Notes:</strong> {result.extractionNotes}
            </div>
          )}

          {/* Editable Form */}
          <div style={styles.formContainer}>
            {Object.entries(groupedFields).map(([group, fields]) => (
              <div key={group} style={styles.fieldGroup}>
                <h5 style={styles.groupTitle}>{group}</h5>
                <div style={styles.fieldsGrid}>
                  {fields.map(field => (
                    <div
                      key={field.key}
                      style={field.type === 'textarea' ? styles.fieldFullWidth : styles.field}
                    >
                      <label style={styles.fieldLabel}>
                        {field.label}
                        {field.required && <span style={styles.requiredStar}>*</span>}
                        {editedData[field.key] === null && (
                          <span style={styles.notFoundBadge}>not found</span>
                        )}
                      </label>
                      {field.description && (
                        <p style={styles.fieldDescription}>{field.description}</p>
                      )}
                      {renderField(field, editedData[field.key], handleFieldChange)}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function renderField(
  field: ExtractionTemplateField,
  value: string | number | boolean | null,
  onChange: (key: string, value: string | number | boolean | null) => void,
) {
  const displayValue = value === null ? '' : String(value);

  switch (field.type) {
    case 'textarea':
      return (
        <textarea
          value={displayValue}
          onChange={e => onChange(field.key, e.target.value || null)}
          style={styles.textarea}
          rows={3}
          placeholder={`Enter ${field.label.toLowerCase()}...`}
        />
      );

    case 'select':
      return (
        <select
          value={displayValue}
          onChange={e => onChange(field.key, e.target.value || null)}
          style={styles.select}
        >
          <option value="">— Select —</option>
          {field.options?.map(opt => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      );

    case 'number':
      return (
        <input
          type="number"
          value={displayValue}
          onChange={e => onChange(field.key, e.target.value ? Number(e.target.value) : null)}
          style={styles.input}
          placeholder={`Enter ${field.label.toLowerCase()}...`}
        />
      );

    case 'boolean':
      return (
        <select
          value={value === null ? '' : String(value)}
          onChange={e => {
            const v = e.target.value;
            onChange(field.key, v === '' ? null : v === 'true');
          }}
          style={styles.select}
        >
          <option value="">— Select —</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      );

    case 'date':
      return (
        <input
          type="date"
          value={displayValue}
          onChange={e => onChange(field.key, e.target.value || null)}
          style={styles.input}
        />
      );

    default:
      return (
        <input
          type="text"
          value={displayValue}
          onChange={e => onChange(field.key, e.target.value || null)}
          style={styles.input}
          placeholder={`Enter ${field.label.toLowerCase()}...`}
        />
      );
  }
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: '28px',
    maxWidth: '960px',
    background: 'var(--ums-bg-surface)',
    height: '100%',
    overflowY: 'auto',
  },
  headerSection: {
    display: 'flex',
    gap: '16px',
    marginBottom: '20px',
    alignItems: 'flex-start',
  },
  iconBg: {
    width: '48px',
    height: '48px',
    borderRadius: '14px',
    background: 'linear-gradient(135deg, #EDE9FE, #DDD6FE)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  icon: { fontSize: '24px' },
  title: {
    margin: '0 0 4px',
    fontSize: '18px',
    fontWeight: 700,
    color: 'var(--ums-text-primary)',
    letterSpacing: '-0.2px',
  },
  description: {
    margin: 0,
    fontSize: '14px',
    color: 'var(--ums-text-muted)',
    lineHeight: '1.5',
  },
  phiWarning: {
    padding: '12px 16px',
    background: '#FFFBEB',
    borderRadius: '10px',
    fontSize: '13px',
    color: 'var(--ums-warning-text)',
    border: '1px solid #FDE68A',
    marginBottom: '24px',
    lineHeight: '1.5',
  },
  section: {
    marginBottom: '24px',
  },
  label: {
    display: 'block',
    fontSize: '13px',
    fontWeight: 600,
    color: 'var(--ums-text-primary)',
    marginBottom: '12px',
  },
  templateGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
    gap: '12px',
  },
  templateCard: {
    padding: '16px',
    border: '1px solid var(--ums-border)',
    borderRadius: '12px',
    background: 'var(--ums-bg-surface-alt)',
    cursor: 'pointer',
    textAlign: 'left' as const,
    transition: 'all 0.2s ease',
  },
  templateCardActive: {
    padding: '16px',
    border: '2px solid var(--ums-brand-primary)',
    borderRadius: '12px',
    background: 'var(--ums-bg-surface-alt)',
    cursor: 'pointer',
    textAlign: 'left' as const,
    boxShadow: '0 0 0 3px rgba(27, 111, 201, 0.1)',
  },
  templateCardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '8px',
  },
  templateIcon: { fontSize: '18px' },
  templateCategory: {
    fontSize: '10px',
    textTransform: 'uppercase' as const,
    color: 'var(--ums-text-muted)',
    fontWeight: 600,
    letterSpacing: '0.5px',
  },
  templateName: {
    fontSize: '14px',
    fontWeight: 600,
    color: 'var(--ums-text-primary)',
    marginBottom: '4px',
  },
  templateDesc: {
    fontSize: '12px',
    color: 'var(--ums-text-muted)',
    lineHeight: '1.4',
    marginBottom: '8px',
  },
  templateMeta: {
    fontSize: '11px',
    color: 'var(--ums-text-muted)',
  },
  uploadRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '16px',
  },
  uploadLabel: { cursor: 'pointer' },
  uploadButton: {
    display: 'inline-block',
    padding: '10px 20px',
    background: 'var(--ums-bg-surface-alt)',
    color: 'var(--ums-brand-primary)',
    borderRadius: '10px',
    fontSize: '13px',
    fontWeight: 500,
    border: '1px solid var(--ums-border)',
    cursor: 'pointer',
  },
  fileMeta: {
    fontSize: '12px',
    color: 'var(--ums-text-muted)',
  },
  extractButton: {
    padding: '12px 28px',
    background: 'linear-gradient(135deg, #7C3AED, #6D28D9)',
    color: 'white',
    border: 'none',
    borderRadius: '10px',
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'pointer',
    boxShadow: '0 2px 8px rgba(124, 58, 237, 0.25)',
  },
  extractButtonDisabled: {
    padding: '12px 28px',
    background: 'var(--ums-text-muted)',
    color: 'white',
    border: 'none',
    borderRadius: '10px',
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'wait',
  },
  loadingBar: {
    marginTop: '16px',
    height: '4px',
    borderRadius: '2px',
    background: 'var(--ums-border)',
    overflow: 'hidden',
  },
  loadingBarFill: {
    height: '100%',
    width: '40%',
    borderRadius: '2px',
    background: 'linear-gradient(90deg, #7C3AED, #A78BFA, #7C3AED)',
    backgroundSize: '200% 100%',
    animation: 'shimmer 1.5s ease-in-out infinite',
  },
  extractingHint: {
    fontSize: '12px',
    color: 'var(--ums-text-muted)',
    marginTop: '8px',
  },
  error: {
    marginTop: '16px',
    padding: '12px 16px',
    background: '#fef2f2',
    color: 'var(--ums-error-text)',
    borderRadius: '10px',
    fontSize: '13px',
    border: '1px solid #fecaca',
  },
  resultSection: {
    border: '1px solid var(--ums-border)',
    borderRadius: '14px',
    overflow: 'hidden',
    boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
  },
  resultHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: '18px 20px',
    background: 'var(--ums-bg-surface-alt)',
    borderBottom: '1px solid var(--ums-border)',
    flexWrap: 'wrap' as const,
    gap: '12px',
  },
  resultTitle: {
    margin: '0 0 4px',
    fontSize: '16px',
    fontWeight: 700,
    color: 'var(--ums-text-primary)',
  },
  resultSubtitle: {
    margin: 0,
    fontSize: '12px',
    color: 'var(--ums-text-muted)',
  },
  resultActions: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap' as const,
  },
  confidenceBadge: {
    padding: '4px 12px',
    borderRadius: '8px',
    fontSize: '12px',
    fontWeight: 600,
    border: '1px solid',
    textTransform: 'capitalize' as const,
  },
  copyButton: {
    padding: '6px 14px',
    background: 'var(--ums-bg-surface)',
    border: '1px solid var(--ums-border)',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: 500,
    color: 'var(--ums-text-muted)',
  },
  resetButton: {
    padding: '6px 14px',
    background: 'linear-gradient(135deg, #7C3AED, #6D28D9)',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: 500,
  },
  notesBar: {
    padding: '12px 20px',
    background: 'var(--ums-bg-surface-alt)',
    fontSize: '13px',
    color: 'var(--ums-brand-text)',
    borderBottom: '1px solid var(--ums-border)',
    lineHeight: '1.5',
  },
  formContainer: {
    padding: '20px',
  },
  fieldGroup: {
    marginBottom: '24px',
  },
  groupTitle: {
    margin: '0 0 12px',
    fontSize: '13px',
    fontWeight: 700,
    color: 'var(--ums-text-primary)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    paddingBottom: '8px',
    borderBottom: '2px solid var(--ums-border)',
  },
  fieldsGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '16px',
  },
  field: {},
  fieldFullWidth: {
    gridColumn: '1 / -1',
  },
  fieldLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '12px',
    fontWeight: 600,
    color: 'var(--ums-text-muted)',
    marginBottom: '4px',
  },
  requiredStar: {
    color: 'var(--ums-error-text)',
  },
  notFoundBadge: {
    fontSize: '10px',
    padding: '1px 6px',
    background: '#FEF2F2',
    color: 'var(--ums-error-text)',
    borderRadius: '4px',
    fontWeight: 500,
  },
  fieldDescription: {
    margin: '0 0 4px',
    fontSize: '11px',
    color: 'var(--ums-text-muted)',
    lineHeight: '1.3',
  },
  input: {
    width: '100%',
    padding: '8px 12px',
    border: '1px solid var(--ums-border)',
    borderRadius: '8px',
    fontSize: '13px',
    color: 'var(--ums-text-primary)',
    background: 'var(--ums-bg-surface-alt)',
    boxSizing: 'border-box' as const,
    outline: 'none',
  },
  textarea: {
    width: '100%',
    padding: '8px 12px',
    border: '1px solid var(--ums-border)',
    borderRadius: '8px',
    fontSize: '13px',
    color: 'var(--ums-text-primary)',
    background: 'var(--ums-bg-surface-alt)',
    boxSizing: 'border-box' as const,
    resize: 'vertical' as const,
    fontFamily: 'inherit',
    outline: 'none',
  },
  select: {
    width: '100%',
    padding: '8px 12px',
    border: '1px solid var(--ums-border)',
    borderRadius: '8px',
    fontSize: '13px',
    color: 'var(--ums-text-primary)',
    background: 'var(--ums-bg-surface-alt)',
    boxSizing: 'border-box' as const,
    outline: 'none',
  },
};
