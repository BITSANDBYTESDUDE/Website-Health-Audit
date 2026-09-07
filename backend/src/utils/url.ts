import dns from 'node:dns/promises';
import net from 'node:net';
import { config } from '../config';

/**
 * URL validation + SSRF protection.
 *
 * Rules enforced for every request the engine makes (including every
 * redirect hop):
 *   - http/https schemes only
 *   - no credentials embedded in the URL
 *   - loopback / private / link-local / CGNAT ranges blocked
 *   - cloud-metadata endpoints (169.254.0.0/16, 100.100.100.200) ALWAYS blocked
 *   - single-label internal hostnames blocked
 *   - DNS resolved and every returned address validated before connecting
 *   - optional per-config blocked hostname list
 */

export type UrlIssue =
  | 'INVALID_URL'
  | 'UNSUPPORTED_PROTOCOL'
  | 'CREDENTIALS_IN_URL'
  | 'BLOCKED_HOST'
  | 'PRIVATE_IP'
  | 'LOOPBACK'
  | 'LINK_LOCAL'
  | 'METADATA_ENDPOINT'
  | 'INTERNAL_HOSTNAME'
  | 'NO_HOST'
  | 'DNS_FAILURE';

export interface UrlValidation {
  ok: boolean;
  issue?: UrlIssue;
  message?: string;
  url?: URL;
  /** Validated IP literal(s) the client is allowed to connect to. */
  addresses?: string[];
  resolvedVia?: 'literal' | 'dns';
}

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function ipv4ToInt(ip: string): number {
  const parts = ip.split('.').map(Number);
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

function isMetadataV4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  // 169.254.0.0/16 (incl. 169.254.169.254) + 100.64.0.0/10 CGNAT + 100.100.100.200 Alibaba
  return (
    (n >>> 16) === 0xa9fe || // 169.254.0.0/16
    (n >>> 22) === 0x191 || // 100.64.0.0/10 (top 10 bits)
    n === 0x646464c8 // 100.100.100.200
  );
}

function isLinkLocalV4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  return (n >>> 16) === (0xa9fe >>> 0);
}

/** Private + loopback (RFC1918, loopback, ULA, IPv4-mapped). */
export function isPrivateOrLoopback(ip: string): boolean {
  const v = net.isIP(ip);
  if (v === 4) {
    const n = ipv4ToInt(ip);
    const a = (n >>> 24) & 0xff;
    const b = (n >>> 16) & 0xff;
    if (a === 10 || a === 127) return true; // 10/8, 127/8
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
    if (a === 192 && b === 168) return true; // 192.168/16
    if (a === 169 && b === 254) return true; // 169.254/16 link-local
    return false;
  }
  if (v === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::1') return true; // loopback
    if (lower.startsWith('::ffff:')) return isPrivateOrLoopback(lower.slice('::ffff:'.length));
    const hextets = lower.split(':');
    // fc00::/7 ULA and fe80::/10 link-local
    if (hextets[0] === 'fe80') return true;
    if (/^f[cd]/.test(hextets[0])) return true;
    return false;
  }
  return false;
}

export function classifyIp(ip: string): UrlIssue | null {
  const v = net.isIP(ip);
  if (v !== 4 && v !== 6) return null;
  if (isMetadataV4(ip)) return 'METADATA_ENDPOINT';
  if (v === 4) {
    if (isLinkLocalV4(ip)) return 'LINK_LOCAL';
    if (ip.startsWith('127.')) return 'LOOPBACK';
  }
  if (v === 6 && (ip === '::1' || ip.toLowerCase().startsWith('::ffff:7f'))) return 'LOOPBACK';
  if (v === 6 && ip.toLowerCase().split(':')[0] === 'fe80') return 'LINK_LOCAL';
  if (isPrivateOrLoopback(ip)) return 'PRIVATE_IP';
  return null;
}

/** Decide whether an address may be connected to. */
export function isAddressAllowed(
  ip: string,
  opts: { allowPrivateTargets?: boolean } = {},
): boolean {
  const allow = opts.allowPrivateTargets ?? config.security.allowPrivateTargets;
  // Metadata / CGNAT endpoints are never allowed.
  if (net.isIP(ip) === 4 && isMetadataV4(ip)) return false;
  if (net.isIP(ip) === 6 && isPrivateOrLoopback(ip) && !allow) return false;
  if (isPrivateOrLoopback(ip)) return allow;
  return true;
}

export function hostIsSingleLabelInternal(hostname: string): boolean {
  const h = hostname.replace(/\.$/, '');
  if (!h || h === 'localhost') return false; // localhost handled by IP checks
  return !h.includes('.');
}

const BLOCKED_HOST_SUFFIXES = ['.internal', '.local', '.localhost', '.lan', '.home', '.corp', '.intranet'];

export function hostMatchesBlocklist(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  if (config.security.blockedHosts.includes(h)) return true;
  return BLOCKED_HOST_SUFFIXES.some((s) => h.endsWith(s));
}

