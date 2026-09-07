# Deployment

SitePulse is a classic two-process web app: a **Node.js API** (audit engine +
queue + store) and a **Next.js dashboard**. This guide covers a single-host
production deployment.

## Production checklist

| Item | Recommended value |
| --- | --- |
| Node.js | ≥ 20 (LTS) |
| `NODE_ENV` | `production` |
| `SITEPULSE_ALLOW_PRIVATE_TARGETS` | `false` (default) — **never** enable in a public deployment; see [security.md](security.md) |
| `MONGODB_URI` | A real MongoDB connection string if history must survive restarts |
| `CORS_ORIGIN` | The dashboard origin(s), e.g. `https://audit.example.com` |
| `FRONTEND_URL` | The dashboard origin used in generated report links |
| `PLAYWRIGHT_ENABLED` | `true` only after installing Chromium (`npm run setup:browsers` in `backend/`) |
| `AUDIT_RATE_LIMIT_MAX` | Tune per-IP audit-start rate (default 6 / minute) |
| Reverse proxy | TLS termination + gzip in front of both apps |

## Build

```bash
npm ci
npm run setup:browsers   # optional; installs Chromium for browser audits
npm run build            # compiles backend (dist/) and frontend (.next/)
```

## Run

Backend:

```bash
cd backend && NODE_ENV=production node dist/src/server.js
```

Frontend:

```bash
cd frontend && NODE_ENV=production npm run start   # port 3000
```

## Architecture notes that affect deployment

- The audit **queue is in-process** — audits run inside the API process and
  concurrency is bounded by `AUDIT_CONCURRENCY`. Run a single API instance
  (or one dedicated worker); do not load-balance multiple API instances that
  share nothing, or queued jobs will be lost on restart unless `MONGODB_URI`
  is set.
- Without MongoDB the file-backed store persists the most recent 60 audits to
  `<data-dir>/audits.json` (see `SITEPULSE_DATA_DIR` below) and survives
  graceful restarts.
- Browser audits need headless Chromium on the API host plus enough RAM/CPU;
  if it is not installed the engine falls back to static mode and reports
  browser-only metrics as *Not available* (see [known-limitations.md](known-limitations.md)).
- The demo site (`DEMO_SITE_ENABLED`) is for sandboxes only — disable it in
  production.

## Environment variables

See `.env.example` for the full annotated list. Production-relevant ones:

| Variable | Purpose |
| --- | --- |
| `PORT` | API port (default 8787) |
| `CORS_ORIGIN` | Comma-separated allowed browser origins |
| `MONGODB_URI`, `MONGODB_DB` | Optional MongoDB persistence |
| `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL`, `AI_TIMEOUT_MS` | Optional OpenAI-compatible AI summary |
| `AUDIT_RATE_LIMIT_MAX`, `AUDIT_RATE_LIMIT_WINDOW_MS` | Audit-start rate limiting |
| `AUDIT_CONCURRENCY` | Simultaneous audits per process |
| `HTTP_TIMEOUT_MS`, `BROWSER_NAVIGATION_TIMEOUT_MS`, `TOTAL_SCAN_TIMEOUT_MS` | Hard timeouts |
| `CRAWL_MAX_PAGES_STANDARD`, `CRAWL_MAX_PAGES_DEEP`, `CRAWL_MAX_DEPTH_DEEP` | Crawl caps |
| `SITEPULSE_ALLOW_PRIVATE_TARGETS`, `SITEPULSE_BLOCKED_HOSTS` | SSRF policy |
| `PLAYWRIGHT_ENABLED` | Browser audits toggle |
| `SITEPULSE_DATA_DIR` | Where runtime data (JSON store, screenshots) is written; defaults to `.data/` at the repository root |
| `DEMO_SITE_ENABLED`, `DEMO_SITE_PORT`, `DEMO_SITE_URL`, `EXAMPLE_AUDIT_URL` | Demo/example target |
| `FRONTEND_URL` | Dashboard origin for links inside exported reports |

## Reverse proxy example (nginx)

```nginx
server {
  listen 443 ssl http2;
  server_name audit.example.com;

  # API
  location /api/ {
    proxy_pass http://127.0.0.1:8787;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;          # SSE /api/audits/:id/events
    proxy_read_timeout 300s;
  }

  # Dashboard
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

> If your Next.js app and the API share the same origin via these rewrite
> rules, keep `FRONTEND_URL`/`CORS_ORIGIN` consistent with that origin.

## Health checks

- `GET /api/health` → `{ok: true, service: "sitepulse-backend", version, queue, ...}`
- `GET /api/meta` → scan limits, browser availability, demo/example targets

## Upgrades

Re-run `npm run build`, restart both processes, and keep the environment
variables in sync with `.env.example`. Report JSON export uses
`schema: sitepulse/audit-result/v1`, so exports stay parseable across minor
upgrades; breaking schema changes will bump the version.
