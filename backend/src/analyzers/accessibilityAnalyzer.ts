import type { AuditContext } from '../engine/context';
import { issue, metric, out, plural } from './helpers';
import type { AnalyzerOutput } from '../engine/context';
import { structuralA11yChecks } from '../a11y/staticChecks';
import { runAxeStatic } from '../a11y/axeStatic';
import type { AxeViolation } from '../engine/context';

/**
 * Accessibility analyzer.
 *
 * Aggregates axe-core findings (from the real rendered page when a browser
 * is available, otherwise from a jsdom/structural pass) plus deterministic
 * structural checks. Visual rules (color contrast etc.) are only claimed
 * when a real browser measured them.
 */
export async function analyzeAccessibility(ctx: AuditContext): Promise<AnalyzerOutput> {
  const { homepage } = ctx;
  const issues: AnalyzerOutput['issues'] = [];
  const metrics: AnalyzerOutput['metrics'] = [];
  const notes: string[] = [
    'Automated accessibility audit — manual testing may identify additional issues.',
  ];

  // Gather violations: browser axe (already in ctx) + structural (always run).
  const structural = structuralA11yChecks(homepage.$);
  let axeList: AxeViolation[] = ctx.axeViolations;
  if (ctx.mode === 'static') {
    const axeStatic = await runAxeStatic(homepage.html, homepage.finalUrl);
    if (axeStatic.length > 0) axeList = axeStatic;
    if (axeList.length === 0 && structural.length === 0) {
      notes.push('axe-core could not run in this environment; only lightweight structural checks were applied.');
    } else if (axeStatic.length > 0) {
      notes.push('axe-core rules ran against the page DOM (visual rules such as colour contrast require a real browser and were excluded).');
    }
  } else {
    notes.push('axe-core ran inside the rendered page.');
  }

  const existingIds = new Set(axeList.map((v) => v.id));
  const merged = [...axeList];
  for (const v of structural) {
    if (!existingIds.has(v.id)) {
      merged.push(v);
      existingIds.add(v.id);
    }
  }
  const extraStructural = structural.filter((v) => !axeList.some((a) => a.id === v.id));

  const impactRank: Record<string, number> = { critical: 4, serious: 3, moderate: 2, minor: 1 };
  merged.sort((a, b) => (impactRank[b.impact ?? 'minor'] ?? 1) - (impactRank[a.impact ?? 'minor'] ?? 1));

  const severityForImpact = (impact: string | null): 'critical' | 'high' | 'medium' | 'low' => {
    switch (impact) {
      case 'critical':
        return 'critical';
      case 'serious':
        return 'high';
      case 'moderate':
        return 'medium';
      default:
        return 'low';
    }
  };

  // ---------- Landmark / region structure ------------------------------------
  const mainCount = homepage.$('main, [role="main"]').length;
  const headerCount = homepage.$('header').length;
  const footerCount = homepage.$('footer').length;
  const navCount = homepage.$('nav, [role="navigation"]').length;
  const landmarks = mainCount + headerCount + footerCount + navCount;
  if (mainCount === 0) {
    issues.push(
      issue('accessibility', 'accessibility', 'high', 'Page has no <main> landmark', 'Screen-reader users use landmarks to jump straight to content; without a main landmark the page is much harder to navigate.', 'Wrap the primary content in <main> (or role="main").', [{ type: 'code', value: 'No <main> or [role="main"] element.' }], 'Landmarks'),
    );
  }
  if (landmarks < 2) {
    issues.push(
      issue('accessibility', 'accessibility', 'medium', 'Very few ARIA landmarks detected', 'Landmarks (header, nav, main, footer) let assistive technology users skip repeated blocks.', 'Add semantic header/nav/main/footer elements.', [{ type: 'code', value: `Landmarks found: main=${mainCount} header=${headerCount} nav=${navCount} footer=${footerCount}` }], 'Landmarks'),
    );
  }

  for (const v of merged) {
    const count = v.nodes.length;
    const sev = severityForImpact(v.impact);
    const examples = v.nodes.slice(0, 4).map((n) => n.html || n.target || n.summary).filter(Boolean);
    const fixHints: Record<string, string> = {
      'image-alt': 'Add meaningful alt text to images that convey information; use alt="" for decorative images.',
      label: 'Give every form field an associated <label> (or aria-label) — never rely on placeholder text alone.',
      'button-name': 'Add visible text (or aria-label) to every button.',
      'link-name': 'Give every link an accessible name (visible text or aria-label).',
      'html-has-lang': 'Add lang="…" to the <html> element.',
      'duplicate-id': 'Make id attributes unique across the page.',
      'frame-title': 'Add a descriptive title attribute to every iframe.',
      'heading-order': 'Use heading levels in order (H1 → H2 → H3) without skipping.',
      'color-contrast': 'Increase contrast between text and background to at least WCAG AA (4.5:1 for normal text).',
      'aria-allowed-attr': 'Use ARIA attributes only on elements where they are permitted.',
      'aria-hidden-body': 'Remove aria-hidden="true" from <body>.',
      'document-title': 'Add a descriptive <title> to the document.',
      region: 'Wrap page sections in landmarks (<main>, <nav>, <aside> etc.).',
      'landmark-one-main': 'Use exactly one <main> landmark per page.',
      'page-has-heading-one': 'Use one H1 per page.',
      'meta-viewport': 'Use a standard viewport meta and do not disable zoom.',
      'select-name': 'Give the select element an accessible label.',
      'aria-valid-attr-value': 'Fix invalid ARIA attribute values.',
      'aria-valid-attr': 'Remove invalid ARIA attributes.',
      'aria-roles': 'Use valid ARIA roles.',
      'nested-interactive': 'Do not nest interactive elements inside each other.',
      'tabindex': 'Avoid positive tabindex values; rely on document order.',
      'link-in-text-block': 'Separate inline links from surrounding text with spacing or colour+underline.',
      'target-size': 'Enlarge touch targets to at least 24px (WCAG 2.2).',
      'scrollable-region-focusable': 'Make scrollable regions keyboard-focusable.',
      'list': 'Use <ul>/<ol> for lists, not styled <div>/<span>.',
      'definition-list': 'Use <dl> for definition lists.',
      'dlitem': 'Use <dt>/<dd> inside <dl>.',
      'listitem': 'Use <li> inside <ul>/<ol>/<menu>.',
      'select': 'Add an accessible label to the select.',
      'label-title-only': 'Do not rely on title attributes alone as labels.',
    };
    issues.push(
      issue(
        'accessibility',
        'accessibility',
        sev,
        `${v.help || v.description} (${count})`,
        v.description || v.help || `Automated rule "${v.id}" found ${count} affected node(s).`,
        fixHints[v.id] ?? 'Review the affected elements and fix the reported accessibility problem.',
        [
          { type: 'code', value: `${v.id} — ${count} node(s)` },
          ...examples.map((e) => ({ type: 'code' as const, value: e.slice(0, 300) })),
        ],
        'axe-core',
      ),
    );
  }

  if (extraStructural.length > 0) {
    notes.push(`${extraStructural.length} structural check group(s) supplemented the axe results.`);
  }

  // ---------- Metrics -------------------------------------------------------
  const counts = new Map<string, number>();
  for (const v of merged) counts.set(v.id, v.nodes.length);
  metrics.push(
    metric('a11y_violations', 'Accessibility violations (automated)', merged.reduce((s, v) => s + v.nodes.length, 0), merged.length === 0 ? 'good' : 'bad', undefined, `${merged.length} rule(s) violated`),
    metric('a11y_rules_checked', 'axe-core rules run', ctx.mode === 'browser' ? 'Full set (rendered page)' : 'DOM rules (no visual rules)', 'neutral'),
  );
  for (const [id, n] of [...counts.entries()].slice(0, 8)) {
    metrics.push(metric(`a11y_${id.replace(/-/g, '_')}`, `"${id}" violations`, n, n === 0 ? 'good' : 'warn'));
  }
  void plural;
  return out(issues, metrics, notes);
}
