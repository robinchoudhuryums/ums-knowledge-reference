import { useState, useMemo } from 'react';
import {
  submitExtractionCorrection,
  ExtractionActualQuality,
  ExtractionReportedConfidence,
  CorrectedField,
} from '../services/api';

interface Props {
  templateId: string;
  reportedConfidence: ExtractionReportedConfidence;
  filename?: string;
  originalData: Record<string, string | number | boolean | null>;
  editedData: Record<string, string | number | boolean | null>;
  fieldLabels?: Record<string, string>;
}

const QUALITY_OPTIONS: Array<{ value: ExtractionActualQuality; label: string; hint: string }> = [
  { value: 'correct',      label: 'Correct',       hint: 'Everything extracted accurately' },
  { value: 'minor_errors', label: 'Minor errors',  hint: 'A few fields needed fixing' },
  { value: 'major_errors', label: 'Major errors',  hint: 'Many fields were wrong or missing' },
  { value: 'unusable',     label: 'Unusable',      hint: 'Extraction could not be salvaged' },
];

/**
 * Inline panel that lets a reviewer submit a correction record for an
 * extraction result. Uses deep-equality diff between the original LLM
 * output and the user's edited values to avoid asking the reviewer to
 * redundantly mark which fields changed.
 */
export function ExtractionCorrectionPanel({
  templateId,
  reportedConfidence,
  filename,
  originalData,
  editedData,
  fieldLabels,
}: Props) {
  const [actualQuality, setActualQuality] = useState<ExtractionActualQuality | ''>('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submittedId, setSubmittedId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const diff = useMemo<CorrectedField[]>(() => {
    const out: CorrectedField[] = [];
    const keys = new Set([...Object.keys(originalData || {}), ...Object.keys(editedData || {})]);
    for (const key of keys) {
      const o = originalData?.[key] ?? null;
      const e = editedData?.[key] ?? null;
      // Normalize empty strings to null so "blank" vs "null" isn't flagged
      const oNorm = o === '' ? null : o;
      const eNorm = e === '' ? null : e;
      if (oNorm !== eNorm) {
        out.push({ key, originalValue: o, correctedValue: e });
      }
    }
    return out;
  }, [originalData, editedData]);

  const handleSubmit = async () => {
    if (!actualQuality) {
      setError('Please select an overall quality rating before submitting.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const res = await submitExtractionCorrection({
        templateId,
        reportedConfidence,
        actualQuality,
        correctedFields: diff,
        reviewerNote: note.trim() || undefined,
        filename,
      });
      setSubmittedId(res.correction.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit correction');
    } finally {
      setSubmitting(false);
    }
  };

  if (submittedId) {
    return (
      <div style={styles.container}>
        <div style={styles.successBanner}>
          ✓ Correction saved. Thank you — this helps the team measure extraction accuracy.
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h5 style={styles.title}>Submit correction feedback</h5>
        <p style={styles.subtitle}>
          {diff.length === 0
            ? 'No edits detected — submit "Correct" to confirm the model got everything right.'
            : `${diff.length} field${diff.length === 1 ? '' : 's'} changed. Rate the extraction and optionally add a note.`}
        </p>
      </div>

      {diff.length > 0 && (
        <div style={styles.diffList}>
          <div style={styles.diffHeader}>Changes:</div>
          {diff.slice(0, 10).map(cf => (
            <div key={cf.key} style={styles.diffRow}>
              <span style={styles.diffKey}>{fieldLabels?.[cf.key] || cf.key}</span>
              <span style={styles.diffOld}>{renderValue(cf.originalValue)}</span>
              <span style={styles.diffArrow}>→</span>
              <span style={styles.diffNew}>{renderValue(cf.correctedValue)}</span>
            </div>
          ))}
          {diff.length > 10 && (
            <div style={styles.diffMore}>+ {diff.length - 10} more changes</div>
          )}
        </div>
      )}

      <fieldset style={styles.fieldset}>
        <legend style={styles.legend}>Overall quality</legend>
        <div style={styles.qualityOptions}>
          {QUALITY_OPTIONS.map(opt => (
            <label key={opt.value} style={{
              ...styles.qualityOption,
              ...(actualQuality === opt.value ? styles.qualityOptionSelected : {}),
            }}>
              <input
                type="radio"
                name="quality"
                value={opt.value}
                checked={actualQuality === opt.value}
                onChange={() => { setActualQuality(opt.value); setError(''); }}
                style={styles.radio}
              />
              <span style={styles.qualityLabel}>{opt.label}</span>
              <span style={styles.qualityHint}>{opt.hint}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <label style={styles.noteLabel}>
        Reviewer note (optional — do NOT include PHI)
        <textarea
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="e.g., 'Patient name was partial — missing middle initial.'"
          maxLength={2000}
          rows={3}
          style={styles.textarea}
        />
        <span style={styles.noteCount}>{note.length} / 2000</span>
      </label>

      {error && <div style={styles.errorBanner}>{error}</div>}

      <div style={styles.actions}>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting || !actualQuality}
          style={{
            ...styles.submitBtn,
            ...(submitting || !actualQuality ? styles.submitBtnDisabled : {}),
          }}
        >
          {submitting ? 'Submitting…' : 'Submit correction'}
        </button>
      </div>
    </div>
  );
}

function renderValue(v: string | number | boolean | null): string {
  if (v === null) return '(empty)';
  if (v === '') return '(empty)';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  const s = String(v);
  return s.length > 80 ? s.slice(0, 77) + '…' : s;
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    marginTop: 20,
    padding: 16,
    border: '1px solid var(--ums-border-light, #e5e7eb)',
    borderRadius: 8,
    background: 'var(--ums-bg-surface, #ffffff)',
  },
  header: { marginBottom: 12 },
  title: { margin: '0 0 4px', fontSize: 14, fontWeight: 600, color: 'var(--ums-text-primary, #111827)' },
  subtitle: { margin: 0, fontSize: 12, color: 'var(--ums-text-muted, #6b7280)' },
  diffList: { marginBottom: 16, padding: 10, background: 'var(--ums-bg-app, #f9fafb)', borderRadius: 6, fontSize: 12 },
  diffHeader: { fontWeight: 600, marginBottom: 6, color: 'var(--ums-text-primary, #111827)' },
  diffRow: { display: 'grid', gridTemplateColumns: '1fr 1fr auto 1fr', gap: 8, padding: '4px 0', alignItems: 'center' },
  diffKey: { fontFamily: 'monospace', fontWeight: 500 },
  diffOld: { color: '#dc2626', textDecoration: 'line-through', fontSize: 11, wordBreak: 'break-word' },
  diffArrow: { color: 'var(--ums-text-muted, #6b7280)' },
  diffNew: { color: '#059669', fontSize: 11, wordBreak: 'break-word' },
  diffMore: { marginTop: 6, fontStyle: 'italic', color: 'var(--ums-text-muted, #6b7280)' },
  fieldset: { border: 'none', padding: 0, margin: '0 0 12px' },
  legend: { fontSize: 12, fontWeight: 600, padding: 0, marginBottom: 6, color: 'var(--ums-text-primary, #111827)' },
  qualityOptions: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 },
  qualityOption: {
    display: 'grid',
    gridTemplateColumns: 'auto 1fr',
    gap: '4px 8px',
    padding: '8px 10px',
    border: '1px solid var(--ums-border-light, #e5e7eb)',
    borderRadius: 6,
    cursor: 'pointer',
    alignItems: 'center',
  },
  qualityOptionSelected: {
    borderColor: 'var(--ums-accent, #2563eb)',
    boxShadow: '0 0 0 2px rgba(37, 99, 235, 0.15)',
  },
  radio: { gridRow: '1 / span 2' },
  qualityLabel: { fontSize: 13, fontWeight: 500 },
  qualityHint: { fontSize: 11, color: 'var(--ums-text-muted, #6b7280)', gridColumn: '2 / span 1' },
  noteLabel: { display: 'block', fontSize: 12, fontWeight: 500, marginBottom: 12 },
  textarea: {
    width: '100%',
    marginTop: 4,
    padding: 8,
    border: '1px solid var(--ums-border-light, #e5e7eb)',
    borderRadius: 6,
    fontSize: 13,
    fontFamily: 'inherit',
    resize: 'vertical',
  },
  noteCount: { display: 'block', textAlign: 'right', fontSize: 11, color: 'var(--ums-text-muted, #6b7280)' },
  errorBanner: {
    marginBottom: 10,
    padding: '6px 10px',
    background: '#fef2f2',
    color: '#b91c1c',
    borderRadius: 4,
    fontSize: 12,
  },
  actions: { display: 'flex', justifyContent: 'flex-end' },
  submitBtn: {
    padding: '8px 16px',
    background: 'var(--ums-accent, #2563eb)',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    fontWeight: 500,
    cursor: 'pointer',
    fontSize: 13,
  },
  submitBtnDisabled: { opacity: 0.5, cursor: 'not-allowed' },
  successBanner: {
    padding: 10,
    background: '#ecfdf5',
    color: '#065f46',
    borderRadius: 6,
    fontSize: 13,
  },
};