/** Normalize a user-entered URL string -> https://host/path when possible. */
export function normalizeUserUrl(raw: string): string | null {
  let input = raw.trim();
  if (!input) return null;
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(input)) {
    input = 'https://' + input;
  }
  try {
    const u = new URL(input);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!u.hostname) return null;
    u.hash = '';
    return u.toString().replace(/\/$/, '') === u.toString() ? u.toString() : normalizeTrailing(u.toString());
  } catch {
    return null;
  }
}

function normalizeTrailing(url: string): string {
  // keep root "/" for bare hosts, strip trailing slash otherwise
  const u = new URL(url);
  if (u.pathname.length > 1 && u.pathname.endsWith('/')) u.pathname = u.pathname.slice(0, -1);
  return u.toString();
}

/** Lightweight format validation without DNS (used before any network I/O). */
export function validateUrlShape(raw: string): UrlValidation {
  let input = raw.trim();
  if (!input) {
    return { ok: false, issue: 'INVALID_URL', message: 'Please enter a website URL.' };
  }
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(input)) {
    input = 'https://' + input;
  }
  let u: URL;
  try {
    u = new URL(input);
  } catch {
    return { ok: false, issue: 'INVALID_URL', message: 'That does not look like a valid URL.' };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return {
      ok: false,
      issue: 'UNSUPPORTED_PROTOCOL',
      message: 'Only http:// and https:// websites can be audited.',
    };
  }
  if (!u.hostname) {
    return { ok: false, issue: 'NO_HOST', message: 'The URL is missing a hostname.' };
  }
  if (u.username || u.password) {
    return {
      ok: false,
      issue: 'CREDENTIALS_IN_URL',
      message: 'URLs containing credentials are not supported.',
    };
  }
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  u.hostname = host;
  if (hostMatchesBlocklist(host)) {
    return { ok: false, issue: 'BLOCKED_HOST', message: 'This hostname is not allowed for auditing.' };
  }
  if (hostIsSingleLabelInternal(host)) {
    return {
      ok: false,
      issue: 'INTERNAL_HOSTNAME',
      message: 'Internal hostnames cannot be audited.',
    };
  }
  return { ok: true, url: u };
}

// Tiny DNS cache so crawling many assets on one host doesn't re-resolve each time.
const dnsCache = new Map<string, { addresses: string[]; expires: number }>();
const DNS_TTL_MS = 60_000;

/**
 * Full validation: shape + DNS resolution + IP policy.
 * Returns the validated addresses the client must connect to.
 */
export async function validateAuditTarget(raw: string): Promise<UrlValidation> {
  const shape = validateUrlShape(raw);
  if (!shape.ok || !shape.url) return shape;

  const url = shape.url;
  const host = url.hostname;
  const allowPrivate = config.security.allowPrivateTargets;

  const ipLiteral = net.isIP(host);
  if (ipLiteral) {
    const issue = classifyIp(host);
    if (issue && (!allowPrivate || issue === 'METADATA_ENDPOINT' || issue === 'LINK_LOCAL')) {
      return { ok: false, issue, message: `Address ${host} is not a public internet address.`, url };
    }
    return { ok: true, url, addresses: [host], resolvedVia: 'literal' };
  }

  // localhost hostname -> resolved to 127.0.0.1
  if (host === 'localhost') {
    const ip = '127.0.0.1';
    if (!allowPrivate) {
      return { ok: false, issue: 'LOOPBACK', message: 'localhost cannot be audited.', url };
    }
    return { ok: true, url, addresses: [ip], resolvedVia: 'dns' };
  }

  const cached = dnsCache.get(host);
  if (cached && cached.expires > Date.now()) {
    return { ok: true, url, addresses: cached.addresses, resolvedVia: 'dns' };
  }

  let records: string[];
  try {
    const res = await dns.lookup(host, { all: true, verbatim: true });
    records = res.map((r) => r.address);
  } catch {
    return {
      ok: false,
      issue: 'DNS_FAILURE',
      message: `We could not resolve "${host}". Check the spelling and that the domain exists.`,
      url,
    };
  }
  if (records.length === 0) {
    return {
      ok: false,
      issue: 'DNS_FAILURE',
      message: `We could not resolve "${host}".`,
      url,
    };
  }
  for (const addr of records) {
    if (!isAddressAllowed(addr)) {
      const issue = classifyIp(addr) ?? 'PRIVATE_IP';
      return {
        ok: false,
        issue,
        message:
          issue === 'METADATA_ENDPOINT'
            ? 'This target resolves to a restricted network endpoint.'
            : `"${host}" resolves to ${addr}, which is not a public internet address.`,
        url,
      };
    }
  }
  dnsCache.set(host, { addresses: records, expires: Date.now() + DNS_TTL_MS });
  return { ok: true, url, addresses: records, resolvedVia: 'dns' };
}
