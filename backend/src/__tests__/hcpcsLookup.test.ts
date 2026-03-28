import { describe, it, expect } from 'vitest';
import {
  searchHcpcs,
  getHcpcsCode,
  getHcpcsByCategory,
  listCategories,
} from '../services/hcpcsLookup';

// ---------------------------------------------------------------------------
// searchHcpcs
// ---------------------------------------------------------------------------

describe('searchHcpcs', () => {
  it('returns empty array for empty query', () => {
    expect(searchHcpcs('')).toEqual([]);
  });

  it('returns empty array for whitespace-only query', () => {
    expect(searchHcpcs('   ')).toEqual([]);
  });

  it('exact code match scores highest (first result)', () => {
    const results = searchHcpcs('E0601');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].code).toBe('E0601');
  });

  it('partial code match returns results', () => {
    const results = searchHcpcs('K082');
    expect(results.length).toBeGreaterThan(0);
    // All results should have codes starting with K082
    expect(results.some(r => r.code.startsWith('K082'))).toBe(true);
  });

  it('description search finds matching codes', () => {
    const results = searchHcpcs('oxygen concentrator');
    expect(results.length).toBeGreaterThan(0);
    // Should find E1390 (O2 concentrator)
    expect(results.some(r => r.code === 'E1390')).toBe(true);
  });

  it('multi-term search narrows results', () => {
    const results = searchHcpcs('heavy duty wheelchair');
    expect(results.length).toBeGreaterThan(0);
    expect(results.some(r =>
      r.longDescription.toLowerCase().includes('heavy duty') &&
      r.longDescription.toLowerCase().includes('wheelchair')
    )).toBe(true);
  });

  it('returns at most 50 results', () => {
    // A very broad search term that could match many entries
    const results = searchHcpcs('e');
    expect(results.length).toBeLessThanOrEqual(50);
  });
});

// ---------------------------------------------------------------------------
// getHcpcsCode
// ---------------------------------------------------------------------------

describe('getHcpcsCode', () => {
  it('returns exact match (case-insensitive)', () => {
    const result = getHcpcsCode('e0601');
    expect(result).toBeDefined();
    expect(result!.code).toBe('E0601');
  });

  it('returns exact match for uppercase input', () => {
    const result = getHcpcsCode('E0601');
    expect(result).toBeDefined();
    expect(result!.code).toBe('E0601');
  });

  it('returns undefined for nonexistent code', () => {
    expect(getHcpcsCode('Z9999')).toBeUndefined();
  });

  it('returns undefined for empty input', () => {
    expect(getHcpcsCode('')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getHcpcsByCategory
// ---------------------------------------------------------------------------

describe('getHcpcsByCategory', () => {
  it('returns codes for a known category', () => {
    const results = getHcpcsByCategory('Oxygen Equipment');
    expect(results.length).toBeGreaterThan(0);
    results.forEach(r => {
      expect(r.category).toBe('Oxygen Equipment');
    });
  });

  it('returns empty array for unknown category', () => {
    expect(getHcpcsByCategory('Nonexistent Category XYZ')).toEqual([]);
  });

  it('matches case-insensitively (partial match)', () => {
    const results = getHcpcsByCategory('oxygen equipment');
    expect(results.length).toBeGreaterThan(0);
    results.forEach(r => {
      expect(r.category.toLowerCase()).toContain('oxygen equipment');
    });
  });

  it('returns empty array for empty input', () => {
    expect(getHcpcsByCategory('')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// listCategories
// ---------------------------------------------------------------------------

describe('listCategories', () => {
  it('returns a non-empty array', () => {
    const categories = listCategories();
    expect(categories.length).toBeGreaterThan(0);
  });

  it('returns sorted unique strings', () => {
    const categories = listCategories();
    // Check uniqueness
    expect(new Set(categories).size).toBe(categories.length);
    // Check sorted
    const sorted = [...categories].sort();
    expect(categories).toEqual(sorted);
  });

  it('includes known categories', () => {
    const categories = listCategories();
    expect(categories).toContain('Oxygen Equipment');
    expect(categories).toContain('CPAP/BiPAP');
    expect(categories).toContain('Power Wheelchairs');
  });
});
