import { describe, it, expect } from 'vitest';
import { escapeHtml } from '../utils/htmlEscape';

describe('escapeHtml', () => {
  it('returns empty string for empty input', () => {
    expect(escapeHtml('')).toBe('');
  });

  it('returns empty string for null-ish input', () => {
    // The function checks `if (!str)` so falsy values return ''
    expect(escapeHtml(undefined as unknown as string)).toBe('');
    expect(escapeHtml(null as unknown as string)).toBe('');
  });

  it('passes through a string with no special characters', () => {
    expect(escapeHtml('Hello world 123')).toBe('Hello world 123');
  });

  it('escapes ampersand', () => {
    expect(escapeHtml('A&B')).toBe('A&amp;B');
  });

  it('escapes less-than', () => {
    expect(escapeHtml('a < b')).toBe('a &lt; b');
  });

  it('escapes greater-than', () => {
    expect(escapeHtml('a > b')).toBe('a &gt; b');
  });

  it('escapes double quote', () => {
    expect(escapeHtml('say "hi"')).toBe('say &quot;hi&quot;');
  });

  it('escapes single quote', () => {
    expect(escapeHtml("it's")).toBe('it&#39;s');
  });

  it('escapes all special chars in a combined string', () => {
    expect(escapeHtml('<div class="a" data-x=\'b\'>&</div>')).toBe(
      '&lt;div class=&quot;a&quot; data-x=&#39;b&#39;&gt;&amp;&lt;/div&gt;'
    );
  });

  it('handles multiple consecutive special characters', () => {
    expect(escapeHtml('<<>>&""\'\'')).toBe(
      '&lt;&lt;&gt;&gt;&amp;&quot;&quot;&#39;&#39;'
    );
  });

  it('double-escapes already-escaped entities', () => {
    expect(escapeHtml('&amp;')).toBe('&amp;amp;');
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
    expect(escapeHtml('&gt;')).toBe('&amp;gt;');
  });
});
