import { load as cheerioLoad, type CheerioAPI } from 'cheerio';
import fs from 'node:fs';
import path from 'node:path';
import RobotsParser from 'robots-parser';
import { config, dataDir } from '../config';
import type { ScanType, Issue, Metric, StageState, AuditResult, PageScan, CategoryScore } from '../types';
import { validateAuditTarget } from '../utils/url';
import { safeFetch, rawRequest, HttpRequestError } from '../http/httpClient';
import { fetchRobots } from '../http/robots';
import { crawlSite, type CrawlPage } from '../crawler/crawler';
import { runBrowserAudit } from '../rendering/browser';
import type { AuditContext, RobotsInfo, ImageAsset, FetchedAsset, CrawledPageMeta, PageLink, AxeViolation, BrowserMetrics } from './context';
import { detectTechnologies } from '../analyzers/technologyDetector';
import { analyzeSeo } from '../analyzers/seoAnalyzer';
import { analyzeTechnical } from '../analyzers/technicalAnalyzer';
import { analyzeContent } from '../analyzers/contentAnalyzer';
import { analyzeSecurity } from '../analyzers/securityAnalyzer';
import { analyzeImages } from '../analyzers/imageAnalyzer';
import { analyzeLinks } from '../analyzers/linkAnalyzer';
import { analyzePerformance } from '../analyzers/performanceAnalyzer';
import { analyzeMobile } from '../analyzers/mobileAnalyzer';
import { analyzeAccessibility } from '../analyzers/accessibilityAnalyzer';
import { analyzeConversion } from '../analyzers/conversionAnalyzer';
import { collectCssJsUrls, collectFontUrls, collectImages, collectLinks, fetchAssets, measureImages, cleanText } from '../analyzers/helpers';
import { computeCategoryScores, computeOverall, gradeForScore, countIssues } from '../scoring/scoring';
import { AuditFatalError, mapErrorToAudit, looksBlocked } from './errors';
import { runAiSummary } from '../ai/summary';
import { log } from '../utils/log';

const ENGINE_VERSION = '1.0.0';

export interface EngineHooks {
  onStage: (stages: StageState[], activeId: string, message: string) => void;
}

export interface AuditJob {
  id: string;
  url: string;
  scanType: ScanType;
}

export interface EngineResult {
  result: AuditResult;
  fatal: { code: string; message: string } | null;
}

const STAGE_LABELS: Record<string, string> = {
  validate: 'Validating URL',
  connect: 'Connecting to website',
  robots: 'Checking robots.txt & sitemap',
  crawl: 'Crawling internal pages',
  browser: 'Launching browser audit',
  seo: 'Analyzing SEO',
  performance: 'Analyzing performance',
  security: 'Checking security configuration',
  accessibility: 'Running accessibility checks',
  mobile: 'Checking mobile experience',
  images: 'Analyzing images',
  links: 'Checking links',
  content: 'Reviewing content',
  conversion: 'Reviewing conversion signals',
  score: 'Calculating score',
};

const STAGE_ORDER = ['validate', 'connect', 'robots', 'crawl', 'browser', 'seo', 'performance', 'security', 'accessibility', 'mobile', 'images', 'links', 'content', 'conversion', 'score'];

function makeStages(): StageState[] {
  return STAGE_ORDER.map((id) => ({ id, label: STAGE_LABELS[id], status: 'pending' as const }));
}

const SECTION_CODE: Record<string, string> = {
  performance: 'PERF',
  seo: 'SEO',
  mobile: 'MOB',
  accessibility: 'A11Y',
  security: 'SEC',
  technical: 'TECH',
  content: 'CONT',
  images: 'IMAG',
  links: 'LINK',
  conversion: 'CONV',
};

