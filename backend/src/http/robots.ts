import RobotsParser from 'robots-parser';
import { safeFetch, HttpRequestError } from './httpClient';
import { log } from '../utils/log';

export const SITEPULSE_UA = 'SitePulseBot/1.0';

export interface RobotsResult {
  fetched: boolean;
  statusCode: number | null;
  allowsCrawl: boolean;
  disallowAll: boolean;
  sitemaps: string[];
  body: string;
  error?: string;
}

/**
 * Fetch + evaluate robots.txt for the target origin.
 * A missing / unreachable robots.txt is treated as "allow" (per RFC 9309 a
 * 4xx response means no restrictions) but we record that we could not fetch it.
 */
export async function fetchRobots(
  origin: string,
  opts: { timeoutMs?: number; allowPrivateTargets?: boolean } = {},
): Promise<RobotsResult> {
  const robotsUrl = `${origin}/robots.txt`;
  const empty: RobotsResult = {
    fetched: false,
    statusCode: null,
    allowsCrawl: true,
    disallowAll: false,
    sitemaps: [],
    body: '',
    error: 'not_fetched',
  };
  try {
    const res = await safeFetch(robotsUrl, {
      timeoutMs: opts.timeoutMs ?? 8000,
      maxBytes: 512 * 1024,
      allowErrorStatus: true,
      accept: 'text/plain,*/*;q=0.1',
    });
    const body = res.text.trim();
    if (res.statusCode >= 400) {
      return { ...empty, fetched: true, statusCode: res.statusCode, body, allowsCrawl: true };
    }
    const parser = RobotsParser(robotsUrl, body);
    const sitemaps = parser.getSitemaps() ?? [];
    // Our crawler requests HTML pages as a single user agent; evaluate against
    // the origin root so a blanket "Disallow: /" (or a wildcard-only block)
    // is reported as a full crawl stop.
    const allows = parser.isAllowed(`${origin}/`, SITEPULSE_UA) ?? true;
    return {
      fetched: true,
      statusCode: res.statusCode,
      allowsCrawl: allows,
      disallowAll: !allows,
      sitemaps,
      body: body.slice(0, 4000),
    };
  } catch (err) {
    if (err instanceof HttpRequestError) {
      log.debug('robots.txt fetch failed', { kind: err.info.kind });
      return { ...empty, error: err.info.kind };
    }
    log.debug('robots.txt fetch failed', { error: String(err) });
    return { ...empty, error: 'unknown' };
  }
}
