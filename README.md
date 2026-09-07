# SitePulse — Website Health Audit

SitePulse analyzes any publicly reachable website and produces a professional,
**evidence-based** health audit: performance, SEO, accessibility, security,
mobile experience, content, images, internal links, and conversion signals.

> **No fake scores.** Every score, finding, metric, and recommendation is
> computed from an actual crawl and HTTP/DOM analysis of the target site —
> never hardcoded and never guessed. The same site re-scanned with the same
> settings reproduces the same score (see
> [docs/scoring-methodology.md](docs/scoring-methodology.md)).

## What you get

| Capability | Details |
| --- | --- |
| Real audit engine | SSRF-safe, bounded crawl (robots.txt-aware, same-origin, page/depth/timeout caps) that measures the actual site |
| 10 report sections | Performance, SEO, Mobile, Accessibility, Security, Technical, Content, Images, Links, Conversion |
| Transparent scoring | Public penalty table + weights, 0–100 overall and per-category scores, reproducible from the finding list |
| Evidence everywhere | Each finding shows measured evidence, why it matters, and a concrete fix |
| Reports | PDF, JSON, and CSV exports + JSON export of the full structured result |
| Live progress | Pollable job state and a Server-Sent Events stream (`/api/audits/:id/events`) |
| Optional AI summary | OpenAI-compatible API rewrites the *wording* of the deterministic summary — never the measurements |
| Storage | MongoDB when configured; otherwise an embedded file-backed store |
| Dashboard | Next.js 14 + TypeScript + Tailwind SaaS UI with audit history and trend deltas |

## Monorepo layout

```
├── backend/   Node 20 + Express + TypeScript audit engine, crawler, REST/SSE API, reports
├── frontend/  Next.js 14 App Router dashboard (TypeScript, Tailwind, lucide-react)
├── docs/      deployment · scoring methodology · security · known limitations
└── .env.example
```

Backend source map: `src/engine` (orchestration), `src/analyzers` (10 rule
sets), `src/scoring`, `src/crawler`, `src/http` (SSRF-safe client, robots),
`src/rendering` (Playwright), `src/reports`, `src/ai`, `src/routes`,
`src/store`, `src/demo` (offline sample site for sandbox testing).

## Quick start (development)

Requirements: Node.js ≥ 20 and npm.

```bash
npm install

# 1. Configure the backend
cp .env.example backend/.env
#    In development you may enable the demo site and private targets:
#    SITEPULSE_ALLOW_PRIVATE_TARGETS=true
#    DEMO_SITE_ENABLED=true

# 2. (Optional) real browser audits — otherwise the engine honestly reports
#    static-mode limitations and marks browser-only metrics "Not available"
npm run setup:browsers

# 3. Run backend API + frontend dashboard together
npm run dev
```

- Dashboard: http://localhost:3000
- API health: http://localhost:8787/api/health — API meta: http://localhost:8787/api/meta
- Demo target (if enabled): http://127.0.0.1:8790

Type in any public URL, or press **Run example audit** to audit the local demo
site end-to-end. History lives at http://localhost:3000/history.

## Tests

```bash
npm test                 # backend unit + integration suite (offline fixtures)
npm run typecheck        # backend + frontend type checking
```

The backend suite runs a real end-to-end audit against an **on-disk fixture
website** (no external network): it verifies SSRF blocking, gzip decoding,
robots.txt handling, deterministic re-scoring, PDF/JSON/CSV exports, SSE
progress, and clean API errors. See `backend/tests/`.

## API quick reference

| Endpoint | Description |
| --- | --- |
| `POST /api/audits` | Start an audit `{url, scanType: quick\|standard\|deep}` → `202 {auditId}` |
| `GET /api/audits/:id` | Job state + full result when completed |
| `GET /api/audits/:id/events` | SSE stream: `progress` → terminal `result`/`error` |
| `GET /api/audits/:id/issues?section=&severity=&q=` | Filtered findings |
| `GET /api/audits/:id/report?format=pdf\|json\|csv` | Export report |
| `GET /api/audits/:id/screenshot` | Homepage screenshot (browser mode only) |
| `GET /api/audits` | History (summary list) |
| `GET /api/meta` · `GET /api/health` | Capabilities & health |

Example:

```bash
curl -X POST http://localhost:8787/api/audits \
  -H 'content-type: application/json' \
  -d '{"url":"https://example.com","scanType":"standard"}'
```

## Learn more

- [Deployment](docs/deployment.md)
- [Scoring methodology](docs/scoring-methodology.md)
- [Security & SSRF protections](docs/security.md)
- [Known limitations](docs/known-limitations.md)

## License

MIT — see [LICENSE](LICENSE).
