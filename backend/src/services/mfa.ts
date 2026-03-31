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

const ISSUER = 'UMS Knowledge Base';
const ALGORITHM = 'SHA1';
const DIGITS = 6;
const PERIOD = 30; // seconds

/**
 * Generate a new TOTP secret for a user.
 * Returns the secret (base32) and the otpauth URI for QR code generation.
 */
export function generateMfaSecret(username: string): { secret: string; uri: string } {
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
    secret: secret.base32,
    uri: totp.toString(),
  };
}

/**
 * Verify a TOTP code against a stored secret.
 * Allows a 1-period window (±30s) to account for clock drift.
 */
export function verifyMfaCode(secret: string, code: string): boolean {
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
