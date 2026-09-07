import { describe, expect, it } from 'vitest';
import {
  classifyIp,
  isAddressAllowed,
  isPrivateOrLoopback,
  normalizeUserUrl,
  validateUrlShape,
  validateAuditTarget,
  hostIsSingleLabelInternal,
} from '../src/utils/url';

describe('URL normalisation', () => {
  it('adds https:// when the scheme is missing', () => {
    expect(normalizeUserUrl('example.com')).toBe('https://example.com/');
    expect(normalizeUserUrl('www.example.com/path')).toBe('https://www.example.com/path');
  });

  it('keeps an explicit https URL', () => {
    expect(normalizeUserUrl('https://example.com/x?y=1')).toBe('https://example.com/x?y=1');
  });

  it('rejects junk and non-http(s) schemes', () => {
    expect(normalizeUserUrl('')).toBeNull();
    expect(normalizeUserUrl('ftp://example.com')).toBeNull();
    expect(normalizeUserUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeUserUrl('not a url')).toBeNull();
    expect(normalizeUserUrl('http://')).toBeNull();
  });
});

describe('URL shape validation', () => {
  it('rejects unsupported protocols', () => {
    const r = validateUrlShape('ftp://files.example.com/pub');
    expect(r.ok).toBe(false);
    expect(r.issue).toBe('UNSUPPORTED_PROTOCOL');
  });

  it('rejects URLs with embedded credentials', () => {
    const r = validateUrlShape('https://user:pass@example.com');
    expect(r.ok).toBe(false);
    expect(r.issue).toBe('CREDENTIALS_IN_URL');
  });

  it('rejects single-label internal hostnames', () => {
    const r = validateUrlShape('http://intranet/');
    expect(r.ok).toBe(false);
    expect(r.issue).toBe('INTERNAL_HOSTNAME');
  });

  it('rejects blocked hostname suffixes', () => {
    const r = validateUrlShape('https://printer.internal/');
    expect(r.ok).toBe(false);
    expect(r.issue).toBe('BLOCKED_HOST');
  });

  it('accepts normal public https URLs', () => {
    const r = validateUrlShape('https://example.com');
    expect(r.ok).toBe(true);
  });
});

describe('IP classification (SSRF protection)', () => {
  it('classifies loopback, private, link-local and metadata ranges', () => {
    expect(classifyIp('127.0.0.1')).toBe('LOOPBACK');
    expect(classifyIp('10.0.0.5')).toBe('PRIVATE_IP');
    expect(classifyIp('172.16.9.9')).toBe('PRIVATE_IP');
    expect(classifyIp('192.168.1.1')).toBe('PRIVATE_IP');
    expect(classifyIp('169.254.169.254')).toBe('METADATA_ENDPOINT');
    expect(classifyIp('100.100.100.200')).toBe('METADATA_ENDPOINT');
    expect(classifyIp('100.64.0.1')).toBe('METADATA_ENDPOINT');
    expect(classifyIp('::1')).toBe('LOOPBACK');
    expect(classifyIp('fe80::1')).toBe('LINK_LOCAL');
    expect(classifyIp('93.184.216.34')).toBeNull();
  });

  it('isPrivateOrLoopback detects RFC1918 and v6-mapped addresses', () => {
    expect(isPrivateOrLoopback('192.168.0.4')).toBe(true);
    expect(isPrivateOrLoopback('10.1.2.3')).toBe(true);
    expect(isPrivateOrLoopback('::ffff:10.0.0.1')).toBe(true);
    expect(isPrivateOrLoopback('8.8.8.8')).toBe(false);
  });

  it('never allows metadata endpoints, even when private targets are enabled', () => {
    expect(isAddressAllowed('169.254.169.254', { allowPrivateTargets: true })).toBe(false);
    expect(isAddressAllowed('100.64.0.4', { allowPrivateTargets: true })).toBe(false);
  });

  it('allows private IPs only when explicitly enabled', () => {
    expect(isAddressAllowed('127.0.0.1', { allowPrivateTargets: false })).toBe(false);
    expect(isAddressAllowed('127.0.0.1', { allowPrivateTargets: true })).toBe(true);
    expect(isAddressAllowed('93.184.216.34', { allowPrivateTargets: false })).toBe(true);
  });

  it('blocks metadata endpoints via full validation (always, no DNS needed)', async () => {
    const r = await validateAuditTarget('http://169.254.169.254/latest/meta-data');
    expect(r.ok).toBe(false);
    expect(r.issue).toBe('METADATA_ENDPOINT');
  });

  it('hostIsSingleLabelInternal identifies intranet hosts only', () => {
    expect(hostIsSingleLabelInternal('myserver')).toBe(true);
    expect(hostIsSingleLabelInternal('example.com')).toBe(false);
  });
});

describe('normalize keeps determinism', () => {
  it('reproduces the same output twice', () => {
    expect(normalizeUserUrl('Example.COM/about/')).toBe(normalizeUserUrl('Example.COM/about/'));
  });
});
