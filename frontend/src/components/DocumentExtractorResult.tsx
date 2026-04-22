import {
  ClipboardDocumentIcon,
  CheckIcon,
  ArrowDownTrayIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline';
import type {
  ExtractionResult,
  ExtractionTemplateDetail,
  ExtractionTemplateField,
} from '../services/api';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  DocumentExtractorFieldRenderer,
  type FieldValue,
} from './DocumentExtractorFieldRenderer';
import { ExtractionCorrectionPanel } from './ExtractionCorrectionPanel';

interface Props {
  result: ExtractionResult;
  templateDetail: ExtractionTemplateDetail;
  editedData: Record<string, FieldValue>;
  selectedFile: File | null;
  copied: boolean;
  onFieldChange: (key: string, value: FieldValue) => void;
  onCopyJson: () => void;
  onExportJson: () => void;
  onExportCsv: () => void;
  onReset: () => void;
}

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

/**
 * Confidence tone uses the --conf-* aliases (sage/amber/warm-red) so
 * the pill colors flow through the palette picker. Medium maps to
 * amber, high to sage, low to warm-red.
 */
function ConfidenceBadge({ level }: { level: 'high' | 'medium' | 'low' }) {
  const alias = level === 'medium' ? 'partial' : level;
  return (
    <span
      className="inline-flex items-center rounded-sm border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider"
      style={{
        background: `var(--conf-${alias}-bg)`,
        borderColor: `var(--conf-${alias}-border)`,
        color: `var(--conf-${alias})`,
      }}
    >
      {level} confidence
    </span>
  );
}

export function DocumentExtractorResult({
  result,
  templateDetail,
  editedData,
  selectedFile,
  copied,
  onFieldChange,
  onCopyJson,
  onExportJson,
  onExportCsv,
  onReset,
}: Props) {
  // Group fields by group name so related fields render together.
  const groupedFields = templateDetail.fields.reduce<Record<string, ExtractionTemplateField[]>>(
    (acc, field) => {
      const group = field.group || 'Other';
      if (!acc[group]) acc[group] = [];
      acc[group].push(field);
      return acc;
    },
    {},
  );

  const modelShort = result.modelUsed.split(':')[0].split('.').pop();

  return (
    <div className="rounded-sm border border-border bg-card">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <SectionKicker>Extraction result</SectionKicker>
          <h4
            className="mt-1 font-display font-medium text-foreground"
            style={{ fontSize: 18, lineHeight: 1.15, letterSpacing: '-0.2px' }}
          >
            {result.templateName}
          </h4>
          <p className="mt-1 truncate text-[12px] text-muted-foreground">
            {selectedFile?.name} · Model: {modelShort}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ConfidenceBadge level={result.confidence} />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onCopyJson}
            className="gap-1.5"
          >
            {copied ? <CheckIcon className="h-3.5 w-3.5" /> : <ClipboardDocumentIcon className="h-3.5 w-3.5" />}
            {copied ? 'Copied' : 'Copy JSON'}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onExportJson}
            className="gap-1.5"
          >
            <ArrowDownTrayIcon className="h-3.5 w-3.5" />
            JSON
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onExportCsv}
            className="gap-1.5"
          >
            <ArrowDownTrayIcon className="h-3.5 w-3.5" />
            CSV
          </Button>
          <Button type="button" size="sm" onClick={onReset} className="gap-1.5">
            <ArrowPathIcon className="h-3.5 w-3.5" />
            New extraction
          </Button>
        </div>
      </div>

      {/* Extraction notes */}
      {result.extractionNotes && (
        <div
          className="border-b border-border px-5 py-3 text-[13px]"
          style={{ background: 'var(--copper-soft)', color: 'var(--foreground)' }}
        >
          <strong className="font-semibold">AI notes:</strong> {result.extractionNotes}
        </div>
      )}

      {/* Editable grouped form */}
      <div className="space-y-5 px-5 py-5">
        {Object.entries(groupedFields).map(([group, fields]) => (
          <div key={group}>
            <h5
              className="mb-3 font-mono uppercase text-muted-foreground"
              style={{ fontSize: 11, letterSpacing: '0.12em' }}
            >
              {group}
            </h5>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {fields.map((field) => (
                <div
                  key={field.key}
                  className={field.type === 'textarea' ? 'md:col-span-2' : undefined}
                >
                  <Label className="mb-1 flex items-center gap-1.5">
                    <span>{field.label}</span>
                    {field.required && (
                      <span style={{ color: 'var(--warm-red)' }}>*</span>
                    )}
                    {editedData[field.key] === null && (
                      <span
                        className="ml-auto rounded-sm border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider"
                        style={{
                          background: 'var(--muted)',
                          borderColor: 'var(--border)',
                          color: 'var(--muted-foreground)',
                        }}
                      >
                        not found
                      </span>
                    )}
                  </Label>
                  {field.description && (
                    <p className="mb-1.5 text-[11px] text-muted-foreground">
                      {field.description}
                    </p>
                  )}
                  <DocumentExtractorFieldRenderer
                    field={field}
                    value={editedData[field.key]}
                    onChange={onFieldChange}
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Human-in-the-loop correction feedback */}
      <div className="border-t border-border px-5 py-5">
        <ExtractionCorrectionPanel
          templateId={result.templateId}
          reportedConfidence={result.confidence === 'medium' ? 'medium' : result.confidence}
          filename={selectedFile?.name}
          originalData={result.data}
          editedData={editedData}
          fieldLabels={Object.fromEntries(
            templateDetail.fields.map((f) => [f.key, f.label]),
          )}
        />
      </div>
    </div>
  );
}
