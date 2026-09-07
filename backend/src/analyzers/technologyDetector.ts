import type { AuditContext } from '../engine/context';
import type { TechSignal } from '../types';
import { headerStr } from './helpers';

/**
 * Publicly-observable technology detection. Heuristic only — every signal
 * carries a confidence and the UI states detections are not guaranteed.
 */
export function detectTechnologies(ctx: AuditContext): TechSignal[] {
  const signals: TechSignal[] = [];
  const { homepage } = ctx;
  const { $, headers, html, finalUrl } = homepage;

  const add = (name: string, category: TechSignal['category'], confidence: TechSignal['confidence'], evidence: string) => {
    signals.push({ name, category, confidence, evidence: evidence.slice(0, 200) });
  };

  const server = headerStr(headers, 'server') ?? '';
  if (/cloudflare/i.test(server) || headerStr(headers, 'cf-ray') || headerStr(headers, 'cf-cache-status')) {
    add('Cloudflare', 'cdn', 'high', `server: ${server || 'Cloudflare headers present'}`);
  } else if (/nginx/i.test(server)) {
    add('nginx', 'server', 'medium', `server: ${server}`);
  } else if (/apache/i.test(server)) {
    add('Apache', 'server', 'medium', `server: ${server}`);
  } else if (/vercel/i.test(server) || headerStr(headers, 'x-vercel-id')) {
    add('Vercel', 'cdn', 'high', 'x-vercel-id / server: Vercel');
  } else if (/netlify/i.test(server) || headerStr(headers, 'x-nf-request-id')) {
    add('Netlify', 'cdn', 'high', 'x-nf-request-id / server: Netlify');
  } else if (server) {
    add(server, 'server', 'low', `server header: ${server}`);
  }

  const generator = $('meta[name="generator"]').attr('content') ?? '';
  const generatorLower = generator.toLowerCase();

  if (generatorLower.includes('wordpress') || html.includes('/wp-content/') || html.includes('/wp-json/')) {
    add('WordPress', 'cms', generatorLower.includes('wordpress') ? 'high' : 'medium', generator ? `generator: ${generator}` : html.includes('/wp-content/') ? '/wp-content/ URL pattern' : '/wp-json/ URL pattern');
  }
  if (html.includes('cdn.shopify.com') || headerStr(headers, 'x-shopid')) {
    add('Shopify', 'cms', headerStr(headers, 'x-shopid') ? 'high' : 'medium', 'Shopify CDN/headers');
  }
  if (html.includes('__NEXT_DATA__') || html.includes('/_next/')) {
    add('Next.js', 'framework', 'high', html.includes('__NEXT_DATA__') ? '__NEXT_DATA__ script' : '/_next/ asset path');
  }
  if (html.includes('___gatsby')) {
    add('Gatsby', 'framework', 'high', 'id="___gatsby" marker');
  }
  if (html.includes('__NUXT__')) {
    add('Nuxt (Vue)', 'framework', 'high', '__NUXT__ marker');
  }
  if (html.includes('ng-version=') || /<app-root|<app-main/.test(html)) {
    add('Angular', 'framework', 'medium', 'Angular bootstrap element / ng-version');
  }
  if (html.includes('data-reactroot') || html.includes('id="root"') || /data-reactid=/.test(html)) {
    add('React', 'framework', 'medium', 'React DOM markers');
  }

  const gaScripts = ['google-analytics.com/analytics.js', 'google-analytics.com/ga.js', 'googletagmanager.com/gtag/js', 'gtag/js?id='];
  const ga = gaScripts.filter((s) => html.includes(s));
  if (ga.length) {
    add('Google Analytics', 'analytics', ga.some((s) => s.includes('gtag') || s.includes('analytics.js')) ? 'high' : 'medium', ga[0]);
  } else if (/\(function\s*\(i,s,o,g,r,a,m\)/.test(html) || /ga\s*\(['"]create['"]/.test(html)) {
    add('Google Analytics', 'analytics', 'medium', 'Inline analytics snippet pattern');
  }
  if (html.includes('static.cloudflareinsights.com') || html.includes('cdn.jsdelivr.net/npm/')) {
    add('Cloudflare Insights', 'analytics', 'low', 'insights script');
  }
  if (/plausible\.io\/js/.test(html)) add('Plausible Analytics', 'analytics', 'medium', 'Plausible script');
  if (/gtag|gtm\.js/.test(html)) add('Google Tag Manager', 'analytics', 'medium', 'gtm.js reference');

  const xpb = headerStr(headers, 'x-powered-by');
  if (xpb) add(`${xpb} (x-powered-by)`, 'server', 'medium', `x-powered-by: ${xpb}`);
  const via = headerStr(headers, 'via');
  if (via) add(via, 'cdn', 'low', `via: ${via}`);

  const lang = $('html').attr('lang');
  if (lang) {
    add(`Declared language: ${lang}`, 'other', 'medium', `lang="${lang}"`);
  }

  const jQueryScripts = $('script[src*="jquery"]').length > 0;
  if (jQueryScripts) add('jQuery', 'other', 'medium', 'jQuery script reference');
  const bootstrap = html.includes('bootstrap') && (html.includes('.bundle.min.js') || html.includes('bootstrap.min.css'));
  if (bootstrap) add('Bootstrap', 'framework', 'medium', 'Bootstrap CSS/JS reference');

  // De-duplicate by name+category
  const seen = new Set<string>();
  return signals.filter((s) => {
    const key = s.name.toLowerCase() + '|' + s.category;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
