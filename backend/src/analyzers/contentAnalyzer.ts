import type { AuditContext } from '../engine/context';
import { issue, metric, out, cleanText } from './helpers';
import type { AnalyzerOutput } from '../engine/context';

/**
 * Content analyzer — inspects the visible text of the page.
 * Uses contextual checks instead of arbitrary word-count rules.
 */
export async function analyzeContent(ctx: AuditContext): Promise<AnalyzerOutput> {
  const { $, finalUrl } = ctx.homepage;
  const issues: AnalyzerOutput['issues'] = [];
  const metrics: AnalyzerOutput['metrics'] = [];

  const visibleText = cleanText($);
  const textLen = visibleText.length;
  const wordCount = visibleText.split(/\s+/).filter(Boolean).length;

  // Very thin pages cannot serve a real purpose; keep the bar intentionally low.
  if (wordCount > 0 && wordCount < 100) {
    issues.push(
      issue('content', 'content', 'medium', 'Page contains very little visible content', 'Visitors and search engines judge a page by its content. A page with almost no text offers little value or context.', 'Expand the page with substantive content that answers what visitors came to find.', [{ type: 'text', value: `About ${wordCount} words of visible text detected.` }], 'Content volume'),
    );
  } else if (wordCount === 0) {
    issues.push(
      issue('content', 'content', 'high', 'No readable text content detected', 'If the page relies entirely on JavaScript to render text, our static parse could not read it — but visitors may see nothing if scripts fail.', 'Provide HTML text content (or ensure server-side rendering) for the primary content.', [{ type: 'text', value: 'Visible text length is 0 characters.' }], 'Content volume'),
    );
  }

  // ---------- Placeholder / demo content ------------------------------------
  const loremMatches = (visibleText.match(/\blorem ipsum\b/i) ?? []).length;
  if (loremMatches > 0) {
    issues.push(
      issue('content', 'content', 'high', 'Placeholder text detected ("Lorem ipsum")', 'Lorem ipsum placeholder text signals unfinished content to visitors and search engines.', 'Replace all placeholder copy with real content.', [{ type: 'text', value: `"Lorem ipsum" appears ${loremMatches} time${loremMatches > 1 ? 's' : ''}.` }], 'Placeholder content'),
    );
  }
  const demoMarkers = ['this is a sample page', 'sample website', 'example.com placeholder', 'coming soon', 'under construction', 'todo:', 'sitepulse demo', 'your content goes here', 'your website title'];
  const foundMarkers = demoMarkers.filter((m) => visibleText.toLowerCase().includes(m));
  if (foundMarkers.length > 0) {
    issues.push(
      issue('content', 'content', 'medium', 'Possible template/demo content detected', 'Template placeholder phrases can make the site look unfinished.', 'Replace template/demo phrases with final copy.', [{ type: 'text', value: foundMarkers.slice(0, 5).join('\n') }], 'Placeholder content'),
    );
  }

  // ---------- Headings sanity ----------------------------------------------
  const h1s: string[] = [];
  $('h1').each((_i, el) => {
    const t = $(el).text().replace(/\s+/g, ' ').trim();
    if (t && !h1s.includes(t)) h1s.push(t);
  });
  const h2s: string[] = [];
  $('h2').each((_i, el) => {
    const t = $(el).text().replace(/\s+/g, ' ').trim();
    if (t && !h2s.includes(t)) h2s.push(t);
  });
  if (h1s.length === 0) {
    issues.push(
      issue('content', 'content', 'medium', 'Content lacks a primary heading (H1)', 'A clear H1 tells visitors what the page is about within seconds.', 'Add one clear H1 at the top of the page.', [{ type: 'code', value: 'No H1 with text found.' }], 'Headings'),
    );
  } else {
    const all = h1s.map((h) => h.toLowerCase());
    const dup = all.filter((h, i) => all.indexOf(h) !== i);
    if (dup.length > 0) {
      issues.push(
        issue('content', 'content', 'low', 'Duplicate H1 heading text', 'Repeated identical headings add no information and waste a strong signal.', 'Use distinct headings for distinct sections.', [{ type: 'text', value: dup.slice(0, 4).join('\n') }], 'Headings'),
      );
    }
  }

  // ---------- Generic CTAs --------------------------------------------------
  const genericCtas = ['click here', 'submit', 'send', 'go', 'read more', 'learn more', 'get started today', 'buy now'];
  const ctaHits = genericCtas.filter((c) => new RegExp(`\\b${c.replace(/ /g, '\\s+')}\\b`, 'i').test(visibleText));
  if (ctaHits.length > 0) {
    issues.push(
      issue('content', 'content', 'low', 'Generic call-to-action wording detected', 'Vague CTAs ("Submit", "Learn more") give visitors no reason or expectation for acting.', 'Use specific, benefit-driven CTA text that says what happens next.', [{ type: 'text', value: ctaHits.slice(0, 6).join(', ') }], 'CTA copy'),
    );
  }

  // ---------- Contact info (contextual) -------------------------------------
  const bodyHtml = $.html('body') ?? '';
  const hasEmail = /[\w.+-]+@[\w-]+\.[\w.-]{2,}/.test(visibleText) || /mailto:/i.test(bodyHtml);
  const hasPhone = /(\+?\d[\d ()-]{7,}\d)/.test(visibleText) || /tel:/i.test(bodyHtml);
  const hasAddress = /(\b\d{1,5}\s+\w+(\s+\w+){1,4},\s*\w+)/.test(visibleText);
  if (!hasEmail && !hasPhone && !hasAddress) {
    issues.push(
      issue('content', 'content', 'low', 'No obvious contact information found', 'If visitors cannot quickly find a way to reach you, they may leave the site.', 'Add visible contact details (email, phone or address) or a clear contact page link — when applicable to the site.', [{ type: 'text', value: 'No email, phone number or postal address detected in the visible text.' }], 'Contact info'),
    );
  }

  // ---------- Empty sections ------------------------------------------------
  let emptySections = 0;
  $('section, article, [class*="section"]').each((_i, el) => {
    if (emptySections >= 10) return false;
    const $el = $(el);
    const text = $el.text().replace(/\s+/g, ' ').trim();
    if (text.length === 0 && $el.find('img,video,iframe,canvas').length === 0) emptySections += 1;
    return undefined;
  });
  if (emptySections >= 3) {
    issues.push(
      issue('content', 'content', 'low', `${emptySections} empty sections found`, 'Empty page sections can appear broken or unfinished.', 'Remove empty sections or fill them with content.', [{ type: 'code', value: `${emptySections} <section>/article elements contain no text or media.` }], 'Empty sections'),
    );
  }

  metrics.push(
    metric('content_words', 'Visible word count', wordCount, wordCount >= 100 ? 'good' : wordCount > 0 ? 'warn' : 'bad'),
    metric('content_text_len', 'Visible text length', `${textLen} characters`, 'neutral'),
    metric('content_h1', 'H1 headings', h1s.length || 0, h1s.length === 1 ? 'good' : h1s.length > 0 ? 'warn' : 'bad'),
    metric('content_contact', 'Contact info', hasEmail || hasPhone || hasAddress ? 'Present' : 'Not detected', hasEmail || hasPhone || hasAddress ? 'good' : 'warn'),
  );

  return out(issues, metrics, []);
}
