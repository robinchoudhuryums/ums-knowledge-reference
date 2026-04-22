/**
 * Shared chrome + primitives for the PMD and PAP Account Creation forms.
 *
 * Both forms share the same skeleton — header band + progress ring + collapsible
 * groups + action bar — so this module factors out the warm-paper styling for
 * both. Each form keeps its own business logic (question list, API endpoint,
 * response-id prefix, conditional formatting) as thin parameterizations.
 */

import { type ReactNode } from 'react';
import { ChevronRightIcon } from '@heroicons/react/24/outline';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

// ────────────────────────────────────────────────────────────
// Layout chrome
// ────────────────────────────────────────────────────────────

export function SectionKicker({ children }: { children: ReactNode }) {
  return (
    <div
      className="font-mono uppercase text-muted-foreground"
      style={{ fontSize: 10, letterSpacing: '0.14em' }}
    >
      {children}
    </div>
  );
}

export function FormHeader({
  kicker,
  title,
  lang,
  onLangChange,
}: {
  kicker: string;
  title: string;
  lang: 'en' | 'es';
  onLangChange: (l: 'en' | 'es') => void;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <SectionKicker>{kicker}</SectionKicker>
        <h2
          className="mt-1 font-display font-medium text-foreground"
          style={{ fontSize: 22, lineHeight: 1.15, letterSpacing: '-0.4px' }}
        >
          {title}
        </h2>
      </div>
      <LangToggle lang={lang} onChange={onLangChange} />
    </div>
  );
}

