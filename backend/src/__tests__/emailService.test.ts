import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock nodemailer at the module level
const mockSendMail = vi.fn().mockResolvedValue({ messageId: 'test-msg-id' });
vi.mock('nodemailer', () => ({
  createTransport: vi.fn(() => ({
    sendMail: mockSendMail,
  })),
}));

// Mock logger to suppress output
vi.mock('../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('Email Service', () => {
  let sendEmail: typeof import('../services/emailService').sendEmail;

  beforeEach(async () => {
    process.env.SMTP_USER = 'test@test.com';
    process.env.SMTP_PASS = 'pass';
    mockSendMail.mockClear();
    // Re-import to reset the cached transporter
    vi.resetModules();
    vi.doMock('nodemailer', () => ({
      createTransport: vi.fn(() => ({
        sendMail: mockSendMail,
      })),
    }));
    vi.doMock('../utils/logger', () => ({
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    }));
    const mod = await import('../services/emailService');
    sendEmail = mod.sendEmail;
  });

  afterEach(() => {
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_FROM;
  });

  describe('isValidEmail (tested indirectly via sendEmail)', () => {
    it('should reject empty string as recipient', async () => {
      const result = await sendEmail({ to: '', subject: 'Test', html: '<p>Hi</p>' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid recipient email address');
      expect(mockSendMail).not.toHaveBeenCalled();
    });

    it('should reject email longer than 254 characters', async () => {
      const longEmail = 'a'.repeat(243) + '@example.com'; // 255 chars
      const result = await sendEmail({ to: longEmail, subject: 'Test', html: '<p>Hi</p>' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid recipient email address');
      expect(mockSendMail).not.toHaveBeenCalled();
    });

    it('should reject email with newlines (header injection)', async () => {
      const result = await sendEmail({ to: 'user@example.com\r\nBcc: evil@evil.com', subject: 'Test', html: '<p>Hi</p>' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid recipient email address');
      expect(mockSendMail).not.toHaveBeenCalled();
    });

    it('should reject email with control characters', async () => {
      const result = await sendEmail({ to: 'user\x00@example.com', subject: 'Test', html: '<p>Hi</p>' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid recipient email address');
      expect(mockSendMail).not.toHaveBeenCalled();
    });

    it('should reject email missing @ sign', async () => {
      const result = await sendEmail({ to: 'userexample.com', subject: 'Test', html: '<p>Hi</p>' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid recipient email address');
      expect(mockSendMail).not.toHaveBeenCalled();
    });

    it('should reject email missing domain', async () => {
      const result = await sendEmail({ to: 'user@', subject: 'Test', html: '<p>Hi</p>' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid recipient email address');
      expect(mockSendMail).not.toHaveBeenCalled();
    });

    it('should accept a normal email address', async () => {
      const result = await sendEmail({ to: 'user@example.com', subject: 'Test', html: '<p>Hi</p>' });
      expect(result.success).toBe(true);
      expect(result.messageId).toBe('test-msg-id');
      expect(mockSendMail).toHaveBeenCalledOnce();
    });

    it('should accept email with plus tag and multi-part TLD', async () => {
      const result = await sendEmail({ to: 'user+tag@domain.co.uk', subject: 'Test', html: '<p>Hi</p>' });
      expect(result.success).toBe(true);
      expect(result.messageId).toBe('test-msg-id');
      expect(mockSendMail).toHaveBeenCalledOnce();
    });
  });

  describe('BCC validation', () => {
    it('should skip invalid BCC silently without failing', async () => {
      const result = await sendEmail({
        to: 'user@example.com',
        subject: 'Test',
        html: '<p>Hi</p>',
        bcc: 'not-an-email',
      });
      expect(result.success).toBe(true);
      expect(mockSendMail).toHaveBeenCalledOnce();
      // BCC should not be passed to sendMail (it was cleared to undefined)
      const callArgs = mockSendMail.mock.calls[0][0];
      expect(callArgs.bcc).toBeUndefined();
    });
  });

  describe('SMTP not configured', () => {
    it('should return error when SMTP_USER is missing', async () => {
      delete process.env.SMTP_USER;
      // Re-import to get fresh module without cached transporter
      vi.resetModules();
      vi.doMock('nodemailer', () => ({
        createTransport: vi.fn(() => ({
          sendMail: mockSendMail,
        })),
      }));
      vi.doMock('../utils/logger', () => ({
        logger: {
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
        },
      }));
      const mod = await import('../services/emailService');
      const result = await mod.sendEmail({ to: 'user@example.com', subject: 'Test', html: '<p>Hi</p>' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Email not configured');
      expect(mockSendMail).not.toHaveBeenCalled();
    });

    it('should return error when SMTP_PASS is missing', async () => {
      delete process.env.SMTP_PASS;
      vi.resetModules();
      vi.doMock('nodemailer', () => ({
        createTransport: vi.fn(() => ({
          sendMail: mockSendMail,
        })),
      }));
      vi.doMock('../utils/logger', () => ({
        logger: {
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
        },
      }));
      const mod = await import('../services/emailService');
      const result = await mod.sendEmail({ to: 'user@example.com', subject: 'Test', html: '<p>Hi</p>' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Email not configured');
      expect(mockSendMail).not.toHaveBeenCalled();
    });
  });
});
