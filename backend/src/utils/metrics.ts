/**
 * Lightweight in-memory metrics collector for observability.
 *
 * Tracks request counts, error rates, and latency percentiles per route group.
 * Resets every hour to avoid unbounded memory growth. For horizontal scaling,
 * replace with Prometheus client or CloudWatch embedded metrics.
 */

interface RouteMetrics {
  requestCount: number;
  errorCount: number;    // 4xx + 5xx
  latencies: number[];   // ms — capped to last 1000 samples for percentile calculation
}

const routeMetrics = new Map<string, RouteMetrics>();
let totalRequests = 0;
let totalErrors = 0;
const startedAt = Date.now();
let lastResetAt = Date.now();

// Reset metrics every hour to prevent unbounded growth
const RESET_INTERVAL_MS = 60 * 60 * 1000;
const MAX_LATENCY_SAMPLES = 1000;

/**
 * Normalize a request path to a route group to avoid per-ID explosion.
 * e.g., "/api/documents/abc-123" → "/api/documents/:id"
 */
function normalizeRoute(method: string, path: string): string {
  const normalized = path
    // Strip query strings
    .split('?')[0]
    // Replace UUIDs and long alphanumeric IDs with :id
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:id')
    // Replace numeric IDs
    .replace(/\/\d+/g, '/:id')
    // Replace date patterns (YYYY-MM-DD)
    .replace(/\/\d{4}-\d{2}-\d{2}/g, '/:date')
    // Collapse trailing slashes
    .replace(/\/+$/, '');

  return `${method} ${normalized || '/'}`;
}

/**
 * Record a completed request's metrics.
 */
export function recordRequest(method: string, path: string, statusCode: number, durationMs: number): void {
  // Periodic reset to prevent unbounded growth
  if (Date.now() - lastResetAt > RESET_INTERVAL_MS) {
    routeMetrics.clear();
    totalRequests = 0;
    totalErrors = 0;
    lastResetAt = Date.now();
  }

  const route = normalizeRoute(method, path);
  totalRequests++;

  let metrics = routeMetrics.get(route);
  if (!metrics) {
    metrics = { requestCount: 0, errorCount: 0, latencies: [] };
    routeMetrics.set(route, metrics);
  }

  metrics.requestCount++;
  if (statusCode >= 400) {
    metrics.errorCount++;
    totalErrors++;
  }

  // Keep only last N latency samples for percentile calculation
  if (metrics.latencies.length >= MAX_LATENCY_SAMPLES) {
    metrics.latencies.shift();
  }
  metrics.latencies.push(durationMs);
}

/**
 * Compute a percentile from a sorted array of numbers.
 */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

/**
 * Get a snapshot of current metrics.
 */
export function getMetricsSnapshot(): {
  uptime: number;
  windowSeconds: number;
  totalRequests: number;
  totalErrors: number;
  errorRate: string;
  routes: Array<{
    route: string;
    requests: number;
    errors: number;
    p50Ms: number;
    p95Ms: number;
    p99Ms: number;
  }>;
  memory: {
    heapUsedMB: number;
    heapTotalMB: number;
    rssMB: number;
  };
} {
  const mem = process.memoryUsage();
  const windowSeconds = Math.round((Date.now() - lastResetAt) / 1000);

  const routes = Array.from(routeMetrics.entries())
    .map(([route, m]) => {
      const sorted = [...m.latencies].sort((a, b) => a - b);
      return {
        route,
        requests: m.requestCount,
        errors: m.errorCount,
        p50Ms: Math.round(percentile(sorted, 50)),
        p95Ms: Math.round(percentile(sorted, 95)),
        p99Ms: Math.round(percentile(sorted, 99)),
      };
    })
    .sort((a, b) => b.requests - a.requests);

  // Database pool metrics (if pool is available)
  let database: { totalConnections: number; idleConnections: number; waitingRequests: number } | undefined;
  try {
    const { getPool } = require('../config/database');
    const pool = getPool();
    database = {
      totalConnections: pool.totalCount ?? 0,
      idleConnections: pool.idleCount ?? 0,
      waitingRequests: pool.waitingCount ?? 0,
    };
  } catch {
    // Database not configured
  }

  return {
    uptime: Math.round((Date.now() - startedAt) / 1000),
    windowSeconds,
    totalRequests,
    totalErrors,
    errorRate: totalRequests > 0 ? (totalErrors / totalRequests * 100).toFixed(2) + '%' : '0%',
    routes,
    memory: {
      heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
      rssMB: Math.round(mem.rss / 1024 / 1024),
    },
    ...(database && { database }),
  };
}
