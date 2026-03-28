import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock dependencies ────────────────────────────────────────────────────────

vi.mock('../services/hcpcsLookup', () => ({
  searchHcpcs: vi.fn(() => []),
  getHcpcsCode: vi.fn(() => undefined),
}));

vi.mock('../services/icd10Mapping', () => ({
  getHcpcsForDiagnosis: vi.fn(() => []),
  getDiagnosesForHcpcs: vi.fn(() => []),
  searchDiagnoses: vi.fn(() => []),
}));

vi.mock('../services/coverageChecklists', () => ({
  getChecklist: vi.fn(() => undefined),
  searchChecklists: vi.fn(() => []),
}));

// Import after mocks are registered
import { enrichQueryWithStructuredData } from '../services/referenceEnrichment';
import { searchHcpcs, getHcpcsCode } from '../services/hcpcsLookup';
import { getHcpcsForDiagnosis, getDiagnosesForHcpcs, searchDiagnoses } from '../services/icd10Mapping';
import { getChecklist, searchChecklists } from '../services/coverageChecklists';

// ── Helpers ──────────────────────────────────────────────────────────────────

const mockGetHcpcsCode = getHcpcsCode as ReturnType<typeof vi.fn>;
const mockSearchHcpcs = searchHcpcs as ReturnType<typeof vi.fn>;
const mockGetHcpcsForDiagnosis = getHcpcsForDiagnosis as ReturnType<typeof vi.fn>;
const mockGetDiagnosesForHcpcs = getDiagnosesForHcpcs as ReturnType<typeof vi.fn>;
const mockSearchDiagnoses = searchDiagnoses as ReturnType<typeof vi.fn>;
const mockGetChecklist = getChecklist as ReturnType<typeof vi.fn>;
const mockSearchChecklists = searchChecklists as ReturnType<typeof vi.fn>;

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Reference Enrichment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── 1. Empty / whitespace input ──────────────────────────────────────────

  describe('empty / whitespace input', () => {
    it('returns empty array for empty string', () => {
      const results = enrichQueryWithStructuredData('');
      expect(results).toEqual([]);
    });

    it('returns empty array for whitespace-only string', () => {
      const results = enrichQueryWithStructuredData('   ');
      expect(results).toEqual([]);
    });

    it('does not call any lookup services for empty input', () => {
      enrichQueryWithStructuredData('');
      expect(mockGetHcpcsCode).not.toHaveBeenCalled();
      expect(mockSearchHcpcs).not.toHaveBeenCalled();
      expect(mockGetHcpcsForDiagnosis).not.toHaveBeenCalled();
      expect(mockSearchDiagnoses).not.toHaveBeenCalled();
      expect(mockSearchChecklists).not.toHaveBeenCalled();
    });
  });

  // ── 2. Explicit HCPCS code in query ──────────────────────────────────────

  describe('explicit HCPCS code detection', () => {
    it('looks up an HCPCS code found in the question', () => {
      mockGetHcpcsCode.mockReturnValue({
        code: 'E0601',
        shortDescription: 'CPAP device',
        longDescription: 'Continuous positive airway pressure (CPAP) device',
        category: 'CPAP/BiPAP',
      });

      const results = enrichQueryWithStructuredData('What is E0601?');

      expect(mockGetHcpcsCode).toHaveBeenCalledWith('E0601');
      expect(results).toHaveLength(1);
      expect(results[0].contextBlock).toContain('HCPCS Code E0601');
      expect(results[0].contextBlock).toContain('CPAP device');
      expect(results[0].contextBlock).toContain('Category: CPAP/BiPAP');
      expect(results[0].sourceLabel).toBe('HCPCS Reference: E0601');
    });

    it('includes long description when different from short', () => {
      mockGetHcpcsCode.mockReturnValue({
        code: 'E0601',
        shortDescription: 'CPAP device',
        longDescription: 'Continuous positive airway pressure (CPAP) device',
        category: 'CPAP/BiPAP',
      });

      const results = enrichQueryWithStructuredData('Tell me about E0601');
      expect(results[0].contextBlock).toContain('Description: Continuous positive airway pressure');
    });

    it('omits long description when same as short', () => {
      mockGetHcpcsCode.mockReturnValue({
        code: 'K0001',
        shortDescription: 'Standard wheelchair',
        longDescription: 'Standard wheelchair',
        category: 'Manual Wheelchairs',
      });

      const results = enrichQueryWithStructuredData('What is K0001?');
      expect(results[0].contextBlock).not.toContain('Description:');
    });

    it('handles multiple HCPCS codes in one query', () => {
      mockGetHcpcsCode.mockImplementation((code: string) => {
        if (code === 'E0601') return { code: 'E0601', shortDescription: 'CPAP device', longDescription: 'CPAP device', category: 'CPAP/BiPAP' };
        if (code === 'E0470') return { code: 'E0470', shortDescription: 'RAD without backup', longDescription: 'RAD without backup', category: 'CPAP/BiPAP' };
        return undefined;
      });

      const results = enrichQueryWithStructuredData('Compare E0601 and E0470');
      expect(results).toHaveLength(2);
      expect(results[0].sourceLabel).toBe('HCPCS Reference: E0601');
      expect(results[1].sourceLabel).toBe('HCPCS Reference: E0470');
    });

    it('deduplicates repeated HCPCS codes', () => {
      mockGetHcpcsCode.mockReturnValue({
        code: 'E0601',
        shortDescription: 'CPAP device',
        longDescription: 'CPAP device',
        category: 'CPAP/BiPAP',
      });

      const results = enrichQueryWithStructuredData('Is E0601 the same as e0601?');
      // Both occurrences resolve to the same code; should only appear once
      expect(mockGetHcpcsCode).toHaveBeenCalledTimes(1);
      expect(results).toHaveLength(1);
    });

    it('skips unknown HCPCS codes gracefully', () => {
      mockGetHcpcsCode.mockReturnValue(undefined);
      const results = enrichQueryWithStructuredData('What is E9999?');
      expect(results).toHaveLength(0);
    });

    it('includes coverage checklist when coverage keyword is present', () => {
      mockGetHcpcsCode.mockReturnValue({
        code: 'E0601',
        shortDescription: 'CPAP device',
        longDescription: 'Continuous positive airway pressure (CPAP) device',
        category: 'CPAP/BiPAP',
      });
      mockGetChecklist.mockReturnValue({
        hcpcsCode: 'E0601',
        hcpcsDescription: 'CPAP device',
        lcdNumber: 'L33718',
        lcdTitle: 'CPAP',
        checklist: [
          { id: 'cpap-01', description: 'Sleep study documented', required: true, category: 'clinical' },
        ],
      });

      const results = enrichQueryWithStructuredData('What are the coverage criteria for E0601?');
      expect(mockGetChecklist).toHaveBeenCalledWith('E0601');
      expect(results).toHaveLength(1);
      expect(results[0].contextBlock).toContain('Coverage Checklist');
      expect(results[0].contextBlock).toContain('L33718');
      expect(results[0].contextBlock).toContain('[REQUIRED] Sleep study documented');
    });

    it('includes renewal checklist, general criteria, and frequency when present', () => {
      mockGetHcpcsCode.mockReturnValue({
        code: 'E0601',
        shortDescription: 'CPAP device',
        longDescription: 'Continuous positive airway pressure (CPAP) device',
        category: 'CPAP/BiPAP',
      });
      mockGetChecklist.mockReturnValue({
        hcpcsCode: 'E0601',
        hcpcsDescription: 'CPAP device',
        lcdNumber: 'L33718',
        lcdTitle: 'CPAP',
        checklist: [
          { id: 'cpap-01', description: 'Sleep study documented', required: true, category: 'clinical' },
        ],
        renewalChecklist: [
          { id: 'cpap-r01', description: 'Annual compliance report', required: true, category: 'documentation' },
        ],
        generalCriteria: ['Patient must have documented OSA.'],
        frequencyLimitations: 'Replace every 5 years.',
      });

      const results = enrichQueryWithStructuredData('E0601 coverage requirements');
      const block = results[0].contextBlock;
      expect(block).toContain('Renewal requirements:');
      expect(block).toContain('[REQUIRED] Annual compliance report');
      expect(block).toContain('General criteria: Patient must have documented OSA.');
      expect(block).toContain('Frequency limitations: Replace every 5 years.');
    });

    it('includes ICD-10 mappings when diagnosis keywords are present', () => {
      mockGetHcpcsCode.mockReturnValue({
        code: 'E0601',
        shortDescription: 'CPAP device',
        longDescription: 'Continuous positive airway pressure (CPAP) device',
        category: 'CPAP/BiPAP',
      });
      mockGetDiagnosesForHcpcs.mockReturnValue([
        { icd10Code: 'G47.33', hcpcsCode: 'E0601', hcpcsDescription: 'CPAP device', coverageNotes: 'Covered with PSG', documentationRequired: 'Sleep study' },
      ]);

      const results = enrichQueryWithStructuredData('What diagnosis codes justify E0601?');
      expect(mockGetDiagnosesForHcpcs).toHaveBeenCalledWith('E0601');
      expect(results[0].contextBlock).toContain('ICD-10 codes that justify E0601');
      expect(results[0].contextBlock).toContain('G47.33: Covered with PSG');
      expect(results[0].contextBlock).toContain('[Docs: Sleep study]');
    });

    it('includes ICD-10 mappings when "qualify" keyword is present', () => {
      mockGetHcpcsCode.mockReturnValue({
        code: 'E0601',
        shortDescription: 'CPAP device',
        longDescription: 'CPAP device',
        category: 'CPAP/BiPAP',
      });
      mockGetDiagnosesForHcpcs.mockReturnValue([
        { icd10Code: 'G47.33', hcpcsCode: 'E0601', hcpcsDescription: 'CPAP', coverageNotes: 'Covered' },
      ]);

      const results = enrichQueryWithStructuredData('What codes qualify for E0601?');
      expect(results[0].contextBlock).toContain('ICD-10 codes that justify E0601');
    });
  });

  // ── 3. Explicit ICD-10 code in query ─────────────────────────────────────

  describe('explicit ICD-10 code detection', () => {
    it('looks up HCPCS crosswalk for an ICD-10 code', () => {
      mockGetHcpcsForDiagnosis.mockReturnValue([
        { icd10Code: 'J44.9', hcpcsCode: 'E0424', hcpcsDescription: 'Stationary compressor', coverageNotes: 'Requires qualifying blood gas' },
        { icd10Code: 'J44.9', hcpcsCode: 'E1390', hcpcsDescription: 'O2 concentrator', documentationRequired: 'CMN CMS-484' },
      ]);

      const results = enrichQueryWithStructuredData('J44.9 coverage');
      expect(mockGetHcpcsForDiagnosis).toHaveBeenCalledWith('J44.9');
      expect(results).toHaveLength(1);
      expect(results[0].contextBlock).toContain('ICD-10 Code J44.9');
      expect(results[0].contextBlock).toContain('DME Equipment Crosswalk');
      expect(results[0].contextBlock).toContain('E0424 (Stationary compressor)');
      expect(results[0].contextBlock).toContain('Requires qualifying blood gas');
      expect(results[0].contextBlock).toContain('[Documentation: CMN CMS-484]');
      expect(results[0].sourceLabel).toBe('ICD-10 Crosswalk: J44.9');
    });

    it('handles ICD-10 code without decimal (3-character form)', () => {
      mockGetHcpcsForDiagnosis.mockReturnValue([
        { icd10Code: 'G35', hcpcsCode: 'K0856', hcpcsDescription: 'Power wheelchair', coverageNotes: 'Covered' },
      ]);

      const results = enrichQueryWithStructuredData('What equipment for G35?');
      expect(mockGetHcpcsForDiagnosis).toHaveBeenCalledWith('G35');
      expect(results).toHaveLength(1);
      expect(results[0].sourceLabel).toBe('ICD-10 Crosswalk: G35');
    });

    it('filters out codes that are actually HCPCS (e.g., E0601 should not be treated as ICD-10)', () => {
      // E0601 matches the ICD-10 regex pattern but should be filtered out
      mockGetHcpcsCode.mockReturnValue({
        code: 'E0601',
        shortDescription: 'CPAP device',
        longDescription: 'CPAP device',
        category: 'CPAP/BiPAP',
      });

      enrichQueryWithStructuredData('What is E0601?');
      // getHcpcsForDiagnosis should NOT be called with E0601
      expect(mockGetHcpcsForDiagnosis).not.toHaveBeenCalledWith('E0601');
    });

    it('returns empty results for unrecognized ICD-10 codes', () => {
      mockGetHcpcsForDiagnosis.mockReturnValue([]);
      const results = enrichQueryWithStructuredData('What about Z99.99?');
      expect(results).toHaveLength(0);
    });
  });

  // ── 4. Coverage keywords without explicit codes ──────────────────────────

  describe('coverage keyword search (no explicit codes)', () => {
    it('searches checklists when coverage keyword is present', () => {
      mockSearchChecklists.mockReturnValue([
        {
          hcpcsCode: 'E0424-E0444',
          hcpcsDescription: 'Home Oxygen Equipment and Supplies',
          lcdNumber: 'L33797',
          lcdTitle: 'Oxygen and Oxygen Equipment',
          checklist: [
            { id: 'oxy-01', description: 'Qualifying blood gas study', required: true, category: 'clinical' },
          ],
        },
      ]);

      const results = enrichQueryWithStructuredData('What are the coverage criteria for oxygen?');
      expect(mockSearchChecklists).toHaveBeenCalled();
      const call = mockSearchChecklists.mock.calls[0][0];
      expect(call).toContain('oxygen');
      expect(results.length).toBeGreaterThanOrEqual(1);
      const coverageResult = results.find(r => r.sourceLabel.startsWith('Coverage Checklist'));
      expect(coverageResult).toBeDefined();
      expect(coverageResult!.contextBlock).toContain('L33797');
      expect(coverageResult!.contextBlock).toContain('[REQUIRED] Qualifying blood gas study');
    });

    it('includes renewal/general/frequency in coverage search results', () => {
      mockSearchChecklists.mockReturnValue([
        {
          hcpcsCode: 'E0601',
          hcpcsDescription: 'CPAP device',
          lcdNumber: 'L33718',
          lcdTitle: 'CPAP',
          checklist: [{ id: 'c1', description: 'Sleep study', required: true, category: 'clinical' }],
          renewalChecklist: [{ id: 'r1', description: 'Annual check', required: false, category: 'documentation' }],
          generalCriteria: ['Must be diagnosed with OSA.'],
          frequencyLimitations: 'Every 5 years',
        },
      ]);

      const results = enrichQueryWithStructuredData('What documentation is required for CPAP?');
      const block = results.find(r => r.sourceLabel.startsWith('Coverage Checklist'))!.contextBlock;
      expect(block).toContain('Renewal requirements:');
      expect(block).toContain('[OPTIONAL] Annual check');
      expect(block).toContain('General criteria: Must be diagnosed with OSA.');
      expect(block).toContain('Frequency limitations: Every 5 years');
    });

    it('does not trigger coverage search when search term is too short', () => {
      // All coverage keywords stripped leaves a very short remainder
      enrichQueryWithStructuredData('coverage of');
      expect(mockSearchChecklists).not.toHaveBeenCalled();
    });

    it('does not trigger coverage search when explicit HCPCS code is present', () => {
      mockGetHcpcsCode.mockReturnValue({
        code: 'E0601',
        shortDescription: 'CPAP device',
        longDescription: 'CPAP device',
        category: 'CPAP/BiPAP',
      });

      enrichQueryWithStructuredData('E0601 coverage criteria');
      // Coverage search via searchChecklists should be skipped because a code was found
      expect(mockSearchChecklists).not.toHaveBeenCalled();
    });
  });

  // ── 5. HCPCS keyword search (no explicit code) ──────────────────────────

  describe('HCPCS keyword search (no explicit code)', () => {
    it('searches HCPCS when keyword "hcpcs" is present', () => {
      mockSearchHcpcs.mockReturnValue([
        { code: 'E1390', shortDescription: 'O2 concentrator', longDescription: 'Oxygen concentrator', category: 'Oxygen Equipment' },
        { code: 'E0424', shortDescription: 'Stationary compressor', longDescription: 'Stationary compressor', category: 'Oxygen Equipment' },
      ]);

      const results = enrichQueryWithStructuredData('what hcpcs code for oxygen concentrator');
      expect(mockSearchHcpcs).toHaveBeenCalled();
      const searchResult = results.find(r => r.sourceLabel === 'HCPCS Code Search');
      expect(searchResult).toBeDefined();
      expect(searchResult!.contextBlock).toContain('E1390');
      expect(searchResult!.contextBlock).toContain('O2 concentrator');
    });

    it('triggers search for "billing code" keyword', () => {
      mockSearchHcpcs.mockReturnValue([
        { code: 'K0001', shortDescription: 'Standard wheelchair', longDescription: 'Standard wheelchair', category: 'Manual Wheelchairs' },
      ]);

      const results = enrichQueryWithStructuredData('billing code for wheelchair');
      expect(mockSearchHcpcs).toHaveBeenCalled();
      expect(results.find(r => r.sourceLabel === 'HCPCS Code Search')).toBeDefined();
    });

    it('does not trigger keyword search when explicit HCPCS code is present', () => {
      mockGetHcpcsCode.mockReturnValue({
        code: 'E0601',
        shortDescription: 'CPAP device',
        longDescription: 'CPAP device',
        category: 'CPAP/BiPAP',
      });

      enrichQueryWithStructuredData('what is hcpcs E0601?');
      expect(mockSearchHcpcs).not.toHaveBeenCalled();
    });

    it('does not trigger search when search term is too short after keyword removal', () => {
      enrichQueryWithStructuredData('hcpcs or');
      expect(mockSearchHcpcs).not.toHaveBeenCalled();
    });
  });

  // ── 6. ICD-10 keyword search (no explicit code) ─────────────────────────

  describe('ICD-10 keyword search (no explicit code)', () => {
    it('searches diagnoses when "icd-10" keyword is present', () => {
      mockSearchDiagnoses.mockReturnValue([
        { code: 'G47.33', description: 'Obstructive sleep apnea', category: 'Sleep Disorders' },
      ]);

      const results = enrichQueryWithStructuredData('icd-10 code for sleep apnea');
      expect(mockSearchDiagnoses).toHaveBeenCalled();
      const searchResult = results.find(r => r.sourceLabel === 'ICD-10 Code Search');
      expect(searchResult).toBeDefined();
      expect(searchResult!.contextBlock).toContain('G47.33');
      expect(searchResult!.contextBlock).toContain('Obstructive sleep apnea');
    });

    it('triggers search for "diagnosis code" keyword', () => {
      mockSearchDiagnoses.mockReturnValue([
        { code: 'J44.9', description: 'COPD, unspecified', category: 'COPD/Chronic Respiratory' },
      ]);

      const results = enrichQueryWithStructuredData('diagnosis code for COPD');
      expect(mockSearchDiagnoses).toHaveBeenCalled();
      expect(results.find(r => r.sourceLabel === 'ICD-10 Code Search')).toBeDefined();
    });

    it('does not trigger keyword search when explicit ICD-10 code is present', () => {
      mockGetHcpcsForDiagnosis.mockReturnValue([
        { icd10Code: 'J44.9', hcpcsCode: 'E0424', hcpcsDescription: 'Compressor' },
      ]);

      enrichQueryWithStructuredData('What equipment for icd-10 J44.9?');
      expect(mockSearchDiagnoses).not.toHaveBeenCalled();
    });
  });

  // ── 7. Result shape validation ───────────────────────────────────────────

  describe('enrichment result shape', () => {
    it('each result has contextBlock and sourceLabel strings', () => {
      mockGetHcpcsCode.mockReturnValue({
        code: 'E0601',
        shortDescription: 'CPAP device',
        longDescription: 'CPAP device',
        category: 'CPAP/BiPAP',
      });

      const results = enrichQueryWithStructuredData('E0601');
      for (const r of results) {
        expect(typeof r.contextBlock).toBe('string');
        expect(r.contextBlock.length).toBeGreaterThan(0);
        expect(typeof r.sourceLabel).toBe('string');
        expect(r.sourceLabel.length).toBeGreaterThan(0);
      }
    });

    it('returns multiple enrichment blocks when query matches multiple branches', () => {
      // HCPCS code found
      mockGetHcpcsCode.mockReturnValue({
        code: 'E0601',
        shortDescription: 'CPAP device',
        longDescription: 'Continuous positive airway pressure (CPAP) device',
        category: 'CPAP/BiPAP',
      });
      // Coverage checklist found
      mockGetChecklist.mockReturnValue({
        hcpcsCode: 'E0601',
        hcpcsDescription: 'CPAP device',
        lcdNumber: 'L33718',
        lcdTitle: 'CPAP',
        checklist: [{ id: 'c1', description: 'Sleep study', required: true, category: 'clinical' }],
      });
      // ICD-10 diagnoses found
      mockGetDiagnosesForHcpcs.mockReturnValue([
        { icd10Code: 'G47.33', hcpcsCode: 'E0601', hcpcsDescription: 'CPAP' },
      ]);

      const results = enrichQueryWithStructuredData('What are the coverage criteria and diagnosis codes for E0601?');
      // Should have at least the HCPCS reference (with coverage + ICD-10 embedded)
      expect(results.length).toBeGreaterThanOrEqual(1);
      const block = results[0].contextBlock;
      expect(block).toContain('Coverage Checklist');
      expect(block).toContain('ICD-10 codes that justify E0601');
    });
  });

  // ── 8. No false triggers on plain questions ──────────────────────────────

  describe('no false triggers', () => {
    it('returns empty array for a generic question with no codes or keywords', () => {
      const results = enrichQueryWithStructuredData('What is your return policy?');
      expect(results).toEqual([]);
      expect(mockGetHcpcsCode).not.toHaveBeenCalled();
      expect(mockSearchHcpcs).not.toHaveBeenCalled();
      expect(mockGetHcpcsForDiagnosis).not.toHaveBeenCalled();
      expect(mockSearchDiagnoses).not.toHaveBeenCalled();
      expect(mockSearchChecklists).not.toHaveBeenCalled();
    });
  });
});
