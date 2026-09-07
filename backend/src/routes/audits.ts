import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import fs from 'node:fs';
import path from 'node:path';
import { config, ensureDataDir } from '../config';
import { getStore } from '../store';
import { enqueueAudit, queueStats } from '../engine/queue';
import { validateAuditTarget } from '../utils/url';
import { generatePdfReport, auditToJson, auditToCsv } from '../reports/pdf';
import { log } from '../utils/log';

const bodySchema = z.object({
  url: z.string().trim().min(3).max(2048),
  scanType: z.enum(['quick', 'standard', 'deep']).default('standard'),
});

export const auditLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  limit: config.rateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many audits from this address. Please wait a moment before starting another audit.',
    },
  },
});

export const auditsRouter = Router();

// POST /api/audits — create + enqueue an audit job
auditsRouter.post('/', auditLimiter, async (req: Request, res: Response) => {
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? 'Invalid request.';
    return res.status(400).json({ error: { code: 'VALIDATION', message: msg } });
  }
  const { url, scanType } = parsed.data;
  // Full validation (shape + DNS + SSRF IP policy) before anything is queued,
  // so restricted targets fail fast with a friendly error instead of
  // occupying a worker.
  const target = await validateAuditTarget(url);
  if (!target.ok || !target.url) {
    return res.status(400).json({
      error: { code: target.issue ?? 'INVALID_URL', message: target.message ?? 'Please enter a valid http(s) URL.' },
    });
  }
  try {
    const record = await enqueueAudit(getStore(), { url: target.url.toString(), scanType });
    res.set('location', `/api/audits/${record.id}`);
    return res.status(202).json({ auditId: record.id, status: 'queued', url: target.url.toString(), scanType });
  } catch (err) {
    log.error('failed to enqueue audit', { error: String(err) });
    return res.status(500).json({ error: { code: 'INTERNAL', message: 'Could not start the audit. Please try again.' } });
  }
});

// GET /api/audits — history (public summary list)
auditsRouter.get('/', async (req: Request, res: Response) => {
  const limit = Math.min(Math.max(Number(req.query.limit ?? 20) || 20, 1), 100);
  const offset = Math.max(Number(req.query.offset ?? 0) || 0, 0);
  const store = getStore();
  const records = await store.list(limit, offset);
  const items = records.map((r) => ({
    id: r.id,
    url: r.url,
    domain: safeDomain(r.url),
    status: r.status,
    scanType: r.scanType,
    createdAt: r.createdAt,
    startedAt: r.startedAt,
    completedAt: r.completedAt,
    overallScore: r.result?.overallScore ?? null,
    grade: r.result?.summary?.grade ?? null,
    error: r.error ?? null,
  }));
  return res.json({ items, total: await store.count(), limit, offset });
});

// GET /api/audits/:id — job + result
auditsRouter.get('/:id', async (req: Request, res: Response) => {
  const record = await getStore().get(req.params.id);
  if (!record) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No audit found with that id.' } });
  }
  const { result } = record;
  return res.json({
    id: record.id,
    url: record.url,
    domain: safeDomain(record.url),
    status: record.status,
    scanType: record.scanType,
    createdAt: record.createdAt,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    error: record.error ?? null,
    progress: record.progress ?? null,
    result,
  });
});

