import type { AuditContext } from '../engine/context';
import { issue, metric, out, headerStr, plural } from './helpers';
import type { AnalyzerOutput } from '../engine/context';

/**
 * Security configuration analyzer.
 *
 * IMPORTANT: This is a passive, configuration-level audit of publicly
 * observable signals (HTTPS/TLS, response headers, mixed content, cookie
 * attributes). It performs no exploitation and is NOT a penetration test.
 */
export async function analyzeSecurity(ctx: AuditContext): Promise<AnalyzerOutput> {
  const { homepage, browserMetrics } = ctx;
  const { headers, tls, finalUrl } = homepage;
  const issues: AnalyzerOutput['issues'] = [];
  const metrics: AnalyzerOutput['metrics'] = [];
  const notes: string[] = [
    'Security Configuration Audit — this scan checks publicly observable security configuration. It is not a penetration test.',
    'No exploitation, credential testing or intrusive probing is performed.',
  ];

  const url = new URL(finalUrl);
  const isHttps = url.protocol === 'https:';

  // ---------- HTTPS / TLS ---------------------------------------------------
  if (!isHttps) {
    issues.push(
      issue('security', 'security', 'critical', 'Website is served over HTTP, not HTTPS', 'All traffic, including logins and personal data, is sent unencrypted and can be intercepted or modified by third parties on the network. Modern browsers flag HTTP sites as "Not secure".', 'Enable HTTPS with a valid TLS certificate and redirect all HTTP traffic to HTTPS.', [{ type: 'text', value: `Final URL after redirects: ${finalUrl} (http:)` }], 'HTTPS/TLS'),
    );
  } else {
    if (tls?.protocol) {
      if (/^TLSv1(\.0|\.1)?/.test(tls.protocol)) {
        issues.push(
          issue('security', 'security', 'critical', `Outdated TLS protocol in use (${tls.protocol})`, 'TLS 1.0/1.1 are deprecated and vulnerable to known attacks.', 'Disable TLS 1.0/1.1 and support TLS 1.2+.', [{ type: 'text', value: `Negotiated protocol: ${tls.protocol}` }], 'HTTPS/TLS'),
        );
      }
    }
    if (tls?.certificate?.validTo) {
      const exp = new Date(tls.certificate.validTo).getTime();
      const daysLeft = Math.floor((exp - Date.now()) / 86_400_000);
      metrics.push(metric('sec_cert_days', 'TLS certificate expiry', `${Math.max(daysLeft, 0)} days`, daysLeft > 30 ? 'good' : daysLeft > 0 ? 'warn' : 'bad'));
      if (daysLeft < 0) {
        issues.push(
          issue('security', 'security', 'critical', 'TLS certificate has expired', 'Visitors cannot establish a trusted connection to an expired certificate.', 'Renew the certificate immediately.', [{ type: 'text', value: `Certificate valid until ${tls.certificate.validTo}` }], 'HTTPS/TLS'),
        );
      } else if (daysLeft <= 14) {
        issues.push(
          issue('security', 'security', 'medium', `TLS certificate expires soon (${daysLeft} days)`, 'An expired certificate makes the site unreachable for most visitors.', 'Renew the certificate before it expires.', [{ type: 'text', value: `Certificate valid until ${tls.certificate.validTo}` }], 'HTTPS/TLS'),
        );
      }
    }
    if (tls) metrics.push(metric('sec_tls_protocol', 'TLS protocol', tls.protocol ?? null, tls.protocol ? 'good' : 'neutral'));
  }

  // http -> https upgrade checks
  const probe = ctx.protocolProbe;
  if (probe && isHttps && probe.other && probe.other.redirectedToMain === false && probe.other.statusCode !== null && probe.other.statusCode < 400) {
    issues.push(
      issue('security', 'security', 'medium', 'HTTP version of the site does not redirect to HTTPS', 'Users who type the http:// address are served over an insecure connection.', 'Configure the server to redirect all http:// requests to https:// (301).', [{ type: 'text', value: `${probe.other.scheme.toUpperCase()} version (${probe.other.finalUrl ?? probe.other.scheme + '://' + url.host}) responded without redirecting to HTTPS.` }], 'HTTPS/TLS'),
    );
  }

  // ---------- Security headers ----------------------------------------------
  const checks: { name: string; key: string; value: string | null; warnIfMissing: number; criticalValue?: RegExp; fix: string; why: string; area: string }[] = [
    {
      name: 'HTTP Strict Transport Security (HSTS)',
      key: 'strict-transport-security',
      value: headerStr(headers, 'strict-transport-security'),
      warnIfMissing: isHttps ? 15 : 0,
      fix: 'Add "Strict-Transport-Security: max-age=31536000; includeSubDomains" on HTTPS responses.',
      why: 'HSTS tells browsers to always use HTTPS, protecting visitors from SSL-stripping and downgrade attacks.',
      area: 'Security headers',
    },
    {
      name: 'Content-Security-Policy (CSP)',
      key: 'content-security-policy',
      value: headerStr(headers, 'content-security-policy'),
      warnIfMissing: isHttps ? 15 : 0,
      fix: 'Add a Content-Security-Policy header that restricts script sources and disallows unsafe-inline/unsafe-eval where possible.',
      why: 'CSP limits the damage of XSS by defining which resources the browser may load.',
      area: 'Security headers',
    },
    {
      name: 'X-Frame-Options / frame-ancestors',
      key: 'x-frame-options',
      value: headerStr(headers, 'x-frame-options'),
      warnIfMissing: isHttps ? 15 : 0,
      fix: 'Add "X-Frame-Options: DENY or SAMEORIGIN" (or CSP frame-ancestors) to prevent clickjacking.',
      why: 'Without frame protections, attackers can embed the site in malicious pages and trick users into clicking.',
      area: 'Security headers',
    },
    {
      name: 'X-Content-Type-Options (nosniff)',
      key: 'x-content-type-options',
      value: headerStr(headers, 'x-content-type-options'),
      warnIfMissing: isHttps ? 10 : 0,
      fix: 'Add "X-Content-Type-Options: nosniff".',
      why: 'Prevents browsers from MIME-sniffing responses into unintended content types (a common XSS vector).',
      area: 'Security headers',
    },
    {
      name: 'Referrer-Policy',
      key: 'referrer-policy',
      value: headerStr(headers, 'referrer-policy'),
      warnIfMissing: isHttps ? 4 : 0,
      fix: 'Add a Referrer-Policy such as "strict-origin-when-cross-origin".',
      why: 'Controls how much referrer information leaks to other sites when visitors click links.',
      area: 'Security headers',
    },
    {
      name: 'Permissions-Policy',
      key: 'permissions-policy',
      value: headerStr(headers, 'permissions-policy'),
      warnIfMissing: isHttps ? 4 : 0,
      fix: 'Add a Permissions-Policy header restricting camera, microphone, geolocation etc.',
      why: 'Limits which browser features the site (and embedded third parties) may use.',
      area: 'Security headers',
    },
  ];

  const csp = headerStr(headers, 'content-security-policy');
  for (const c of checks) {
    const value = c.value;
    const present = value !== null && value.trim() !== '';
    if (c.name === 'X-Frame-Options / frame-ancestors') {
      const hasFrameAncestors = csp ? /frame-ancestors\s+/i.test(csp) : false;
      if (!present && hasFrameAncestors) {
        metrics.push(metric('sec_header_xfo', c.name, 'via CSP frame-ancestors', 'good'));
        continue;
      }
    }
    if (present && value !== null) {
      metrics.push(metric(`sec_header_${c.key.replace(/-/g, '_')}`, c.name, value, 'good'));
      if (c.key === 'content-security-policy' && /\bunsafe-inline\b/.test(value) && /\bunsafe-eval\b/.test(value)) {
        issues.push(
          issue('security', 'security', 'low', 'CSP allows unsafe-inline and unsafe-eval together', 'Combined unsafe-inline + unsafe-eval substantially weakens the protection CSP can offer against XSS.', 'Move to nonce- or hash-based script policies and remove unsafe-eval.', [{ type: 'header', label: 'Content-Security-Policy', value: value.slice(0, 400) }], 'Security headers'),
        );
      }
      if (c.key === 'strict-transport-security') {
        const m = /max-age=(\d+)/i.exec(value);
        if (m && Number(m[1]) < 1_555_2000) {
          issues.push(
            issue('security', 'security', 'low', 'HSTS max-age is short', 'A short HSTS lifetime gives only brief protection against protocol downgrade attacks.', 'Use a max-age of at least 31536000 (1 year).', [{ type: 'header', label: 'Strict-Transport-Security', value }], 'Security headers'),
          );
        }
      }
      continue;
    }
    if (c.warnIfMissing === 0) continue;
    const sev = c.warnIfMissing >= 15 ? 'medium' : 'low';
    issues.push(
      issue('security', 'security', sev, `Missing ${c.name} header`, c.why, c.fix, [{ type: 'header', label: c.name, value: '(not present in the response headers)' }], c.area),
    );
  }

  // ---------- Cookies -------------------------------------------------------
  const setCookies = homepage.headers['set-cookie'];
  const cookieList: string[] = Array.isArray(setCookies) ? setCookies : setCookies ? [setCookies] : [];
  if (cookieList.length > 0) {
    const insecure = cookieList.filter((c) => !/;\s*secure\b/i.test(c));
    const noneWithoutSecure = cookieList.filter((c) => /;\s*samesite\s*=\s*none\b/i.test(c) && !/;\s*secure\b/i.test(c));
    if (insecure.length > 0) {
      issues.push(
        issue('security', 'security', insecure.length === cookieList.length ? 'high' : 'medium', `${plural(insecure.length, 'cookie')} set without the Secure attribute`, 'Cookies without Secure can be sent over plain HTTP and stolen by network observers.', 'Set the Secure flag on every cookie.', [{ type: 'text', value: insecure.slice(0, 6).map((c) => c.split(';')[0]).join('\n') }], 'Cookies'),
      );
    }
    if (noneWithoutSecure.length > 0) {
      issues.push(
        issue('security', 'security', 'high', 'Cookies use SameSite=None without Secure', 'Browsers reject SameSite=None cookies without Secure, breaking cross-site behaviour; setting it anyway is unsafe.', 'Add Secure to SameSite=None cookies.', [{ type: 'text', value: noneWithoutSecure.slice(0, 6).map((c) => c.split(';')[0]).join('\n') }], 'Cookies'),
      );
    }
    if (isHttps) metrics.push(metric('sec_cookies', 'Cookies set', cookieList.length, 'neutral', undefined, `${cookieList.length - insecure.length}/${cookieList.length} Secure`));
  } else {
    metrics.push(metric('sec_cookies', 'Cookies set', 0, 'good'));
  }

  // ---------- Mixed content -------------------------------------------------
  if (isHttps) {
    const mixed: string[] = [];
    const attrsToCheck: { sel: string; attr: string }[] = [
      { sel: 'script[src]', attr: 'src' },
      { sel: 'img[src]', attr: 'src' },
      { sel: 'link[href]', attr: 'href' },
      { sel: 'iframe[src]', attr: 'src' },
      { sel: 'video[src]', attr: 'src' },
      { sel: 'source[src]', attr: 'src' },
      { sel: 'audio[src]', attr: 'src' },
      { sel: 'embed[src]', attr: 'src' },
      { sel: 'object[data]', attr: 'data' },
      { sel: 'form[action]', attr: 'action' },
    ];
    for (const { sel, attr } of attrsToCheck) {
      homepage.$(sel).each((_i, el) => {
        const v = homepage.$(el).attr(attr) ?? '';
        if (/^http:\/\//i.test(v) && mixed.length < 25 && !mixed.includes(v)) mixed.push(v);
      });
    }
    for (const a of ctx.assets) {
      if (/^http:\/\//i.test(a.url) && mixed.length < 25 && !mixed.includes(a.url)) mixed.push(a.url);
    }
    for (const img of ctx.images) {
      if (/^http:\/\//i.test(img.url) && mixed.length < 25 && !mixed.includes(img.url)) mixed.push(img.url);
    }
    if (mixed.length > 0) {
      issues.push(
        issue('security', 'security', 'high', `${plural(mixed.length, 'mixed-content resource')} loaded over HTTP`, 'Browsers block or warn about active mixed content (scripts/styles) and passively warn about images, which can break pages and leak data.', 'Serve every resource from https:// URLs.', mixed.slice(0, 8).map((u) => ({ type: 'url' as const, value: u })), 'Mixed content'),
      );
    }
  }

  // ---------- Browser-level security signals --------------------------------
  if (browserMetrics?.resources.thirdPartyRequests) {
    metrics.push(
      metric('sec_third_party_requests', 'Third-party requests (page load)', browserMetrics.resources.thirdPartyRequests, 'neutral', undefined, `${Math.round(browserMetrics.resources.thirdPartyBytes / 1024)} KB transferred`),
    );
  }

  return out(issues, metrics, notes);
}

