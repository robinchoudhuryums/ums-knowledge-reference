/**
 * Clinical Note Extractor — uses Claude (Bedrock) to extract structured
 * clinical data from physician notes, face-to-face encounter notes, etc.
 *
 * Extracts: diagnosis codes, test results, medical necessity language,
 * physician info, and maps them to CMN / prior-auth field requirements.
 *
 * Uses the extraction model (Sonnet) for accuracy.
 */

import { InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { bedrockClient, BEDROCK_EXTRACTION_MODEL } from '../config/aws';
import { extractText } from './textExtractor';
import { logger } from '../utils/logger';
import { withRetry, withTimeout } from '../utils/resilience';

export interface ClinicalExtraction {
  // Patient
  patientName: string | null;
  patientDob: string | null;
  patientAddress: string | null;
  patientPhone: string | null;
  memberId: string | null;

  // Diagnosis
  primaryDiagnosis: string | null;
  icdCodes: string[];
  secondaryDiagnoses: string[];

  // Clinical findings
  testResults: Array<{
    testName: string;
    result: string;
    date: string | null;
    unit: string | null;
  }>;
  vitalSigns: Record<string, string>;

  // Medical necessity
  medicalNecessityLanguage: string | null;
  previousTreatments: string[];
  functionalLimitations: string[];
  prognosis: string | null;

  // Equipment / order
  equipmentRecommended: string | null;
  hcpcsCodes: string[];
  lengthOfNeed: string | null;

  // Physician
  physicianName: string | null;
  physicianNpi: string | null;
  encounterDate: string | null;

  // Metadata
  confidence: 'high' | 'medium' | 'low';
  extractionNotes: string;
  modelUsed: string;
}

export interface CmnFieldMapping {
  /** The CMN/form field name */
  fieldName: string;
  /** The extracted value to fill */
  suggestedValue: string;
  /** Where in the clinical note this was found */
  sourceContext: string;
  /** How confident the mapping is */
  confidence: 'high' | 'medium' | 'low';
}

export interface ClinicalExtractionResult {
  extraction: ClinicalExtraction;
  /** Direct mappings to CMN / prior-auth form fields */
  fieldMappings: CmnFieldMapping[];
}

const SYSTEM_PROMPT = `You are a clinical documentation specialist for a Durable Medical Equipment (DME) supplier.

Your task: extract structured clinical data from physician notes, face-to-face encounter notes, progress notes, or other clinical documentation. The extracted data will be used to pre-populate CMN (Certificate of Medical Necessity) forms and prior authorization requests.

CRITICAL RULES:
- Extract ONLY information explicitly stated in the document. NEVER fabricate, infer, or guess clinical data.
- If a field is not present, use null.
- For ICD-10 codes, include the code AND the description if available.
- For test results (ABG, SpO2, pulmonary function, etc.), capture the test name, result value, units, and date.
- For medical necessity language, quote or closely paraphrase the physician's actual words.
- For functional limitations, use the physician's documented language.
- Dates should be in YYYY-MM-DD format.
- This is for DME documentation — focus on information relevant to equipment orders: diagnoses, functional status, test results, and medical justification.`;

const USER_PROMPT_TEMPLATE = `Extract clinical data from the following document. Return a JSON object with this structure:

{
  "patientName": string | null,
  "patientDob": "YYYY-MM-DD" | null,
  "patientAddress": string | null,
  "patientPhone": string | null,
  "memberId": string | null,
  "primaryDiagnosis": string | null,
  "icdCodes": ["code - description", ...],
  "secondaryDiagnoses": ["diagnosis text", ...],
  "testResults": [{"testName": string, "result": string, "date": "YYYY-MM-DD" | null, "unit": string | null}, ...],
  "vitalSigns": {"height": "...", "weight": "...", "bmi": "...", ...},
  "medicalNecessityLanguage": "exact or close quote from physician" | null,
  "previousTreatments": ["treatment description", ...],
  "functionalLimitations": ["limitation description", ...],
  "prognosis": string | null,
  "equipmentRecommended": string | null,
  "hcpcsCodes": ["E1390", ...],
  "lengthOfNeed": string | null,
  "physicianName": string | null,
  "physicianNpi": string | null,
  "encounterDate": "YYYY-MM-DD" | null
}

IMPORTANT:
- Return ONLY a valid JSON object, no markdown fences.
- After the JSON, on a new line write "CONFIDENCE:" followed by high/medium/low.
- On another line write "NOTES:" followed by observations about data quality or missing items.

DOCUMENT TEXT:
---
DOCUMENT_TEXT_PLACEHOLDER
---

Extract now.`;

/**
 * Extract clinical data from a document and produce CMN field mappings.
 */
export async function extractClinicalNotes(
  fileBuffer: Buffer,
  filename: string,
  mimeType: string,
): Promise<ClinicalExtractionResult> {
  logger.info('Starting clinical note extraction', { filename, mimeType });

  // Step 1: Extract text
  const { text } = await extractText(fileBuffer, mimeType, filename);

  if (!text || text.trim().length < 30) {
    throw new Error('Could not extract sufficient text from the document. Try a clearer scan or text-based PDF.');
  }

  logger.info('Text extracted for clinical analysis', { filename, textLength: text.length });

  // Step 2: Call Bedrock
  const userPrompt = USER_PROMPT_TEMPLATE.replace(
    'DOCUMENT_TEXT_PLACEHOLDER',
    text.substring(0, 80000),
  );

  // Use prompt caching: the clinical system prompt is identical across all extractions.
  const command = new InvokeModelCommand({
    modelId: BEDROCK_EXTRACTION_MODEL,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 8192,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userPrompt }],
      temperature: 0.05,
    }),
  });

  let responseText: string;
  try {
    const response = await withRetry(
      () => withTimeout(
        () => bedrockClient.send(command),
        60000,
        'Bedrock clinical extraction',
      ),
      { maxRetries: 3, baseDelayMs: 1000, label: 'Bedrock clinical extraction' },
    );
    const body = JSON.parse(new TextDecoder().decode(response.body));
    responseText = body.content?.[0]?.text || '';
  } catch (error: any) {
    logger.error('Bedrock clinical extraction failed', { error: error.message });
    throw new Error(`Clinical extraction model call failed: ${error.message}`);
  }

  // Step 3: Parse response
  const extraction = parseClinicalResponse(responseText);

  // Step 4: Generate CMN field mappings
  const fieldMappings = generateFieldMappings(extraction);

  // Step 5: Validate ICD-10 codes
  const validationWarnings = validateIcd10Codes(extraction.icdCodes);
  if (validationWarnings.length > 0) {
    extraction.extractionNotes += (extraction.extractionNotes ? '\n' : '') +
      `ICD-10 validation: ${validationWarnings.join('; ')}`;
  }

  logger.info('Clinical note extraction complete', {
    filename,
    confidence: extraction.confidence,
    icdCodesFound: extraction.icdCodes.length,
    icd10Warnings: validationWarnings.length,
    testResultsFound: extraction.testResults.length,
    mappingsGenerated: fieldMappings.length,
  });

  return { extraction, fieldMappings };
}

