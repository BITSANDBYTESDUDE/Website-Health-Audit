import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/app';
import { initStore, getStore } from '../src/store';
import { startFixtureServer, type FixtureServer } from './fixtures/siteServer';

const GRADES = ['Excellent', 'Good', 'Fair', 'Needs improvement', 'Poor'];
const SEVERITIES = ['passed', 'low', 'medium', 'high', 'critical'];

/**
 * True end-to-end test: a real HTTP fixture website is audited through the
 * whole stack (express app → queue → SSRF-safe HTTP engine → scoring →
 * store) with Playwright disabled and no external network.
 */
describe('end-to-end audit', () => {
  let app: Express;
  let site: FixtureServer;

  beforeAll(async () => {
    await initStore();
    app = createApp();
    site = await startFixtureServer();
  });
  afterAll(async () => {
    await site.close();
  });

  async function waitForTerminal(id: string): Promise<{ status: string; result?: Record<string, unknown>; error?: unknown }> {
    const deadline = Date.now() + 90_000;
    for (;;) {
      const res = await request(app).get(`/api/audits/${id}`);
      expect(res.status).toBe(200);
      const body = res.body as { status: string; result?: Record<string, unknown>; error?: unknown };
      if (body.status === 'completed' || body.status === 'failed') return body;
      if (Date.now() > deadline) throw new Error(`timed out waiting for audit ${id} (last status: ${body.status})`);
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  function expectCompletedShape(body: { status: string; result?: Record<string, unknown>; error?: unknown }): Record<string, any> {
    expect(body.status).toBe('completed');
    expect(body.error).toBeNull();
    const result = body.result as Record<string, any>;
    expect(result.status).toBe('completed');
    expect(result.overallScore).toEqual(expect.any(Number));
    expect(result.overallScore).toBeGreaterThanOrEqual(0);
    expect(result.overallScore).toBeLessThanOrEqual(100);
    expect(result.pagesScanned).toBeGreaterThanOrEqual(1);
    expect(result.pages.length).toBeGreaterThanOrEqual(1);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(GRADES).toContain(result.summary.grade);
    expect(result.metrics.length).toBeGreaterThan(0);
    return result;
  }

  it('runs a complete standard audit against the fixture site', async () => {
    const created = await request(app)
      .post('/api/audits')
      .send({ url: `${site.baseUrl}/`, scanType: 'standard' })
      .expect(202);
    const auditId = (created.body as { auditId: string }).auditId;
    expect(auditId).toMatch(/^[0-9a-f-]{36}$/);

    const done = await waitForTerminal(auditId);
    const result = expectCompletedShape(done);

    // Every finding must be self-contained, carry evidence + a fix, and have a
    // stable unique code.
    const codes = new Set<string>();
    for (const issue of result.issues as Array<Record<string, any>>) {
      expect(issue.code).toMatch(/^[A-Z0-9]+-\d+$/);
      codes.add(issue.code);
      expect(SEVERITIES).toContain(issue.severity);
      expect(typeof issue.title).toBe('string');
      expect(Array.isArray(issue.evidence)).toBe(true);
      if (issue.severity !== 'passed') {
        // actionable findings must explain the problem and the fix
        expect(issue.whyItMatters.length).toBeGreaterThan(5);
        expect(issue.recommendedFix.length).toBeGreaterThan(5);
      } else {
        expect(issue.code).toMatch(/^PASS-\d+$/);
      }
    }

    // The fixture deliberately ships a broken internal link.
    const titles = JSON.stringify(result.issues);
    expect(titles).toMatch(/404|[Bb]roken|[Ff]ailed|[Nn]ot found/i);

    // The crawler bounded itself to the standard scan limit and robots.txt
    // was respected throughout.
    expect(result.crawlPolicy.maxPages).toBeGreaterThan(1);
    expect(result.pages.length).toBeLessThanOrEqual(result.crawlPolicy.maxPages);
    expect(result.crawlPolicy.respectsRobotsTxt).toBe(true);
    expect(result.crawlPolicy.robotsAllowedCrawl).toBe(true);

    // Store is consistent with the API response.
    const stored = await getStore().get(auditId);
    expect(stored).not.toBeNull();
    expect(stored?.status).toBe('completed');
    expect(stored?.completedAt).toBeTruthy();
  });

  it('produces identical scores and issue sets on a re-scan (reproducibility)', async () => {
    const a = await request(app).post('/api/audits').send({ url: `${site.baseUrl}/`, scanType: 'quick' }).expect(202);
    const b = await request(app).post('/api/audits').send({ url: `${site.baseUrl}/`, scanType: 'quick' }).expect(202);
    const [ra, rb] = await Promise.all([
      waitForTerminal((a.body as { auditId: string }).auditId),
      waitForTerminal((b.body as { auditId: string }).auditId),
    ]);
    const resA = expectCompletedShape(ra);
    const resB = expectCompletedShape(rb);
    expect(resA.overallScore).toBe(resB.overallScore);
    const codesA = (resA.issues as Array<{ code: string }>).map((i) => i.code).sort();
    const codesB = (resB.issues as Array<{ code: string }>).map((i) => i.code).sort();
    expect(codesA).toEqual(codesB);
    expect(JSON.stringify(resA.summary)).toBe(JSON.stringify(resB.summary));
  });

  it('serves JSON, CSV and PDF report exports for a completed audit', async () => {
    const created = await request(app).post('/api/audits').send({ url: `${site.baseUrl}/about`, scanType: 'quick' }).expect(202);
    const auditId = (created.body as { auditId: string }).auditId;
    await waitForTerminal(auditId);

    const json = await request(app).get(`/api/audits/${auditId}/report?format=json`).expect(200);
    expect(json.headers['content-type']).toMatch(/application\/json/);
    const parsed = JSON.parse(json.text) as { schema: string; overallScore: number };
    expect(parsed.schema).toBe('sitepulse/audit-result/v1');
    expect(parsed.overallScore).toEqual(expect.any(Number));

    const csv = await request(app).get(`/api/audits/${auditId}/report?format=csv`).expect(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text).toContain('"section","severity","code"');

    const pdf = await request(app).get(`/api/audits/${auditId}/report?format=pdf`).expect(200);
    expect(pdf.headers['content-type']).toMatch(/application\/pdf/);
    expect(pdf.body.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('rejects unsafe audit targets at the API boundary', async () => {
    const meta = await request(app)
      .post('/api/audits')
      .send({ url: 'http://169.254.169.254/latest/meta-data/iam/security-credentials/', scanType: 'quick' });
    expect(meta.status).toBe(400);
    expect((meta.body as { error: { code: string } }).error.code).toBe('METADATA_ENDPOINT');

    const creds = await request(app).post('/api/audits').send({ url: 'https://user:pass@example.com/' });
    expect(creds.status).toBe(400);
    expect((creds.body as { error: { code: string } }).error.code).toBe('CREDENTIALS_IN_URL');
  });

  it('streams live progress over SSE and finishes with a result frame', async () => {
    const created = await request(app)
      .post('/api/audits')
      .send({ url: `${site.baseUrl}/products/widget`, scanType: 'quick' })
      .expect(202);
    const auditId = (created.body as { auditId: string }).auditId;

    const stream = await request(app).get(`/api/audits/${auditId}/events`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks).toString('utf8')));
    });
    const frames = String(stream.body ?? '');
    expect(frames).toMatch(/event: progress/);
    expect(frames).toMatch(/event: result/);
    expect(frames).toContain('"status":"completed"');
  });

  it('returns 404 and validation errors cleanly', async () => {
    await request(app).get('/api/audits/00000000-0000-0000-0000-000000000000').expect(404);
    const bad = await request(app).post('/api/audits').send({ url: '', scanType: 'deep' });
    expect(bad.status).toBe(400);
    await request(app).get('/api/health').expect(200);
  });
});
