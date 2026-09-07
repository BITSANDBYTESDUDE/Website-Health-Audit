import type { AuditContext } from '../engine/context';
import { issue, metric, out, plural } from './helpers';
import type { AnalyzerOutput } from '../engine/context';

/**
 * Conversion / UX opportunity analyzer.
 *
 * These are observational, contextual recommendations about UX signals —
 * never predictions about conversion rates. Findings are labelled
 * "Potential improvement" and do not feed the weighted health score.
 */
export async function analyzeConversion(ctx: AuditContext): Promise<AnalyzerOutput> {
  const { homepage, homepageLinks } = ctx;
  const { $, finalUrl } = homepage;
  const issues: AnalyzerOutput['issues'] = [];
  const metrics: AnalyzerOutput['metrics'] = [];
  const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
  const visibleHrefs = homepageLinks;
  const bodyHtml = $.html('body') ?? '';

  const STRONG_CTA = /\b(get started|start free|start now|buy now|book now|book a|request a|request your|get a quote|get quote|sign up|subscribe|download|register|schedule|order now|try free|claim|join now|contact us|talk to|call now|order)\b/i;
  const SERVICE_PAGES = /\b(services|about|contact|pricing|portfolio|work|products)\b/i;

  // ---------- Primary CTA presence ------------------------------------------
  const topLinks: string[] = [];
  $('header a, nav a, .hero a, .header a, [class*="hero"] a, [class*="cta"] a, [class*="banner"] a').each((_i, el) => {
    const t = $(el).text().replace(/\s+/g, ' ').trim();
    if (t && topLinks.length < 20) topLinks.push(t);
  });
  const strongCta = topLinks.filter((t) => STRONG_CTA.test(t));
  if (strongCta.length === 0) {
    issues.push(
      issue('conversion', 'none', 'medium', 'Potential improvement: no strong primary call-to-action found in the header/hero area', 'Visitors who are ready to act need an obvious next step. Without a clear CTA, a site can lose enquiries regardless of its content quality.', 'Add one prominent, benefit-driven CTA button (e.g. "Book a free consultation") in the header or hero and repeat it near the end of the page.', [{ type: 'text', value: 'No strong action-oriented CTA text detected in header/hero/nav regions.' }], 'Call to action'),
    );
  } else {
    metrics.push(metric('conv_primary_cta', 'Primary CTA (header/hero)', strongCta[0], 'good'));
  }

  // ---------- Contact route -------------------------------------------------
  const hasContactPage = [...visibleHrefs].some((l) => /\/contact\/?$|\/contact-us\/?$|contact|impressum|about/i.test(l.url));
  const hasMailtoOrTel = /mailto:/i.test(bodyHtml) || /tel:/i.test(bodyHtml);
  const hasEmailText = /[\w.+-]+@[\w-]+\.[\w.-]{2,}/.test(bodyText);
  if (!hasContactPage && !hasMailtoOrTel && !hasEmailText) {
    issues.push(
      issue('conversion', 'none', 'medium', 'Potential improvement: no obvious way for visitors to contact the site owner', 'If a visitor cannot find email, phone or a contact page within a couple of clicks, they often leave instead of enquiring.', 'Add a visible contact page link, email address or phone number in the header and footer.', [{ type: 'text', value: 'No contact page link, mailto:, tel: or email address detected.' }], 'Contact route'),
    );
  }

  // ---------- Trust signals -------------------------------------------------
  const trustWords = /\b(trusted by|testimonial|review|rating|★|clients? (include|logo)|as featured|award|since 20\d\d|accredited|certified|years of experience|satisfied customers?|customers? love|case stud)/i;
  const hasTrust = trustWords.test(bodyText) || /testimonials?|reviews?/i.test(bodyHtml);
  if (!hasTrust) {
    issues.push(
      issue('conversion', 'none', 'low', 'Potential improvement: no obvious trust signals detected', 'Testimonials, client logos, ratings or certifications reduce perceived risk at the moment of decision.', 'Add testimonials, client logos, review excerpts or trust badges — only if they are genuine.', [{ type: 'text', value: 'No trust-signal phrases (testimonials, reviews, ratings, awards) found.' }], 'Trust signals'),
    );
  }

  // ---------- Forms ---------------------------------------------------------
  let forms = 0;
  let fields = 0;
  let hasSubmit = 0;
  $('form').each((_i, el) => {
    forms += 1;
    const f = $(el);
    fields += f.find('input:not([type="hidden"]), select, textarea').length;
    if (/(type="submit")|button/i.test(f.html() ?? '')) hasSubmit += 1;
  });
  if (forms > 0) {
    if (fields > 6) {
      issues.push(
        issue('conversion', 'none', 'low', 'Potential improvement: form contains many fields', 'Long forms create friction; every extra field reduces the chance the form is completed.', 'Only ask for essential fields and consider splitting long forms into steps.', [{ type: 'text', value: `Largest form contains up to ${fields} fields (${forms} form(s) total).` }], 'Forms'),
      );
    }
    if (hasSubmit === 0) {
      issues.push(
        issue('conversion', 'none', 'medium', 'Potential improvement: form has no visible submit button', 'A form that cannot be submitted (or has no labelled submit) blocks the main conversion path.', 'Add a clearly labelled submit button to every form.', [{ type: 'text', value: `${forms} form(s) with no <button type="submit"> or <input type="submit">.` }], 'Forms'),
      );
    }
  }

  // ---------- Navigation complexity ------------------------------------------
  const navLinks = $('nav a').length;
  if (navLinks > 9) {
    issues.push(
      issue('conversion', 'none', 'low', 'Potential improvement: top navigation is long', 'Overloaded navigation can bury the most important destinations and overwhelm mobile users.', 'Prioritise 5–7 key destinations in the main navigation and move the rest into the footer.', [{ type: 'text', value: `${navLinks} links in the main navigation.` }], 'Navigation'),
    );
  }

  // ---------- Social proof / depth ------------------------------------------
  if (!SERVICE_PAGES.test(bodyText) && bodyText.length > 2000) {
    issues.push(
      issue('conversion', 'none', 'low', 'Potential improvement: value proposition may be hard to locate', 'Long pages without clear section headings make it harder for scanning visitors to understand what you offer.', 'Structure the page with benefit-led headings and repeat the core offer and CTA.', [{ type: 'text', value: 'No obvious services/about/contact keywords found in the body copy.' }], 'Messaging'),
    );
  }

  metrics.push(
    metric('conv_forms', 'Forms detected', forms, 'neutral'),
    metric('conv_contact', 'Contact route', hasContactPage || hasMailtoOrTel || hasEmailText ? 'Present' : 'Not detected', hasContactPage || hasMailtoOrTel || hasEmailText ? 'good' : 'warn'),
    metric('conv_trust', 'Trust signals', hasTrust ? 'Present' : 'Not detected', hasTrust ? 'good' : 'neutral'),
  );
  void plural;
  return out(
    issues,
    metrics,
    ['Conversion items are observational UX recommendations ("potential improvements"), not conversion-rate predictions, and are excluded from the overall health score.'],
  );
}
