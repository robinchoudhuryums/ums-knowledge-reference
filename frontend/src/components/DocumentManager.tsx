import { useState, useEffect, useRef } from 'react';
import { Document, Collection } from '../types';
import {
  listDocuments,
  uploadDocument,
  deleteDocument,
  createCollection,
  deleteCollection,
  updateDocumentTags,
  listAllTags,
} from '../services/api';

interface Props {
  isAdmin: boolean;
  collections: Collection[];
  onCollectionsChange: () => void;
}

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
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadDocuments = async () => {
    try {
      const result = await listDocuments(selectedCollection || undefined);
      setDocuments(result.documents);
    } catch (err) {
      setError('Failed to load documents');
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

  const [uploadQueue, setUploadQueue] = useState<Array<{ name: string; status: 'pending' | 'uploading' | 'done' | 'error'; error?: string }>>([]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const fileList = Array.from(files);
    setUploading(true);
    setError('');

    // Initialize upload queue
    const queue = fileList.map(f => ({ name: f.name, status: 'pending' as const }));
    setUploadQueue(queue);

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
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Unknown error';
        setUploadQueue(prev => prev.map((item, idx) =>
          idx === i ? { ...item, status: 'error', error: errMsg } : item
        ));
        setError(`Failed to upload ${file.name}: ${errMsg}`);
      }
    }

    setUploading(false);
    setUploadProgress('');
    if (fileInputRef.current) fileInputRef.current.value = '';
    loadDocuments();

    // Clear queue after 5s
    setTimeout(() => setUploadQueue([]), 5000);
  };

  const handleDelete = async (doc: Document) => {
    if (!confirm(`Delete "${doc.originalName}"? This cannot be undone.`)) return;
    try {
      await deleteDocument(doc.id);
      loadDocuments();
    } catch (err) {
      setError('Failed to delete document');
    }
  };

  const handleCreateCollection = async () => {
    if (!newColName.trim()) return;
    try {
      await createCollection(newColName.trim(), newColDesc.trim());
      setNewColName('');
      setNewColDesc('');
      setShowNewCol(false);
      onCollectionsChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create collection');
    }
  };

  const handleDeleteCollection = async (id: string) => {
    if (!confirm('Delete this collection? All documents must be removed first.')) return;
    try {
      await deleteCollection(id);
      if (selectedCollection === id) setSelectedCollection('');
      onCollectionsChange();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete collection');
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
      setError(err instanceof Error ? err.message : 'Failed to update tags');
    }
  };

  const handleRemoveTag = async (docId: string, existingTags: string[], tagToRemove: string) => {
    const newTags = existingTags.filter(t => t !== tagToRemove);
    try {
      await updateDocumentTags(docId, newTags);
      loadDocuments();
      loadTags();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update tags');
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
    <div style={styles.container}>
      <div style={styles.sidebar}>
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

      <div style={styles.main}>
        <div style={styles.toolbar}>
          <div>
            <h2 style={styles.title}>Documents</h2>
            <p style={styles.subtitle}>{documents.length} document{documents.length !== 1 ? 's' : ''} uploaded</p>
          </div>
          {isAdmin && (
            <div>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.docx,.doc,.xlsx,.xls,.csv,.txt,.md"
                onChange={handleUpload}
                style={{ display: 'none' }}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                style={styles.uploadButton}
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
                    item.status === 'uploading' ? '#1B6FC9' : '#8DA4B8',
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
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Name</th>
                <th style={styles.th}>Status</th>
                <th style={styles.th}>Size</th>
                <th style={styles.th}>Chunks</th>
                <th style={styles.th}>Tags</th>
                <th style={styles.th}>Uploaded</th>
                <th style={styles.th}>By</th>
                {isAdmin && <th style={styles.th}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {documents.map(doc => (
                <tr key={doc.id} style={styles.tr}>
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
                  <td style={{ ...styles.td, color: '#6B8299' }}>{formatSize(doc.sizeBytes)}</td>
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
                  <td style={{ ...styles.td, color: '#6B8299' }}>{new Date(doc.uploadedAt).toLocaleDateString()}</td>
                  <td style={{ ...styles.td, color: '#6B8299' }}>{doc.uploadedBy}</td>
                  {isAdmin && (
                    <td style={styles.td}>
                      <button onClick={() => handleDelete(doc)} style={styles.deleteButton}>Delete</button>
                    </td>
                  )}
                </tr>
              ))}
              {documents.length === 0 && (
                <tr>
                  <td colSpan={isAdmin ? 8 : 7} style={{ ...styles.td, textAlign: 'center', color: '#8DA4B8', padding: '40px 12px' }}>
                    No documents uploaded yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { display: 'flex', height: '100%', background: '#ffffff' },
  sidebar: { width: '260px', borderRight: '1px solid #E8EFF5', padding: '20px', overflowY: 'auto', background: '#F0F7FF' },
  sidebarTitle: { margin: '0 0 14px', fontSize: '13px', fontWeight: 600, color: '#8DA4B8', textTransform: 'uppercase' as const, letterSpacing: '0.5px' },
  colRow: { display: 'flex', alignItems: 'center', gap: '4px' },
  colButton: { flex: 1, textAlign: 'left' as const, padding: '9px 14px', border: 'none', background: 'none', cursor: 'pointer', borderRadius: '8px', fontSize: '14px', color: '#4A6274', transition: 'all 0.15s' },
  colButtonActive: { flex: 1, textAlign: 'left' as const, padding: '9px 14px', border: 'none', background: 'linear-gradient(135deg, #E3F2FD, #BBDEFB)', cursor: 'pointer', borderRadius: '8px', fontSize: '14px', fontWeight: 600, color: '#0D47A1' },
  deleteColButton: { background: 'none', border: 'none', color: '#B0C4D8', cursor: 'pointer', fontSize: '14px', borderRadius: '4px', padding: '4px 8px' },
  addColButton: { padding: '9px 14px', border: '1px dashed #d1d5db', background: 'none', cursor: 'pointer', borderRadius: '8px', fontSize: '13px', color: '#1B6FC9', marginTop: '8px', width: '100%', fontWeight: 500 },
  newColForm: { marginTop: '8px', display: 'flex', flexDirection: 'column' as const, gap: '6px' },
  smallInput: { padding: '8px 10px', border: '1px solid #D6E4F0', borderRadius: '8px', fontSize: '13px', background: '#ffffff' },
  smallButton: { padding: '7px 14px', background: 'linear-gradient(135deg, #1B6FC9, #1565C0)', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 500 },
  smallButtonGhost: { padding: '7px 14px', background: 'none', border: '1px solid #D6E4F0', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', color: '#6B8299' },
  main: { flex: 1, padding: '24px', overflowY: 'auto' },
  toolbar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' },
  title: { margin: 0, fontSize: '20px', fontWeight: 700, color: '#0D2137', letterSpacing: '-0.3px' },
  subtitle: { margin: '2px 0 0', fontSize: '13px', color: '#8DA4B8' },
  uploadButton: { padding: '10px 22px', background: 'linear-gradient(135deg, #1B6FC9, #1565C0)', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontSize: '14px', fontWeight: 500, boxShadow: '0 2px 8px rgba(27, 111, 201, 0.25)' },
  error: { background: '#fef2f2', color: '#dc2626', padding: '12px 14px', borderRadius: '10px', marginBottom: '16px', fontSize: '13px', border: '1px solid #fecaca' },
  tableWrapper: { borderRadius: '12px', border: '1px solid #E8EFF5', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' },
  table: { width: '100%', borderCollapse: 'collapse' as const },
  th: { textAlign: 'left' as const, padding: '12px 16px', background: '#F7FAFD', fontSize: '12px', color: '#6B8299', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.5px', borderBottom: '1px solid #E8EFF5' },
  td: { padding: '12px 16px', borderBottom: '1px solid #F7FAFD', fontSize: '14px', color: '#1A2B3C' },
  tr: { transition: 'background 0.1s' },
  fileIcon: { marginRight: '8px', fontSize: '15px' },
  chunkBadge: { background: '#E8EFF5', color: '#1B6FC9', padding: '2px 8px', borderRadius: '6px', fontSize: '12px', fontWeight: 600 },
  deleteButton: { padding: '5px 12px', background: 'none', border: '1px solid #fecaca', color: '#dc2626', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 500 },
  statusBadge: { display: 'inline-block', padding: '2px 8px', borderRadius: '6px', fontSize: '11px', fontWeight: 600, textTransform: 'capitalize' as const },
  uploadQueue: { marginBottom: '16px', padding: '14px', background: '#F7FAFD', borderRadius: '12px', border: '1px solid #E8EFF5' },
  uploadQueueItem: { display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 0', fontSize: '13px' },
  uploadStatusDot: { width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0 },
  uploadFileName: { flex: 1, color: '#1A2B3C', fontWeight: 500 },
  uploadStatus: { color: '#6B8299', fontSize: '12px' },
  tagChip: { display: 'inline-flex', alignItems: 'center', gap: '3px', padding: '2px 8px', background: '#E3F2FD', color: '#1565C0', borderRadius: '4px', fontSize: '11px', fontWeight: 500 },
  tagRemove: { background: 'none', border: 'none', color: '#90CAF9', cursor: 'pointer', fontSize: '10px', padding: '0 2px', lineHeight: 1 },
  addTagButton: { background: 'none', border: '1px dashed #D6E4F0', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', color: '#1B6FC9', padding: '2px 6px', lineHeight: 1 },
};