/**
 * Validate ICD-10 code format. Valid codes match: A00-Z99 followed by optional .0-9A-Z{1,4}.
 * Returns an array of warning messages for invalid codes.
 * Does not reject — just flags for human review.
 */
function validateIcd10Codes(codes: string[]): string[] {
  const warnings: string[] = [];
  // ICD-10-CM pattern: letter + 2 digits, optionally followed by . and 1-4 alphanumeric chars
  const icd10Pattern = /^[A-Z]\d{2}(\.[A-Z0-9]{1,4})?$/i;

  for (const codeEntry of codes) {
    // Extract just the code part (before " - description" if present)
    const codePart = codeEntry.split(/\s*[-–—]\s*/)[0].trim();
    if (!codePart) continue;

    if (!icd10Pattern.test(codePart)) {
      warnings.push(`"${codePart}" does not match ICD-10 format (expected: letter + 2 digits, e.g., J44.1)`);
    }
  }

  return warnings;
}

function parseClinicalResponse(response: string): ClinicalExtraction {
  let jsonStr = response;
  let confidence: 'high' | 'medium' | 'low' = 'medium';
  let notes = '';

  // Extract CONFIDENCE and NOTES
  const confMatch = response.match(/\nCONFIDENCE:\s*(high|medium|low)/i);
  if (confMatch) {
    confidence = confMatch[1].toLowerCase() as 'high' | 'medium' | 'low';
    jsonStr = response.substring(0, confMatch.index!);
  }

  const notesMatch = response.match(/\nNOTES:\s*(.+)/is);
  if (notesMatch) {
    notes = notesMatch[1].trim();
  }

  // Strip markdown fences
  jsonStr = jsonStr.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

  let data: Record<string, any>;
  try {
    data = JSON.parse(jsonStr);
  } catch {
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        data = JSON.parse(jsonMatch[0]);
      } catch {
        logger.error('Failed to parse clinical extraction JSON');
        data = {};
        confidence = 'low';
        notes = 'Failed to parse model response. Please try again.';
      }
    } else {
      data = {};
      confidence = 'low';
      notes = 'Model did not return parseable JSON.';
    }
  }

  return {
    patientName: data.patientName || null,
    patientDob: data.patientDob || null,
    patientAddress: data.patientAddress || null,
    patientPhone: data.patientPhone || null,
    memberId: data.memberId || null,
    primaryDiagnosis: data.primaryDiagnosis || null,
    icdCodes: Array.isArray(data.icdCodes) ? data.icdCodes : [],
    secondaryDiagnoses: Array.isArray(data.secondaryDiagnoses) ? data.secondaryDiagnoses : [],
    testResults: Array.isArray(data.testResults) ? data.testResults : [],
    vitalSigns: data.vitalSigns && typeof data.vitalSigns === 'object' ? data.vitalSigns : {},
    medicalNecessityLanguage: data.medicalNecessityLanguage || null,
    previousTreatments: Array.isArray(data.previousTreatments) ? data.previousTreatments : [],
    functionalLimitations: Array.isArray(data.functionalLimitations) ? data.functionalLimitations : [],
    prognosis: data.prognosis || null,
    equipmentRecommended: data.equipmentRecommended || null,
    hcpcsCodes: Array.isArray(data.hcpcsCodes) ? data.hcpcsCodes : [],
    lengthOfNeed: data.lengthOfNeed || null,
    physicianName: data.physicianName || null,
    physicianNpi: data.physicianNpi || null,
    encounterDate: data.encounterDate || null,
    confidence,
    extractionNotes: notes,
    modelUsed: BEDROCK_EXTRACTION_MODEL,
  };
}

