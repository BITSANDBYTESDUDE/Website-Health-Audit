import type { CheerioAPI } from 'cheerio';
import type { Element } from 'domhandler';
import type { AxeViolation } from '../engine/context';

/**
 * Deterministic structural accessibility checks that always run, even when no
 * rendering engine (real browser or jsdom+axe) is available. These mirror a
 * small, high-value subset of axe-core rules. They are labelled "structural"
 * and never claim visual/WCAG coverage.
 */

const LABELLABLE = ['input', 'textarea', 'select'];

function snippet($: CheerioAPI, node: Element): string {
  try {
    return ($('<span>').append($(node).clone()).html() ?? '').slice(0, 300);
  } catch {
    return '';
  }
}

export function structuralA11yChecks($: CheerioAPI): AxeViolation[] {
  const violations: AxeViolation[] = [];

  // --- html-has-lang -------------------------------------------------------
  const html = $('html').first();
  const lang = html.attr('lang');
  if (html.length && (!lang || lang.trim() === '')) {
    violations.push({
      id: 'html-has-lang',
      impact: 'serious',
      description: 'Ensures every HTML document has a lang attribute',
      help: '<html> element must have a lang attribute',
      helpUrl: 'https://dequeuniversity.com/rules/axe/4.9/html-has-lang',
      nodes: [{ target: 'html', html: snippet($, html.get(0) as Element), summary: 'The <html> element does not have a lang attribute.' }],
    });
  }

  // --- image-alt ------------------------------------------------------------
  const imgNodes: { target: string; html: string; summary: string }[] = [];
  $('img').each((i, el) => {
    if (i >= 60) return;
    const $el = $(el);
    const alt = $el.attr('alt');
    const role = ($el.attr('role') ?? '').trim();
    const aria = ($el.attr('aria-label') ?? $el.attr('aria-labelledby') ?? '').trim();
    if (alt === undefined && !aria && role !== 'presentation' && role !== 'none') {
      imgNodes.push({
        target: `img[${i + 1}]`,
        html: snippet($, el),
        summary: 'Image is missing an alt attribute.',
      });
    }
  });
  if (imgNodes.length) {
    violations.push({
      id: 'image-alt',
      impact: 'serious',
      description: 'Ensures <img> elements have alternate text or a role of none or presentation',
      help: 'Images must have alternate text',
      helpUrl: 'https://dequeuniversity.com/rules/axe/4.9/image-alt',
      nodes: imgNodes.slice(0, 12),
    });
  }

  // --- label ----------------------------------------------------------------
  const labelNodes: { target: string; html: string; summary: string }[] = [];
  $('input,textarea,select').each((i, el) => {
    if (i >= 40) return;
    const $el = $(el);
    const type = ($el.attr('type') ?? 'text').toLowerCase();
    if (type === 'hidden' || type === 'submit' || type === 'button' || type === 'image' || type === 'reset') return;
    const id = $el.attr('id');
    const byFor = id ? $(`label[for="${cssEscape(id)}"]`).length > 0 : false;
    const wrapping = $el.closest('label').length > 0;
    const aria = !!($el.attr('aria-label') || $el.attr('aria-labelledby'));
    const title = !!$el.attr('title');
    const placeholder = $el.attr('placeholder');
    if (!byFor && !wrapping && !aria && !title) {
      labelNodes.push({
        target: `${el.tagName}${id ? `#${id}` : ''}`,
        html: snippet($, el),
        summary: placeholder
          ? 'Form element relies on a placeholder for its label; placeholders are not reliable accessible labels.'
          : 'Form element has no accessible label.',
      });
    }
  });
  if (labelNodes.length) {
    violations.push({
      id: 'label',
      impact: 'critical',
      description: 'Ensures every form element has a label',
      help: 'Form elements must have labels',
      helpUrl: 'https://dequeuniversity.com/rules/axe/4.9/label',
      nodes: labelNodes.slice(0, 12),
    });
  }

  // --- button-name / link-name ----------------------------------------------
  const buttonNodes: { target: string; html: string; summary: string }[] = [];
  $('button').each((i, el) => {
    if (i >= 30) return;
    const $el = $(el);
    const text = $el.clone().find('img').each((_j, img) => {
      const a = $(img).attr('alt') ?? '';
      $(img).replaceWith(a);
    }).end().text().trim();
    if (!text && !$el.attr('aria-label') && !$el.attr('aria-labelledby') && !$el.attr('title')) {
      buttonNodes.push({ target: '', html: snippet($, el), summary: 'Button has no accessible name.' });
    }
  });
  if (buttonNodes.length) {
    violations.push({
      id: 'button-name',
      impact: 'critical',
      description: 'Ensures buttons have discernible text',
      help: 'Buttons must have discernible text',
      helpUrl: 'https://dequeuniversity.com/rules/axe/4.9/button-name',
      nodes: buttonNodes.slice(0, 12),
    });
  }

  const linkNodes: { target: string; html: string; summary: string }[] = [];
  $('a[href]').each((i, el) => {
    if (i >= 40) return;
    const $el = $(el);
    const href = ($el.attr('href') ?? '').trim();
    if (href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
    const text = $el.text().trim();
    if (!text && !$el.attr('aria-label') && !$el.attr('aria-labelledby') && !$el.attr('title') && $el.find('img').length === 0) {
      linkNodes.push({ target: '', html: snippet($, el), summary: 'Link has no accessible name.' });
    }
  });
  if (linkNodes.length) {
    violations.push({
      id: 'link-name',
      impact: 'serious',
      description: 'Ensures links have discernible text',
      help: 'Links must have discernible text',
      helpUrl: 'https://dequeuniversity.com/rules/axe/4.9/link-name',
      nodes: linkNodes.slice(0, 12),
    });
  }

  // --- duplicate-id ----------------------------------------------------------
  const ids = new Map<string, number>();
  $('[id]').each((_i, el) => {
    const id = $(el).attr('id') ?? '';
    if (!id) return;
    ids.set(id, (ids.get(id) ?? 0) + 1);
  });
  const dupNodes: { target: string; html: string; summary: string }[] = [];
  for (const [id, count] of ids) {
    if (count > 1) {
      dupNodes.push({ target: `#${id}`, html: `<div id="${id}">…</div>`, summary: `Document contains multiple elements with the id "${id}" (${count} occurrences).` });
      if (dupNodes.length >= 10) break;
    }
  }
  if (dupNodes.length) {
    violations.push({
      id: 'duplicate-id',
      impact: 'minor',
      description: 'Ensures every id attribute value is unique',
      help: 'IDs used in ARIA and labels must be unique',
      helpUrl: 'https://dequeuniversity.com/rules/axe/4.9/duplicate-id',
      nodes: dupNodes,
    });
  }

  // --- iframe-title ----------------------------------------------------------
  const iframeNodes: { target: string; html: string; summary: string }[] = [];
  $('iframe').each((_i, el) => {
    const $el = $(el);
    if (!$el.attr('title') && !$el.attr('aria-label')) {
      iframeNodes.push({ target: '', html: snippet($, el), summary: 'Inline frame has no title attribute.' });
    }
  });
  if (iframeNodes.length) {
    violations.push({
      id: 'frame-title',
      impact: 'serious',
      description: 'Ensures <iframe> elements have a title attribute',
      help: 'Frames must have a unique title attribute',
      helpUrl: 'https://dequeuniversity.com/rules/axe/4.9/frame-title',
      nodes: iframeNodes.slice(0, 12),
    });
  }

  // --- heading-order ----------------------------------------------------------
  const levels: number[] = [];
  const els = $('h1,h2,h3,h4,h5,h6').toArray();
  for (const el of els) levels.push(Number(el.tagName[1]));
  const headingNodes: { target: string; html: string; summary: string }[] = [];
  let maxLevel = 0;
  for (let i = 0; i < levels.length; i += 1) {
    const lvl = levels[i];
    if (lvl > maxLevel + 1 && headingNodes.length < 4) {
      const text = $(els[i]).text().replace(/\s+/g, ' ').trim().slice(0, 60);
      headingNodes.push({
        target: `h${lvl}`,
        html: text ? `<h${lvl}>${text}</h${lvl}>` : `<h${lvl}>`,
        summary: `Heading level increases by more than one (to h${lvl}).`,
      });
    }
    maxLevel = Math.max(maxLevel, lvl);
  }
  if (headingNodes.length) {
    violations.push({
      id: 'heading-order',
      impact: 'moderate',
      description: 'Ensures the order of headings is semantically correct',
      help: 'Heading levels should only increase by one',
      helpUrl: 'https://dequeuniversity.com/rules/axe/4.9/heading-order',
      nodes: headingNodes,
    });
  }

  return violations;
}

function cssEscape(sel: string): string {
  return sel.replace(/["\\]/g, '\\$&');
}
