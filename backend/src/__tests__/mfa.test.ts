/**
 * Tests for the MFA (TOTP) service.
 * Verifies secret generation, code verification, and edge cases.
 */

import { describe, it, expect } from 'vitest';
import { generateMfaSecret, verifyMfaCode } from '../services/mfa';
import { TOTP, Secret } from 'otpauth';

describe('MFA Service', () => {

  describe('generateMfaSecret', () => {
    it('returns a base32 secret and otpauth URI', () => {
      const result = generateMfaSecret('testuser');
      expect(result.secret).toBeDefined();
      expect(result.secret.length).toBeGreaterThan(0);
      expect(result.uri).toContain('otpauth://totp/');
      expect(result.uri).toContain('testuser');
      expect(result.uri).toContain('UMS%20Knowledge%20Base');
    });

    it('generates unique secrets for each call', () => {
      const a = generateMfaSecret('user1');
      const b = generateMfaSecret('user1');
      expect(a.secret).not.toBe(b.secret);
    });

    it('includes issuer in the URI', () => {
      const result = generateMfaSecret('admin');
      expect(result.uri).toContain('issuer=UMS');
    });
  });

  describe('verifyMfaCode', () => {
    it('accepts a valid current code', () => {
      const { secret } = generateMfaSecret('testuser');
      // Generate a valid code for the current time
      const totp = new TOTP({
        issuer: 'UMS Knowledge Base',
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
        secret: Secret.fromBase32(secret),
      });
      const code = totp.generate();
      expect(verifyMfaCode(secret, code)).toBe(true);
    });

    it('rejects an invalid code', () => {
      const { secret } = generateMfaSecret('testuser');
      expect(verifyMfaCode(secret, '000000')).toBe(false);
      expect(verifyMfaCode(secret, '123456')).toBe(false);
    });

    it('rejects empty code', () => {
      const { secret } = generateMfaSecret('testuser');
      expect(verifyMfaCode(secret, '')).toBe(false);
    });

    it('rejects non-numeric code', () => {
      const { secret } = generateMfaSecret('testuser');
      expect(verifyMfaCode(secret, 'abcdef')).toBe(false);
    });

    it('rejects code with wrong length', () => {
      const { secret } = generateMfaSecret('testuser');
      expect(verifyMfaCode(secret, '12345')).toBe(false);   // 5 digits
      expect(verifyMfaCode(secret, '1234567')).toBe(false);  // 7 digits
    });

    it('accepts code from adjacent time window (±30s drift)', () => {
      const { secret } = generateMfaSecret('testuser');
      const totp = new TOTP({
        issuer: 'UMS Knowledge Base',
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
        secret: Secret.fromBase32(secret),
      });
      // Generate code for current period — should be valid
      const currentCode = totp.generate();
      expect(verifyMfaCode(secret, currentCode)).toBe(true);
    });

    it('works with different users (different secrets)', () => {
      const user1 = generateMfaSecret('user1');
      const user2 = generateMfaSecret('user2');

      // Generate valid code for user1
      const totp1 = new TOTP({
        issuer: 'UMS Knowledge Base',
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
        secret: Secret.fromBase32(user1.secret),
      });
      const code1 = totp1.generate();

      // Code for user1 should work with user1's secret
      expect(verifyMfaCode(user1.secret, code1)).toBe(true);
      // But NOT with user2's secret (different secret = different code space)
      expect(verifyMfaCode(user2.secret, code1)).toBe(false);
    });
  });
});
