import { useState } from 'react';
import { FolderOpenIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { DocumentManager } from './DocumentManager';
import { DocumentSearch } from './DocumentSearch';
import type { Collection } from '../types';
import { cn } from '@/lib/utils';

type DocSubTab = 'manage' | 'search';

interface Props {
  isAdmin: boolean;
  collections: Collection[];
  onCollectionsChange: () => void;
}

export function DocumentsTab({ isAdmin, collections, onCollectionsChange }: Props) {
  const [active, setActive] = useState<DocSubTab>('manage');

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {/* Sub-nav — mono segmented control */}
      <div className="flex shrink-0 items-center gap-0.5 border-b border-border bg-card px-4 py-2 sm:px-7">
        <SubTab
          active={active === 'manage'}
          onClick={() => setActive('manage')}
          Icon={FolderOpenIcon}
          label="Manage"
        />
        <SubTab
          active={active === 'search'}
          onClick={() => setActive('search')}
          Icon={MagnifyingGlassIcon}
          label="Search"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {active === 'manage' && (
          <DocumentManager
            isAdmin={isAdmin}
            collections={collections}
            onCollectionsChange={onCollectionsChange}
          />
        )}
        {active === 'search' && <DocumentSearch collections={collections} />}
      </div>
    </div>
  );
}

function SubTab({
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
        'inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-[13px] transition-colors',
        active
          ? 'bg-[var(--copper-soft)] text-foreground font-medium shadow-[inset_2px_0_0_var(--accent)]'
          : 'text-muted-foreground hover:bg-muted',
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}
