import type { BatchFormReviewResult } from '../services/api';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface Props {
  result: BatchFormReviewResult;
  expandedIndex: number | null;
  onToggleExpand: (i: number) => void;
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

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={cn(
        'whitespace-nowrap border-b border-border bg-muted px-3 py-2 text-left font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground',
        className,
      )}
    >
      {children}
    </th>
  );
}

export function OcrToolBatchResultView({
  result,
  expandedIndex,
  onToggleExpand,
  onReset,
}: Props) {
  return (
    <div className="rounded-sm border border-border bg-card">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <SectionKicker>Batch review</SectionKicker>
          <h4
            className="mt-1 font-display font-medium text-foreground"
            style={{ fontSize: 16, lineHeight: 1.15 }}
          >
            {result.fileCount} file{result.fileCount !== 1 ? 's' : ''} reviewed
          </h4>
          {result.totalCachedCount > 0 && (
            <span
              className="mt-2 inline-flex items-center rounded-sm border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider"
              style={{
                background: 'var(--sage-soft)',
                borderColor: 'var(--sage)',
                color: 'var(--sage)',
              }}
            >
              {result.totalCachedCount} cached (no charge)
            </span>
          )}
        </div>
      </div>

      <div className="overflow-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <Th>File</Th>
              <Th>Form type</Th>
              <Th className="text-center">Fields</Th>
              <Th className="text-center">Missing</Th>
              <Th className="text-center">Req. missing</Th>
              <Th className="text-center">Completion</Th>
              <Th className="text-center">Status</Th>
            </tr>
          </thead>
          <tbody>
            {result.results.map((r, i) => {
              const isExpanded = expandedIndex === i;
              const completionTone =
                r.completionPercentage >= 90
                  ? 'var(--sage)'
                  : r.completionPercentage >= 70
                    ? 'var(--amber)'
                    : 'var(--warm-red)';
              return (
                <tr
                  key={i}
                  onClick={() => onToggleExpand(i)}
                  className={cn(
                    'cursor-pointer border-b border-border transition-colors last:border-b-0',
                    isExpanded ? 'bg-[var(--copper-soft)]' : 'hover:bg-muted',
                  )}
                >
                  <td className="px-3 py-2.5">
                    <span className="text-[13px] font-medium text-foreground">
                      {r.filename}
                    </span>
                    {r.cached && (
                      <span
                        aria-hidden="true"
                        title="Cached result"
                        className="ml-1.5 inline-block h-2 w-2 rounded-full align-middle"
                        style={{ background: 'var(--sage)' }}
                      />
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-[13px] text-muted-foreground">
                    {r.formType?.name || 'Unknown'}
                  </td>
                  <td className="px-3 py-2.5 text-center font-mono text-[12px] tabular-nums text-foreground">
                    {r.totalFields}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <span
                      className="font-mono text-[12px] font-semibold tabular-nums"
                      style={{ color: r.emptyCount > 0 ? 'var(--warm-red)' : 'var(--sage)' }}
                    >
                      {r.emptyCount}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <span
                      className="font-mono text-[12px] font-semibold tabular-nums"
                      style={{
                        color: r.requiredMissingCount > 0 ? 'var(--warm-red)' : 'var(--sage)',
                      }}
                    >
                      {r.requiredMissingCount}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <div className="mx-auto mb-1 h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full"
                        style={{
                          width: `${r.completionPercentage}%`,
                          background: completionTone,
                        }}
                      />
                    </div>
                    <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                      {r.completionPercentage}%
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <StatusPill
                      complete={r.emptyCount === 0}
                      critical={r.requiredMissingCount > 0}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {expandedIndex !== null && result.results[expandedIndex] && (
        <ExpandedBatchDetail row={result.results[expandedIndex]} />
      )}

      <div className="flex justify-end border-t border-border px-5 py-3">
        <Button type="button" size="sm" onClick={onReset}>
          Review more forms
        </Button>
      </div>
    </div>
  );
}

function StatusPill({ complete, critical }: { complete: boolean; critical: boolean }) {
  const tone = complete
    ? { fg: 'var(--sage)', bg: 'var(--sage-soft)', border: 'var(--sage)', label: 'Complete' }
    : critical
      ? {
          fg: 'var(--warm-red)',
          bg: 'var(--warm-red-soft)',
          border: 'var(--warm-red)',
          label: 'Action needed',
        }
      : {
          fg: 'var(--amber)',
          bg: 'var(--amber-soft)',
          border: 'var(--amber)',
          label: 'Incomplete',
        };
  return (
    <span
      className="inline-flex items-center rounded-sm border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider"
      style={{ background: tone.bg, borderColor: tone.border, color: tone.fg }}
    >
      {tone.label}
    </span>
  );
}

function ExpandedBatchDetail({
  row,
}: {
  row: BatchFormReviewResult['results'][number];
}) {
  return (
    <div className="border-t border-border bg-muted px-5 py-4">
      <h5 className="mb-2 text-[13px] font-semibold text-foreground">
        {row.filename} — missing fields
      </h5>
      {row.emptyFields.length === 0 ? (
        <p className="text-[13px]" style={{ color: 'var(--sage)' }}>
          All fields complete.
        </p>
      ) : (
        <div className="space-y-1">
          {row.emptyFields.map((f, i) => (
            <div
              key={i}
              className="flex items-center gap-2 rounded-sm border border-border bg-card px-2.5 py-1.5 text-[12px]"
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
                {f.key || '(unlabeled)'}
              </span>
              {f.section && (
                <span className="font-mono text-[10px] text-muted-foreground">
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
