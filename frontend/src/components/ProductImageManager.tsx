/**
 * ProductImageManager — Admin panel for uploading and managing product images.
 * Images are stored in S3 and served via /api/products/images/.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  PhotoIcon,
  TrashIcon,
  ArrowUpTrayIcon,
  ClipboardDocumentIcon,
} from '@heroicons/react/24/outline';
import { Button } from '@/components/ui/button';
import {
  ProductImage,
  listProductImages,
  uploadProductImage,
  deleteProductImage,
} from '../services/api';
import { useConfirm } from './ConfirmDialog';

function formatSize(bytes?: number) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function ProductImageManager() {
  const { confirm } = useConfirm();
  const [images, setImages] = useState<ProductImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
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

  useEffect(() => {
    loadImages();
  }, [loadImages]);

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
      setMessage({
        type: 'success',
        text: `${uploaded} image${uploaded !== 1 ? 's' : ''} uploaded`,
      });
    }
    await loadImages();
  };

  const handleDelete = async (img: ProductImage) => {
    const ok = await confirm({
      title: 'Delete image',
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

  return (
    <div className="rounded-sm border border-border bg-card p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[14px] font-semibold text-foreground">
            Product images
          </h3>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            {images.length} image{images.length !== 1 ? 's' : ''} in library
          </p>
        </div>
        <div className="flex gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => handleUpload(e.target.files)}
            className="hidden"
            id="product-image-upload"
          />
          <label htmlFor="product-image-upload">
            <Button asChild size="sm">
              <span className="cursor-pointer">
                <ArrowUpTrayIcon className="h-4 w-4" />
                {uploading ? 'Uploading…' : 'Upload images'}
              </span>
            </Button>
          </label>
        </div>
      </div>

      {message && (
        <Banner
          tone={message.type === 'success' ? 'sage' : 'warm-red'}
          onDismiss={() => setMessage(null)}
        >
          {message.text}
        </Banner>
      )}

      {loading ? (
        <p className="text-[13px] text-muted-foreground">Loading images…</p>
      ) : images.length === 0 ? (
        <div className="rounded-sm border border-border bg-background px-5 py-10 text-center">
          <PhotoIcon className="mx-auto mb-3 h-12 w-12 text-muted-foreground opacity-60" />
          <p className="text-[14px] font-semibold text-foreground">
            No product images yet
          </p>
          <p className="mx-auto mt-1 max-w-[400px] text-[12px] text-muted-foreground">
            Upload product photos, brochures, and equipment images for use in
            recommendations and RAG responses.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
          {images.map((img) => (
            <div
              key={img.filename}
              className="overflow-hidden rounded-sm border border-border bg-background transition-shadow hover:shadow-md"
            >
              <div className="flex h-[140px] w-full items-center justify-center border-b border-border bg-muted">
                <img
                  src={img.url}
                  alt={img.filename}
                  className="max-h-[140px] max-w-full object-contain"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = '';
                    (e.target as HTMLImageElement).alt = 'Failed to load';
                  }}
                />
              </div>
              <div className="px-3 py-2.5">
                <div
                  className="truncate text-[12px] font-semibold text-foreground"
                  title={img.filename}
                >
                  {img.filename}
                </div>
                <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                  {formatSize(img.size)}
                </div>
                <div className="mt-2 flex gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleCopyUrl(img)}
                    title="Copy image path"
                    className="h-7 px-2 text-[11px]"
                  >
                    <ClipboardDocumentIcon className="h-3.5 w-3.5" />
                    {copiedFilename === img.filename ? 'Copied!' : 'Copy path'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleDelete(img)}
                    title="Delete image"
                    className="h-7 px-2 text-[11px]"
                    style={{
                      borderColor: 'var(--warm-red)',
                      color: 'var(--warm-red)',
                      background: 'var(--warm-red-soft)',
                    }}
                  >
                    <TrashIcon className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Banner({
  tone,
  children,
  onDismiss,
}: {
  tone: 'sage' | 'warm-red';
  children: React.ReactNode;
  onDismiss: () => void;
}) {
  const bg = tone === 'sage' ? 'var(--sage-soft)' : 'var(--warm-red-soft)';
  const fg = tone === 'sage' ? 'var(--sage)' : 'var(--warm-red)';
  return (
    <div
      className="mb-3 flex items-center justify-between rounded-sm border px-3 py-2 text-[13px]"
      style={{ background: bg, borderColor: fg, color: fg }}
    >
      <span>{children}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="bg-transparent text-[16px] leading-none"
        style={{ color: 'inherit' }}
      >
        ×
      </button>
    </div>
  );
}
