/**
 * Form Rules — field-level requirements for known DME form types.
 *
 * Each form type defines required fields (by label pattern) so the checker
 * can flag fields that are blank AND required vs. merely optional blanks.
 *
 * Field patterns are case-insensitive regex strings matched against the
 * Textract-detected key (field label).
 */

export interface FormTypeRule {
  /** Human-readable name */
  name: string;
  /** Description of the form */
  description: string;
  /** Patterns matched against the document text to auto-detect this form type */
  detectionPatterns: string[];
  /** Required field label patterns — if a field matches one of these and is blank, it's "required-missing" */
  requiredFields: RequiredFieldRule[];
  /** Sections with special rules (e.g., "Section B is physician-only") */
  sections?: SectionRule[];
}

export interface RequiredFieldRule {
  /** Regex pattern to match the field key/label */
  pattern: string;
  /** Human-readable description of what this field is */
  label: string;
  /** Which section this belongs to (for grouping in UI) */
  section?: string;
}

export interface SectionRule {
  name: string;
  description: string;
  /** Who is responsible for completing this section */
  responsibleParty: 'supplier' | 'physician' | 'patient' | 'any';
}

/**
 * Known form type definitions.
 * Add new form types here as needed.
 */
export const FORM_RULES: Record<string, FormTypeRule> = {
  'cmn-oxygen': {
    name: 'CMN for Oxygen (CMS-484)',
    description: 'Certificate of Medical Necessity for Home Oxygen Therapy',
    detectionPatterns: [
      'certificate of medical necessity',
      'cms-484',
      'cms 484',
      'home oxygen therapy',
      'oxygen equipment',
    ],
    sections: [
      { name: 'Section A', description: 'Certification type and order information', responsibleParty: 'supplier' },
      { name: 'Section B', description: 'Clinical information', responsibleParty: 'physician' },
      { name: 'Section C', description: 'Narrative description by supplier', responsibleParty: 'supplier' },
      { name: 'Section D', description: 'Physician attestation', responsibleParty: 'physician' },
    ],
    requiredFields: [
      // Section A
      { pattern: 'patient.*name', label: 'Patient Name', section: 'Section A' },
      { pattern: 'date.*of.*birth|dob|birth.*date', label: 'Date of Birth', section: 'Section A' },
      { pattern: 'hicn|hic.*number|medicare.*id|mbi', label: 'Medicare ID (HICN/MBI)', section: 'Section A' },
      { pattern: 'address|street', label: 'Patient Address', section: 'Section A' },
      { pattern: 'phone|telephone', label: 'Phone Number', section: 'Section A' },
      { pattern: 'physician.*name|ordering.*physician|referring.*physician', label: 'Physician Name', section: 'Section A' },
      { pattern: 'npi|provider.*number', label: 'NPI Number', section: 'Section A' },
      { pattern: 'supplier.*name', label: 'Supplier Name', section: 'Section A' },
      { pattern: 'hcpcs|procedure.*code', label: 'HCPCS Code', section: 'Section A' },
      { pattern: 'initial.*date|start.*date|begin.*date', label: 'Initial Date', section: 'Section A' },
      // Section B
      { pattern: 'diagnosis|icd|primary.*diag', label: 'Diagnosis Code', section: 'Section B' },
      { pattern: 'arterial.*blood.*gas|abg|po2|pao2', label: 'Blood Gas Results', section: 'Section B' },
      { pattern: 'oxygen.*saturation|spo2|o2.*sat', label: 'Oxygen Saturation', section: 'Section B' },
      { pattern: 'liter.*flow|flow.*rate|lpm', label: 'Liter Flow Rate', section: 'Section B' },
      { pattern: 'test.*date|testing.*date', label: 'Test Date', section: 'Section B' },
      // Section D
      { pattern: 'physician.*signature|doctor.*signature|md.*signature', label: 'Physician Signature', section: 'Section D' },
      { pattern: 'date.*signed|signature.*date', label: 'Signature Date', section: 'Section D' },
    ],
  },

  'cmn-hospital-beds': {
    name: 'CMN for Hospital Beds (CMS-10126)',
    description: 'Certificate of Medical Necessity for Hospital Beds',
    detectionPatterns: [
      'cms-10126',
      'cms 10126',
      'hospital bed',
      'medical necessity.*bed',
    ],
    sections: [
      { name: 'Section A', description: 'Patient and supplier information', responsibleParty: 'supplier' },
      { name: 'Section B', description: 'Clinical information', responsibleParty: 'physician' },
      { name: 'Section D', description: 'Physician attestation', responsibleParty: 'physician' },
    ],
    requiredFields: [
      { pattern: 'patient.*name', label: 'Patient Name', section: 'Section A' },
      { pattern: 'date.*of.*birth|dob|birth.*date', label: 'Date of Birth', section: 'Section A' },
      { pattern: 'hicn|hic.*number|medicare.*id|mbi', label: 'Medicare ID', section: 'Section A' },
      { pattern: 'physician.*name|ordering.*physician', label: 'Physician Name', section: 'Section A' },
      { pattern: 'npi|provider.*number', label: 'NPI Number', section: 'Section A' },
      { pattern: 'diagnosis|icd', label: 'Diagnosis Code', section: 'Section B' },
      { pattern: 'physician.*signature', label: 'Physician Signature', section: 'Section D' },
      { pattern: 'date.*signed|signature.*date', label: 'Signature Date', section: 'Section D' },
    ],
  },

  'cmn-pov': {
    name: 'CMN for Power Operated Vehicles (CMS-10125)',
    description: 'Certificate of Medical Necessity for POVs/Power Wheelchairs',
    detectionPatterns: [
      'cms-10125',
      'cms 10125',
      'power.*operated.*vehicle',
      'power.*wheelchair',
      'power.*mobility',
    ],
    sections: [
      { name: 'Section A', description: 'Patient and supplier information', responsibleParty: 'supplier' },
      { name: 'Section B', description: 'Clinical information', responsibleParty: 'physician' },
      { name: 'Section D', description: 'Physician attestation', responsibleParty: 'physician' },
    ],
    requiredFields: [
      { pattern: 'patient.*name', label: 'Patient Name', section: 'Section A' },
      { pattern: 'date.*of.*birth|dob|birth.*date', label: 'Date of Birth', section: 'Section A' },
      { pattern: 'hicn|hic.*number|medicare.*id|mbi', label: 'Medicare ID', section: 'Section A' },
      { pattern: 'height|weight', label: 'Patient Height/Weight', section: 'Section B' },
      { pattern: 'diagnosis|icd', label: 'Diagnosis Code', section: 'Section B' },
      { pattern: 'physician.*signature', label: 'Physician Signature', section: 'Section D' },
      { pattern: 'date.*signed|signature.*date', label: 'Signature Date', section: 'Section D' },
    ],
  },

  'prior-auth': {
    name: 'Prior Authorization Request',
    description: 'Generic prior authorization form for DME',
    detectionPatterns: [
      'prior.*auth',
      'pre.?authorization',
      'authorization.*request',
    ],
    requiredFields: [
      { pattern: 'patient.*name|member.*name', label: 'Patient/Member Name' },
      { pattern: 'date.*of.*birth|dob', label: 'Date of Birth' },
      { pattern: 'member.*id|subscriber.*id|insurance.*id|policy.*number', label: 'Member/Policy ID' },
      { pattern: 'diagnosis|icd', label: 'Diagnosis Code' },
      { pattern: 'hcpcs|procedure.*code|cpt', label: 'Procedure/HCPCS Code' },
      { pattern: 'physician.*name|prescriber|ordering.*provider', label: 'Ordering Provider' },
      { pattern: 'npi', label: 'NPI Number' },
      { pattern: 'justification|medical.*necessity|clinical.*rationale', label: 'Medical Necessity Justification' },
      { pattern: 'signature', label: 'Signature' },
    ],
  },
};

/**
 * Attempt to detect the form type from the full document text.
 * Returns the matching form type key and rule, or null if no match.
 */
export function detectFormType(documentText: string): { key: string; rule: FormTypeRule } | null {
  const lower = documentText.toLowerCase();

  for (const [key, rule] of Object.entries(FORM_RULES)) {
    for (const pattern of rule.detectionPatterns) {
      if (lower.includes(pattern)) {
        return { key, rule };
      }
    }
  }

  return null;
}

/**
 * Check if a field matches a required field pattern for a given form type.
 * Returns the matching required field rule, or null.
 */
export function matchRequiredField(fieldKey: string, formType: FormTypeRule): RequiredFieldRule | null {
  const lower = fieldKey.toLowerCase();

  for (const req of formType.requiredFields) {
    try {
      if (new RegExp(req.pattern, 'i').test(lower)) {
        return req;
      }
    } catch {
      // Skip invalid regex patterns
      if (lower.includes(req.pattern)) {
        return req;
      }
    }
  }

  return null;
}
