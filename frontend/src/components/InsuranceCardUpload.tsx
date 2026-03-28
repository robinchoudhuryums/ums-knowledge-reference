/**
 * InsuranceCardUpload — Drag-and-drop image upload for insurance cards.
 * Supports click, drag-and-drop, and clipboard paste (Ctrl+V).
 * Sends to backend OCR endpoint and returns extracted fields.
 */

import { useState, useRef, useCallback, useEffect } from 'react';

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
  return document.cookie.match(/(^|;\s*)csrf_token=([^;]*)/)?.[2] || '';
}

export function InsuranceCardUpload({ onFieldsExtracted, enteredInsurance, enteredMemberId, enteredName, enteredDob, lang }: InsuranceCardUploadProps) {
  const [images, setImages] = useState<string[]>([]);
  const [processing, setProcessing] = useState(false);
  const [result, setResult] = useState<{ fields: ExtractedFields; mismatches: Mismatch[] } | null>(null);
  const [error, setError] = useState('');
  const [statusMsg, setStatusMsg] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const showStatus = (msg: string) => {
    setStatusMsg(msg);
    setTimeout(() => setStatusMsg(''), 2500);
  };

  const addImage = useCallback((dataUrl: string) => {
    setImages(prev => [...prev, dataUrl]);
    showStatus(lang === 'en' ? 'Image attached!' : 'Imagen adjuntada!');
  }, [lang]);

  const removeImage = (idx: number) => {
    setImages(prev => prev.filter((_, i) => i !== idx));
  };

  const processFile = (file: File) => {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (e) => { if (e.target?.result) addImage(e.target.result as string); };
    reader.readAsDataURL(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
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
  }, []);

  // Global paste listener — must use useEffect (not useState) so the cleanup
  // runs on unmount and the listener is properly re-attached if handlePaste changes.
  useEffect(() => {
    document.addEventListener('paste', handlePaste as EventListener);
    return () => document.removeEventListener('paste', handlePaste as EventListener);
  }, [handlePaste]);

  const handleOcr = async () => {
    if (images.length === 0) return;
    setProcessing(true); setError(''); setResult(null);

    try {
      // Convert first image data URL to a File/Blob for upload
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

  return (
    <div style={sty.container}>
      {/* Drop zone */}
      <div
        style={{ ...sty.dropZone, ...(dragOver ? sty.dropZoneDragOver : {}) }}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        tabIndex={0}
      >
        {statusMsg ? (
          <span style={sty.statusSuccess}>{statusMsg}</span>
        ) : (
          <span style={sty.dropText}>
            {lang === 'en'
              ? <>📸 <strong style={sty.uploadTrigger}>Click to Upload</strong>, Drag & Drop, or Paste (Ctrl+V)</>
              : <>📸 <strong style={sty.uploadTrigger}>Clic para Subir</strong>, Arrastrar, o Pegar (Ctrl+V)</>}
          </span>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => {
            const files = e.target.files;
            if (files) for (let i = 0; i < files.length; i++) processFile(files[i]);
            e.target.value = '';
          }}
        />
      </div>

      {/* Thumbnail gallery */}
      {images.length > 0 && (
        <div style={sty.gallery}>
          {images.map((img, idx) => (
            <div key={idx} style={sty.thumbWrapper}>
              <img src={img} alt={`Card ${idx + 1}`} style={sty.thumbImg} />
              <div style={sty.thumbRemove} onClick={(e) => { e.stopPropagation(); removeImage(idx); }}>&times;</div>
            </div>
          ))}
        </div>
      )}

      {/* OCR button */}
      {images.length > 0 && (
        <button
          type="button"
          style={processing ? sty.ocrBtnDisabled : sty.ocrBtn}
          disabled={processing}
          onClick={handleOcr}
        >
          {processing
            ? (lang === 'en' ? 'Reading card...' : 'Leyendo tarjeta...')
            : (lang === 'en' ? 'Read Insurance Card' : 'Leer Tarjeta de Seguro')}
        </button>
      )}

      {error && <div style={sty.error}>{error}</div>}

      {/* Results */}
      {result && (
        <div style={sty.resultContainer}>
          <h4 style={sty.resultTitle}>{lang === 'en' ? 'Extracted from Card' : 'Extraído de la Tarjeta'}</h4>
          <div style={sty.fieldGrid}>
            {result.fields.insuranceName && <FieldBadge label={lang === 'en' ? 'Insurance' : 'Seguro'} value={result.fields.insuranceName} />}
            {result.fields.memberId && <FieldBadge label={lang === 'en' ? 'Member ID' : 'ID de Miembro'} value={result.fields.memberId} />}
            {result.fields.groupNumber && <FieldBadge label={lang === 'en' ? 'Group #' : 'Grupo #'} value={result.fields.groupNumber} />}
            {result.fields.planType && <FieldBadge label={lang === 'en' ? 'Plan' : 'Plan'} value={result.fields.planType} />}
            {result.fields.subscriberName && <FieldBadge label={lang === 'en' ? 'Name on Card' : 'Nombre en Tarjeta'} value={result.fields.subscriberName} />}
            {result.fields.subscriberDob && <FieldBadge label="DOB" value={result.fields.subscriberDob} />}
            {result.fields.effectiveDate && <FieldBadge label={lang === 'en' ? 'Effective' : 'Vigente'} value={result.fields.effectiveDate} />}
            {result.fields.phoneNumber && <FieldBadge label={lang === 'en' ? 'Phone' : 'Teléfono'} value={result.fields.phoneNumber} />}
          </div>

          {/* Mismatch warnings */}
          {result.mismatches.length > 0 && (
            <div style={sty.mismatchContainer}>
              <h4 style={sty.mismatchTitle}>
                {lang === 'en' ? 'Mismatches Found' : 'Discrepancias Encontradas'}
              </h4>
              {result.mismatches.map((m, i) => (
                <div key={i} style={sty.mismatchRow}>
                  <strong>{m.field}:</strong>{' '}
                  <span style={sty.mismatchExtracted}>{lang === 'en' ? 'Card says' : 'Tarjeta dice'}: &quot;{m.extracted}&quot;</span>{' '}
                  <span style={sty.mismatchEntered}>{lang === 'en' ? 'You entered' : 'Usted ingresó'}: &quot;{m.entered}&quot;</span>
                </div>
              ))}
            </div>
          )}

          {result.mismatches.length === 0 && (enteredInsurance || enteredMemberId) && (
            <div style={sty.matchSuccess}>
              {lang === 'en' ? 'All entered fields match the card.' : 'Todos los campos ingresados coinciden con la tarjeta.'}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FieldBadge({ label, value }: { label: string; value: string }) {
  return (
    <div style={sty.fieldBadge}>
      <span style={sty.fieldLabel}>{label}</span>
      <span style={sty.fieldValue}>{value}</span>
    </div>
  );
}

const sty = {
  container: { marginBottom: 16 } as React.CSSProperties,
  dropZone: { border: '2px dashed var(--ums-border)', borderRadius: 8, padding: '14px 16px', textAlign: 'center' as const, cursor: 'pointer', background: 'var(--ums-bg-surface-alt)', transition: 'all 0.2s', outline: 'none' } as React.CSSProperties,
  dropZoneDragOver: { borderColor: '#28a745', background: '#e3fcef' } as React.CSSProperties,
  dropText: { fontSize: 13, color: 'var(--ums-text-muted)' } as React.CSSProperties,
  uploadTrigger: { color: 'var(--ums-brand-primary)', cursor: 'pointer', textDecoration: 'underline' as const } as React.CSSProperties,
  statusSuccess: { color: '#28a745', fontWeight: 700, fontSize: 13 } as React.CSSProperties,
  gallery: { display: 'flex', gap: 10, marginTop: 10, overflowX: 'auto' as const, padding: 2 } as React.CSSProperties,
  thumbWrapper: { position: 'relative' as const, width: 60, height: 60, border: '1px solid var(--ums-border)', borderRadius: 6, background: 'var(--ums-bg-surface)', flexShrink: 0 } as React.CSSProperties,
  thumbImg: { width: '100%', height: '100%', objectFit: 'cover' as const, borderRadius: 5 } as React.CSSProperties,
  thumbRemove: { position: 'absolute' as const, top: -6, right: -6, background: '#dc3545', color: '#fff', borderRadius: '50%', width: 18, height: 18, textAlign: 'center' as const, lineHeight: '16px', fontSize: 12, cursor: 'pointer', border: '1px solid #fff', fontWeight: 700 } as React.CSSProperties,
  ocrBtn: { marginTop: 10, background: '#2e7d32', color: '#fff', border: 'none', padding: '8px 20px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'pointer' } as React.CSSProperties,
  ocrBtnDisabled: { marginTop: 10, background: '#a5d6a7', color: '#fff', border: 'none', padding: '8px 20px', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: 'not-allowed' } as React.CSSProperties,
  error: { background: '#f8d7da', color: '#721c24', padding: '8px 12px', borderRadius: 6, marginTop: 8, fontSize: 13 } as React.CSSProperties,
  resultContainer: { marginTop: 12, border: '1px solid #c3e6cb', borderRadius: 8, padding: 14, background: '#f8fff9' } as React.CSSProperties,
  resultTitle: { margin: '0 0 10px', fontSize: 14, fontWeight: 700, color: '#155724' } as React.CSSProperties,
  fieldGrid: { display: 'flex', flexWrap: 'wrap' as const, gap: 8 } as React.CSSProperties,
  fieldBadge: { background: '#e8f5e9', border: '1px solid #c8e6c9', borderRadius: 6, padding: '4px 10px', fontSize: 12 } as React.CSSProperties,
  fieldLabel: { fontWeight: 700, color: '#2e7d32', marginRight: 4 } as React.CSSProperties,
  fieldValue: { color: 'var(--ums-text-primary)' } as React.CSSProperties,
  mismatchContainer: { marginTop: 12, border: '1px solid #f5c6cb', borderRadius: 8, padding: 12, background: '#fff5f5' } as React.CSSProperties,
  mismatchTitle: { margin: '0 0 8px', fontSize: 14, fontWeight: 700, color: '#721c24' } as React.CSSProperties,
  mismatchRow: { fontSize: 13, marginBottom: 6, lineHeight: 1.5 } as React.CSSProperties,
  mismatchExtracted: { color: '#2e7d32', fontWeight: 500 } as React.CSSProperties,
  mismatchEntered: { color: '#c62828', fontWeight: 500 } as React.CSSProperties,
  matchSuccess: { marginTop: 10, background: '#d4edda', color: '#155724', padding: '8px 12px', borderRadius: 6, fontSize: 13, fontWeight: 600 } as React.CSSProperties,
};
