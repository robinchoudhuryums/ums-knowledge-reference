const API_BASE = (import.meta.env.VITE_API_URL ? `${import.meta.env.VITE_API_URL}/api` : '/api');

/** Track recently reported messages for deduplication (message -> timestamp) */
const recentReports = new Map<string, number>();
const DEDUP_WINDOW_MS = 60_000; // 60 seconds

function getLegacyToken(): string | null {
  return localStorage.getItem('token');
}

function getCsrfToken(): string | null {
  const match = document.cookie.match(/(^|;\s*)csrf_token=([^;]*)/);
  return match ? decodeURIComponent(match[2]) : null;
}

/**
 * Report an error to the backend. Fire-and-forget — never throws.
 * Deduplicates: skips if the same message was reported within the last 60 seconds.
 */
export function reportError(error: Error, componentName?: string): void {
  try {
    const message = error.message || String(error);

    // Deduplicate
    const now = Date.now();
    const lastReported = recentReports.get(message);
    if (lastReported && now - lastReported < DEDUP_WINDOW_MS) {
      return;
    }
    recentReports.set(message, now);

    // Prune old entries periodically
    if (recentReports.size > 100) {
      for (const [key, ts] of recentReports) {
        if (now - ts >= DEDUP_WINDOW_MS) {
          recentReports.delete(key);
        }
      }
    }

    const legacyToken = getLegacyToken();
    const csrfToken = getCsrfToken();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (legacyToken) {
      headers['Authorization'] = `Bearer ${legacyToken}`;
    }
    if (csrfToken) {
      headers['x-csrf-token'] = csrfToken;
    }

    const body = JSON.stringify({
      message: message.slice(0, 5000),
      stack: error.stack?.slice(0, 10000),
      componentName,
      url: window.location.href,
      userAgent: navigator.userAgent,
    });

    // Fire-and-forget
    fetch(`${API_BASE}/errors/report`, {
      method: 'POST',
      credentials: 'same-origin',
      headers,
      body,
    }).catch(() => {
      // Silently ignore — we don't want error reporting to cause more errors
    });
  } catch {
    // Silently ignore
  }
}

/**
 * Register global error handlers (window.onerror and unhandledrejection).
 * Call once at app startup.
 */
export function initErrorReporting(): void {
  window.addEventListener('error', (event: ErrorEvent) => {
    if (event.error instanceof Error) {
      reportError(event.error, 'window.onerror');
    } else {
      reportError(new Error(event.message || 'Unknown error'), 'window.onerror');
    }
  });

  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    if (reason instanceof Error) {
      reportError(reason, 'unhandledrejection');
    } else {
      reportError(new Error(String(reason)), 'unhandledrejection');
    }
  });
}