export async function runAudit(job: AuditJob, hooks: EngineHooks): Promise<EngineResult> {
  const startedAt = Date.now();
  const stages = makeStages();
  let fatal: { code: string; message: string } | null = null;
  const notes: string[] = [];
  const homeMeta = new Map<string, { title: string | null; metaDescription: string | null; canonical: string | null; h1s: string[]; wordCount: number }>();

  const setStage = (id: string, message: string, fail = false): void => {
    const current = stages.find((s) => s.id === id);
    if (!current) return;
    for (const s of stages) {
      if (s.id === id) s.status = fail ? 'failed' : 'active';
      else if (s.status === 'active') s.status = 'done';
    }
    hooks.onStage(stages, id, message);
  };
  const finishStage = (id: string): void => {
    const s = stages.find((x) => x.id === id);
    if (s) s.status = 'done';
  };

  const overallDeadline = Date.now() + config.totalScanTimeoutMs;
  try {
    // ---------- validate ----------
    setStage('validate', 'Validating URL and network safety…');
    const validation = await validateAuditTarget(job.url);
    if (!validation.ok || !validation.url || !validation.addresses) {
      throw new AuditFatalError(validation.issue ?? 'INVALID_URL', validation.message ?? 'That URL is not valid.');
    }
    const normalizedUrl = validation.url.toString();
    const originUrl = new URL(normalizedUrl);
    const origin = originUrl.origin;
    const domain = originUrl.hostname;
    finishStage('validate');

    // ---------- connect (fetch homepage with redirect trace) ----------
    setStage('connect', `Fetching ${domain}…`);
    const trace = await fetchWithTrace(normalizedUrl, overallDeadline);
    const res = trace.res;
    const bodyText = res.text;
    if (res.statusCode >= 400) {
      throw new AuditFatalError('HTTP_ERROR', `The website responded with HTTP ${res.statusCode}.`, `status ${res.statusCode}`);
    }
    if (looksBlocked(res.statusCode, bodyText)) {
      throw new AuditFatalError('ACCESS_RESTRICTED', `"${domain}" blocked automated access (bot protection challenge detected).`, 'bot protection');
    }
    const ct = String(res.headers['content-type'] ?? '');
    if (/^\s*(image|video|audio)\//i.test(ct) || /application\/(pdf|x-msdownload|zip|octet-stream)/i.test(ct) && !/text|html|json|xml/.test(ct)) {
      throw new AuditFatalError('UNSUPPORTED_CONTENT', `"${domain}" did not return an HTML page (${ct || 'unknown content type'}). Only HTML websites can be audited.`);
    }
    const homepageUrl = trace.hops.length ? trace.hops[trace.hops.length - 1].url : normalizedUrl;
    const finalHref = res.finalUrl || homepageUrl;
    const finalUrlObj = new URL(finalHref);
    const isHttpsFinal = finalUrlObj.protocol === 'https:';
    const homepageCheerio = cheerioLoad(bodyText);
    notes.push(`Homepage fetched: HTTP ${res.statusCode} (${res.sizeBytes} bytes) in ${Math.round(res.timings.totalMs)} ms`);

    // ---------- robots + sitemap ----------
    setStage('robots', 'Reading robots.txt…');
    const robotsRaw = await fetchRobots(origin, { timeoutMs: 8000 });
    const robots: RobotsInfo | null = robotsRaw.fetched
      ? {
          fetched: true,
          statusCode: robotsRaw.statusCode,
          allowsCrawl: robotsRaw.allowsCrawl,
          disallowAll: robotsRaw.disallowAll,
          sitemaps: robotsRaw.sitemaps,
          bodyExcerpt: robotsRaw.body.slice(0, 500),
        }
      : null;
    const sitemap = await probeSitemap(origin, robotsRaw.sitemaps);
    finishStage('robots');

    // ---------- crawl ----------
    const limits =
      job.scanType === 'quick'
        ? { maxPages: 1, maxDepth: 0 }
        : job.scanType === 'deep'
          ? { maxPages: config.crawl.deepPages, maxDepth: config.crawl.deepDepth }
          : { maxPages: config.crawl.standardPages, maxDepth: 2 };

    let crawledPages: CrawlPage[] = [];
    const homepageLinks = collectLinks(homepageCheerio, finalHref, domain);
    if (job.scanType !== 'quick' && robotsRaw.allowsCrawl && Date.now() < overallDeadline) {
      setStage('crawl', `Crawling internal pages (max ${limits.maxPages - 1} additional, depth ${limits.maxDepth})…`);
      const parser = RobotsParser(`${origin}/robots.txt`, robotsRaw.body);
      const seedUrls = homepageLinks.filter((l) => l.to === 'internal').slice(0, 60).map((l) => l.url);
      try {
        crawledPages = await crawlSite({
          origin,
          startUrl: finalHref,
          seedUrls,
          limits: { maxPages: Math.max(limits.maxPages - 1, 1), maxDepth: limits.maxDepth, concurrency: 3 },
          isAllowedByRobots: (p: string) => parser.isAllowed(`${origin}${p}`, 'SitePulseBot/1.0') ?? true,
          deadlineMs: Math.min(overallDeadline, Date.now() + 90_000),
          onPage: (p) => {
            if (homeMeta.size < 80) homeMeta.set(p.url, parsePageMeta(p.html));
          },
        });
      } catch (err) {
        log.warn('crawler failed', { error: String(err) });
        notes.push('The internal crawler hit an unexpected error; results are based on the homepage only.');
      }
      finishStage('crawl');
    } else if (job.scanType !== 'quick' && !robotsRaw.allowsCrawl) {
      notes.push('robots.txt disallows crawling; only the homepage was audited (crawl policy respected).');
    }

    // ---------- browser ----------
    setStage('browser', 'Preparing rendering environment…');
    const { mode, browserMetrics, axeViolations, screenshotFile } = await runBrowserOrStatic(finalHref, job.id, overallDeadline);
    finishStage('browser');

    // ---------- collect assets & images over HTTP (both modes) ----------
    const cssJs = collectCssJsUrls(homepageCheerio, finalHref);
    const fontLinks = collectFontUrls(homepageCheerio, finalHref);
    const cssFonts = extractFontsFromCss(await fetchStylesheetTextForFonts(cssJs.filter((c) => c.kind === 'style'), finalHref));
    const allFonts = [...new Set([...fontLinks, ...cssFonts])];
    const assets = await fetchAssets(
      [
        ...cssJs.filter((c) => c.kind === 'script').slice(0, 12).map((c) => ({ url: c.url, kind: 'script' as const })),
        ...cssJs.filter((c) => c.kind === 'style').slice(0, 8).map((c) => ({ url: c.url, kind: 'style' as const })),
        ...allFonts.slice(0, 6).map((u) => ({ url: u, kind: 'font' as const })),
      ],
      { concurrency: 4, timeoutMs: 8000, maxBytes: 3 * 1024 * 1024, referer: finalHref },
    );

    const imagesAll = collectImages(homepageCheerio, finalHref, domain);
    const images = await measureImages(imagesAll.slice(0, 30), { concurrency: 4, timeoutMs: 8000, maxBytes: 4 * 1024 * 1024, referer: finalHref });
    if (imagesAll.length > images.length) notes.push(`${imagesAll.length - images.length} additional image(s) were counted but not byte-measured (sample cap).`);

    // ---------- context ----------
    const pageDocs = new Map<string, { title: string | null; metaDescription: string | null; canonical: string | null; h1s: string[]; wordCount: number; links: PageLink[]; statusCode: number; url: string }>();
    for (const [u, meta] of homeMeta) {
      pageDocs.set(u, { ...meta, links: [], statusCode: 200, url: u });
    }
    for (const p of crawledPages) {
      const existing = pageDocs.get(p.url);
      if (existing) {
        existing.statusCode = p.statusCode;
      } else {
        pageDocs.set(p.url, { title: p.title || null, metaDescription: null, canonical: null, h1s: [], wordCount: 0, links: [], statusCode: p.statusCode, url: p.url });
      }
    }
    const protocolProbe = await buildProtocolProbe(finalHref, isHttpsFinal, trace);

    const ctx: AuditContext = {
      scanType: job.scanType,
      mode,
      limits,
      inputUrl: job.url,
      normalizedUrl,
      domain,
      host: finalUrlObj.host,
      homepage: {
        url: normalizedUrl,
        finalUrl: finalHref,
        statusCode: res.statusCode,
        headers: res.headers,
        html: bodyText,
        text: cleanText(homepageCheerio),
        sizeBytes: res.sizeBytes,
        ttfbMs: res.timings.ttfbMs,
        durationMs: res.timings.totalMs,
        httpVersion: res.httpVersion,
        redirects: trace.hops,
        tls: res.tls,
        $: homepageCheerio,
      },
      crawledPages: crawledPages.map(toCrawledMeta),
      robots,
      sitemap,
      protocolProbe,
      assets,
      images,
      axeViolations,
      browserMetrics,
      links: crawledPages.flatMap((p) => []),
      pageDocs,
      homepageLinks,
      internalTargets: crawledPages.map((p) => p.url),
    };

    // ---------- analyzers (ordered to match UI progress) ----------
    setStage('seo', 'Analyzing title, meta and structured data…');
    const seoOut = await analyzeSeo(ctx);
    finishStage('seo');

    setStage('performance', 'Measuring response times and resources…');
    const perfOut = await analyzePerformance(ctx);
    finishStage('performance');

    setStage('security', 'Inspecting security headers and TLS…');
    const secOut = await analyzeSecurity(ctx);
    finishStage('security');

    setStage('accessibility', 'Running automated accessibility rules…');
    const a11yOut = await analyzeAccessibility(ctx);
    finishStage('accessibility');

    setStage('mobile', 'Checking viewport and mobile layout…');
    const mobOut = await analyzeMobile(ctx);
    finishStage('mobile');

    setStage('images', 'Measuring image sizes…');
    const imgOut = await analyzeImages(ctx);
    finishStage('images');

    setStage('links', 'Verifying internal links…');
    const linkOut = await analyzeLinks(ctx);
    finishStage('links');

    setStage('content', 'Reviewing visible content…');
    const contentOut = await analyzeContent(ctx);
    finishStage('content');

    setStage('conversion', 'Reviewing conversion signals…');
    const convOut = await analyzeConversion(ctx);
    finishStage('conversion');

    // ---------- normalize + score ----------
    setStage('score', 'Calculating reproducible scores…');
    const allIssues: Issue[] = [];
    const metrics: Metric[] = [];
    const analyzerOutputs = [seoOut, perfOut, secOut, a11yOut, mobOut, imgOut, linkOut, contentOut, convOut];
    for (const ao of analyzerOutputs) {
      for (const m of ao.metrics) {
        const idx = metrics.findIndex((x) => x.key === m.key);
        if (idx >= 0) metrics[idx] = m;
        else metrics.push(m);
      }
      notes.push(...ao.notes);
    }

    const counter: Record<string, number> = {};
    for (const ao of analyzerOutputs) {
      for (const raw of ao.issues) {
        const code = SECTION_CODE[raw.section] ?? 'GEN';
        counter[raw.section] = (counter[raw.section] ?? 0) + 1;
        allIssues.push({
          code: `${code}-${String(counter[raw.section]).padStart(2, '0')}`,
          section: raw.section,
          bucket: raw.bucket,
          severity: raw.severity,
          title: raw.title,
          whyItMatters: raw.whyItMatters,
          recommendedFix: raw.recommendedFix,
          evidence: raw.evidence.slice(0, 6),
          area: raw.area,
        });
      }
    }

    // Extra technical data gathered during the audit
    const homepageContentType = String(res.headers['content-type'] ?? '').split(';')[0].trim() || 'text/html';
    metrics.push(
      { key: 'tech_status_home', label: 'Homepage HTTP status', value: res.statusCode, status: res.statusCode >= 200 && res.statusCode < 300 ? 'good' : 'warn' },
      { key: 'tech_content_type', label: 'Content type', value: homepageContentType, status: 'neutral' },
      { key: 'audit_mode', label: 'Audit mode', value: mode === 'browser' ? 'Browser-rendered analysis' : 'Static analysis (no browser engine available)', status: 'neutral' },
      { key: 'scan_pages', label: 'Pages scanned', value: 1 + ctx.crawledPages.length, status: 'neutral' },
      { key: 'scan_type', label: 'Scan type', value: job.scanType[0].toUpperCase() + job.scanType.slice(1), status: 'neutral' },
    );

    const passedChecks = buildPassedChecks(ctx, res.statusCode, browserMetrics);
    allIssues.push(...passedChecks);

    const categoryScores: Record<string, CategoryScore> = computeCategoryScores(allIssues);
    const overallScore = computeOverall(categoryScores);
    const grade = gradeForScore(overallScore);
    const issuesByWeight = countIssues(allIssues.filter((i) => i.bucket !== 'none'));

    const pages: PageScan[] = buildPageScans(ctx);
    const techSignals = detectTechnologies(ctx);

    // Recommendations from deterministic findings
    const recommendations = buildRecommendations(allIssues);
    const summary = buildSummary(grade, overallScore, categoryScores, allIssues);

    // AI (optional) may only reword the summary; never touches metrics.
    let aiUsed = false;
    if (config.ai.apiKey) {
      try {
        const aiSummary = await runAiSummary({
          url: ctx.domain,
          grade,
          overallScore,
          categoryScores,
          issues: allIssues.filter((i) => i.severity !== 'passed').slice(0, 12),
        });
        if (aiSummary) {
          summary.headline = aiSummary;
          summary.aiGenerated = true;
          aiUsed = true;
        }
      } catch (err) {
        log.warn('AI summary failed; deterministic summary used', { error: String(err) });
      }
    }

    const crawlPolicyNotes: string[] = [];
    crawlPolicyNotes.push(`Same-origin crawl only (never follows to other domains).`);
    crawlPolicyNotes.push(`Maximum ${limits.maxPages} page(s), depth ${limits.maxDepth}.`);
    crawlPolicyNotes.push(robotsRaw.allowsCrawl ? 'robots.txt respected — crawling permitted.' : 'robots.txt respected — crawling disallowed (homepage only).');
    if (job.scanType === 'quick') crawlPolicyNotes.push('Quick scan audits the homepage only. Standard scans up to 10 pages; deep scans up to 50.');

    const result: AuditResult = {
      id: job.id,
      url: job.url,
      normalizedUrl,
      domain: finalUrlObj.host,
      scanType: job.scanType,
      status: 'completed',
      mode,
      createdAt: new Date().toISOString(),
      startedAt: new Date(startedAt).toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      pagesScanned: pages.length,
      pages,
      stages,
      metrics,
      issues: allIssues,
      categoryScores,
      overallScore,
      summary,
      recommendations,
      technologies: techSignals,
      crawlPolicy: {
        maxPages: limits.maxPages,
        maxDepth: limits.maxDepth,
        respectsRobotsTxt: true,
        sameDomainOnly: true,
        robotsAllowedCrawl: robotsRaw.allowsCrawl,
        notes: crawlPolicyNotes,
      },
      ai: { used: aiUsed, note: aiUsed ? 'AI reworded the executive summary only. All measurements and scores are deterministic.' : 'AI layer disabled — deterministic analysis used.' },
      screenshot: screenshotFile,
      notes,
      engineVersion: ENGINE_VERSION,
    };
    setStage('score', `Audit complete: ${grade} (${overallScore ?? 'n/a'}/100)`);
    hooks.onStage(stages, 'score', result.summary?.headline ?? 'Audit complete');
    return { result, fatal };
  } catch (err) {
    const auditErr = mapErrorToAudit(err, job.url);
    fatal = { code: auditErr.code, message: auditErr.clientMessage };
    for (const s of stages) {
      if (s.status === 'active') s.status = 'failed';
    }
    const partial: AuditResult = {
      id: job.id,
      url: job.url,
      normalizedUrl: job.url,
      domain: safeDomain(job.url),
      scanType: job.scanType,
      status: 'failed',
      mode: 'static',
      createdAt: new Date().toISOString(),
      startedAt: new Date(startedAt).toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      pagesScanned: 0,
      pages: [],
      stages,
      metrics: [],
      issues: [],
      categoryScores: {},
      overallScore: null,
      summary: null,
      recommendations: [],
      technologies: [],
      crawlPolicy: { maxPages: 0, maxDepth: 0, respectsRobotsTxt: true, sameDomainOnly: true, robotsAllowedCrawl: true, notes: [] },
      ai: { used: false, note: '' },
      screenshot: null,
      notes: ['Audit failed — see error.'],
      engineVersion: ENGINE_VERSION,
    };
    return { result: partial, fatal };
  }
}

