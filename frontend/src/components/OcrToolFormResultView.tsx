import { useState, Suspense, lazy } from 'react';
import {
  ExclamationTriangleIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ArrowDownTrayIcon,
  EyeIcon,
  PencilSquareIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import type { FormReviewResult } from '../services/api';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const AnnotatedPdfViewer = lazy(() =>
  import('./AnnotatedPdfViewer').then((m) => ({ default: m.AnnotatedPdfViewer })),
);

interface Props {
  result: FormReviewResult;
  selectedFile: File | null;
  downloading: 'annotated' | 'original' | null;
  previewUrl: string | null;
  showPreview: boolean;
  showInteractiveViewer: boolean;
  onDownloadAnnotated: () => void;
  onDownloadOriginal: () => void;
  onPreviewAnnotated: () => void;
  onClosePreview: () => void;
  onOpenInteractive: () => void;
  onCloseInteractive: () => void;
  onReset: () => void;
}

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

function MetaBadge({
  children,
  tone = 'muted',
}: {
  children: React.ReactNode;
  tone?: 'muted' | 'sage' | 'warm-red';
}) {
  const palette = {
    muted: {
      bg: 'var(--muted)',
      border: 'var(--border)',
      fg: 'var(--muted-foreground)',
    },
    sage: {
      bg: 'var(--sage-soft)',
      border: 'var(--sage)',
      fg: 'var(--sage)',
    },
    'warm-red': {
      bg: 'var(--warm-red-soft)',
      border: 'var(--warm-red)',
      fg: 'var(--warm-red)',
    },
  }[tone];
  return (
    <span
      className="inline-flex items-center rounded-sm border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider"
      style={{ background: palette.bg, borderColor: palette.border, color: palette.fg }}
    >
      {children}
    </span>
  );
}

export function OcrToolFormResultView({
  result,
  selectedFile,
  downloading,
  previewUrl,
  showPreview,
  showInteractiveViewer,
  onDownloadAnnotated,
  onDownloadOriginal,
  onPreviewAnnotated,
  onClosePreview,
  onOpenInteractive,
  onCloseInteractive,
  onReset,
}: Props) {
  const isPdf = selectedFile?.name.toLowerCase().endsWith('.pdf');
  const completionTone =
    result.completionPercentage >= 90
      ? 'var(--sage)'
      : result.completionPercentage >= 70
        ? 'var(--amber)'
        : 'var(--warm-red)';

  return (
    <div className="rounded-sm border border-border bg-card">
      {/* Summary */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <SectionKicker>Form review</SectionKicker>
          <h4
            className="mt-1 truncate font-display font-medium text-foreground"
            style={{ fontSize: 16, lineHeight: 1.15 }}
          >
            {result.filename}
          </h4>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <MetaBadge>
              {result.pageCount} page{result.pageCount !== 1 ? 's' : ''}
            </MetaBadge>
            <MetaBadge>{result.totalFields} fields detected</MetaBadge>
            <MetaBadge tone={result.emptyCount > 0 ? 'warm-red' : 'sage'}>
              {result.emptyCount > 0
                ? `${result.emptyCount} field${result.emptyCount !== 1 ? 's' : ''} missing`
                : 'All fields complete'}
            </MetaBadge>
            {result.cached && <MetaBadge tone="sage">Cached (no charge)</MetaBadge>}
          </div>
        </div>
      </div>

      <div className="space-y-4 px-5 py-4">
        {/* Detected form type */}
        {result.formType && (
          <div
            className="flex flex-wrap items-baseline gap-2 rounded-sm border px-3 py-2 text-[13px]"
            style={{
              background: 'var(--copper-soft)',
              borderColor: 'var(--accent)',
            }}
          >
            <span
              className="font-mono uppercase text-muted-foreground"
              style={{ fontSize: 10, letterSpacing: '0.14em' }}
            >
              Detected form
            </span>
            <span className="font-medium text-foreground">{result.formType.name}</span>
            <span className="text-muted-foreground">{result.formType.description}</span>
          </div>
        )}

        {/* Required missing fields alert */}
        {result.requiredMissingCount > 0 && (
          <div
            role="alert"
            className="flex gap-3 rounded-sm border px-3 py-3 text-[13px]"
            style={{
              background: 'var(--warm-red-soft)',
              borderColor: 'var(--warm-red)',
            }}
          >
            <ExclamationTriangleIcon
              className="h-5 w-5 shrink-0"
              style={{ color: 'var(--warm-red)' }}
            />
            <div className="min-w-0">
              <strong className="block font-semibold" style={{ color: 'var(--warm-red)' }}>
                {result.requiredMissingCount} required field
                {result.requiredMissingCount !== 1 ? 's' : ''} missing
              </strong>
              <div className="mt-1 flex flex-wrap gap-1">
                {result.requiredMissingFields.map((f, i) => (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1 rounded-sm border border-border bg-card px-1.5 py-0.5 text-[11px]"
                  >
                    <span className="font-medium">{f.requiredLabel || f.key}</span>
                    {f.section && (
                      <span
                        className="font-mono uppercase text-muted-foreground"
                        style={{ fontSize: 9, letterSpacing: '0.06em' }}
                      >
                        {f.section}
                      </span>
                    )}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Download + preview */}
        {isPdf && result.emptyCount > 0 && (
          <div className="rounded-sm border border-border bg-muted p-3">
            <SectionKicker>Downloads</SectionKicker>
            <p className="mt-1 text-[12px] text-muted-foreground">
              Send the marked-up copy AND the original — the annotated copy has a watermark
              and cannot be submitted to insurance.
            </p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                disabled={!!downloading}
                onClick={onDownloadAnnotated}
                className="gap-1.5"
              >
                <ArrowDownTrayIcon className="h-4 w-4" />
                {downloading === 'annotated' ? 'Generating…' : 'Marked-up example'}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!!downloading}
                onClick={onDownloadOriginal}
                className="gap-1.5"
              >
                <ArrowDownTrayIcon className="h-4 w-4" />
                {downloading === 'original' ? 'Downloading…' : 'Original'}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!!downloading}
                onClick={onPreviewAnnotated}
                className="gap-1.5"
              >
                <EyeIcon className="h-4 w-4" />
                {downloading === 'annotated' && !showPreview ? 'Loading…' : 'Preview annotated'}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={onOpenInteractive}
                className="gap-1.5"
              >
                <PencilSquareIcon className="h-4 w-4" />
                Edit annotations
              </Button>
            </div>
          </div>
        )}

        {/* In-browser iframe preview */}
        {showPreview && previewUrl && !showInteractiveViewer && (
          <div className="rounded-sm border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <SectionKicker>Annotated PDF preview</SectionKicker>
              <button
                type="button"
                onClick={onClosePreview}
                aria-label="Close preview"
                className="flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
              >
                <XMarkIcon className="h-4 w-4" />
              </button>
            </div>
            <iframe
              src={previewUrl}
              title="Annotated PDF Preview"
              className="block h-[70vh] w-full"
            />
          </div>
        )}

        {/* Interactive annotation editor (lazy-loaded) */}
        {showInteractiveViewer && selectedFile && (
          <div className="rounded-sm border border-border bg-card p-1">
            <Suspense
              fallback={
                <div className="px-4 py-8 text-center text-[13px] text-muted-foreground">
                  Loading annotation editor…
                </div>
              }
            >
              <AnnotatedPdfViewer
                file={selectedFile}
                emptyFields={result.emptyFields}
                lowConfidenceFields={result.lowConfidenceFields}
                onClose={onCloseInteractive}
              />
            </Suspense>
          </div>
        )}

        {/* Completion bar */}
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <SectionKicker>Completion</SectionKicker>
            <span
              className="font-mono text-[12px] tabular-nums"
              style={{ color: completionTone }}
            >
              {result.completionPercentage}%
            </span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full"
              style={{
                width: `${result.completionPercentage}%`,
                background: completionTone,
              }}
            />
          </div>
        </div>

        {/* Low-confidence fields */}
        {result.lowConfidenceCount > 0 && (
          <div>
            <h5
              className="mb-2 font-mono uppercase"
              style={{
                fontSize: 11,
                letterSpacing: '0.12em',
                color: 'var(--amber)',
              }}
            >
              Low confidence ({result.lowConfidenceCount}) — verify manually
            </h5>
            <div className="space-y-1">
              {result.lowConfidenceFields.map((f, i) => (
                <div
                  key={i}
                  className="flex flex-wrap items-center gap-2 rounded-sm border px-2.5 py-1.5 text-[12px]"
                  style={{
                    borderColor: 'var(--amber)',
                    background: 'var(--amber-soft)',
                  }}
                >
                  <span
                    className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-bold"
                    style={{ background: 'var(--amber)', color: 'var(--card)' }}
                  >
                    ?
                  </span>
                  <span className="font-medium text-foreground">
                    {f.key || '(unlabeled field)'}
                  </span>
                  <span
                    className="italic text-muted-foreground"
                    style={{ color: 'var(--amber)' }}
                  >
                    {f.value || '(empty)'}
                  </span>
                  <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                    {f.confidence}%
                  </span>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    Page {f.page}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty fields */}
        {result.emptyCount > 0 && (
          <div>
            <h5
              className="mb-2 font-mono uppercase text-muted-foreground"
              style={{ fontSize: 11, letterSpacing: '0.12em' }}
            >
              Missing / blank fields ({result.emptyCount})
            </h5>
            <div className="space-y-1">
              {result.emptyFields.map((f, i) => (
                <div
                  key={i}
                  className={cn(
                    'flex flex-wrap items-center gap-2 rounded-sm border px-2.5 py-1.5 text-[12px]',
                  )}
                  style={{
                    borderColor: f.isRequired ? 'var(--warm-red)' : 'var(--border)',
                    background: f.isRequired ? 'var(--warm-red-soft)' : 'var(--card)',
                  }}
                >
                  <span
                    className="font-mono text-[10px] font-semibold uppercase"
                    style={{
                      color: f.isRequired ? 'var(--warm-red)' : 'var(--muted-foreground)',
                    }}
                  >
                    {f.isRequired ? 'REQ' : `#${i + 1}`}
                  </span>
                  <span className="font-medium text-foreground">
                    {f.key || '(unlabeled field)'}
                  </span>
                  {f.isCheckbox && (
                    <span
                      className="rounded-sm border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] uppercase text-muted-foreground"
                    >
                      checkbox
                    </span>
                  )}
                  {f.section && (
                    <span
                      className="font-mono text-[10px] text-muted-foreground"
                      style={{ letterSpacing: '0.04em' }}
                    >
                      {f.section}
                    </span>
                  )}
                  <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                    Page {f.page}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Filled fields */}
        {result.filledFields.length > 0 && (
          <FilledFieldsSection fields={result.filledFields} />
        )}

        {/* New review button */}
        <div className="flex justify-end pt-1">
          <Button type="button" size="sm" onClick={onReset}>
            Review another form
          </Button>
        </div>
      </div>
    </div>
  );
}

function FilledFieldsSection({
  fields,
}: {
  fields: Array<{
    key: string;
    value?: string;
    page: number;
    confidence: number;
    section?: string;
  }>;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between rounded-sm border border-border bg-card px-3 py-2 text-left hover:bg-muted"
      >
        <span
          className="font-mono uppercase"
          style={{ fontSize: 11, letterSpacing: '0.12em', color: 'var(--sage)' }}
        >
          Completed fields ({fields.length})
        </span>
        {expanded ? (
          <ChevronUpIcon className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDownIcon className="h-4 w-4 text-muted-foreground" />
        )}
      </button>
      {expanded && (
        <div className="mt-1 space-y-1">
          {fields.map((f, i) => (
            <div
              key={i}
              className="flex flex-wrap items-center gap-2 rounded-sm border px-2.5 py-1.5 text-[12px]"
              style={{
                borderColor: 'var(--sage)',
                background: 'var(--sage-soft)',
              }}
            >
              <span className="font-medium text-foreground">
                {f.key || '(unlabeled)'}
              </span>
              <span className="text-muted-foreground">{f.value}</span>
              {f.section && (
                <span
                  className="font-mono text-[10px] text-muted-foreground"
                  style={{ letterSpacing: '0.04em' }}
                >
                  {f.section}
                </span>
              )}
              <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                Page {f.page}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
