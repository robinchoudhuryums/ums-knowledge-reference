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

        <div style={styles.tableWrapper}>
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
                <tr key={doc.id} style={styles.tr}>
                  <td style={styles.td}>
                    <span style={styles.fileIcon}>{getFileIcon(doc.originalName)}</span>
                    {doc.originalName}
                  </td>
                  <td style={{ ...styles.td, color: '#64748b' }}>{formatSize(doc.sizeBytes)}</td>
                  <td style={styles.td}>
                    <span style={styles.chunkBadge}>{doc.chunkCount}</span>
                  </td>
                  <td style={{ ...styles.td, color: '#64748b' }}>{new Date(doc.uploadedAt).toLocaleDateString()}</td>
                  <td style={{ ...styles.td, color: '#64748b' }}>{doc.uploadedBy}</td>
                  {isAdmin && (
                    <td style={styles.td}>
                      <button onClick={() => handleDelete(doc)} style={styles.deleteButton}>Delete</button>
                    </td>
                  )}
                </tr>
              ))}
              {documents.length === 0 && (
                <tr>
                  <td colSpan={isAdmin ? 6 : 5} style={{ ...styles.td, textAlign: 'center', color: '#94a3b8', padding: '40px 12px' }}>
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
  sidebar: { width: '260px', borderRight: '1px solid #f1f5f9', padding: '20px', overflowY: 'auto', background: '#fafbfc' },
  sidebarTitle: { margin: '0 0 14px', fontSize: '13px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase' as const, letterSpacing: '0.5px' },
  colRow: { display: 'flex', alignItems: 'center', gap: '4px' },
  colButton: { flex: 1, textAlign: 'left' as const, padding: '9px 14px', border: 'none', background: 'none', cursor: 'pointer', borderRadius: '8px', fontSize: '14px', color: '#475569', transition: 'all 0.15s' },
  colButtonActive: { flex: 1, textAlign: 'left' as const, padding: '9px 14px', border: 'none', background: 'linear-gradient(135deg, #eef2ff, #e0e7ff)', cursor: 'pointer', borderRadius: '8px', fontSize: '14px', fontWeight: 600, color: '#4338ca' },
  deleteColButton: { background: 'none', border: 'none', color: '#cbd5e1', cursor: 'pointer', fontSize: '14px', borderRadius: '4px', padding: '4px 8px' },
  addColButton: { padding: '9px 14px', border: '1px dashed #d1d5db', background: 'none', cursor: 'pointer', borderRadius: '8px', fontSize: '13px', color: '#6366f1', marginTop: '8px', width: '100%', fontWeight: 500 },
  newColForm: { marginTop: '8px', display: 'flex', flexDirection: 'column' as const, gap: '6px' },
  smallInput: { padding: '8px 10px', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '13px', background: '#ffffff' },
  smallButton: { padding: '7px 14px', background: 'linear-gradient(135deg, #6366f1, #4f46e5)', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: 500 },
  smallButtonGhost: { padding: '7px 14px', background: 'none', border: '1px solid #e2e8f0', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', color: '#64748b' },
  main: { flex: 1, padding: '24px', overflowY: 'auto' },
  toolbar: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' },
  title: { margin: 0, fontSize: '20px', fontWeight: 700, color: '#0f172a', letterSpacing: '-0.3px' },
  subtitle: { margin: '2px 0 0', fontSize: '13px', color: '#94a3b8' },
  uploadButton: { padding: '10px 22px', background: 'linear-gradient(135deg, #6366f1, #4f46e5)', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontSize: '14px', fontWeight: 500, boxShadow: '0 2px 8px rgba(99, 102, 241, 0.25)' },
  error: { background: '#fef2f2', color: '#dc2626', padding: '12px 14px', borderRadius: '10px', marginBottom: '16px', fontSize: '13px', border: '1px solid #fecaca' },
  tableWrapper: { borderRadius: '12px', border: '1px solid #f1f5f9', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' },
  table: { width: '100%', borderCollapse: 'collapse' as const },
  th: { textAlign: 'left' as const, padding: '12px 16px', background: '#f8fafc', fontSize: '12px', color: '#64748b', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.5px', borderBottom: '1px solid #f1f5f9' },
  td: { padding: '12px 16px', borderBottom: '1px solid #f8fafc', fontSize: '14px', color: '#1e293b' },
  tr: { transition: 'background 0.1s' },
  fileIcon: { marginRight: '8px', fontSize: '15px' },
  chunkBadge: { background: '#f1f5f9', color: '#6366f1', padding: '2px 8px', borderRadius: '6px', fontSize: '12px', fontWeight: 600 },
  deleteButton: { padding: '5px 12px', background: 'none', border: '1px solid #fecaca', color: '#dc2626', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 500 },
};
