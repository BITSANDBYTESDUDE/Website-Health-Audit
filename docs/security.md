# Security & SSRF protections

SitePulse audits *arbitrary user-supplied URLs*, so the engine is built as if
every request were hostile. All protections are implemented in
`backend/src/utils/url.ts` and `backend/src/http/httpClient.ts`.

## Server-Side Request Forgery (SSRF) defense-in-depth

Every outbound request — homepage, crawled pages, assets, images, robots.txt,
redirect hops — passes the same pipeline:

1. **Scheme + shape checks**: http/https only; no embedded credentials; no
   fragments. Anything else is rejected before any I/O.
2. **Hostname checks**: single-label internal names (`intranet`, `fileserver`)
   are rejected; a configurable blocklist plus reserved suffixes
   (`.internal`, `.local`, `.localhost`, `.lan`, `.home`, `.corp`, `.intranet`)
   are rejected.
3. **DNS + IP policy**: the hostname is resolved and **every** returned
   address is classified:
   - loopback (`127.0.0.0/8`, `::1`, v4-mapped loopback) → blocked
   - private RFC1918 + ULA ranges → blocked by default
   - link-local (`169.254.0.0/16`, `fe80::/10`) → blocked by default
   - cloud metadata / carrier-grade NAT endpoints
     (`169.254.0.0/16` incl. `169.254.169.254`, `100.64.0.0/10`,
     `100.100.100.200`) → **always blocked**, even when private targets are
     enabled for sandboxes
   - IPv6 mapped addresses are decoded before classification.
4. **Connect to the validated IP**: the client connects to the specific
   validated address and pins `Host`/SNI to the real hostname — so a
   DNS-rebinding race cannot redirect the connection to an internal host that
   was not validated.
5. **Redirect re-validation**: every redirect hop is re-validated with the
   same pipeline before it is followed (max 5 hops).
6. **DNS cache**: resolved addresses are cached 60s and re-checked against the
   policy on use.

### When `SITEPULSE_ALLOW_PRIVATE_TARGETS=true`

This exists **only** so the app can audit a local demo/fixture site inside a
sandbox. When enabled, loopback/private/link-local targets become allowed —
metadata endpoints do **not**. Keep it `false` in any deployment that accepts
untrusted public URLs.

## Crawler hardening

- Same-origin only; off-origin redirects end the walk for that page.
- robots.txt is fetched and evaluated per URL before crawling it.
- Hard caps: max pages, max depth, concurrency, per-request timeout and
  response-size limit, and an overall scan deadline.
- Binary/asset responses are size-capped (e.g. 8 MB raw, and decompression is
  bounded) to avoid memory exhaustion.

## API hardening

- **Rate limiting**: starting audits is limited per IP
  (`AUDIT_RATE_LIMIT_MAX` / window).
- **Input limits**: request bodies capped (256 kB), URL length ≤ 2048,
  zod-validated `scanType`.
- **CORS**: only origins listed in `CORS_ORIGIN` may call the API from a
  browser.
- **Error hygiene**: internal errors are logged server-side; API clients get
  sanitized, friendly messages — no stack traces, no filesystem paths, no
  headers, no raw HTML.
- `x-powered-by` is disabled; a request logger records method, path, status,
  and duration only (URLs are logged for audits — avoid putting secrets in
  audited URLs, as with any analytics tool).

## Data handling

- No secrets are stored. The AI summary call (when `AI_API_KEY` is set) sends
  only the deterministic summary context to an OpenAI-compatible endpoint and
  never the raw HTML or evidence payloads beyond the summary inputs.
- Runtime data (file-backed store, screenshots) is written under the
  configurable data directory; `.data/` is git-ignored. Screenshots are only
  captured in browser mode and served read-only with a short cache header.

## Operational notes

- Run behind TLS (nginx/Caddy) so audits and API traffic are encrypted.
- Set `FRONTEND_URL`/`CORS_ORIGIN` to your real dashboard origin.
- If you terminate TLS at a proxy, remember the API itself speaks HTTP to the
  targets it audits by design — never point it at internal-only services
  without the private-target override in a controlled sandbox.
- Audit-start rate limits are per process; increase the limit or instance
  count deliberately, not reactively.

## Security test coverage

`backend/tests/urlValidation.test.ts` asserts IP classification, always-block
metadata rules, private-target gating, blocklisted hosts, and internal
hostname rejection. `backend/tests/auditE2E.test.ts` verifies the HTTP API
rejects metadata targets and credential-bearing URLs with `400` responses.
