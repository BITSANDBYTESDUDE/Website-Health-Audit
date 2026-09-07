import express from 'express';
import { config } from './config';
import { corsMiddleware, requestLogger, notFoundHandler, errorHandler } from './middleware/http';
import { auditsRouter } from './routes/audits';
import { queueStats } from './engine/queue';
import { detectBrowser, getBrowserStatus } from './rendering/browser';

export function createApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '256kb' }));
  app.use(corsMiddleware());
  app.use(requestLogger());

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'sitepulse-backend',
      version: config.version,
      time: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      queue: queueStats(),
    });
  });

  app.get('/api/meta', (_req, res) => {
    const browser = getBrowserStatus();
    void detectBrowser; // warm detection runs in background at boot
    res.json({
      version: config.version,
      browserAvailable: browser.checked && browser.available,
      browserChecked: browser.checked,
      auditConcurrency: config.auditConcurrency,
      scanLimits: {
        quick: { pages: 1, depth: 0, label: 'Quick scan' },
        standard: { pages: config.crawl.standardPages, depth: 2, label: 'Standard scan' },
        deep: { pages: config.crawl.deepPages, depth: config.crawl.deepDepth, label: 'Deep scan' },
      },
      demoUrl: config.demo.enabled ? config.demo.url : null,
      exampleUrl: exampleUrl(),
      privateTargetsAllowed: config.security.allowPrivateTargets,
    });
  });

  app.use('/api/audits', auditsRouter);

  app.use('/api', notFoundHandler);
  app.use('/api', errorHandler);

  app.get('/', (_req, res) => {
    res.type('text/plain').send('SitePulse backend API is running. See /api/health and /api/meta.');
  });
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

function exampleUrl(): string {
  if (config.exampleAuditUrl) return config.exampleAuditUrl;
  if (config.demo.enabled) return config.demo.url;
  return 'https://example.com';
}
