import type { AuditContext } from '../engine/context';
import { issue, metric, out, plural } from './helpers';
import type { AnalyzerOutput } from '../engine/context';

/**
 * Mobile analyzer.
 *
 * Uses real viewport rendering when a browser is available. Without one it
 * evaluates the mobile signals that can be checked in the markup/CSS
 * (viewport meta, responsive CSS, image attributes) and marks browser-only
 * measurements as not available.
 */
export async function analyzeMobile(ctx: AuditContext): Promise<AnalyzerOutput> {
  const { homepage, browserMetrics } = ctx;
  const { $ } = homepage;
  const issues: AnalyzerOutput['issues'] = [];
  const metrics: AnalyzerOutput['metrics'] = [];
  const notes: string[] = [];

  // ---------- Viewport meta -------------------------------------------------
  const viewport = $('meta[name="viewport"]').attr('content') ?? '';
  if (!viewport) {
    issues.push(
      issue('mobile', 'mobile', 'high', 'Viewport meta tag missing', 'Without a viewport meta tag, phones render the page at desktop width and zoom it out, forcing users to pinch and scroll.', 'Add <meta name="viewport" content="width=device-width, initial-scale=1"> to <head>.', [{ type: 'code', value: '<meta name="viewport"> not found.' }], 'Viewport'),
    );
  } else {
    const hasWidth = /width\s*=\s*device-width/i.test(viewport);
    const hasInitScale = /initial-scale\s*=\s*1(\.0)?/i.test(viewport);
    if (!hasWidth) {
      issues.push(
        issue('mobile', 'mobile', 'medium', 'Viewport meta does not use device-width', 'A fixed viewport width prevents the layout from adapting to the device.', 'Use width=device-width in the viewport meta.', [{ type: 'code', value: `<meta name="viewport" content="${viewport}">` }], 'Viewport'),
      );
    }
    if (/user-scalable\s*=\s*no|maximum-scale\s*=\s*1(\.0)?/i.test(viewport)) {
      issues.push(
        issue('mobile', 'mobile', 'low', 'Page disables pinch-zooming', 'Blocking zoom makes text unreadable for low-vision users and is an accessibility problem.', 'Remove user-scalable=no / maximum-scale=1 from the viewport meta.', [{ type: 'code', value: `<meta name="viewport" content="${viewport}">` }], 'Viewport'),
      );
    }
    metrics.push(metric('mob_viewport', 'Viewport meta', 'Configured', hasWidth && hasInitScale ? 'good' : 'warn', undefined, viewport));
  }

  // ---------- CSS responsiveness (static) -----------------------------------
  const stylesheetText = (ctx.assets.filter((a) => a.kind === 'style' && a.cssText).map((a) => a.cssText as string) ?? []).join('\n');
  const hasMediaQueries = /@media\s*(\(|screen|all|only)/i.test(stylesheetText);
  if (!hasMediaQueries) {
    issues.push(
      issue('mobile', 'mobile', 'medium', 'No responsive CSS media queries detected', 'If the site never adapts its layout by viewport, pages will not fit phone screens well.', 'Add responsive breakpoints (media queries) or use a fluid grid that adapts to the viewport.', [{ type: 'text', value: 'No @media rules found in the site CSS.' }], 'Responsive design'),
    );
  } else {
    metrics.push(metric('mob_media_queries', 'Responsive CSS (@media)', 'Detected', 'good'));
  }
  const imgMaxWidth = /img\s*{[^}]*max-width\s*:\s*100%/i.test(stylesheetText) || /\bimg\b[^{]*{[^}]*max-width\s*:\s*100%/i.test(stylesheetText) || /img\s*{[^}]*width\s*:\s*100%/i.test(stylesheetText);
  if (!imgMaxWidth && homepage.$('img').length > 0 && hasMediaQueries) {
    metrics.push(metric('mob_img_responsive', 'Fluid images in CSS', 'Not detected', 'neutral', undefined, 'Images may overflow small screens if CSS lacks max-width:100%'));
  }

  // ---------- Browser-measured signals --------------------------------------
  if (browserMetrics) {
    const m = browserMetrics.mobile;
    metrics.push(
      metric('mob_overflow', 'Horizontal overflow @375px', m.horizontalOverflow ? `${m.overflowPx}px` : 'None', m.horizontalOverflow ? (m.overflowPx > 40 ? 'bad' : 'warn') : 'good', 'px', 'Measured in a 375px-wide viewport'),
      metric('mob_tap_targets', 'Tap targets < 32px', m.tapTargetsTooSmall, m.tapTargetsTooSmall < 4 ? 'good' : m.tapTargetsTooSmall < 10 ? 'warn' : 'bad', undefined, 'Links & buttons measured in a headless mobile viewport'),
      metric('mob_text_size', 'Text elements < 12px', m.textTooSmall, m.textTooSmall < 4 ? 'good' : 'warn'),
    );
    if (m.horizontalOverflow && m.overflowPx > 40) {
      issues.push(
        issue('mobile', 'mobile', 'high', `Page overflows horizontally on mobile by ${Math.round(m.overflowPx)}px`, 'Horizontal scrolling traps mobile visitors and indicates elements wider than the viewport.', 'Find the overflowing element (often images, tables or fixed-width blocks) and make it fluid.', [{ type: 'text', value: `Measured at 375px viewport: content width ${Math.round(m.overflowPx + 375)}px vs 375px available.` }], 'Layout overflow'),
      );
    } else if (m.horizontalOverflow) {
      issues.push(
        issue('mobile', 'mobile', 'medium', 'Minor horizontal overflow detected on mobile', 'Even small horizontal overflow can cause a sideways scroll on phones.', 'Fix the element that extends past the viewport edge.', [{ type: 'text', value: `Measured at 375px viewport: overflow of ${Math.round(m.overflowPx)}px.` }], 'Layout overflow'),
      );
    }
    if (m.tapTargetsTooSmall >= 10) {
      issues.push(
        issue('mobile', 'mobile', 'medium', `${plural(m.tapTargetsTooSmall, 'tap target')} smaller than recommended 32px`, 'Small touch targets cause mis-taps and frustration on phones.', 'Increase the hit area of links/buttons to at least 44×44 CSS px where practical.', [{ type: 'text', value: `${m.tapTargetsTooSmall} links/buttons measured under 32px in a 375px viewport.` }], 'Touch targets'),
      );
    }
    if (m.textTooSmall >= 6) {
      issues.push(
        issue('mobile', 'mobile', 'low', `${plural(m.textTooSmall, 'text element')} smaller than 12px`, 'Tiny text is hard to read on mobile screens.', 'Raise minimum font size to at least 14–16px for body text.', [{ type: 'text', value: `${m.textTooSmall} text elements under 12px.` }], 'Readability'),
      );
    }
    if (m.fixedHeaderCoversContent) {
      issues.push(
        issue('mobile', 'mobile', 'medium', 'Fixed/sticky header can cover page content', 'When scrolling, a sticky header that overlaps content hides text or buttons behind it.', 'Add scroll-padding-top or spacing so anchored content is not hidden behind the header.', [{ type: 'text', value: 'Detected fixed/sticky header overlapping the main content area while scrolling.' }], 'Navigation'),
      );
    }
    notes.push('Mobile checks were measured in a headless 375×812 (iPhone-class) viewport.');
  } else {
    metrics.push(
      metric('mob_overflow', 'Horizontal overflow @375px', null, 'na', undefined, 'Requires browser rendering'),
      metric('mob_tap_targets', 'Tap target sizes', null, 'na', undefined, 'Requires browser rendering'),
    );
    notes.push('No browser engine available: horizontal-overflow, tap-target and text-size checks are reported as not available. Markup-level mobile checks (viewport meta, responsive CSS) were still evaluated.');
  }

  // ---------- Navigation ----------------------------------------------------
  const navItems = $('nav a, header a').length;
  if (navItems > 12) {
    issues.push(
      issue('mobile', 'mobile', 'low', `Navigation contains ${navItems} links`, 'Long navigation menus are hard to use on small screens.', 'Group navigation items or move secondary links into a menu/footer.', [{ type: 'text', value: `${navItems} links inside <nav>/<header>.` }], 'Navigation'),
    );
  }

  return out(issues, metrics, notes);
}
