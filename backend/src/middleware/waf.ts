/**
 * Application-level Web Application Firewall (WAF)
 *
 * Defense-in-depth protection at the application layer:
 * - IP blocklist (permanent + temporary with auto-expiry)
 * - SQL injection pattern detection (13 patterns)
 * - XSS pattern detection (13 patterns, including SVG/XML vectors)
 * - Path traversal detection (7 patterns, with double-encoding)
 * - CRLF injection detection
 * - Suspicious User-Agent blocking (known scanners)
 * - Request anomaly scoring (auto-blocks after threshold)
 * - Input truncation (4KB) to prevent regex DoS
 *
 * Ported from assemblyai_tool/server/middleware/waf.ts and adapted for
 * the ums-knowledge-reference Express stack.
 */

import type { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

// --- IP Blocklist ---

const blockedIPs = new Set<string>();
const temporaryBlocks = new Map<string, number>(); // IP -> unblock timestamp

export function blockIP(ip: string, reason: string): void {
  blockedIPs.add(ip);
  logger.warn('WAF IP blocked permanently', { ip, reason });
  // Audit via structured logger (action type 'waf_ip_blocked' not in AuditLogEntry union)
}

export function temporaryBlockIP(ip: string, durationMs: number, reason: string): void {
  temporaryBlocks.set(ip, Date.now() + durationMs);
  logger.warn('WAF IP blocked temporarily', { ip, reason, durationMs });
}

export function unblockIP(ip: string): boolean {
  return blockedIPs.delete(ip) || temporaryBlocks.delete(ip);
}

export function getBlockedIPs(): { permanent: string[]; temporary: Array<{ ip: string; expiresAt: string }> } {
  const now = Date.now();
  const tempList: Array<{ ip: string; expiresAt: string }> = [];
  for (const [ip, expiresAt] of temporaryBlocks) {
    if (expiresAt > now) tempList.push({ ip, expiresAt: new Date(expiresAt).toISOString() });
  }
  return { permanent: [...blockedIPs], temporary: tempList };
}

function isIPBlocked(ip: string): boolean {
  if (blockedIPs.has(ip)) return true;
  const tempExpiry = temporaryBlocks.get(ip);
  if (tempExpiry) {
    if (Date.now() < tempExpiry) return true;
    temporaryBlocks.delete(ip);
  }
  return false;
}

// --- Attack Pattern Detection ---

const SQL_INJECTION_PATTERNS = [
  /\bunion\s+(?:all\s+)?select\b/i,
  /\bselect\s+(?:\*|[\w.]+(?:\s*,\s*[\w.]+)*)\s+from\b/i,
  /\b(?:insert|delete)\s+(?:into|from)\b/i,
  /\bupdate\s+\w+\s+set\b/i,
  /\b(?:drop|alter|create)\s+(?:table|database|index)\b/i,
  /\bexec(?:ute)?\s*\(/i,
  /(\b(or|and)\b\s+\d+\s*=\s*\d+)/i,
  /(--|#|\/\*)\s*$/,
  /'\s*(or|and)\s+'[^']*'\s*=\s*'[^']*'/i,
  /;\s*(drop|delete|insert|update|alter)\s+/i,
  /\bwaitfor\s+delay\b/i,
  /\bbenchmark\s*\(/i,
  /\bsleep\s*\(\s*\d+\s*\)/i,
];

const XSS_PATTERNS = [
  /<script[\s>]/i,
  /javascript\s*:/i,
  /on(error|load|click|mouse|focus|blur|submit|change|key)\s*=/i,
  /<iframe[\s>]/i,
  /<object[\s>]/i,
  /<embed[\s>]/i,
  /\beval\s*\(/i,
  /expression\s*\(/i,
  /url\s*\(\s*['"]?\s*data:/i,
  /<svg[\s>]/i,
  /<math[\s>]/i,
  /xlink:href\s*=/i,
  /formaction\s*=/i,
];

const CRLF_PATTERNS = [
  /\r\n/,
  /%0[dD]%0[aA]/,
  /%0[aA]/,
  /\\r\\n/,
];

const PATH_TRAVERSAL_PATTERNS = [
  /\.\.[\/\\]/,
  /%2e%2e[%2f%5c]/i,
  /\.\.\%2f/i,
  /%252e%252e/i,
  /\/etc\/(passwd|shadow|hosts)/i,
  /\/proc\/self/i,
  /\bboot\.ini\b/i,
];

const SUSPICIOUS_USER_AGENTS = [
  /sqlmap/i, /nikto/i, /nessus/i, /masscan/i, /zgrab/i,
  /gobuster/i, /dirbuster/i, /wpscan/i, /nmap/i,
  /^$/,
];

// --- Anomaly Scoring ---

const anomalyScores = new Map<string, { events: Array<{ points: number; violation: string; timestamp: number }>; lastSeen: number }>();
const anomalyCooldowns = new Map<string, number>();
const ANOMALY_THRESHOLD = 10;
const ANOMALY_BLOCK_DURATION = 30 * 60 * 1000;
const ANOMALY_WINDOW = 10 * 60 * 1000;
const ANOMALY_COOLDOWN_MS = 5 * 60 * 1000;

function recordAnomaly(ip: string, violation: string, points: number): number {
  const now = Date.now();

  const cooldownUntil = anomalyCooldowns.get(ip);
  if (cooldownUntil && now < cooldownUntil) {
    temporaryBlockIP(ip, ANOMALY_BLOCK_DURATION, `Repeat offense during cooldown: ${violation}`);
    return ANOMALY_THRESHOLD;
  }

  let tracker = anomalyScores.get(ip);
  if (!tracker) tracker = { events: [], lastSeen: now };

  tracker.events = tracker.events.filter(e => now - e.timestamp <= ANOMALY_WINDOW);
  tracker.events.push({ points, violation, timestamp: now });
  tracker.lastSeen = now;
  anomalyScores.set(ip, tracker);

  const score = tracker.events.reduce((sum, e) => sum + e.points, 0);
  if (score >= ANOMALY_THRESHOLD) {
    const violations = tracker.events.map(e => e.violation);
    temporaryBlockIP(ip, ANOMALY_BLOCK_DURATION, `Anomaly score ${score}: ${violations.join(', ')}`);
    anomalyCooldowns.set(ip, now + ANOMALY_COOLDOWN_MS);
    anomalyScores.delete(ip);
  }

  return score;
}

// Cleanup every 15 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, tracker] of anomalyScores) {
    if (now - tracker.lastSeen > ANOMALY_WINDOW) anomalyScores.delete(ip);
  }
  for (const [ip, expiresAt] of temporaryBlocks) {
    if (now >= expiresAt) temporaryBlocks.delete(ip);
  }
  for (const [ip, expiresAt] of anomalyCooldowns) {
    if (now >= expiresAt) anomalyCooldowns.delete(ip);
  }
}, 15 * 60 * 1000).unref();

// --- WAF Stats ---

const stats = {
  totalBlocked: 0,
  sqliBlocked: 0,
  xssBlocked: 0,
  pathTraversalBlocked: 0,
  ipBlocked: 0,
  suspiciousUABlocked: 0,
  since: new Date().toISOString(),
};

export function getWAFStats() {
  return { ...stats, blockedIPs: getBlockedIPs(), anomalyThreshold: ANOMALY_THRESHOLD };
}

// --- Helpers ---

const MAX_PATTERN_INPUT_LEN = 4096;

function deepDecode(value: string, maxDepth = 3): string {
  let decoded = value;
  for (let i = 0; i < maxDepth; i++) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch { break; }
  }
  return decoded;
}

function checkPatterns(value: string, patterns: RegExp[]): boolean {
  return patterns.some(p => p.test(value));
}

function checkPatternsNormalized(value: string, patterns: RegExp[]): boolean {
  const truncated = value.length > MAX_PATTERN_INPUT_LEN ? value.slice(0, MAX_PATTERN_INPUT_LEN) : value;
  if (checkPatterns(truncated, patterns)) return true;
  const decoded = deepDecode(truncated);
  if (decoded !== truncated && checkPatterns(decoded, patterns)) return true;
  return false;
}

function getAllRequestValues(req: Request): string[] {
  const values: string[] = [];
  if (req.query) {
    for (const val of Object.values(req.query)) {
      if (typeof val === 'string') values.push(val);
    }
  }
  values.push(req.path);
  if (req.params) {
    for (const val of Object.values(req.params)) {
      if (typeof val === 'string') values.push(val);
    }
  }
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    const flattenValues = (obj: unknown, depth = 0): void => {
      if (depth > 5) return;
      if (typeof obj === 'string') values.push(obj);
      else if (Array.isArray(obj)) { for (const item of obj) flattenValues(item, depth + 1); }
      else if (obj && typeof obj === 'object') { for (const val of Object.values(obj)) flattenValues(val, depth + 1); }
    };
    flattenValues(req.body);
  }
  return values;
}

// --- Main WAF Middleware ---

export function wafMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';

    // 1. IP blocklist
    if (isIPBlocked(ip)) {
      stats.totalBlocked++;
      stats.ipBlocked++;
      return res.status(403).json({ error: 'Access denied' });
    }

    // 2. Suspicious User-Agent (API routes only, skip health check)
    if (req.path.startsWith('/api') && req.path !== '/api/health') {
      const ua = req.headers['user-agent'] || '';
      if (SUSPICIOUS_USER_AGENTS.some(p => p.test(ua))) {
        stats.totalBlocked++;
        stats.suspiciousUABlocked++;
        recordAnomaly(ip, 'suspicious_user_agent', 3);
        logger.warn('WAF suspicious UA blocked', { ip, ua: ua.slice(0, 100) });
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    // 3. CRLF injection
    if (checkPatternsNormalized(req.originalUrl, CRLF_PATTERNS)) {
      stats.totalBlocked++;
      recordAnomaly(ip, 'crlf_injection', 5);
      return res.status(400).json({ error: 'Invalid request' });
    }

    // 4. Path traversal
    if (checkPatternsNormalized(req.originalUrl, PATH_TRAVERSAL_PATTERNS)) {
      stats.totalBlocked++;
      stats.pathTraversalBlocked++;
      recordAnomaly(ip, 'path_traversal', 5);
      return res.status(400).json({ error: 'Invalid request' });
    }

    // 5. Oversized body (skip multipart file uploads)
    const contentLength = parseInt(req.headers['content-length'] || '0', 10);
    if (contentLength > 1_048_576) {
      const isMultipart = (req.headers['content-type'] || '').includes('multipart/form-data');
      if (!isMultipart) {
        stats.totalBlocked++;
        recordAnomaly(ip, 'oversized_body', 3);
        return res.status(413).json({ error: 'Request body too large' });
      }
    }

    // 6. Skip deep inspection for non-API routes (static assets)
    if (!req.path.startsWith('/api')) return next();

    // 7. SQL injection + XSS on all request values
    const values = getAllRequestValues(req);
    for (const val of values) {
      if (checkPatternsNormalized(val, SQL_INJECTION_PATTERNS)) {
        stats.totalBlocked++;
        stats.sqliBlocked++;
        recordAnomaly(ip, 'sql_injection', 5);
        logger.warn('WAF SQLi blocked', { ip, path: req.path });
        return res.status(400).json({ error: 'Invalid request' });
      }
      if (checkPatternsNormalized(val, XSS_PATTERNS)) {
        stats.totalBlocked++;
        stats.xssBlocked++;
        recordAnomaly(ip, 'xss_attempt', 4);
        logger.warn('WAF XSS blocked', { ip, path: req.path });
        return res.status(400).json({ error: 'Invalid request' });
      }
    }

    next();
  };
}
