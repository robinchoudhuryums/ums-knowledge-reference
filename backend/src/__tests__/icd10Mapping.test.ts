import { describe, it, expect } from 'vitest';
import {
  getHcpcsForDiagnosis,
  getDiagnosesForHcpcs,
  searchDiagnoses,
  listIcd10Categories,
} from '../services/icd10Mapping';

// ---------------------------------------------------------------------------
// getHcpcsForDiagnosis
// ---------------------------------------------------------------------------

describe('getHcpcsForDiagnosis', () => {
  it('returns mappings for a known ICD-10 code', () => {
    const results = getHcpcsForDiagnosis('J44.0');
    expect(results.length).toBeGreaterThan(0);
    results.forEach(r => {
      expect(r.icd10Code).toBe('J44.0');
    });
  });

  it('supports prefix matching (J44 matches J44.x codes)', () => {
    const results = getHcpcsForDiagnosis('J44');
    expect(results.length).toBeGreaterThan(0);
    // Should include mappings for J44.0, J44.1, J44.9
    const icd10Codes = [...new Set(results.map(r => r.icd10Code))];
    expect(icd10Codes.length).toBeGreaterThan(1);
    icd10Codes.forEach(code => {
      expect(code.startsWith('J44')).toBe(true);
    });
  });

  it('is case-insensitive', () => {
    const upper = getHcpcsForDiagnosis('J44.0');
    const lower = getHcpcsForDiagnosis('j44.0');
    expect(upper).toEqual(lower);
  });

  it('returns empty array for unknown code', () => {
    expect(getHcpcsForDiagnosis('Z99.99')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getDiagnosesForHcpcs
// ---------------------------------------------------------------------------

describe('getDiagnosesForHcpcs', () => {
  it('returns diagnoses for a known HCPCS code', () => {
    const results = getDiagnosesForHcpcs('E1390');
    expect(results.length).toBeGreaterThan(0);
    results.forEach(r => {
      expect(r.hcpcsCode).toBe('E1390');
    });
  });

  it('is case-insensitive', () => {
    const upper = getDiagnosesForHcpcs('E1390');
    const lower = getDiagnosesForHcpcs('e1390');
    expect(upper).toEqual(lower);
  });

  it('returns empty array for unknown HCPCS code', () => {
    expect(getDiagnosesForHcpcs('Z9999')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// searchDiagnoses
// ---------------------------------------------------------------------------

describe('searchDiagnoses', () => {
  it('returns empty array for empty query', () => {
    expect(searchDiagnoses('')).toEqual([]);
  });

  it('returns empty array for whitespace-only query', () => {
    expect(searchDiagnoses('   ')).toEqual([]);
  });

  it('finds results by keyword search', () => {
    const results = searchDiagnoses('sleep apnea');
    expect(results.length).toBeGreaterThan(0);
    results.forEach(r => {
      const combined = (r.description + ' ' + r.category).toLowerCase();
      expect(combined).toMatch(/sleep|apnea/);
    });
  });

  it('finds results by code prefix', () => {
    const results = searchDiagnoses('G47');
    expect(results.length).toBeGreaterThan(0);
    results.forEach(r => {
      expect(r.code.startsWith('G47')).toBe(true);
    });
  });

  it('returns at most 50 results', () => {
    // Broad search
    const results = searchDiagnoses('a');
    expect(results.length).toBeLessThanOrEqual(50);
  });
});

// ---------------------------------------------------------------------------
// listIcd10Categories
// ---------------------------------------------------------------------------

describe('listIcd10Categories', () => {
  it('returns sorted unique strings', () => {
    const categories = listIcd10Categories();
    expect(categories.length).toBeGreaterThan(0);
    // Check uniqueness
    expect(new Set(categories).size).toBe(categories.length);
    // Check sorted
    const sorted = [...categories].sort();
    expect(categories).toEqual(sorted);
  });

  it('includes known categories', () => {
    const categories = listIcd10Categories();
    expect(categories).toContain('COPD/Chronic Respiratory');
    expect(categories).toContain('Sleep Disorders');
    expect(categories).toContain('Neuromuscular');
  });
});