function safeDomain(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url.slice(0, 100);
  }
}

interface Trace {
  res: Awaited<ReturnType<typeof rawRequest>>;
  hops: { url: string; statusCode: number }[];
}

async function fetchWithTrace(rawUrl: string, deadlineMs: number, maxRedirects = 5): Promise<Trace> {
  const hops: { url: string; statusCode: number }[] = [];
  let current = rawUrl;
  for (let i = 0; i <= maxRedirects; i += 1) {
    const validation = await validateAuditTarget(current);
    if (!validation.ok || !validation.url || !validation.addresses) {
      throw new AuditFatalError(validation.issue ?? 'INVALID_URL', validation.message ?? 'Target not allowed.');
    }
    const remaining = deadlineMs - Date.now();
    const timeout = Math.max(3000, Math.min(config.httpTimeoutMs, remaining));
    const res = await rawRequest(validation.url, validation.addresses, {
      timeoutMs: timeout,
      maxBytes: 8 * 1024 * 1024,
      allowErrorStatus: true,
      accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.2',
    });
    const location = res.headers.location ? (Array.isArray(res.headers.location) ? res.headers.location[0] : res.headers.location) : null;
    if (res.statusCode >= 300 && res.statusCode < 400 && location) {
      let next: URL;
      try {
        next = new URL(location, validation.url);
      } catch {
        throw new HttpRequestError({ kind: 'PROTOCOL', message: 'Redirect target is invalid.' });
      }
      hops.push({ url: validation.url.toString(), statusCode: res.statusCode });
      current = next.toString();
      if (i === maxRedirects) {
        // Return last 3xx response so the caller can report the loop.
        return { res, hops };
      }
      continue;
    }
    return { res: { ...res, finalUrl: validation.url.toString() }, hops };
  }
  throw new HttpRequestError({ kind: 'REDIRECT_LIMIT', message: 'Too many redirects.' });
}

