# Known limitations

SitePulse is deliberately honest about what it could not measure — it never
invents data. The important limitations are:

## Rendering mode

- Without Playwright/Chromium installed (`npm run setup:browsers` in
  `backend/`), audits run in **static mode**: HTTP + DOM parsing. JavaScript
  is not executed, so:
  - client-rendered content, meta injected by JS, and JS-driven navigation are
    invisible to the audit;
  - browser-only metrics — LCP, CLS, TBT, resource timing waterfall, real
    viewport overflow — are reported as **Not available** instead of guesses.
- axe-core runs against the static DOM (rules that need real layout, such as
  color-contrast and target-size, are excluded) and in full inside the browser
  when available.
- Screenshots exist only for browser-mode audits.

## Crawling

- Only the **homepage origin** is crawled (same hostname). Off-origin
  redirects are recorded, not followed for content.
- Crawl is bounded per scan type (1 page quick / 10 standard / 50 deep,
  configurable). Sites bigger than the cap are sampled breadth-first from the
  homepage; the report records `pagesScanned` and the crawl policy used.
- `quick` audits analyze the homepage only and will not surface issues that
  live on sub-pages (e.g. a broken deep link). Use Standard/Deep for that.
- Dynamic URLs, hash-only navigation, infinite-scroll content and pages behind
  logins are not discoverable by a same-origin static crawler.
- robots.txt: the crawler honours robots rules per URL. If robots.txt blocks
  crawling, only the homepage (fetched like a regular visitor) is analyzed and
  the report says so. A missing/404 robots.txt is treated as allow per
  RFC 9309.
- Sitemap discovery is best-effort (robots `Sitemap:` lines, then
  `/sitemap.xml`); sitemap-only pages are not crawled unless linked.

## Measurement accuracy

- Image byte sizes are measured via HTTP fetches with size caps; very large
  assets are reported as exceeding the cap rather than fully downloaded.
- Text extraction (word counts, content volume) is a light HTML-to-text
  approximation; it can over-count code samples or under-count complex
  layouts.
- Link status checks use HTTP semantics (status code); a link that "works"
  only with client-side JS may be reported as broken in static mode.
- HTTP/2 push, service workers, and CDN-level behaviors are not analyzed in
  static mode.
- Redirect counting and TLS certificate inspection reflect what the engine's
  client observes with its own TLS stack; certificate-chain pinning details
  are not validated.
- Browser metrics, when available, come from a single cold headless run and
  are indicative, not a lab-grade RUM sample. Reported as measured values,
  never averaged from thin air.

## Concurrency & queue

- The job queue is **in-process** with bounded concurrency. There is no
  cross-instance queue: horizontal scaling of the API requires a shared queue
  (or running the API once). Restarting the API loses queued jobs unless they
  were already persisted (MongoDB-backed store).
- Rate limiting and progress polling are per-process.

## Storage

- Without MongoDB the file-backed store keeps the most recent 60 audit
  records in `<data-dir>/audits.json`. Concurrent API instances writing to the
  same file are not supported.
- Screenshots are stored on the local filesystem under the data directory.

## Scoring

- Scores are deterministic within the same mode and scan type but are **not
  comparable across scan types** (different crawl depth → different finding
  sets) or across rendering modes (browser finds things static mode cannot).
  See [scoring-methodology.md](scoring-methodology.md).
- Categories with no measurable checks score 100 by default; a real audit can
  therefore show a high score for a site where little was measurable.

## AI summaries

- The optional AI layer rephrases the deterministic summary only. Without
  `AI_API_KEY` no AI is used and the report says so. AI wording is
  non-deterministic by nature; scores and findings remain deterministic.

## PDF reports

- The PDF generator is intentionally lightweight (single built-in font). Very
  long issue lists may paginate over many pages; complex Unicode (e.g.
  CJK/emoji) may not render with the embedded font. JSON/CSV exports carry the
  complete data.

## Frontend

- Progress updates use polling with a fallback SSE endpoint available for
  integration; long-running deep scans on very large sites may take a while
  and show staged progress.
- The dashboard is optimized for modern evergreen browsers.

## Other

- Auditing requires the target to be reachable from the server's network. If
  the server has no outbound internet access (or the target blocks
  non-browser user agents), audits will fail with a clear message rather than
  fabricate a report.
- The demo/sample site is local-only and intended for sandbox development.
