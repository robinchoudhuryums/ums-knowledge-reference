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

import { extractDocumentData } from '../services/documentExtractor';
import { extractText } from '../services/textExtractor';

const mockExtractText = extractText as any;

function makeBedrockResponse(text: string) {
  return { body: new TextEncoder().encode(JSON.stringify({ content: [{ text }] })) };
}

describe('extractDocumentData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws for unknown template ID', async () => {
    await expect(
      extractDocumentData(Buffer.from('test'), 'test.pdf', 'application/pdf', 'nonexistent-template'),
    ).rejects.toThrow('Unknown extraction template: nonexistent-template');
  });

  it('throws when extracted text is too short', async () => {
    mockExtractText.mockResolvedValue({ text: 'Short' });
    await expect(
      extractDocumentData(Buffer.from('data'), 'test.pdf', 'application/pdf', 'ppd'),
    ).rejects.toThrow('Could not extract sufficient text');
  });

  it('returns correct ExtractionResult for valid JSON response', async () => {
    const documentText = 'Patient John Doe was delivered a portable oxygen concentrator on January 15 2024. Delivered by UMS technician.';
    mockExtractText.mockResolvedValue({ text: documentText });

    const responseJson = JSON.stringify({
      patientName: 'John Doe',
      deliveryDate: '2024-01-15',
      patientDob: null,
      patientId: null,
      patientAddress: null,
      patientPhone: null,
      equipmentDescription: 'Portable oxygen concentrator',
      hcpcsCode: null,
      serialNumber: null,
      quantity: null,
      deliveryMethod: null,
      deliveredBy: 'UMS technician',
      receivedBy: null,
      deliveryAddress: null,
      orderingPhysician: null,
      npi: null,
      referringProvider: null,
      insuranceName: null,
      policyNumber: null,
      authorizationNumber: null,
      notes: null,
      discrepancies: null,
    });

    mockBedrockSend.mockResolvedValue(
      makeBedrockResponse(responseJson + '\nCONFIDENCE: high\nNOTES: Complete extraction.'),
    );

    const result = await extractDocumentData(Buffer.from('data'), 'test.pdf', 'application/pdf', 'ppd');

    expect(result.templateId).toBe('ppd');
    expect(result.templateName).toBe('Proof of Prior Delivery (PPD)');
    expect(result.data.patientName).toBe('John Doe');
    expect(result.data.deliveryDate).toBe('2024-01-15');
    expect(result.confidence).toBe('high');
    expect(result.extractionNotes).toBe('Complete extraction.');
    expect(result.modelUsed).toBe('test-extraction-model');
  });

  it('parses CONFIDENCE and NOTES from response', async () => {
    mockExtractText.mockResolvedValue({ text: 'A'.repeat(100) });

    const responseJson = JSON.stringify({ patientName: 'Test' });
    mockBedrockSend.mockResolvedValue(
      makeBedrockResponse(responseJson + '\nCONFIDENCE: medium\nNOTES: Some fields were missing from the document.'),
    );

    const result = await extractDocumentData(Buffer.from('data'), 'test.pdf', 'application/pdf', 'ppd');

    expect(result.confidence).toBe('medium');
    expect(result.extractionNotes).toBe('Some fields were missing from the document.');
  });

  it('handles markdown-fenced JSON in response', async () => {
    mockExtractText.mockResolvedValue({ text: 'A'.repeat(100) });

    const fencedResponse = '```json\n{"patientName": "Jane Smith", "deliveryDate": "2024-03-01"}\n```\nCONFIDENCE: high\nNOTES: Extracted successfully.';
    mockBedrockSend.mockResolvedValue(makeBedrockResponse(fencedResponse));

    const result = await extractDocumentData(Buffer.from('data'), 'test.pdf', 'application/pdf', 'ppd');

    expect(result.data.patientName).toBe('Jane Smith');
    expect(result.data.deliveryDate).toBe('2024-03-01');
    expect(result.confidence).toBe('high');
  });

  it('returns low confidence when JSON parsing fails completely', async () => {
    mockExtractText.mockResolvedValue({ text: 'A'.repeat(100) });

    mockBedrockSend.mockResolvedValue(
      makeBedrockResponse('This is not JSON at all. Just random text with no braces.'),
    );

    const result = await extractDocumentData(Buffer.from('data'), 'test.pdf', 'application/pdf', 'ppd');

    expect(result.confidence).toBe('low');
    expect(result.extractionNotes).toContain('did not return parseable JSON');
    // All fields should be null
    expect(result.data.patientName).toBeNull();
    expect(result.data.deliveryDate).toBeNull();
  });
});
