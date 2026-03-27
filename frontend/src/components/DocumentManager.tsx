import { useState, useEffect, useRef, useMemo } from 'react';
import { Document, Collection } from '../types';
import { LoadingSkeleton } from './LoadingSkeleton';
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

interface Props {
  isAdmin: boolean;
  collections: Collection[];
  onCollectionsChange: () => void;
}

type SortField = 'name' | 'status' | 'size' | 'chunks' | 'uploaded' | 'uploadedBy';
type SortDir = 'asc' | 'desc';

const PAGE_SIZE_OPTIONS = [10, 25, 50];

export function DocumentManager({ isAdmin, collections, onCollectionsChange }: Props) {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [selectedCollection, setSelectedCollection] = useState<string>('');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');
  const [error, setError] = useState('');
  const [newColName, setNewColName] = useState('');
  const [newColDesc, setNewColDesc] = useState('');
  const [showNewCol, setShowNewCol] = useState(false);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [editingTagsDocId, setEditingTagsDocId] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Pagination state
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Sorting state
  const [sortField, setSortField] = useState<SortField>('uploaded');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const { addToast } = useToast();
  const { confirm } = useConfirm();

  const [documentsLoading, setDocumentsLoading] = useState(true);

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
    } catch { /* ignore */ }
  };

  useEffect(() => {
    loadDocuments();
    loadTags();
  }, [selectedCollection]);

  // Reset page when collection or sort changes
  useEffect(() => { setPage(1); }, [selectedCollection, sortField, sortDir, pageSize]);

  // Sorted + paginated documents
  const sortedDocuments = useMemo(() => {
    const sorted = [...documents].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'name': cmp = a.originalName.localeCompare(b.originalName); break;
        case 'status': cmp = (a.status || '').localeCompare(b.status || ''); break;
        case 'size': cmp = a.sizeBytes - b.sizeBytes; break;
        case 'chunks': cmp = a.chunkCount - b.chunkCount; break;
        case 'uploaded': cmp = new Date(a.uploadedAt).getTime() - new Date(b.uploadedAt).getTime(); break;
        case 'uploadedBy': cmp = (a.uploadedBy || '').localeCompare(b.uploadedBy || ''); break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [documents, sortField, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sortedDocuments.length / pageSize));
  const pagedDocuments = sortedDocuments.slice((page - 1) * pageSize, page * pageSize);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const sortIndicator = (field: SortField) => {
    if (sortField !== field) return ' \u2195';
    return sortDir === 'asc' ? ' \u2191' : ' \u2193';
  };

  const [uploadQueue, setUploadQueue] = useState<Array<{ name: string; status: 'pending' | 'uploading' | 'done' | 'error'; error?: string }>>([]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const fileList = Array.from(files);
    setUploading(true);
    setError('');

    const queue = fileList.map(f => ({ name: f.name, status: 'pending' as const }));
    setUploadQueue(queue);

    let successCount = 0;
    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      setUploadQueue(prev => prev.map((item, idx) =>
        idx === i ? { ...item, status: 'uploading' } : item
      ));
      setUploadProgress(`Processing ${file.name} (${i + 1}/${fileList.length})...`);

      try {
        await uploadDocument(file, selectedCollection || 'default');
        setUploadQueue(prev => prev.map((item, idx) =>
          idx === i ? { ...item, status: 'done' } : item
        ));
        successCount++;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        setUploadQueue(prev => prev.map((item, idx) =>
          idx === i ? { ...item, status: 'error', error: errMsg } : item
        ));
        addToast(`Failed to upload ${file.name}: ${errMsg}`, 'error');
      }
    }

    if (successCount > 0) {
      addToast(`${successCount} document${successCount > 1 ? 's' : ''} uploaded successfully`, 'success');
    }

    setUploading(false);
    setUploadProgress('');
    if (fileInputRef.current) fileInputRef.current.value = '';
    loadDocuments();

    setTimeout(() => setUploadQueue([]), 5000);
  };

  const handleDelete = async (doc: Document) => {
    const confirmed = await confirm({
      title: 'Delete Document',
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
      title: 'Bulk Delete',
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
    const allDocsSelected = sortedDocuments.length > 0 &&
      sortedDocuments.every(d => selectedIds.has(d.id));
    const allPageSelected = pagedDocuments.length > 0 &&
      pagedDocuments.every(d => selectedIds.has(d.id));

    if (allDocsSelected) {
      // Everything selected → deselect all
      setSelectedIds(new Set());
    } else if (allPageSelected) {
      // Current page fully selected → extend to all pages
      setSelectedIds(new Set(sortedDocuments.map(d => d.id)));
    } else {
      // Select all on current page first
      setSelectedIds(prev => {
        const next = new Set(prev);
        for (const d of pagedDocuments) next.add(d.id);
        return next;
      });
    }
  };

  const toggleSelectDoc = (id: string) => {
    setSelectedIds(prev => {
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
    const col = collections.find(c => c.id === id);
    const confirmed = await confirm({
      title: 'Delete Collection',
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

  const handleRemoveTag = async (docId: string, existingTags: string[], tagToRemove: string) => {
    const newTags = existingTags.filter(t => t !== tagToRemove);
    try {
      await updateDocumentTags(docId, newTags);
      loadDocuments();
      loadTags();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to update tags', 'error');
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getFileIcon = (name: string) => {
    const ext = name.split('.').pop()?.toLowerCase() || '';
    if (ext === 'pdf') return '\uD83D\uDCC4';
    if (['doc', 'docx'].includes(ext)) return '\uD83D\uDDD2\uFE0F';
    if (['xls', 'xlsx', 'csv'].includes(ext)) return '\uD83D\uDCCA';
    return '\uD83D\uDCC4';
  };

  return (
    <div style={styles.container} className="doc-manager">
      <div style={styles.sidebar} className="doc-sidebar">
        <h3 style={styles.sidebarTitle}>Collections</h3>
        <button
          onClick={() => setSelectedCollection('')}
          style={selectedCollection === '' ? styles.colButtonActive : styles.colButton}
        >
          All Documents
        </button>
        {collections.map(col => (
          <div key={col.id} style={styles.colRow}>
            <button
              onClick={() => setSelectedCollection(col.id)}
              style={selectedCollection === col.id ? styles.colButtonActive : styles.colButton}
            >
              {col.name}
            </button>
            {isAdmin && (
              <button onClick={() => handleDeleteCollection(col.id)} style={styles.deleteColButton}>x</button>
            )}
          </div>
        ))}
        {isAdmin && !showNewCol && (
          <button onClick={() => setShowNewCol(true)} style={styles.addColButton}>+ New Collection</button>
        )}
        {isAdmin && showNewCol && (
          <div style={styles.newColForm}>
            <input
              placeholder="Name"
              value={newColName}
              onChange={e => setNewColName(e.target.value)}
              style={styles.smallInput}
            />
            <input
              placeholder="Description"
              value={newColDesc}
              onChange={e => setNewColDesc(e.target.value)}
              style={styles.smallInput}
            />
            <div style={{ display: 'flex', gap: '4px' }}>
              <button onClick={handleCreateCollection} style={styles.smallButton}>Create</button>
              <button onClick={() => setShowNewCol(false)} style={styles.smallButtonGhost}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      <div style={styles.main} className="doc-main">
        <div style={styles.toolbar}>
          <div>
            <h2 style={styles.title}>Documents</h2>
            <p style={styles.subtitle}>{documents.length} document{documents.length !== 1 ? 's' : ''} uploaded</p>
          </div>
          {isAdmin && (
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              {selectedIds.size > 0 && (
                <button
                  onClick={handleBulkDelete}
                  disabled={bulkDeleting}
                  style={styles.bulkDeleteButton}
                  aria-label={`Delete ${selectedIds.size} selected documents`}
                >
                  {bulkDeleting ? 'Deleting...' : `Delete ${selectedIds.size} Selected`}
                </button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.docx,.doc,.xlsx,.xls,.csv,.txt,.md"
                onChange={handleUpload}
                style={{ display: 'none' }}
                aria-label="Select files to upload"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                style={styles.uploadButton}
                aria-label="Upload new documents"
              >
                {uploading ? uploadProgress : 'Upload Documents'}
              </button>
            </div>
          )}
        </div>

        {error && <div style={styles.error}>{error}</div>}

        {/* Upload progress queue */}
        {uploadQueue.length > 0 && (
          <div style={styles.uploadQueue}>
            {uploadQueue.map((item, i) => (
              <div key={i} style={styles.uploadQueueItem}>
                <span style={{
                  ...styles.uploadStatusDot,
                  backgroundColor: item.status === 'done' ? '#16a34a' :
                    item.status === 'error' ? '#dc2626' :
                    item.status === 'uploading' ? '#1B6FC9' : '#5F7A8F',
                }} />
                <span style={styles.uploadFileName}>{item.name}</span>
                <span style={styles.uploadStatus}>
                  {item.status === 'pending' ? 'Waiting...' :
                   item.status === 'uploading' ? 'Processing...' :
                   item.status === 'done' ? 'Complete' :
                   `Error: ${item.error}`}
                </span>
              </div>
            ))}
          </div>
        )}

        <div style={styles.tableWrapper}>
          <table style={styles.table} aria-label="Uploaded documents">
            <thead>
              <tr>
                {isAdmin && (
                  <th style={{ ...styles.th, width: '40px', textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={sortedDocuments.length > 0 && sortedDocuments.every(d => selectedIds.has(d.id))}
                      ref={(el) => {
                        if (el) {
                          // Indeterminate when some (but not all) are selected
                          el.indeterminate = selectedIds.size > 0 && !sortedDocuments.every(d => selectedIds.has(d.id));
                        }
                      }}
                      onChange={toggleSelectAll}
                      title={
                        sortedDocuments.every(d => selectedIds.has(d.id))
                          ? `All ${sortedDocuments.length} selected — click to deselect`
                          : pagedDocuments.every(d => selectedIds.has(d.id))
                            ? `Page selected — click to select all ${sortedDocuments.length}`
                            : `Select ${pagedDocuments.length} on this page`
                      }
                      aria-label="Select all documents"
                    />
                  </th>
                )}
                <th style={{ ...styles.th, cursor: 'pointer' }} onClick={() => handleSort('name')}>Name{sortIndicator('name')}</th>
                <th style={{ ...styles.th, cursor: 'pointer' }} onClick={() => handleSort('status')}>Status{sortIndicator('status')}</th>
                <th style={{ ...styles.th, cursor: 'pointer' }} onClick={() => handleSort('size')}>Size{sortIndicator('size')}</th>
                <th style={{ ...styles.th, cursor: 'pointer' }} onClick={() => handleSort('chunks')}>Chunks{sortIndicator('chunks')}</th>
                <th style={styles.th}>Tags</th>
                <th style={{ ...styles.th, cursor: 'pointer' }} onClick={() => handleSort('uploaded')}>Uploaded{sortIndicator('uploaded')}</th>
                <th style={{ ...styles.th, cursor: 'pointer' }} onClick={() => handleSort('uploadedBy')}>By{sortIndicator('uploadedBy')}</th>
                {isAdmin && <th style={styles.th}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {pagedDocuments.map(doc => (
                <tr key={doc.id} style={styles.tr}>
                  {isAdmin && (
                    <td style={{ ...styles.td, textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(doc.id)}
                        onChange={() => toggleSelectDoc(doc.id)}
                        aria-label={`Select ${doc.originalName}`}
                      />
                    </td>
                  )}
                  <td style={styles.td}>
                    <span style={styles.fileIcon}>{getFileIcon(doc.originalName)}</span>
                    {doc.originalName}
                  </td>
                  <td style={styles.td}>
                    <span style={{
                      ...styles.statusBadge,
                      backgroundColor: doc.status === 'ready' ? '#dcfce7' :
                        doc.status === 'processing' ? '#dbeafe' :
                        doc.status === 'error' ? '#fef2f2' : '#f3f4f6',
                      color: doc.status === 'ready' ? '#166534' :
                        doc.status === 'processing' ? '#1e40af' :
                        doc.status === 'error' ? '#b91c1c' : '#6b7280',
                    }}>
                      {doc.status}
                    </span>
                  </td>
                  <td style={{ ...styles.td, color: '#5F7A8F' }}>{formatSize(doc.sizeBytes)}</td>
                  <td style={styles.td}>
                    <span style={styles.chunkBadge}>{doc.chunkCount}</span>
                  </td>
                  <td style={styles.td}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center' }}>
                      {(doc.tags || []).map(tag => (
                        <span key={tag} style={styles.tagChip}>
                          {tag}
                          {isAdmin && (
                            <button
                              onClick={() => handleRemoveTag(doc.id, doc.tags || [], tag)}
                              style={styles.tagRemove}
                            >x</button>
                          )}
                        </span>
                      ))}
                      {isAdmin && editingTagsDocId === doc.id ? (
                        <div style={{ display: 'flex', gap: '2px' }}>
                          <input
                            value={tagInput}
                            onChange={e => setTagInput(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') { e.preventDefault(); handleAddTag(doc.id, doc.tags || []); }
                              if (e.key === 'Escape') setEditingTagsDocId(null);
                            }}
                            placeholder="tag"
                            style={{ ...styles.smallInput, padding: '2px 6px', fontSize: '11px', width: '70px' }}
                            list="tag-suggestions"
                            autoFocus
                          />
                          <datalist id="tag-suggestions">
                            {allTags.filter(t => !(doc.tags || []).includes(t)).map(t => (
                              <option key={t} value={t} />
                            ))}
                          </datalist>
                        </div>
                      ) : isAdmin ? (
                        <button
                          onClick={() => { setEditingTagsDocId(doc.id); setTagInput(''); }}
                          style={styles.addTagButton}
                        >+</button>
                      ) : null}
                    </div>
                  </td>
                  <td style={{ ...styles.td, color: '#5F7A8F' }}>{new Date(doc.uploadedAt).toLocaleDateString()}</td>
                  <td style={{ ...styles.td, color: '#5F7A8F' }}>{doc.uploadedBy}</td>
                  {isAdmin && (
                    <td style={styles.td}>
                      <button onClick={() => handleDelete(doc)} style={styles.deleteButton} aria-label={`Delete ${doc.originalName}`}>Delete</button>
                    </td>
                  )}
                </tr>
              ))}
              {documentsLoading && documents.length === 0 && (
                <tr>
                  <td colSpan={isAdmin ? 9 : 7} style={{ padding: '12px' }}>
                    <LoadingSkeleton rows={5} widths={[100, 95, 90, 85, 92]} />
                  </td>
                </tr>
              )}
              {!documentsLoading && documents.length === 0 && (
                <tr>
                  <td colSpan={isAdmin ? 9 : 7} style={{ ...styles.td, textAlign: 'center', color: '#5F7A8F', padding: '40px 12px' }}>
                    No documents uploaded yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination controls */}
        {documents.length > 0 && (
          <div style={styles.pagination}>
            <div style={styles.pageInfo}>
              Showing {(page - 1) * pageSize + 1}\u2013{Math.min(page * pageSize, sortedDocuments.length)} of {sortedDocuments.length}
            </div>
            <div style={styles.pageControls}>
              <label style={styles.pageSizeLabel}>
                Per page:
                <select
                  value={pageSize}
                  onChange={e => setPageSize(Number(e.target.value))}
                  style={styles.pageSizeSelect}
                >
                  {PAGE_SIZE_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
              <button onClick={() => setPage(1)} disabled={page <= 1} style={styles.pageButton} aria-label="First page">&laquo;</button>
              <button onClick={() => setPage(p => p - 1)} disabled={page <= 1} style={styles.pageButton} aria-label="Previous page">&lsaquo;</button>
              <span style={styles.pageNum}>Page {page} of {totalPages}</span>
              <button onClick={() => setPage(p => p + 1)} disabled={page >= totalPages} style={styles.pageButton} aria-label="Next page">&rsaquo;</button>
              <button onClick={() => setPage(totalPages)} disabled={page >= totalPages} style={styles.pageButton} aria-label="Last page">&raquo;</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { display: 'flex', height: '100%', background: 'var(--ums-bg-surface)' },
  sidebar: { width: '260px', borderRight: '1px solid var(--ums-border)', padding: '20px', overflowY: 'auto', background: 'var(--ums-bg-surface-alt)', flexShrink: 0 },
  sidebarTitle: { margin: '0 0 14px', fontSize: '13px', fontWeight: 600, color: 'var(--ums-text-muted)', textTransform: 'uppercase' as const, letterSpacing: '0.5px' },
  colRow: { display: 'flex', alignItems: 'center', gap: '4px' },
  colButton: { flex: 1, textAlign: 'left' as const, padding: '9px 14px', border: 'none', background: 'none', cursor: 'pointer', borderRadius: '8px', fontSize: '14px', color: 'var(--ums-text-muted)', transition: 'all 0.15s' },
  colButtonActive: { flex: 1, textAlign: 'left' as const, padding: '9px 14px', border: 'none', background: 'var(--ums-brand-light)', cursor: 'pointer', borderRadius: '8px', fontSize: '14px', fontWeight: 600, color: '#0D47A1' },
  deleteColButton: { background: 'none', border: 'none', color: '#B0C4D8', cursor: 'pointer', fontSize: '14px', borderRadius: '4px', padding: '4px 8px' },
  addColButton: { padding: '9px 14px', border: '1px dashed #d1d5db', background: 'none', cursor: 'pointer', borderRadius: '8px', fontSize: '13px', color: 'var(--ums-brand-primary)', marginTop: '8px', width: '100%', fontWeight: 500 },
  newColForm: { marginTop: '8px', display: 'flex', flexDirection: 'column' as const, gap: '6px' },
  smallInput: { padding: '8px 10px', border: '1px solid var(--ums-border)', borderRadius: '8px', fontSize: '13px', background: 'var(--ums-bg-surface)' },
  smallButton: { padding: '7px 14px', background: 'var(--ums-brand-gradient)', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 500 },
  smallButtonGhost: { padding: '7px 14px', background: 'none', border: '1px solid var(--ums-border)', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', color: 'var(--ums-text-muted)' },
  main: { flex: 1, padding: '24px', overflowY: 'auto', minWidth: 0 },
  toolbar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', flexWrap: 'wrap' as const, gap: '12px' },
  title: { margin: 0, fontSize: '20px', fontWeight: 700, color: 'var(--ums-text-primary)', letterSpacing: '-0.3px' },
  subtitle: { margin: '2px 0 0', fontSize: '13px', color: 'var(--ums-text-muted)' },
  uploadButton: { padding: '10px 22px', background: 'var(--ums-brand-gradient)', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontSize: '14px', fontWeight: 500, boxShadow: '0 2px 8px rgba(27, 111, 201, 0.25)' },
  bulkDeleteButton: { padding: '10px 18px', background: '#dc2626', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontSize: '13px', fontWeight: 500, boxShadow: '0 2px 6px rgba(220, 38, 38, 0.25)' },
  error: { background: '#fef2f2', color: '#dc2626', padding: '12px 14px', borderRadius: '10px', marginBottom: '16px', fontSize: '13px', border: '1px solid #fecaca' },
  tableWrapper: { borderRadius: '12px', border: '1px solid var(--ums-border)', overflow: 'auto', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' },
  table: { width: '100%', borderCollapse: 'collapse' as const, minWidth: '700px' },
  th: { textAlign: 'left' as const, padding: '12px 16px', background: 'var(--ums-bg-surface-alt)', fontSize: '12px', color: 'var(--ums-text-muted)', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.5px', borderBottom: '1px solid var(--ums-border)', whiteSpace: 'nowrap' as const, userSelect: 'none' as const },
  td: { padding: '12px 16px', borderBottom: '1px solid var(--ums-border-light)', fontSize: '14px', color: 'var(--ums-text-secondary)' },
  tr: { transition: 'background 0.1s' },
  fileIcon: { marginRight: '8px', fontSize: '15px' },
  chunkBadge: { background: 'var(--ums-border-light)', color: 'var(--ums-brand-primary)', padding: '2px 8px', borderRadius: '6px', fontSize: '12px', fontWeight: 600 },
  deleteButton: { padding: '5px 12px', background: 'none', border: '1px solid #fecaca', color: '#dc2626', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 500 },
  statusBadge: { display: 'inline-block', padding: '2px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 600, textTransform: 'capitalize' as const },
  uploadQueue: { marginBottom: '16px', padding: '14px', background: 'var(--ums-bg-surface-alt)', borderRadius: '12px', border: '1px solid var(--ums-border)' },
  uploadQueueItem: { display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 0', fontSize: '13px' },
  uploadStatusDot: { width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0 },
  uploadFileName: { flex: 1, color: 'var(--ums-text-secondary)', fontWeight: 500 },
  uploadStatus: { color: 'var(--ums-text-muted)', fontSize: '12px' },
  tagChip: { display: 'inline-flex', alignItems: 'center', gap: '3px', padding: '2px 8px', background: 'var(--ums-brand-light)', color: 'var(--ums-brand-primary)', borderRadius: '4px', fontSize: '11px', fontWeight: 500 },
  tagRemove: { background: 'none', border: 'none', color: '#90CAF9', cursor: 'pointer', fontSize: '10px', padding: '0 2px', lineHeight: 1 },
  addTagButton: { background: 'none', border: '1px dashed var(--ums-border)', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', color: 'var(--ums-brand-primary)', padding: '2px 6px', lineHeight: 1 },
  pagination: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px', padding: '0 4px', flexWrap: 'wrap' as const, gap: '8px' },
  pageInfo: { fontSize: '13px', color: 'var(--ums-text-muted)' },
  pageControls: { display: 'flex', alignItems: 'center', gap: '4px' },
  pageButton: { padding: '6px 10px', background: 'var(--ums-bg-surface-alt)', border: '1px solid var(--ums-border)', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', color: 'var(--ums-text-muted)', fontWeight: 500, minWidth: '32px', textAlign: 'center' as const },
  pageNum: { fontSize: '13px', color: 'var(--ums-text-muted)', padding: '0 8px', fontWeight: 500 },
  pageSizeLabel: { fontSize: '13px', color: 'var(--ums-text-muted)', display: 'flex', alignItems: 'center', gap: '6px' },
  pageSizeSelect: { padding: '4px 8px', border: '1px solid var(--ums-border)', borderRadius: '6px', fontSize: '13px', background: 'var(--ums-bg-surface)', color: 'var(--ums-text-muted)' },
};