async function probeSitemap(origin: string, robotsSitemaps: string[]): Promise<AuditContext['sitemap']> {
  const candidates = robotsSitemaps.length ? robotsSitemaps.slice(0, 1) : [`${origin}/sitemap.xml`];
  for (const url of candidates) {
    try {
      const res = await safeFetch(url, { timeoutMs: 8000, maxBytes: 3 * 1024 * 1024, allowErrorStatus: true, accept: 'application/xml,text/xml,*/*;q=0.1' });
      const locs: string[] = [];
      const re = /<loc[^>]*>([\s\S]*?)<\/loc>/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(res.text)) !== null) {
        const loc = m[1].trim();
        if (loc && locs.length < 300) locs.push(loc);
      }
      return { fetched: true, statusCode: res.statusCode, urlCount: res.statusCode < 400 ? locs.length : null, urls: locs };
    } catch {
      return { fetched: true, statusCode: null, urlCount: null, urls: [] };
    }
  }
  return { fetched: false, statusCode: null, urlCount: null, urls: [] };
}

function extractFontsFromCss(stylesheets: { url: string; cssText?: string | null }[]): string[] {
  const fonts = new Set<string>();
  for (const s of stylesheets) {
    if (!s.cssText) continue;
    const re = /@font-face\s*{[^}]*url\(\s*['"]?([^'")\s]+)['"]?\s*\)/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s.cssText)) !== null) {
      const raw = m[1];
      if (/\.(woff2?|ttf|otf|eot)(\?|#|$)/i.test(raw)) {
        try {
          fonts.add(new URL(raw, s.url).toString());
        } catch {
          /* ignore */
        }
      }
    }
  }
  return [...fonts];
}

