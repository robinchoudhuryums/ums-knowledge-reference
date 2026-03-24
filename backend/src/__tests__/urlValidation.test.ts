import { describe, it, expect } from 'vitest';
import { validateUrl } from '../utils/urlValidation';

describe('URL Validation (SSRF Prevention)', () => {
  // Valid URLs should pass
  it('allows valid HTTPS URLs', () => {
    expect(validateUrl('https://www.cms.gov/medicare/payment/fee-schedules/dmepos')).toBeNull();
    expect(validateUrl('https://example.com/file.pdf')).toBeNull();
    expect(validateUrl('http://public-server.com/data.csv')).toBeNull();
  });

  // Protocol validation
  it('blocks non-HTTP protocols', () => {
    expect(validateUrl('ftp://example.com/file.txt')).toContain('Disallowed protocol');
    expect(validateUrl('file:///etc/passwd')).toContain('Disallowed protocol');
    expect(validateUrl('javascript:alert(1)')).toContain('Disallowed protocol');
    expect(validateUrl('data:text/html,<h1>hi</h1>')).toContain('Disallowed protocol');
  });

  // Malformed URLs
  it('blocks malformed URLs', () => {
    expect(validateUrl('')).toBe('Malformed URL');
    expect(validateUrl('not-a-url')).toBe('Malformed URL');
    expect(validateUrl('://missing-protocol')).toBe('Malformed URL');
  });

  // Private IP ranges (SSRF targets)
  it('blocks private 10.x.x.x range', () => {
    expect(validateUrl('http://10.0.0.1/admin')).toContain('private');
    expect(validateUrl('http://10.255.255.255/')).toContain('private');
  });

  it('blocks private 172.16-31.x.x range', () => {
    expect(validateUrl('http://172.16.0.1/')).toContain('private');
    expect(validateUrl('http://172.31.255.255/')).toContain('private');
  });

  it('blocks private 192.168.x.x range', () => {
    expect(validateUrl('http://192.168.1.1/')).toContain('private');
    expect(validateUrl('http://192.168.0.100/api')).toContain('private');
  });

  it('blocks loopback 127.x.x.x range', () => {
    expect(validateUrl('http://127.0.0.1/')).toContain('private');
    expect(validateUrl('http://127.0.0.1:9200/')).toContain('private');
  });

  // AWS metadata endpoint (critical SSRF target)
  it('blocks AWS metadata IP 169.254.169.254', () => {
    expect(validateUrl('http://169.254.169.254/latest/meta-data/')).toContain('private');
    expect(validateUrl('http://169.254.169.254/latest/meta-data/iam/security-credentials/')).toContain('private');
  });

  // Localhost
  it('blocks localhost', () => {
    expect(validateUrl('http://localhost/')).toContain('local');
    expect(validateUrl('http://localhost:3000/api')).toContain('local');
  });

  // Internal hostnames
  it('blocks .local and .internal hostnames', () => {
    expect(validateUrl('http://myapp.local/secret')).toContain('local');
    expect(validateUrl('http://service.internal/data')).toContain('local');
  });

  // Cloud metadata hostnames
  it('blocks cloud metadata hostnames', () => {
    expect(validateUrl('http://metadata.google.internal/')).not.toBeNull();
    expect(validateUrl('http://metadata.google.com/')).toContain('Blocked hostname');
  });

  // Zero IP
  it('blocks 0.0.0.0', () => {
    expect(validateUrl('http://0.0.0.0/')).toContain('private');
  });

  // Allows non-private IPs
  it('allows public IP addresses', () => {
    expect(validateUrl('http://8.8.8.8/')).toBeNull();
    expect(validateUrl('https://1.1.1.1/')).toBeNull();
  });
});
