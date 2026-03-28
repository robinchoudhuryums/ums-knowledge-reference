import { describe, it, expect } from 'vitest';
import {
  getChecklist,
  searchChecklists,
  listAvailableChecklists,
  validateDocumentation,
} from '../services/coverageChecklists';

describe('getChecklist', () => {
  it('returns checklist for exact code match (E0601 for CPAP)', () => {
    const result = getChecklist('E0601');
    expect(result).toBeDefined();
    expect(result!.lcdNumber).toBe('L33718');
    expect(result!.hcpcsDescription).toContain('CPAP');
  });

  it('returns checklist for range match (E0431 finds E0424-E0444 oxygen)', () => {
    const result = getChecklist('E0431');
    expect(result).toBeDefined();
    expect(result!.lcdNumber).toBe('L33797');
    expect(result!.hcpcsDescription).toContain('Oxygen');
  });

  it('returns undefined for code outside any range', () => {
    expect(getChecklist('Z9999')).toBeUndefined();
  });

  it('is case-insensitive', () => {
    const lower = getChecklist('e0601');
    const upper = getChecklist('E0601');
    expect(lower).toBeDefined();
    expect(upper).toBeDefined();
    expect(lower!.lcdNumber).toBe(upper!.lcdNumber);
  });
});

describe('searchChecklists', () => {
  it('returns empty array for empty query', () => {
    expect(searchChecklists('')).toEqual([]);
    expect(searchChecklists('   ')).toEqual([]);
  });

  it('finds checklist by LCD number', () => {
    const results = searchChecklists('L33718');
    expect(results.length).toBe(1);
    expect(results[0].lcdNumber).toBe('L33718');
  });

  it('finds checklist by description keyword', () => {
    const results = searchChecklists('oxygen');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some(r => r.hcpcsDescription.toLowerCase().includes('oxygen'))).toBe(true);
  });
});

describe('listAvailableChecklists', () => {
  it('returns 8 checklists', () => {
    const list = listAvailableChecklists();
    expect(list).toHaveLength(8);
  });

  it('each entry has hcpcsCode, lcdNumber, and itemCount', () => {
    const list = listAvailableChecklists();
    for (const entry of list) {
      expect(entry.hcpcsCode).toBeDefined();
      expect(typeof entry.hcpcsCode).toBe('string');
      expect(entry.lcdNumber).toBeDefined();
      expect(typeof entry.lcdNumber).toBe('string');
      expect(entry.itemCount).toBeGreaterThan(0);
    }
  });
});

describe('validateDocumentation', () => {
  it('returns undefined for unknown HCPCS code', () => {
    expect(validateDocumentation('Z9999', [])).toBeUndefined();
  });

  it('returns complete:true when all required items provided', () => {
    const cl = getChecklist('E0601')!;
    const requiredIds = cl.checklist.filter(i => i.required).map(i => i.id);
    const result = validateDocumentation('E0601', requiredIds);
    expect(result).toBeDefined();
    expect(result!.complete).toBe(true);
    expect(result!.missing).toHaveLength(0);
    expect(result!.completedCount).toBe(result!.totalRequired);
  });

  it('returns complete:false with missing items when some required items absent', () => {
    const cl = getChecklist('E0601')!;
    const requiredIds = cl.checklist.filter(i => i.required).map(i => i.id);
    // Provide only the first required item
    const result = validateDocumentation('E0601', [requiredIds[0]]);
    expect(result).toBeDefined();
    expect(result!.complete).toBe(false);
    expect(result!.missing.length).toBe(requiredIds.length - 1);
    expect(result!.completedCount).toBe(1);
  });

  it('returns all required as missing when completedItems is empty', () => {
    const cl = getChecklist('E0601')!;
    const requiredCount = cl.checklist.filter(i => i.required).length;
    const result = validateDocumentation('E0601', []);
    expect(result).toBeDefined();
    expect(result!.complete).toBe(false);
    expect(result!.missing).toHaveLength(requiredCount);
    expect(result!.completedCount).toBe(0);
    expect(result!.totalRequired).toBe(requiredCount);
  });
});
