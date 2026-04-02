/**
 * Tests for ChatInterface pure utility functions.
 * These are extracted from ChatInterface.tsx and tested directly since they
 * don't depend on React state or rendering.
 */

import { describe, it, expect } from 'vitest';

// Re-implement the pure functions here since they're not exported from ChatInterface.
// These must match the implementations in ChatInterface.tsx exactly.

function stripConfidenceTag(text: string): string {
  return text.replace(/\[CONFIDENCE:\s*(?:HIGH|PARTIAL|LOW)\]\s*$/i, '').trimEnd();
}

function detectPotentialPhi(text: string): string[] {
  const detected: string[] = [];
  if (/\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/.test(text)) detected.push('SSN');
  if (/(?:\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/.test(text) && !detected.includes('SSN')) {
    if (/\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/.test(text)) detected.push('Phone number');
  }
  if (/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/.test(text)) detected.push('Email address');
  if (/(?:DOB|date\s+of\s+birth|born\s+on)[:\s]*\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4}/i.test(text)) detected.push('Date of birth');
  if (/(?:MRN|medical\s+record|patient\s+(?:id|number))[:\s#]*[A-Z0-9-]{4,}/i.test(text)) detected.push('Medical record number');
  return detected;
}

describe('stripConfidenceTag', () => {
  it('strips HIGH confidence tag from end of text', () => {
    expect(stripConfidenceTag('The answer is 42. [CONFIDENCE: HIGH]')).toBe('The answer is 42.');
  });

  it('strips PARTIAL confidence tag', () => {
    expect(stripConfidenceTag('Maybe this. [CONFIDENCE: PARTIAL]')).toBe('Maybe this.');
  });

  it('strips LOW confidence tag', () => {
    expect(stripConfidenceTag('Not sure. [CONFIDENCE: LOW]')).toBe('Not sure.');
  });

  it('is case-insensitive', () => {
    expect(stripConfidenceTag('Test [confidence: high]')).toBe('Test');
  });

  it('returns text unchanged if no tag present', () => {
    expect(stripConfidenceTag('Normal answer with no tag')).toBe('Normal answer with no tag');
  });

  it('only strips tag at the end, not in the middle', () => {
    expect(stripConfidenceTag('[CONFIDENCE: HIGH] The real answer')).toBe('[CONFIDENCE: HIGH] The real answer');
  });
});

describe('detectPotentialPhi', () => {
  it('detects SSN patterns', () => {
    expect(detectPotentialPhi('Patient SSN is 123-45-6789')).toContain('SSN');
    expect(detectPotentialPhi('SSN: 123456789')).toContain('SSN');
  });

  it('detects phone numbers', () => {
    expect(detectPotentialPhi('Call (555) 123-4567')).toContain('Phone number');
    expect(detectPotentialPhi('Phone: 555-123-4567')).toContain('Phone number');
  });

  it('does not double-report SSN as phone number', () => {
    const result = detectPotentialPhi('SSN 123-45-6789');
    expect(result).toContain('SSN');
    expect(result).not.toContain('Phone number');
  });

  it('detects email addresses', () => {
    expect(detectPotentialPhi('Email me at patient@hospital.com')).toContain('Email address');
  });

  it('detects DOB with keyword context', () => {
    expect(detectPotentialPhi('DOB: 01/15/1990')).toContain('Date of birth');
    expect(detectPotentialPhi('date of birth 3/5/1985')).toContain('Date of birth');
    expect(detectPotentialPhi('born on 12-25-2000')).toContain('Date of birth');
  });

  it('does not flag bare dates without keyword', () => {
    // A date alone (without DOB/born context) should not trigger
    expect(detectPotentialPhi('The policy was updated on 01/15/2024')).not.toContain('Date of birth');
  });

  it('detects MRN patterns', () => {
    expect(detectPotentialPhi('MRN: ABC-12345')).toContain('Medical record number');
    expect(detectPotentialPhi('Patient ID #MR-9876')).toContain('Medical record number');
  });

  it('returns empty array for clean queries', () => {
    expect(detectPotentialPhi('What are the CPAP coverage requirements?')).toEqual([]);
    expect(detectPotentialPhi('Tell me about HCPCS code K0813')).toEqual([]);
    expect(detectPotentialPhi('How do I set up oxygen therapy?')).toEqual([]);
  });

  it('detects multiple PHI types in one query', () => {
    const result = detectPotentialPhi('Patient email john@test.com DOB: 1/1/1980 MRN: ABC1234');
    expect(result).toContain('Email address');
    expect(result).toContain('Date of birth');
    expect(result).toContain('Medical record number');
  });
});
