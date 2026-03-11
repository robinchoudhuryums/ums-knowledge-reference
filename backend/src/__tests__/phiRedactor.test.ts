import { describe, it, expect } from 'vitest';
import { redactPhi, redactPhiFields } from '../utils/phiRedactor';

describe('PHI Redactor', () => {
  describe('SSN patterns', () => {
    it('redacts SSN with dashes', () => {
      const result = redactPhi('Patient SSN is 123-45-6789');
      expect(result.text).toContain('[SSN]');
      expect(result.text).not.toContain('123-45-6789');
      expect(result.redactionCount).toBeGreaterThan(0);
    });

    it('redacts SSN with spaces', () => {
      const result = redactPhi('SSN: 123 45 6789');
      expect(result.text).toContain('[SSN]');
    });
  });

  describe('phone patterns', () => {
    it('redacts phone with parentheses', () => {
      const result = redactPhi('Call (555) 123-4567');
      expect(result.text).toContain('[PHONE]');
      expect(result.text).not.toContain('555');
    });

    it('redacts phone with dashes', () => {
      const result = redactPhi('Phone: 555-123-4567');
      expect(result.text).toContain('[PHONE]');
    });
  });

  describe('email patterns', () => {
    it('redacts email addresses', () => {
      const result = redactPhi('Contact john.doe@hospital.com for info');
      expect(result.text).toContain('[EMAIL]');
      expect(result.text).not.toContain('john.doe@hospital.com');
    });
  });

  describe('date of birth patterns', () => {
    it('redacts DOB with keyword', () => {
      const result = redactPhi('DOB: 03/15/1952');
      expect(result.text).toContain('[DOB]');
      expect(result.text).not.toContain('03/15/1952');
    });

    it('redacts date of birth spelled out', () => {
      const result = redactPhi('date of birth 01-15-1985');
      expect(result.text).toContain('[DOB]');
    });
  });

  describe('MRN patterns', () => {
    it('redacts MRN with number', () => {
      const result = redactPhi('MRN: ABC12345');
      expect(result.text).toContain('[MRN]');
      expect(result.text).not.toContain('ABC12345');
    });

    it('redacts patient ID', () => {
      const result = redactPhi('Patient ID: 9876543');
      expect(result.text).toContain('[MRN]');
    });
  });

  describe('Medicaid ID patterns', () => {
    it('redacts Medicaid ID', () => {
      const result = redactPhi('Medicaid ID: 12345678AB');
      expect(result.text).toContain('[MEDICAID-ID]');
    });
  });

  describe('address patterns', () => {
    it('redacts street addresses', () => {
      const result = redactPhi('Lives at 123 Main Street');
      expect(result.text).toContain('[ADDRESS]');
      expect(result.text).not.toContain('123 Main Street');
    });

    it('redacts avenue addresses', () => {
      const result = redactPhi('Office at 456 Oak Avenue');
      expect(result.text).toContain('[ADDRESS]');
    });
  });

  describe('name patterns', () => {
    it('redacts patient name with prefix', () => {
      const result = redactPhi('patient John Smith needs oxygen');
      expect(result.text).toContain('[NAME]');
      expect(result.text).not.toContain('John Smith');
    });

    it('redacts Mr./Mrs. names', () => {
      const result = redactPhi('Referred by Dr. Jane Wilson');
      expect(result.text).toContain('[NAME]');
      expect(result.text).not.toContain('Jane Wilson');
    });
  });

  describe('no false positives on safe text', () => {
    it('does not redact general medical questions', () => {
      const text = 'What are the Medicare requirements for CPAP coverage?';
      const result = redactPhi(text);
      expect(result.text).toBe(text);
      expect(result.redactionCount).toBe(0);
    });

    it('does not redact HCPCS codes', () => {
      const text = 'What is the fee for E0601?';
      const result = redactPhi(text);
      expect(result.text).toBe(text);
      expect(result.redactionCount).toBe(0);
    });
  });

  describe('redactPhiFields', () => {
    it('redacts specified fields of an object', () => {
      const obj = {
        question: 'What is the plan for patient John Smith?',
        answer: 'Based on the documents...',
        confidence: 'high',
      };
      const { redacted, totalRedactions } = redactPhiFields(obj, ['question', 'answer']);
      expect(redacted.question).toContain('[NAME]');
      expect(redacted.confidence).toBe('high'); // untouched
      expect(totalRedactions).toBeGreaterThan(0);
    });
  });

  describe('empty and null inputs', () => {
    it('handles empty string', () => {
      const result = redactPhi('');
      expect(result.text).toBe('');
      expect(result.redactionCount).toBe(0);
    });
  });
});