async function fetchStylesheetTextForFonts(styles: { url: string }[], base: string): Promise<{ url: string; cssText?: string | null }[]> {
  return (await fetchAssets(styles.map((s) => ({ url: s.url, kind: 'style' as const })), { concurrency: 3, timeoutMs: 8000, maxBytes: 500 * 1024, referer: base })).map((a) => ({ url: a.url, cssText: a.cssText }));
}

async function runBrowserOrStatic(
  finalHref: string,
  auditId: string,
  deadlineMs: number,
): Promise<{ mode: 'browser' | 'static'; browserMetrics: BrowserMetrics | null; axeViolations: AxeViolation[]; screenshotFile: string | null }> {
  // Reserve time budget so the whole audit still finishes on schedule.
  const remaining = deadlineMs - Date.now();
  const budget = Math.max(15_000, remaining - 15_000);
  try {
    const out = await Promise.race([
      runBrowserAudit(finalHref, { screenshot: true }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('BROWSER_TIMEOUT')), budget)),
    ]);
    let screenshotFile: string | null = null;
    if (out.screenshotPath && fs.existsSync(out.screenshotPath)) {
      const dir = path.join(dataDir, 'screenshots');
      fs.mkdirSync(dir, { recursive: true });
      screenshotFile = `${auditId}.png`;
      fs.copyFileSync(out.screenshotPath, path.join(dir, screenshotFile));
      try {
        fs.rmSync(out.screenshotPath, { force: true });
      } catch {
        /* best-effort cleanup */
      }
    }
    return {
      mode: 'browser',
      browserMetrics: out.metrics,
      axeViolations: out.axeViolations,
      screenshotFile,
    };
  } catch (err) {
    if (err instanceof Error && (err.message === 'NO_BROWSER' || err.message === 'BROWSER_TIMEOUT')) {
      return { mode: 'static', browserMetrics: null, axeViolations: [], screenshotFile: null };
    }
    log.warn('browser audit failed; continuing static', { error: String(err) });
    return { mode: 'static', browserMetrics: null, axeViolations: [], screenshotFile: null };
  }
}

