import { useState, useEffect, useRef } from 'react';
import { Document, Collection } from '../types';
import {
  listDocuments,
  uploadDocument,
  deleteDocument,
  createCollection,
  deleteCollection,
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
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadDocuments = async () => {
    try {
      const result = await listDocuments(selectedCollection || undefined);
      setDocuments(result.documents);
    } catch (err) {
      setError('Failed to load documents');
    }
  };

  useEffect(() => {
    loadDocuments();
  }, [selectedCollection]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    setError('');

    for (const file of Array.from(files)) {
      try {
        setUploadProgress(`Uploading ${file.name}...`);
        await uploadDocument(file, selectedCollection || 'default');
      } catch (err) {
        setError(`Failed to upload ${file.name}: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }

    setUploading(false);
    setUploadProgress('');
    if (fileInputRef.current) fileInputRef.current.value = '';
    loadDocuments();
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

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
          <h2 style={styles.title}>Documents</h2>
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

        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Name</th>
              <th style={styles.th}>Size</th>
              <th style={styles.th}>Chunks</th>
              <th style={styles.th}>Uploaded</th>
              <th style={styles.th}>By</th>
              {isAdmin && <th style={styles.th}>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {documents.map(doc => (
              <tr key={doc.id}>
                <td style={styles.td}>{doc.originalName}</td>
                <td style={styles.td}>{formatSize(doc.sizeBytes)}</td>
                <td style={styles.td}>{doc.chunkCount}</td>
                <td style={styles.td}>{new Date(doc.uploadedAt).toLocaleDateString()}</td>
                <td style={styles.td}>{doc.uploadedBy}</td>
                {isAdmin && (
                  <td style={styles.td}>
                    <button onClick={() => handleDelete(doc)} style={styles.deleteButton}>Delete</button>
                  </td>
                )}
              </tr>
            ))}
            {documents.length === 0 && (
              <tr>
                <td colSpan={isAdmin ? 6 : 5} style={{ ...styles.td, textAlign: 'center', color: '#999' }}>
                  No documents uploaded yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { display: 'flex', height: '100%' },
  sidebar: { width: '240px', borderRight: '1px solid #eee', padding: '16px', overflowY: 'auto' },
  sidebarTitle: { margin: '0 0 12px', fontSize: '16px' },
  colRow: { display: 'flex', alignItems: 'center', gap: '4px' },
  colButton: { flex: 1, textAlign: 'left' as const, padding: '8px 12px', border: 'none', background: 'none', cursor: 'pointer', borderRadius: '4px', fontSize: '14px' },
  colButtonActive: { flex: 1, textAlign: 'left' as const, padding: '8px 12px', border: 'none', background: '#e8f4f8', cursor: 'pointer', borderRadius: '4px', fontSize: '14px', fontWeight: 600 },
  deleteColButton: { background: 'none', border: 'none', color: '#999', cursor: 'pointer', fontSize: '14px' },
  addColButton: { padding: '8px 12px', border: '1px dashed #ccc', background: 'none', cursor: 'pointer', borderRadius: '4px', fontSize: '13px', color: '#666', marginTop: '8px', width: '100%' },
  newColForm: { marginTop: '8px', display: 'flex', flexDirection: 'column' as const, gap: '6px' },
  smallInput: { padding: '6px 8px', border: '1px solid #ddd', borderRadius: '4px', fontSize: '13px' },
  smallButton: { padding: '6px 12px', background: '#1a1a2e', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '13px' },
  smallButtonGhost: { padding: '6px 12px', background: 'none', border: '1px solid #ddd', borderRadius: '4px', cursor: 'pointer', fontSize: '13px' },
  main: { flex: 1, padding: '16px', overflowY: 'auto' },
  toolbar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' },
  title: { margin: 0, fontSize: '20px' },
  uploadButton: { padding: '10px 20px', backgroundColor: '#1a1a2e', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '14px' },
  error: { background: '#fef2f2', color: '#e74c3c', padding: '10px', borderRadius: '6px', marginBottom: '12px', fontSize: '14px' },
  table: { width: '100%', borderCollapse: 'collapse' as const },
  th: { textAlign: 'left' as const, padding: '10px 12px', borderBottom: '2px solid #eee', fontSize: '13px', color: '#666' },
  td: { padding: '10px 12px', borderBottom: '1px solid #eee', fontSize: '14px' },
  deleteButton: { padding: '4px 10px', background: 'none', border: '1px solid #e74c3c', color: '#e74c3c', borderRadius: '4px', cursor: 'pointer', fontSize: '13px' },
};
