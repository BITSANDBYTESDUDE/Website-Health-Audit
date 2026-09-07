import type { AuditContext } from '../engine/context';
import { issue, metric, out, plural, isBrokenHttpStatus } from './helpers';
import type { AnalyzerOutput } from '../engine/context';

/**
 * Link analyzer — internal page health discovered by the controlled crawler,
 * plus anchor/link statistics from the homepage markup.
 */
export async function analyzeLinks(ctx: AuditContext): Promise<AnalyzerOutput> {
  const { crawledPages, homepageLinks, scanType } = ctx;
  const issues: AnalyzerOutput['issues'] = [];
  const metrics: AnalyzerOutput['metrics'] = [];
  const notes: string[] = [];

  const homeUrl = ctx.homepage.finalUrl.replace(/\/$/, '');
  const distinctPages = new Map<string, (typeof crawledPages)[number]>();
  for (const p of crawledPages) {
    const key = p.url.replace(/\/$/, '');
    if (!distinctPages.has(key)) distinctPages.set(key, p);
  }
  const pages = [...distinctPages.values()];

  const homePage = pages.find((p) => p.url.replace(/\/$/, '') === homeUrl);
  const internalTargets = [...distinctPages.keys()];

  if (scanType === 'quick') {
    notes.push('Quick scan analysed the homepage only; internal link health was not crawled. Use Standard or Deep scan to check internal links.');
  } else {
    const broken = pages.filter((p) => isBrokenHttpStatus(p.statusCode) && !p.redirectedOffsite);
    const redirected = pages.filter((p) => p.statusCode >= 300 && p.statusCode < 400 && !p.redirectedOffsite);
    const blocked = pages.filter((p) => p.statusCode === 401 || p.statusCode === 403 || p.statusCode === 429);
    const healthy = pages.filter((p) => p.statusCode >= 200 && p.statusCode < 300);
    const offsite = pages.filter((p) => p.redirectedOffsite);
    const errored = pages.filter((p) => p.error && !p.redirectedOffsite);

    if (broken.length > 0) {
      issues.push(
        issue('links', 'technical', 'high', `${plural(broken.length, 'internal page')} return HTTP ${broken[0].statusCode}`, 'Broken internal pages create dead ends for visitors, waste search-engine crawl budget and damage trust.', 'Fix the broken pages or remove/replace links pointing to them.', broken.slice(0, 10).map((p) => ({ type: 'url' as const, value: `${p.url} → HTTP ${p.statusCode}` })), 'Broken links'),
      );
    }
    if (errored.length > 0) {
      issues.push(
        issue('links', 'technical', 'medium', `${plural(errored.length, 'internal page')} could not be reached during the audit`, 'Pages that fail to respond waste crawl budget and may indicate server instability.', 'Check server health and error logs for the affected URLs.', errored.slice(0, 8).map((p) => ({ type: 'url' as const, value: `${p.url} (${p.error})` })), 'Unreachable pages'),
      );
    }
    if (redirected.length > 0) {
      issues.push(
        issue('links', 'technical', 'low', `${plural(redirected.length, 'internal page')} respond with a redirect`, 'Redirected links add an extra round trip and can be simplified over time.', 'Update links to point directly at the final URL where possible.', redirected.slice(0, 8).map((p) => ({ type: 'url' as const, value: `${p.url} → HTTP ${p.statusCode}` })), 'Redirected links'),
      );
    }
    if (blocked.length > 0) {
      notes.push(`${blocked.length} internal page(s) restricted automated access (HTTP ${blocked[0].statusCode}); they were not inspected.`);
    }
    if (offsite.length > 0) {
      notes.push(`${offsite.length} internal link(s) redirect off-site; off-domain content is never crawled.`);
    }
    metrics.push(
      metric('lnk_healthy', 'Healthy internal pages (2xx)', healthy.length, 'good'),
      metric('lnk_redirected', 'Redirected (3xx)', redirected.length, redirected.length === 0 ? 'good' : 'warn'),
      metric('lnk_broken', 'Broken (4xx/5xx)', broken.length, broken.length === 0 ? 'good' : 'bad'),
      metric('lnk_pages', 'Internal pages checked', pages.length, 'neutral'),
    );
  }

  // ---------- Homepage link statistics --------------------------------------
  const internal = homepageLinks.filter((l) => l.to === 'internal');
  const external = homepageLinks.filter((l) => l.to === 'external');
  const uniqueInternal = new Map<string, string[]>();
  for (const l of internal) {
    const norm = l.url.replace(/\/$/, '');
    const arr = uniqueInternal.get(norm) ?? [];
    arr.push(l.text);
    uniqueInternal.set(norm, arr);
  }

  // Links pointing at the same URL but omitted from crawl target set.
  const homeLinksToOthers = [...uniqueInternal.keys()].filter((u) => {
    try {
      return new URL(u).pathname !== '/' && !internalTargets.includes(u);
    } catch {
      return false;
    }
  });
  if (homeLinksToOthers.length > 0 && scanType !== 'quick') {
    notes.push(`${homeLinksToOthers.length} homepage link(s) target pages outside the crawl budget (pages: ${ctx.limits.maxPages}, depth: ${ctx.limits.maxDepth}).`);
  }

  metrics.push(
    metric('lnk_home_internal', 'Internal links from homepage', uniqueInternal.size, 'neutral'),
    metric('lnk_home_external', 'External links from homepage', external.length, 'neutral'),
  );

  if (homePage) {
    const fromHome = internal.filter((l) => {
      const u = l.url.replace(/\/$/, '');
      const normHome = homePage.finalUrl.replace(/\/$/, '');
      return u !== normHome;
    });
    notes.push(`${fromHome.length} unique internal page(s) are linked from the homepage.`);
  }

  return out(issues, metrics, notes);
}
