import { describe, it, expect } from 'vitest';
import { generateSeatingEvaluation } from '../services/seatingEvaluation';
import { PpdResponse, PmdRecommendation } from '../services/ppdQuestionnaire';

// ─── Helpers ──────────────────────────────────────────────────────────

function buildResponses(overrides: Record<string, string | boolean | number>): PpdResponse[] {
  return Object.entries(overrides).map(([questionId, answer]) => ({
    questionId,
    answer,
  }));
}

const defaultRec: PmdRecommendation = {
  hcpcsCode: 'K0823',
  description: 'Test',
  category: 'standard',
  justification: 'test',
  productName: 'Test Chair',
} as PmdRecommendation;

// ─── Tests ────────────────────────────────────────────────────────────

describe('generateSeatingEvaluation', () => {
  it('returns all required fields', () => {
    const responses = buildResponses({
      q2: 'unable to do it',
      q37: '68',
      q38: '180',
      q41: 'Multiple Sclerosis',
    });

    const result = generateSeatingEvaluation(responses, [defaultRec], 'John Doe');

    // Section 1
    expect(result.patientName).toBe('John Doe');
    expect(result.purposeOfVisit).toBe('Power Mobility Evaluation');
    expect(result.heightInches).toBe('68');
    expect(result.weightLbs).toBe('180');
    expect(result.diagnoses).toContain('Multiple Sclerosis');

    // Section 2 - MRADLs
    expect(result.mradls).toBeDefined();
    expect(result.mradls).toHaveProperty('toilet');
    expect(result.mradls).toHaveProperty('eat');
    expect(result.mradls).toHaveProperty('dressing');
    expect(result.mradls).toHaveProperty('grooming');
    expect(result.mradls).toHaveProperty('bathe');

    // Section 3 - Functional Limitations
    expect(result.extremityStrength).toBeDefined();
    expect(result.fallRisk).toBeDefined();
    expect(result.painUE).toBeDefined();
    expect(result.painLE).toBeDefined();

    // Section 4
    expect(typeof result.rulesOutCaneWalker).toBe('boolean');
    expect(typeof result.rulesOutManualWheelchair).toBe('boolean');
    expect(typeof result.rulesOutScooterPOV).toBe('boolean');

    // Section 5
    expect(result.cognitiveStatus).toBeDefined();
    expect(Array.isArray(result.cognitiveStatus)).toBe(true);

    // Section 6
    expect(typeof result.needsWeightShift).toBe('boolean');
    expect(result.pressureUlcerRiskFactors).toBeDefined();

    // Section 8
    expect(typeof result.hasPressureUlcers).toBe('boolean');
    expect(Array.isArray(result.ulcerLocations)).toBe(true);

    // Section 9
    expect(result.needsToManage).toBeDefined();
    expect(typeof result.mradlsImprovedByPMD).toBe('boolean');
    expect(typeof result.willingAndAble).toBe('boolean');
    expect(result.hoursPerDay).toBe('>2');
    expect(result.primaryUseInHome).toBe(true);

    // Section 10
    expect(result.pmdBase).toBeDefined();
    expect(result.features).toBeDefined();
    expect(result.cushions).toBeDefined();
    expect(typeof result.comments).toBe('string');
  });
});

describe('MRADL classifier (via generateSeatingEvaluation)', () => {
  it('returns null for empty text', () => {
    const responses = buildResponses({ q2: '' });
    const result = generateSeatingEvaluation(responses, [], 'Test Patient');
    expect(result.mradls.toilet).toBeNull();
  });

  it('returns cannot_accomplish for "unable to"', () => {
    const responses = buildResponses({ q2: 'unable to go alone' });
    const result = generateSeatingEvaluation(responses, [], 'Test Patient');
    expect(result.mradls.toilet).toBe('cannot_accomplish');
  });

  it('returns cannot_accomplish for "cannot"', () => {
    const responses = buildResponses({ q3: 'cannot do it' });
    const result = generateSeatingEvaluation(responses, [], 'Test Patient');
    expect(result.mradls.eat).toBe('cannot_accomplish');
  });

  it('returns cannot_attempt for "unsafe"', () => {
    const responses = buildResponses({ q4: 'unsafe without supervision' });
    const result = generateSeatingEvaluation(responses, [], 'Test Patient');
    expect(result.mradls.dressing).toBe('cannot_attempt');
  });

  it('returns cannot_attempt for "risk"', () => {
    const responses = buildResponses({ q5: 'high risk of falling' });
    const result = generateSeatingEvaluation(responses, [], 'Test Patient');
    expect(result.mradls.grooming).toBe('cannot_attempt');
  });

  it('returns cannot_complete for "difficulty"', () => {
    const responses = buildResponses({ q6: 'has difficulty reaching' });
    const result = generateSeatingEvaluation(responses, [], 'Test Patient');
    expect(result.mradls.bathe).toBe('cannot_complete');
  });

  it('returns cannot_complete for "help"', () => {
    const responses = buildResponses({ q2: 'needs help from caregiver' });
    const result = generateSeatingEvaluation(responses, [], 'Test Patient');
    expect(result.mradls.toilet).toBe('cannot_complete');
  });

  it('returns null for unrecognized text like "fine" or "good"', () => {
    const responsesGood = buildResponses({ q2: 'good', q3: 'fine' });
    const result = generateSeatingEvaluation(responsesGood, [], 'Test Patient');
    expect(result.mradls.toilet).toBeNull();
    expect(result.mradls.eat).toBeNull();
  });
});

describe('cognitive status inference', () => {
  it('returns impaired when diagnoses include "dementia"', () => {
    const responses = buildResponses({ q41: 'dementia' });
    const result = generateSeatingEvaluation(responses, [], 'Test Patient');
    expect(result.cognitiveStatus).toContain('Impaired — see diagnosis');
  });

  it('returns impaired when diagnoses include "TBI"', () => {
    const responses = buildResponses({ q42: 'TBI' });
    const result = generateSeatingEvaluation(responses, [], 'Test Patient');
    expect(result.cognitiveStatus).toContain('Impaired — see diagnosis');
  });

  it('defaults to Intact when no cognitive conditions', () => {
    const responses = buildResponses({ q41: 'COPD', q42: 'CHF' });
    const result = generateSeatingEvaluation(responses, [], 'Test Patient');
    expect(result.cognitiveStatus).toContain('Intact');
  });
});

describe('null safety', () => {
  it('ulcerLocations is empty array when q33a is empty', () => {
    const responses = buildResponses({ q33: 'yes', q33a: '' });
    const result = generateSeatingEvaluation(responses, [], 'Test Patient');
    expect(result.ulcerLocations).toEqual([]);
  });
});

describe('pain scale calculation', () => {
  it('3 UE pain locations produces scale "6"', () => {
    // q14=Neck, q15=Shoulder, q16=Elbow → 3 UE locations → scale = min(3*2, 10) = "6"
    const responses = buildResponses({
      q14: 'yes',
      q15: 'yes',
      q16: 'yes',
    });
    const result = generateSeatingEvaluation(responses, [], 'Test Patient');
    expect(result.painUE.locations).toHaveLength(3);
    expect(result.painUE.scale).toBe('6');
  });
});
