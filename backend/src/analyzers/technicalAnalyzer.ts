import type { AuditContext } from '../engine/context';
import { issue, metric, out, plural, headerStr, isBrokenHttpStatus } from './helpers';
import type { AnalyzerOutput } from '../engine/context';
import { safeFetch } from '../http/httpClient';

/** Technical health: HTTP behaviour, redirects, robots/sitemap/favicon, resources. */
export async function analyzeTechnical(ctx: AuditContext): Promise<AnalyzerOutput> {
  const { homepage } = ctx;
  const { $, finalUrl, headers, statusCode, redirects } = homepage;
  const issues: AnalyzerOutput['issues'] = [];
  const metrics: AnalyzerOutput['metrics'] = [];
  const notes: string[] = [];

  const url = new URL(finalUrl);
  const hostNoWww = url.hostname.replace(/^www\./, '');
  const isSameHost = (h: string): boolean => h.replace(/^www\./, '') === hostNoWww;

  // ---------- HTTP status ---------------------------------------------------
  if (statusCode >= 200 && statusCode < 300) {
    metrics.push(metric('tech_http_status', 'HTTP status', statusCode, 'good'));
  } else if (statusCode >= 300) {
    issues.push(
      issue('technical', 'technical', 'high', `Homepage responds with HTTP ${statusCode}`, 'Search engines and visitors expect the canonical URL to return a final 2xx response.', 'Fix the redirect/status configuration so the homepage returns 200.', [{ type: 'text', value: `GET ${finalUrl} → HTTP ${statusCode}` }], 'HTTP status'),
    );
  }

  // ---------- Redirects -----------------------------------------------------
  if (redirects.length > 1) {
    issues.push(
      issue('technical', 'technical', 'medium', `${redirects.length} redirect hops before the homepage loads`, 'Extra redirect hops add latency and can waste crawl budget.', 'Update internal links and bookmarks to the final URL, and reduce chained redirects.', [{ type: 'text', value: redirects.map((r) => `→ ${r.statusCode} ${r.url}`).join('\n') }], 'Redirects'),
    );
  } else if (redirects.length === 1) {
    const hop = redirects[0];
    const fromHttp = new URL(hop.url).protocol === 'http:';
    const toHttps = url.protocol === 'https:';
    if (!(fromHttp && toHttps)) {
      issues.push(
        issue('technical', 'technical', 'low', `Homepage uses ${redirects.length} redirect`, 'Single redirects are common but removing them saves a network round trip.', 'Link directly to the final URL.', [{ type: 'text', value: `→ ${hop.statusCode} ${hop.url}` }], 'Redirects'),
      );
    }
  }

  // ---------- favicon -------------------------------------------------------
  const iconHref = $('link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]').first().attr('href');
  let faviconFound = false;
  let faviconEvidence = '';
  if (iconHref) {
    try {
      const u = new URL(iconHref, finalUrl);
      const res = await safeFetch(u.toString(), { timeoutMs: 6000, maxBytes: 512 * 1024, allowErrorStatus: true, method: 'GET' });
      faviconFound = res.statusCode >= 200 && res.statusCode < 400;
      faviconEvidence = `${u.toString()} → HTTP ${res.statusCode}`;
    } catch {
      faviconEvidence = `${iconHref} (could not be fetched)`;
    }
  } else {
    try {
      const res = await safeFetch(`${url.origin}/favicon.ico`, { timeoutMs: 6000, maxBytes: 512 * 1024, allowErrorStatus: true, method: 'GET' });
      faviconFound = res.statusCode >= 200 && res.statusCode < 400;
      faviconEvidence = `/favicon.ico → HTTP ${res.statusCode}`;
    } catch {
      faviconEvidence = 'no favicon reachable';
    }
  }
  if (!faviconFound) {
    issues.push(
      issue('technical', 'technical', 'low', 'Favicon not found', 'Browsers request a favicon automatically; a missing one produces 404 noise and a default tab icon.', 'Add a favicon and reference it with <link rel="icon">.', [{ type: 'text', value: faviconEvidence }], 'Favicon'),
    );
  }
  metrics.push(metric('tech_favicon', 'Favicon', faviconFound ? 'Found' : 'Missing', faviconFound ? 'good' : 'warn'));

  // ---------- robots.txt ----------------------------------------------------
  const robots = ctx.robots;
  if (robots) {
    if (robots.statusCode === null || robots.statusCode >= 500 || robots.statusCode === 0) {
      issues.push(
        issue('technical', 'technical', 'medium', 'robots.txt could not be fetched', 'Crawlers use robots.txt to learn which areas of the site may be crawled.', 'Make robots.txt reachable at the site root.', [{ type: 'text', value: `robots.txt request did not complete (no response or server error)` }], 'robots.txt'),
      );
    } else if (robots.statusCode === 404) {
      issues.push(
        issue('technical', 'technical', 'low', 'robots.txt is missing (HTTP 404)', 'Without robots.txt you cannot manage crawl behaviour for the site.', 'Add a robots.txt at the site root.', [{ type: 'text', value: 'GET /robots.txt → 404' }], 'robots.txt'),
      );
    } else {
      if (robots.disallowAll) {
        notes.push('robots.txt disallows crawling of the whole site; the crawler respected this and analysed the homepage only.');
      }
      metrics.push(metric('tech_robots', 'robots.txt', `HTTP ${robots.statusCode}`, 'good', undefined, robots.disallowAll ? 'Allows no crawling' : undefined));
    }
    if (robots.sitemaps.length) metrics.push(metric('tech_sitemap_in_robots', 'Sitemap in robots.txt', robots.sitemaps.join(', '), 'good'));
  }

  // ---------- sitemap -------------------------------------------------------
  const sitemap = ctx.sitemap;
  if (sitemap) {
    if (sitemap.statusCode !== null && sitemap.statusCode >= 200 && sitemap.statusCode < 400) {
      metrics.push(metric('tech_sitemap', 'XML sitemap', `HTTP ${sitemap.statusCode} · ${sitemap.urlCount ?? 0} URL${(sitemap.urlCount ?? 0) === 1 ? '' : 's'}`, 'good'));
    } else if (sitemap.statusCode === 404) {
      issues.push(
        issue('technical', 'technical', 'low', 'XML sitemap not found (HTTP 404)', 'An XML sitemap helps search engines discover pages, especially new or deep content.', 'Create an XML sitemap listing your canonical URLs and submit it in search consoles.', [{ type: 'text', value: 'GET /sitemap.xml → 404' }], 'Sitemap'),
      );
    } else if (sitemap.statusCode === null) {
      issues.push(
        issue('technical', 'technical', 'low', 'XML sitemap could not be checked', 'Without a sitemap it is harder for search engines to discover all pages.', 'Add a sitemap or verify the server responds for /sitemap.xml.', [{ type: 'text', value: 'No sitemap reachable (timeout or error).' }], 'Sitemap'),
      );
    } else {
      issues.push(
        issue('technical', 'technical', 'medium', `XML sitemap returned HTTP ${sitemap.statusCode}`, 'A failing sitemap may cause search engines to drop URLs from the index over time.', 'Fix the sitemap endpoint.', [{ type: 'text', value: `GET /sitemap.xml → HTTP ${sitemap.statusCode}` }], 'Sitemap'),
      );
    }
  }

  // ---------- Charset -------------------------------------------------------
  const charsetMeta = $('meta[charset]').attr('charset');
  const ct = headerStr(headers, 'content-type') ?? '';
  const charsetInHeader = /charset=/i.test(ct);
  if (!charsetMeta && !charsetInHeader) {
    issues.push(
      issue('technical', 'technical', 'medium', 'Character encoding not declared', 'Browsers may guess the encoding and display mojibake for non-ASCII characters (accents, currencies).', 'Add <meta charset="utf-8"> as the first element in <head>.', [{ type: 'code', value: '<meta charset="utf-8"> missing from <head>.' }], 'HTML validity'),
    );
  }

  // ---------- Structural indicators ----------------------------------------
  const htmlCount = $('html').length;
  const bodyCount = $('body').length;
  const headCount = $('head').length;
  if (htmlCount > 1 || bodyCount > 1) {
    issues.push(
      issue('technical', 'technical', 'medium', 'Multiple <html>/<body> elements detected', 'Browsers must reconcile duplicated document roots, which can cause unpredictable rendering.', 'Ensure the page has a single <html>, <head> and <body>.', [{ type: 'text', value: `html:${htmlCount} head:${headCount} body:${bodyCount}` }], 'HTML validity'),
    );
  }
  const openDivs = $('div').length;
  const closingDivs = (homepage.html.match(/<\/div>/gi) ?? []).length;
  if (openDivs > 0 && Math.abs(openDivs - closingDivs) > 3) {
    issues.push(
      issue('technical', 'technical', 'low', 'Unbalanced <div> tags detected (HTML validity indicator)', 'Unbalanced tags indicate markup errors that can break layouts in some browsers.', 'Validate the HTML and fix tag mismatches. Note: automated HTML validity checks are best-effort and not a full spec validation.', [{ type: 'text', value: `${openDivs} opening vs ${closingDivs} closing <div> tags` }], 'HTML validity'),
    );
  }

  // ---------- Broken internal resources ------------------------------------
  const internalAssets = ctx.assets.filter((a) => isSameHost(a.host));
  const brokenAssets = internalAssets.filter((a) => isBrokenHttpStatus(a.statusCode));
  const blockedAssets = internalAssets.filter(
    (a) => a.statusCode === 401 || a.statusCode === 403 || a.statusCode === 429 || (a.statusCode === 0 && !!a.error),
  );
  if (brokenAssets.length > 0) {
    issues.push(
      issue('technical', 'technical', 'high', `${plural(brokenAssets.length, 'internal resource')} failed to load (HTTP ${brokenAssets[0].statusCode})`, 'Broken CSS/JavaScript resources can break layout and functionality for visitors.', 'Fix the failing asset URL or remove the reference.', brokenAssets.slice(0, 6).map((a) => ({ type: 'url' as const, value: `${a.url} → HTTP ${a.statusCode || 'error'}` })), 'Resources'),
    );
  } else if (blockedAssets.length > 0) {
    notes.push(`${blockedAssets.length} asset request(s) could not be completed (possible bot protection or hot-link blocking).`);
  }

  metrics.push(
    metric('tech_redirects', 'Redirect chain', redirects.length === 0 ? 'None' : `${redirects.length} hop${redirects.length > 1 ? 's' : ''}`, redirects.length <= 1 ? 'good' : 'warn'),
    metric('tech_assets_internal', 'Internal assets checked', internalAssets.length, 'neutral'),
    metric('tech_http_version', 'HTTP version', homepage.httpVersion, 'neutral'),
  );

  const serverHeader = headerStr(headers, 'server') ?? headerStr(headers, 'x-powered-by');
  if (serverHeader) {
    metrics.push(metric('tech_server', 'Server header', serverHeader, 'neutral'));
    if (/[\d]+\.[\d]+/.test(serverHeader)) {
      issues.push(
        issue('technical', 'technical', 'low', 'Server header discloses a version number', 'Version disclosure helps attackers target known vulnerabilities in that version.', 'Remove version numbers from Server / X-Powered-By headers.', [{ type: 'header', label: 'Server', value: serverHeader }], 'Header hygiene'),
      );
    }
  }

  notes.push('HTML "validity indicators" are heuristic checks, not a full W3C markup validation.');
  return out(issues, metrics, notes);
}
