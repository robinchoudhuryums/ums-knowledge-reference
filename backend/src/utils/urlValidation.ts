/**
 * URL Validation Utility
 *
 * Validates URLs to prevent Server-Side Request Forgery (SSRF) attacks.
 * Rejects URLs pointing to internal/private networks, metadata endpoints,
 * and non-HTTP protocols.
 */

import { logger } from './logger';

// Maximum download size: 100MB (prevents memory exhaustion)
export const MAX_DOWNLOAD_SIZE = 100 * 1024 * 1024;

// Private/reserved IPv4 ranges that should never be accessed by the server
const PRIVATE_IP_RANGES = [
  // 10.0.0.0/8
  { start: ip4ToNum('10.0.0.0'), end: ip4ToNum('10.255.255.255') },
  // 172.16.0.0/12
  { start: ip4ToNum('172.16.0.0'), end: ip4ToNum('172.31.255.255') },
  // 192.168.0.0/16
  { start: ip4ToNum('192.168.0.0'), end: ip4ToNum('192.168.255.255') },
  // 127.0.0.0/8 (loopback)
  { start: ip4ToNum('127.0.0.0'), end: ip4ToNum('127.255.255.255') },
  // 169.254.0.0/16 (link-local / cloud metadata)
  { start: ip4ToNum('169.254.0.0'), end: ip4ToNum('169.254.255.255') },
  // 0.0.0.0/8
  { start: ip4ToNum('0.0.0.0'), end: ip4ToNum('0.255.255.255') },
];

// Hostnames that are commonly used for cloud metadata services
const BLOCKED_HOSTNAMES = [
  'metadata.google.internal',
  'metadata.google.com',
  'instance-data',
];

function ip4ToNum(ip: string): number {
  const parts = ip.split('.').map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function isPrivateIp(ip: string): boolean {
  // Check IPv4
  const parts = ip.split('.');
  if (parts.length === 4 && parts.every(p => /^\d+$/.test(p))) {
    const num = ip4ToNum(ip);
    return PRIVATE_IP_RANGES.some(range => num >= range.start && num <= range.end);
  }

  // IPv6 loopback
  if (ip === '::1' || ip === '::' || ip.startsWith('fe80:') || ip.startsWith('fc00:') || ip.startsWith('fd00:')) {
    return true;
  }

  // IPv4-mapped IPv6 (::ffff:10.0.0.1)
  const v4Mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (v4Mapped) {
    return isPrivateIp(v4Mapped[1]);
  }

  return false;
}

/**
 * Validate a URL for safe external fetching.
 * Returns null if the URL is valid, or an error message string if it's blocked.
 */
export function validateUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'Malformed URL';
  }

  // Only allow HTTP and HTTPS
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return `Disallowed protocol: ${parsed.protocol}`;
  }

  const hostname = parsed.hostname.toLowerCase();

  // Block known metadata hostnames
  if (BLOCKED_HOSTNAMES.includes(hostname)) {
    logger.warn('SSRF attempt blocked: metadata hostname', { url, hostname });
    return 'Blocked hostname';
  }

  // Block IP addresses in private ranges
  if (isPrivateIp(hostname)) {
    logger.warn('SSRF attempt blocked: private IP', { url, hostname });
    return 'URLs pointing to private/internal networks are not allowed';
  }

  // Block localhost aliases
  if (hostname === 'localhost' || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    logger.warn('SSRF attempt blocked: local hostname', { url, hostname });
    return 'URLs pointing to local/internal hosts are not allowed';
  }

  return null;
}
