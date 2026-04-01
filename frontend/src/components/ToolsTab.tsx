import { useState } from 'react';
import { DocumentExtractor } from './DocumentExtractor';
import { OcrTool } from './OcrTool';
import { IntakeAutoFill } from './IntakeAutoFill';
import {
  DocumentTextIcon,
  CameraIcon,
} from '@heroicons/react/24/outline';
import { Stethoscope } from 'lucide-react';

type ToolSubTab = 'extract' | 'ocr' | 'intake';

const subTabs: { key: ToolSubTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'extract', label: 'Extract Data', icon: DocumentTextIcon },
  { key: 'ocr', label: 'OCR Scan', icon: CameraIcon },
  { key: 'intake', label: 'Intake / Clinical', icon: Stethoscope },
];

export function ToolsTab() {
  const [active, setActive] = useState<ToolSubTab>('extract');

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={styles.subNav}>
        {subTabs.map(t => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              onClick={() => setActive(t.key)}
              style={active === t.key ? styles.subTabActive : styles.subTab}
            >
              <Icon className="w-4 h-4" />
              {t.label}
            </button>
          );
        })}
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        {active === 'extract' && <DocumentExtractor />}
        {active === 'ocr' && <OcrTool />}
        {active === 'intake' && <IntakeAutoFill />}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  subNav: {
    display: 'flex',
    gap: '2px',
    padding: '8px 16px',
    borderBottom: '1px solid var(--ums-border)',
    background: 'var(--ums-bg-surface)',
    flexShrink: 0,
  },
  subTab: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 14px',
    fontSize: '13px',
    fontWeight: 500,
    color: 'var(--ums-text-muted)',
    background: 'transparent',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },
  subTabActive: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 14px',
    fontSize: '13px',
    fontWeight: 600,
    color: 'var(--ums-brand-text)',
    background: 'var(--ums-bg-active)',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    boxShadow: 'inset 0 0 0 1px rgba(27, 111, 201, 0.15)',
  },
};
