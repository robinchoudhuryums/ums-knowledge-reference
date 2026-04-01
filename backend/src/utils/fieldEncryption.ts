/**
 * Application-layer field encryption for sensitive data at rest.
 *
 * Uses AES-256-GCM for authenticated encryption. Each encrypted value
 * includes a random IV and auth tag, so identical plaintexts produce
 * different ciphertexts (no deterministic patterns).
 *
 * Format: base64(iv:ciphertext:authTag)
 *
 * Configuration:
 *   FIELD_ENCRYPTION_KEY — 64-char hex string (32 bytes = 256 bits)
 *   If not set, encryption is disabled (values stored in plaintext).
 *   Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */

import crypto from 'crypto';
import { logger } from './logger';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits — recommended for GCM
const AUTH_TAG_LENGTH = 16; // 128 bits

let encryptionKey: Buffer | null = null;

function getKey(): Buffer | null {
  if (encryptionKey) return encryptionKey;

  const keyHex = process.env.FIELD_ENCRYPTION_KEY;
  if (!keyHex) return null;

  if (keyHex.length !== 64) {
    logger.error('FIELD_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes). Field encryption disabled.');
    return null;
  }

  try {
    encryptionKey = Buffer.from(keyHex, 'hex');
    return encryptionKey;
  } catch {
    logger.error('FIELD_ENCRYPTION_KEY is not valid hex. Field encryption disabled.');
    return null;
  }
}

/**
 * Encrypt a plaintext string. Returns base64-encoded ciphertext.
 * If encryption key is not configured, returns the plaintext unchanged.
 */
export function encryptField(plaintext: string): string {
  const key = getKey();
  if (!key) return plaintext;

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Format: iv:ciphertext:authTag (all base64)
  return `enc:${iv.toString('base64')}:${encrypted.toString('base64')}:${authTag.toString('base64')}`;
}

/**
 * Decrypt a ciphertext string. Returns the original plaintext.
 * If the value doesn't start with "enc:", assumes it's unencrypted (migration support).
 * If encryption key is not configured, returns the value unchanged.
 */
export function decryptField(ciphertext: string): string {
  // Unencrypted values pass through (supports migration from plaintext)
  if (!ciphertext.startsWith('enc:')) return ciphertext;

  const key = getKey();
  if (!key) {
    logger.warn('Encrypted field found but FIELD_ENCRYPTION_KEY not set — cannot decrypt');
    return '[encrypted]';
  }

  try {
    const parts = ciphertext.slice(4).split(':');
    if (parts.length !== 3) throw new Error('Invalid encrypted field format');

    const iv = Buffer.from(parts[0], 'base64');
    const encrypted = Buffer.from(parts[1], 'base64');
    const authTag = Buffer.from(parts[2], 'base64');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
    decipher.setAuthTag(authTag);

    return decipher.update(encrypted) + decipher.final('utf8');
  } catch (err) {
    logger.error('Failed to decrypt field', { error: String(err) });
    return '[decryption-failed]';
  }
}
