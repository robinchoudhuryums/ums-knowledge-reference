/**
 * ProductImageManager — Admin panel for uploading and managing product images.
 * Images are stored in S3 and served via /api/products/images/.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { ProductImage, listProductImages, uploadProductImage, deleteProductImage } from '../services/api';
import { useConfirm } from './ConfirmDialog';
import {
  PhotoIcon,
  TrashIcon,
  ArrowUpTrayIcon,
  ClipboardDocumentIcon,
} from '@heroicons/react/24/outline';

export function ProductImageManager() {
  const { confirm } = useConfirm();
  const [images, setImages] = useState<ProductImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [copiedFilename, setCopiedFilename] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadImages = useCallback(async () => {
    try {
      setLoading(true);
      const result = await listProductImages();
      setImages(result.images);
    } catch {
      setMessage({ type: 'error', text: 'Failed to load images' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadImages(); }, [loadImages]);

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    setMessage(null);
    let uploaded = 0;
    let failed = 0;

    for (const file of Array.from(files)) {
      try {
        await uploadProductImage(file);
        uploaded++;
      } catch {
        failed++;
      }
    }

    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';

    if (failed > 0) {
      setMessage({ type: 'error', text: `${uploaded} uploaded, ${failed} failed` });
    } else {
      setMessage({ type: 'success', text: `${uploaded} image${uploaded !== 1 ? 's' : ''} uploaded` });
    }
    await loadImages();
  };

  const handleDelete = async (img: ProductImage) => {
    const ok = await confirm({
      title: 'Delete Image',
      message: `Delete "${img.filename}"? Products referencing this image will show a broken image.`,
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await deleteProductImage(img.filename);
      setMessage({ type: 'success', text: `"${img.filename}" deleted` });
      await loadImages();
    } catch {
      setMessage({ type: 'error', text: 'Failed to delete image' });
    }
  };

  const handleCopyUrl = (img: ProductImage) => {
    navigator.clipboard.writeText(img.url).catch(() => {});
    setCopiedFilename(img.filename);
    setTimeout(() => setCopiedFilename(null), 2000);
  };

  const formatSize = (bytes?: number) => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div>
          <h3 style={styles.title}>Product Images</h3>
          <p style={styles.subtitle}>{images.length} image{images.length !== 1 ? 's' : ''} in library</p>
        </div>
        <div style={styles.uploadArea}>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={e => handleUpload(e.target.files)}
            style={{ display: 'none' }}
            id="product-image-upload"
          />
          <label htmlFor="product-image-upload" style={styles.uploadButton}>
            <ArrowUpTrayIcon className="w-4 h-4" />
            {uploading ? 'Uploading...' : 'Upload Images'}
          </label>
        </div>
      </div>

      {message && (
        <div style={message.type === 'success' ? styles.successBanner : styles.errorBanner}>
          {message.text}
          <button onClick={() => setMessage(null)} style={styles.dismissButton}>×</button>
        </div>
      )}

      {loading ? (
        <p style={styles.meta}>Loading images...</p>
      ) : images.length === 0 ? (
        <div style={styles.emptyState}>
          <PhotoIcon className="w-12 h-12" style={{ color: 'var(--ums-text-placeholder)', marginBottom: '12px' }} />
          <p style={styles.emptyTitle}>No product images yet</p>
          <p style={styles.emptyText}>Upload product photos, brochures, and equipment images for use in recommendations and RAG responses.</p>
        </div>
      ) : (
        <div style={styles.grid}>
          {images.map(img => (
            <div key={img.filename} style={styles.card}>
              <div style={styles.imageWrap}>
                <img
                  src={img.url}
                  alt={img.filename}
                  style={styles.image}
                  onError={e => { (e.target as HTMLImageElement).src = ''; (e.target as HTMLImageElement).alt = 'Failed to load'; }}
                />
              </div>
              <div style={styles.cardBody}>
                <div style={styles.filename} title={img.filename}>
                  {img.filename}
                </div>
                <div style={styles.fileSize}>{formatSize(img.size)}</div>
                <div style={styles.cardActions}>
                  <button
                    onClick={() => handleCopyUrl(img)}
                    style={styles.smallBtn}
                    title="Copy image path"
                  >
                    <ClipboardDocumentIcon className="w-3.5 h-3.5" />
                    {copiedFilename === img.filename ? 'Copied!' : 'Copy Path'}
                  </button>
                  <button
                    onClick={() => handleDelete(img)}
                    style={styles.smallBtnDanger}
                    title="Delete image"
                  >
                    <TrashIcon className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    background: 'var(--ums-bg-surface)', borderRadius: '12px',
    border: '1px solid var(--ums-border)', padding: '20px 24px',
    boxShadow: 'var(--ums-shadow-sm)',
  },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px', flexWrap: 'wrap' as const, gap: '12px' },
  title: { margin: '0 0 2px', fontSize: '16px', fontWeight: 700, color: 'var(--ums-text-primary)' },
  subtitle: { margin: 0, fontSize: '13px', color: 'var(--ums-text-muted)' },
  uploadArea: { display: 'flex', gap: '8px' },
  uploadButton: {
    display: 'flex', alignItems: 'center', gap: '6px',
    padding: '7px 14px', background: 'var(--ums-brand-gradient)', color: '#fff',
    border: 'none', borderRadius: '8px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
  },
  meta: { fontSize: '13px', color: 'var(--ums-text-muted)' },
  successBanner: {
    padding: '8px 14px', background: 'var(--ums-success-light)', color: 'var(--ums-success-text)',
    borderRadius: '8px', border: '1px solid var(--ums-success-border)', fontSize: '13px',
    marginBottom: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  },
  errorBanner: {
    padding: '8px 14px', background: 'var(--ums-error-light)', color: 'var(--ums-error-text)',
    borderRadius: '8px', border: '1px solid var(--ums-error-border)', fontSize: '13px', marginBottom: '12px',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
  },
  dismissButton: { background: 'none', border: 'none', fontSize: '16px', cursor: 'pointer', color: 'inherit', padding: '0 4px' },
  emptyState: {
    textAlign: 'center' as const, padding: '40px 20px',
    background: 'var(--ums-bg-surface-alt)', borderRadius: '10px', border: '1px solid var(--ums-border)',
  },
  emptyTitle: { fontSize: '15px', fontWeight: 600, color: 'var(--ums-text-primary)', margin: '0 0 4px' },
  emptyText: { fontSize: '13px', color: 'var(--ums-text-muted)', margin: 0, maxWidth: '400px', marginLeft: 'auto', marginRight: 'auto' },
  grid: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
    gap: '12px',
  },
  card: {
    borderRadius: '10px', border: '1px solid var(--ums-border)',
    overflow: 'hidden', background: 'var(--ums-bg-surface-alt)',
    transition: 'box-shadow 0.2s',
  },
  imageWrap: {
    width: '100%', height: '140px', display: 'flex', alignItems: 'center',
    justifyContent: 'center', background: 'var(--ums-bg-surface)',
    borderBottom: '1px solid var(--ums-border)',
  },
  image: { maxWidth: '100%', maxHeight: '140px', objectFit: 'contain' as const },
  cardBody: { padding: '10px 12px' },
  filename: {
    fontSize: '12px', fontWeight: 600, color: 'var(--ums-text-primary)',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const,
  },
  fileSize: { fontSize: '11px', color: 'var(--ums-text-muted)', marginTop: '2px' },
  cardActions: { display: 'flex', gap: '4px', marginTop: '8px' },
  smallBtn: {
    display: 'flex', alignItems: 'center', gap: '3px',
    padding: '3px 8px', fontSize: '11px', fontWeight: 500,
    background: 'var(--ums-bg-surface)', border: '1px solid var(--ums-border)',
    borderRadius: '5px', cursor: 'pointer', color: 'var(--ums-text-muted)',
  },
  smallBtnDanger: {
    display: 'flex', alignItems: 'center', gap: '3px',
    padding: '3px 6px', fontSize: '11px',
    background: 'var(--ums-error-light)', border: '1px solid var(--ums-error-border)',
    borderRadius: '5px', cursor: 'pointer', color: 'var(--ums-error-text)',
  },
};
