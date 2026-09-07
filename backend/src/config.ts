import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';

function num(value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return value.toLowerCase() === 'true' || value === '1';
}

const corsOriginRaw = process.env.CORS_ORIGIN ?? 'http://localhost:3000';

export const config = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isDev: (process.env.NODE_ENV ?? 'development') !== 'production',
  port: num(process.env.PORT, 8787),
  corsOrigins: corsOriginRaw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:3000',

  mongodbUri: (process.env.MONGODB_URI ?? '').trim(),
  mongodbDb: process.env.MONGODB_DB ?? 'sitepulse',

  ai: {
    apiKey: process.env.AI_API_KEY ?? '',
    baseUrl: (process.env.AI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, ''),
    model: process.env.AI_MODEL ?? 'gpt-4o-mini',
    timeoutMs: num(process.env.AI_TIMEOUT_MS, 15000),
  },

  rateLimit: {
    max: num(process.env.AUDIT_RATE_LIMIT_MAX, 6),
    windowMs: num(process.env.AUDIT_RATE_LIMIT_WINDOW_MS, 60_000),
  },
  auditConcurrency: num(process.env.AUDIT_CONCURRENCY, 2),

  httpTimeoutMs: num(process.env.HTTP_TIMEOUT_MS, 15_000),
  browserNavigationTimeoutMs: num(process.env.BROWSER_NAVIGATION_TIMEOUT_MS, 45_000),
  totalScanTimeoutMs: num(process.env.TOTAL_SCAN_TIMEOUT_MS, 240_000),

  crawl: {
    standardPages: num(process.env.CRAWL_MAX_PAGES_STANDARD, 10),
    deepPages: num(process.env.CRAWL_MAX_PAGES_DEEP, 50),
    deepDepth: num(process.env.CRAWL_MAX_DEPTH_DEEP, 3),
  },

  security: {
    allowPrivateTargets: bool(process.env.SITEPULSE_ALLOW_PRIVATE_TARGETS, false),
    blockedHosts: (process.env.SITEPULSE_BLOCKED_HOSTS ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  },

  playwrightEnabled: bool(process.env.PLAYWRIGHT_ENABLED, true),

  demo: {
    enabled: bool(process.env.DEMO_SITE_ENABLED, false),
    port: num(process.env.DEMO_SITE_PORT, 8790),
    url: process.env.DEMO_SITE_URL ?? 'http://127.0.0.1:8790',
  },
  exampleAuditUrl: (process.env.EXAMPLE_AUDIT_URL ?? '').trim(),

  version: '1.0.0',
};

/** Directory for persisted runtime data (JSON audit fallback). */
export const dataDir = (process.env.SITEPULSE_DATA_DIR ?? '').trim()
  ? path.resolve((process.env.SITEPULSE_DATA_DIR ?? '').trim())
  : path.resolve(__dirname, '..', '..', '.data');

export function ensureDataDir(): string {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  return dataDir;
}