function LangToggle({
  lang,
  onChange,
}: {
  lang: 'en' | 'es';
  onChange: (l: 'en' | 'es') => void;
}) {
  return (
    <div className="inline-flex rounded-sm border border-border bg-card p-0.5">
      {(['en', 'es'] as const).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => onChange(l)}
          aria-pressed={lang === l}
          className={cn(
            'rounded-sm px-3 py-1 font-mono text-[11px] uppercase tracking-wider transition-colors',
            lang === l
              ? 'bg-foreground text-background'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Progress ring
// ────────────────────────────────────────────────────────────

export function ProgressRing({
  percent,
  answered,
  total,
  lang,
}: {
  percent: number;
  answered: number;
  total: number;
  lang: 'en' | 'es';
}) {
  // Tone: accent-muted below 25%, amber up to 75%, sage at 75%+.
  const stroke =
    percent < 25
      ? 'var(--muted-foreground)'
      : percent < 75
        ? 'var(--amber)'
        : 'var(--sage)';

  return (
    <div className="mb-4 flex items-center gap-3.5 rounded-sm border border-border bg-card p-3 shadow-sm">
      <svg width="60" height="60" viewBox="0 0 60 60">
        <circle cx="30" cy="30" r="25" fill="none" stroke="var(--border)" strokeWidth="5" />
        <circle
          cx="30"
          cy="30"
          r="25"
          fill="none"
          stroke={stroke}
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={`${percent * 1.5708} 157.08`}
          transform="rotate(-90 30 30)"
          style={{ transition: 'stroke-dasharray 0.4s ease, stroke 0.3s ease' }}
        />
        <text
          x="30"
          y="34"
          textAnchor="middle"
          fontSize="14"
          fontWeight="700"
          fill="var(--foreground)"
        >
          {percent}%
        </text>
      </svg>
      <div className="text-[13px] font-medium text-muted-foreground">
        {answered} / {total} {lang === 'en' ? 'required fields' : 'campos obligatorios'}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Collapsible group section
// ────────────────────────────────────────────────────────────

export function GroupSection({
  title,
  completedCount,
  totalCount,
  collapsed,
  onToggle,
  children,
}: {
  title: string;
  completedCount: number;
  totalCount: number;
  collapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="mb-3.5 overflow-hidden rounded-sm border border-border bg-card shadow-sm transition-shadow hover:shadow-md">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        className="flex w-full cursor-pointer select-none items-center justify-between border-b border-border bg-muted px-4 py-3 text-left transition-colors hover:bg-[var(--copper-soft)]"
      >
        <h3 className="m-0 text-[15px] font-semibold text-foreground">{title}</h3>
        <div className="flex items-center gap-2">
          {totalCount > 0 && <CompletionBadge done={completedCount} total={totalCount} />}
          <ChevronRightIcon
            className={cn(
              'h-4 w-4 text-muted-foreground transition-transform',
              !collapsed && 'rotate-90',
            )}
          />
        </div>
      </button>
      {!collapsed && <div className="px-4 py-3">{children}</div>}
    </div>
  );
}

function CompletionBadge({ done, total }: { done: number; total: number }) {
  // sage when complete, amber when partial, muted when untouched.
  const tone =
    done === total
      ? { bg: 'var(--sage)', fg: 'var(--card)' }
      : done > 0
        ? { bg: 'var(--amber)', fg: 'var(--card)' }
        : { bg: 'var(--muted)', fg: 'var(--muted-foreground)' };
  return (
    <span
      className="inline-flex items-center rounded-sm px-2 py-0.5 font-mono text-[10px] font-semibold tabular-nums"
      style={{ background: tone.bg, color: tone.fg }}
    >
      {done}/{total}
    </span>
  );
}

// ────────────────────────────────────────────────────────────
// Question rows (all types)
// ────────────────────────────────────────────────────────────

export function QuestionRow({
  number,
  label,
  required,
  isSecondary,
  children,
}: {
  number: string;
  label: string;
  required: boolean;
  isSecondary?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="mb-2.5 rounded-sm border border-border bg-background px-4 py-3 shadow-sm">
      <label
        className={cn(
          'mb-1.5 block text-[14px] font-medium text-foreground',
          isSecondary && 'pl-4 text-[13px] font-normal italic text-muted-foreground',
        )}
      >
        {number}. {label}
        {required && (
          <span className="ml-1" style={{ color: 'var(--warm-red)' }}>
            *
          </span>
        )}
      </label>
      {children}
    </div>
  );
}

export function TextQuestion({
  value,
  onChange,
  maxLength = 500,
}: {
  value: string;
  onChange: (v: string) => void;
  maxLength?: number;
}) {
  return (
    <Input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      maxLength={maxLength}
    />
  );
}

export function TextareaQuestion({
  value,
  onChange,
  maxLength = 5000,
}: {
  value: string;
  onChange: (v: string) => void;
  maxLength?: number;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      maxLength={maxLength}
      className="min-h-[70px] w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-[14px] text-foreground"
    />
  );
}

export function CheckboxQuestion({
  value,
  onChange,
  lang,
}: {
  value: string;
  onChange: (v: string) => void;
  lang: 'en' | 'es';
}) {
  const checked = value === 'true';
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onChange(checked ? 'false' : 'true')}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          onChange(checked ? 'false' : 'true');
        }
      }}
      className="flex cursor-pointer items-center gap-2.5"
    >
      <input
        type="checkbox"
        checked={checked}
        readOnly
        className="h-5 w-5 cursor-pointer"
        style={{ accentColor: 'var(--accent)' }}
      />
      <span
        className="text-[13px]"
        style={{ color: checked ? 'var(--sage)' : 'var(--muted-foreground)' }}
      >
        {checked
          ? lang === 'en'
            ? 'Yes / Confirmed'
            : 'Sí / Confirmado'
          : lang === 'en'
            ? 'Not confirmed'
            : 'No confirmado'}
      </span>
    </div>
  );
}

export function SelectQuestion({
  value,
  onChange,
  options,
  conditionalFormatting,
  lang,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  conditionalFormatting?: Record<string, { bgColor: string; textColor: string }>;
  lang: 'en' | 'es';
}) {
  const fmt = conditionalFormatting && value ? conditionalFormatting[value] : undefined;
  return (
    <div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 w-full rounded-md border border-border bg-background px-3 text-[14px] text-foreground"
      >
        <option value="">{lang === 'en' ? '— Select —' : '— Seleccionar —'}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      {fmt && value && (
        <span
          className="mt-1.5 ml-0 inline-block rounded-sm px-2.5 py-1 text-[13px] font-semibold"
          style={{ background: fmt.bgColor, color: fmt.textColor }}
        >
          {value}
        </span>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Action bar (email field + submit + clear)
// ────────────────────────────────────────────────────────────

export function ActionBar({
  sendTo,
  onSendToChange,
  onSubmit,
  onClear,
  submitting,
  lang,
}: {
  sendTo: string;
  onSendToChange: (v: string) => void;
  onSubmit: () => void;
  onClear: () => void;
  submitting: boolean;
  lang: 'en' | 'es';
}) {
  const submitLabel = submitting
    ? lang === 'en'
      ? 'Submitting…'
      : 'Enviando…'
    : lang === 'en'
      ? sendTo.trim()
        ? 'Submit & email'
        : 'Submit'
      : sendTo.trim()
        ? 'Enviar por email'
        : 'Enviar';

  return (
    <div className="mt-5 flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-2">
        <label className="text-[14px] font-semibold text-foreground">
          {lang === 'en' ? 'Email to:' : 'Enviar a:'}
        </label>
        <Input
          type="email"
          value={sendTo}
          onChange={(e) => onSendToChange(e.target.value)}
          placeholder={
            lang === 'en'
              ? 'email@example.com (optional)'
              : 'email@ejemplo.com (opcional)'
          }
          className="w-[280px]"
        />
      </div>
      <Button type="button" onClick={onSubmit} disabled={submitting}>
        {submitLabel}
      </Button>
      <Button
        type="button"
        variant="outline"
        onClick={onClear}
        style={{ borderColor: 'var(--warm-red)', color: 'var(--warm-red)' }}
      >
        {lang === 'en' ? 'Clear form' : 'Borrar'}
      </Button>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Status banners
// ────────────────────────────────────────────────────────────

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="mt-3 rounded-sm border px-3 py-2 text-[13px]"
      style={{
        background: 'var(--warm-red-soft)',
        borderColor: 'var(--warm-red)',
        color: 'var(--warm-red)',
      }}
    >
      {message}
    </div>
  );
}

export function SuccessBanner({ message }: { message: string }) {
  return (
    <div
      role="status"
      className="mt-3 rounded-sm border px-3 py-2 text-[13px] font-semibold"
      style={{
        background: 'var(--sage-soft)',
        borderColor: 'var(--sage)',
        color: 'var(--sage)',
      }}
    >
      {message}
    </div>
  );
}
