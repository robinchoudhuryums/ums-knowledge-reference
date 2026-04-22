/**
 * InsuranceCardUpload — Drag-and-drop image upload for insurance cards.
 * Supports click, drag-and-drop, and clipboard paste (Ctrl+V).
 * Sends to backend OCR endpoint and returns extracted fields.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { CameraIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { getCsrfToken } from '../services/api';
import { cn } from '@/lib/utils';

interface ExtractedFields {
  insuranceName: string | null;
  memberId: string | null;
  groupNumber: string | null;
  planType: string | null;
  subscriberName: string | null;
  subscriberDob: string | null;
  effectiveDate: string | null;
  copay: string | null;
  phoneNumber: string | null;
}

interface Mismatch {
  field: string;
  extracted: string;
  entered: string;
}

interface InsuranceCardUploadProps {
  /** Called with extracted fields for auto-fill */
  onFieldsExtracted: (fields: ExtractedFields) => void;
  /** Currently entered values for comparison */
  enteredInsurance?: string;
  enteredMemberId?: string;
  enteredName?: string;
  enteredDob?: string;
  lang: 'en' | 'es';
}

function getCsrf(): string {
  return getCsrfToken() || '';
}

export function InsuranceCardUpload({
  onFieldsExtracted,
  enteredInsurance,
  enteredMemberId,
  enteredName,
  enteredDob,
  lang,
}: InsuranceCardUploadProps) {
  const [images, setImages] = useState<string[]>([]);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<{ fields: ExtractedFields; mismatches: Mismatch[] } | null>(
    null,
  );
  const [error, setError] = useState('');
  const [statusMsg, setStatusMsg] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const showStatus = (msg: string) => {
    setStatusMsg(msg);
    setTimeout(() => setStatusMsg(''), 2500);
  };

  const addImage = useCallback(
    (dataUrl: string) => {
      setImages((prev) => [...prev, dataUrl]);
      showStatus(lang === 'en' ? 'Image attached!' : 'Imagen adjuntada!');
    },
    [lang],
  );

  const removeImage = (idx: number) => {
    setImages((prev) => prev.filter((_, i) => i !== idx));
  };

  const processFile = (file: File) => {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      if (e.target?.result) addImage(e.target.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = e.dataTransfer.files;
    for (let i = 0; i < files.length; i++) processFile(files[i]);
  };

  const handlePaste = useCallback((e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        const blob = items[i].getAsFile();
        if (blob) processFile(blob);
        e.preventDefault();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Global paste listener — must use useEffect (not useState) so the cleanup
  // runs on unmount and the listener is properly re-attached if handlePaste changes.
  useEffect(() => {
    document.addEventListener('paste', handlePaste as EventListener);
    return () => document.removeEventListener('paste', handlePaste as EventListener);
  }, [handlePaste]);

  const handleOcr = async () => {
    if (images.length === 0) return;
    setProcessing(true);
    setError('');
    setResult(null);

    try {
      const dataUrl = images[0];
      const resp = await fetch(dataUrl);
      const blob = await resp.blob();

      const formData = new FormData();
      formData.append('file', blob, 'insurance-card.jpg');
      if (enteredInsurance) formData.append('enteredInsurance', enteredInsurance);
      if (enteredMemberId) formData.append('enteredMemberId', enteredMemberId);
      if (enteredName) formData.append('enteredName', enteredName);
      if (enteredDob) formData.append('enteredDob', enteredDob);

      const csrf = getCsrf();
      const res = await fetch('/api/account-creation/read-insurance-card', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'x-csrf-token': csrf },
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(data.error || `Failed (${res.status})`);
      }

      const data = await res.json();
      setResult({ fields: data.extracted, mismatches: data.mismatches || [] });
      onFieldsExtracted(data.extracted);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'OCR failed');
    } finally {
      setProcessing(false);
    }
  };

  const hasMismatches = result && result.mismatches.length > 0;
  const hasMatches = result && result.mismatches.length === 0 && (enteredInsurance || enteredMemberId);

  return (
    <div className="mb-4">
      {/* Drop zone */}
      <div
        role="button"
        tabIndex={0}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            fileInputRef.current?.click();
          }
        }}
        className={cn(
          'flex cursor-pointer items-center justify-center rounded-sm border-2 border-dashed border-border bg-muted px-4 py-3.5 text-center transition-colors',
          dragOver && 'border-[var(--sage)] bg-[var(--sage-soft)]',
        )}
      >
        {statusMsg ? (
          <span className="font-semibold" style={{ color: 'var(--sage)' }}>
            {statusMsg}
          </span>
        ) : (
          <span className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <CameraIcon className="h-4 w-4" />
            {lang === 'en' ? (
              <>
                <strong className="cursor-pointer underline" style={{ color: 'var(--accent)' }}>
                  Click to upload
                </strong>
                , drag & drop, or paste (Ctrl+V)
              </>
            ) : (
              <>
                <strong className="cursor-pointer underline" style={{ color: 'var(--accent)' }}>
                  Clic para subir
                </strong>
                , arrastrar, o pegar (Ctrl+V)
              </>
            )}
          </span>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = e.target.files;
            if (files) for (let i = 0; i < files.length; i++) processFile(files[i]);
            e.target.value = '';
          }}
        />
      </div>

      {/* Thumbnail gallery */}
      {images.length > 0 && (
        <div className="mt-2.5 flex gap-2.5 overflow-x-auto p-0.5">
          {images.map((img, idx) => (
            <div
              key={idx}
              className="relative h-[60px] w-[60px] shrink-0 overflow-hidden rounded-sm border border-border bg-card"
            >
              <img
                src={img}
                alt={`Card ${idx + 1}`}
                className="h-full w-full rounded-[3px] object-cover"
              />
              <button
                type="button"
                aria-label={`Remove image ${idx + 1}`}
                onClick={(e) => {
                  e.stopPropagation();
                  removeImage(idx);
                }}
                className="absolute -right-1.5 -top-1.5 flex h-[18px] w-[18px] items-center justify-center rounded-full border font-bold text-white"
                style={{ background: 'var(--warm-red)', borderColor: 'var(--card)', fontSize: 10 }}
              >
                <XMarkIcon className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* OCR button */}
      {images.length > 0 && (
        <button
          type="button"
          disabled={processing}
          onClick={handleOcr}
          className="mt-2.5 rounded-sm px-5 py-2 text-[13px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
          style={{ background: processing ? 'var(--muted-foreground)' : 'var(--sage)' }}
        >
          {processing
            ? lang === 'en'
              ? 'Reading card…'
              : 'Leyendo tarjeta…'
            : lang === 'en'
              ? 'Read insurance card'
              : 'Leer tarjeta de seguro'}
        </button>
      )}

      {error && (
        <div
          role="alert"
          className="mt-2 rounded-sm border px-3 py-2 text-[13px]"
          style={{
            background: 'var(--warm-red-soft)',
            borderColor: 'var(--warm-red)',
            color: 'var(--warm-red)',
          }}
        >
          {error}
        </div>
      )}

      {/* Results */}
      {result && (
        <div
          className="mt-3 rounded-sm border p-3.5"
          style={{ background: 'var(--sage-soft)', borderColor: 'var(--sage)' }}
        >
          <h4
            className="mb-2.5 font-semibold"
            style={{ fontSize: 14, color: 'var(--sage)' }}
          >
            {lang === 'en' ? 'Extracted from card' : 'Extraído de la tarjeta'}
          </h4>
          <div className="flex flex-wrap gap-2">
            {result.fields.insuranceName && (
              <FieldBadge label={lang === 'en' ? 'Insurance' : 'Seguro'} value={result.fields.insuranceName} />
            )}
            {result.fields.memberId && (
              <FieldBadge label={lang === 'en' ? 'Member ID' : 'ID de miembro'} value={result.fields.memberId} />
            )}
            {result.fields.groupNumber && (
              <FieldBadge label={lang === 'en' ? 'Group #' : 'Grupo #'} value={result.fields.groupNumber} />
            )}
            {result.fields.planType && (
              <FieldBadge label="Plan" value={result.fields.planType} />
            )}
            {result.fields.subscriberName && (
              <FieldBadge
                label={lang === 'en' ? 'Name on card' : 'Nombre en tarjeta'}
                value={result.fields.subscriberName}
              />
            )}
            {result.fields.subscriberDob && <FieldBadge label="DOB" value={result.fields.subscriberDob} />}
            {result.fields.effectiveDate && (
              <FieldBadge label={lang === 'en' ? 'Effective' : 'Vigente'} value={result.fields.effectiveDate} />
            )}
            {result.fields.phoneNumber && (
              <FieldBadge label={lang === 'en' ? 'Phone' : 'Teléfono'} value={result.fields.phoneNumber} />
            )}
          </div>

          {hasMismatches && (
            <div
              className="mt-3 rounded-sm border p-3"
              style={{ background: 'var(--warm-red-soft)', borderColor: 'var(--warm-red)' }}
            >
              <h4
                className="mb-2 font-semibold"
                style={{ fontSize: 14, color: 'var(--warm-red)' }}
              >
                {lang === 'en' ? 'Mismatches found' : 'Discrepancias encontradas'}
              </h4>
              {result.mismatches.map((m, i) => (
                <div key={i} className="mb-1.5 text-[13px] leading-snug">
                  <strong>{m.field}:</strong>{' '}
                  <span className="font-medium" style={{ color: 'var(--sage)' }}>
                    {lang === 'en' ? 'Card says' : 'Tarjeta dice'}: &quot;{m.extracted}&quot;
                  </span>{' '}
                  <span className="font-medium" style={{ color: 'var(--warm-red)' }}>
                    {lang === 'en' ? 'You entered' : 'Usted ingresó'}: &quot;{m.entered}&quot;
                  </span>
                </div>
              ))}
            </div>
          )}

          {hasMatches && (
            <div
              className="mt-2.5 rounded-sm border px-3 py-2 text-[13px] font-semibold"
              style={{
                background: 'var(--sage-soft)',
                borderColor: 'var(--sage)',
                color: 'var(--sage)',
              }}
            >
              {lang === 'en'
                ? 'All entered fields match the card.'
                : 'Todos los campos ingresados coinciden con la tarjeta.'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FieldBadge({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="inline-flex items-center gap-1 rounded-sm border px-2.5 py-1 text-[12px]"
      style={{ background: 'var(--card)', borderColor: 'var(--sage)' }}
    >
      <span className="font-semibold" style={{ color: 'var(--sage)' }}>
        {label}
      </span>
      <span className="text-foreground">{value}</span>
    </div>
  );
}
