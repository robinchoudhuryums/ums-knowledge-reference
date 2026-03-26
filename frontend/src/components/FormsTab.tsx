/**
 * FormsTab — Container for form-based tools with sub-navigation.
 * Includes PPD Questionnaire, PPD Queue, and PMD Account Creation.
 */

import { useState } from 'react';
import { PpdQuestionnaire } from './PpdQuestionnaire';
import { PpdQueueViewer } from './PpdQueueViewer';
import { AccountCreationForm } from './AccountCreationForm';

type SubTab = 'ppd-questionnaire' | 'ppd-queue' | 'account-creation';

export function FormsTab() {
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('ppd-questionnaire');

  const subTabs: { key: SubTab; label: string }[] = [
    { key: 'ppd-questionnaire', label: 'PPD Questionnaire' },
    { key: 'account-creation', label: 'PMD Account Creation' },
    { key: 'ppd-queue', label: 'PPD Queue' },
  ];

  return (
    <div>
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
      {activeSubTab === 'ppd-questionnaire' && <PpdQuestionnaire />}
      {activeSubTab === 'account-creation' && <AccountCreationForm />}
      {activeSubTab === 'ppd-queue' && <PpdQueueViewer />}
    </div>
  );
}

const styles = {
  subNav: {
    display: 'flex',
    gap: 0,
    marginBottom: 16,
    borderBottom: '2px solid #e0e0e0',
  } as React.CSSProperties,
  subTab: {
    padding: '10px 20px',
    border: 'none',
    background: 'transparent',
    color: '#666',
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
    color: '#1976d2',
    fontSize: 14,
    fontWeight: 700,
    cursor: 'pointer',
    borderBottom: '2px solid #1976d2',
    marginBottom: -2,
  } as React.CSSProperties,
};
