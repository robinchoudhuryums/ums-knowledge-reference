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
  name: 'Patient Provided Data (PPD) — Seating Evaluation',
  description: 'Extract Patient Provided Data from clinical notes to pre-fill a Seating Evaluation for Power Mobility Device orders. The PPD is a phone questionnaire covering MRADLs, extremity strength, pain, and medical history.',
  category: 'clinical',
  fields: [
    // Patient Information
    { key: 'patientName', label: 'Patient Name & Trx#', type: 'text', required: true, group: 'Patient Information' },
    { key: 'patientDob', label: 'Date of Birth', type: 'date', required: false, group: 'Patient Information' },
    { key: 'patientPhone', label: 'Patient Phone', type: 'text', required: false, group: 'Patient Information' },
    { key: 'heightInches', label: 'Height (inches)', type: 'number', required: false, group: 'Patient Information' },
    { key: 'weightLbs', label: 'Weight (lbs)', type: 'number', required: false, group: 'Patient Information' },
    { key: 'livingSituation', label: 'Living Situation', type: 'select', required: false, options: ['Lives alone', 'Lives with family/friends', 'Assisted living', 'Not specified'], group: 'Patient Information' },
    { key: 'homeHealthAttendant', label: 'Home Health Attendant?', type: 'boolean', required: false, group: 'Patient Information' },
    // Current Mobility
    { key: 'currentMobilityDevice', label: 'Current Mobility Device(s)', type: 'textarea', required: false, group: 'Current Mobility', description: 'Cane, walker, manual wheelchair, scooter, PWC, etc.' },
    // MRADLs
    { key: 'mradlToileting', label: 'Toileting ability', type: 'textarea', required: false, group: 'MRADLs (Mobility-Related ADLs)' },
    { key: 'mradlMealPrep', label: 'Meal preparation ability', type: 'textarea', required: false, group: 'MRADLs (Mobility-Related ADLs)' },
    { key: 'mradlDressing', label: 'Dressing ability', type: 'textarea', required: false, group: 'MRADLs (Mobility-Related ADLs)' },
    { key: 'mradlGrooming', label: 'Grooming ability', type: 'textarea', required: false, group: 'MRADLs (Mobility-Related ADLs)' },
    { key: 'mradlBathing', label: 'Bathing ability', type: 'textarea', required: false, group: 'MRADLs (Mobility-Related ADLs)' },
    // Extremity Strength
    { key: 'armMovement', label: 'Can move both arms?', type: 'select', required: false, options: ['Yes', 'No', 'Limited', 'Not specified'], group: 'Extremity Strength' },
    { key: 'armRaiseFront', label: 'Can raise arms straight out front (pointing)?', type: 'select', required: false, options: ['Yes', 'No', 'Limited', 'Not specified'], group: 'Extremity Strength' },
    { key: 'armRaiseAbove', label: 'Can raise hands above head?', type: 'select', required: false, options: ['Yes', 'No', 'Limited', 'Not specified'], group: 'Extremity Strength' },
    { key: 'legMovement', label: 'Can move legs?', type: 'select', required: false, options: ['Yes', 'No', 'Limited', 'Not specified'], group: 'Extremity Strength' },
    { key: 'legExtension', label: 'Can extend legs straight while sitting?', type: 'select', required: false, options: ['Yes', 'No', 'Limited', 'Not specified'], group: 'Extremity Strength' },
    { key: 'footStrength', label: 'Can push door open with feet?', type: 'select', required: false, options: ['Yes', 'No', 'Not specified'], group: 'Extremity Strength' },
    // Falls / Dizziness
    { key: 'fallHistory', label: 'Falls/near-falls/dizziness in past 6 months?', type: 'textarea', required: false, group: 'Falls & Safety' },
    // Pain
    { key: 'painNeck', label: 'Neck pain?', type: 'boolean', required: false, group: 'Consistent Pain' },
    { key: 'painShoulder', label: 'Shoulder pain?', type: 'boolean', required: false, group: 'Consistent Pain' },
    { key: 'painElbows', label: 'Elbow pain?', type: 'boolean', required: false, group: 'Consistent Pain' },
    { key: 'painArms', label: 'Arm pain?', type: 'boolean', required: false, group: 'Consistent Pain' },
    { key: 'painHands', label: 'Hand pain?', type: 'boolean', required: false, group: 'Consistent Pain' },
    { key: 'painBack', label: 'Back pain?', type: 'boolean', required: false, group: 'Consistent Pain' },
    { key: 'painHips', label: 'Hip pain?', type: 'boolean', required: false, group: 'Consistent Pain' },
    { key: 'painKnees', label: 'Knee pain?', type: 'boolean', required: false, group: 'Consistent Pain' },
    { key: 'painLegs', label: 'Leg pain?', type: 'boolean', required: false, group: 'Consistent Pain' },
    { key: 'painAnkles', label: 'Ankle pain?', type: 'boolean', required: false, group: 'Consistent Pain' },
    // Additional Medical Info
    { key: 'painMedications', label: 'Takes pain medications?', type: 'textarea', required: false, group: 'Additional Medical Info' },
    { key: 'numbnessTingling', label: 'Numbness/tingling in hands, feet, or legs?', type: 'textarea', required: false, group: 'Additional Medical Info' },
    { key: 'nutritionalSupplements', label: 'Uses Ensure/Boost/supplements?', type: 'boolean', required: false, group: 'Additional Medical Info' },
    { key: 'incontinenceSupplies', label: 'Needs incontinence supplies?', type: 'boolean', required: false, group: 'Additional Medical Info' },
    { key: 'diabetes', label: 'Has diabetes?', type: 'boolean', required: false, group: 'Additional Medical Info' },
    { key: 'peripheralVascularDisease', label: 'Peripheral vascular disease?', type: 'boolean', required: false, group: 'Additional Medical Info' },
    { key: 'intermittentCatheters', label: 'Uses intermittent catheters?', type: 'boolean', required: false, group: 'Additional Medical Info' },
    { key: 'strokeHistory', label: 'History of stroke?', type: 'boolean', required: false, group: 'Additional Medical Info' },
    { key: 'strokeWeaknessParalysis', label: 'Stroke resulted in weakness/paralysis?', type: 'textarea', required: false, group: 'Additional Medical Info', description: 'If yes, which side and type' },
    { key: 'spasticity', label: 'Has spasticity?', type: 'boolean', required: false, group: 'Additional Medical Info' },
    { key: 'pressureUlcerHistory', label: 'History of pressure ulcers?', type: 'textarea', required: false, group: 'Additional Medical Info', description: 'Location and sensation status' },
    { key: 'amputations', label: 'Any amputations?', type: 'textarea', required: false, group: 'Additional Medical Info', description: 'Location, above or below knee' },
    { key: 'spinalCurvature', label: 'Spinal curvature (scoliosis, kyphosis)?', type: 'boolean', required: false, group: 'Additional Medical Info' },
    { key: 'swellingEdema', label: 'Swelling in feet/ankles/legs?', type: 'boolean', required: false, group: 'Additional Medical Info' },
    { key: 'oxygenUse', label: 'On oxygen?', type: 'boolean', required: false, group: 'Additional Medical Info' },
    { key: 'arthritis', label: 'Arthritis?', type: 'textarea', required: false, group: 'Additional Medical Info', description: 'Type (Rheumatoid, Osteo, Psoriatic) and location' },
    // Diagnoses
    { key: 'qualifyingDiagnoses', label: 'Qualifying diagnoses for PWC', type: 'textarea', required: false, group: 'Diagnoses' },
    { key: 'heartLungConditions', label: 'Heart or lung conditions', type: 'textarea', required: false, group: 'Diagnoses' },
    { key: 'neurologicalConditions', label: 'Neurological conditions', type: 'textarea', required: false, group: 'Diagnoses' },
    // Notes
    { key: 'notes', label: 'Additional Notes', type: 'textarea', required: false, group: 'Notes' },
  ],
  systemPrompt: `You are a medical document data extraction specialist for a Durable Medical Equipment (DME) supplier.

Your task: extract Patient Provided Data (PPD) from uploaded clinical notes, physician evaluations, or patient interview records. PPD is used to pre-fill a Seating Evaluation for Power Mobility Device (PMD/PWC) orders.

The PPD questionnaire covers:
1. MRADLs (Mobility-Related Activities of Daily Living): toileting, meal prep, dressing, grooming, bathing
2. Extremity Strength: arm movement/raising, leg movement/extension, foot strength
3. Falls/dizziness history
4. Consistent pain by body area (neck, shoulders, elbows, arms, hands, back, hips, knees, legs, ankles)
5. Medical history: pain medications, numbness/tingling, diabetes, PVD, catheter use, stroke history, spasticity, pressure ulcers, amputations, spinal curvature, edema, oxygen use, arthritis
6. Qualifying diagnoses, heart/lung conditions, neurological conditions
7. Physical measurements: height, weight

Rules:
- Extract ONLY information explicitly stated in the document. Never guess or fabricate data.
- If a field is not present in the document, return null for that field.
- For dates, use YYYY-MM-DD format.
- For yes/no boolean fields, return true, false, or null (if not mentioned).
- For pain areas, set to true only if the document explicitly mentions pain in that area.
- For MRADLs, describe the patient's ability level based on what the notes say.
- Include all ICD-10 codes found in the qualifying diagnoses field.
- Be precise with clinical details — copy diagnoses and measurements exactly as stated.`,
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
