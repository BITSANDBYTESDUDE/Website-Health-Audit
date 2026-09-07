/** Minimal structured logger. No secrets are ever logged. */

type Level = 'debug' | 'info' | 'warn' | 'error';

function ts(): string {
  return new Date().toISOString();
}

function write(level: Level, msg: string, meta?: Record<string, unknown>): void {
  const line = `[${ts()}] ${level.toUpperCase()} ${msg}`;
  const json = meta && Object.keys(meta).length > 0 ? ' ' + JSON.stringify(sanitize(meta)) : '';
  if (level === 'error' || level === 'warn') {
    // eslint-disable-next-line no-console
    console.error(line + json);
  } else {
    // eslint-disable-next-line no-console
    console.log(line + json);
  }
}

/** Drop obvious secrets before logging. */
function sanitize(meta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (/key|token|secret|password|authorization|api[-_]?key/i.test(k)) continue;
    out[k] = v;
  }
  return out;
}

export const log = {
  debug: (msg: string, meta?: Record<string, unknown>) => write('debug', msg, meta),
  info: (msg: string, meta?: Record<string, unknown>) => write('info', msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => write('warn', msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => write('error', msg, meta),
};
