/**
 * FormsTab — Container for form-based tools with sub-navigation.
 * Each form includes its own submission queue as a "Form / Queue" toggle.
 */

import { useState } from 'react';
import { PpdQuestionnaire } from './PpdQuestionnaire';
import { PpdQueueViewer } from './PpdQueueViewer';
import { AccountCreationForm } from './AccountCreationForm';
import { PapAccountCreationForm } from './PapAccountCreationForm';
import { FormWithQueue } from './FormWithQueue';

type SubTab = 'ppd' | 'pmd-account' | 'pap-account';

export function FormsTab() {
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('ppd');

  const subTabs: { key: SubTab; label: string }[] = [
    { key: 'ppd', label: 'PPD Questionnaire' },
    { key: 'pmd-account', label: 'PMD Account Creation' },
    { key: 'pap-account', label: 'PAP Account Creation' },
  ];

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={styles.subNav}>
        {subTabs.map(t => (
          <button
            key={t.key}
            onClick={() => setActiveSubTab(t.key)}
            style={activeSubTab === t.key ? styles.subTabActive : styles.subTab}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
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

/** Placeholder queue for PMD Account submissions (backend queue not yet implemented) */
function PmdQueuePlaceholder() {
  return (
    <div style={queuePlaceholderStyles.container}>
      <div style={queuePlaceholderStyles.card}>
        <div style={{ fontSize: '36px', marginBottom: '12px', opacity: 0.4 }}>📋</div>
        <p style={queuePlaceholderStyles.title}>PMD Account Submission Queue</p>
        <p style={queuePlaceholderStyles.text}>PMD Account Creation submissions will appear here. Currently, submissions are sent via email.</p>
      </div>
    </div>
  );
}

/** Placeholder queue for PAP Account submissions */
function PapQueuePlaceholder() {
  return (
    <div style={queuePlaceholderStyles.container}>
      <div style={queuePlaceholderStyles.card}>
        <div style={{ fontSize: '36px', marginBottom: '12px', opacity: 0.4 }}>📋</div>
        <p style={queuePlaceholderStyles.title}>PAP Account Submission Queue</p>
        <p style={queuePlaceholderStyles.text}>PAP Account Creation submissions will appear here. Currently, submissions are sent via email.</p>
      </div>
    </div>
  );
}

const queuePlaceholderStyles: Record<string, React.CSSProperties> = {
  container: { padding: '28px', maxWidth: '1100px', margin: '20px auto' },
  card: {
    textAlign: 'center', padding: '40px 20px',
    background: 'var(--ums-bg-surface)', borderRadius: '12px',
    border: '1px solid var(--ums-border)', boxShadow: 'var(--ums-shadow-sm)',
  },
  title: { fontSize: '15px', fontWeight: 600, color: 'var(--ums-text-primary)', margin: '0 0 4px' },
  text: { fontSize: '13px', color: 'var(--ums-text-muted)', margin: 0 },
};

const styles = {
  subNav: {
    display: 'flex',
    gap: 0,
    borderBottom: '2px solid var(--ums-border)',
    flexShrink: 0,
  } as React.CSSProperties,
  subTab: {
    padding: '10px 20px',
    border: 'none',
    background: 'transparent',
    color: 'var(--ums-text-muted)',
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer',
    borderBottom: '2px solid transparent',
    marginBottom: -2,
  } as React.CSSProperties,
  subTabActive: {
    padding: '10px 20px',
    border: 'none',
    background: 'transparent',
    color: 'var(--ums-brand-primary)',
    fontSize: 14,
    fontWeight: 700,
    cursor: 'pointer',
    borderBottom: '2px solid var(--ums-brand-primary)',
    marginBottom: -2,
  } as React.CSSProperties,
};
