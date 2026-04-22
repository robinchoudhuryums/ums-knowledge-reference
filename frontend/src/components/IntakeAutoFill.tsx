/**
 * IntakeAutoFill — Combined panel for:
 *   1. Manual intake data entry (patient demographics, physician info, supplier info)
 *   2. AI-assisted clinical note extraction (upload physician notes → extract structured data)
 *
 * Both sources produce CMN field mappings that can be copied/exported for form pre-population.
 */

import { useState, useRef, type ChangeEvent } from 'react';
import {
  DocumentTextIcon,
  BeakerIcon,
  ClipboardDocumentIcon,
  CheckIcon,
  ArrowUpTrayIcon,
} from '@heroicons/react/24/outline';
import {
  extractClinicalNotes,
  type ClinicalExtractionResult,
  type CmnFieldMapping,
  type IntakeData,
} from '../services/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

type Tab = 'intake' | 'clinical';

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

function ConfidencePill({ level }: { level: 'high' | 'medium' | 'low' }) {
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
      {level}
    </span>
  );
}

export function IntakeAutoFill() {
  const [activeTab, setActiveTab] = useState<Tab>('intake');

  // Intake form state
  const [intake, setIntake] = useState<IntakeData>({});
  const [intakeMappings, setIntakeMappings] = useState<CmnFieldMapping[]>([]);

  // Clinical extraction state
  const [clinicalLoading, setClinicalLoading] = useState(false);
  const [clinicalResult, setClinicalResult] = useState<ClinicalExtractionResult | null>(null);
  const [clinicalError, setClinicalError] = useState('');
  const clinicalFileRef = useRef<HTMLInputElement>(null);

  const [copied, setCopied] = useState(false);

  const updateIntake = (field: keyof IntakeData, value: string) => {
    setIntake((prev) => ({ ...prev, [field]: value || undefined }));
  };

  const generateIntakeMappings = () => {
    const mappings: CmnFieldMapping[] = [];
    const add = (fieldName: string, value: string | undefined, ctx: string) => {
      if (value?.trim()) {
        mappings.push({
          fieldName,
          suggestedValue: value.trim(),
          sourceContext: ctx,
          confidence: 'high',
        });
      }
    };

    add('Patient Name', intake.patientName, 'Intake data');
    add('Date of Birth', intake.patientDob, 'Intake data');
    add('Patient Address', intake.patientAddress, 'Intake data');
    add('Phone Number', intake.patientPhone, 'Intake data');
    add('Medicare ID (HICN/MBI)', intake.medicareId, 'Intake data');
    add('Physician Name', intake.physicianName, 'Intake data');
    add('NPI Number', intake.physicianNpi, 'Intake data');
    add('Supplier Name', intake.supplierName, 'Intake data');
    add('HCPCS Code', intake.hcpcsCode, 'Intake data');
    add('Diagnosis Code', intake.diagnosisCode, 'Intake data');
    add('Insurance / Payer', intake.insuranceName, 'Intake data');
    add('Member / Policy ID', intake.policyNumber, 'Intake data');

    setIntakeMappings(mappings);
  };

  const handleClinicalUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setClinicalLoading(true);
    setClinicalError('');
    setClinicalResult(null);

    try {
      const result = await extractClinicalNotes(file);
      setClinicalResult(result);
    } catch (err) {
      setClinicalError(
        err instanceof Error ? err.message : 'Clinical note extraction failed',
      );
    } finally {
      setClinicalLoading(false);
      if (clinicalFileRef.current) clinicalFileRef.current.value = '';
    }
  };

  // Deduplicate: if both intake and clinical provide the same field, prefer
  // intake (user-entered). Preserves the pre-port precedence.
  const deduped = new Map<string, CmnFieldMapping>();
  for (const m of [...intakeMappings, ...(clinicalResult?.fieldMappings || [])]) {
    if (!deduped.has(m.fieldName) || m.sourceContext === 'Intake data') {
      deduped.set(m.fieldName, m);
    }
  }
  const finalMappings = Array.from(deduped.values());

  const handleCopyMappings = () => {
    const text = finalMappings
      .map((m) => `${m.fieldName}: ${m.suggestedValue} (${m.sourceContext})`)
      .join('\n');
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const HeaderIcon = activeTab === 'intake' ? DocumentTextIcon : BeakerIcon;

  return (
    <div className="mx-auto max-w-4xl space-y-5 px-4 py-6 sm:px-7">
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
          <SectionKicker>Intake</SectionKicker>
          <h3
            className="mt-1 font-display font-medium text-foreground"
            style={{ fontSize: 22, lineHeight: 1.15, letterSpacing: '-0.4px' }}
          >
            {activeTab === 'intake' ? 'Intake data auto-fill' : 'Clinical note extraction'}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {activeTab === 'intake'
              ? 'Enter patient demographics and order info. These values will map to CMN and prior-auth form fields for pre-population.'
              : 'Upload physician notes to extract diagnosis codes, test results, and medical necessity language with AI.'}
          </p>
        </div>
      </div>

      {/* Tab toggle — mono segmented control */}
      <div className="inline-flex rounded-sm border border-border bg-card p-0.5">
        {(['intake', 'clinical'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setActiveTab(t)}
            aria-pressed={activeTab === t}
            className={cn(
              'rounded-sm px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider transition-colors',
              activeTab === t
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t === 'intake' ? 'Intake data' : 'Clinical note AI'}
          </button>
        ))}
      </div>

      {/* Intake tab */}
      {activeTab === 'intake' && (
        <div className="space-y-4">
          <div className="intake-grid grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField
              label="Patient name"
              value={intake.patientName}
              onChange={(v) => updateIntake('patientName', v)}
            />
            <FormField
              label="Date of birth"
              value={intake.patientDob}
              onChange={(v) => updateIntake('patientDob', v)}
              placeholder="YYYY-MM-DD"
            />
            <FormField
              label="Medicare ID / MBI"
              value={intake.medicareId}
              onChange={(v) => updateIntake('medicareId', v)}
            />
            <FormField
              label="Phone number"
              value={intake.patientPhone}
              onChange={(v) => updateIntake('patientPhone', v)}
            />
            <FormField
              label="Patient address"
              value={intake.patientAddress}
              onChange={(v) => updateIntake('patientAddress', v)}
              wide
            />
            <FormField
              label="Physician name"
              value={intake.physicianName}
              onChange={(v) => updateIntake('physicianName', v)}
            />
            <FormField
              label="NPI number"
              value={intake.physicianNpi}
              onChange={(v) => updateIntake('physicianNpi', v)}
            />
            <FormField
              label="Supplier name"
              value={intake.supplierName}
              onChange={(v) => updateIntake('supplierName', v)}
            />
            <FormField
              label="HCPCS code"
              value={intake.hcpcsCode}
              onChange={(v) => updateIntake('hcpcsCode', v)}
              placeholder="e.g. E1390, K0823"
            />
            <FormField
              label="Diagnosis / ICD-10"
              value={intake.diagnosisCode}
              onChange={(v) => updateIntake('diagnosisCode', v)}
              placeholder="e.g. J44.1"
            />
            <FormField
              label="Insurance / payer"
              value={intake.insuranceName}
              onChange={(v) => updateIntake('insuranceName', v)}
            />
            <FormField
              label="Policy / member ID"
              value={intake.policyNumber}
              onChange={(v) => updateIntake('policyNumber', v)}
            />
          </div>

          <div className="flex items-center gap-3">
            <Button type="button" onClick={generateIntakeMappings}>
              Generate field mappings
            </Button>
            {intakeMappings.length > 0 && (
              <span
                className="font-mono text-[12px]"
                style={{ color: 'var(--sage)' }}
              >
                {intakeMappings.length} field
                {intakeMappings.length !== 1 ? 's' : ''} ready to map
              </span>
            )}
          </div>
        </div>
      )}

      {/* Clinical tab */}
      {activeTab === 'clinical' && (
        <div className="space-y-4">
          <label>
            <input
              ref={clinicalFileRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.tiff,.tif,.docx,.txt"
              onChange={handleClinicalUpload}
              className="hidden"
              disabled={clinicalLoading}
            />
            <span className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-card px-4 py-2.5 text-[13px] text-foreground hover:bg-muted">
              <ArrowUpTrayIcon className="h-4 w-4" />
              {clinicalLoading
                ? 'Analyzing clinical note…'
                : 'Upload physician note / clinical document'}
            </span>
          </label>

          {clinicalLoading && (
            <div
              className="h-1 w-full overflow-hidden rounded-full"
              style={{ background: 'var(--muted)' }}
            >
              <div
                className="h-full animate-pulse"
                style={{ width: '45%', background: 'var(--accent)' }}
              />
            </div>
          )}

          {clinicalError && (
            <div
              role="alert"
              className="rounded-sm border px-3 py-2 text-[13px]"
              style={{
                background: 'var(--warm-red-soft)',
                borderColor: 'var(--warm-red)',
                color: 'var(--warm-red)',
              }}
            >
              {clinicalError}
            </div>
          )}

          {clinicalResult && <ClinicalResults result={clinicalResult} />}
        </div>
      )}

      {/* Combined field mappings */}
      {finalMappings.length > 0 && (
        <div
          className="rounded-sm border"
          style={{ background: 'var(--sage-soft)', borderColor: 'var(--sage)' }}
        >
          <div
            className="flex items-center justify-between border-b px-4 py-3"
            style={{ borderColor: 'var(--sage)' }}
          >
            <h4
              className="font-display font-medium"
              style={{ fontSize: 15, color: 'var(--sage)' }}
            >
              CMN / prior-auth field mappings ({finalMappings.length})
            </h4>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleCopyMappings}
              className="gap-1.5"
            >
              {copied ? (
                <CheckIcon className="h-3.5 w-3.5" />
              ) : (
                <ClipboardDocumentIcon className="h-3.5 w-3.5" />
              )}
              {copied ? 'Copied' : 'Copy all'}
            </Button>
          </div>
          <p
            className="border-b px-4 py-2 text-[12px]"
            style={{ borderColor: 'var(--sage)', color: 'var(--sage)' }}
          >
            These values can be used to pre-fill CMN Section A, Section B, and prior
            authorization forms.
          </p>
          <div className="flex flex-col gap-2 px-4 py-3">
            {finalMappings.map((m, i) => (
              <div
                key={i}
                className="rounded-sm border border-border bg-card p-3"
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-[13px] font-semibold text-foreground">
                    {m.fieldName}
                  </span>
                  <ConfidencePill level={m.confidence} />
                </div>
                <div className="text-[13px] font-semibold text-foreground">
                  {m.suggestedValue}
                </div>
                <div className="text-[11px] italic text-muted-foreground">
                  {m.sourceContext}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function FormField({
  label,
  value,
  onChange,
  placeholder,
  wide,
}: {
  label: string;
  value?: string;
  onChange: (v: string) => void;
  placeholder?: string;
  wide?: boolean;
}) {
  return (
    <div className={cn('flex flex-col gap-1', wide && 'sm:col-span-2')}>
      <Label>{label}</Label>
      <Input
        type="text"
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}

function ClinicalResults({ result }: { result: ClinicalExtractionResult }) {
  const ex = result.extraction;
  const modelShort = ex.modelUsed.split('/').pop();

  return (
    <div className="overflow-hidden rounded-sm border border-border">
      {/* Confidence row */}
      <div className="flex flex-wrap items-center gap-2.5 border-b border-border bg-muted px-4 py-3">
        <span className="text-[12px] font-medium text-muted-foreground">
          Extraction confidence:
        </span>
        <ConfidencePill level={ex.confidence} />
        <span
          className="ml-auto font-mono text-[11px] text-muted-foreground"
          style={{ letterSpacing: '0.04em' }}
        >
          Model: {modelShort}
        </span>
      </div>

      {ex.extractionNotes && (
        <p
          className="m-0 border-b px-4 py-2.5 text-[13px] italic leading-relaxed"
          style={{
            background: 'var(--amber-soft)',
            borderColor: 'var(--amber)',
            color: 'var(--foreground)',
          }}
        >
          {ex.extractionNotes}
        </p>
      )}

      {/* Sections — each in a hairline-separated block */}
      {ex.icdCodes.length > 0 && (
        <ResultSection title="Diagnosis codes">
          <div className="flex flex-wrap gap-1.5">
            {ex.icdCodes.map((code, i) => (
              <CodeTag key={i} tone="info">
                {code}
              </CodeTag>
            ))}
          </div>
        </ResultSection>
      )}

      {ex.testResults.length > 0 && (
        <ResultSection title="Test results">
          {ex.testResults.map((t, i) => (
            <div
              key={i}
              className="flex flex-wrap items-center gap-3 border-b border-border py-1.5 text-[13px] last:border-b-0"
            >
              <span className="min-w-[140px] font-semibold text-foreground">
                {t.testName}
              </span>
              <span
                className="font-mono font-semibold"
                style={{ color: 'var(--sage)' }}
              >
                {t.result}
                {t.unit ? ` ${t.unit}` : ''}
              </span>
              {t.date && (
                <span
                  className="ml-auto font-mono text-[11px] text-muted-foreground"
                  style={{ letterSpacing: '0.04em' }}
                >
                  {t.date}
                </span>
              )}
            </div>
          ))}
        </ResultSection>
      )}

      {ex.medicalNecessityLanguage && (
        <ResultSection title="Medical necessity language">
          <blockquote
            className="m-0 border-l-[3px] bg-muted px-3.5 py-2.5 text-[13px] italic leading-relaxed text-foreground"
            style={{ borderLeftColor: 'var(--accent)' }}
          >
            {ex.medicalNecessityLanguage}
          </blockquote>
        </ResultSection>
      )}

      {ex.functionalLimitations.length > 0 && (
        <ResultSection title="Functional limitations">
          <ul className="list-disc space-y-1 pl-5">
            {ex.functionalLimitations.map((fl, i) => (
              <li key={i} className="text-[13px] leading-relaxed text-foreground">
                {fl}
              </li>
            ))}
          </ul>
        </ResultSection>
      )}

      {ex.equipmentRecommended && (
        <ResultSection title="Equipment recommended">
          <p className="m-0 text-[13px] leading-relaxed text-foreground">
            {ex.equipmentRecommended}
          </p>
          {ex.hcpcsCodes.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {ex.hcpcsCodes.map((c, i) => (
                <CodeTag key={i} tone="accent">
                  {c}
                </CodeTag>
              ))}
            </div>
          )}
        </ResultSection>
      )}
    </div>
  );
}

function ResultSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-border px-4 py-3 last:border-b-0">
      <h5
        className="mb-2 font-mono uppercase text-foreground"
        style={{ fontSize: 11, letterSpacing: '0.12em' }}
      >
        {title}
      </h5>
      {children}
    </div>
  );
}

function CodeTag({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: 'info' | 'accent';
}) {
  const palette =
    tone === 'info'
      ? { bg: 'var(--conf-partial-bg)', border: 'var(--conf-partial-border)', fg: 'var(--conf-partial)' }
      : { bg: 'var(--copper-soft)', border: 'var(--accent)', fg: 'var(--accent)' };
  return (
    <span
      className="inline-flex items-center rounded-sm border px-2 py-0.5 font-mono text-[11px] font-semibold"
      style={{ background: palette.bg, borderColor: palette.border, color: palette.fg }}
    >
      {children}
    </span>
  );
}
