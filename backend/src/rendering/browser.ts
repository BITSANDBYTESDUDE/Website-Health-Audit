import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { config, dataDir } from '../config';
import { log } from '../utils/log';
import type { AxeViolation } from '../engine/context';
import { SITEPULSE_UA } from '../http/robots';

/**
 * Real browser rendering via Playwright (headless Chromium).
 *
 * Used to measure browser-only signals: web vitals (LCP / CLS / TBT / FCP),
 * real resource transfer sizes, mobile viewport behaviour and axe-core
 * accessibility scans inside the rendered page.
 *
 * When no browser binary is installed (e.g. `npm run setup:browsers` has not
 * been run in this environment) the engine transparently falls back to
 * static HTTP + DOM analysis and every browser-only metric is reported as
 * "Not available" — the audit never invents measurements.
 */

let _browserPromise: Promise<Browser | null> | null = null;
let _checked = false;
let _detected = false;

export function getBrowserStatus(): { checked: boolean; available: boolean } {
  return { checked: _checked, available: _checked && _detected };
}

export function browserConfigured(): boolean {
  return config.playwrightEnabled;
}

export async function detectBrowser(): Promise<boolean> {
  if (_checked) return _detected;
  _checked = true;
  if (!config.playwrightEnabled) {
    _detected = false;
    return false;
  }
  try {
    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });
    await browser.close();
    _detected = true;
    log.info('headless Chromium detected — browser-rendered audits enabled');
  } catch (err) {
    _detected = false;
    log.warn(
      'headless Chromium not available — audit engine will run in static (HTTP+DOM) mode. Run `npm run setup:browsers` in backend to enable browser audits.',
    );
  }
  return _detected;
}

async function getBrowser(): Promise<Browser | null> {
  if (!(await detectBrowser())) return null;
  if (!_browserPromise) {
    _browserPromise = chromium
      .launch({
        headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-background-networking'],
      })
      .catch((err) => {
        log.error('failed to launch chromium', { error: String(err) });
        return null;
      });
  }
  return _browserPromise;
}

export interface BrowserAuditOutput {
  metrics: {
    viewport: string;
    nav: {
      domContentLoadedMs: number;
      loadMs: number;
      ttfbMs: number;
      transferSize: number;
      resources: number;
    };
    vitals: { fcpMs: number | null; lcpMs: number | null; cls: number | null; tbtMs: number | null };
    resources: {
      totalBytes: number;
      jsBytes: number;
      cssBytes: number;
      imageBytes: number;
      fontBytes: number;
      thirdPartyBytes: number;
      thirdPartyRequests: number;
      jsFiles: number;
      cssFiles: number;
      fontFiles: number;
      imageFiles: number;
      requests: number;
    };
    mobile: {
      horizontalOverflow: boolean;
      overflowPx: number;
      tapTargetsTooSmall: number;
      textTooSmall: number;
      fixedHeaderCoversContent: boolean;
      viewportWidth: number;
    };
  };
  axeViolations: AxeViolation[];
  screenshotPath: string | null;
}

const COLLECTOR_SCRIPT = `
  (() => {
    if (window.__sitepulseCollected) return;
    window.__sitepulseCollected = true;
    window.__sp = { vitals: {}, marks: {}, resources: [] };
    const push = (k, v) => { window.__sp.vitals[k] = v; };
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          if (e.entryType === 'paint' && e.name === 'first-contentful-paint') push('fcp', Math.round(e.startTime));
          if (e.entryType === 'largest-contentful-paint') push('lcp', Math.round(e.startTime));
        }
      }).observe({ type: 'paint', buffered: true });
    } catch (e) {}
    try {
      new PerformanceObserver((list) => {
        let cls = 0;
        for (const e of list.getEntries()) {
          if (!e.hadRecentInput) cls += e.value;
        }
        push('cls', Math.round((cls || 0) * 1000) / 1000);
      }).observe({ type: 'layout-shift', buffered: true });
    } catch (e) {}
    try {
      let tbt = 0;
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) tbt += Math.max(0, e.duration - 50);
        push('tbt', Math.round(tbt));
      }).observe({ type: 'longtask', buffered: true });
    } catch (e) {}
    const nav = performance.getEntriesByType('navigation')[0];
    if (nav) {
      push('domContentLoaded', Math.round(nav.domContentLoadedEventEnd));
      push('load', Math.round(nav.loadEventEnd));
      push('navTtfb', Math.round(nav.responseStart));
      push('transferSize', nav.transferSize || 0);
    }
    try {
      performance.getEntriesByType('resource').forEach((e) => {
        window.__sp.resources.push({
          name: e.name, initiatorType: e.initiatorType,
          transferSize: e.transferSize || 0, decodedBodySize: e.decodedBodySize || 0,
        });
      });
    } catch (e) {}
  })();
`;