/**
 * Map extracted clinical data to CMN / prior-auth form fields.
 */
function generateFieldMappings(ext: ClinicalExtraction): CmnFieldMapping[] {
  const mappings: CmnFieldMapping[] = [];

  const add = (fieldName: string, value: string | null, sourceContext: string, conf: 'high' | 'medium' | 'low' = 'high') => {
    if (value) {
      mappings.push({ fieldName, suggestedValue: value, sourceContext, confidence: conf });
    }
  };

  // Patient demographics
  add('Patient Name', ext.patientName, 'Patient information');
  add('Date of Birth', ext.patientDob, 'Patient information');
  add('Patient Address', ext.patientAddress, 'Patient information');
  add('Phone Number', ext.patientPhone, 'Patient information');
  add('Medicare ID (HICN/MBI)', ext.memberId, 'Patient/member ID');

  // Clinical
  add('Diagnosis Code', ext.primaryDiagnosis, 'Primary diagnosis');
  if (ext.icdCodes.length > 0) {
    add('ICD-10 Code(s)', ext.icdCodes.join(', '), 'Diagnosis codes');
  }
  add('Medical Necessity Justification', ext.medicalNecessityLanguage, 'Physician medical necessity statement');

  // Test results — map specific ones to CMN fields
  for (const test of ext.testResults) {
    const name = test.testName.toLowerCase();
    if (name.includes('spo2') || name.includes('oxygen sat') || name.includes('o2 sat')) {
      add('Oxygen Saturation (SpO2)', `${test.result}${test.unit ? ` ${test.unit}` : ''}`, `Test: ${test.testName}`, 'high');
    }
    if (name.includes('abg') || name.includes('blood gas') || name.includes('pao2') || name.includes('po2')) {
      add('Blood Gas Results (ABG/PaO2)', `${test.result}${test.unit ? ` ${test.unit}` : ''}`, `Test: ${test.testName}`, 'high');
    }
    if (name.includes('flow') || name.includes('lpm') || name.includes('liter')) {
      add('Liter Flow Rate', `${test.result}${test.unit ? ` ${test.unit}` : ''}`, `Test: ${test.testName}`, 'high');
    }
    if (test.date) {
      add('Test Date', test.date, `Date of ${test.testName}`);
    }
  }

  // Vitals for POV/wheelchair CMN
  if (ext.vitalSigns.height) {
    add('Patient Height', ext.vitalSigns.height, 'Vital signs');
  }
  if (ext.vitalSigns.weight) {
    add('Patient Weight', ext.vitalSigns.weight, 'Vital signs');
  }

  // Functional limitations (for POV/wheelchair justification)
  if (ext.functionalLimitations.length > 0) {
    add('Functional Limitations', ext.functionalLimitations.join('; '), 'Clinical assessment', 'medium');
  }

  // Previous treatments
  if (ext.previousTreatments.length > 0) {
    add('Previous Treatment / Alternatives Tried', ext.previousTreatments.join('; '), 'Treatment history', 'medium');
  }

  // Equipment
  add('Equipment Description', ext.equipmentRecommended, 'Physician recommendation');
  if (ext.hcpcsCodes.length > 0) {
    add('HCPCS Code', ext.hcpcsCodes.join(', '), 'Procedure codes');
  }
  add('Length of Need', ext.lengthOfNeed, 'Duration of need');

  // Physician
  add('Physician Name', ext.physicianName, 'Provider information');
  add('NPI Number', ext.physicianNpi, 'Provider information');
  add('Encounter Date', ext.encounterDate, 'Visit date');
  add('Prognosis', ext.prognosis, 'Clinical prognosis', 'medium');

  return mappings;
}
