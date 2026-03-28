import { describe, it, expect } from 'vitest';
import { FORM_RULES, detectFormType, matchRequiredField } from '../config/formRules';

describe('FORM_RULES', () => {
  it('has expected form types', () => {
    expect(FORM_RULES['cmn-oxygen']).toBeDefined();
    expect(FORM_RULES['cmn-hospital-beds']).toBeDefined();
    expect(FORM_RULES['cmn-pov']).toBeDefined();
    expect(FORM_RULES['prior-auth']).toBeDefined();
  });

  it('each form type has detectionPatterns and requiredFields', () => {
    for (const [_key, rule] of Object.entries(FORM_RULES)) {
      expect(rule.detectionPatterns).toBeDefined();
      expect(Array.isArray(rule.detectionPatterns)).toBe(true);
      expect(rule.detectionPatterns.length).toBeGreaterThan(0);
      expect(rule.requiredFields).toBeDefined();
      expect(Array.isArray(rule.requiredFields)).toBe(true);
      expect(rule.requiredFields.length).toBeGreaterThan(0);
    }
  });
});

describe('detectFormType', () => {
  it('detects "CMS-484" as cmn-oxygen', () => {
    const result = detectFormType('This is a CMS-484 form for oxygen');
    expect(result).not.toBeNull();
    expect(result!.key).toBe('cmn-oxygen');
  });

  it('detects "certificate of medical necessity" text', () => {
    const result = detectFormType('This Certificate of Medical Necessity is required');
    expect(result).not.toBeNull();
    expect(result!.key).toBe('cmn-oxygen');
  });

  it('detects "CMS-10126" as cmn-hospital-beds', () => {
    const result = detectFormType('Form CMS-10126 for hospital bed');
    expect(result).not.toBeNull();
    expect(result!.key).toBe('cmn-hospital-beds');
  });

  it('returns null for unrelated text', () => {
    const result = detectFormType('This is a random document about cooking recipes');
    expect(result).toBeNull();
  });

  it('is case-insensitive', () => {
    const result = detectFormType('CERTIFICATE OF MEDICAL NECESSITY');
    expect(result).not.toBeNull();
    expect(result!.key).toBe('cmn-oxygen');
  });
});

describe('matchRequiredField', () => {
  it('matches field key against required field patterns', () => {
    const oxygenRule = FORM_RULES['cmn-oxygen'];
    const result = matchRequiredField('Patient Name', oxygenRule);
    expect(result).not.toBeNull();
    expect(result!.label).toBe('Patient Name');
  });

  it('matches DOB field pattern', () => {
    const oxygenRule = FORM_RULES['cmn-oxygen'];
    const result = matchRequiredField('Date of Birth', oxygenRule);
    expect(result).not.toBeNull();
    expect(result!.label).toBe('Date of Birth');
  });

  it('returns null for non-matching field', () => {
    const oxygenRule = FORM_RULES['cmn-oxygen'];
    const result = matchRequiredField('Favorite Color', oxygenRule);
    expect(result).toBeNull();
  });
});
