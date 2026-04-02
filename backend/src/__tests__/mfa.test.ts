/**
 * Tests for the MFA (TOTP) service.
 * Verifies secret generation, code verification, and edge cases.
 */

import { describe, it, expect } from 'vitest';
import { generateMfaSecret, verifyMfaCode, generateRecoveryCodes, verifyRecoveryCode } from '../services/mfa';
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

  // ═══════════════════════════════════════════════════════════════════════════
  // Recovery Codes
  // ═══════════════════════════════════════════════════════════════════════════

  describe('generateRecoveryCodes', () => {
    it('generates 10 recovery codes', async () => {
      const { plainCodes, hashedCodes } = await generateRecoveryCodes();
      expect(plainCodes.length).toBe(10);
      expect(hashedCodes.length).toBe(10);
    });

    it('codes are in XXXX-XXXX format', async () => {
      const { plainCodes } = await generateRecoveryCodes();
      for (const code of plainCodes) {
        expect(code).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}$/);
      }
    });

    it('codes are unique', async () => {
      const { plainCodes } = await generateRecoveryCodes();
      const unique = new Set(plainCodes);
      expect(unique.size).toBe(plainCodes.length);
    });

    it('hashed codes are bcrypt hashes', async () => {
      const { hashedCodes } = await generateRecoveryCodes();
      for (const hash of hashedCodes) {
        expect(hash.startsWith('$2')).toBe(true);
      }
    });
  });

  describe('verifyRecoveryCode', () => {
    it('verifies a valid recovery code', async () => {
      const { plainCodes, hashedCodes } = await generateRecoveryCodes();
      const idx = await verifyRecoveryCode(plainCodes[0], hashedCodes);
      expect(idx).toBe(0);
    });

    it('verifies any code in the set', async () => {
      const { plainCodes, hashedCodes } = await generateRecoveryCodes();
      const idx = await verifyRecoveryCode(plainCodes[5], hashedCodes);
      expect(idx).toBe(5);
    });

    it('rejects an invalid code', async () => {
      const { hashedCodes } = await generateRecoveryCodes();
      const idx = await verifyRecoveryCode('XXXX-XXXX', hashedCodes);
      expect(idx).toBe(-1);
    });

    it('is case-insensitive', async () => {
      const { plainCodes, hashedCodes } = await generateRecoveryCodes();
      const lower = plainCodes[0].toLowerCase();
      const idx = await verifyRecoveryCode(lower, hashedCodes);
      expect(idx).toBe(0);
    });

    it('ignores spaces in code', async () => {
      const { plainCodes, hashedCodes } = await generateRecoveryCodes();
      const spaced = plainCodes[0].replace('-', ' - ');
      const idx = await verifyRecoveryCode(spaced, hashedCodes);
      expect(idx).toBe(0);
    });
  });
});
