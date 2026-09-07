import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Vitest setup: runs before every test file in the same worker, so the
 * environment below is in place before `src/config` is first imported.
 *
 * - Redirects all persisted runtime data (.data) to a throwaway directory so
 *   tests never touch real dev data or the demo fixture audit.
 * - Permits loopback targets (tests audit an on-disk fixture server).
 * - Disables Playwright, the demo site and AI so tests run fully offline and
 *   deterministic.
 */
const dataDir = path.join(os.tmpdir(), `sitepulse-test-${process.pid}-${Date.now()}`);
fs.mkdirSync(dataDir, { recursive: true });

process.env.SITEPULSE_DATA_DIR = dataDir;
process.env.SITEPULSE_ALLOW_PRIVATE_TARGETS = 'true';
process.env.PLAYWRIGHT_ENABLED = 'false';
process.env.DEMO_SITE_ENABLED = 'false';
process.env.AI_API_KEY = '';
process.env.AUDIT_RATE_LIMIT_MAX = '10000';
process.env.AUDIT_RATE_LIMIT_WINDOW_MS = '60000';
process.env.AUDIT_CONCURRENCY = '2';
process.env.MONGODB_URI = '';
process.env.NODE_ENV = 'test';
