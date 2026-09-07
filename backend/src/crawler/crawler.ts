import { safeFetch, HttpRequestError } from '../http/httpClient';
import { log } from '../utils/log';

/**
 * Controlled same-origin crawler.
 *
 * Hard limits enforced:
 *   - max pages (including the homepage)
 *   - max depth
 *   - concurrency
 *   - per-request timeout + response-size cap
 *   - robots.txt evaluation per URL
 *   - never crawls other hostnames (redirects leaving the origin stop the walk)
 */

export interface CrawlPage {
  url: string;
  finalUrl: string;
  statusCode: number;
  depth: number;
  sizeBytes: number;
  durationMs: number;
  redirects: number;
  title: string;
  /** Off-origin redirect target, when the request left the site. */
  redirectedOffsite: boolean;
  offsiteUrl?: string;
  error?: string;
}

export interface CrawlerLimits {
  maxPages: number;
  maxDepth: number;
  concurrency?: number;
}

export interface CrawlerOptions {
  origin: string;
  startUrl: string;
  seedUrls: string[];
  limits: CrawlerLimits;
  isAllowedByRobots: (pathAndQuery: string) => boolean;
  deadlineMs: number;
  timeoutMs?: number;
  /** Optional callback with the raw HTML of every successfully fetched page. */
  onPage?: (page: { url: string; finalUrl: string; statusCode: number; html: string }) => void;
}

const SKIP_EXT =
  /\.(jpe?g|png|gif|webp|avif|svg|ico|bmp|tiff?|pdf|zip|gz|tar|css|js|mjs|json|txt|xml|rss|atom|mp[34]|webm|ogv|mov|avi|mkv|wav|mp2|ogg|oga|flac|aac|woff2?|ttf|otf|eot|docx?|xlsx?|pptx?|csv|exe|dmg|apk|ipa)([?#].*)?$/i;

function normalizeCrawlUrl(rawUrl: string, base: string): string | null {
  try {
    const u = new URL(rawUrl, base);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.hash = '';
    if (u.pathname.length > 1 && u.pathname.endsWith('/')) u.pathname = u.pathname.slice(0, -1);
    return u.toString();
  } catch {
    return null;
  }
}

export async function crawlSite(opts: CrawlerOptions): Promise<CrawlPage[]> {
  const { origin, limits, deadlineMs } = opts;
  const concurrency = Math.min(limits.concurrency ?? 3, 4);
  const pages: CrawlPage[] = [];
  const seen = new Set<string>([normalizeCrawlUrl(opts.startUrl, origin) ?? opts.startUrl]);
  const queue: { url: string; depth: number }[] = [];

  for (const seed of opts.seedUrls) {
    const norm = normalizeCrawlUrl(seed, opts.startUrl);
    if (!norm) continue;
    const u = new URL(norm);
    if (u.origin !== new URL(origin).origin) continue;
    if (seen.has(norm)) continue;
    seen.add(norm);
    queue.push({ url: norm, depth: 1 });
  }

  const fetchOne = async (item: { url: string; depth: number }): Promise<void> => {
    if (pages.length >= limits.maxPages) return;
    if (Date.now() > deadlineMs) return;
    if (item.depth > limits.maxDepth) return;
    if (item.depth > 0) {
      const u = new URL(item.url);
      if (SKIP_EXT.test(u.pathname)) return;
      const path = u.pathname + u.search;
      if (!opts.isAllowedByRobots(path)) return;
    }
    const started = Date.now();
    try {
      const res = await safeFetch(item.url, {
        timeoutMs: opts.timeoutMs ?? 12_000,
        maxBytes: 4 * 1024 * 1024,
        allowErrorStatus: true,
        accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
      });
      const finalUrl = new URL(res.finalUrl);
      const offsite = finalUrl.origin !== origin;
      pages.push({
        url: item.url,
        finalUrl: res.finalUrl,
        statusCode: res.statusCode,
        depth: item.depth,
        sizeBytes: res.sizeBytes,
        durationMs: Date.now() - started,
        redirects: res.redirectChain.length,
        title: extractTitle(res.text),
        redirectedOffsite: offsite,
        offsiteUrl: offsite ? res.finalUrl : undefined,
      });
      if (!offsite && res.statusCode >= 200 && res.statusCode < 400) {
        opts.onPage?.({
          url: item.url,
          finalUrl: res.finalUrl,
          statusCode: res.statusCode,
          html: res.text,
        });
      }
      // Optionally widen the queue only when we still have room.
      if (pages.length < limits.maxPages && !offsite && res.statusCode >= 200 && res.statusCode < 400) {
        const next = extractLinks(res.text, item.url, item.depth + 1, origin, seen);
        for (const link of next) queue.push(link);
      }
    } catch (err) {
      const info = err instanceof HttpRequestError ? err.info.kind : 'UNKNOWN';
      pages.push({
        url: item.url,
        finalUrl: item.url,
        statusCode: info === 'BLOCKED' && err instanceof HttpRequestError && err.statusCode ? err.statusCode : 0,
        depth: item.depth,
        sizeBytes: 0,
        durationMs: Date.now() - started,
        redirects: 0,
        title: '',
        redirectedOffsite: false,
        error: info,
      });
    }
  };

  // BFS with bounded concurrency.
  let head = 0;
  while (head < queue.length && pages.length < limits.maxPages && Date.now() < deadlineMs) {
    const batch = queue.slice(head, head + concurrency);
    head += batch.length;
    const localPages = pages.length;
    const room = limits.maxPages - localPages;
    await Promise.all(batch.slice(0, Math.max(room, 0) || batch.length).map(fetchOne));
    queue.sort((a, b) => a.depth - b.depth || queue.indexOf(a) - queue.indexOf(b));
    queue.length = Math.min(queue.length, limits.maxPages * 4);
  }

  if (pages.length === 0) {
    log.warn('crawler produced no pages', { origin });
  }
  return pages;
}

function extractTitle(html: string): string {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!m) return '';
  return m[1].replace(/\s+/g, ' ').trim().slice(0, 300);
}

function extractLinks(
  html: string,
  baseUrl: string,
  depth: number,
  origin: string,
  seen: Set<string>,
): { url: string; depth: number }[] {
  const out: { url: string; depth: number }[] = [];
  const re = /<a\b[^>]*href\s*=\s*(["'])(.*?)\1/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const href = m[2].trim();
    const norm = normalizeCrawlUrl(href, baseUrl);
    if (!norm) continue;
    let u: URL;
    try {
      u = new URL(norm);
    } catch {
      continue;
    }
    if (u.origin !== origin) continue;
    if (SKIP_EXT.test(u.pathname)) continue;
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push({ url: norm, depth });
    if (out.length >= 200) break;
  }
  return out;
}
