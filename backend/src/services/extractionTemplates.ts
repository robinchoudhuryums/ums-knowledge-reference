/**
 * Extraction Templates — define structured forms that Claude can fill from clinical documents.
 *
 * Each template has:
 *   - id/name/description for UI display
 *   - fields[] defining expected output fields with types, labels, and optionality
 *   - systemPrompt tailored for that extraction type
 *
 * Adding a new template: just add another entry to EXTRACTION_TEMPLATES.
 */

export interface TemplateField {
  key: string;
  label: string;
  type: 'text' | 'date' | 'number' | 'boolean' | 'textarea' | 'select';
  required: boolean;
  options?: string[];   // for 'select' type
  description?: string; // help text shown to user
  group?: string;       // visual grouping in the form UI
}

export interface ExtractionTemplate {
  id: string;
  name: string;
  description: string;
  category: 'clinical' | 'billing' | 'compliance' | 'general';
  fields: TemplateField[];
  systemPrompt: string;
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

const PPD_TEMPLATE: ExtractionTemplate = {
  id: 'ppd',
  name: 'Proof of Prior Delivery (PPD)',
  description: 'Extract PPD data from clinical notes, delivery tickets, or signed documentation to verify prior equipment delivery.',
  category: 'clinical',
  fields: [
    // Patient Information
    { key: 'patientName', label: 'Patient Name', type: 'text', required: true, group: 'Patient Information' },
    { key: 'patientDob', label: 'Date of Birth', type: 'date', required: false, group: 'Patient Information' },
    { key: 'patientId', label: 'Patient ID / MRN', type: 'text', required: false, group: 'Patient Information' },
    { key: 'patientAddress', label: 'Patient Address', type: 'text', required: false, group: 'Patient Information' },
    { key: 'patientPhone', label: 'Patient Phone', type: 'text', required: false, group: 'Patient Information' },
    // Equipment / Supply
    { key: 'equipmentDescription', label: 'Equipment / Supply Description', type: 'textarea', required: true, group: 'Equipment / Supply' },
    { key: 'hcpcsCode', label: 'HCPCS Code(s)', type: 'text', required: false, group: 'Equipment / Supply' },
    { key: 'serialNumber', label: 'Serial Number', type: 'text', required: false, group: 'Equipment / Supply' },
    { key: 'quantity', label: 'Quantity', type: 'number', required: false, group: 'Equipment / Supply' },
    // Delivery Details
    { key: 'deliveryDate', label: 'Date of Delivery', type: 'date', required: true, group: 'Delivery Details' },
    { key: 'deliveryMethod', label: 'Delivery Method', type: 'select', required: false, options: ['In-person delivery', 'Shipping', 'Pick-up', 'Not specified'], group: 'Delivery Details' },
    { key: 'deliveredBy', label: 'Delivered By', type: 'text', required: false, group: 'Delivery Details' },
    { key: 'receivedBy', label: 'Received By (Signature)', type: 'text', required: false, group: 'Delivery Details' },
    { key: 'deliveryAddress', label: 'Delivery Address', type: 'text', required: false, group: 'Delivery Details' },
    // Provider / Prescriber
    { key: 'orderingPhysician', label: 'Ordering Physician', type: 'text', required: false, group: 'Provider Information' },
    { key: 'npi', label: 'NPI', type: 'text', required: false, group: 'Provider Information' },
    { key: 'referringProvider', label: 'Referring Provider', type: 'text', required: false, group: 'Provider Information' },
    // Insurance / Billing
    { key: 'insuranceName', label: 'Insurance / Payer', type: 'text', required: false, group: 'Insurance / Billing' },
    { key: 'policyNumber', label: 'Policy Number', type: 'text', required: false, group: 'Insurance / Billing' },
    { key: 'authorizationNumber', label: 'Authorization Number', type: 'text', required: false, group: 'Insurance / Billing' },
    // Notes
    { key: 'notes', label: 'Additional Notes', type: 'textarea', required: false, group: 'Notes' },
    { key: 'discrepancies', label: 'Discrepancies / Missing Info', type: 'textarea', required: false, group: 'Notes', description: 'Any information that appears incomplete, inconsistent, or missing from the source document.' },
  ],
  systemPrompt: `You are a medical document data extraction specialist for a Durable Medical Equipment (DME) supplier.

Your task: extract Proof of Prior Delivery (PPD) data from the uploaded document. PPD proves that a specific piece of equipment or supply was previously delivered to a patient.

Rules:
- Extract ONLY information explicitly stated in the document. Never guess or fabricate data.
- If a field is not present in the document, return null for that field.
- For dates, use YYYY-MM-DD format.
- For HCPCS codes, include all codes found (comma-separated if multiple).
- In the "discrepancies" field, note any missing required information or inconsistencies you observe.
- Be precise with patient names, addresses, and ID numbers — copy them exactly as written.
- If the document contains multiple deliveries, extract data for the PRIMARY or most recent delivery.`,
};

const GENERAL_ANALYSIS_TEMPLATE: ExtractionTemplate = {
  id: 'general',
  name: 'General Document Analysis',
  description: 'Get a comprehensive summary and analysis of any uploaded document — no specific form, just intelligent analysis.',
  category: 'general',
  fields: [
    { key: 'documentType', label: 'Document Type', type: 'text', required: true, group: 'Overview' },
    { key: 'summary', label: 'Summary', type: 'textarea', required: true, group: 'Overview' },
    { key: 'keyFindings', label: 'Key Findings', type: 'textarea', required: true, group: 'Analysis' },
    { key: 'dateRange', label: 'Date Range Referenced', type: 'text', required: false, group: 'Analysis' },
    { key: 'peopleReferenced', label: 'People Referenced', type: 'textarea', required: false, group: 'Analysis' },
    { key: 'actionItems', label: 'Action Items / Follow-ups', type: 'textarea', required: false, group: 'Recommendations' },
    { key: 'missingInfo', label: 'Missing or Unclear Information', type: 'textarea', required: false, group: 'Recommendations' },
  ],
  systemPrompt: `You are a document analysis specialist for a Durable Medical Equipment (DME) supplier.

Your task: analyze the uploaded document and provide a structured summary.

Rules:
- Identify the document type (clinical notes, delivery ticket, invoice, prescription, etc.).
- Provide a concise but thorough summary of the document contents.
- List key findings — important facts, dates, decisions, or data points.
- Note any people referenced (patients, providers, staff) by role.
- Identify action items or follow-ups implied by the document.
- Flag anything missing, unclear, or potentially incorrect.
- Extract ONLY information present in the document. Never fabricate details.`,
};

const CMN_TEMPLATE: ExtractionTemplate = {
  id: 'cmn',
  name: 'Certificate of Medical Necessity (CMN)',
  description: 'Extract CMN form data from physician documentation, orders, or clinical notes.',
  category: 'clinical',
  fields: [
    // Patient
    { key: 'patientName', label: 'Patient Name', type: 'text', required: true, group: 'Patient Information' },
    { key: 'patientDob', label: 'Date of Birth', type: 'date', required: false, group: 'Patient Information' },
    { key: 'patientId', label: 'Patient ID / MRN', type: 'text', required: false, group: 'Patient Information' },
    { key: 'heightInches', label: 'Height (inches)', type: 'number', required: false, group: 'Patient Information' },
    { key: 'weightLbs', label: 'Weight (lbs)', type: 'number', required: false, group: 'Patient Information' },
    // Diagnosis
    { key: 'primaryDiagnosis', label: 'Primary Diagnosis', type: 'text', required: true, group: 'Diagnosis' },
    { key: 'icdCodes', label: 'ICD-10 Code(s)', type: 'text', required: false, group: 'Diagnosis' },
    { key: 'prognosis', label: 'Prognosis', type: 'text', required: false, group: 'Diagnosis' },
    // Equipment
    { key: 'equipmentDescription', label: 'Equipment Description', type: 'textarea', required: true, group: 'Equipment Ordered' },
    { key: 'hcpcsCode', label: 'HCPCS Code(s)', type: 'text', required: false, group: 'Equipment Ordered' },
    { key: 'lengthOfNeed', label: 'Length of Need (months)', type: 'text', required: false, group: 'Equipment Ordered' },
    // Medical Justification
    { key: 'medicalNecessity', label: 'Medical Necessity Justification', type: 'textarea', required: true, group: 'Medical Justification' },
    { key: 'previousTreatment', label: 'Previous Treatment / Alternatives Tried', type: 'textarea', required: false, group: 'Medical Justification' },
    // Physician
    { key: 'physicianName', label: 'Physician Name', type: 'text', required: true, group: 'Physician Information' },
    { key: 'npi', label: 'NPI', type: 'text', required: false, group: 'Physician Information' },
    { key: 'physicianSignatureDate', label: 'Signature Date', type: 'date', required: false, group: 'Physician Information' },
    // Notes
    { key: 'notes', label: 'Additional Notes', type: 'textarea', required: false, group: 'Notes' },
    { key: 'discrepancies', label: 'Discrepancies / Missing Info', type: 'textarea', required: false, group: 'Notes' },
  ],
  systemPrompt: `You are a medical document data extraction specialist for a Durable Medical Equipment (DME) supplier.

Your task: extract Certificate of Medical Necessity (CMN) data from the uploaded document. CMNs justify the medical need for specific equipment.

Rules:
- Extract ONLY information explicitly stated in the document. Never guess or fabricate data.
- If a field is not present in the document, return null for that field.
- For dates, use YYYY-MM-DD format.
- For ICD-10 and HCPCS codes, include all codes found (comma-separated if multiple).
- For medical necessity, quote or closely paraphrase the physician's justification.
- Note any missing required CMN fields in the "discrepancies" field.
- Be precise with names, codes, and clinical details — copy them exactly as written.`,
};

const PRIOR_AUTH_TEMPLATE: ExtractionTemplate = {
  id: 'prior-auth',
  name: 'Prior Authorization',
  description: 'Extract prior authorization details from insurance correspondence, approval letters, or clinical documentation.',
  category: 'billing',
  fields: [
    { key: 'patientName', label: 'Patient Name', type: 'text', required: true, group: 'Patient Information' },
    { key: 'patientDob', label: 'Date of Birth', type: 'date', required: false, group: 'Patient Information' },
    { key: 'memberId', label: 'Member / Policy ID', type: 'text', required: false, group: 'Patient Information' },
    { key: 'insuranceName', label: 'Insurance / Payer', type: 'text', required: true, group: 'Insurance' },
    { key: 'authorizationNumber', label: 'Authorization Number', type: 'text', required: true, group: 'Insurance' },
    { key: 'authStatus', label: 'Authorization Status', type: 'select', required: true, options: ['Approved', 'Denied', 'Pending', 'Partially Approved', 'Not specified'], group: 'Insurance' },
    { key: 'effectiveDate', label: 'Effective Date', type: 'date', required: false, group: 'Authorization Details' },
    { key: 'expirationDate', label: 'Expiration Date', type: 'date', required: false, group: 'Authorization Details' },
    { key: 'authorizedItems', label: 'Authorized Items / Services', type: 'textarea', required: true, group: 'Authorization Details' },
    { key: 'hcpcsCode', label: 'HCPCS Code(s)', type: 'text', required: false, group: 'Authorization Details' },
    { key: 'authorizedQuantity', label: 'Authorized Quantity', type: 'text', required: false, group: 'Authorization Details' },
    { key: 'denialReason', label: 'Denial Reason (if applicable)', type: 'textarea', required: false, group: 'Authorization Details' },
    { key: 'orderingPhysician', label: 'Ordering Physician', type: 'text', required: false, group: 'Provider' },
    { key: 'npi', label: 'NPI', type: 'text', required: false, group: 'Provider' },
    { key: 'notes', label: 'Additional Notes', type: 'textarea', required: false, group: 'Notes' },
  ],
  systemPrompt: `You are a medical billing document extraction specialist for a Durable Medical Equipment (DME) supplier.

Your task: extract prior authorization details from the uploaded document.

Rules:
- Extract ONLY information explicitly stated in the document. Never guess or fabricate data.
- If a field is not present in the document, return null for that field.
- For dates, use YYYY-MM-DD format.
- Accurately capture authorization numbers, member IDs, and status.
- If the authorization was denied, extract the denial reason verbatim if available.
- Note all HCPCS codes and authorized quantities.
- Be precise — authorization numbers and policy IDs must be exact.`,
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const EXTRACTION_TEMPLATES: ExtractionTemplate[] = [
  GENERAL_ANALYSIS_TEMPLATE,
  PPD_TEMPLATE,
  CMN_TEMPLATE,
  PRIOR_AUTH_TEMPLATE,
];

export function getTemplateById(id: string): ExtractionTemplate | undefined {
  return EXTRACTION_TEMPLATES.find(t => t.id === id);
}

export function listTemplates(): Array<{ id: string; name: string; description: string; category: string; fieldCount: number }> {
  return EXTRACTION_TEMPLATES.map(t => ({
    id: t.id,
    name: t.name,
    description: t.description,
    category: t.category,
    fieldCount: t.fields.length,
  }));
}
