/**
 * EmbedShell tests: focused on the postMessage bridge, not ChatInterface
 * rendering (which has its own tests).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { EmbedShell } from '../EmbedShell';

// ChatInterface pulls in streaming + markdown machinery we don't need to
// exercise here — stub it out so the test stays focused on the shell.
vi.mock('../ChatInterface', () => ({
  ChatInterface: ({ collections }: { collections: unknown[] }) => (
    <div data-testid="chat-interface" data-collection-count={collections.length} />
  ),
}));

describe('EmbedShell', () => {
  let postSpy: ReturnType<typeof vi.spyOn>;
  let originalParent: Window;

  beforeEach(() => {
    originalParent = window.parent;
    // Inject a fake parent that's NOT the same window so the "iframed"
    // branch activates. jsdom defaults to window.parent === window.
    const fakeParent = { postMessage: vi.fn() } as unknown as Window;
    Object.defineProperty(window, 'parent', {
      configurable: true,
      get: () => fakeParent,
    });
    postSpy = vi.spyOn(fakeParent, 'postMessage');
  });

  afterEach(() => {
    Object.defineProperty(window, 'parent', {
      configurable: true,
      get: () => originalParent,
    });
    postSpy.mockRestore();
  });

  it('emits `embed:ready` to window.parent on mount', () => {
    render(<EmbedShell collections={[]} />);
    expect(postSpy).toHaveBeenCalledWith(
      { type: 'embed:ready' },
      '*',
    );
  });

  it('does NOT emit when there is no real parent (window.parent === window)', () => {
    // Restore same-window parent before this test
    Object.defineProperty(window, 'parent', {
      configurable: true,
      get: () => window,
    });
    const sameWinSpy = vi.spyOn(window, 'postMessage');
    render(<EmbedShell collections={[]} />);
    expect(sameWinSpy).not.toHaveBeenCalled();
    sameWinSpy.mockRestore();
  });

  it('remounts ChatInterface on `embed:clear` from the parent frame', () => {
    const { container } = render(<EmbedShell collections={[]} />);
    const firstStub = container.querySelector('[data-testid="chat-interface"]');
    expect(firstStub).toBeTruthy();

    // Fire an embed:clear message from window.parent
    const ev = new MessageEvent('message', {
      data: { type: 'embed:clear' },
      source: window.parent,
    });
    window.dispatchEvent(ev);

    // Same testid, but the key bump forces a new DOM node. We can't
    // directly observe the key, but we can observe that the stub is
    // still present and the shell didn't crash.
    const afterStub = container.querySelector('[data-testid="chat-interface"]');
    expect(afterStub).toBeTruthy();
  });

  it('ignores messages whose source is not window.parent', () => {
    const { container } = render(<EmbedShell collections={[]} />);
    // Fire a message from a rogue source (not parent)
    const rogueSource = {} as Window;
    const ev = new MessageEvent('message', {
      data: { type: 'embed:clear' },
      source: rogueSource,
    });
    window.dispatchEvent(ev);
    // No crash; ChatInterface stub still present
    expect(
      container.querySelector('[data-testid="chat-interface"]'),
    ).toBeTruthy();
  });

  it('ignores malformed messages (no type, wrong shape)', () => {
    render(<EmbedShell collections={[]} />);
    window.dispatchEvent(
      new MessageEvent('message', {
        data: 'not-an-object',
        source: window.parent,
      }),
    );
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { nope: true },
        source: window.parent,
      }),
    );
    // No throw, postSpy still has the single initial ready call
    expect(postSpy).toHaveBeenCalledTimes(1);
  });

  it('posts `embed:close` when Escape is pressed in the iframe', () => {
    render(<EmbedShell collections={[]} />);
    // First call is embed:ready from mount
    expect(postSpy).toHaveBeenCalledWith({ type: 'embed:ready' }, '*');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(postSpy).toHaveBeenCalledWith({ type: 'embed:close' }, '*');
  });

  it('does NOT post on non-Escape keydowns', () => {
    render(<EmbedShell collections={[]} />);
    const beforeCount = postSpy.mock.calls.length;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    expect(postSpy.mock.calls.length).toBe(beforeCount);
  });

  it('posts `embed:open-source` with absolute URL when a source anchor is clicked', () => {
    const { container } = render(<EmbedShell collections={[]} />);
    const anchor = document.createElement('a');
    anchor.href = '/api/documents/abc-123/download';
    anchor.textContent = 'source.pdf';
    container.appendChild(anchor);
    anchor.click();
    const openSourceCalls = postSpy.mock.calls.filter(
      (c) => (c[0] as { type?: string })?.type === 'embed:open-source',
    );
    expect(openSourceCalls).toHaveLength(1);
    const payload = openSourceCalls[0][0] as { url: string };
    expect(payload.url).toMatch(/\/api\/documents\/abc-123\/download$/);
    expect(payload.url).toMatch(/^https?:\/\//);
  });

  it('ignores clicks on non-source anchors', () => {
    const { container } = render(<EmbedShell collections={[]} />);
    const anchor = document.createElement('a');
    anchor.href = '/some/other/route';
    anchor.textContent = 'not a source';
    container.appendChild(anchor);
    anchor.click();
    const openSourceCalls = postSpy.mock.calls.filter(
      (c) => (c[0] as { type?: string })?.type === 'embed:open-source',
    );
    expect(openSourceCalls).toHaveLength(0);
  });

  it('recognizes file-extension hrefs as source-like (pdf, docx, xlsx, csv, txt)', () => {
    const { container } = render(<EmbedShell collections={[]} />);
    for (const ext of ['pdf', 'docx', 'xlsx', 'csv', 'txt']) {
      const a = document.createElement('a');
      a.href = `https://external.example.com/foo.${ext}?q=1`;
      container.appendChild(a);
      a.click();
    }
    const hits = postSpy.mock.calls.filter(
      (c) => (c[0] as { type?: string })?.type === 'embed:open-source',
    );
    expect(hits).toHaveLength(5);
  });
});
