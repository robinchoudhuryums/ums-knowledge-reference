import { useState, useMemo } from 'react';
import { ArrowRightIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import {
  submitExtractionCorrection,
  type ExtractionActualQuality,
  type ExtractionReportedConfidence,
  type CorrectedField,
} from '../services/api';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

interface Props {
  templateId: string;
  reportedConfidence: ExtractionReportedConfidence;
  filename?: string;
  originalData: Record<string, string | number | boolean | null>;
  editedData: Record<string, string | number | boolean | null>;
  fieldLabels?: Record<string, string>;
}

const QUALITY_OPTIONS: Array<{
  value: ExtractionActualQuality;
  label: string;
  hint: string;
}> = [
  { value: 'correct', label: 'Correct', hint: 'Everything extracted accurately' },
  { value: 'minor_errors', label: 'Minor errors', hint: 'A few fields needed fixing' },
  { value: 'major_errors', label: 'Major errors', hint: 'Many fields were wrong or missing' },
  { value: 'unusable', label: 'Unusable', hint: 'Extraction could not be salvaged' },
];

function SectionKicker({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="font-mono uppercase text-muted-foreground"
      style={{ fontSize: 10, letterSpacing: '0.14em' }}
    >
      {children}
    </div>
  );
}

/**
 * Inline panel that lets a reviewer submit a correction record for an
 * extraction result. Uses a diff between the original LLM output and
 * the user's edited values — empty string normalized to null — so the
 * reviewer doesn't have to manually mark which fields changed.
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
    const keys = new Set([
      ...Object.keys(originalData || {}),
      ...Object.keys(editedData || {}),
    ]);
    for (const key of keys) {
      const o = originalData?.[key] ?? null;
      const e = editedData?.[key] ?? null;
      // Normalize empty strings to null so blank-vs-null isn't flagged as a change.
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
      <div
        role="status"
        className="flex items-center gap-2 rounded-sm border px-3 py-2 text-[13px]"
        style={{
          background: 'var(--sage-soft)',
          borderColor: 'var(--sage)',
          color: 'var(--sage)',
        }}
      >
        <CheckCircleIcon className="h-4 w-4 shrink-0" />
        <span>
          Correction saved. Thank you — this helps the team measure extraction accuracy.
        </span>
      </div>
    );
  }

  return (
    <div className="rounded-sm border border-border bg-card p-4">
      <div className="mb-3">
        <SectionKicker>Feedback</SectionKicker>
        <h5
          className="mt-1 font-display font-medium text-foreground"
          style={{ fontSize: 15, lineHeight: 1.2 }}
        >
          Submit correction feedback
        </h5>
        <p className="mt-1 text-[12px] text-muted-foreground">
          {diff.length === 0
            ? 'No edits detected — submit "Correct" to confirm the model got everything right.'
            : `${diff.length} field${diff.length === 1 ? '' : 's'} changed. Rate the extraction and optionally add a note.`}
        </p>
      </div>

      {diff.length > 0 && (
        <div className="mb-4 rounded-sm bg-muted p-2.5 text-[12px]">
          <div className="mb-1.5 font-semibold text-foreground">Changes</div>
          {diff.slice(0, 10).map((cf) => (
            <div
              key={cf.key}
              className="grid items-center gap-2 py-1"
              style={{ gridTemplateColumns: '1fr 1fr auto 1fr' }}
            >
              <span className="font-mono font-medium text-foreground">
                {fieldLabels?.[cf.key] || cf.key}
              </span>
              <span
                className="break-words text-[11px] line-through"
                style={{ color: 'var(--warm-red)' }}
              >
                {renderValue(cf.originalValue)}
              </span>
              <ArrowRightIcon className="h-3 w-3 text-muted-foreground" />
              <span className="break-words text-[11px]" style={{ color: 'var(--sage)' }}>
                {renderValue(cf.correctedValue)}
              </span>
            </div>
          ))}
          {diff.length > 10 && (
            <div className="mt-1.5 italic text-muted-foreground">
              + {diff.length - 10} more changes
            </div>
          )}
        </div>
      )}

      <fieldset className="mb-4 border-none p-0">
        <legend className="mb-2 text-[12px] font-semibold text-foreground">
          Overall quality
        </legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {QUALITY_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className={cn(
                'cursor-pointer rounded-sm border p-2.5 transition-colors',
                actualQuality === opt.value
                  ? 'border-accent bg-[var(--copper-soft)]'
                  : 'border-border bg-card hover:bg-muted',
              )}
            >
              <div className="flex items-center gap-2">
                <input
                  type="radio"
                  name="quality"
                  value={opt.value}
                  checked={actualQuality === opt.value}
                  onChange={() => {
                    setActualQuality(opt.value);
                    setError('');
                  }}
                />
                <span className="text-[13px] font-medium text-foreground">{opt.label}</span>
              </div>
              <div className="mt-1 pl-5 text-[11px] text-muted-foreground">{opt.hint}</div>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="mb-3 block">
        <span className="mb-1 block text-[12px] font-medium text-foreground">
          Reviewer note (optional — do NOT include PHI)
        </span>
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g., 'Patient name was partial — missing middle initial.'"
          maxLength={2000}
          rows={3}
        />
        <span className="mt-0.5 block text-right font-mono text-[11px] text-muted-foreground">
          {note.length} / 2000
        </span>
      </label>

      {error && (
        <div
          role="alert"
          className="mb-3 rounded-sm border px-3 py-2 text-[12px]"
          style={{
            background: 'var(--warm-red-soft)',
            borderColor: 'var(--warm-red)',
            color: 'var(--warm-red)',
          }}
        >
          {error}
        </div>
      )}

      <div className="flex justify-end">
        <Button
          type="button"
          onClick={handleSubmit}
          disabled={submitting || !actualQuality}
          size="sm"
        >
          {submitting ? 'Submitting…' : 'Submit correction'}
        </Button>
      </div>
    </div>
  );
}

function renderValue(v: string | number | boolean | null): string {
  if (v === null || v === '') return '(empty)';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  const s = String(v);
  return s.length > 80 ? s.slice(0, 77) + '…' : s;
}
