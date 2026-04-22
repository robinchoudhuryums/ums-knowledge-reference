import type { ExtractionTemplateInfo } from '../services/api';
import {
  BuildingOffice2Icon,
  CreditCardIcon,
  ShieldCheckIcon,
  ClipboardDocumentListIcon,
  DocumentTextIcon,
} from '@heroicons/react/24/outline';
import { cn } from '@/lib/utils';

interface Props {
  templates: ExtractionTemplateInfo[];
  selectedTemplateId: string;
  onSelect: (id: string) => void;
}

const CATEGORY_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  clinical: BuildingOffice2Icon,
  billing: CreditCardIcon,
  compliance: ShieldCheckIcon,
  general: ClipboardDocumentListIcon,
};

export function DocumentExtractorTemplateGrid({
  templates,
  selectedTemplateId,
  onSelect,
}: Props) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {templates.map((t) => {
        const Icon = CATEGORY_ICON[t.category] || DocumentTextIcon;
        const active = selectedTemplateId === t.id;
        return (
          <button
            key={t.id}
            type="button"
            onClick={() => onSelect(t.id)}
            aria-pressed={active}
            className={cn(
              'flex flex-col rounded-sm border p-4 text-left transition-colors',
              active
                ? 'border-accent bg-[var(--copper-soft)]'
                : 'border-border bg-card hover:bg-muted',
            )}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <span
                className="flex h-8 w-8 items-center justify-center rounded-sm"
                style={{
                  background: active ? 'var(--card)' : 'var(--copper-soft)',
                  color: 'var(--accent)',
                }}
                aria-hidden="true"
              >
                <Icon className="h-4 w-4" />
              </span>
              <span
                className="font-mono uppercase text-muted-foreground"
                style={{ fontSize: 10, letterSpacing: '0.12em' }}
              >
                {t.category}
              </span>
            </div>
            <div className="text-[14px] font-medium text-foreground">{t.name}</div>
            <div className="mt-0.5 line-clamp-2 text-[12px] leading-relaxed text-muted-foreground">
              {t.description}
            </div>
            <div
              className="mt-2 font-mono text-[11px] text-muted-foreground"
              style={{ letterSpacing: '0.04em' }}
            >
              {t.fieldCount} field{t.fieldCount !== 1 ? 's' : ''}
            </div>
          </button>
        );
      })}
    </div>
  );
}
