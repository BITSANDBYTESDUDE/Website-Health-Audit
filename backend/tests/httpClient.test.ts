import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { safeFetch } from '../src/http/httpClient';
import { startFixtureServer, type FixtureServer } from './fixtures/siteServer';

describe('HTTP client', () => {
  let site: FixtureServer;

  beforeAll(async () => {
    site = await startFixtureServer();
  });
  afterAll(async () => {
    await site.close();
  });

  it('follows a plain request and returns decompressed text', async () => {
    const res = await safeFetch(`${site.baseUrl}/`);
    expect(res.statusCode).toBe(200);
    expect(res.text).toContain('Fixture shop');
    expect(res.text).not.toContain('\u001f\u008b'); // no raw gzip left in the body
    expect(res.sizeBytes).toBeGreaterThan(0);
    // plain http: no TLS metadata is available
    expect(res.tls.protocol).toBeNull();
    expect(res.tls.certificate).toBeNull();
  });

  it('captures HTTP status codes including 4xx errors when allowed', async () => {
    const res = await safeFetch(`${site.baseUrl}/missing-page`, { allowErrorStatus: true });
    expect(res.statusCode).toBe(404);
  });

  it('throws a typed error carrying the status for blocking codes by default', async () => {
    const err = await safeFetch(`${site.baseUrl}/missing-page`).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeTruthy();
    expect((err as { statusCode?: number }).statusCode).toBe(404);
  });
});
