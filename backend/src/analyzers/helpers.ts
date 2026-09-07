import type { CheerioAPI } from 'cheerio';
import { safeFetch } from '../http/httpClient';
import type { FetchedAsset, ImageAsset } from '../engine/context';
import type { AnalyzerIssue, AnalyzerOutput } from '../engine/context';
import type { Metric, Severity, ScoreBucket, ReportSection } from '../types';
import { log } from '../utils/log';

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return 'Not available';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export function formatSeconds(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return 'Not available';
  return (ms / 1000).toFixed(2) + ' s';
}

export function metric(
  key: string,
  label: string,
  value: string | number | null,
  status: Metric['status'] = 'neutral',
  unit?: string,
  hint?: string,
): Metric {
  return { key, label, value, status, unit, hint };
}

export function out(issues: AnalyzerIssue[] = [], metrics: Metric[] = [], notes: string[] = []): AnalyzerOutput {
  return { issues, metrics, notes };
}

export function issue(
  section: ReportSection,
  bucket: ScoreBucket | 'none',
  severity: Severity,
  title: string,
  whyItMatters: string,
  recommendedFix: string,
  evidence: AnalyzerIssue['evidence'] = [],
  area?: string,
): AnalyzerIssue {
  return { section, bucket, severity, title, whyItMatters, recommendedFix, evidence, area };
}

/** "N issues" phrasing. */
export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** Collect unique asset URLs referenced from the HTML head/body. */
export function collectCssJsUrls($: CheerioAPI, baseUrl: string): { url: string; kind: 'script' | 'style' }[] {
  const seen = new Set<string>();
  const res: { url: string; kind: 'script' | 'style' }[] = [];
  const push = (raw: string | undefined, kind: 'script' | 'style') => {
    if (!raw) return;
    try {
      const u = new URL(raw, baseUrl);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return;
      if (seen.has(u.toString())) return;
      seen.add(u.toString());
      res.push({ url: u.toString(), kind });
    } catch {
      /* ignore malformed */
    }
  };
  $('script[src]').each((_i, el) => push($(el).attr('src'), 'script'));
  $('link[rel="stylesheet"]').each((_i, el) => push($(el).attr('href'), 'style'));
  return res;
}

export function collectFontUrls($: CheerioAPI, baseUrl: string): string[] {
  const out: string[] = [];
  $('link[rel="preload"][as="font"], link[type*="font"], link[href*=".woff"], link[href*=".ttf"], link[href*=".otf"]').each(
    (_i, el) => {
      const href = $(el).attr('href');
      if (!href) return;
      try {
        const u = new URL(href, baseUrl);
        out.push(u.toString());
      } catch {
        /* ignore */
      }
    },
  );
  return out;
}

export function collectImages($: CheerioAPI, baseUrl: string, baseHost: string): ImageAsset[] {
  const imgs: ImageAsset[] = [];
  const seen = new Set<string>();
  $('img').each((i, el) => {
    if (imgs.length >= 60) return;
    const $el = $(el);
    const src = $el.attr('src');
    if (!src) return;
    let url: string;
    try {
      url = new URL(src, baseUrl).toString();
    } catch {
      return;
    }
    if (url.startsWith('data:') || seen.has(url)) return;
    seen.add(url);
    let host = '';
    try {
      host = new URL(url).host;
    } catch {
      return;
    }
    const alt = $el.attr('alt');
    imgs.push({
      url,
      alt: alt ?? '',
      hasAlt: alt !== undefined,
      loading: $el.attr('loading') ?? null,
      widthAttr: $el.attr('width') ?? null,
      heightAttr: $el.attr('height') ?? null,
      srcset: !!$el.attr('srcset'),
      host,
      inFirstScreenful: i < 3,
      sizeBytes: null,
      statusCode: null,
      guessedFormat: guessImageFormat(url),
      fetched: false,
    });
  });
  return imgs;
}