// GET /api/audits/:id/events — live Server-Sent Events stream
// Emits `progress` frames while the audit is queued/running, then a terminal
// `result` (or `error`) frame. Heartbeat comment frames keep proxies alive.
auditsRouter.get('/:id/events', async (req: Request, res: Response) => {
  const store = getStore();
  const record = await store.get(req.params.id);
  if (!record) {
    return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No audit found.' } });
  }
  res.status(200);
  res.set({
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.flushHeaders?.();

  const send = (type: string, payload: unknown): void => {
    res.write(`event: ${type}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  let closed = false;
  const timer = setInterval(poll, 1000);
  timer.unref?.();
  const close = (): void => {
    if (closed) return;
    closed = true;
    clearInterval(timer);
    res.end();
  };
  req.on('close', close);

  async function poll(): Promise<void> {
    if (closed) return;
    try {
      const current = await store.get(req.params.id);
      if (!current || closed) {
        close();
        return;
      }
      if (current.status === 'queued' || current.status === 'running') {
        send('progress', {
          status: current.status,
          progress: current.progress ?? null,
          error: current.error ?? null,
        });
        return;
      }
      // terminal state
      send(
        current.status === 'completed' ? 'result' : 'error',
        current.status === 'completed'
          ? { status: 'completed', result: current.result }
          : { status: 'failed', error: current.error ?? { code: 'FAILED', message: 'The audit failed.' } },
      );
      close();
    } catch {
      close();
    }
  }

  // emit the current state immediately so a fast audit still delivers frames
  void poll();
});

// GET /api/audits/:id/issues — filtered issue feed (server-side API parity)
auditsRouter.get('/:id/issues', async (req: Request, res: Response) => {
  const record = await getStore().get(req.params.id);
  if (!record) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No audit found.' } });
  if (record.status !== 'completed' || !record.result) {
    return res.status(409).json({ error: { code: 'NOT_READY', message: 'The audit has not completed yet.' } });
  }
  const issues = [...record.result.issues];
  const { section, severity, q } = req.query;
  const filtered = issues.filter((i) => {
    if (section && i.section !== section) return false;
    if (severity && i.severity !== severity) return false;
    if (q && !`${i.title} ${i.whyItMatters} ${i.code}`.toLowerCase().includes(String(q).toLowerCase())) return false;
    return true;
  });
  return res.json({ issues: filtered });
});

// GET /api/audits/:id/screenshot
auditsRouter.get('/:id/screenshot', async (req: Request, res: Response) => {
  const record = await getStore().get(req.params.id);
  if (!record) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No audit found.' } });
  const fileName = record.result?.screenshot ?? null;
  if (!fileName) return res.status(404).json({ error: { code: 'NO_SCREENSHOT', message: 'No screenshot was captured (browser mode unavailable).' } });
  const filePath = path.join(ensureDataDir(), 'screenshots', fileName);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: { code: 'NO_SCREENSHOT', message: 'Screenshot file is missing.' } });
  }
  res.set('content-type', 'image/png');
  res.set('cache-control', 'public, max-age=300');
  return fs.createReadStream(filePath).pipe(res);
});

// GET /api/audits/:id/report?format=pdf|json|csv
auditsRouter.get('/:id/report', async (req: Request, res: Response) => {
  const record = await getStore().get(req.params.id);
  if (!record) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No audit found.' } });
  if (record.status !== 'completed' || !record.result) {
    return res.status(409).json({ error: { code: 'NOT_READY', message: 'The report is not ready yet — the audit is still running or failed.' } });
  }
  const format = String(req.query.format ?? 'pdf').toLowerCase();
  const base = `sitepulse-audit-${record.result.domain.replace(/[^a-z0-9.-]/gi, '_')}`;
  try {
    if (format === 'json') {
      res.set('content-type', 'application/json');
      res.set('content-disposition', `attachment; filename="${base}.json"`);
      return res.send(auditToJson(record.result));
    }
    if (format === 'csv') {
      res.set('content-type', 'text/csv');
      res.set('content-disposition', `attachment; filename="${base}-findings.csv"`);
      return res.send(auditToCsv(record.result));
    }
    const pdf = await generatePdfReport(record.result);
    res.set('content-type', 'application/pdf');
    res.set('content-disposition', `attachment; filename="${base}-report.pdf"`);
    return res.send(pdf);
  } catch (err) {
    log.error('report generation failed', { error: String(err) });
    return res.status(500).json({ error: { code: 'INTERNAL', message: 'Report generation failed. Please try the JSON export instead.' } });
  }
});

function safeDomain(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url.slice(0, 120);
  }
}
