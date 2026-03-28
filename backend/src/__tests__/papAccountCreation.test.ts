import { describe, it, expect } from 'vitest';
import {
  getPapQuestions,
  getPapGroups,
  PAP_FORM_VERSION,
} from '../services/papAccountCreation';

describe('PAP_FORM_VERSION', () => {
  it('is defined', () => {
    expect(PAP_FORM_VERSION).toBeDefined();
    expect(typeof PAP_FORM_VERSION).toBe('string');
  });
});

describe('getPapQuestions', () => {
  it('returns 24 questions', () => {
    const questions = getPapQuestions();
    expect(questions).toHaveLength(24);
  });

  it('all questions have required fields (id, number, text, spanishText, type, group)', () => {
    const questions = getPapQuestions();
    for (const q of questions) {
      expect(q.id).toBeDefined();
      expect(typeof q.id).toBe('string');
      expect(q.number).toBeDefined();
      expect(typeof q.number).toBe('string');
      expect(q.text).toBeDefined();
      expect(typeof q.text).toBe('string');
      expect(q.spanishText).toBeDefined();
      expect(typeof q.spanishText).toBe('string');
      expect(q.type).toBeDefined();
      expect(q.group).toBeDefined();
    }
  });

  it('IDs are unique', () => {
    const questions = getPapQuestions();
    const ids = questions.map(q => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('select questions have options array', () => {
    const questions = getPapQuestions();
    const selectQuestions = questions.filter(q => q.type === 'select');
    expect(selectQuestions.length).toBeGreaterThan(0);
    for (const q of selectQuestions) {
      expect(q.options).toBeDefined();
      expect(Array.isArray(q.options)).toBe(true);
      expect(q.options!.length).toBeGreaterThan(0);
    }
  });
});

describe('getPapGroups', () => {
  it('returns 4 groups', () => {
    const groups = getPapGroups();
    expect(groups).toHaveLength(4);
  });
});

describe('conditionalFormatting', () => {
  it('questions with conditionalFormatting have valid color rules', () => {
    const questions = getPapQuestions();
    const formatted = questions.filter(q => q.conditionalFormatting);
    expect(formatted.length).toBeGreaterThan(0);
    for (const q of formatted) {
      for (const [key, colors] of Object.entries(q.conditionalFormatting!)) {
        expect(typeof key).toBe('string');
        expect(colors.bgColor).toBeDefined();
        expect(typeof colors.bgColor).toBe('string');
        expect(colors.textColor).toBeDefined();
        expect(typeof colors.textColor).toBe('string');
        // Verify they look like hex colors
        expect(colors.bgColor).toMatch(/^#[0-9a-fA-F]{6}$/);
        expect(colors.textColor).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
    }
  });
});
