/**
 * EmbedShell — chrome-free wrapper around ChatInterface used when the app
 * is iframed by a sibling service (currently CallAnalyzer on `.umscallanalyzer.com`).
 *
 * Mounted when the URL has `?embed=1`. Emits `embed:ready` on mount so the
 * parent frame can reveal the panel, and listens for `embed:clear` to
 * remount ChatInterface (dropping its internal history).
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

    window.parent.postMessage({ type: 'embed:ready' }, '*');

    const handleMessage = (event: MessageEvent) => {
      // Only accept messages from our parent frame. Other iframes or
      // popup windows on the page must not be able to reset chat state.
      if (event.source !== window.parent) return;
      const data = event.data as { type?: string } | null;
      if (!data || typeof data.type !== 'string') return;
      if (data.type === 'embed:clear') {
        setChatKey((k) => k + 1);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <ChatInterface key={chatKey} collections={collections} />
    </div>
  );
}
