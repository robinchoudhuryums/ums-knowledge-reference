/**
 * Sentry Error Tracking Service
 *
 * Provides server-side error tracking with PHI-safe scrubbing.
 * Only initializes if SENTRY_DSN is set — no-op otherwise.
 *
 * HIPAA: Scrubs potential PHI from error reports before sending.
 * Request bodies, cookies, and query strings are stripped entirely.
 *
 * Ported from assemblyai_tool/server/services/sentry.ts.
 */

import * as Sentry from '@sentry/node';

const PHI_PATTERNS = [
  /\b\d{3}-\d{2}-\d{4}\b/g,          // SSN
  /\b\d{10,11}\b/g,                    // Phone numbers
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, // Email
  /\b(?:patient|member|subscriber|caller)\s*(?:name|id)?[\s:]+\S+/gi,
  /\b(?:MRN|mrn|acct|account)[:\s#]*[A-Z0-9]{4,20}\b/gi,
  /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g,                     // Dates
  /\b\d{1,5}\s+\w+\s+(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Dr|Drive|Ln|Lane|Ct|Way)\b/gi,
  /\b(?:DOB|dob|date of birth)[:\s]+\S+/gi,
];

function scrubPHI(text: string): string {
  let scrubbed = text;
  for (const pattern of PHI_PATTERNS) {
    scrubbed = scrubbed.replace(pattern, '[REDACTED]');
  }
  return scrubbed;
}

let initialized = false;

export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    release: process.env.npm_package_version || 'unknown',
    tracesSampleRate: 0.1,
    beforeSend(event) {
      // HIPAA: Scrub PHI from error messages and exception values
      if (event.message) event.message = scrubPHI(event.message);
      if (event.exception?.values) {
        for (const ex of event.exception.values) {
          if (ex.value) ex.value = scrubPHI(ex.value);
        }
      }
      // Remove request body, cookies, query strings (may contain PHI)
      if (event.request) {
        delete event.request.data;
        delete event.request.cookies;
        if (event.request.query_string) event.request.query_string = '[REDACTED]';
      }
      // Scrub breadcrumb messages
      if (event.breadcrumbs) {
        for (const crumb of event.breadcrumbs) {
          if (crumb.message) crumb.message = scrubPHI(crumb.message);
          if (crumb.data && typeof crumb.data === 'object') {
            for (const [key, value] of Object.entries(crumb.data)) {
              if (typeof value === 'string') {
                (crumb.data as Record<string, unknown>)[key] = scrubPHI(value);
              }
            }
          }
        }
      }
      // Scrub document/query IDs from URLs
      if (event.request?.url) {
        event.request.url = event.request.url
          .replace(/\/api\/documents\/[0-9a-f-]+/gi, '/api/documents/[REDACTED]')
          .replace(/\/api\/query-log\/[0-9a-f-]+/gi, '/api/query-log/[REDACTED]');
      }
      return event;
    },
    ignoreErrors: ['ECONNRESET', 'EPIPE', 'socket hang up', 'aborted'],
  });

  initialized = true;
  console.log('[SENTRY] Error tracking initialized.');
}

export function captureException(error: Error, context?: Record<string, unknown>): void {
  if (!initialized) return;
  if (context) {
    const safeContext: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(context)) {
      safeContext[key] = typeof value === 'string' ? scrubPHI(value) : value;
    }
    Sentry.captureException(error, { extra: safeContext });
  } else {
    Sentry.captureException(error);
  }
}

export function captureMessage(message: string, level: 'info' | 'warning' | 'error' = 'info'): void {
  if (!initialized) return;
  Sentry.captureMessage(scrubPHI(message), level);
}
