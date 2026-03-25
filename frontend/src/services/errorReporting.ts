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

// ---------------------------------------------------------------------------
// Performance / APM tracking
// ---------------------------------------------------------------------------

interface PerfMetric {
  name: string;
  value: number;
  unit: 'ms' | 'bytes' | 'count';
  tags?: Record<string, string>;
  timestamp: string;
}

const perfBuffer: PerfMetric[] = [];
const PERF_FLUSH_INTERVAL_MS = 30_000; // flush every 30s
let perfFlushTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Record a performance metric. Buffered and flushed periodically.
 */
export function trackMetric(name: string, value: number, unit: 'ms' | 'bytes' | 'count' = 'ms', tags?: Record<string, string>): void {
  perfBuffer.push({ name, value, unit, tags, timestamp: new Date().toISOString() });
}

/**
 * Measure the duration of an async operation and record it.
 */
export async function trackTiming<T>(name: string, fn: () => Promise<T>, tags?: Record<string, string>): Promise<T> {
  const start = performance.now();
  try {
    const result = await fn();
    trackMetric(name, Math.round(performance.now() - start), 'ms', { ...tags, status: 'ok' });
    return result;
  } catch (err) {
    trackMetric(name, Math.round(performance.now() - start), 'ms', { ...tags, status: 'error' });
    throw err;
  }
}

function flushPerfMetrics(): void {
  if (perfBuffer.length === 0) return;
  const batch = perfBuffer.splice(0, perfBuffer.length);

  try {
    const legacyToken = getLegacyToken();
    const csrfToken = getCsrfToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (legacyToken) headers['Authorization'] = `Bearer ${legacyToken}`;
    if (csrfToken) headers['x-csrf-token'] = csrfToken;

    fetch(`${API_BASE}/errors/report`, {
      method: 'POST',
      credentials: 'same-origin',
      headers,
      body: JSON.stringify({
        message: `[APM] ${batch.length} metrics`,
        stack: JSON.stringify(batch),
        componentName: 'apm',
        url: window.location.href,
      }),
    }).catch(() => {});
  } catch {
    // Silently ignore
  }
}

/**
 * Collect Web Vitals and navigation timing once page has loaded.
 */
function collectPageMetrics(): void {
  // Navigation timing
  if (performance.getEntriesByType) {
    const [nav] = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
    if (nav) {
      trackMetric('page.dns', Math.round(nav.domainLookupEnd - nav.domainLookupStart), 'ms');
      trackMetric('page.tcp', Math.round(nav.connectEnd - nav.connectStart), 'ms');
      trackMetric('page.ttfb', Math.round(nav.responseStart - nav.requestStart), 'ms');
      trackMetric('page.domContentLoaded', Math.round(nav.domContentLoadedEventEnd - nav.startTime), 'ms');
      trackMetric('page.load', Math.round(nav.loadEventEnd - nav.startTime), 'ms');
      if (nav.transferSize) {
        trackMetric('page.transferSize', nav.transferSize, 'bytes');
      }
    }
  }

  // Largest Contentful Paint
  try {
    const lcpObserver = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      if (entries.length > 0) {
        trackMetric('web-vital.lcp', Math.round(entries[entries.length - 1].startTime), 'ms');
      }
      lcpObserver.disconnect();
    });
    lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true });
  } catch {
    // PerformanceObserver not supported
  }

  // First Input Delay
  try {
    const fidObserver = new PerformanceObserver((list) => {
      const entries = list.getEntries() as PerformanceEventTiming[];
      if (entries.length > 0) {
        trackMetric('web-vital.fid', Math.round(entries[0].processingStart - entries[0].startTime), 'ms');
      }
      fidObserver.disconnect();
    });
    fidObserver.observe({ type: 'first-input', buffered: true });
  } catch {
    // PerformanceObserver not supported
  }

  // Cumulative Layout Shift
  try {
    let clsValue = 0;
    const clsObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as any[]) {
        if (!entry.hadRecentInput) {
          clsValue += entry.value;
        }
      }
    });
    clsObserver.observe({ type: 'layout-shift', buffered: true });
    // Report CLS after 10 seconds
    setTimeout(() => {
      trackMetric('web-vital.cls', Math.round(clsValue * 1000) / 1000, 'count');
      clsObserver.disconnect();
    }, 10_000);
  } catch {
    // PerformanceObserver not supported
  }
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

/**
 * Register global error handlers (window.onerror and unhandledrejection)
 * and start performance monitoring. Call once at app startup.
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

  // Start performance monitoring
  if (!perfFlushTimer) {
    perfFlushTimer = setInterval(flushPerfMetrics, PERF_FLUSH_INTERVAL_MS);
  }

  // Collect page metrics after load
  if (document.readyState === 'complete') {
    collectPageMetrics();
  } else {
    window.addEventListener('load', collectPageMetrics, { once: true });
  }
}
