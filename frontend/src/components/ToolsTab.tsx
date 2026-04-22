/**
 * ToolsTab — Container for ad-hoc document tools with sub-navigation
 * (structured extraction, OCR scan, intake / clinical autofill).
 */

import { useState } from 'react';
import { DocumentTextIcon, CameraIcon } from '@heroicons/react/24/outline';
import { Stethoscope } from 'lucide-react';
import { DocumentExtractor } from './DocumentExtractor';
import { OcrTool } from './OcrTool';
import { IntakeAutoFill } from './IntakeAutoFill';
import { cn } from '@/lib/utils';

type ToolSubTab = 'extract' | 'ocr' | 'intake';

const SUB_TABS: {
  key: ToolSubTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { key: 'extract', label: 'Extract data', icon: DocumentTextIcon },
  { key: 'ocr', label: 'OCR scan', icon: CameraIcon },
  { key: 'intake', label: 'Intake / clinical', icon: Stethoscope },
];

export function ToolsTab() {
  const [active, setActive] = useState<ToolSubTab>('extract');

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {/* Sub-nav — matches FormsTab accent-underline pattern */}
      <div className="flex shrink-0 items-center gap-0 border-b border-border bg-card px-4 sm:px-7">
        {SUB_TABS.map((t) => {
          const Icon = t.icon;
          const isActive = active === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setActive(t.key)}
              aria-pressed={isActive}
              className={cn(
                'relative flex items-center gap-1.5 px-4 py-2.5 text-[13px] transition-colors',
                isActive
                  ? 'font-semibold text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="h-4 w-4" />
              {t.label}
              {isActive && (
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
        {active === 'extract' && <DocumentExtractor />}
        {active === 'ocr' && <OcrTool />}
        {active === 'intake' && <IntakeAutoFill />}
      </div>
    </div>
  );
}
