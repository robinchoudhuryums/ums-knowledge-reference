/**
 * Helmet CSP directive builder, extracted so the branching logic for
 * `EMBED_ALLOWED_ORIGIN` can be unit-tested without booting the full
 * server. server.ts is the only consumer.
 */

// Helmet's `contentSecurityPolicy.directives` expects a Record-indexed
// shape, so we return a simple Record<string, string[]>. Named fields are
// still documented here via the comment above each key in the function
// body below.
export type CspDirectiveSet = Record<string, string[]>;

/**
 * Assemble the CSP directives RAG emits in production. When
 * `embedAllowedOrigin` is set (e.g. `https://umscallanalyzer.com`), the
 * origin is added to `frame-ancestors` alongside `'self'` so CallAnalyzer
 * can iframe RAG's embed route. Unset = `frame-ancestors 'none'`
 * (default-deny framing, current behavior).
 */
export function buildCspDirectives(embedAllowedOrigin: string): CspDirectiveSet {
  return {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'"], // React inline styles
    imgSrc: ["'self'", 'data:', 'blob:'],
    fontSrc: ["'self'", 'https://fonts.gstatic.com'],
    connectSrc: ["'self'"],
    frameSrc: ["'none'"],
    frameAncestors: embedAllowedOrigin
      ? ["'self'", embedAllowedOrigin]
      : ["'none'"],
    objectSrc: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
  };
}

/**
 * Helmet's `frameguard` sets `X-Frame-Options`. Modern browsers prefer
 * CSP `frame-ancestors` over XFO; when both are set the stricter wins
 * and our XFO would override CSP's allowance. Disable XFO when embedding
 * is enabled so CSP is the sole authority.
 */
export function shouldDisableFrameguard(embedAllowedOrigin: string): boolean {
  return Boolean(embedAllowedOrigin);
}

/**
 * Narrow CSP header value for dev mode — just the `frame-ancestors`
 * directive, nothing else. The full CSP is intentionally disabled in
 * dev (helmet.contentSecurityPolicy=false) because Vite HMR needs
 * 'unsafe-eval' and other exemptions the prod policy forbids. But
 * disabling the whole policy also drops `frame-ancestors`, which means
 * a dev instance with EMBED_ALLOWED_ORIGIN set would be framable by
 * ANY origin — weaker than prod and pointlessly so. This helper
 * produces just the frame-ancestors string so dev can emit it via a
 * targeted middleware and preserve the allowlist invariant.
 *
 * Returns empty string when no origin is configured; caller should
 * skip the middleware entirely in that case.
 */
export function devFrameAncestorsHeader(embedAllowedOrigin: string): string {
  if (!embedAllowedOrigin) return '';
  return `frame-ancestors 'self' ${embedAllowedOrigin}`;
}
