import { useState, useRef, ChangeEvent } from 'react';
import {
  ocrDocument,
  OcrResponse,
  reviewForm,
  reviewFormBatch,
  downloadAnnotatedPdf,
  downloadOriginalPdf,
  FormReviewResult,
  BatchFormReviewResult,
} from '../services/api';

type Mode = 'ocr' | 'form-review' | 'batch-review';

export function OcrTool() {
  const [mode, setMode] = useState<Mode>('ocr');
  const [loading, setLoading] = useState(false);
  const [ocrResult, setOcrResult] = useState<OcrResponse | null>(null);
  const [formResult, setFormResult] = useState<FormReviewResult | null>(null);
  const [batchResult, setBatchResult] = useState<BatchFormReviewResult | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState<'annotated' | 'original' | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [expandedBatchIndex, setExpandedBatchIndex] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const batchFileRef = useRef<HTMLInputElement>(null);

  const resetState = () => {
    setOcrResult(null);
    setFormResult(null);
    setBatchResult(null);
    setSelectedFile(null);
    setSelectedFiles([]);
    setError('');
    setCopied(false);
    setDownloading(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setShowPreview(false);
    setExpandedBatchIndex(null);
    if (fileRef.current) fileRef.current.value = '';
    if (batchFileRef.current) batchFileRef.current.value = '';
  };

  const handleModeSwitch = (newMode: Mode) => {
    if (newMode === mode) return;
    resetState();
    setMode(newMode);
  };

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setError('');
    setOcrResult(null);
    setFormResult(null);
    setCopied(false);
    setSelectedFile(file);

    try {
      if (mode === 'ocr') {
        const result = await ocrDocument(file);
        setOcrResult(result);
      } else {
        const result = await reviewForm(file);
        setFormResult(result);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : `${mode === 'ocr' ? 'OCR extraction' : 'Form review'} failed`);
    } finally {
      setLoading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleBatchFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const fileArray = Array.from(files).slice(0, 10); // Max 10 files
    setLoading(true);
    setError('');
    setBatchResult(null);
    setSelectedFiles(fileArray);

    try {
      const result = await reviewFormBatch(fileArray);
      setBatchResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Batch form review failed');
    } finally {
      setLoading(false);
      if (batchFileRef.current) batchFileRef.current.value = '';
    }
  };

  const handleCopy = () => {
    if (ocrResult?.text) {
      navigator.clipboard.writeText(ocrResult.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownloadAnnotated = async () => {
    if (!selectedFile) return;
    setDownloading('annotated');
    try {
      const blob = await downloadAnnotatedPdf(selectedFile);
      triggerDownload(blob, `REVIEW-${selectedFile.name}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to download annotated PDF');
    } finally {
      setDownloading(null);
    }
  };

  const handleDownloadOriginal = async () => {
    if (!selectedFile) return;
    setDownloading('original');
    try {
      const blob = await downloadOriginalPdf(selectedFile);
      triggerDownload(blob, selectedFile.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to download original PDF');
    } finally {
      setDownloading(null);
    }
  };

  const handlePreviewAnnotated = async () => {
    if (!selectedFile) return;
    setDownloading('annotated');
    try {
      const blob = await downloadAnnotatedPdf(selectedFile);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      const url = URL.createObjectURL(blob);
      setPreviewUrl(url);
      setShowPreview(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load preview');
    } finally {
      setDownloading(null);
    }
  };

  const isPdf = selectedFile?.name.toLowerCase().endsWith('.pdf');

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.headerSection}>
        <div style={mode === 'ocr' ? styles.iconBg : styles.iconBgForm}>
          <span style={styles.icon}>
            {mode === 'batch-review' ? '\u{1F4DA}' : mode === 'form-review' ? '\u{1F4CB}' : '\u{1F4F7}'}
          </span>
        </div>
        <div>
          <h3 style={styles.title}>
            {mode === 'batch-review'
              ? 'Batch Form Review — Multiple Files'
              : mode === 'form-review'
                ? 'Form Review — Detect Missing Fields'
                : 'OCR — Scan Document'}
          </h3>
          <p style={styles.description}>
            {mode === 'batch-review'
              ? 'Upload up to 10 forms at once for completeness checking. Get a summary table showing which forms need attention.'
              : mode === 'form-review'
                ? 'Upload a DME form to detect blank fields. Auto-detects CMN form types and highlights required fields. Cached results skip Textract charges.'
                : 'Upload a scanned PDF or image to extract text using AWS Textract. Supports multi-page PDF, PNG, JPEG, and TIFF.'}
          </p>
        </div>
      </div>

      {/* Mode Toggle */}
      <div style={styles.toggleRow}>
        <button
          onClick={() => handleModeSwitch('ocr')}
          style={mode === 'ocr' ? styles.toggleActive : styles.toggleInactive}
        >
          OCR Text Extract
        </button>
        <button
          onClick={() => handleModeSwitch('form-review')}
          style={mode === 'form-review' ? styles.toggleActiveForm : styles.toggleInactive}
        >
          Form Review
        </button>
        <button
          onClick={() => handleModeSwitch('batch-review')}
          style={mode === 'batch-review' ? styles.toggleActiveForm : styles.toggleInactive}
        >
          Batch Review
        </button>
      </div>

      {/* Upload */}
      {mode === 'batch-review' ? (
        <label style={styles.uploadLabel}>
          <input
            ref={batchFileRef}
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.tiff,.tif"
            onChange={handleBatchFileChange}
            style={{ display: 'none' }}
            disabled={loading}
            multiple
          />
          <span style={loading ? styles.uploadButtonLoading : styles.uploadButtonForm}>
            {loading ? `Analyzing ${selectedFiles.length} form${selectedFiles.length !== 1 ? 's' : ''}...` : 'Select Files (up to 10)'}
          </span>
        </label>
      ) : (
        <label style={styles.uploadLabel}>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.tiff,.tif"
            onChange={handleFileChange}
            style={{ display: 'none' }}
            disabled={loading}
          />
          <span style={loading ? styles.uploadButtonLoading : (mode === 'form-review' ? styles.uploadButtonForm : styles.uploadButton)}>
            {loading
              ? (mode === 'form-review' ? 'Analyzing form fields...' : 'Scanning document...')
              : 'Select File'}
          </span>
        </label>
      )}

      {loading && (
        <>
          <div style={styles.loadingBar}>
            <div style={mode === 'ocr' ? styles.loadingBarFill : styles.loadingBarFillForm} />
          </div>
          {mode !== 'ocr' && (
            <p style={styles.hint}>
              Textract is analyzing the form structure to detect fields and checkboxes. This may take 15-60 seconds for multi-page PDFs.
              {mode === 'batch-review' && ' Cached forms will be skipped (no extra charge).'}
            </p>
          )}
        </>
      )}

      {error && <div style={styles.error}>{error}</div>}

      {/* OCR Results */}
      {ocrResult && mode === 'ocr' && (
        <div style={styles.resultContainer}>
          <div style={styles.resultHeader}>
            <div style={styles.resultMetaRow}>
              <span style={styles.resultFilename}>{ocrResult.filename}</span>
              <span style={styles.metaBadge}>{ocrResult.pageCount} page{ocrResult.pageCount !== 1 ? 's' : ''}</span>
              <span style={styles.metaBadge}>{Math.round(ocrResult.confidence)}% confidence</span>
            </div>
            <button onClick={handleCopy} style={styles.copyButton}>
              {copied ? 'Copied!' : 'Copy Text'}
            </button>
          </div>
          <pre style={styles.resultText}>{ocrResult.text}</pre>
        </div>
      )}

      {/* Form Review Results */}
      {formResult && mode === 'form-review' && (
        <div style={styles.formResultContainer}>
          {/* Summary Header */}
          <div style={styles.formResultHeader}>
            <div>
              <h4 style={styles.formResultTitle}>{formResult.filename}</h4>
              <div style={styles.formMetaRow}>
                <span style={styles.metaBadge}>{formResult.pageCount} page{formResult.pageCount !== 1 ? 's' : ''}</span>
                <span style={styles.metaBadge}>{formResult.totalFields} fields detected</span>
                <span style={formResult.emptyCount > 0 ? styles.metaBadgeRed : styles.metaBadgeGreen}>
                  {formResult.emptyCount > 0
                    ? `${formResult.emptyCount} field${formResult.emptyCount !== 1 ? 's' : ''} missing`
                    : 'All fields complete'}
                </span>
                {formResult.cached && (
                  <span style={styles.metaBadgeCached}>Cached (no charge)</span>
                )}
              </div>
            </div>
          </div>

          {/* Form Type Detection */}
          {formResult.formType && (
            <div style={styles.formTypeSection}>
              <span style={styles.formTypeLabel}>Detected form:</span>
              <span style={styles.formTypeName}>{formResult.formType.name}</span>
              <span style={styles.formTypeDesc}>{formResult.formType.description}</span>
            </div>
          )}

          {/* Required Missing Fields Alert */}
          {formResult.requiredMissingCount > 0 && (
            <div style={styles.requiredAlert}>
              <span style={styles.requiredAlertIcon}>!</span>
              <div>
                <strong>{formResult.requiredMissingCount} required field{formResult.requiredMissingCount !== 1 ? 's' : ''} missing</strong>
                <div style={styles.requiredList}>
                  {formResult.requiredMissingFields.map((f, i) => (
                    <span key={i} style={styles.requiredItem}>
                      {f.requiredLabel || f.key}
                      {f.section && <span style={styles.sectionTag}>{f.section}</span>}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Download + Preview Buttons */}
          {isPdf && formResult.emptyCount > 0 && (
            <div style={styles.downloadSection}>
              <p style={styles.downloadLabel}>Download PDFs to send to provider:</p>
              <div style={styles.downloadRow}>
                <button
                  onClick={handleDownloadAnnotated}
                  disabled={!!downloading}
                  style={downloading === 'annotated' ? styles.downloadBtnDisabled : styles.downloadBtnAnnotated}
                >
                  {downloading === 'annotated' ? 'Generating...' : 'Download Marked-Up Example'}
                </button>
                <button
                  onClick={handleDownloadOriginal}
                  disabled={!!downloading}
                  style={downloading === 'original' ? styles.downloadBtnDisabled : styles.downloadBtnOriginal}
                >
                  {downloading === 'original' ? 'Downloading...' : 'Download Original (for correction)'}
                </button>
                <button
                  onClick={handlePreviewAnnotated}
                  disabled={!!downloading}
                  style={downloading ? styles.downloadBtnDisabled : styles.previewBtn}
                >
                  {downloading === 'annotated' && !showPreview ? 'Loading...' : 'Preview Annotated'}
                </button>
              </div>
              <p style={styles.downloadHint}>
                The marked-up copy has a watermark and cannot be submitted to insurance. Send both copies so the provider sees what to fix.
              </p>
            </div>
          )}

          {/* In-browser PDF Preview */}
          {showPreview && previewUrl && (
            <div style={styles.previewSection}>
              <div style={styles.previewHeader}>
                <span style={styles.previewTitle}>Annotated PDF Preview</span>
                <button onClick={() => setShowPreview(false)} style={styles.previewClose}>Close Preview</button>
              </div>
              <iframe
                src={previewUrl}
                style={styles.previewIframe}
                title="Annotated PDF Preview"
              />
            </div>
          )}

          {/* Completion Bar */}
          <div style={styles.completionSection}>
            <div style={styles.completionBarBg}>
              <div
                style={{
                  ...styles.completionBarFill,
                  width: `${formResult.completionPercentage}%`,
                  background: formResult.completionPercentage >= 90
                    ? 'linear-gradient(90deg, #059669, #34D399)'
                    : formResult.completionPercentage >= 70
                      ? 'linear-gradient(90deg, #D97706, #FBBF24)'
                      : 'linear-gradient(90deg, #DC2626, #F87171)',
                }}
              />
            </div>
            <span style={styles.completionLabel}>
              {formResult.completionPercentage}% complete
            </span>
          </div>

          {/* Low Confidence Fields Warning */}
          {formResult.lowConfidenceCount > 0 && (
            <div style={styles.lowConfSection}>
              <h5 style={styles.lowConfTitle}>
                Low Confidence Fields ({formResult.lowConfidenceCount}) — Verify Manually
              </h5>
              <div style={styles.fieldList}>
                {formResult.lowConfidenceFields.map((f, i) => (
                  <div key={i} style={styles.fieldItemLowConf}>
                    <span style={styles.lowConfBadge}>?</span>
                    <span style={styles.fieldKey}>{f.key || '(unlabeled field)'}</span>
                    <span style={styles.lowConfValue}>{f.value || '(empty)'}</span>
                    <span style={styles.fieldConfidence}>{f.confidence}%</span>
                    <span style={styles.fieldPage}>Page {f.page}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Empty Fields List */}
          {formResult.emptyCount > 0 && (
            <div style={styles.fieldSection}>
              <h5 style={styles.fieldSectionTitle}>Missing / Blank Fields ({formResult.emptyCount})</h5>
              <div style={styles.fieldList}>
                {formResult.emptyFields.map((f, i) => (
                  <div key={i} style={f.isRequired ? styles.fieldItemRequired : styles.fieldItemEmpty}>
                    <span style={f.isRequired ? styles.fieldNumberRequired : styles.fieldNumber}>
                      {f.isRequired ? 'REQ' : `#${i + 1}`}
                    </span>
                    <span style={styles.fieldKey}>
                      {f.key || '(unlabeled field)'}
                      {f.isCheckbox && <span style={styles.checkboxTag}>checkbox</span>}
                    </span>
                    {f.section && <span style={styles.sectionTag}>{f.section}</span>}
                    <span style={styles.fieldPage}>Page {f.page}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Filled Fields (collapsed by default) */}
          {formResult.filledFields.length > 0 && (
            <FilledFieldsSection fields={formResult.filledFields} />
          )}

          {/* New Review Button */}
          <div style={styles.newReviewRow}>
            <button onClick={resetState} style={styles.newReviewButton}>
              Review Another Form
            </button>
          </div>
        </div>
      )}

      {/* Batch Review Results */}
      {batchResult && mode === 'batch-review' && (
        <div style={styles.formResultContainer}>
          <div style={styles.formResultHeader}>
            <div>
              <h4 style={styles.formResultTitle}>Batch Results — {batchResult.fileCount} Files</h4>
              <div style={styles.formMetaRow}>
                {batchResult.totalCachedCount > 0 && (
                  <span style={styles.metaBadgeCached}>
                    {batchResult.totalCachedCount} cached (no charge)
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Summary Table */}
          <div style={styles.batchTableContainer}>
            <table style={styles.batchTable}>
              <thead>
                <tr>
                  <th style={styles.batchTh}>File</th>
                  <th style={styles.batchTh}>Form Type</th>
                  <th style={styles.batchTh}>Fields</th>
                  <th style={styles.batchTh}>Missing</th>
                  <th style={styles.batchTh}>Req. Missing</th>
                  <th style={styles.batchTh}>Completion</th>
                  <th style={styles.batchTh}>Status</th>
                </tr>
              </thead>
              <tbody>
                {batchResult.results.map((r, i) => (
                  <tr
                    key={i}
                    style={expandedBatchIndex === i ? styles.batchTrSelected : styles.batchTr}
                    onClick={() => setExpandedBatchIndex(expandedBatchIndex === i ? null : i)}
                  >
                    <td style={styles.batchTd}>
                      <span style={styles.batchFilename}>{r.filename}</span>
                      {r.cached && <span style={styles.cachedDot} title="Cached result" />}
                    </td>
                    <td style={styles.batchTd}>
                      <span style={styles.batchFormType}>{r.formType?.name || 'Unknown'}</span>
                    </td>
                    <td style={styles.batchTdCenter}>{r.totalFields}</td>
                    <td style={styles.batchTdCenter}>
                      <span style={r.emptyCount > 0 ? styles.batchMissingBad : styles.batchMissingGood}>
                        {r.emptyCount}
                      </span>
                    </td>
                    <td style={styles.batchTdCenter}>
                      <span style={r.requiredMissingCount > 0 ? styles.batchReqBad : styles.batchMissingGood}>
                        {r.requiredMissingCount}
                      </span>
                    </td>
                    <td style={styles.batchTdCenter}>
                      <div style={styles.batchBarBg}>
                        <div style={{
                          ...styles.batchBarFill,
                          width: `${r.completionPercentage}%`,
                          background: r.completionPercentage >= 90 ? '#059669'
                            : r.completionPercentage >= 70 ? '#D97706' : '#DC2626',
                        }} />
                      </div>
                      <span style={styles.batchPct}>{r.completionPercentage}%</span>
                    </td>
                    <td style={styles.batchTdCenter}>
                      <span style={r.emptyCount === 0 ? styles.statusComplete : (r.requiredMissingCount > 0 ? styles.statusCritical : styles.statusIncomplete)}>
                        {r.emptyCount === 0 ? 'Complete' : (r.requiredMissingCount > 0 ? 'Action Needed' : 'Incomplete')}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Expanded detail for selected batch item */}
          {expandedBatchIndex !== null && batchResult.results[expandedBatchIndex] && (
            <div style={styles.batchDetail}>
              <h5 style={styles.batchDetailTitle}>
                {batchResult.results[expandedBatchIndex].filename} — Missing Fields
              </h5>
              {batchResult.results[expandedBatchIndex].emptyFields.length === 0 ? (
                <p style={styles.batchDetailComplete}>All fields complete!</p>
              ) : (
                <div style={styles.fieldList}>
                  {batchResult.results[expandedBatchIndex].emptyFields.map((f, i) => (
                    <div key={i} style={f.isRequired ? styles.fieldItemRequired : styles.fieldItemEmpty}>
                      <span style={f.isRequired ? styles.fieldNumberRequired : styles.fieldNumber}>
                        {f.isRequired ? 'REQ' : `#${i + 1}`}
                      </span>
                      <span style={styles.fieldKey}>{f.key || '(unlabeled)'}</span>
                      {f.section && <span style={styles.sectionTag}>{f.section}</span>}
                      <span style={styles.fieldPage}>Page {f.page}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div style={styles.newReviewRow}>
            <button onClick={resetState} style={styles.newReviewButton}>
              Review More Forms
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Collapsible filled fields section */
function FilledFieldsSection({ fields }: { fields: Array<{ key: string; value?: string; page: number; confidence: number; section?: string }> }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div style={styles.fieldSection}>
      <button onClick={() => setExpanded(!expanded)} style={styles.filledToggle}>
        <span style={styles.fieldSectionTitleGreen}>
          Completed Fields ({fields.length})
        </span>
        <span style={styles.expandArrow}>{expanded ? '\u25B2' : '\u25BC'}</span>
      </button>
      {expanded && (
        <div style={styles.fieldList}>
          {fields.map((f, i) => (
            <div key={i} style={styles.fieldItemFilled}>
              <span style={styles.fieldKey}>{f.key || '(unlabeled)'}</span>
              <span style={styles.fieldValue}>{f.value}</span>
              {f.section && <span style={styles.sectionTag}>{f.section}</span>}
              <span style={styles.fieldPage}>Page {f.page}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const styles: Record<string, React.CSSProperties> = {
  container: { padding: '28px', maxWidth: '960px', background: '#ffffff', height: '100%', overflowY: 'auto' },
  headerSection: { display: 'flex', gap: '16px', marginBottom: '20px', alignItems: 'flex-start' },
  iconBg: {
    width: '48px', height: '48px', borderRadius: '14px',
    background: 'linear-gradient(135deg, #E3F2FD, #BBDEFB)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  iconBgForm: {
    width: '48px', height: '48px', borderRadius: '14px',
    background: 'linear-gradient(135deg, #FFF3E0, #FFE0B2)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  icon: { fontSize: '24px' },
  title: { margin: '0 0 4px', fontSize: '18px', fontWeight: 700, color: '#0D2137', letterSpacing: '-0.2px' },
  description: { margin: 0, fontSize: '14px', color: '#6B8299', lineHeight: '1.5' },

  // Mode toggle
  toggleRow: {
    display: 'flex', gap: '4px', marginBottom: '20px',
    background: '#F1F5F9', borderRadius: '10px', padding: '3px',
  },
  toggleActive: {
    flex: 1, padding: '8px 16px', border: 'none', borderRadius: '8px',
    background: 'white', color: '#1565C0', fontSize: '13px', fontWeight: 600,
    cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
  },
  toggleActiveForm: {
    flex: 1, padding: '8px 16px', border: 'none', borderRadius: '8px',
    background: 'white', color: '#E65100', fontSize: '13px', fontWeight: 600,
    cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
  },
  toggleInactive: {
    flex: 1, padding: '8px 16px', border: 'none', borderRadius: '8px',
    background: 'transparent', color: '#8DA4B8', fontSize: '13px', fontWeight: 500,
    cursor: 'pointer',
  },

  // Upload
  uploadLabel: { display: 'inline-block', cursor: 'pointer' },
  uploadButton: {
    display: 'inline-block', padding: '11px 24px',
    background: 'linear-gradient(135deg, #1B6FC9, #1565C0)', color: 'white',
    borderRadius: '10px', fontSize: '14px', fontWeight: 500,
    boxShadow: '0 2px 8px rgba(27, 111, 201, 0.25)', cursor: 'pointer',
  },
  uploadButtonForm: {
    display: 'inline-block', padding: '11px 24px',
    background: 'linear-gradient(135deg, #E65100, #BF360C)', color: 'white',
    borderRadius: '10px', fontSize: '14px', fontWeight: 500,
    boxShadow: '0 2px 8px rgba(230, 81, 0, 0.25)', cursor: 'pointer',
  },
  uploadButtonLoading: {
    display: 'inline-block', padding: '11px 24px', background: '#8DA4B8',
    color: 'white', borderRadius: '10px', fontSize: '14px', fontWeight: 500, cursor: 'wait',
  },

  // Loading
  loadingBar: {
    marginTop: '16px', height: '4px', borderRadius: '2px',
    background: '#E8EFF5', overflow: 'hidden',
  },
  loadingBarFill: {
    height: '100%', width: '40%', borderRadius: '2px',
    background: 'linear-gradient(90deg, #1B6FC9, #42A5F5, #1B6FC9)',
    backgroundSize: '200% 100%', animation: 'shimmer 1.5s ease-in-out infinite',
  },
  loadingBarFillForm: {
    height: '100%', width: '40%', borderRadius: '2px',
    background: 'linear-gradient(90deg, #E65100, #FF8F00, #E65100)',
    backgroundSize: '200% 100%', animation: 'shimmer 1.5s ease-in-out infinite',
  },
  hint: { fontSize: '12px', color: '#8DA4B8', marginTop: '8px' },
  error: {
    marginTop: '16px', padding: '12px 16px', background: '#fef2f2',
    color: '#dc2626', borderRadius: '10px', fontSize: '13px', border: '1px solid #fecaca',
  },

  // OCR results
  resultContainer: {
    marginTop: '24px', border: '1px solid #E8EFF5', borderRadius: '14px',
    overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
  },
  resultHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '14px 18px', background: '#F7FAFD', borderBottom: '1px solid #E8EFF5',
  },
  resultMetaRow: { display: 'flex', alignItems: 'center', gap: '8px' },
  resultFilename: { fontSize: '13px', fontWeight: 600, color: '#0D2137' },
  metaBadge: {
    fontSize: '11px', color: '#1B6FC9', background: '#E3F2FD',
    padding: '3px 8px', borderRadius: '6px', fontWeight: 500,
  },
  metaBadgeRed: {
    fontSize: '11px', color: '#DC2626', background: '#FEF2F2',
    padding: '3px 8px', borderRadius: '6px', fontWeight: 600,
    border: '1px solid #FECACA',
  },
  metaBadgeGreen: {
    fontSize: '11px', color: '#059669', background: '#ECFDF5',
    padding: '3px 8px', borderRadius: '6px', fontWeight: 600,
    border: '1px solid #A7F3D0',
  },
  metaBadgeCached: {
    fontSize: '11px', color: '#7C3AED', background: '#F5F3FF',
    padding: '3px 8px', borderRadius: '6px', fontWeight: 600,
    border: '1px solid #DDD6FE',
  },
  copyButton: {
    padding: '6px 14px', background: 'white', border: '1px solid #D6E4F0',
    borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: 500, color: '#4A6274',
  },
  resultText: {
    padding: '18px', margin: 0, fontSize: '13px', lineHeight: '1.7',
    whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: '400px',
    overflowY: 'auto', fontFamily: 'inherit', color: '#3D5A73', background: '#ffffff',
  },

  // Form Review results
  formResultContainer: {
    marginTop: '24px', border: '1px solid #E8EFF5', borderRadius: '14px',
    overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
  },
  formResultHeader: {
    padding: '18px 20px', background: '#FFF8F0', borderBottom: '1px solid #FFE0B2',
  },
  formResultTitle: {
    margin: '0 0 8px', fontSize: '16px', fontWeight: 700, color: '#0D2137',
  },
  formMetaRow: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' as const },

  // Form type detection
  formTypeSection: {
    padding: '12px 20px', background: '#F0F7FF', borderBottom: '1px solid #E8EFF5',
    display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' as const,
  },
  formTypeLabel: { fontSize: '12px', color: '#6B8299', fontWeight: 500 },
  formTypeName: { fontSize: '13px', fontWeight: 700, color: '#1565C0' },
  formTypeDesc: { fontSize: '12px', color: '#6B8299', fontStyle: 'italic' },

  // Required fields alert
  requiredAlert: {
    padding: '14px 20px', background: '#FEF2F2', borderBottom: '1px solid #FECACA',
    display: 'flex', gap: '12px', alignItems: 'flex-start',
    fontSize: '13px', color: '#991B1B',
  },
  requiredAlertIcon: {
    width: '24px', height: '24px', borderRadius: '50%', background: '#DC2626',
    color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: '14px', fontWeight: 700, flexShrink: 0,
  },
  requiredList: {
    marginTop: '6px', display: 'flex', gap: '6px', flexWrap: 'wrap' as const,
  },
  requiredItem: {
    fontSize: '12px', background: '#FEE2E2', padding: '3px 8px', borderRadius: '6px',
    border: '1px solid #FECACA', display: 'inline-flex', alignItems: 'center', gap: '4px',
  },
  sectionTag: {
    fontSize: '10px', background: '#E3F2FD', color: '#1565C0', padding: '2px 5px',
    borderRadius: '3px', fontWeight: 600,
  },

  // Downloads
  downloadSection: {
    padding: '16px 20px', background: '#FFFDF7', borderBottom: '1px solid #E8EFF5',
  },
  downloadLabel: {
    margin: '0 0 10px', fontSize: '13px', fontWeight: 600, color: '#374151',
  },
  downloadRow: { display: 'flex', gap: '10px', flexWrap: 'wrap' as const },
  downloadBtnAnnotated: {
    padding: '10px 20px', border: 'none', borderRadius: '10px',
    background: 'linear-gradient(135deg, #E65100, #BF360C)', color: 'white',
    fontSize: '13px', fontWeight: 600, cursor: 'pointer',
    boxShadow: '0 2px 6px rgba(230,81,0,0.2)',
  },
  downloadBtnOriginal: {
    padding: '10px 20px', border: '1px solid #D6E4F0', borderRadius: '10px',
    background: 'white', color: '#374151',
    fontSize: '13px', fontWeight: 600, cursor: 'pointer',
  },
  previewBtn: {
    padding: '10px 20px', border: '1px solid #C4B5FD', borderRadius: '10px',
    background: '#F5F3FF', color: '#6D28D9',
    fontSize: '13px', fontWeight: 600, cursor: 'pointer',
  },
  downloadBtnDisabled: {
    padding: '10px 20px', border: 'none', borderRadius: '10px',
    background: '#8DA4B8', color: 'white',
    fontSize: '13px', fontWeight: 600, cursor: 'wait',
  },
  downloadHint: {
    margin: '10px 0 0', fontSize: '12px', color: '#8DA4B8', lineHeight: '1.5',
    fontStyle: 'italic',
  },

  // PDF Preview
  previewSection: {
    borderBottom: '1px solid #E8EFF5',
  },
  previewHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '10px 20px', background: '#F5F3FF', borderBottom: '1px solid #DDD6FE',
  },
  previewTitle: { fontSize: '13px', fontWeight: 600, color: '#6D28D9' },
  previewClose: {
    padding: '4px 12px', border: '1px solid #C4B5FD', borderRadius: '6px',
    background: 'white', color: '#6D28D9', fontSize: '12px', cursor: 'pointer',
  },
  previewIframe: {
    width: '100%', height: '600px', border: 'none',
  },

  // Completion bar
  completionSection: {
    padding: '16px 20px', display: 'flex', alignItems: 'center', gap: '12px',
    borderBottom: '1px solid #E8EFF5',
  },
  completionBarBg: {
    flex: 1, height: '8px', borderRadius: '4px', background: '#E8EFF5', overflow: 'hidden',
  },
  completionBarFill: {
    height: '100%', borderRadius: '4px',
    transition: 'width 0.5s ease',
  },
  completionLabel: { fontSize: '12px', fontWeight: 600, color: '#374151', whiteSpace: 'nowrap' },

  // Low confidence section
  lowConfSection: {
    padding: '16px 20px', borderBottom: '1px solid #E8EFF5',
    background: '#FFFBEB',
  },
  lowConfTitle: {
    margin: '0 0 10px', fontSize: '13px', fontWeight: 700, color: '#92400E',
    textTransform: 'uppercase' as const, letterSpacing: '0.3px',
  },
  fieldItemLowConf: {
    display: 'flex', alignItems: 'center', gap: '10px',
    padding: '8px 12px', background: '#FEF3C7', borderRadius: '8px',
    border: '1px solid #FDE68A',
  },
  lowConfBadge: {
    fontSize: '11px', fontWeight: 700, color: '#92400E',
    background: '#FDE68A', padding: '2px 6px', borderRadius: '4px', minWidth: '20px',
    textAlign: 'center' as const,
  },
  lowConfValue: {
    fontSize: '12px', color: '#92400E', fontStyle: 'italic',
    maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  fieldConfidence: {
    fontSize: '10px', color: '#B45309', background: '#FEF3C7',
    padding: '2px 5px', borderRadius: '3px', fontWeight: 600,
  },

  // Field lists
  fieldSection: { padding: '16px 20px', borderBottom: '1px solid #E8EFF5' },
  fieldSectionTitle: {
    margin: '0 0 10px', fontSize: '13px', fontWeight: 700, color: '#DC2626',
    textTransform: 'uppercase' as const, letterSpacing: '0.3px',
  },
  fieldSectionTitleGreen: {
    fontSize: '13px', fontWeight: 700, color: '#059669',
    textTransform: 'uppercase' as const, letterSpacing: '0.3px',
  },
  fieldList: { display: 'flex', flexDirection: 'column' as const, gap: '6px' },
  fieldItemEmpty: {
    display: 'flex', alignItems: 'center', gap: '10px',
    padding: '8px 12px', background: '#FEF2F2', borderRadius: '8px',
    border: '1px solid #FECACA',
  },
  fieldItemRequired: {
    display: 'flex', alignItems: 'center', gap: '10px',
    padding: '8px 12px', background: '#FEF2F2', borderRadius: '8px',
    border: '2px solid #DC2626',
  },
  fieldItemFilled: {
    display: 'flex', alignItems: 'center', gap: '10px',
    padding: '8px 12px', background: '#F7FAFD', borderRadius: '8px',
    border: '1px solid #E8EFF5',
  },
  fieldNumber: {
    fontSize: '11px', fontWeight: 700, color: '#DC2626',
    background: '#FEE2E2', padding: '2px 6px', borderRadius: '4px', minWidth: '24px',
    textAlign: 'center' as const,
  },
  fieldNumberRequired: {
    fontSize: '10px', fontWeight: 700, color: 'white',
    background: '#DC2626', padding: '2px 6px', borderRadius: '4px', minWidth: '28px',
    textAlign: 'center' as const,
  },
  fieldKey: { fontSize: '13px', fontWeight: 600, color: '#0D2137', flex: 1, display: 'flex', alignItems: 'center', gap: '6px' },
  fieldValue: {
    fontSize: '12px', color: '#6B8299', maxWidth: '200px',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  },
  fieldPage: { fontSize: '11px', color: '#8DA4B8' },
  checkboxTag: {
    fontSize: '10px', background: '#E5E7EB', color: '#6B7280', padding: '1px 5px',
    borderRadius: '3px', fontWeight: 500,
  },
  filledToggle: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    width: '100%', padding: '0 0 10px', border: 'none', background: 'none',
    cursor: 'pointer',
  },
  expandArrow: { fontSize: '11px', color: '#8DA4B8' },

  // New review
  newReviewRow: { padding: '16px 20px', textAlign: 'center' as const },
  newReviewButton: {
    padding: '10px 24px', border: '1px solid #D6E4F0', borderRadius: '10px',
    background: 'white', color: '#374151', fontSize: '13px', fontWeight: 600,
    cursor: 'pointer',
  },

  // Batch table
  batchTableContainer: {
    overflowX: 'auto' as const,
  },
  batchTable: {
    width: '100%', borderCollapse: 'collapse' as const, fontSize: '13px',
  },
  batchTh: {
    padding: '10px 12px', textAlign: 'left' as const, fontSize: '11px',
    fontWeight: 700, color: '#6B8299', textTransform: 'uppercase' as const,
    letterSpacing: '0.5px', borderBottom: '2px solid #E8EFF5', background: '#F7FAFD',
  },
  batchTr: {
    cursor: 'pointer', transition: 'background 0.15s',
  },
  batchTrSelected: {
    cursor: 'pointer', background: '#FFF8F0',
  },
  batchTd: {
    padding: '10px 12px', borderBottom: '1px solid #E8EFF5',
  },
  batchTdCenter: {
    padding: '10px 12px', borderBottom: '1px solid #E8EFF5', textAlign: 'center' as const,
  },
  batchFilename: {
    fontWeight: 600, color: '#0D2137', fontSize: '12px',
  },
  cachedDot: {
    display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%',
    background: '#7C3AED', marginLeft: '6px', verticalAlign: 'middle',
  },
  batchFormType: {
    fontSize: '11px', color: '#6B8299',
  },
  batchMissingBad: {
    color: '#DC2626', fontWeight: 700,
  },
  batchMissingGood: {
    color: '#059669', fontWeight: 600,
  },
  batchReqBad: {
    color: 'white', fontWeight: 700, background: '#DC2626',
    padding: '2px 6px', borderRadius: '4px', fontSize: '12px',
  },
  batchBarBg: {
    height: '6px', borderRadius: '3px', background: '#E8EFF5', overflow: 'hidden',
    display: 'inline-block', width: '60px', verticalAlign: 'middle',
  },
  batchBarFill: {
    height: '100%', borderRadius: '3px',
  },
  batchPct: {
    fontSize: '11px', color: '#374151', fontWeight: 600, marginLeft: '6px',
  },
  statusComplete: {
    fontSize: '11px', color: '#059669', background: '#ECFDF5',
    padding: '3px 8px', borderRadius: '6px', fontWeight: 600,
  },
  statusIncomplete: {
    fontSize: '11px', color: '#D97706', background: '#FFFBEB',
    padding: '3px 8px', borderRadius: '6px', fontWeight: 600,
  },
  statusCritical: {
    fontSize: '11px', color: '#DC2626', background: '#FEF2F2',
    padding: '3px 8px', borderRadius: '6px', fontWeight: 600,
  },

  // Batch detail
  batchDetail: {
    padding: '16px 20px', background: '#FFFDF7', borderBottom: '1px solid #E8EFF5',
  },
  batchDetailTitle: {
    margin: '0 0 10px', fontSize: '14px', fontWeight: 700, color: '#0D2137',
  },
  batchDetailComplete: {
    margin: 0, fontSize: '13px', color: '#059669', fontWeight: 600,
  },
};
