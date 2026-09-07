import type { AuditContext } from '../engine/context';
import { issue, metric, out, plural, formatBytes, isBrokenHttpStatus } from './helpers';
import type { AnalyzerOutput } from '../engine/context';

/**
 * Image analyzer.
 *
 * Works from images actually present in the markup, with real transferred
 * byte sizes measured over the network. Findings in this section are
 * reported under the Performance score (image optimization) per the scoring
 * methodology, and alt-text accessibility issues live in the Accessibility
 * section to avoid double counting.
 */
export async function analyzeImages(ctx: AuditContext): Promise<AnalyzerOutput> {
  const { images } = ctx;
  const issues: AnalyzerOutput['issues'] = [];
  const metrics: AnalyzerOutput['metrics'] = [];
  const notes: string[] = [];

  const fetched = images.filter((i) => i.fetched && i.statusCode === 200);
  const total = images.length;

  const noAlt = images.filter((i) => !i.hasAlt);
  const emptyAlt = images.filter((i) => i.hasAlt && i.alt.trim() === '');
  const measured = fetched.filter((i) => i.sizeBytes !== null);
  const large = measured.filter((i) => (i.sizeBytes ?? 0) >= 300 * 1024 && (i.sizeBytes ?? 0) < 1024 * 1024);
  const huge = measured.filter((i) => (i.sizeBytes ?? 0) >= 1024 * 1024);
  const missingDims = images.filter((i) => !i.widthAttr && !i.heightAttr);
  const lazyLoaded = images.filter((i) => (i.loading ?? '').toLowerCase() === 'lazy');
  const raster = images.filter((i) => /jpe?g|png|gif/.test(i.guessedFormat));
  const modernFormat = images.filter((i) => /webp|avif/.test(i.guessedFormat));

  if (huge.length > 0) {
    issues.push(
      issue('images', 'performance', 'high', `${plural(huge.length, 'image')} exceed 1 MB each`, 'Multi-megabyte images are the most common cause of slow page loads, especially on mobile connections.', 'Compress the images and serve responsive sizes in modern formats (WebP/AVIF).', huge.slice(0, 8).map((i) => ({ type: 'url' as const, value: `${i.url}\n  ${formatBytes(i.sizeBytes ?? 0)} (${i.guessedFormat})` })), 'Large images'),
    );
  }
  if (large.length > 0) {
    issues.push(
      issue('images', 'performance', 'medium', `${plural(large.length, 'image')} are larger than ideal (300 KB+)`, 'Overweight images delay rendering and consume visitor bandwidth and data plans.', 'Compress images and serve properly sized variants in WebP/AVIF where appropriate.', large.slice(0, 8).map((i) => ({ type: 'url' as const, value: `${i.url}\n  ${formatBytes(i.sizeBytes ?? 0)} (${i.guessedFormat})` })), 'Large images'),
    );
  }

  const optimizeable = [...huge, ...large].filter((i, idx, arr) => arr.indexOf(i) === idx);
  if (optimizeable.length === 0 && measured.length > 0) {
    notes.push(`All ${measured.length} measured image(s) are under 300 KB — image weight looks healthy.`);
  }
  if (raster.length > 0 && measured.length > 0 && modernFormat.length === 0 && optimizeable.length > 0) {
    // folded into the large-image fix text; nothing extra to emit.
  }

  if (missingDims.length > 0) {
    const sev = missingDims.length >= images.length && images.length > 3 ? 'medium' : 'low';
    issues.push(
      issue('images', 'performance', sev, `${plural(missingDims.length, 'image')} missing width/height attributes`, 'When dimensions are unknown the browser reserves no layout space and the page can jump as images load (layout shift), hurting Core Web Vitals.', 'Add width and height attributes (or CSS aspect-ratio) matching the intrinsic dimensions.', missingDims.slice(0, 8).map((i) => ({ type: 'url' as const, value: i.url })), 'Layout stability'),
    );
  }

  const nonLazyBelowFold = images.filter((i) => !i.inFirstScreenful && (i.loading ?? '').toLowerCase() !== 'lazy' && !i.srcset && i.fetched);
  if (nonLazyBelowFold.length >= 4) {
    issues.push(
      issue('images', 'performance', 'low', `${plural(nonLazyBelowFold.length, 'below-the-fold image')} not lazy-loaded`, 'Images below the visible area are downloaded immediately, slowing the initial load without benefit.', 'Add loading="lazy" to images that appear below the first screenful.', nonLazyBelowFold.slice(0, 6).map((i) => ({ type: 'url' as const, value: i.url })), 'Lazy loading'),
    );
  }

  if (noAlt.length > 0) {
    notes.push(`${noAlt.length} image(s) missing alt text — see the Accessibility section (alt issues are scored there to avoid double counting).`);
  }

  const brokenImages = images.filter((i) => i.fetched && i.statusCode !== null && isBrokenHttpStatus(i.statusCode));
  if (brokenImages.length > 0) {
    issues.push(
      issue('images', 'technical', 'high', `${plural(brokenImages.length, 'image')} failed to load (HTTP ${brokenImages[0].statusCode})`, 'Broken images appear as empty boxes and signal a neglected site.', 'Fix or remove the broken image references.', brokenImages.slice(0, 8).map((i) => ({ type: 'url' as const, value: `${i.url} → HTTP ${i.statusCode}` })), 'Broken images'),
    );
  }
  const blockedImages = images.filter((i) => i.fetched && i.statusCode !== null && (i.statusCode === 403 || i.statusCode === 401 || i.statusCode === 429));
  if (blockedImages.length > 0) {
    notes.push(`${blockedImages.length} image(s) could not be verified because the server restricted automated access (HTTP ${blockedImages[0].statusCode}).`);
  }

  const notFetched = images.filter((i) => !i.fetched);
  if (notFetched.length > 0) {
    notes.push(`${notFetched.length} image(s) could not be measured (reached the sample cap or failed); only the first ${images.length} unique images are analysed.`);
  }

  const optimizedCount = measured.filter((i) => (i.sizeBytes ?? 0) < 300 * 1024).length + lazyLoaded.length * 0;
  metrics.push(
    metric('img_total', 'Images found', total, 'neutral'),
    metric('img_measured', 'Images measured (bytes)', measured.length, 'neutral'),
    metric('img_large', 'Large images (≥300 KB)', large.length + huge.length, large.length + huge.length === 0 ? 'good' : 'warn', undefined, huge.length ? `${huge.length} over 1 MB` : undefined),
    metric('img_missing_alt', 'Missing alt text', noAlt.length, noAlt.length === 0 ? 'good' : 'warn', undefined, 'Scored under Accessibility'),
    metric('img_lazy', 'Lazy loaded', lazyLoaded.length, 'neutral'),
    metric('img_dims', 'Missing width/height', missingDims.length, missingDims.length === 0 ? 'good' : 'warn'),
    metric('img_modern_format', 'Modern format (WebP/AVIF)', modernFormat.length, 'neutral'),
    metric('img_optimized', 'Optimized (<300 KB measured)', optimizedCount, 'good'),
  );

  if (total === 0) notes.push('No <img> elements found on the homepage.');
  return out(issues, metrics, notes);
}