function resourceGroups(resources: { name: string; initiatorType: string; transferSize: number; decodedBodySize?: number }[]) {
  const groups = {
    jsBytes: 0, cssBytes: 0, imageBytes: 0, fontBytes: 0,
    thirdPartyBytes: 0, totalBytes: 0,
    jsFiles: 0, cssFiles: 0, fontFiles: 0, imageFiles: 0,
    thirdPartyRequests: 0, requests: 0,
  };
  let origin = '';
  const counts = new Map<string, number>();
  for (const r of resources) {
    if (!origin) {
      try { origin = new URL(r.name).origin; } catch { continue; }
    }
    groups.requests += 1;
    const size = r.transferSize || r.decodedBodySize || 0;
    groups.totalBytes += size;
    const type = r.initiatorType;
    let host: string;
    try { host = new URL(r.name).host; } catch { continue; }
    const thirdParty = new URL(r.name).origin !== origin;
    if (thirdParty) {
      groups.thirdPartyRequests += 1;
      groups.thirdPartyBytes += size;
      counts.set(host, (counts.get(host) ?? 0) + 1);
    }
    if (type === 'script') { groups.jsFiles += 1; groups.jsBytes += size; }
    else if (type === 'stylesheet') { groups.cssFiles += 1; groups.cssBytes += size; }
    else if (type === 'font') { groups.fontFiles += 1; groups.fontBytes += size; }
    else if (type === 'img' || r.name.match(/\\.(png|jpe?g|gif|webp|avif|svg)/i)) { groups.imageFiles += 1; groups.imageBytes += size; }
  }
  return { ...groups, thirdPartyHosts: counts };
}

async function collectAfterLoad(page: Page): Promise<Record<string, unknown>> {
  // Wait a beat for late LCP/CLS observations, then read collected state.
  await page.waitForTimeout(1800);
  const state = await page.evaluate(() => (window as unknown as { __sp?: Record<string, unknown> }).__sp ?? {});
  return state as Record<string, unknown>;
}

