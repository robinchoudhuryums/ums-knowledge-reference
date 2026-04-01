/**
 * FormWithQueue — Wraps a form component with a "Form / Queue" toggle.
 * Each form (PPD, PMD Account, PAP Account) gets its own queue view.
 */

import { useState } from 'react';
import {
  ClipboardDocumentListIcon,
  DocumentTextIcon,
} from '@heroicons/react/24/outline';

interface Props {
  formLabel: string;
  queueLabel: string;
  FormComponent: React.ComponentType;
  QueueComponent: React.ComponentType;
}

export function FormWithQueue({ formLabel, queueLabel, FormComponent, QueueComponent }: Props) {
  const [view, setView] = useState<'form' | 'queue'>('form');

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={styles.toggleBar}>
        <button
          onClick={() => setView('form')}
          style={view === 'form' ? styles.toggleActive : styles.toggle}
        >
          <DocumentTextIcon className="w-4 h-4" />
          {formLabel}
        </button>
        <button
          onClick={() => setView('queue')}
          style={view === 'queue' ? styles.toggleActive : styles.toggle}
        >
          <ClipboardDocumentListIcon className="w-4 h-4" />
          {queueLabel}
        </button>
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        {view === 'form' ? <FormComponent /> : <QueueComponent />}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  toggleBar: {
    display: 'flex',
    gap: '4px',
    padding: '6px 16px',
    background: 'var(--ums-bg-surface-alt)',
    borderBottom: '1px solid var(--ums-border)',
    flexShrink: 0,
  },
  toggle: {
    display: 'flex',
    alignItems: 'center',
    gap: '5px',
    padding: '5px 12px',
    fontSize: '12px',
    fontWeight: 500,
    color: 'var(--ums-text-muted)',
    background: 'transparent',
    border: '1px solid transparent',
    borderRadius: '6px',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },
  toggleActive: {
    display: 'flex',
    alignItems: 'center',
    gap: '5px',
    padding: '5px 12px',
    fontSize: '12px',
    fontWeight: 600,
    color: 'var(--ums-brand-text)',
    background: 'var(--ums-bg-surface)',
    border: '1px solid var(--ums-border)',
    borderRadius: '6px',
    cursor: 'pointer',
    boxShadow: 'var(--ums-shadow-sm)',
  },
};
