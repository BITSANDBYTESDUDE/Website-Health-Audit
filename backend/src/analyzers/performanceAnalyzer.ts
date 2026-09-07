import type { AuditContext } from '../engine/context';
import { issue, metric, out, plural, formatBytes, formatSeconds } from './helpers';
import type { AnalyzerOutput } from '../engine/context';

/**
 * Performance analyzer.
 *
 * When a browser is available, real rendering metrics (FCP/LCP/CLS/TBT) and
 * real transfer sizes are used. Without a browser the engine reports the
 * metrics it honestly measured over HTTP (TTFB, document weight, fetched
 * asset sizes, compression, caching) and shows "Not available" for the rest.
 */
export async function analyzePerformance(ctx: AuditContext): Promise<AnalyzerOutput> {
  const { homepage, assets, images, browserMetrics } = ctx;
  const issues: AnalyzerOutput['issues'] = [];
  const metrics: AnalyzerOutput['metrics'] = [];
  const notes: string[] = [];

  const finalUrl = new URL(homepage.finalUrl);
  const baseHost = finalUrl.hostname.replace(/^www\./, '');
  const isThirdPartyHost = (h: string): boolean => h.replace(/^www\./, '') !== baseHost;

  // ---------- Initial response time ----------------------------------------
  const ttfb = homepage.ttfbMs;
  const htmlSize = homepage.sizeBytes;
  metrics.push(metric('perf_ttfb', 'Initial response time', formatSeconds(ttfb), ttfb <= 800 ? 'good' : ttfb <= 2000 ? 'warn' : 'bad', undefined, 'Time to first response byte'));
  if (ttfb > 2000) {
    issues.push(
      issue('performance', 'performance', 'high', `Slow server response time (${(ttfb / 1000).toFixed(2)} s)`, 'Every visitor waits for the server before anything can render. Response times above 2 s are strongly correlated with higher bounce rates.', 'Improve server performance: use caching, a CDN, faster hosting or optimize slow database/backend queries.', [{ type: 'text', value: `TTFB measured: ${Math.round(ttfb)} ms` }], 'Server response'),
    );
  } else if (ttfb > 800) {
    issues.push(
      issue('performance', 'performance', 'medium', `Server response time could be faster (${(ttfb / 1000).toFixed(2)} s)`, 'Sub-second responses feel instant; slower ones let users lose attention.', 'Review hosting performance and enable page caching.', [{ type: 'text', value: `TTFB measured: ${Math.round(ttfb)} ms` }], 'Server response'),
    );
  }

  // ---------- HTML document size --------------------------------------------
  metrics.push(metric('perf_html_size', 'HTML size', formatBytes(htmlSize), htmlSize < 350_000 ? 'good' : htmlSize < 1_000_000 ? 'warn' : 'bad', 'bytes'));
  if (htmlSize >= 1_000_000) {
    issues.push(
      issue('performance', 'performance', 'medium', `Very large HTML document (${formatBytes(htmlSize)})`, 'A bloated document delays parsing and first paint, especially on mobile networks.', 'Trim unused markup, remove inline data blobs and paginate long content.', [{ type: 'text', value: `Homepage HTML transfer size: ${formatBytes(htmlSize)}` }], 'Document weight'),
    );
  } else if (htmlSize >= 350_000) {
    issues.push(
      issue('performance', 'performance', 'low', `HTML document is on the heavy side (${formatBytes(htmlSize)})`, 'Large documents cost parsing time on low-end devices.', 'Consider trimming markup and inline assets.', [{ type: 'text', value: `Homepage HTML transfer size: ${formatBytes(htmlSize)}` }], 'Document weight'),
    );
  }

  // ---------- Script / stylesheet / font totals -----------------------------
  const scripts = assets.filter((a) => a.kind === 'script' && !a.error);
  const styles = assets.filter((a) => a.kind === 'style' && !a.error);
  const fonts = assets.filter((a) => a.kind === 'font' && !a.error);
  const jsBytes = scripts.reduce((s, a) => s + (a.statusCode === 200 ? a.sizeBytes : 0), 0);
  const cssBytes = styles.reduce((s, a) => s + (a.statusCode === 200 ? a.sizeBytes : 0), 0);
  const fontBytes = fonts.reduce((s, a) => s + (a.statusCode === 200 ? a.sizeBytes : 0), 0);
  const imageBytes = images.filter((i) => i.sizeBytes !== null).reduce((s, i) => s + (i.sizeBytes ?? 0), 0);

  const inlineScripts: string[] = [];
  homepage.$('script:not([src])').each((_i, el) => {
    const t = homepage.$(el).contents().text();
    if (t.trim()) inlineScripts.push(t);
  });
  const inlineJsBytes = inlineScripts.reduce((s, t) => s + Buffer.byteLength(t, 'utf8'), 0);

  const jsTotal = jsBytes + inlineJsBytes;
  metrics.push(
    metric('perf_js_total', 'JavaScript', formatBytes(jsTotal), jsTotal < 250_000 ? 'good' : jsTotal < 700_000 ? 'warn' : 'bad', 'bytes', `${scripts.length} external file${scripts.length === 1 ? '' : 's'}${inlineScripts.length ? ` + inline (${formatBytes(inlineJsBytes)})` : ''}`),
    metric('perf_css_total', 'CSS', formatBytes(cssBytes), cssBytes < 150_000 ? 'good' : cssBytes < 400_000 ? 'warn' : 'bad', 'bytes', `${styles.length} file${styles.length === 1 ? '' : 's'}`),
    metric('perf_img_total', 'Images (transfer)', formatBytes(imageBytes), imageBytes < 1_500_000 ? 'good' : imageBytes < 4_000_000 ? 'warn' : 'bad', 'bytes', `${images.filter((i) => i.sizeBytes !== null).length} measured`),
    metric('perf_fonts', 'Font resources', fonts.length, fonts.length <= 4 ? 'good' : 'warn', undefined, fontBytes ? `${formatBytes(fontBytes)} transferred` : undefined),
  );
  if (jsTotal >= 700_000) {
    issues.push(
      issue('performance', 'performance', 'high', `Heavy JavaScript payload (${formatBytes(jsTotal)})`, 'Large JavaScript delays interactivity and increases power use on mobile devices.', 'Code-split, remove unused libraries, and defer non-critical scripts.', [{ type: 'text', value: `Measured JS transfer: ${formatBytes(jsTotal)}` }], 'JavaScript'),
    );
  } else if (jsTotal >= 250_000) {
    issues.push(
      issue('performance', 'performance', 'medium', `JavaScript payload needs attention (${formatBytes(jsTotal)})`, 'Moderate JS weight still slows first load on typical phones.', 'Review bundle size and defer non-critical scripts.', [{ type: 'text', value: `Measured JS transfer: ${formatBytes(jsTotal)}` }], 'JavaScript'),
    );
  }
  if (cssBytes >= 400_000) {
    issues.push(
      issue('performance', 'performance', 'medium', `Heavy CSS payload (${formatBytes(cssBytes)})`, 'Over-large stylesheets delay first render.', 'Remove unused CSS and split critical vs deferred styles.', [{ type: 'text', value: `Measured CSS transfer: ${formatBytes(cssBytes)}` }], 'CSS'),
    );
  }
  if (imageBytes >= 4_000_000) {
    issues.push(
      issue('performance', 'performance', 'high', `Total image weight is very high (${formatBytes(imageBytes)})`, 'Image bytes dominate page weight on most sites; excessive totals slow every load.', 'Compress images, adopt WebP/AVIF and serve responsive sizes.', [{ type: 'text', value: `Total measured image transfer: ${formatBytes(imageBytes)}` }], 'Images'),
    );
  } else if (imageBytes >= 1_500_000) {
    issues.push(
      issue('performance', 'performance', 'medium', `Total image weight could be reduced (${formatBytes(imageBytes)})`, 'Heavy imagery slows the page for users on slower connections.', 'Compress images and serve modern formats where appropriate.', [{ type: 'text', value: `Total measured image transfer: ${formatBytes(imageBytes)}` }], 'Images'),
    );
  }
  if (fonts.length > 6 || (fontBytes > 400_000 && fonts.length > 0)) {
    issues.push(
      issue('performance', 'performance', 'low', `${fonts.length} font resources loaded`, 'Each additional font family/weight adds download and layout time.', 'Limit font families and weights; subset font files.', [{ type: 'text', value: `${fonts.length} font resource(s) referenced${fontBytes ? ` (${formatBytes(fontBytes)})` : ''}` }], 'Fonts'),
    );
  }

  // ---------- Third-party resources ----------------------------------------
  const thirdPartyScripts = scripts.filter((a) => isThirdPartyHost(a.host));
  const thirdPartyTotal = [...assets, ...images].filter((a) => isThirdPartyHost(a.host)).length;
  if (browserMetrics) {
    const n = browserMetrics.resources.thirdPartyRequests;
    if (n >= 20) {
      issues.push(
        issue('performance', 'performance', 'high', `${n} third-party requests during page load`, 'Third-party requests (ads, analytics, widgets) add latency and can block rendering.', 'Audit third-party scripts: load them async, self-host critical ones, or remove unneeded tags.', [{ type: 'text', value: `${formatBytes(browserMetrics.resources.thirdPartyBytes)} transferred by third-party requests in a headless browser load.` }], 'Third-party resources'),
      );
    } else if (n >= 8) {
      issues.push(
        issue('performance', 'performance', 'medium', `${n} third-party requests during page load`, 'Third-party requests add latency and can block rendering.', 'Review the number of third-party tags and load them without blocking.', [{ type: 'text', value: `${formatBytes(browserMetrics.resources.thirdPartyBytes)} transferred by third-party requests in a headless browser load.` }], 'Third-party resources'),
      );
    }
  } else if (thirdPartyScripts.length >= 8) {
    issues.push(
      issue('performance', 'performance', thirdPartyScripts.length >= 20 ? 'high' : 'medium', `${plural(thirdPartyScripts.length, 'third-party script')} loaded from external domains`, 'Third-party scripts block rendering and are a common cause of slow pages and privacy concerns.', 'Audit third-party scripts: load them async, self-host critical ones, or remove unneeded tags.', thirdPartyScripts.slice(0, 10).map((a) => ({ type: 'url' as const, value: a.url })), 'Third-party resources'),
    );
  }

  // ---------- Compression ---------------------------------------------------
  const contentEncoding = (homepage.headers['content-encoding'] as string | undefined) ?? null;
  const textAssets = [...scripts, ...styles, ...fonts].filter((a) => a.statusCode === 200 && a.sizeBytes > 10_000);
  const uncompressedText = textAssets.filter((a) => !a.compression);
  if (htmlSize > 20_000 && !contentEncoding) {
    issues.push(
      issue('performance', 'performance', 'low', 'HTML responses are not compressed', 'Uncompressed HTML costs extra bandwidth; modern servers compress text responses with gzip/br automatically.', 'Enable gzip/Brotli compression for text responses.', [{ type: 'text', value: 'Content-Encoding header missing on the HTML response.' }], 'Compression'),
    );
  }
  if (uncompressedText.length >= 3) {
    issues.push(
      issue('performance', 'performance', 'medium', `${plural(uncompressedText.length, 'text asset')} served without compression`, 'CSS/JS/fonts compress extremely well; serving them raw wastes bandwidth and time.', 'Enable gzip/Brotli compression for text assets.', uncompressedText.slice(0, 6).map((a) => ({ type: 'url' as const, value: `${a.url} (${formatBytes(a.sizeBytes)})` })), 'Compression'),
    );
  }
  metrics.push(metric('perf_compression', 'Text compression', contentEncoding ?? 'not applied', contentEncoding ? 'good' : 'warn'));

  // ---------- Caching -------------------------------------------------------
  const staticSameHost = textAssets.filter((a) => !isThirdPartyHost(a.host));
  const uncached = staticSameHost.filter((a) => !a.isCacheable && !/^image|font/.test(''));
  if (staticSameHost.length > 0 && uncached.length >= Math.max(1, Math.floor(staticSameHost.length * 0.6))) {
    issues.push(
      issue('performance', 'performance', staticSameHost.length >= 3 ? 'medium' : 'low', `${plural(uncached.length, 'static asset')} served without explicit caching`, 'Without cache headers, repeat visits re-download the same CSS/JS/fonts.', 'Set Cache-Control with a max-age (e.g. one year for fingerprinted assets).', uncached.slice(0, 6).map((a) => ({ type: 'url' as const, value: a.url })), 'Caching'),
    );
  }
  metrics.push(metric('perf_cacheable_assets', 'Cacheable static assets', `${staticSameHost.length - uncached.length}/${staticSameHost.length}`, uncached.length === 0 && staticSameHost.length > 0 ? 'good' : staticSameHost.length > 0 ? 'warn' : 'neutral'));

  // ---------- Render-blocking -----------------------------------------------
  const blockingScripts: string[] = [];
  homepage.$('head script[src]').each((_i, el) => {
    const $el = homepage.$(el);
    if (!$el.attr('defer') && !$el.attr('async')) blockingScripts.push($el.attr('src') ?? '');
  });
  if (blockingScripts.length > 0) {
    issues.push(
      issue('performance', 'performance', 'medium', `${plural(blockingScripts.length, 'render-blocking script')} in <head> without defer/async`, 'Scripts that block parsing delay first paint even when they are not needed for the initial view.', 'Add defer (or async) to head scripts, or move them before </body>.', blockingScripts.slice(0, 8).map((u) => ({ type: 'url' as const, value: u })), 'Render-blocking resources'),
    );
  }
  const blockingCss: string[] = [];
  homepage.$('link[rel="stylesheet"]').each((_i, el) => {
    const $el = homepage.$(el);
    const media = $el.attr('media') ?? 'all';
    if (media === 'all' || media === '') blockingCss.push($el.attr('href') ?? '');
  });
  if (blockingCss.length >= 4) {
    issues.push(
      issue('performance', 'performance', 'low', `${plural(blockingCss.length, 'render-blocking stylesheet')}`, 'Every full-page stylesheet must download before first paint.', 'Inline critical CSS and defer the rest, or merge stylesheets.', blockingCss.slice(0, 6).map((u) => ({ type: 'url' as const, value: u })), 'Render-blocking resources'),
    );
  }

  // ---------- Preload / hints -----------------------------------------------
  const hints: string[] = [];
  homepage.$('link[rel="preload"], link[rel="preconnect"], link[rel="dns-prefetch"], link[rel="prefetch"]').each((_i, el) => {
    const href = homepage.$(el).attr('href');
    if (href) hints.push(href);
  });
  metrics.push(metric('perf_resource_hints', 'Preload/preconnect hints', hints.length, 'neutral', undefined, hints.length ? hints.slice(0, 5).join(', ') : undefined));

  // ---------- Resource counts -----------------------------------------------
  const domResourceCount = homepage.$('script[src],link[rel="stylesheet"],img').length;
  const resourceCount = browserMetrics ? browserMetrics.resources.requests : domResourceCount;
  metrics.push(metric('perf_resources', 'Resources on page load', resourceCount, resourceCount < 80 ? 'good' : resourceCount < 150 ? 'warn' : 'bad', undefined, browserMetrics ? 'measured in browser' : 'counted from markup'));
  if (resourceCount >= 150) {
    issues.push(
      issue('performance', 'performance', 'medium', `Very high resource count (${resourceCount})`, 'Every resource adds connection overhead; hundreds of requests make pages feel slow even on fast connections.', 'Reduce the number of files: bundle, sprite and lazy-load below-the-fold resources.', [{ type: 'text', value: `${resourceCount} resources on the initial page load` }], 'Resource count'),
    );
  }

  // ---------- Browser-rendered web vitals -----------------------------------
  if (browserMetrics) {
    const v = browserMetrics.vitals;
    const nav = browserMetrics.nav;
    const vv = (ms: number | null, good: number, poor: number) => (ms === null ? 'na' : ms <= good ? 'good' : ms <= poor ? 'warn' : 'bad');
    metrics.push(
      metric('perf_fcp', 'First Contentful Paint', v.fcpMs === null ? null : formatSeconds(v.fcpMs), vv(v.fcpMs, 1800, 3000), undefined, 'Good ≤1.8s · Poor >3s'),
      metric('perf_lcp', 'Largest Contentful Paint', v.lcpMs === null ? null : formatSeconds(v.lcpMs), vv(v.lcpMs, 2500, 4000), undefined, 'Good ≤2.5s · Poor >4s'),
      metric('perf_cls', 'Cumulative Layout Shift', v.cls, v.cls === null ? 'na' : v.cls <= 0.1 ? 'good' : v.cls <= 0.25 ? 'warn' : 'bad', undefined, 'Good ≤0.1 · Poor >0.25'),
      metric('perf_tbt', 'Total Blocking Time', v.tbtMs === null ? null : `${v.tbtMs} ms`, vv(v.tbtMs, 200, 600), undefined, 'Good ≤200ms · Poor >600ms'),
      metric('perf_dcl', 'DOMContentLoaded', nav.domContentLoadedMs ? formatSeconds(nav.domContentLoadedMs) : null, nav.domContentLoadedMs ? (nav.domContentLoadedMs <= 1500 ? 'good' : nav.domContentLoadedMs <= 3000 ? 'warn' : 'bad') : 'na', undefined, 'Browser navigation timing'),
      metric('perf_load', 'Load event', nav.loadMs ? formatSeconds(nav.loadMs) : null, nav.loadMs ? (nav.loadMs <= 2000 ? 'good' : nav.loadMs <= 4000 ? 'warn' : 'bad') : 'na', undefined, 'Browser navigation timing'),
    );
    if (v.lcpMs !== null && v.lcpMs > 4000) {
      issues.push(
        issue('performance', 'performance', 'high', `Slow Largest Contentful Paint (${formatSeconds(v.lcpMs)})`, 'LCP measures when the main content becomes visible; above 4 s most users perceive the page as broken.', 'Prioritise the LCP element: optimise the hero image, preload it and reduce render-blocking resources.', [{ type: 'text', value: `Measured LCP in a headless browser: ${formatSeconds(v.lcpMs)}` }], 'Core Web Vitals'),
      );
    } else if (v.lcpMs !== null && v.lcpMs > 2500) {
      issues.push(
        issue('performance', 'performance', 'medium', `Largest Contentful Paint needs improvement (${formatSeconds(v.lcpMs)})`, 'The main content takes longer than ideal to become visible; heavy images or JavaScript may contribute.', 'Optimise the LCP element and its network path.', [{ type: 'text', value: `Measured LCP: ${formatSeconds(v.lcpMs)}` }], 'Core Web Vitals'),
      );
    }
    if (v.cls !== null && v.cls > 0.25) {
      issues.push(
        issue('performance', 'performance', 'high', `Layout instability (CLS ${v.cls.toFixed(3)})`, 'Pages that shift while loading frustrate users and can cause accidental taps.', 'Reserve space for images/ads with width/height or aspect-ratio.', [{ type: 'text', value: `Measured CLS: ${v.cls}` }], 'Core Web Vitals'),
      );
    } else if (v.cls !== null && v.cls > 0.1) {
      issues.push(
        issue('performance', 'performance', 'medium', `Layout shift above the good threshold (CLS ${v.cls.toFixed(3)})`, 'Noticeable layout movement during load degrades the user experience.', 'Add dimensions to media and avoid inserting content above existing content.', [{ type: 'text', value: `Measured CLS: ${v.cls}` }], 'Core Web Vitals'),
      );
    }
    if (v.tbtMs !== null && v.tbtMs > 600) {
      issues.push(
        issue('performance', 'performance', 'medium', `Long main-thread blocking time (${Math.round(v.tbtMs)} ms)`, 'Heavy JavaScript blocks the main thread, delaying interactivity.', 'Break up long tasks, defer non-critical JS and reduce third-party scripts.', [{ type: 'text', value: `Measured TBT: ${Math.round(v.tbtMs)} ms` }], 'Core Web Vitals'),
      );
    }
    notes.push('Core Web Vitals were measured in a headless desktop Chromium (single run; lab data, not field data from real users).');
  } else {
    notes.push('No browser engine is available in this environment, so paint/layout metrics (FCP, LCP, CLS, TBT) are reported as "Not available". HTTP-level and markup-level measurements above were still taken.');
    metrics.push(
      metric('perf_fcp', 'First Contentful Paint', null, 'na', undefined, 'Requires browser rendering'),
      metric('perf_lcp', 'Largest Contentful Paint', null, 'na', undefined, 'Requires browser rendering'),
      metric('perf_cls', 'Cumulative Layout Shift', null, 'na', undefined, 'Requires browser rendering'),
      metric('perf_tbt', 'Total Blocking Time', null, 'na', undefined, 'Requires browser rendering'),
    );
  }
  metrics.push(metric('perf_third_party_resources', 'Third-party resources referenced', thirdPartyTotal, 'neutral'));

  return out(issues, metrics, notes);
}
