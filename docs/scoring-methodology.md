# Scoring methodology

SitePulse scoring is **deterministic, transparent, and reproducible**. Every
number on the dashboard can be derived from the underlying finding list by the
rules below — the engine simply applies the same arithmetic on every run.

## 1. Findings (issues)

An audit collects structured findings, each carrying:

- a **section** — one of the ten report areas: Performance, SEO, Mobile,
  Accessibility, Security, Technical, Content, Images, Links, Conversion;
- a **bucket** — which weighted category it penalises (`performance`, `seo`,
  `mobile`, `accessibility`, `security`, `technical`, `content`) or `none`
  for pure recommendations (conversion findings use `none`);
- a **severity** — `passed` | `low` | `medium` | `high` | `critical`;
- a **code** — stable and unique (`SEO-01`, `SEC-01`, …). Codes are assigned
  in a fixed analyzer order, so the same site always yields the same codes;
- **evidence**, an explanation, and a recommended fix.

`passed` entries are the checks that succeeded; they never reduce scores but
are shown so a report reflects the full check list.

## 2. Severity penalties

Each category starts at **100** and subtracts fixed penalties per finding in
that category (buckets are independent):

| Severity | Penalty |
| --- | --- |
| critical | 30 |
| high | 15 |
| medium | 7 |
| low | 2 |
| passed | 0 |

Category score = `clamp(100 − Σ penalties, 0, 100)`.

Example: a category with 1 high + 2 medium findings scores
`100 − 15 − 7 − 7 = 71`.

## 3. Category weights (overall score)

The overall score is the **weighted average** of the seven weighted
categories. Categories with no measurable checks still count at 100 (e.g. a
quick scan that found no performance findings), so a weak signal never drags a
score down by guesswork.

| Bucket | Weight |
| --- | --- |
| Performance | 25% |
| SEO | 20% |
| Mobile | 15% |
| Accessibility | 15% |
| Security | 10% |
| Technical | 10% |
| Content | 5% |

Overall = `round(Σ category_score × weight / Σ weights)`.

The **Images** section findings are bucketed into Performance/Technical where
they belong; **Links** findings into Technical; **Conversion** is advisory
only (`none` bucket — recommendations do not reduce the score).

## 4. Grade bands

| Score | Grade |
| --- | --- |
| 90–100 | Excellent |
| 80–89 | Good |
| 70–79 | Fair |
| 60–69 | Needs improvement |
| 0–59 | Poor |

## 5. Reproducibility guarantees

- Scoring uses only deterministic inputs: analyzer results and the public
  penalty/weight tables above.
- Identical targets with identical settings reproduce identical overall
  scores, category scores, issue lists (same codes), and summaries. The test
  suite asserts this with back-to-back re-scans.
- Scan type matters: `quick` audits the homepage only; `standard` crawls up to
  10 pages/depth 2; `deep` up to 50 pages/depth 3. Findings from deeper crawls
  (e.g. broken internal pages) only appear when those pages were actually
  fetched — scores between scan types are therefore **not directly
  comparable**.
- Rendering mode matters and is disclosed per audit (`mode: "browser"` vs
  `"static"`). Browser-only metrics (LCP/CLS/TBT) are reported as
  *Not available* in static mode rather than being invented; scores are
  computed only from what was honestly measured.

## 6. Where the measurements come from

- **HTTP layer**: status codes, redirect chains, headers, TLS certificate
  presence, transfer sizes (compressed + decompressed), response times,
  content types, compression, cache headers.
- **DOM layer (static)**: parsed HTML — titles, metas, Open Graph, headings,
  viewport, canonical, structured data, links, images, forms, text content.
  Structural accessibility checks run against the same DOM.
- **Browser layer (optional)**: Playwright-driven desktop + mobile viewport
  loads for performance entries (requests, transfer, LCP/CLS/TBT where
  measurable), overflow checks, real axe-core runs, and a homepage screenshot.
- **Crawler**: bounded same-origin walk honouring robots.txt, sitemap hints,
  per-URL fetch status (broken/redirected/blocked pages), page titles and
  sizes.

## 7. Example

A site whose standard scan finds nothing but a missing meta description
(SEO low) and missing HSTS (Security medium) scores:

- SEO 98 · Security 93 · all other categories 100
- Overall = 98×0.20 + 100×0.15 + 100×0.15 + 93×0.10 + 100×0.10 + 100×0.05 +
  100×0.25 = **99**

All exports (PDF, JSON, CSV) embed these numbers together with the findings,
so any score can be audited by a human.

## 8. Summary text

The executive summary (headline, strengths, opportunities) is assembled
deterministically from the grade band and the highest-impact findings. If an
`AI_API_KEY` is configured, the AI may rephrase that wording only — it never
produces or alters factual measurements, scores, or metrics.
