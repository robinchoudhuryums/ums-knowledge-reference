import { useState } from 'react';
import { DocumentManager } from './DocumentManager';
import { DocumentSearch } from './DocumentSearch';
import { Collection } from '../types';
import {
  FolderOpenIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/outline';

type DocSubTab = 'manage' | 'search';

interface Props {
  isAdmin: boolean;
  collections: Collection[];
  onCollectionsChange: () => void;
}

export function DocumentsTab({ isAdmin, collections, onCollectionsChange }: Props) {
  const [active, setActive] = useState<DocSubTab>('manage');

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={styles.subNav}>
        <button
          onClick={() => setActive('manage')}
          style={active === 'manage' ? styles.subTabActive : styles.subTab}
        >
          <FolderOpenIcon className="w-4 h-4" />
          Manage
        </button>
        <button
          onClick={() => setActive('search')}
          style={active === 'search' ? styles.subTabActive : styles.subTab}
        >
          <MagnifyingGlassIcon className="w-4 h-4" />
          Search
        </button>
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        {active === 'manage' && (
          <DocumentManager
            isAdmin={isAdmin}
            collections={collections}
            onCollectionsChange={onCollectionsChange}
          />
        )}
        {active === 'search' && (
          <DocumentSearch collections={collections} />
        )}
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