export async function runBrowserAudit(targetUrl: string, opts: { screenshot?: boolean } = {}): Promise<BrowserAuditOutput> {
  const browser = await getBrowser();
  if (!browser) {
    throw new Error('NO_BROWSER');
  }
  const screenshotDir = path.join(dataDir, 'screenshots');
  if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });
  const context = await browser.newContext({
    userAgent: SITEPULSE_UA,
    locale: 'en-US',
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const screenshotPath = opts.screenshot ? path.join(screenshotDir, `${Date.now()}.png`) : null;

  try {
    await page.addInitScript(COLLECTOR_SCRIPT);
    const navTimeout = config.browserNavigationTimeoutMs;
    await page.goto(targetUrl, { waitUntil: 'load', timeout: navTimeout }).catch(async () => {
      // Some sites never fire load within budget; capture what we have.
      await page.waitForTimeout(1200);
    });
    if (screenshotPath) {
      await page.screenshot({ path: screenshotPath, fullPage: false }).catch(() => undefined);
    }
    const state = await collectAfterLoad(page);
    const nav = (state.vitals as Record<string, unknown>) ?? {};
    const resEntries = (state.resources as { name: string; initiatorType: string; transferSize: number; decodedBodySize: number }[]) ?? [];
    const groups = resourceGroups(resEntries);
    const navEntry = await page.evaluate(() => {
      const n = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
      return n ? { dcl: n.domContentLoadedEventEnd, load: n.loadEventEnd, ttfb: n.responseStart } : null;
    });

    // Mobile viewport pass
    const mobilePage = await context.newPage();
    await mobilePage.setViewportSize({ width: 375, height: 812 });
    await mobilePage.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: navTimeout }).catch(() => undefined);
    await mobilePage.waitForTimeout(900);
    const mobile = await mobilePage.evaluate(() => {
      const doc = document.documentElement;
      const overflow = doc.scrollWidth - window.innerWidth;
      const links = Array.from(document.querySelectorAll('a,button')).filter(
        (el) => el.getClientRects().length > 0 && (el as HTMLElement).offsetParent !== null,
      );
      let tapTooSmall = 0;
      let tapChecked = 0;
      for (const el of links) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        tapChecked += 1;
        const style = window.getComputedStyle(el);
        if (style.position === 'absolute' || style.position === 'fixed') continue;
        if (rect.width < 32 || rect.height < 32) {
          if (!(el as HTMLElement).dataset.spIgnore) tapTooSmall += 1;
        }
      }
      const textNodes = Array.from(document.querySelectorAll('p,span,li,label,button,a,h1,h2,h3,h4,h5,h6')).filter(
        (el) => el.textContent && el.textContent.trim().length >= 8 && el.getClientRects().length > 0,
      );
      let textTooSmall = 0;
      for (const el of textNodes) {
        const fs = parseFloat(window.getComputedStyle(el).fontSize || '16');
        if (fs > 0 && fs < 12) textTooSmall += 1;
      }
      // Detect fixed/sticky headers that cover the main content when scrolled.
      let covers = false;
      const fixed = Array.from(document.querySelectorAll('header, [data-fixed-header], div')).find((el) => {
        const s = window.getComputedStyle(el);
        return s.position === 'fixed' || s.position === 'sticky';
      });
      if (fixed) {
        window.scrollTo(0, 200);
        const fRect = (fixed as HTMLElement).getBoundingClientRect();
        const main = document.querySelector('main, #main, [role="main"]') as HTMLElement | null;
        if (main) {
          const mRect = main.getBoundingClientRect();
          if (fRect.bottom > mRect.top + 4 && fRect.height > 0 && fRect.height < window.innerHeight * 0.6) covers = true;
        }
      }
      return {
        overflow,
        tapTooSmall,
        textTooSmall,
        fixedCovers: covers,
      };
    }).catch(() => ({ overflow: 0, tapTooSmall: 0, textTooSmall: 0, fixedCovers: false }));

    // axe-core scan inside the desktop page.
    const violations = await (async () => {
      try {
        const axe = await import('axe-core');
        await page.addScriptTag({ content: axe.source });
        const raw = await page.evaluate(async () => {
          const r = await (window as unknown as { axe: { run: (...args: unknown[]) => Promise<{ violations: unknown }> } }).axe.run(document, {
            runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] },
          });
          return r.violations;
        });
        const list = raw as Array<{
          id: string; impact: string | null; description: string; help: string; helpUrl: string;
          nodes: Array<{ target: string[]; html: string; failureSummary: string; any?: Array<{ message: string }> }>;
        }>;
        return list.map((v) => ({
          id: v.id,
          impact: v.impact as AxeViolation['impact'],
          description: v.description,
          help: v.help,
          helpUrl: v.helpUrl,
          nodes: v.nodes.slice(0, 12).map((n) => ({
            target: (n.target ?? []).join(' '),
            html: String(n.html).slice(0, 500),
            summary: n.failureSummary ?? '',
          })),
        }));
      } catch (err) {
        log.warn('axe-core browser scan failed', { error: String(err) });
        return [];
      }
    })();

    await mobilePage.close().catch(() => undefined);
    await page.close().catch(() => undefined);
    await context.close().catch(() => undefined);

    const pick = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null);
    return {
      metrics: {
        viewport: 'desktop 1440×900 + mobile 375×812',
        nav: {
          domContentLoadedMs: navEntry?.dcl ?? pick(nav.domContentLoaded) ?? 0,
          loadMs: navEntry?.load ?? pick(nav.load) ?? 0,
          ttfbMs: navEntry?.ttfb ?? pick(nav.navTtfb) ?? 0,
          transferSize: typeof nav.transferSize === 'number' ? nav.transferSize : 0,
          resources: groups.requests,
        },
        vitals: {
          fcpMs: pick(nav.fcp),
          lcpMs: pick(nav.lcp),
          cls: typeof nav.cls === 'number' ? nav.cls : null,
          tbtMs: pick(nav.tbt),
        },
        resources: {
          totalBytes: groups.totalBytes,
          jsBytes: groups.jsBytes,
          cssBytes: groups.cssBytes,
          imageBytes: groups.imageBytes,
          fontBytes: groups.fontBytes,
          thirdPartyBytes: groups.thirdPartyBytes,
          thirdPartyRequests: groups.thirdPartyRequests,
          jsFiles: groups.jsFiles,
          cssFiles: groups.cssFiles,
          fontFiles: groups.fontFiles,
          imageFiles: groups.imageFiles,
          requests: groups.requests,
        },
        mobile: {
          horizontalOverflow: mobile.overflow > 1,
          overflowPx: mobile.overflow,
          tapTargetsTooSmall: mobile.tapTooSmall,
          textTooSmall: mobile.textTooSmall,
          fixedHeaderCoversContent: mobile.fixedCovers,
          viewportWidth: 375,
        },
      },
      axeViolations: violations,
      screenshotPath,
    };
  } catch (err) {
    await context.close().catch(() => undefined);
    throw err;
  }
}
