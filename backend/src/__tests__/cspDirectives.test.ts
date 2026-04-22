/**
 * Tests for the CSP directive builder. Exercises the two branches:
 *   - EMBED_ALLOWED_ORIGIN unset → frame-ancestors 'none' + XFO enforced
 *   - EMBED_ALLOWED_ORIGIN set → frame-ancestors includes it + XFO disabled
 */

import { describe, it, expect } from 'vitest';
import {
  buildCspDirectives,
  shouldDisableFrameguard,
  devFrameAncestorsHeader,
} from '../middleware/cspDirectives';

describe('buildCspDirectives', () => {
  it('locks frame-ancestors to "none" when EMBED_ALLOWED_ORIGIN is unset', () => {
    const d = buildCspDirectives('');
    expect(d.frameAncestors).toEqual(["'none'"]);
  });

  it('allows the configured origin (and self) in frame-ancestors', () => {
    const d = buildCspDirectives('https://umscallanalyzer.com');
    expect(d.frameAncestors).toEqual([
      "'self'",
      'https://umscallanalyzer.com',
    ]);
  });

  it('never weakens the hard denylist directives (frame-src, object-src)', () => {
    const off = buildCspDirectives('');
    const on = buildCspDirectives('https://umscallanalyzer.com');
    for (const d of [off, on]) {
      expect(d.frameSrc).toEqual(["'none'"]);
      expect(d.objectSrc).toEqual(["'none'"]);
    }
  });

  it('preserves default-deny defaults across the rest of the policy', () => {
    const d = buildCspDirectives('https://umscallanalyzer.com');
    expect(d.defaultSrc).toEqual(["'self'"]);
    expect(d.connectSrc).toEqual(["'self'"]);
    expect(d.baseUri).toEqual(["'self'"]);
    expect(d.formAction).toEqual(["'self'"]);
  });
});

describe('shouldDisableFrameguard', () => {
  it('keeps XFO enforced when no embed origin is set', () => {
    expect(shouldDisableFrameguard('')).toBe(false);
  });

  it('disables XFO when embedding is allowed so CSP is the sole authority', () => {
    expect(shouldDisableFrameguard('https://umscallanalyzer.com')).toBe(true);
  });
});

describe('devFrameAncestorsHeader', () => {
  it('returns empty string when no origin is set (caller skips middleware)', () => {
    expect(devFrameAncestorsHeader('')).toBe('');
  });

  it('builds a narrow frame-ancestors-only CSP value', () => {
    expect(
      devFrameAncestorsHeader('https://umscallanalyzer.com'),
    ).toBe("frame-ancestors 'self' https://umscallanalyzer.com");
  });

  it('never introduces other directives that would break Vite HMR', () => {
    const value = devFrameAncestorsHeader('https://umscallanalyzer.com');
    // Explicitly assert neither default-src nor script-src are present;
    // adding them would break 'unsafe-eval' that Vite HMR needs in dev.
    expect(value).not.toContain('default-src');
    expect(value).not.toContain('script-src');
  });
});
