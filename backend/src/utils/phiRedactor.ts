/**
 * PHI Redaction Utility
 *
 * Detects and redacts potential Protected Health Information (PHI) from text
 * before it is written to logs, query history, or feedback records.
 *
 * Targets the 18 HIPAA identifiers that commonly appear in free text:
 *   - Patient names (best-effort heuristic)
 *   - SSNs
 *   - Phone numbers
 *   - Email addresses
 *   - Dates of birth
 *   - Medical Record Numbers (MRN)
 *   - Medicare/Medicaid Beneficiary IDs
 *   - Street addresses
 *
 * This is a defense-in-depth measure. It does NOT replace staff training
 * on avoiding PHI in queries. Some PHI will inevitably slip through regex.
 */

// SSN patterns: 123-45-6789, 123 45 6789, 123456789
const SSN_PATTERN = /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g;

// Phone numbers: (123) 456-7890, 123-456-7890, 123.456.7890, 1234567890
const PHONE_PATTERN = /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g;

// Email addresses
const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;

// Date of birth patterns: DOB 01/15/1952, DOB: 1/15/52, born on 01-15-1952, date of birth 01/15/1952
const DOB_PATTERN = /(?:DOB|d\.?o\.?b\.?|date\s+of\s+birth|born\s+on|birthdate)[:\s]*\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4}/gi;

// Standalone dates that look like birthdates (MM/DD/YYYY or MM-DD-YYYY with year before 2010)
const DATE_PATTERN = /\b(?:0?[1-9]|1[0-2])[/\-](?:0?[1-9]|[12]\d|3[01])[/\-](?:19\d{2}|200\d)\b/g;

// MRN / Medical Record Number patterns
const MRN_PATTERN = /(?:MRN|medical\s+record(?:\s+number)?|patient\s+(?:id|number|#))[:\s#]*[A-Z0-9-]{4,15}/gi;

// Medicare Beneficiary Identifier (MBI): 1AN9-AA0-AA00 format
const MBI_PATTERN = /\b[1-9][A-Za-z]\w{2}[-\s]?[A-Za-z]\w{2}[-\s]?\w{4}\b/g;

// Medicaid ID: varies by state, but often 8-12 digit numbers prefixed by state context
const MEDICAID_PATTERN = /(?:medicaid|medi-cal)\s*(?:id|#|number)?[:\s]*[A-Z0-9]{6,14}/gi;

// Street addresses: number + street name (basic heuristic)
const ADDRESS_PATTERN = /\b\d{1,6}\s+(?:[A-Z][a-z]+\s+){1,3}(?:St(?:reet)?|Ave(?:nue)?|Blvd|Boulevard|Dr(?:ive)?|Rd|Road|Ln|Lane|Ct|Court|Way|Pl(?:ace)?|Cir(?:cle)?)\b\.?/gi;

// Name patterns preceded by common clinical prefixes
// "patient John Smith", "pt: Jane Doe", "for Mary Johnson"
const NAME_PREFIX_PATTERN = /(?:patient|pt|member|beneficiary|claimant|insured|subscriber|enrollee)[:\s]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})/gi;

// "Mr./Mrs./Ms./Dr. Firstname Lastname"
const TITLE_NAME_PATTERN = /(?:Mr|Mrs|Ms|Miss|Dr|Prof)\.?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})/g;

const REDACTION_MARKER = '[REDACTED]';

interface RedactionResult {
  text: string;
  redactionCount: number;
}

/**
 * Redact potential PHI from a text string.
 * Returns the redacted text and a count of redactions made.
 */
export function redactPhi(text: string): RedactionResult {
  if (!text) return { text, redactionCount: 0 };

  let redactionCount = 0;
  let result = text;

  const applyPattern = (pattern: RegExp, label: string): void => {
    const matches = result.match(pattern);
    if (matches) {
      redactionCount += matches.length;
      result = result.replace(pattern, `[${label}]`);
    }
  };

  // Order matters: more specific patterns first, then broader ones

  // SSN (must come before generic number patterns)
  applyPattern(SSN_PATTERN, 'SSN');

  // DOB with keyword context (before generic date)
  applyPattern(DOB_PATTERN, 'DOB');

  // Standalone birthdates
  applyPattern(DATE_PATTERN, 'DATE');

  // MRN / patient IDs
  applyPattern(MRN_PATTERN, 'MRN');

  // Medicare/Medicaid IDs
  applyPattern(MBI_PATTERN, 'MBI');
  applyPattern(MEDICAID_PATTERN, 'MEDICAID-ID');

  // Contact info
  applyPattern(EMAIL_PATTERN, 'EMAIL');
  applyPattern(PHONE_PATTERN, 'PHONE');

  // Addresses
  applyPattern(ADDRESS_PATTERN, 'ADDRESS');

  // Names with clinical context
  applyPattern(NAME_PREFIX_PATTERN, 'NAME');
  applyPattern(TITLE_NAME_PATTERN, 'NAME');

  return { text: result, redactionCount };
}

/**
 * Redact PHI from an object's string fields (shallow).
 * Useful for redacting multiple fields at once.
 */
export function redactPhiFields<T extends Record<string, unknown>>(
  obj: T,
  fields: (keyof T)[]
): { redacted: T; totalRedactions: number } {
  const redacted = { ...obj };
  let totalRedactions = 0;

  for (const field of fields) {
    const value = redacted[field];
    if (typeof value === 'string') {
      const result = redactPhi(value);
      (redacted as Record<string, unknown>)[field as string] = result.text;
      totalRedactions += result.redactionCount;
    }
  }

  return { redacted, totalRedactions };
}
