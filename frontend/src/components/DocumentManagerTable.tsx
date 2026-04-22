import { useMemo } from 'react';
import type { Document } from '../types';
import { LoadingSkeleton } from './LoadingSkeleton';
import { cn } from '@/lib/utils';
import {
  DocumentTextIcon,
  DocumentIcon,
  TableCellsIcon,
  XMarkIcon,
  PlusIcon,
  ArrowsUpDownIcon,
  ChevronUpIcon,
  ChevronDownIcon,
  ChevronDoubleLeftIcon,
  ChevronDoubleRightIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from '@heroicons/react/24/outline';

export type SortField = 'name' | 'status' | 'size' | 'chunks' | 'uploaded' | 'uploadedBy';
export type SortDir = 'asc' | 'desc';

const PAGE_SIZE_OPTIONS = [10, 25, 50];

interface Props {
  isAdmin: boolean;
  documents: Document[];
  documentsLoading: boolean;

  // Sort + paging
  sortField: SortField;
  sortDir: SortDir;
  onSort: (f: SortField) => void;
  page: number;
  pageSize: number;
  onPageChange: (p: number) => void;
  onPageSizeChange: (n: number) => void;

  // Selection
  selectedIds: Set<string>;
  onToggleSelectAll: () => void;
  onToggleSelectDoc: (id: string) => void;

  // Tag editing (parent owns mutation)
  allTags: string[];
  editingTagsDocId: string | null;
  tagInput: string;
  onSetTagInput: (v: string) => void;
  onStartEditTags: (id: string) => void;
  onStopEditTags: () => void;
  onAddTag: (id: string, existing: string[]) => void;
  onRemoveTag: (id: string, existing: string[], tag: string) => void;

  onDelete: (doc: Document) => void;
}

export function DocumentManagerTable(props: Props) {
  const { documents, sortField, sortDir, page, pageSize } = props;

  // Sort in-place; pagination after sort so all pages use consistent order.
  const sorted = useMemo(() => {
    const arr = [...documents].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'name':
          cmp = a.originalName.localeCompare(b.originalName);
          break;
        case 'status':
          cmp = (a.status || '').localeCompare(b.status || '');
          break;
        case 'size':
          cmp = a.sizeBytes - b.sizeBytes;
          break;
        case 'chunks':
          cmp = a.chunkCount - b.chunkCount;
          break;
        case 'uploaded':
          cmp = new Date(a.uploadedAt).getTime() - new Date(b.uploadedAt).getTime();
          break;
        case 'uploadedBy':
          cmp = (a.uploadedBy || '').localeCompare(b.uploadedBy || '');
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return arr;
  }, [documents, sortField, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const paged = sorted.slice((page - 1) * pageSize, page * pageSize);
  const colCount = props.isAdmin ? 9 : 7;

  return (
    <>
      <div className="overflow-auto rounded-sm border border-border bg-card">
        <table className="w-full min-w-[700px] border-collapse" aria-label="Uploaded documents">
          <thead>
            <tr>
              {props.isAdmin && (
                <Th className="w-10 text-center">
                  <input
                    type="checkbox"
                    checked={
                      sorted.length > 0 && sorted.every((d) => props.selectedIds.has(d.id))
                    }
                    ref={(el) => {
                      if (el) {
                        el.indeterminate =
                          props.selectedIds.size > 0 &&
                          !sorted.every((d) => props.selectedIds.has(d.id));
                      }
                    }}
                    onChange={props.onToggleSelectAll}
                    aria-label="Select all documents"
                  />
                </Th>
              )}
              <SortableTh field="name" label="Name" {...props} />
              <SortableTh field="status" label="Status" {...props} />
              <SortableTh field="size" label="Size" {...props} />
              <SortableTh field="chunks" label="Chunks" {...props} />
              <Th>Tags</Th>
              <SortableTh field="uploaded" label="Uploaded" {...props} />
              <SortableTh field="uploadedBy" label="By" {...props} />
              {props.isAdmin && <Th>Actions</Th>}
            </tr>
          </thead>
          <tbody>
            {paged.map((doc) => (
              <DocRow key={doc.id} doc={doc} {...props} />
            ))}
            {props.documentsLoading && documents.length === 0 && (
              <tr>
                <td colSpan={colCount} className="p-3">
                  <LoadingSkeleton rows={5} widths={[100, 95, 90, 85, 92]} />
                </td>
              </tr>
            )}
            {!props.documentsLoading && documents.length === 0 && (
              <tr>
                <td
                  colSpan={colCount}
                  className="p-10 text-center text-[13px] text-muted-foreground"
                >
                  No documents uploaded yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {documents.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <div className="text-[12px] text-muted-foreground">
            Showing {(page - 1) * pageSize + 1}
            –{Math.min(page * pageSize, sorted.length)} of {sorted.length}
          </div>
          <div className="flex items-center gap-1.5">
            <label className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
              Per page:
              <select
                value={pageSize}
                onChange={(e) => props.onPageSizeChange(Number(e.target.value))}
                className="rounded-sm border border-border bg-card px-2 py-0.5 text-[12px] text-foreground"
              >
                {PAGE_SIZE_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <PageBtn onClick={() => props.onPageChange(1)} disabled={page <= 1} ariaLabel="First page">
              <ChevronDoubleLeftIcon className="h-3.5 w-3.5" />
            </PageBtn>
            <PageBtn
              onClick={() => props.onPageChange(page - 1)}
              disabled={page <= 1}
              ariaLabel="Previous page"
            >
              <ChevronLeftIcon className="h-3.5 w-3.5" />
            </PageBtn>
            <span className="px-2 font-mono text-[12px] text-muted-foreground">
              Page {page} of {totalPages}
            </span>
            <PageBtn
              onClick={() => props.onPageChange(page + 1)}
              disabled={page >= totalPages}
              ariaLabel="Next page"
            >
              <ChevronRightIcon className="h-3.5 w-3.5" />
            </PageBtn>
            <PageBtn
              onClick={() => props.onPageChange(totalPages)}
              disabled={page >= totalPages}
              ariaLabel="Last page"
            >
              <ChevronDoubleRightIcon className="h-3.5 w-3.5" />
            </PageBtn>
          </div>
        </div>
      )}
    </>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={cn(
        'whitespace-nowrap border-b border-border bg-muted px-4 py-3 text-left font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground',
        className,
      )}
    >
      {children}
    </th>
  );
}

function SortableTh({
  field,
  label,
  sortField,
  sortDir,
  onSort,
}: {
  field: SortField;
  label: string;
  sortField: SortField;
  sortDir: SortDir;
  onSort: (f: SortField) => void;
}) {
  const active = sortField === field;
  const Icon = !active ? ArrowsUpDownIcon : sortDir === 'asc' ? ChevronUpIcon : ChevronDownIcon;
  return (
    <Th>
      <button
        type="button"
        onClick={() => onSort(field)}
        className="inline-flex select-none items-center gap-1 text-muted-foreground hover:text-foreground"
      >
        {label}
        <Icon className="h-3 w-3" />
      </button>
    </Th>
  );
}

function DocRow({
  doc,
  ...p
}: { doc: Document } & Omit<Props, 'documents' | 'documentsLoading'>) {
  return (
    <tr className="border-b border-border transition-colors last:border-b-0 hover:bg-muted/50">
      {p.isAdmin && (
        <td className="px-4 py-2.5 text-center">
          <input
            type="checkbox"
            checked={p.selectedIds.has(doc.id)}
            onChange={() => p.onToggleSelectDoc(doc.id)}
            aria-label={`Select ${doc.originalName}`}
          />
        </td>
      )}
      <td className="px-4 py-2.5 text-[13px] text-foreground">
        <FileIcon name={doc.originalName} />
        <span className="ml-2">{doc.originalName}</span>
      </td>
      <td className="px-4 py-2.5">
        <StatusBadge status={doc.status} />
      </td>
      <td className="px-4 py-2.5 font-mono text-[12px] tabular-nums text-muted-foreground">
        {formatSize(doc.sizeBytes)}
      </td>
      <td className="px-4 py-2.5">
        <span className="inline-flex items-center rounded-sm bg-muted px-2 py-0.5 font-mono text-[11px] tabular-nums text-foreground">
          {doc.chunkCount}
        </span>
      </td>
      <td className="px-4 py-2.5">
        <TagEditor
          doc={doc}
          isAdmin={p.isAdmin}
          editingTagsDocId={p.editingTagsDocId}
          tagInput={p.tagInput}
          allTags={p.allTags}
          onSetTagInput={p.onSetTagInput}
          onStartEditTags={p.onStartEditTags}
          onStopEditTags={p.onStopEditTags}
          onAddTag={p.onAddTag}
          onRemoveTag={p.onRemoveTag}
        />
      </td>
      <td className="px-4 py-2.5 font-mono text-[12px] text-muted-foreground">
        {new Date(doc.uploadedAt).toLocaleDateString()}
      </td>
      <td className="px-4 py-2.5 text-[12px] text-muted-foreground">{doc.uploadedBy}</td>
      {p.isAdmin && (
        <td className="px-4 py-2.5">
          <button
            type="button"
            onClick={() => p.onDelete(doc)}
            aria-label={`Delete ${doc.originalName}`}
            className="rounded-sm border px-3 py-1 text-[12px] font-medium"
            style={{
              borderColor: 'var(--warm-red)',
              color: 'var(--warm-red)',
            }}
          >
            Delete
          </button>
        </td>
      )}
    </tr>
  );
}

function FileIcon({ name }: { name: string }) {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  if (['xls', 'xlsx', 'csv'].includes(ext))
    return <TableCellsIcon className="inline-block h-4 w-4 text-muted-foreground" />;
  if (ext === 'pdf')
    return <DocumentIcon className="inline-block h-4 w-4 text-muted-foreground" />;
  return <DocumentTextIcon className="inline-block h-4 w-4 text-muted-foreground" />;
}

function StatusBadge({ status }: { status: string | undefined }) {
  const tone =
    status === 'ready'
      ? { fg: 'var(--sage)', bg: 'var(--sage-soft)', border: 'var(--sage)' }
      : status === 'processing'
        ? { fg: 'var(--accent)', bg: 'var(--copper-soft)', border: 'var(--accent)' }
        : status === 'error'
          ? { fg: 'var(--warm-red)', bg: 'var(--warm-red-soft)', border: 'var(--warm-red)' }
          : {
              fg: 'var(--muted-foreground)',
              bg: 'var(--muted)',
              border: 'var(--border)',
            };
  return (
    <span
      className="inline-flex items-center rounded-sm border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider"
      style={{ background: tone.bg, borderColor: tone.border, color: tone.fg }}
    >
      {status || 'unknown'}
    </span>
  );
}

function TagEditor({
  doc,
  isAdmin,
  editingTagsDocId,
  tagInput,
  allTags,
  onSetTagInput,
  onStartEditTags,
  onStopEditTags,
  onAddTag,
  onRemoveTag,
}: {
  doc: Document;
  isAdmin: boolean;
  editingTagsDocId: string | null;
  tagInput: string;
  allTags: string[];
  onSetTagInput: (v: string) => void;
  onStartEditTags: (id: string) => void;
  onStopEditTags: () => void;
  onAddTag: (id: string, existing: string[]) => void;
  onRemoveTag: (id: string, existing: string[], tag: string) => void;
}) {
  const tags = doc.tags || [];
  const isEditing = isAdmin && editingTagsDocId === doc.id;

  return (
    <div className="flex flex-wrap items-center gap-1">
      {tags.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-0.5 rounded-sm border border-border bg-muted px-1.5 py-0.5 text-[11px] font-medium text-foreground"
        >
          {tag}
          {isAdmin && (
            <button
              type="button"
              onClick={() => onRemoveTag(doc.id, tags, tag)}
              aria-label={`Remove tag ${tag}`}
              className="text-muted-foreground hover:text-foreground"
            >
              <XMarkIcon className="h-2.5 w-2.5" />
            </button>
          )}
        </span>
      ))}
      {isEditing ? (
        <>
          <input
            value={tagInput}
            onChange={(e) => onSetTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onAddTag(doc.id, tags);
              }
              if (e.key === 'Escape') onStopEditTags();
            }}
            placeholder="tag"
            className="w-[72px] rounded-sm border border-border bg-background px-1.5 py-0.5 text-[11px]"
            list="tag-suggestions"
            autoFocus
          />
          <datalist id="tag-suggestions">
            {allTags
              .filter((t) => !tags.includes(t))
              .map((t) => (
                <option key={t} value={t} />
              ))}
          </datalist>
        </>
      ) : isAdmin ? (
        <button
          type="button"
          onClick={() => onStartEditTags(doc.id)}
          aria-label={`Add tag to ${doc.originalName}`}
          className="rounded-sm border border-dashed border-border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
        >
          <PlusIcon className="h-3 w-3" />
        </button>
      ) : null}
    </div>
  );
}

function PageBtn({
  children,
  onClick,
  disabled,
  ariaLabel,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className="flex h-7 w-7 items-center justify-center rounded-sm border border-border bg-card text-muted-foreground disabled:opacity-40 hover:bg-muted hover:text-foreground"
    >
      {children}
    </button>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
