/**
 * Tests for field-level encryption (AES-256-GCM).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Store original env
const originalEnv = { ...process.env };

describe('Field Encryption', () => {
  beforeEach(() => {
    // Reset module cache so env changes take effect
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('passes through plaintext when FIELD_ENCRYPTION_KEY is not set', async () => {
    delete process.env.FIELD_ENCRYPTION_KEY;
    const { encryptField, decryptField } = await import('../utils/fieldEncryption');
    const plain = 'JBSWY3DPEHPK3PXP';
    expect(encryptField(plain)).toBe(plain);
    expect(decryptField(plain)).toBe(plain);
  });

  it('encrypts and decrypts round-trip correctly', async () => {
    process.env.FIELD_ENCRYPTION_KEY = 'a'.repeat(64); // 32 bytes hex
    const { encryptField, decryptField } = await import('../utils/fieldEncryption');

    const plain = 'JBSWY3DPEHPK3PXP';
    const encrypted = encryptField(plain);

    expect(encrypted).not.toBe(plain);
    expect(encrypted.startsWith('enc:')).toBe(true);
    expect(decryptField(encrypted)).toBe(plain);
  });

  it('produces different ciphertext for same plaintext (random IV)', async () => {
    process.env.FIELD_ENCRYPTION_KEY = 'b'.repeat(64);
    const { encryptField } = await import('../utils/fieldEncryption');

    const plain = 'test-secret-value';
    const enc1 = encryptField(plain);
    const enc2 = encryptField(plain);

    expect(enc1).not.toBe(enc2); // Random IV means different ciphertext each time
  });

  it('decrypts unencrypted values as passthrough (migration support)', async () => {
    process.env.FIELD_ENCRYPTION_KEY = 'c'.repeat(64);
    const { decryptField } = await import('../utils/fieldEncryption');

    // Value without "enc:" prefix passes through unchanged
    expect(decryptField('JBSWY3DPEHPK3PXP')).toBe('JBSWY3DPEHPK3PXP');
  });

  it('returns placeholder when encrypted value found but no key set', async () => {
    delete process.env.FIELD_ENCRYPTION_KEY;
    const { decryptField } = await import('../utils/fieldEncryption');

    expect(decryptField('enc:abc:def:ghi')).toBe('[encrypted]');
  });

  it('handles empty string', async () => {
    process.env.FIELD_ENCRYPTION_KEY = 'd'.repeat(64);
    const { encryptField, decryptField } = await import('../utils/fieldEncryption');

    const encrypted = encryptField('');
    expect(decryptField(encrypted)).toBe('');
  });

  it('handles unicode text', async () => {
    process.env.FIELD_ENCRYPTION_KEY = 'e'.repeat(64);
    const { encryptField, decryptField } = await import('../utils/fieldEncryption');

    const unicode = '日本語テスト 🔐';
    const encrypted = encryptField(unicode);
    expect(decryptField(encrypted)).toBe(unicode);
  });

  it('rejects invalid key length', async () => {
    process.env.FIELD_ENCRYPTION_KEY = 'too-short';
    const { encryptField } = await import('../utils/fieldEncryption');

    // Should passthrough (key invalid, encryption disabled)
    expect(encryptField('test')).toBe('test');
  });

  it('detects tampered ciphertext', async () => {
    process.env.FIELD_ENCRYPTION_KEY = 'f'.repeat(64);
    const { encryptField, decryptField } = await import('../utils/fieldEncryption');

    const encrypted = encryptField('secret');
    // Tamper with the ciphertext
    const parts = encrypted.split(':');
    parts[2] = 'AAAA' + parts[2].slice(4); // corrupt ciphertext
    const tampered = parts.join(':');

    expect(decryptField(tampered)).toBe('[decryption-failed]');
  });
});
