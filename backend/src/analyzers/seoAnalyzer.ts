import type { AuditContext } from '../engine/context';
import { issue, metric, out, cleanText, plural, formatBytes } from './helpers';
import type { AnalyzerOutput } from '../engine/context';
import type { EvidenceItem } from '../types';

/**
 * SEO analyzer — inspects the actual markup of the homepage and, when a
 * crawl ran, the metadata of the discovered internal pages.
 */
export async function analyzeSeo(ctx: AuditContext): Promise<AnalyzerOutput> {
  const { $, finalUrl } = ctx.homepage;
  const issues: AnalyzerOutput['issues'] = [];
  const metrics: AnalyzerOutput['metrics'] = [];
  const notes: string[] = [];
  const ev = (type: EvidenceItem['type'], value: string): EvidenceItem[] => [{ type, value: value.slice(0, 600) }];

  const title = ($('head title').first().text() ?? '').replace(/\s+/g, ' ').trim();
  const desc = ($('meta[name="description"]').first().attr('content') ?? '').trim();
  const robotsContent = ($('meta[name="robots"], meta[name="googlebot"]').first().attr('content') ?? '').toLowerCase();
  const canonical = $('link[rel="canonical"]').first().attr('href') ?? '';
  const h1Count = $('h1').length;
  const h2Count = $('h2').length;
  const h3Count = $('h3').length;
  const ogTitle = $('meta[property="og:title"]').attr('content') ?? '';
  const ogDesc = $('meta[property="og:description"]').attr('content') ?? '';
  const ogImage = $('meta[property="og:image"]').attr('content') ?? '';
  const ogUrl = $('meta[property="og:url"]').attr('content') ?? '';
  const twitterCard = $('meta[name="twitter:card"]').attr('content') ?? '';
  const twitterTitle = $('meta[name="twitter:title"]').attr('content') ?? '';

  // ---------- Title ---------------------------------------------------------
  if (!title) {
    issues.push(
      issue('seo', 'seo', 'high', 'Missing page title', 'Search engines and browser tabs rely on the <title> to understand and display the page. Without one the page has no clear snippet heading.', 'Add a unique, descriptive <title> of roughly 50–60 characters that includes your primary keyword and brand.', ev('code', '<head> contains no <title> element.'), 'Title'),
    );
  } else {
    const len = title.length;
    if (len > 65) {
      issues.push(
        issue('seo', 'seo', 'low', `Title may be truncated (${len} characters)`, 'Search result snippets typically cut off titles around 60 characters, so the end of the title can be lost.', `Shorten the title to ~50–60 characters. Current length: ${len}.`, ev('text', `"${title}"`), 'Title'),
      );
    } else if (len < 15) {
      issues.push(
        issue('seo', 'seo', 'low', `Title is very short (${len} characters)`, 'Very short titles miss an opportunity to describe the page and rank for relevant terms.', 'Expand the title with a descriptive phrase.', ev('text', `"${title}"`), 'Title'),
      );
    }
  }

  // ---------- Meta description ---------------------------------------------
  if (!desc) {
    issues.push(
      issue('seo', 'seo', 'high', 'Missing meta description', 'Search engines may use arbitrary page text as the search snippet when no meta description exists, producing less compelling results.', 'Write a unique, relevant meta description of 120–160 characters summarising the page value.', ev('code', '<meta name="description"> not found in <head>.'), 'Meta description'),
    );
  } else {
    const len = desc.length;
    if (len < 50) {
      issues.push(
        issue('seo', 'seo', 'low', `Meta description is short (${len} characters)`, 'Short descriptions may not fully describe the page and can be replaced by auto-generated snippets.', 'Expand the meta description to roughly 120–160 characters.', ev('text', `"${desc}"`), 'Meta description'),
      );
    } else if (len > 170) {
      issues.push(
        issue('seo', 'seo', 'low', `Meta description may be truncated (${len} characters)`, 'Search snippets usually display about 155–160 characters.', 'Shorten the meta description to roughly 120–160 characters.', ev('text', `"${desc}"`), 'Meta description'),
      );
    }
  }

  // ---------- Headings ------------------------------------------------------
  if (h1Count === 0) {
    issues.push(
      issue('seo', 'seo', 'high', 'No H1 heading found', 'The H1 is the primary on-page heading that summarises the topic of the page for users and search engines.', 'Add exactly one descriptive H1 that reflects the page purpose.', ev('code', 'No <h1> element exists in the page.'), 'Headings'),
    );
  } else if (h1Count > 1) {
    const h1s: string[] = [];
    $('h1').each((_i, el) => {
      const t = $(el).text().replace(/\s+/g, ' ').trim();
      if (t && h1s.length < 5) h1s.push(t);
    });
    issues.push(
      issue('seo', 'seo', 'medium', `${h1Count} H1 headings found (recommended: one)`, 'Multiple H1s dilute the primary topic signal of the page.', 'Keep a single H1 and use H2/H3 for the remaining headings.', ev('text', h1s.map((t) => `H1: "${t}"`).join('\n') || h1Count.toString()), 'Headings'),
    );
  }
  if (h2Count === 0 && cleanText($).length > 600) {
    issues.push(
      issue('seo', 'seo', 'medium', 'No H2 subheadings found', 'Subheadings structure long content and make it easier to scan for readers and search engines.', 'Split content into logical sections and add descriptive H2 headings.', ev('code', 'No <h2> element exists in the page body.'), 'Headings'),
    );
  }
  if (h2Count === 0 && h3Count > 0) {
    issues.push(
      issue('seo', 'seo', 'low', 'Heading hierarchy skips a level (H1 → H3)', 'Skipped heading levels make document structure harder to parse.', 'Use H2 before H3 so the heading outline is logical.', ev('code', `H1:${h1Count} H2:${h2Count} H3:${h3Count}`), 'Headings'),
    );
  }

  // ---------- Canonical -----------------------------------------------------
  if (!canonical) {
    issues.push(
      issue('seo', 'seo', 'medium', 'Missing canonical URL', 'Without a canonical tag, duplicate versions of a page (www vs non-www, http vs https, tracking parameters) can split ranking signals.', 'Add <link rel="canonical"> pointing to the preferred version of each page.', ev('code', '<link rel="canonical"> not found.'), 'Canonical'),
    );
  } else {
    try {
      const canonUrl = new URL(canonical, finalUrl);
      const final = new URL(finalUrl);
      if (canonUrl.hostname.replace(/^www\./, '') !== final.hostname.replace(/^www\./, '') || canonUrl.pathname !== final.pathname) {
        issues.push(
          issue('seo', 'seo', 'low', 'Canonical URL differs from the current page URL', 'A canonical pointing at a different URL than the current page can confuse indexing.', 'Ensure the canonical points to the exact preferred URL of this page.', ev('text', `Canonical: ${canonUrl.toString()}\nCurrent URL: ${finalUrl}`), 'Canonical'),
        );
      }
    } catch {
      issues.push(
        issue('seo', 'seo', 'medium', 'Invalid canonical URL', 'A malformed canonical cannot guide search engines.', 'Fix the canonical URL syntax.', ev('text', canonical), 'Canonical'),
      );
    }
  }

  // ---------- Indexability --------------------------------------------------
  if (robotsContent.includes('noindex')) {
    issues.push(
      issue('seo', 'seo', 'high', 'Homepage is set to noindex', 'If this page should appear in search results, a noindex directive prevents search engines from indexing it.', 'Remove noindex from the robots meta tag, or keep it if the page is intentionally excluded.', ev('text', `<meta name="robots" content="${robotsContent}">`), 'Indexability'),
    );
  }
  const ogCanonicalDiffers = ogUrl && canonical && (() => {
    try {
      return new URL(ogUrl).toString().replace(/\/$/, '') !== new URL(canonical, finalUrl).toString().replace(/\/$/, '');
    } catch {
      return false;
    }
  })();
  if (ogCanonicalDiffers) {
    issues.push(
      issue('seo', 'seo', 'low', 'og:url does not match the canonical URL', 'Inconsistent URL declarations confuse crawlers and social previews.', 'Point og:url at the same canonical URL.', ev('text', `og:url: ${ogUrl}\ncanonical: ${canonical}`), 'Open Graph'),
    );
  }

  // ---------- Structured data ----------------------------------------------
  let ldCount = 0;
  let ldErrors = 0;
  $('script[type="application/ld+json"]').each((_i, el) => {
    const raw = $(el).contents().text();
    if (!raw.trim()) return;
    ldCount += 1;
    try {
      JSON.parse(raw);
    } catch {
      ldErrors += 1;
    }
  });
  if (ldCount === 0) {
    issues.push(
      issue('seo', 'seo', 'low', 'No structured data (JSON-LD) found', 'Structured data helps search engines understand the page and can enable rich results such as breadcrumbs and reviews.', 'Add JSON-LD structured data relevant to the site type (e.g. Organization, WebSite, LocalBusiness).', ev('code', 'No <script type="application/ld+json"> found.'), 'Structured data'),
    );
  } else if (ldErrors > 0) {
    issues.push(
      issue('seo', 'seo', 'medium', `${ldErrors} JSON-LD block${ldErrors > 1 ? 's' : ''} failed to parse`, 'Invalid structured data is ignored by search engines.', 'Fix the JSON syntax of the structured data blocks.', ev('code', `${ldErrors} of ${ldCount} application/ld+json blocks contain invalid JSON.`), 'Structured data'),
    );
  }

  // ---------- Social / Open Graph ------------------------------------------
  const missingOg: string[] = [];
  if (!ogTitle) missingOg.push('og:title');
  if (!ogDesc) missingOg.push('og:description');
  if (!ogImage) missingOg.push('og:image');
  if (missingOg.length === 3) {
    issues.push(
      issue('seo', 'seo', 'medium', 'Open Graph tags missing', 'Without Open Graph tags, shared links show an unpolished, unpredictable preview on social media and chat apps.', 'Add og:title, og:description and og:image tags with a high-quality image.', ev('code', 'Missing: og:title, og:description, og:image'), 'Open Graph'),
    );
  } else if (missingOg.length > 0) {
    issues.push(
      issue('seo', 'seo', 'low', `Open Graph tags incomplete (missing ${missingOg.join(', ')})`, 'Partial Open Graph data produces lower-quality social previews.', `Add the missing tag${missingOg.length > 1 ? 's' : ''}.`, ev('text', missingOg.join('\n')), 'Open Graph'),
    );
  }
  if (!twitterCard && !twitterTitle) {
    issues.push(
      issue('seo', 'seo', 'low', 'Twitter/X card metadata missing', 'Twitter/X uses its own card tags when present; otherwise it falls back to Open Graph.', 'Add twitter:card and twitter:title (or rely on Open Graph with twitter:card set to summary_large_image).', ev('code', 'No twitter:card meta tag found.'), 'Twitter/X'),
    );
  }

  // ---------- Crawl-wide checks --------------------------------------------
  const pageDocs = [...ctx.pageDocs.values()];
  const dupTitles = groupDuplicates(pageDocs.map((p) => ({ key: p.url, value: p.title ?? '' }))).filter((d) => d.value);
  if (dupTitles.length) {
    issues.push(
      issue('seo', 'seo', 'medium', `${dupTitles.reduce((a, b) => a + b.count, 0)} pages share duplicate title${dupTitles.reduce((a, b) => a + b.count, 0) > 1 ? 's' : ''}`, 'Duplicate titles across pages weaken the relevance signal of each page in search results.', 'Give every page a unique title describing its specific content.', ev('url', dupTitles.slice(0, 5).map((d) => `${d.value} (${d.count}×)`).join('\n')), 'Duplicate titles'),
    );
  }
  const noDescPages = pageDocs.filter((p) => !p.metaDescription && p.url !== ctx.homepage.finalUrl);
  if (noDescPages.length > 0 && ctx.limits.maxPages > 1) {
    issues.push(
      issue('seo', 'seo', 'medium', `${plural(noDescPages.length, 'internal page')} missing meta descriptions`, 'Pages without meta descriptions rely on search engines to invent their snippets.', 'Add unique meta descriptions to every page.', ev('url', noDescPages.slice(0, 6).map((p) => p.url).join('\n')), 'Meta description'),
    );
  }
  const canonByPage = pageDocs.filter((p) => p.canonical && p.url.replace(/\/$/, '') !== p.canonical.replace(/\/$/, ''));
  if (canonByPage.length > 0) {
    issues.push(
      issue('seo', 'seo', 'medium', `${plural(canonByPage.length, 'page')} use canonical URLs that differ from their own URL`, 'Canonicals that point at other URLs tell search engines the page is a duplicate of something else.', 'Point each page canonical at its own preferred URL.', ev('url', canonByPage.slice(0, 6).map((p) => `${p.url}\n  → ${p.canonical}`).join('\n')), 'Canonical'),
    );
  }

  // ---------- Links & URL structure ----------------------------------------
  const internalLinks = ctx.homepageLinks.filter((l) => l.to === 'internal');
  const externalLinks = ctx.homepageLinks.filter((l) => l.to === 'external');
  if (internalLinks.length === 0) {
    issues.push(
      issue('seo', 'seo', 'medium', 'No internal links found on the homepage', 'Internal links distribute authority and help visitors and crawlers discover the rest of the site.', 'Add descriptive internal links to your key pages.', ev('code', 'No internal <a href> links detected in the page.'), 'Internal links'),
    );
  }
  const generic = ctx.homepageLinks.filter((l) => /^(click here|read more|learn more|more|here|this|link|website|details|see more|find out more|more info)$/i.test(l.text.trim()) && l.text.trim().length < 40);
  if (generic.length > 0) {
    issues.push(
      issue('seo', 'seo', generic.length >= 3 ? 'medium' : 'low', `${plural(generic.length, 'link')} use non-descriptive anchor text`, 'Vague anchor text ("click here") gives users and search engines no information about the destination.', 'Use descriptive anchor text that describes the target page.', ev('text', generic.slice(0, 8).map((l) => `"${l.text}" → ${l.url}`).join('\n')), 'Anchor text'),
    );
  }

  const pathname = new URL(finalUrl).pathname;
  if (/[A-Z]/.test(pathname)) {
    issues.push(
      issue('seo', 'seo', 'low', 'URL contains uppercase characters', 'Mixed-case URLs are treated case-sensitively by some servers and can create duplicate pages.', 'Use lowercase URLs.', ev('text', pathname), 'URL structure'),
    );
  }
  if (/_/.test(pathname)) {
    issues.push(
      issue('seo', 'seo', 'low', 'URL contains underscores', 'Hyphens are the preferred word separator for URLs.', 'Replace underscores with hyphens.', ev('text', pathname), 'URL structure'),
    );
  }

  // ---------- Metrics -------------------------------------------------------
  metrics.push(
    metric('seo_title_length', 'Title length', title ? `${title.length} characters` : null, title && title.length <= 65 && title.length >= 15 ? 'good' : 'neutral', 'chars'),
    metric('seo_title', 'Title', title || null, title ? 'good' : 'bad'),
    metric('seo_description', 'Meta description', desc || null, desc ? 'good' : 'bad'),
    metric('seo_h1', 'H1 count', h1Count, h1Count === 1 ? 'good' : h1Count === 0 ? 'bad' : 'warn'),
    metric('seo_h2', 'H2 count', h2Count, h2Count > 0 ? 'good' : 'warn'),
    metric('seo_canonical', 'Canonical URL', canonical || null, canonical ? 'good' : 'warn'),
    metric('seo_og', 'Open Graph', ogTitle && ogDesc && ogImage ? 'Complete' : missingOg.length === 3 ? 'Missing' : 'Partial', ogTitle && ogDesc && ogImage ? 'good' : 'warn'),
    metric('seo_structured_data', 'JSON-LD blocks', ldCount, ldCount > 0 && ldErrors === 0 ? 'good' : ldCount > 0 ? 'warn' : 'neutral'),
    metric('seo_internal_links', 'Internal links (homepage)', internalLinks.length, 'neutral'),
    metric('seo_external_links', 'External links (homepage)', externalLinks.length, 'neutral'),
    metric('seo_pages', 'Pages crawled for SEO comparison', pageDocs.length + 1, 'neutral'),
  );

  notes.push(
    'SEO findings are based on the actual markup returned by the website; no keyword or ranking promises are made.',
    `robots.txt ${ctx.robots ? (ctx.robots.allowsCrawl ? 'allows crawling' : 'restricts crawling') : 'could not be fetched'}.`,
  );

  void formatBytes;
  return out(issues, metrics, notes);
}

function groupDuplicates(items: { key: string; value: string }[]): { value: string; count: number }[] {
  const groups = new Map<string, string[]>();
  for (const it of items) {
    if (!it.value) continue;
    const key = it.value.toLowerCase();
    const arr = groups.get(key) ?? [];
    arr.push(it.key);
    groups.set(key, arr);
  }
  const res: { value: string; count: number }[] = [];
  for (const [, keys] of groups) {
    if (keys.length > 1) res.push({ value: items.find((x) => x.key === keys[0])?.value ?? '', count: keys.length });
  }
  return res;
}
