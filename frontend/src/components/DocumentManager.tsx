import { useState, useEffect, useRef } from 'react';
import type { Document, Collection } from '../types';
import {
  listDocuments,
  uploadDocument,
  deleteDocument,
  bulkDeleteDocuments,
  createCollection,
  deleteCollection,
  updateDocumentTags,
  listAllTags,
} from '../services/api';
import { useToast } from './Toast';
import { useConfirm } from './ConfirmDialog';
import { DocumentManagerSidebar } from './DocumentManagerSidebar';
import { DocumentManagerUploadQueue, type UploadQueueItem } from './DocumentManagerUploadQueue';
import {
  DocumentManagerTable,
  type SortField,
  type SortDir,
} from './DocumentManagerTable';
import { Button } from '@/components/ui/button';
import { ArrowUpTrayIcon, TrashIcon } from '@heroicons/react/24/outline';

interface Props {
  isAdmin: boolean;
  collections: Collection[];
  onCollectionsChange: () => void;
}

function SectionKicker({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="font-mono uppercase text-muted-foreground"
      style={{ fontSize: 10, letterSpacing: '0.14em' }}
    >
      {children}
    </div>
  );
}

export function DocumentManager({ isAdmin, collections, onCollectionsChange }: Props) {
  const { addToast } = useToast();
  const { confirm } = useConfirm();

  const [documents, setDocuments] = useState<Document[]>([]);
  const [documentsLoading, setDocumentsLoading] = useState(true);
  const [selectedCollection, setSelectedCollection] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [error, setError] = useState('');

  // New-collection form
  const [newColName, setNewColName] = useState('');
  const [newColDesc, setNewColDesc] = useState('');
  const [showNewCol, setShowNewCol] = useState(false);

  // Tags
  const [allTags, setAllTags] = useState<string[]>([]);
  const [editingTagsDocId, setEditingTagsDocId] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState('');

  // Selection for bulk delete
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // Pagination + sorting
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sortField, setSortField] = useState<SortField>('uploaded');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const [uploadQueue, setUploadQueue] = useState<UploadQueueItem[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadDocuments = async () => {
    setDocumentsLoading(true);
    try {
      const result = await listDocuments(selectedCollection || undefined);
      setDocuments(result.documents);
    } catch {
      setError('Failed to load documents');
    } finally {
      setDocumentsLoading(false);
    }
  };

  const loadTags = async () => {
    try {
      const result = await listAllTags();
      setAllTags(result.tags);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    loadDocuments();
    loadTags();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCollection]);

  // Reset page and selection when collection or sort changes.
  useEffect(() => {
    setPage(1);
    setSelectedIds(new Set());
  }, [selectedCollection, sortField, sortDir, pageSize]);

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const fileList = Array.from(files);
    setUploading(true);
    setError('');

    // 50 MB server multer limit — surface early before the browser reads
    // a half-gig file into memory and freezes the tab.
    const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
    const oversize = fileList.filter((f) => f.size > MAX_UPLOAD_BYTES);
    if (oversize.length > 0) {
      setError(
        `File${oversize.length === 1 ? '' : 's'} too large (max 50 MB): ` +
          oversize
            .map((f) => `${f.name} (${(f.size / 1024 / 1024).toFixed(1)} MB)`)
            .join(', '),
      );
      setUploading(false);
      return;
    }

    const queue: UploadQueueItem[] = fileList.map((f) => ({
      name: f.name,
      status: 'pending',
    }));
    setUploadQueue(queue);

    let successCount = 0;
    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      setUploadQueue((prev) =>
        prev.map((item, idx) => (idx === i ? { ...item, status: 'uploading' } : item)),
      );
      setUploadProgress(`Processing ${file.name} (${i + 1}/${fileList.length})…`);

      try {
        await uploadDocument(file, selectedCollection || 'default');
        setUploadQueue((prev) =>
          prev.map((item, idx) => (idx === i ? { ...item, status: 'done' } : item)),
        );
        successCount++;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        setUploadQueue((prev) =>
          prev.map((item, idx) =>
            idx === i ? { ...item, status: 'error', error: errMsg } : item,
          ),
        );
        addToast(`Failed to upload ${file.name}: ${errMsg}`, 'error');
      }
    }

    if (successCount > 0) {
      addToast(
        `${successCount} document${successCount > 1 ? 's' : ''} uploaded successfully`,
        'success',
      );
    }

    setUploading(false);
    setUploadProgress('');
    if (fileInputRef.current) fileInputRef.current.value = '';
    loadDocuments();

    setTimeout(() => setUploadQueue([]), 5000);
  };

  const handleDelete = async (doc: Document) => {
    const confirmed = await confirm({
      title: 'Delete document',
      message: `Delete "${doc.originalName}"? This cannot be undone.`,
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!confirmed) return;
    try {
      await deleteDocument(doc.id);
      addToast(`"${doc.originalName}" deleted`, 'success');
      loadDocuments();
    } catch {
      addToast('Failed to delete document', 'error');
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    const confirmed = await confirm({
      title: 'Bulk delete',
      message: `Delete ${selectedIds.size} selected document(s)? This cannot be undone.`,
      confirmLabel: `Delete ${selectedIds.size}`,
      variant: 'danger',
    });
    if (!confirmed) return;
    setBulkDeleting(true);
    try {
      await bulkDeleteDocuments(Array.from(selectedIds));
      addToast(`${selectedIds.size} document(s) deleted`, 'success');
      setSelectedIds(new Set());
      loadDocuments();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Bulk delete failed', 'error');
    } finally {
      setBulkDeleting(false);
    }
  };

  const toggleSelectAll = () => {
    const allSelected =
      documents.length > 0 && documents.every((d) => selectedIds.has(d.id));
    if (allSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(documents.map((d) => d.id)));
  };

  const toggleSelectDoc = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCreateCollection = async () => {
    if (!newColName.trim()) return;
    try {
      await createCollection(newColName.trim(), newColDesc.trim());
      addToast(`Collection "${newColName.trim()}" created`, 'success');
      setNewColName('');
      setNewColDesc('');
      setShowNewCol(false);
      onCollectionsChange();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to create collection', 'error');
    }
  };

  const handleDeleteCollection = async (id: string) => {
    const col = collections.find((c) => c.id === id);
    const confirmed = await confirm({
      title: 'Delete collection',
      message: `Delete "${col?.name || 'this collection'}"? All documents must be removed first.`,
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!confirmed) return;
    try {
      await deleteCollection(id);
      addToast('Collection deleted', 'success');
      if (selectedCollection === id) setSelectedCollection('');
      onCollectionsChange();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to delete collection', 'error');
    }
  };

  const handleAddTag = async (docId: string, existingTags: string[]) => {
    const tag = tagInput.trim().toLowerCase();
    if (!tag) return;
    const newTags = [...new Set([...existingTags, tag])];
    try {
      await updateDocumentTags(docId, newTags);
      setTagInput('');
      loadDocuments();
      loadTags();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to update tags', 'error');
    }
  };

  const handleRemoveTag = async (
    docId: string,
    existingTags: string[],
    tagToRemove: string,
  ) => {
    const newTags = existingTags.filter((t) => t !== tagToRemove);
    try {
      await updateDocumentTags(docId, newTags);
      loadDocuments();
      loadTags();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to update tags', 'error');
    }
  };

  return (
    <div className="doc-manager flex h-full min-h-0 bg-background">
      <DocumentManagerSidebar
        isAdmin={isAdmin}
        collections={collections}
        selectedCollection={selectedCollection}
        onSelectCollection={setSelectedCollection}
        showNewCol={showNewCol}
        onShowNewCol={setShowNewCol}
        newColName={newColName}
        newColDesc={newColDesc}
        onNewColNameChange={setNewColName}
        onNewColDescChange={setNewColDesc}
        onCreateCollection={handleCreateCollection}
        onDeleteCollection={handleDeleteCollection}
      />

      <div className="doc-main min-w-0 flex-1 overflow-y-auto bg-background px-4 py-6 sm:px-7">
        {/* Header */}
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <SectionKicker>Library</SectionKicker>
            <h2
              className="mt-1 font-display font-medium text-foreground"
              style={{ fontSize: 22, lineHeight: 1.15, letterSpacing: '-0.4px' }}
            >
              Documents
            </h2>
            <p className="mt-1 text-[13px] text-muted-foreground">
              {documents.length} document{documents.length !== 1 ? 's' : ''} uploaded
            </p>
          </div>
          {isAdmin && (
            <div className="flex flex-wrap items-center gap-2">
              {selectedIds.size > 0 && (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={handleBulkDelete}
                  disabled={bulkDeleting}
                  className="gap-1.5"
                  aria-label={`Delete ${selectedIds.size} selected documents`}
                >
                  <TrashIcon className="h-4 w-4" />
                  {bulkDeleting ? 'Deleting…' : `Delete ${selectedIds.size}`}
                </Button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.docx,.doc,.xlsx,.xls,.csv,.txt,.md"
                onChange={handleUpload}
                className="hidden"
                aria-label="Select files to upload"
              />
              <Button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="gap-1.5"
                aria-label="Upload new documents"
              >
                <ArrowUpTrayIcon className="h-4 w-4" />
                {uploading ? uploadProgress || 'Uploading…' : 'Upload documents'}
              </Button>
            </div>
          )}
        </div>

        {error && (
          <div
            role="alert"
            className="mb-4 rounded-sm border px-3 py-2 text-[13px]"
            style={{
              background: 'var(--warm-red-soft)',
              borderColor: 'var(--warm-red)',
              color: 'var(--warm-red)',
            }}
          >
            {error}
          </div>
        )}

        <DocumentManagerUploadQueue items={uploadQueue} />

        <DocumentManagerTable
          isAdmin={isAdmin}
          documents={documents}
          documentsLoading={documentsLoading}
          sortField={sortField}
          sortDir={sortDir}
          onSort={handleSort}
          page={page}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          selectedIds={selectedIds}
          onToggleSelectAll={toggleSelectAll}
          onToggleSelectDoc={toggleSelectDoc}
          allTags={allTags}
          editingTagsDocId={editingTagsDocId}
          tagInput={tagInput}
          onSetTagInput={setTagInput}
          onStartEditTags={(id) => {
            setEditingTagsDocId(id);
            setTagInput('');
          }}
          onStopEditTags={() => setEditingTagsDocId(null)}
          onAddTag={handleAddTag}
          onRemoveTag={handleRemoveTag}
          onDelete={handleDelete}
        />
      </div>
    </div>
  );
}
