/**
 * HTML escaping utility to prevent XSS in dynamically generated HTML
 * (e.g., email templates that interpolate user-provided data).
 */

const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

const HTML_ESCAPE_RE = /[&<>"']/g;

/**
 * Escape a string for safe interpolation into HTML content.
 * Converts &, <, >, ", ' to their HTML entity equivalents.
 */
export function escapeHtml(str: string): string {
  if (!str) return '';
  return str.replace(HTML_ESCAPE_RE, ch => HTML_ESCAPE_MAP[ch]);
}
