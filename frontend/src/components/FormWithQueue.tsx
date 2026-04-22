/**
 * FormWithQueue — Wraps a form component with a "Form / Queue" toggle.
 * Each form (PPD, PMD Account, PAP Account) gets its own queue view.
 */

import { useState } from 'react';
import { ClipboardDocumentListIcon, DocumentTextIcon } from '@heroicons/react/24/outline';
import { cn } from '@/lib/utils';

interface Props {
  formLabel: string;
  queueLabel: string;
  FormComponent: React.ComponentType;
  QueueComponent: React.ComponentType;
}

export function FormWithQueue({
  formLabel,
  queueLabel,
  FormComponent,
  QueueComponent,
}: Props) {
  const [view, setView] = useState<'form' | 'queue'>('form');

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 items-center gap-1 border-b border-border bg-muted px-4 py-1.5 sm:px-7">
        <ToggleButton
          active={view === 'form'}
          onClick={() => setView('form')}
          Icon={DocumentTextIcon}
          label={formLabel}
        />
        <ToggleButton
          active={view === 'queue'}
          onClick={() => setView('queue')}
          Icon={ClipboardDocumentListIcon}
          label={queueLabel}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {view === 'form' ? <FormComponent /> : <QueueComponent />}
      </div>
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  Icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-sm border px-3 py-1 text-[12px] transition-colors',
        active
          ? 'border-border bg-card font-semibold text-foreground shadow-sm'
          : 'border-transparent bg-transparent text-muted-foreground hover:text-foreground',
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}
