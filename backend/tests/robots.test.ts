import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fetchRobots } from '../src/http/robots';
import { startFixtureServer, type FixtureServer } from './fixtures/siteServer';

describe('robots.txt handling', () => {
  let site: FixtureServer;

  beforeAll(async () => {
    site = await startFixtureServer();
  });
  afterAll(async () => {
    await site.close();
  });

  it('fetches robots.txt and finds the declared sitemap', async () => {
    const robots = await fetchRobots(site.baseUrl, { allowPrivateTargets: true });
    expect(robots.fetched).toBe(true);
    expect(robots.statusCode).toBe(200);
    expect(robots.allowsCrawl).toBe(true);
    expect(robots.disallowAll).toBe(false);
    expect(robots.sitemaps.some((s) => s.includes('/sitemap.xml'))).toBe(true);
  });

  it('detects a full disallow and refuses to crawl', async () => {
    const blocked = await startFixtureServer({ robotsTxt: 'User-agent: *\nDisallow: /\n' });
    try {
      const robots = await fetchRobots(blocked.baseUrl, { allowPrivateTargets: true });
      expect(robots.allowsCrawl).toBe(false);
      expect(robots.disallowAll).toBe(true);
    } finally {
      await blocked.close();
    }
  });

  it('treats a missing robots.txt as crawlable (RFC 9309)', async () => {
    const none = await startFixtureServer({ robotsTxt: 'User-agent: *\nDisallow: /private\n' });
    try {
      const robots = await fetchRobots(none.baseUrl, { allowPrivateTargets: true });
      expect(robots.allowsCrawl).toBe(true);
    } finally {
      await none.close();
    }
  });
});
