/**
 * EmbedShell — chrome-free wrapper around ChatInterface used when the app
 * is iframed by a sibling service (currently CallAnalyzer on `.umscallanalyzer.com`).
 *
 * Mounted when the URL has `?embed=1`. Emits `embed:ready` on mount so the
 * parent frame can reveal the panel, and listens for `embed:clear` to
 * remount ChatInterface (dropping its internal history).
 *
 * Outbound postMessage vocabulary:
 *   - embed:ready               → fired on mount so parent can reveal UI
 *   - embed:close               → fired on Escape so parent closes its drawer
 *                                 (Escape inside the iframe doesn't bubble to
 *                                 the parent window naturally)
 *   - embed:open-source { url } → fired when the user clicks a source
 *                                 citation link; parent opens it in a new
 *                                 tab so PDFs/viewers don't load inside
 *                                 the narrow drawer
 *
 * Origin validation: outbound messages use targetOrigin='*' because the
 * payload is public. Inbound messages are accepted only from the parent
 * frame — the server-side CSP `frame-ancestors` header is the hard gate
 * that prevents unauthorized origins from even loading the iframe.
 */

import { useEffect, useState } from 'react';
import { ChatInterface } from './ChatInterface';
import type { Collection } from '../types';

export function EmbedShell({ collections }: { collections: Collection[] }) {
  const [chatKey, setChatKey] = useState(0);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!window.parent || window.parent === window) return;
    const parent = window.parent;

    parent.postMessage({ type: 'embed:ready' }, '*');

    const handleMessage = (event: MessageEvent) => {
      // Only accept messages from our parent frame. Other iframes or
      // popup windows on the page must not be able to reset chat state.
      if (event.source !== parent) return;
      const data = event.data as { type?: string } | null;
      if (!data || typeof data.type !== 'string') return;
      if (data.type === 'embed:clear') {
        setChatKey((k) => k + 1);
      }
    };

    // Escape inside the iframe → tell parent to close the drawer.
    // keydown doesn't bubble across the iframe boundary, so without
    // this the Escape key is silently swallowed.
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        parent.postMessage({ type: 'embed:close' }, '*');
      }
    };

    // Intercept in-app navigation to source URLs and redirect them
    // through the parent. PDFs and source viewers are uncomfortable at
    // 420px and should open in a full-size tab. Applies to any anchor
    // whose href points to a /source/ route or carries an explicit
    // data-source-url attribute (future-proofing for components that
    // don't use <a> directly).
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const anchor = target.closest('a[href]') as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute('href') || '';
      // Heuristic: absolute URLs to files (pdf, doc, xlsx, etc.) AND
      // relative /api/documents/ download links are source-like.
      const isSourceLike =
        /\.(pdf|docx?|xlsx?|csv|txt)(\?|$)/i.test(href) ||
        href.startsWith('/api/documents/') ||
        anchor.dataset.sourceUrl !== undefined;
      if (!isSourceLike) return;
      e.preventDefault();
      // Resolve to absolute URL before posting so the parent can
      // window.open() it directly without needing to know our origin.
      const absolute = new URL(href, window.location.href).toString();
      parent.postMessage(
        { type: 'embed:open-source', url: absolute },
        '*',
      );
    };

    window.addEventListener('message', handleMessage);
    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('click', handleClick);
    return () => {
      window.removeEventListener('message', handleMessage);
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('click', handleClick);
    };
  }, []);

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <ChatInterface key={chatKey} collections={collections} />
    </div>
  );
}
