/**
 * PpdQuestionnairePainGrid — 2-column toggle grid used for the "Consistent Pain"
 * section so the agent can tap body-region buttons instead of walking through
 * yes/no questions one at a time.
 */

import { cn } from '@/lib/utils';
import type { ApiQuestion, Lang } from './PpdQuestionnaireShared';

export function PpdQuestionnairePainGrid({
  questions,
  responses,
  lang,
  onChange,
}: {
  questions: ApiQuestion[];
  responses: Record<string, string>;
  lang: Lang;
  onChange: (id: string, value: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {questions.map((q) => {
        const label =
          lang === 'en'
            ? q.text.replace('?', '')
            : q.spanishText.replace('?', '').replace('¿', '');
        const active = (responses[q.id] ?? '') === 'Yes';
        return (
          <button
            key={q.id}
            type="button"
            onClick={() => onChange(q.id, active ? 'No' : 'Yes')}
            aria-pressed={active}
            className={cn(
              'rounded-sm border px-3 py-2.5 text-center text-[13px] transition-colors',
              active
                ? 'border-[var(--warm-red)] bg-[var(--warm-red-soft)] font-semibold text-[var(--warm-red)]'
                : 'border-border bg-background text-foreground hover:bg-muted',
            )}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