async function buildProtocolProbe(finalHref: string, finalIsHttps: boolean, trace: Trace): Promise<AuditContext['protocolProbe']> {
  const u = new URL(finalHref);
  const mainScheme = finalIsHttps ? 'https' : 'http';
  // If the user's entry was http and it redirected to https, http→https works: nothing to probe.
  const firstHop = trace.hops[0];
  if (firstHop && new URL(firstHop.url).protocol === 'http:' && finalIsHttps) {
    return { mainScheme, other: null };
  }
  const otherScheme = finalIsHttps ? 'http' : 'https';
  try {
    const otherUrl = `${otherScheme}://${u.host}${u.pathname}${u.search}`;
    const otherRes = await safeFetch(otherUrl, {
      timeoutMs: 6000,
      maxBytes: 400 * 1024,
      allowErrorStatus: true,
      maxRedirects: 2,
    });
    const otherFinal = new URL(otherRes.finalUrl);
    return {
      mainScheme,
      other: {
        scheme: otherScheme,
        statusCode: otherRes.statusCode,
        finalUrl: otherRes.finalUrl,
        redirectedToMain: otherFinal.protocol.replace(':', '') === mainScheme && otherRes.statusCode < 400,
        error: null,
      },
    };
  } catch (err) {
    const msg = err instanceof HttpRequestError ? err.info.kind : 'unknown';
    return { mainScheme, other: { scheme: otherScheme, statusCode: null, finalUrl: null, redirectedToMain: null, error: msg } };
  }
}

