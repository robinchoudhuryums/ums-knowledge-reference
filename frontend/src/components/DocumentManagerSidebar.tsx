import type { Collection } from '../types';
import { cn } from '@/lib/utils';
import { XMarkIcon, PlusIcon } from '@heroicons/react/24/outline';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

interface Props {
  isAdmin: boolean;
  collections: Collection[];
  selectedCollection: string;
  onSelectCollection: (id: string) => void;
  showNewCol: boolean;
  onShowNewCol: (show: boolean) => void;
  newColName: string;
  newColDesc: string;
  onNewColNameChange: (v: string) => void;
  onNewColDescChange: (v: string) => void;
  onCreateCollection: () => void;
  onDeleteCollection: (id: string) => void;
}

/**
 * Left-rail collection selector for DocumentManager. Kept as its own
 * component so the main file stays focused on table + upload state.
 */
export function DocumentManagerSidebar({
  isAdmin,
  collections,
  selectedCollection,
  onSelectCollection,
  showNewCol,
  onShowNewCol,
  newColName,
  newColDesc,
  onNewColNameChange,
  onNewColDescChange,
  onCreateCollection,
  onDeleteCollection,
}: Props) {
  return (
    <aside className="doc-sidebar w-[260px] shrink-0 overflow-y-auto border-r border-border bg-card p-4">
      <div
        className="mb-3 font-mono uppercase text-muted-foreground"
        style={{ fontSize: 10, letterSpacing: '0.14em' }}
      >
        Collections
      </div>

      <CollectionRow
        label="All documents"
        active={selectedCollection === ''}
        onClick={() => onSelectCollection('')}
      />

      {collections.map((col) => (
        <div key={col.id} className="flex items-center gap-1">
          <CollectionRow
            label={col.name}
            active={selectedCollection === col.id}
            onClick={() => onSelectCollection(col.id)}
            className="flex-1"
          />
          {isAdmin && (
            <button
              type="button"
              onClick={() => onDeleteCollection(col.id)}
              aria-label={`Delete collection ${col.name}`}
              className="rounded-sm p-1 text-muted-foreground hover:text-foreground"
            >
              <XMarkIcon className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ))}

      {isAdmin && !showNewCol && (
        <button
          type="button"
          onClick={() => onShowNewCol(true)}
          className="mt-2 flex w-full items-center justify-center gap-1 rounded-sm border border-dashed border-border px-3 py-2 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <PlusIcon className="h-3.5 w-3.5" />
          New collection
        </button>
      )}

      {isAdmin && showNewCol && (
        <div className="mt-2 flex flex-col gap-1.5">
          <Input
            placeholder="Name"
            value={newColName}
            onChange={(e) => onNewColNameChange(e.target.value)}
            className="h-8 text-[13px]"
          />
          <Input
            placeholder="Description"
            value={newColDesc}
            onChange={(e) => onNewColDescChange(e.target.value)}
            className="h-8 text-[13px]"
          />
          <div className="flex gap-1.5">
            <Button type="button" size="sm" onClick={onCreateCollection} className="flex-1">
              Create
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onShowNewCol(false)}
              className="flex-1"
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </aside>
  );
}

function CollectionRow({
  label,
  active,
  onClick,
  className,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'w-full rounded-sm px-3 py-1.5 text-left text-[13px] transition-colors',
        active
          ? 'bg-[var(--copper-soft)] text-foreground font-medium shadow-[inset_2px_0_0_var(--accent)]'
          : 'text-muted-foreground hover:bg-muted',
        className,
      )}
    >
      <span className="block truncate">{label}</span>
    </button>
  );
}
