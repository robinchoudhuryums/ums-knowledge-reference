/**
 * Multi-Factor Authentication (MFA) Service
 *
 * TOTP-based 2FA using the otpauth library (RFC 6238).
 * Compatible with Google Authenticator, Authy, 1Password, etc.
 *
 * Flow:
 * 1. User calls POST /api/auth/mfa/setup → receives secret + otpauth URI
 * 2. User scans QR code in authenticator app
 * 3. User calls POST /api/auth/mfa/verify with a code → MFA is enabled
 * 4. On subsequent logins, after password check, user must provide TOTP code
 * 5. Admin can disable MFA for a user via PUT /api/users/:id/mfa
 */

import { TOTP, Secret } from 'otpauth';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { encryptField, decryptField } from '../utils/fieldEncryption';

const ISSUER = 'UMS Knowledge Base';
const ALGORITHM = 'SHA1';
const DIGITS = 6;
const PERIOD = 30; // seconds

/**
 * Generate a new TOTP secret for a user.
 * Returns the secret (base32) and the otpauth URI for QR code generation.
 */
export function generateMfaSecret(username: string): { secret: string; uri: string; rawSecret: string } {
  const secret = new Secret({ size: 20 }); // 160-bit secret

  const totp = new TOTP({
    issuer: ISSUER,
    label: username,
    algorithm: ALGORITHM,
    digits: DIGITS,
    period: PERIOD,
    secret,
  });

  return {
    // Encrypt the secret before storage; the raw base32 is returned to the user
    // for authenticator app setup, but stored encrypted in the database.
    secret: encryptField(secret.base32),
    uri: totp.toString(),
    // Raw secret for display to user (NOT stored — only shown once during setup)
    rawSecret: secret.base32,
  };
}

/**
 * Verify a TOTP code against a stored secret.
 * Allows a 1-period window (±30s) to account for clock drift.
 */
export function verifyMfaCode(storedSecret: string, code: string): boolean {
  // Decrypt the secret if it was encrypted at rest
  const secret = decryptField(storedSecret);

  const totp = new TOTP({
    issuer: ISSUER,
    algorithm: ALGORITHM,
    digits: DIGITS,
    period: PERIOD,
    secret: Secret.fromBase32(secret),
  });

  // delta = null means invalid, delta = 0 means current period, ±1 means adjacent
  const delta = totp.validate({ token: code, window: 1 });
  return delta !== null;
}

// ─── Recovery Codes ─────────────────────────────────────────────────────────

const RECOVERY_CODE_COUNT = 10;

/**
 * Generate 10 recovery codes (8-char alphanumeric, grouped as XXXX-XXXX).
 * Returns both the plaintext codes (shown to user once) and bcrypt hashes (stored).
 */
export async function generateRecoveryCodes(): Promise<{ plainCodes: string[]; hashedCodes: string[] }> {
  const plainCodes: string[] = [];
  const hashedCodes: string[] = [];

  for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
    // Generate 4 random bytes → 8 hex chars → split into XXXX-XXXX format
    const raw = crypto.randomBytes(4).toString('hex').toUpperCase();
    const code = `${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
    plainCodes.push(code);
    // Hash with low cost (4) since these are high-entropy random codes
    hashedCodes.push(await bcrypt.hash(code, 4));
  }

  return { plainCodes, hashedCodes };
}

/**
 * Verify a recovery code against the stored hashed codes.
 * Returns the index of the matched code (for removal), or -1 if no match.
 */
export async function verifyRecoveryCode(code: string, hashedCodes: string[]): Promise<number> {
  // Normalize: strip spaces, uppercase
  const normalized = code.replace(/\s/g, '').toUpperCase();

  for (let i = 0; i < hashedCodes.length; i++) {
    if (await bcrypt.compare(normalized, hashedCodes[i])) {
      return i;
    }
  }
  return -1;
}
