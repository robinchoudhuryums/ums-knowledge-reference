/**
 * Email Service — sends emails via SMTP (Gmail Workspace compatible).
 *
 * Configuration via environment variables:
 *   SMTP_HOST     — SMTP server (default: smtp.gmail.com)
 *   SMTP_PORT     — SMTP port (default: 587)
 *   SMTP_USER     — Email address (e.g., noreply@universalmedsupply.com)
 *   SMTP_PASS     — App-specific password from Google Admin
 *   SMTP_FROM     — From address (defaults to SMTP_USER)
 */

import { createTransport, Transporter } from 'nodemailer';
import { logger } from '../utils/logger';

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!user || !pass) {
    logger.warn('[EMAIL] SMTP_USER and SMTP_PASS not configured — email sending disabled');
    return null;
  }

  transporter = createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });

  logger.info('[EMAIL] SMTP transporter configured', { host, port, user });
  return transporter;
}

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  bcc?: string;
}

export async function sendEmail(options: EmailOptions): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const transport = getTransporter();
  if (!transport) {
    return { success: false, error: 'Email not configured. Set SMTP_USER and SMTP_PASS environment variables.' };
  }

  const from = process.env.SMTP_FROM || process.env.SMTP_USER;

  try {
    const result = await transport.sendMail({
      from,
      to: options.to,
      bcc: options.bcc,
      subject: options.subject,
      html: options.html,
    });

    logger.info('Email sent', { to: options.to, subject: options.subject, messageId: result.messageId });
    return { success: true, messageId: result.messageId };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error('Email send failed', { to: options.to, error: msg });
    return { success: false, error: msg };
  }
}

export function isEmailConfigured(): boolean {
  return !!(process.env.SMTP_USER && process.env.SMTP_PASS);
}
