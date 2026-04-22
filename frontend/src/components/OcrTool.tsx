import { useState, useRef, type ChangeEvent } from 'react';
import {
  DocumentMagnifyingGlassIcon,
  ClipboardDocumentCheckIcon,
  DocumentDuplicateIcon,
  ArrowUpTrayIcon,
} from '@heroicons/react/24/outline';
import {
  ocrDocument,
  type OcrResponse,
  reviewForm,
  reviewFormBatch,
  downloadAnnotatedPdf,
  downloadOriginalPdf,
  type FormReviewResult,
  type BatchFormReviewResult,
} from '../services/api';
import { cn } from '@/lib/utils';
import { OcrToolResultView } from './OcrToolResultView';
import { OcrToolFormResultView } from './OcrToolFormResultView';
import { OcrToolBatchResultView } from './OcrToolBatchResultView';

type Mode = 'ocr' | 'form-review' | 'batch-review';

const MODE_META: Record<
  Mode,
  { label: string; title: string; description: string; Icon: React.ComponentType<{ className?: string }> }
> = {
  ocr: {
    label: 'OCR text',
    title: 'OCR — scan document',
    description:
      'Upload a scanned PDF or image to extract text using AWS Textract. Supports multi-page PDF, PNG, JPEG, and TIFF.',
    Icon: DocumentMagnifyingGlassIcon,
  },
  'form-review': {
    label: 'Form review',
    title: 'Form review — detect missing fields',
    description:
      'Upload a DME form to detect blank fields. Auto-detects CMN form types and highlights required fields. Cached results skip Textract charges.',
    Icon: ClipboardDocumentCheckIcon,
  },
  'batch-review': {
    label: 'Batch review',
    title: 'Batch form review — multiple files',
    description:
      'Upload up to 10 forms at once for completeness checking. Get a summary table showing which forms need attention.',
    Icon: DocumentDuplicateIcon,
  },
};

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

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function OcrTool() {
  const [mode, setMode] = useState<Mode>('ocr');
  const [loading, setLoading] = useState(false);
  const [ocrResult, setOcrResult] = useState<OcrResponse | null>(null);
  const [formResult, setFormResult] = useState<FormReviewResult | null>(null);
  const [batchResult, setBatchResult] = useState<BatchFormReviewResult | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState<'annotated' | 'original' | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [showInteractiveViewer, setShowInteractiveViewer] = useState(false);
  const [expandedBatchIndex, setExpandedBatchIndex] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const batchFileRef = useRef<HTMLInputElement>(null);

  const resetState = () => {
    setOcrResult(null);
    setFormResult(null);
    setBatchResult(null);
    setSelectedFile(null);
    setSelectedFiles([]);
    setError('');
    setCopied(false);
    setDownloading(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setShowPreview(false);
    setShowInteractiveViewer(false);
    setExpandedBatchIndex(null);
    if (fileRef.current) fileRef.current.value = '';
    if (batchFileRef.current) batchFileRef.current.value = '';
  };

  const handleModeSwitch = (newMode: Mode) => {
    if (newMode === mode) return;
    resetState();
    setMode(newMode);
  };

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setError('');
    setOcrResult(null);
    setFormResult(null);
    setCopied(false);
    setSelectedFile(file);

    try {
      if (mode === 'ocr') {
        const result = await ocrDocument(file);
        setOcrResult(result);
      } else {
        const result = await reviewForm(file);
        setFormResult(result);
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : `${mode === 'ocr' ? 'OCR extraction' : 'Form review'} failed`,
      );
    } finally {
      setLoading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleBatchFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    // Cap at 10 files per server-side batch limit.
    const fileArray = Array.from(files).slice(0, 10);
    setLoading(true);
    setError('');
    setBatchResult(null);
    setSelectedFiles(fileArray);

    try {
      const result = await reviewFormBatch(fileArray);
      setBatchResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Batch form review failed');
    } finally {
      setLoading(false);
      if (batchFileRef.current) batchFileRef.current.value = '';
    }
  };

  const handleCopy = () => {
    if (ocrResult?.text) {
      navigator.clipboard.writeText(ocrResult.text).catch(() => {});
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownloadAnnotated = async () => {
    if (!selectedFile) return;
    setDownloading('annotated');
    try {
      const blob = await downloadAnnotatedPdf(selectedFile);
      triggerDownload(blob, `REVIEW-${selectedFile.name}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to download annotated PDF');
    } finally {
      setDownloading(null);
    }
  };

  const handleDownloadOriginal = async () => {
    if (!selectedFile) return;
    setDownloading('original');
    try {
      const blob = await downloadOriginalPdf(selectedFile);
      triggerDownload(blob, selectedFile.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to download original PDF');
    } finally {
      setDownloading(null);
    }
  };

  const handlePreviewAnnotated = async () => {
    if (!selectedFile) return;
    setDownloading('annotated');
    try {
      const blob = await downloadAnnotatedPdf(selectedFile);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      const url = URL.createObjectURL(blob);
      setPreviewUrl(url);
      setShowPreview(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load preview');
    } finally {
      setDownloading(null);
    }
  };

  const meta = MODE_META[mode];
  const HeaderIcon = meta.Icon;

  const uploadLabel =
    loading && mode === 'batch-review'
      ? `Analyzing ${selectedFiles.length} form${selectedFiles.length !== 1 ? 's' : ''}…`
      : loading && mode === 'form-review'
        ? 'Analyzing form fields…'
        : loading && mode === 'ocr'
          ? 'Scanning document…'
          : mode === 'batch-review'
            ? 'Select files (up to 10)'
            : 'Select file';

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-6 sm:px-7">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div
          aria-hidden="true"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-sm"
          style={{ background: 'var(--copper-soft)', color: 'var(--accent)' }}
        >
          <HeaderIcon className="h-5 w-5" />
        </div>
        <div>
          <SectionKicker>Tools</SectionKicker>
          <h3
            className="mt-1 font-display font-medium text-foreground"
            style={{ fontSize: 22, lineHeight: 1.15, letterSpacing: '-0.4px' }}
          >
            {meta.title}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">{meta.description}</p>
        </div>
      </div>

      {/* Mode toggle — mono segmented control */}
      <div className="inline-flex rounded-sm border border-border bg-card p-0.5">
        {(Object.keys(MODE_META) as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => handleModeSwitch(m)}
            aria-pressed={mode === m}
            className={cn(
              'rounded-sm px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider transition-colors',
              mode === m
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {MODE_META[m].label}
          </button>
        ))}
      </div>

      {/* Upload */}
      <div>
        <label>
          <input
            ref={mode === 'batch-review' ? batchFileRef : fileRef}
            type="file"
            accept=".pdf,.png,.jpg,.jpeg,.tiff,.tif"
            onChange={mode === 'batch-review' ? handleBatchFileChange : handleFileChange}
            className="hidden"
            disabled={loading}
            multiple={mode === 'batch-review'}
          />
          <span className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-card px-4 py-2.5 text-[13px] text-foreground hover:bg-muted">
            <ArrowUpTrayIcon className="h-4 w-4" />
            {uploadLabel}
          </span>
        </label>

        {loading && (
          <>
            <div
              className="mt-3 h-1 w-full overflow-hidden rounded-full"
              style={{ background: 'var(--muted)' }}
            >
              <div
                className="h-full animate-pulse"
                style={{ width: '45%', background: 'var(--accent)' }}
              />
            </div>
            {mode !== 'ocr' && (
              <p className="mt-2 text-[12px] text-muted-foreground">
                Textract is analyzing the form structure to detect fields and checkboxes.
                This may take 15-60 seconds for multi-page PDFs.
                {mode === 'batch-review' && ' Cached forms will be skipped (no extra charge).'}
              </p>
            )}
          </>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-sm border px-3 py-2 text-[13px]"
          style={{
            background: 'var(--warm-red-soft)',
            borderColor: 'var(--warm-red)',
            color: 'var(--warm-red)',
          }}
        >
          {error}
        </div>
      )}

      {/* Result dispatch */}
      {ocrResult && mode === 'ocr' && (
        <OcrToolResultView result={ocrResult} copied={copied} onCopy={handleCopy} />
      )}

      {formResult && mode === 'form-review' && (
        <OcrToolFormResultView
          result={formResult}
          selectedFile={selectedFile}
          downloading={downloading}
          previewUrl={previewUrl}
          showPreview={showPreview}
          showInteractiveViewer={showInteractiveViewer}
          onDownloadAnnotated={handleDownloadAnnotated}
          onDownloadOriginal={handleDownloadOriginal}
          onPreviewAnnotated={handlePreviewAnnotated}
          onClosePreview={() => setShowPreview(false)}
          onOpenInteractive={() => setShowInteractiveViewer(true)}
          onCloseInteractive={() => setShowInteractiveViewer(false)}
          onReset={resetState}
        />
      )}

      {batchResult && mode === 'batch-review' && (
        <OcrToolBatchResultView
          result={batchResult}
          expandedIndex={expandedBatchIndex}
          onToggleExpand={(i) =>
            setExpandedBatchIndex(expandedBatchIndex === i ? null : i)
          }
          onReset={resetState}
        />
      )}
    </div>
  );
}