function toCrawledMeta(p: CrawlPage): CrawledPageMeta {
  return {
    url: p.url,
    finalUrl: p.finalUrl,
    statusCode: p.statusCode,
    title: p.title,
    depth: p.depth,
    sizeBytes: p.sizeBytes,
    durationMs: p.durationMs,
    redirects: p.redirects,
    redirectedOffsite: p.redirectedOffsite,
    offsiteUrl: p.offsiteUrl,
    error: p.error,
  };
}

function parsePageMeta(html: string): { title: string | null; metaDescription: string | null; canonical: string | null; h1s: string[]; wordCount: number } {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.replace(/\s+/g, ' ').trim() ?? null;
  const descRe = /<meta[^>]+name=["']description["'][^>]+content=["']([\s\S]*?)["']/i.exec(html) ?? /<meta[^>]+content=["']([\s\S]*?)["'][^>]+name=["']description["']/i.exec(html);
  const metaDescription = descRe ? descRe[1].trim() : null;
  const canon = /<link[^>]+rel=["']canonical["'][^>]+href=["']([\s\S]*?)["']/i.exec(html) ?? /<link[^>]+href=["']([\s\S]*?)["'][^>]+rel=["']canonical["']/i.exec(html);
  const h1s: string[] = [];
  const h1Re = /<h1[^>]*>([\s\S]*?)<\/h1>/gi;
  let m: RegExpExecArray | null;
  while ((m = h1Re.exec(html)) !== null && h1s.length < 8) {
    const text = m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (text) h1s.push(text);
  }
  const noTags = html.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const wordCount = noTags.split(/\s+/).filter(Boolean).length;
  return { title, metaDescription, canonical: canon ? canon[1].trim() : null, h1s, wordCount };
}

function buildPageScans(ctx: AuditContext): PageScan[] {
  const scans: PageScan[] = [
    {
      url: ctx.homepage.finalUrl,
      statusCode: ctx.homepage.statusCode,
      title: (ctx.homepage.$('title').first().text() ?? '').replace(/\s+/g, ' ').trim().slice(0, 200),
      depth: 0,
      sizeBytes: ctx.homepage.sizeBytes,
      durationMs: ctx.homepage.durationMs,
      redirects: ctx.homepage.redirects.length,
    },
  ];
  for (const p of ctx.crawledPages) {
    scans.push({ url: p.url, statusCode: p.statusCode, title: p.title, depth: p.depth, sizeBytes: p.sizeBytes, durationMs: p.durationMs, redirects: p.redirects });
  }
  return scans;
}

function buildPassedChecks(ctx: AuditContext, statusCode: number, browserMetrics: BrowserMetrics | null): Issue[] {
  const passed: Issue[] = [];
  const { $, finalUrl } = ctx.homepage;
  const add = (section: Issue['section'], title: string) => {
    passed.push({ code: '', section, bucket: 'none', severity: 'passed', title, whyItMatters: '', recommendedFix: '', evidence: [], area: 'Passed' });
  };
  if (statusCode >= 200 && statusCode < 300) add('technical', 'Homepage responds with HTTP 200');
  const title = $('head title').first().text().trim();
  if (title) add('seo', 'Page title present');
  const desc = ($('meta[name="description"]').attr('content') ?? '').trim();
  if (desc) add('seo', 'Meta description present');
  if ($('h1').length === 1) add('seo', 'Exactly one H1 heading');
  if ($('link[rel="canonical"]').attr('href')) add('seo', 'Canonical URL declared');
  const og = ['og:title', 'og:description', 'og:image'].every((p) => $(`meta[property="${p}"]`).attr('content'));
  if (og) add('seo', 'Open Graph tags complete');
  if (ctx.robots && ctx.robots.statusCode && ctx.robots.statusCode < 400) add('seo', 'robots.txt reachable');
  if (ctx.sitemap && ctx.sitemap.statusCode !== null && ctx.sitemap.statusCode < 400) add('technical', 'XML sitemap reachable');
  const viewport = $('meta[name="viewport"]').attr('content') ?? '';
  if (/width\s*=\s*device-width/i.test(viewport) && /initial-scale\s*=\s*1(\.0)?/i.test(viewport)) add('mobile', 'Mobile viewport configured');
  const h = ctx.homepage.headers;
  if (h['strict-transport-security']) add('security', 'HSTS header set');
  if (h['x-frame-options'] || (h['content-security-policy'] ?? '').toString().includes('frame-ancestors')) add('security', 'Clickjacking protection present');
  if ((h['x-content-type-options'] ?? '').toString().toLowerCase().includes('nosniff')) add('security', 'X-Content-Type-Options: nosniff set');
  if (ctx.axeViolations.length === 0 && !browserMetrics) {
    // structural + jsdom checks reported no violations
  }
  const viewportMetaOk = /width\s*=\s*device-width/i.test(viewport);
  if (viewportMetaOk) add('mobile', 'Viewport meta uses device-width');
  const hasInternal = ctx.homepageLinks.some((l) => l.to === 'internal');
  if (hasInternal) add('seo', 'Internal links present');
  const blockScripts = $('head script[src]:not([defer]):not([async])').length === 0;
  if (blockScripts && $('script[src]').length > 0) add('performance', 'No render-blocking scripts in <head>');
  const encoding = h['content-encoding'];
  if (encoding) add('performance', 'Text responses compressed');
  const fontsDeclared = ctx.assets.some((a) => a.kind === 'font');
  if (!fontsDeclared) add('performance', 'No custom font downloads detected');
  void ctx;
  void finalUrl;
  return passed.map((p, i) => ({ ...p, code: `PASS-${String(i + 1).padStart(2, '0')}` }));
}

function buildRecommendations(issues: Issue[]): AuditResult['recommendations'] {
  const rank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const sorted = issues
    .filter((i) => i.severity !== 'passed')
    .sort((a, b) => rank[a.severity] - rank[b.severity] || a.code.localeCompare(b.code));
  const seen = new Set<string>();
  const recs: AuditResult['recommendations'] = [];
  for (const i of sorted) {
    const key = i.title + '|' + i.section;
    if (seen.has(key)) continue;
    seen.add(key);
    recs.push({
      id: `rec-${String(recs.length + 1).padStart(2, '0')}`,
      priority: i.severity as 'critical' | 'high' | 'medium' | 'low',
      title: i.title,
      problem: i.evidence.length ? summarizeEvidence(i) : i.title,
      whyItMatters: i.whyItMatters,
      recommendedFix: i.recommendedFix,
      section: i.section,
      estimatedImpact: i.severity === 'critical' || i.severity === 'high' ? 'high' : i.severity === 'medium' ? 'medium' : 'low',
    });
    if (recs.length >= 18) break;
  }
  return recs;
}

function summarizeEvidence(i: Issue): string {
  const urls = i.evidence.filter((e) => e.type === 'url').slice(0, 3);
  const texts = i.evidence.filter((e) => e.type === 'text').slice(0, 1);
  if (urls.length) return `Evidence: ${urls.map((u) => u.value.split('\n')[0]).join(' · ')}`;
  if (texts.length) return `Evidence: ${texts[0].value.split('\n')[0]}`;
  return 'Detected during the automated audit.';
}

function buildSummary(grade: string, overallScore: number | null, categoryScores: Record<string, CategoryScore>, issues: Issue[]): NonNullable<AuditResult['summary']> {
  const weighted = Object.values(categoryScores).filter((c) => c.kind === 'weighted');
  const poor = weighted.filter((c) => (c.score ?? 0) < 70).sort((a, b) => (a.score ?? 0) - (b.score ?? 0));
  const good = weighted.filter((c) => (c.score ?? 0) >= 80).sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 3);
  const opportunities = poor.slice(0, 4).map((c) => c.label.toLowerCase());
  const strengths = good.map((c) => c.label.toLowerCase());
  const worst = poor[0];

  let headline = '';
  if (grade === 'Excellent') {
    headline = `Your website is in excellent shape.${worst ? ` Even the strongest sites can improve — consider the ${worst.label.toLowerCase()} suggestions below.` : ' Keep monitoring it as you add content and features.'}`;
  } else if (grade === 'Good') {
    headline = `Your website is generally healthy, but ${opportunities.length ? `${opportunities.join(', ')} improvements are recommended` : 'a few refinements would help'} to reach the next level.`;
  } else if (grade === 'Fair') {
    headline = `Your website has a solid foundation, but ${opportunities.length ? opportunities.slice(0, 3).join(', ') : 'several areas'} need attention before they start costing you visitors and rankings.`;
  } else if (grade === 'Needs improvement') {
    headline = `Several important areas of your website are below expectations${worst ? ` — starting with ${worst.label.toLowerCase()}` : ''}. A focused improvement plan would make a measurable difference.`;
  } else {
    headline = `Your website is underperforming${worst ? `, particularly in ${worst.label.toLowerCase()}` : ''}. The issues below are costing you trust, traffic and conversions.`;
  }

  const critical = issues.filter((i) => i.severity === 'critical').length;
  const high = issues.filter((i) => i.severity === 'high').length;
  if (critical > 0 || high > 0) {
    headline += ` The audit found ${critical} critical and ${high} high priority ${high === 1 ? 'issue' : 'issues'}.`;
  }
  return {
    grade,
    headline,
    strengths,
    opportunities: poor.map((c) => c.label),
    aiGenerated: false,
  };
}
