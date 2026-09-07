import { JSDOM, VirtualConsole } from 'jsdom';
import type { AxeViolation } from '../engine/context';
import { log } from '../utils/log';

/**
 * Runs axe-core against the raw HTML inside jsdom (no script execution).
 * Rules that require real layout/rendering are excluded because a DOM-only
 * environment cannot measure them honestly.
 *
 * Returns an empty array (and logs) when the environment cannot satisfy
 * axe-core — the engine always has the structural checks as a fallback.
 */

const EXCLUDED_IN_STATIC = [
  'color-contrast',
  'target-size',
  'link-in-text-block',
  'scrollable-region-focusable',
  'focus-order-semantics',
  'css-orientation-lock',
  'svg-img-alt',
];

export async function runAxeStatic(html: string, baseUrl: string): Promise<AxeViolation[]> {
  try {
    const virtualConsole = new VirtualConsole();
    const dom = new JSDOM(html, {
      url: baseUrl,
      pretendToBeVisual: true,
      virtualConsole,
      runScripts: 'outside-only',
    });
    const axe = await import('axe-core');
    (dom.window as unknown as { eval: (code: string) => void }).eval(axe.source);
    const win = dom.window as unknown as {
      axe: {
        run: (doc: Document, opts: Record<string, unknown>) => Promise<{ violations: unknown }>;
      };
    };
    const rules: Record<string, { enabled: boolean }> = {};
    for (const id of EXCLUDED_IN_STATIC) rules[id] = { enabled: false };
    const res = await win.axe.run(dom.window.document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] },
      rules,
    });
    const raw = res.violations as Array<{
      id: string;
      impact: string | null;
      description: string;
      help: string;
      helpUrl: string;
      nodes: Array<{ target: string[]; html: string; failureSummary?: string; any?: Array<{ message: string }> }>;
    }>;
    dom.window.close();
    return raw.map((v) => ({
      id: v.id,
      impact: v.impact as AxeViolation['impact'],
      description: v.description,
      help: v.help,
      helpUrl: v.helpUrl,
      nodes: v.nodes.slice(0, 12).map((n) => ({
        target: (n.target ?? []).join(' '),
        html: String(n.html).slice(0, 400),
        summary: n.failureSummary ?? n.any?.map((a) => a.message).join('; ') ?? '',
      })),
    }));
  } catch (err) {
    log.debug('axe-core jsdom scan unavailable; using structural checks only', { error: String(err) });
    return [];
  }
}
