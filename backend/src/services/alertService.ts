/**
 * Operational Alert Service
 *
 * Sends email notifications for critical operational failures that would
 * otherwise be silent. Throttles alerts to prevent email storms.
 *
 * Configuration:
 *   ALERT_EMAIL — recipient for operational alerts (defaults to SMTP_FROM/SMTP_USER)
 *   Requires SMTP_USER + SMTP_PASS to be configured (same as emailService)
 *
 * Alert categories:
 *   - audit_write_failed: Audit log entry permanently lost after retries
 *   - reindex_failed: Document re-index failed, stale content may be served
 *   - ingestion_failed: Source monitor ingestion failed
 *   - source_stale: A monitored source hasn't changed in longer than its
 *     expected update cadence — may indicate a broken upstream URL
 */

import { sendEmail, isEmailConfigured } from './emailService';
import { logger } from '../utils/logger';
import { escapeHtml } from '../utils/htmlEscape';

// Throttle: at most one alert per category per cooldown period
const ALERT_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour
const lastAlertTime = new Map<string, number>();

type AlertCategory = 'audit_write_failed' | 'reindex_failed' | 'ingestion_failed' | 'source_stale';

/**
 * Send an operational alert email if not throttled.
 * Fire-and-forget — never throws.
 */
export async function sendOperationalAlert(
  category: AlertCategory,
  subject: string,
  details: Record<string, unknown>
): Promise<void> {
  try {
    // Check throttle
    const now = Date.now();
    const lastSent = lastAlertTime.get(category);
    if (lastSent && now - lastSent < ALERT_COOLDOWN_MS) {
      return; // Throttled
    }

    if (!isEmailConfigured()) {
      // Log at error level so structured log aggregation can pick it up
      logger.error(`[ALERT:${category}] ${subject}`, details);
      return;
    }

    const recipient = process.env.ALERT_EMAIL || process.env.SMTP_FROM || process.env.SMTP_USER;
    if (!recipient) return;

    const detailsHtml = Object.entries(details)
      .map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;font-weight:bold;">${escapeHtml(k)}</td><td style="padding:4px 0;">${escapeHtml(String(v))}</td></tr>`)
      .join('');

    const html = `
      <div style="font-family:sans-serif;max-width:600px;">
        <h2 style="color:#c0392b;">UMS Knowledge Base — Operational Alert</h2>
        <p style="font-size:16px;"><strong>${escapeHtml(subject)}</strong></p>
        <table style="font-size:14px;border-collapse:collapse;">${detailsHtml}</table>
        <p style="color:#888;font-size:12px;margin-top:20px;">
          Category: ${escapeHtml(category)} | Sent at: ${new Date().toISOString()} | Throttle: 1 alert/hour per category
        </p>
      </div>
    `;

    lastAlertTime.set(category, now);
    const result = await sendEmail({
      to: recipient,
      subject: `[UMS Alert] ${subject}`,
      html,
    });

    if (!result.success) {
      logger.error(`[ALERT:${category}] Failed to send alert email`, { error: result.error, subject });
    }
  } catch (err) {
    // Never throw from alerting — it's best-effort
    logger.error(`[ALERT:${category}] Alert service error`, { error: String(err) });
  }
}
