import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockBedrockSend = vi.fn();
vi.mock('../config/aws', () => ({
  bedrockClient: { send: (...args: unknown[]) => mockBedrockSend(...args) },
  BEDROCK_EXTRACTION_MODEL: 'test-extraction-model',
}));

vi.mock('../services/textExtractor', () => ({
  extractText: vi.fn(),
}));

vi.mock('../utils/resilience', () => ({
  withRetry: vi.fn(async (fn: () => Promise<any>) => fn()),
  withTimeout: vi.fn(async (fn: () => Promise<any>) => fn()),
}));

vi.mock('../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { extractClinicalNotes } from '../services/clinicalNoteExtractor';
import { extractText } from '../services/textExtractor';

const mockExtractText = extractText as any;

function makeBedrockResponse(text: string) {
  return { body: new TextEncoder().encode(JSON.stringify({ content: [{ text }] })) };
}

const VALID_CLINICAL_RESPONSE = JSON.stringify({
  patientName: 'Jane Smith',
  patientDob: '1960-05-15',
  primaryDiagnosis: 'COPD',
  icdCodes: ['J44.1 - COPD with acute exacerbation'],
  testResults: [{ testName: 'SpO2', result: '88%', date: '2024-01-10', unit: '%' }],
  vitalSigns: { height: '68 inches', weight: '165 lbs' },
  medicalNecessityLanguage: 'Patient requires supplemental oxygen',
  previousTreatments: [],
  functionalLimitations: ['Limited mobility'],
  prognosis: 'Stable',
  equipmentRecommended: 'Portable oxygen concentrator',
  hcpcsCodes: ['E1390'],
  lengthOfNeed: '12 months',
  physicianName: 'Dr. Smith',
  physicianNpi: '1234567890',
  encounterDate: '2024-01-10',
  secondaryDiagnoses: [],
  patientAddress: null,
  patientPhone: null,
  memberId: null,
}) + '\nCONFIDENCE: high\nNOTES: Complete extraction from clinical notes.';

describe('extractClinicalNotes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws when text is too short', async () => {
    mockExtractText.mockResolvedValue({ text: 'Too short' });
    await expect(
      extractClinicalNotes(Buffer.from('data'), 'notes.pdf', 'application/pdf'),
    ).rejects.toThrow('Could not extract sufficient text');
  });

  it('returns structured ClinicalExtraction on success', async () => {
    mockExtractText.mockResolvedValue({ text: 'A'.repeat(100) });
    mockBedrockSend.mockResolvedValue(makeBedrockResponse(VALID_CLINICAL_RESPONSE));

    const result = await extractClinicalNotes(Buffer.from('data'), 'notes.pdf', 'application/pdf');

    expect(result.extraction.patientName).toBe('Jane Smith');
    expect(result.extraction.patientDob).toBe('1960-05-15');
    expect(result.extraction.primaryDiagnosis).toBe('COPD');
    expect(result.extraction.icdCodes).toEqual(['J44.1 - COPD with acute exacerbation']);
    expect(result.extraction.testResults).toHaveLength(1);
    expect(result.extraction.testResults[0].testName).toBe('SpO2');
    expect(result.extraction.equipmentRecommended).toBe('Portable oxygen concentrator');
    expect(result.extraction.hcpcsCodes).toEqual(['E1390']);
    expect(result.extraction.confidence).toBe('high');
    expect(result.extraction.modelUsed).toBe('test-extraction-model');
  });

  it('flags invalid ICD-10 codes in extraction notes', async () => {
    mockExtractText.mockResolvedValue({ text: 'A'.repeat(100) });

    const responseWithBadCodes = JSON.stringify({
      patientName: 'Test Patient',
      patientDob: null,
      primaryDiagnosis: 'Some condition',
      icdCodes: ['INVALID_CODE - Bad format', 'J44.1 - COPD'],
      testResults: [],
      vitalSigns: {},
      medicalNecessityLanguage: null,
      previousTreatments: [],
      functionalLimitations: [],
      prognosis: null,
      equipmentRecommended: null,
      hcpcsCodes: [],
      lengthOfNeed: null,
      physicianName: null,
      physicianNpi: null,
      encounterDate: null,
      secondaryDiagnoses: [],
      patientAddress: null,
      patientPhone: null,
      memberId: null,
    }) + '\nCONFIDENCE: medium\nNOTES: Partial extraction.';

    mockBedrockSend.mockResolvedValue(makeBedrockResponse(responseWithBadCodes));

    const result = await extractClinicalNotes(Buffer.from('data'), 'notes.pdf', 'application/pdf');

    expect(result.extraction.extractionNotes).toContain('ICD-10 validation');
    expect(result.extraction.extractionNotes).toContain('INVALID_CODE');
    // J44.1 is valid so should NOT be flagged — only INVALID_CODE should appear as a flagged code
    expect(result.extraction.extractionNotes).not.toContain('"J44.1" does not match ICD-10 format');
  });

  it('accepts valid ICD-10 codes without adding warnings', async () => {
    mockExtractText.mockResolvedValue({ text: 'A'.repeat(100) });

    const responseWithValidCodes = JSON.stringify({
      patientName: 'Test Patient',
      patientDob: null,
      primaryDiagnosis: 'Diabetes',
      icdCodes: ['J44.1 - COPD', 'E11 - Type 2 diabetes'],
      testResults: [],
      vitalSigns: {},
      medicalNecessityLanguage: null,
      previousTreatments: [],
      functionalLimitations: [],
      prognosis: null,
      equipmentRecommended: null,
      hcpcsCodes: [],
      lengthOfNeed: null,
      physicianName: null,
      physicianNpi: null,
      encounterDate: null,
      secondaryDiagnoses: [],
      patientAddress: null,
      patientPhone: null,
      memberId: null,
    }) + '\nCONFIDENCE: high\nNOTES: All codes valid.';

    mockBedrockSend.mockResolvedValue(makeBedrockResponse(responseWithValidCodes));

    const result = await extractClinicalNotes(Buffer.from('data'), 'notes.pdf', 'application/pdf');

    // extractionNotes should NOT contain ICD-10 validation warnings
    expect(result.extraction.extractionNotes).not.toContain('ICD-10 validation');
    expect(result.extraction.extractionNotes).toBe('All codes valid.');
  });

  it('generates field mappings from extraction', async () => {
    mockExtractText.mockResolvedValue({ text: 'A'.repeat(100) });
    mockBedrockSend.mockResolvedValue(makeBedrockResponse(VALID_CLINICAL_RESPONSE));

    const result = await extractClinicalNotes(Buffer.from('data'), 'notes.pdf', 'application/pdf');

    expect(result.fieldMappings.length).toBeGreaterThan(0);

    const nameMapping = result.fieldMappings.find(m => m.fieldName === 'Patient Name');
    expect(nameMapping).toBeDefined();
    expect(nameMapping!.suggestedValue).toBe('Jane Smith');

    const icdMapping = result.fieldMappings.find(m => m.fieldName === 'ICD-10 Code(s)');
    expect(icdMapping).toBeDefined();
    expect(icdMapping!.suggestedValue).toContain('J44.1');

    const equipMapping = result.fieldMappings.find(m => m.fieldName === 'Equipment Description');
    expect(equipMapping).toBeDefined();
    expect(equipMapping!.suggestedValue).toBe('Portable oxygen concentrator');

    const physicianMapping = result.fieldMappings.find(m => m.fieldName === 'Physician Name');
    expect(physicianMapping).toBeDefined();
    expect(physicianMapping!.suggestedValue).toBe('Dr. Smith');
  });

  it('handles malformed JSON response gracefully with low confidence', async () => {
    mockExtractText.mockResolvedValue({ text: 'A'.repeat(100) });
    mockBedrockSend.mockResolvedValue(
      makeBedrockResponse('This response contains no valid JSON whatsoever and no curly braces either.'),
    );

    const result = await extractClinicalNotes(Buffer.from('data'), 'notes.pdf', 'application/pdf');

    expect(result.extraction.confidence).toBe('low');
    expect(result.extraction.patientName).toBeNull();
    expect(result.extraction.icdCodes).toEqual([]);
    expect(result.extraction.testResults).toEqual([]);
  });
});
