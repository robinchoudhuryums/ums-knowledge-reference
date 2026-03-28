import { describe, it, expect } from 'vitest';
import {
  getAccountCreationQuestions,
  getAccountCreationGroups,
  AC_FORM_VERSION,
} from '../services/accountCreation';

describe('AC_FORM_VERSION', () => {
  it('is defined', () => {
    expect(AC_FORM_VERSION).toBeDefined();
    expect(typeof AC_FORM_VERSION).toBe('string');
  });
});

describe('getAccountCreationQuestions', () => {
  it('returns 25 questions', () => {
    const questions = getAccountCreationQuestions();
    expect(questions).toHaveLength(25);
  });

  it('all questions have required fields (id, number, text, spanishText, type, group)', () => {
    const questions = getAccountCreationQuestions();
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
    const questions = getAccountCreationQuestions();
    const ids = questions.map(q => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('all types are valid', () => {
    const validTypes = ['text', 'checkbox', 'textarea'];
    const questions = getAccountCreationQuestions();
    for (const q of questions) {
      expect(validTypes).toContain(q.type);
    }
  });
});

describe('getAccountCreationGroups', () => {
  it('returns 4 groups', () => {
    const groups = getAccountCreationGroups();
    expect(groups).toHaveLength(4);
  });

  it('returns groups in expected order', () => {
    const groups = getAccountCreationGroups();
    expect(groups).toEqual([
      'Demographics',
      'Insurance',
      'Clinical Information',
      'Mobility Evaluation & Scheduling',
    ]);
  });
});
