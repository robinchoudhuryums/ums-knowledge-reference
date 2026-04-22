import { useState, useEffect } from 'react';
import {
  listExtractionTemplates,
  getExtractionTemplate,
  extractDocument,
  type ExtractionTemplateInfo,
  type ExtractionTemplateDetail,
  type ExtractionResult,
} from '../services/api';
import { DocumentTextIcon } from '@heroicons/react/24/outline';
import { DocumentExtractorTemplateGrid } from './DocumentExtractorTemplateGrid';
import { DocumentExtractorFileUpload } from './DocumentExtractorFileUpload';
import { DocumentExtractorResult } from './DocumentExtractorResult';
import type { FieldValue } from './DocumentExtractorFieldRenderer';

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

export function DocumentExtractor() {
  const [templates, setTemplates] = useState<ExtractionTemplateInfo[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [templateDetail, setTemplateDetail] = useState<ExtractionTemplateDetail | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [result, setResult] = useState<ExtractionResult | null>(null);
  const [editedData, setEditedData] = useState<Record<string, FieldValue>>({});
  const [error, setError] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    listExtractionTemplates()
      .then((res) => setTemplates(res.templates))
      .catch(() => setError('Failed to load extraction templates'));
  }, []);

  useEffect(() => {
    if (!selectedTemplateId) {
      setTemplateDetail(null);
      return;
    }
    getExtractionTemplate(selectedTemplateId)
      .then((res) => setTemplateDetail(res.template))
      .catch(() => setError('Failed to load template details'));
  }, [selectedTemplateId]);

  const handleExtract = async () => {
    if (!selectedFile || !selectedTemplateId) return;

    setExtracting(true);
    setError('');
    setResult(null);
    setEditedData({});

    try {
      const res = await extractDocument(selectedFile, selectedTemplateId);
      setResult(res.result);
      setEditedData({ ...res.result.data });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Extraction failed');
    } finally {
      setExtracting(false);
    }
  };

  const handleFieldChange = (key: string, value: FieldValue) => {
    setEditedData((prev) => ({ ...prev, [key]: value }));
  };

  const handleCopyJson = () => {
    navigator.clipboard
      .writeText(JSON.stringify(editedData, null, 2))
      .catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleExportCsv = () => {
    if (!templateDetail) return;

    // CSV-escape per RFC 4180: wrap in quotes when the value contains
    // commas, double quotes, newlines, or carriage returns.
    const escapeCsvField = (raw: unknown): string => {
      if (raw === null || raw === undefined) return '';
      const str = String(raw);
      if (/[,"\n\r]/.test(str)) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };

    const headers = templateDetail.fields.map((f) => escapeCsvField(f.label));
    const values = templateDetail.fields.map((f) => escapeCsvField(editedData[f.key]));
    const csv = headers.join(',') + '\n' + values.join(',');
    // Prepend UTF-8 BOM so Excel on Windows reads non-ASCII chars correctly.
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    triggerDownload(blob, `extraction-${result?.templateId || 'data'}.csv`);
  };

  const handleExportJson = () => {
    const blob = new Blob([JSON.stringify(editedData, null, 2)], {
      type: 'application/json',
    });
    triggerDownload(blob, `extraction-${result?.templateId || 'data'}.json`);
  };

  const handleReset = () => {
    setResult(null);
    setEditedData({});
    setSelectedFile(null);
    setError('');
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-6 sm:px-7">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div
          aria-hidden="true"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-sm"
          style={{ background: 'var(--copper-soft)', color: 'var(--accent)' }}
        >
          <DocumentTextIcon className="h-5 w-5" />
        </div>
        <div>
          <SectionKicker>Structured extraction</SectionKicker>
          <h3
            className="mt-1 font-display font-medium text-foreground"
            style={{ fontSize: 22, lineHeight: 1.15, letterSpacing: '-0.4px' }}
          >
            Document extractor
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Upload a document and pick an extraction template. Claude Sonnet reads the
            document and fills a structured form with the extracted data.
          </p>
        </div>
      </div>

      {/* PHI notice */}
      <div
        className="rounded-sm border px-3 py-2 text-[12px] leading-relaxed"
        style={{
          background: 'var(--amber-soft)',
          borderColor: 'var(--amber)',
          color: 'var(--foreground)',
        }}
      >
        <strong className="font-semibold">HIPAA notice:</strong> If this document contains
        PHI, ensure you have proper authorization. Extracted data is processed via AWS
        Bedrock (Sonnet) and is not stored unless you explicitly save it.
      </div>

      {/* Steps — hidden once a result is shown */}
      {!result && (
        <>
          <div className="rounded-sm border border-border bg-card p-5">
            <SectionKicker>Step 1</SectionKicker>
            <h4
              className="mb-3 mt-1 font-display font-medium text-foreground"
              style={{ fontSize: 16, lineHeight: 1.2 }}
            >
              Select extraction type
            </h4>
            <DocumentExtractorTemplateGrid
              templates={templates}
              selectedTemplateId={selectedTemplateId}
              onSelect={setSelectedTemplateId}
            />
          </div>

          {selectedTemplateId && (
            <DocumentExtractorFileUpload
              selectedFile={selectedFile}
              extracting={extracting}
              templateName={templateDetail?.name}
              onFileSelect={setSelectedFile}
              onExtract={handleExtract}
            />
          )}
        </>
      )}

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

      {result && templateDetail && (
        <DocumentExtractorResult
          result={result}
          templateDetail={templateDetail}
          editedData={editedData}
          selectedFile={selectedFile}
          copied={copied}
          onFieldChange={handleFieldChange}
          onCopyJson={handleCopyJson}
          onExportJson={handleExportJson}
          onExportCsv={handleExportCsv}
          onReset={handleReset}
        />
      )}
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
