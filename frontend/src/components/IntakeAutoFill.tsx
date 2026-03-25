/**
 * IntakeAutoFill — Combined panel for:
 *   1. Manual intake data entry (patient demographics, physician info, supplier info)
 *   2. AI-assisted clinical note extraction (upload physician notes → extract structured data)
 *
 * Both sources produce CMN field mappings that can be copied/exported for form pre-population.
 */

import { useState, useRef, ChangeEvent } from 'react';
import {
  extractClinicalNotes,
  ClinicalExtractionResult,
  CmnFieldMapping,
  IntakeData,
} from '../services/api';

type Tab = 'intake' | 'clinical';

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

  // Combined mappings
  const [copied, setCopied] = useState(false);

  // --- Intake form helpers ---

  const updateIntake = (field: keyof IntakeData, value: string) => {
    setIntake(prev => ({ ...prev, [field]: value || undefined }));
  };

  const generateIntakeMappings = () => {
    const mappings: CmnFieldMapping[] = [];
    const add = (fieldName: string, value: string | undefined, ctx: string) => {
      if (value?.trim()) {
        mappings.push({ fieldName, suggestedValue: value.trim(), sourceContext: ctx, confidence: 'high' });
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

  // --- Clinical note upload ---

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
      setClinicalError(err instanceof Error ? err.message : 'Clinical note extraction failed');
    } finally {
      setClinicalLoading(false);
      if (clinicalFileRef.current) clinicalFileRef.current.value = '';
    }
  };

  // --- Combined mappings ---

  const allMappings: CmnFieldMapping[] = [
    ...intakeMappings,
    ...(clinicalResult?.fieldMappings || []),
  ];

  // Deduplicate: if both intake and clinical provide the same field, prefer intake (user-entered)
  const deduped = new Map<string, CmnFieldMapping>();
  for (const m of allMappings) {
    if (!deduped.has(m.fieldName) || m.sourceContext === 'Intake data') {
      deduped.set(m.fieldName, m);
    }
  }
  const finalMappings = Array.from(deduped.values());

  const handleCopyMappings = () => {
    const text = finalMappings.map(m =>
      `${m.fieldName}: ${m.suggestedValue} (${m.sourceContext})`
    ).join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={s.container}>
      {/* Header */}
      <div style={s.header}>
        <div style={s.iconBg}>
          <span style={s.icon}>{activeTab === 'intake' ? '\u{1F4DD}' : '\u{1F9EA}'}</span>
        </div>
        <div>
          <h3 style={s.title}>
            {activeTab === 'intake' ? 'Intake Data Auto-Fill' : 'Clinical Note Extraction'}
          </h3>
          <p style={s.desc}>
            {activeTab === 'intake'
              ? 'Enter patient demographics and order info. These values will map to CMN and prior-auth form fields for pre-population.'
              : 'Upload physician notes to extract diagnosis codes, test results, and medical necessity language with AI.'}
          </p>
        </div>
      </div>

      {/* Tab toggle */}
      <div style={s.tabRow}>
        <button onClick={() => setActiveTab('intake')} style={activeTab === 'intake' ? s.tabActive : s.tabInactive}>
          Intake Data
        </button>
        <button onClick={() => setActiveTab('clinical')} style={activeTab === 'clinical' ? s.tabActiveClinical : s.tabInactive}>
          Clinical Note AI
        </button>
      </div>

      {/* Intake Tab */}
      {activeTab === 'intake' && (
        <div style={s.formSection}>
          <div style={s.formGrid} className="intake-grid">
            <FormField label="Patient Name" value={intake.patientName} onChange={v => updateIntake('patientName', v)} />
            <FormField label="Date of Birth" value={intake.patientDob} onChange={v => updateIntake('patientDob', v)} placeholder="YYYY-MM-DD" />
            <FormField label="Medicare ID / MBI" value={intake.medicareId} onChange={v => updateIntake('medicareId', v)} />
            <FormField label="Phone Number" value={intake.patientPhone} onChange={v => updateIntake('patientPhone', v)} />
            <FormField label="Patient Address" value={intake.patientAddress} onChange={v => updateIntake('patientAddress', v)} wide />
            <FormField label="Physician Name" value={intake.physicianName} onChange={v => updateIntake('physicianName', v)} />
            <FormField label="NPI Number" value={intake.physicianNpi} onChange={v => updateIntake('physicianNpi', v)} />
            <FormField label="Supplier Name" value={intake.supplierName} onChange={v => updateIntake('supplierName', v)} />
            <FormField label="HCPCS Code" value={intake.hcpcsCode} onChange={v => updateIntake('hcpcsCode', v)} placeholder="E.g., E1390, K0823" />
            <FormField label="Diagnosis / ICD-10" value={intake.diagnosisCode} onChange={v => updateIntake('diagnosisCode', v)} placeholder="E.g., J44.1" />
            <FormField label="Insurance / Payer" value={intake.insuranceName} onChange={v => updateIntake('insuranceName', v)} />
            <FormField label="Policy / Member ID" value={intake.policyNumber} onChange={v => updateIntake('policyNumber', v)} />
          </div>

          <button onClick={generateIntakeMappings} style={s.generateBtn}>
            Generate Field Mappings
          </button>

          {intakeMappings.length > 0 && (
            <div style={s.mappingNote}>
              {intakeMappings.length} field{intakeMappings.length !== 1 ? 's' : ''} ready to map to CMN / prior-auth forms
            </div>
          )}
        </div>
      )}

      {/* Clinical Note Tab */}
      {activeTab === 'clinical' && (
        <div style={s.formSection}>
          <label style={s.uploadLabel}>
            <input
              ref={clinicalFileRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.tiff,.tif,.docx,.txt"
              onChange={handleClinicalUpload}
              style={{ display: 'none' }}
              disabled={clinicalLoading}
            />
            <span style={clinicalLoading ? s.uploadBtnLoading : s.uploadBtn}>
              {clinicalLoading ? 'Analyzing clinical note...' : 'Upload Physician Note / Clinical Document'}
            </span>
          </label>

          {clinicalLoading && (
            <div style={s.loadingBar}><div style={s.loadingFill} /></div>
          )}

          {clinicalError && <div style={s.error}>{clinicalError}</div>}

          {clinicalResult && (
            <div style={s.clinicalResults}>
              {/* Confidence badge */}
              <div style={s.confRow}>
                <span style={s.confLabel}>Extraction confidence:</span>
                <span style={clinicalResult.extraction.confidence === 'high' ? s.confHigh :
                  clinicalResult.extraction.confidence === 'medium' ? s.confMed : s.confLow}>
                  {clinicalResult.extraction.confidence}
                </span>
                <span style={s.modelLabel}>Model: {clinicalResult.extraction.modelUsed.split('/').pop()}</span>
              </div>

              {clinicalResult.extraction.extractionNotes && (
                <p style={s.notes}>{clinicalResult.extraction.extractionNotes}</p>
              )}

              {/* Extracted diagnosis codes */}
              {clinicalResult.extraction.icdCodes.length > 0 && (
                <div style={s.section}>
                  <h5 style={s.sectionTitle}>Diagnosis Codes</h5>
                  <div style={s.tagList}>
                    {clinicalResult.extraction.icdCodes.map((code, i) => (
                      <span key={i} style={s.codeTag}>{code}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Test results */}
              {clinicalResult.extraction.testResults.length > 0 && (
                <div style={s.section}>
                  <h5 style={s.sectionTitle}>Test Results</h5>
                  {clinicalResult.extraction.testResults.map((t, i) => (
                    <div key={i} style={s.testRow}>
                      <span style={s.testName}>{t.testName}</span>
                      <span style={s.testVal}>{t.result}{t.unit ? ` ${t.unit}` : ''}</span>
                      {t.date && <span style={s.testDate}>{t.date}</span>}
                    </div>
                  ))}
                </div>
              )}

              {/* Medical necessity */}
              {clinicalResult.extraction.medicalNecessityLanguage && (
                <div style={s.section}>
                  <h5 style={s.sectionTitle}>Medical Necessity Language</h5>
                  <blockquote style={s.quote}>{clinicalResult.extraction.medicalNecessityLanguage}</blockquote>
                </div>
              )}

              {/* Functional limitations */}
              {clinicalResult.extraction.functionalLimitations.length > 0 && (
                <div style={s.section}>
                  <h5 style={s.sectionTitle}>Functional Limitations</h5>
                  <ul style={s.list}>
                    {clinicalResult.extraction.functionalLimitations.map((fl, i) => (
                      <li key={i} style={s.listItem}>{fl}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Equipment recommended */}
              {clinicalResult.extraction.equipmentRecommended && (
                <div style={s.section}>
                  <h5 style={s.sectionTitle}>Equipment Recommended</h5>
                  <p style={s.sectionText}>{clinicalResult.extraction.equipmentRecommended}</p>
                  {clinicalResult.extraction.hcpcsCodes.length > 0 && (
                    <div style={s.tagList}>
                      {clinicalResult.extraction.hcpcsCodes.map((c, i) => (
                        <span key={i} style={s.hcpcsTag}>{c}</span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Combined Field Mappings */}
      {finalMappings.length > 0 && (
        <div style={s.mappingsSection}>
          <div style={s.mappingsHeader}>
            <h4 style={s.mappingsTitle}>
              CMN / Prior-Auth Field Mappings ({finalMappings.length})
            </h4>
            <button onClick={handleCopyMappings} style={s.copyBtn}>
              {copied ? 'Copied!' : 'Copy All'}
            </button>
          </div>
          <p style={s.mappingsDesc}>
            These values can be used to pre-fill CMN Section A, Section B, and prior authorization forms.
          </p>
          <div style={s.mappingsList}>
            {finalMappings.map((m, i) => (
              <div key={i} style={s.mappingItem}>
                <div style={s.mappingTop}>
                  <span style={s.mappingField}>{m.fieldName}</span>
                  <span style={m.confidence === 'high' ? s.mapConfHigh : m.confidence === 'medium' ? s.mapConfMed : s.mapConfLow}>
                    {m.confidence}
                  </span>
                </div>
                <div style={s.mappingValue}>{m.suggestedValue}</div>
                <div style={s.mappingSource}>{m.sourceContext}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// --- Small form field component ---

function FormField({ label, value, onChange, placeholder, wide }: {
  label: string;
  value?: string;
  onChange: (v: string) => void;
  placeholder?: string;
  wide?: boolean;
}) {
  return (
    <div style={{ ...(wide ? s.fieldWide : s.field) }}>
      <label style={s.fieldLabel}>{label}</label>
      <input
        type="text"
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={s.fieldInput}
      />
    </div>
  );
}

// --- Styles ---

const s: Record<string, React.CSSProperties> = {
  container: { padding: '28px', maxWidth: '960px', background: '#ffffff', height: '100%', overflowY: 'auto' },
  header: { display: 'flex', gap: '16px', marginBottom: '20px', alignItems: 'flex-start' },
  iconBg: {
    width: '48px', height: '48px', borderRadius: '14px',
    background: 'linear-gradient(135deg, #ECFDF5, #A7F3D0)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  icon: { fontSize: '24px' },
  title: { margin: '0 0 4px', fontSize: '18px', fontWeight: 700, color: '#0D2137', letterSpacing: '-0.2px' },
  desc: { margin: 0, fontSize: '14px', color: '#6B8299', lineHeight: '1.5' },

  // Tabs
  tabRow: {
    display: 'flex', gap: '4px', marginBottom: '20px',
    background: '#F1F5F9', borderRadius: '10px', padding: '3px',
  },
  tabActive: {
    flex: 1, padding: '8px 16px', border: 'none', borderRadius: '8px',
    background: 'white', color: '#065F46', fontSize: '13px', fontWeight: 600,
    cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
  },
  tabActiveClinical: {
    flex: 1, padding: '8px 16px', border: 'none', borderRadius: '8px',
    background: 'white', color: '#7C3AED', fontSize: '13px', fontWeight: 600,
    cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
  },
  tabInactive: {
    flex: 1, padding: '8px 16px', border: 'none', borderRadius: '8px',
    background: 'transparent', color: '#5F7A8F', fontSize: '13px', fontWeight: 500,
    cursor: 'pointer',
  },

  // Form
  formSection: { marginBottom: '20px' },
  formGrid: {
    display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px',
  },
  field: {},
  fieldWide: { gridColumn: '1 / -1' },
  fieldLabel: {
    display: 'block', fontSize: '12px', fontWeight: 600, color: '#374151',
    marginBottom: '4px',
  },
  fieldInput: {
    width: '100%', padding: '8px 12px', border: '1px solid #D6E4F0', borderRadius: '8px',
    fontSize: '13px', color: '#0D2137', outline: 'none', boxSizing: 'border-box' as const,
  },
  generateBtn: {
    padding: '10px 24px', border: 'none', borderRadius: '10px',
    background: 'linear-gradient(135deg, #059669, #047857)', color: 'white',
    fontSize: '13px', fontWeight: 600, cursor: 'pointer',
    boxShadow: '0 2px 8px rgba(5, 150, 105, 0.25)',
  },
  mappingNote: {
    marginTop: '12px', fontSize: '13px', color: '#059669', fontWeight: 600,
  },

  // Clinical upload
  uploadLabel: { display: 'inline-block', cursor: 'pointer' },
  uploadBtn: {
    display: 'inline-block', padding: '11px 24px',
    background: 'linear-gradient(135deg, #7C3AED, #6D28D9)', color: 'white',
    borderRadius: '10px', fontSize: '14px', fontWeight: 500,
    boxShadow: '0 2px 8px rgba(124, 58, 237, 0.25)', cursor: 'pointer',
  },
  uploadBtnLoading: {
    display: 'inline-block', padding: '11px 24px', background: '#5F7A8F',
    color: 'white', borderRadius: '10px', fontSize: '14px', fontWeight: 500, cursor: 'wait',
  },
  loadingBar: {
    marginTop: '16px', height: '4px', borderRadius: '2px', background: '#E8EFF5', overflow: 'hidden',
  },
  loadingFill: {
    height: '100%', width: '40%', borderRadius: '2px',
    background: 'linear-gradient(90deg, #7C3AED, #A78BFA, #7C3AED)',
    backgroundSize: '200% 100%', animation: 'shimmer 1.5s ease-in-out infinite',
  },
  error: {
    marginTop: '16px', padding: '12px 16px', background: '#fef2f2',
    color: '#dc2626', borderRadius: '10px', fontSize: '13px', border: '1px solid #fecaca',
  },

  // Clinical results
  clinicalResults: {
    marginTop: '20px', border: '1px solid #E8EFF5', borderRadius: '14px',
    overflow: 'hidden',
  },
  confRow: {
    display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 18px',
    background: '#F7FAFD', borderBottom: '1px solid #E8EFF5',
  },
  confLabel: { fontSize: '12px', color: '#6B8299', fontWeight: 500 },
  confHigh: {
    fontSize: '11px', color: '#059669', background: '#ECFDF5', padding: '3px 8px',
    borderRadius: '6px', fontWeight: 600, border: '1px solid #A7F3D0',
  },
  confMed: {
    fontSize: '11px', color: '#D97706', background: '#FFFBEB', padding: '3px 8px',
    borderRadius: '6px', fontWeight: 600, border: '1px solid #FDE68A',
  },
  confLow: {
    fontSize: '11px', color: '#DC2626', background: '#FEF2F2', padding: '3px 8px',
    borderRadius: '6px', fontWeight: 600, border: '1px solid #FECACA',
  },
  modelLabel: { fontSize: '11px', color: '#5F7A8F', marginLeft: 'auto' },
  notes: {
    margin: 0, padding: '10px 18px', fontSize: '13px', color: '#6B8299',
    background: '#FFFBEB', borderBottom: '1px solid #FDE68A', lineHeight: '1.5',
    fontStyle: 'italic',
  },

  section: { padding: '14px 18px', borderBottom: '1px solid #E8EFF5' },
  sectionTitle: {
    margin: '0 0 8px', fontSize: '12px', fontWeight: 700, color: '#0D2137',
    textTransform: 'uppercase' as const, letterSpacing: '0.3px',
  },
  sectionText: { margin: 0, fontSize: '13px', color: '#374151', lineHeight: '1.5' },
  tagList: { display: 'flex', flexWrap: 'wrap' as const, gap: '6px' },
  codeTag: {
    fontSize: '12px', padding: '4px 10px', borderRadius: '6px',
    background: '#EDE9FE', color: '#6D28D9', fontWeight: 600, fontFamily: 'monospace',
    border: '1px solid #DDD6FE',
  },
  hcpcsTag: {
    fontSize: '12px', padding: '4px 10px', borderRadius: '6px',
    background: '#E3F2FD', color: '#1565C0', fontWeight: 600, fontFamily: 'monospace',
    border: '1px solid #BBDEFB',
  },
  testRow: {
    display: 'flex', alignItems: 'center', gap: '12px', padding: '6px 0',
    borderBottom: '1px solid #F1F5F9',
  },
  testName: { fontSize: '13px', fontWeight: 600, color: '#0D2137', minWidth: '140px' },
  testVal: { fontSize: '13px', color: '#059669', fontWeight: 600, fontFamily: 'monospace' },
  testDate: { fontSize: '11px', color: '#5F7A8F', marginLeft: 'auto' },
  quote: {
    margin: 0, padding: '10px 14px', borderLeft: '3px solid #7C3AED',
    background: '#F5F3FF', fontSize: '13px', color: '#374151', lineHeight: '1.6',
    fontStyle: 'italic',
  },
  list: { margin: 0, paddingLeft: '18px' },
  listItem: { fontSize: '13px', color: '#374151', lineHeight: '1.6', marginBottom: '4px' },

  // Combined mappings
  mappingsSection: {
    border: '1px solid #A7F3D0', borderRadius: '14px', overflow: 'hidden',
    background: '#ECFDF5',
  },
  mappingsHeader: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '14px 18px', borderBottom: '1px solid #A7F3D0',
  },
  mappingsTitle: { margin: 0, fontSize: '15px', fontWeight: 700, color: '#065F46' },
  copyBtn: {
    padding: '6px 14px', border: '1px solid #6EE7B7', borderRadius: '8px',
    background: 'white', color: '#065F46', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
  },
  mappingsDesc: {
    margin: 0, padding: '10px 18px', fontSize: '12px', color: '#047857',
    borderBottom: '1px solid #A7F3D0',
  },
  mappingsList: { padding: '10px 18px', display: 'flex', flexDirection: 'column' as const, gap: '8px' },
  mappingItem: {
    padding: '10px 14px', background: 'white', borderRadius: '8px',
    border: '1px solid #D1FAE5',
  },
  mappingTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' },
  mappingField: { fontSize: '13px', fontWeight: 700, color: '#065F46' },
  mapConfHigh: {
    fontSize: '10px', color: '#059669', background: '#D1FAE5', padding: '2px 6px',
    borderRadius: '4px', fontWeight: 600,
  },
  mapConfMed: {
    fontSize: '10px', color: '#D97706', background: '#FEF3C7', padding: '2px 6px',
    borderRadius: '4px', fontWeight: 600,
  },
  mapConfLow: {
    fontSize: '10px', color: '#DC2626', background: '#FEE2E2', padding: '2px 6px',
    borderRadius: '4px', fontWeight: 600,
  },
  mappingValue: { fontSize: '13px', color: '#0D2137', fontWeight: 600, marginBottom: '2px' },
  mappingSource: { fontSize: '11px', color: '#6B8299', fontStyle: 'italic' },
};
