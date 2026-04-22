/**
 * PpdQuestionnaireRow — Renders a single PPD question row (yes-no, text,
 * number, select, or multi-select) with warm-paper styling.
 */

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { ApiQuestion, Lang } from './PpdQuestionnaireShared';

function YesNo({
  value,
  onChange,
  lang,
}: {
  value: string;
  onChange: (v: string) => void;
  lang: Lang;
}) {
  const yes = value === 'Yes';
  const no = value === 'No';
  return (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={() => onChange('Yes')}
        aria-pressed={yes}
        className={cn(
          'rounded-sm border px-4 py-1.5 text-[13px] transition-colors',
          yes
            ? 'border-[var(--sage)] bg-[var(--sage-soft)] font-semibold text-[var(--sage)]'
            : 'border-border bg-background text-foreground hover:bg-muted',
        )}
      >
        {lang === 'en' ? 'Yes' : 'Sí'}
      </button>
      <button
        type="button"
        onClick={() => onChange('No')}
        aria-pressed={no}
        className={cn(
          'rounded-sm border px-4 py-1.5 text-[13px] transition-colors',
          no
            ? 'border-[var(--warm-red)] bg-[var(--warm-red-soft)] font-semibold text-[var(--warm-red)]'
            : 'border-border bg-background text-foreground hover:bg-muted',
        )}
      >
        No
      </button>
    </div>
  );
}

function MultiSelect({
  value,
  options,
  onChange,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  const selected = (value || '').split(',').filter(Boolean);
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const isSel = selected.includes(o);
        return (
          <button
            key={o}
            type="button"
            aria-pressed={isSel}
            onClick={() => {
              const next = isSel
                ? selected.filter((v) => v !== o)
                : [...selected, o];
              onChange(next.join(','));
            }}
            className={cn(
              'rounded-sm border px-3 py-1 text-[12px] transition-colors',
              isSel
                ? 'border-accent bg-[var(--copper-soft)] font-semibold text-accent'
                : 'border-border bg-background text-foreground hover:bg-muted',
            )}
          >
            {o}
          </button>
        );
      })}
    </div>
  );
}

export function PpdQuestionnaireRow({
  question,
  value,
  lang,
  onChange,
}: {
  question: ApiQuestion;
  value: string;
  lang: Lang;
  onChange: (id: string, value: string) => void;
}) {
  const q = question;
  const label = lang === 'en' ? q.text : q.spanishText;

  return (
    <div className="mb-2.5 rounded-sm border border-border bg-background px-4 py-3 shadow-sm">
      <label className="mb-1.5 block text-[14px] font-medium text-foreground">
        {q.number}. {label}
        {q.required && (
          <span className="ml-1" style={{ color: 'var(--warm-red)' }}>
            *
          </span>
        )}
      </label>

      {q.type === 'yes-no' && (
        <YesNo value={value} onChange={(v) => onChange(q.id, v)} lang={lang} />
      )}

      {q.type === 'text' && (
        <Input
          type="text"
          value={value}
          onChange={(e) => onChange(q.id, e.target.value)}
          maxLength={500}
        />
      )}

      {q.type === 'number' && (
        <Input
          type="number"
          value={value}
          onChange={(e) => onChange(q.id, e.target.value)}
          className="w-40"
        />
      )}

      {q.type === 'select' && q.options && (
        <select
          value={value}
          onChange={(e) => onChange(q.id, e.target.value)}
          className="h-10 w-full rounded-md border border-border bg-background px-3 text-[14px] text-foreground"
        >
          <option value="">
            {lang === 'en' ? '— Select —' : '— Seleccionar —'}
          </option>
          {q.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      )}

      {q.type === 'multi-select' && q.options && (
        <MultiSelect
          value={value}
          options={q.options}
          onChange={(v) => onChange(q.id, v)}
        />
      )}
    </div>
  );
}
