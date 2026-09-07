import { createApp } from './app';
import { initStore } from './store';
import { config, ensureDataDir } from './config';
import { detectBrowser } from './rendering/browser';
import { buildDemoSiteApp } from './demo/site';
import { log } from './utils/log';

async function main(): Promise<void> {
  ensureDataDir();
  await initStore();

  // Warm the browser detection in the background (does not block boot).
  void detectBrowser().catch(() => undefined);

  const app = createApp();
  const server = app.listen(config.port, '0.0.0.0', () => {
    log.info(`SitePulse API listening on http://0.0.0.0:${config.port}`);
  });
  server.requestTimeout = 30_000;

  // Optional demo target site (development/offline demos only).
  if (config.demo.enabled) {
    const demoApp = buildDemoSiteApp();
    demoApp.listen(config.demo.port, '0.0.0.0', () => {
      log.info(`demo target site listening on http://127.0.0.1:${config.demo.port}`);
    });
  }

  const shutdown = (): void => {
    log.info('shutting down…');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  log.error('fatal startup error', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
