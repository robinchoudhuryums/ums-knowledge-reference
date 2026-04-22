/**
 * FormsTab — Container for form-based tools with sub-navigation.
 * Each form includes its own submission queue as a "Form / Queue" toggle.
 */

import { useState } from 'react';
import { ClipboardDocumentListIcon } from '@heroicons/react/24/outline';
import { PpdQuestionnaire } from './PpdQuestionnaire';
import { PpdQueueViewer } from './PpdQueueViewer';
import { AccountCreationForm } from './AccountCreationForm';
import { PapAccountCreationForm } from './PapAccountCreationForm';
import { FormWithQueue } from './FormWithQueue';
import { cn } from '@/lib/utils';

type SubTab = 'ppd' | 'pmd-account' | 'pap-account';

const SUB_TABS: { key: SubTab; label: string }[] = [
  { key: 'ppd', label: 'PPD Questionnaire' },
  { key: 'pmd-account', label: 'PMD Account Creation' },
  { key: 'pap-account', label: 'PAP Account Creation' },
];

export function FormsTab() {
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('ppd');

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {/* Sub-nav — mono-font tabs with accent underline for active */}
      <div className="flex shrink-0 items-center gap-0 border-b border-border bg-card px-4 sm:px-7">
        {SUB_TABS.map((t) => {
          const active = activeSubTab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setActiveSubTab(t.key)}
              aria-pressed={active}
              className={cn(
                'relative px-4 py-2.5 text-[13px] transition-colors',
                active
                  ? 'font-semibold text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t.label}
              {active && (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-0 bottom-0 h-0.5"
                  style={{ background: 'var(--accent)' }}
                />
              )}
            </button>
          );
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {activeSubTab === 'ppd' && (
          <FormWithQueue
            formLabel="PPD Form"
            queueLabel="PPD Queue"
            FormComponent={PpdQuestionnaire}
            QueueComponent={PpdQueueViewer}
          />
        )}
        {activeSubTab === 'pmd-account' && (
          <FormWithQueue
            formLabel="PMD Form"
            queueLabel="PMD Queue"
            FormComponent={AccountCreationForm}
            QueueComponent={PmdQueuePlaceholder}
          />
        )}
        {activeSubTab === 'pap-account' && (
          <FormWithQueue
            formLabel="PAP Form"
            queueLabel="PAP Queue"
            FormComponent={PapAccountCreationForm}
            QueueComponent={PapQueuePlaceholder}
          />
        )}
      </div>
    </div>
  );
}

function QueuePlaceholder({ title, message }: { title: string; message: string }) {
  return (
    <div className="mx-auto my-6 max-w-[1100px] px-4 sm:px-7">
      <div className="rounded-sm border border-border bg-card px-6 py-10 text-center shadow-sm">
        <div
          aria-hidden="true"
          className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-sm"
          style={{ background: 'var(--copper-soft)', color: 'var(--accent)' }}
        >
          <ClipboardDocumentListIcon className="h-6 w-6" />
        </div>
        <p className="mb-1 text-[15px] font-semibold text-foreground">{title}</p>
        <p className="text-[13px] text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}

function PmdQueuePlaceholder() {
  return (
    <QueuePlaceholder
      title="PMD account submission queue"
      message="PMD Account Creation submissions will appear here. Currently, submissions are sent via email."
    />
  );
}

function PapQueuePlaceholder() {
  return (
    <QueuePlaceholder
      title="PAP account submission queue"
      message="PAP Account Creation submissions will appear here. Currently, submissions are sent via email."
    />
  );
}