export function guessImageFormat(url: string): string {
  const m = /\.(jpe?g|png|gif|webp|avif|svg|bmp|ico)(?:[?#].*)?$/i.exec(new URL(url).pathname);
  return m ? m[1].toLowerCase() : 'unknown';
}

/** Statuses that mean "genuinely missing/broken" (403/401/429 = blocked, not broken). */
export function isBrokenHttpStatus(status: number): boolean {
  return (status >= 404 && status <= 499 && status !== 429) || status >= 500;
}

export async function fetchAssets(
  list: { url: string; kind: 'script' | 'style' | 'font' }[],
  opts: { concurrency?: number; timeoutMs?: number; maxBytes?: number; referer?: string } = {},
): Promise<FetchedAsset[]> {
  const concurrency = opts.concurrency ?? 4;
  const results: FetchedAsset[] = [];
  const seen = new Set<string>();
  const unique = list.filter((a) => {
    if (seen.has(a.url)) return false;
    seen.add(a.url);
    return true;
  });
  let idx = 0;
  const worker = async () => {
    for (;;) {
      const item = unique[idx++];
      if (!item) return;
      try {
        const res = await safeFetch(item.url, {
          timeoutMs: opts.timeoutMs ?? 8000,
          maxBytes: opts.maxBytes ?? 4 * 1024 * 1024,
          allowErrorStatus: true,
          extraHeaders: opts.referer ? { referer: opts.referer } : undefined,
        });
        const contentEncoding = (res.headers['content-encoding'] as string | undefined) ?? null;
        const cc = (res.headers['cache-control'] as string | undefined) ?? null;
        const ct = (res.headers['content-type'] as string | undefined) ?? '';
        let cssText: string | null = null;
        if (item.kind === 'style' && res.statusCode === 200 && /css/i.test(ct) && res.sizeBytes <= 200_000) {
          cssText = res.text;
        }
        results.push({
          url: res.finalUrl,
          kind: item.kind,
          host: new URL(res.finalUrl).host,
          sizeBytes: res.sizeBytes,
          statusCode: res.statusCode,
          compression: contentEncoding,
          cacheControl: cc,
          isCacheable: cc !== null && /(max-age|public|immutable|s-maxage)/i.test(cc),
          cssText,
        });
      } catch (err) {
        results.push({
          url: item.url,
          kind: item.kind,
          host: new URL(item.url).host,
          sizeBytes: 0,
          statusCode: 0,
          compression: null,
          cacheControl: null,
          isCacheable: false,
          error: err instanceof Error ? err.message : 'fetch failed',
        });
      }
    }
  };
  const workers = Array.from({ length: Math.min(concurrency, Math.max(unique.length, 1)) }, () => worker());
  await Promise.all(workers);
  return results;
}

/** Measure image byte sizes (transfer size, capped). */
export async function measureImages(
  images: ImageAsset[],
  opts: { concurrency?: number; timeoutMs?: number; maxBytes?: number; referer?: string } = {},
): Promise<ImageAsset[]> {
  const concurrency = opts.concurrency ?? 4;
  const maxBytes = opts.maxBytes ?? 4 * 1024 * 1024;
  const out: ImageAsset[] = [];
  let idx = 0;
  const worker = async () => {
    for (;;) {
      const img = images[idx++];
      if (!img) return;
      try {
        const res = await safeFetch(img.url, {
          timeoutMs: opts.timeoutMs ?? 8000,
          maxBytes,
          allowErrorStatus: true,
          method: 'GET',
          extraHeaders: opts.referer ? { referer: opts.referer } : undefined,
        });
        const sizeBytes = res.statusCode === 200 ? res.sizeBytes : 0;
        out.push({ ...img, fetched: true, sizeBytes, statusCode: res.statusCode });
      } catch (err) {
        log.debug('image measure failed', { error: String(err) });
        out.push({ ...img, fetched: true, sizeBytes: null, statusCode: null, error: 'fetch failed' });
      }
    }
  };
  const n = Math.min(concurrency, Math.max(images.length, 1));
  const workers = Array.from({ length: n }, () => worker());
  await Promise.all(workers);
  out.sort((a, b) => images.indexOf(a) - images.indexOf(b));
  return out;
}

/** Extract an ordered list of links (internal/external) with anchor text. */
export function collectLinks(
  $: CheerioAPI,
  baseUrl: string,
  baseHost: string,
): { url: string; text: string; to: 'internal' | 'external'; raw: string }[] {
  const links: { url: string; text: string; to: 'internal' | 'external'; raw: string }[] = [];
  const seenText = new Set<string>();
  $('a[href]').each((_i, el) => {
    const $el = $(el);
    const raw = ($el.attr('href') ?? '').trim();
    if (!raw) return;
    if (raw.startsWith('#') || /^(mailto|tel|javascript|data|whatsapp):/i.test(raw)) return;
    let u: URL;
    try {
      u = new URL(raw, baseUrl);
    } catch {
      return;
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return;
    const text = $el.clone().find('script,style').remove().end().text().replace(/\s+/g, ' ').trim().slice(0, 120);
    const key = u.origin + u.pathname;
    if (seenText.has(key + '|' + text)) return;
    seenText.add(key + '|' + text);
    links.push({
      url: u.toString(),
      text,
      to: u.hostname.toLowerCase().replace(/^www\./, '') === baseHost.toLowerCase().replace(/^www\./, '') ? 'internal' : 'external',
      raw,
    });
  });
  return links;
}

export function cleanText($: CheerioAPI): string {
  const $body = $('body').clone();
  $body.find('script,style,noscript,svg,canvas,iframe,template').remove();
  return $body.text().replace(/\s+/g, ' ').trim();
}

export function headerStr(headers: Record<string, unknown>, name: string): string | null {
  const v = headers[name];
  if (v === undefined) return null;
  return Array.isArray(v) ? v.join(', ') : String(v);
}

export function evUrl(url: string): AnalyzerIssue['evidence'] {
  return [{ type: 'url', value: url.slice(0, 500) }];
}
