import type { CheerioAPI } from 'cheerio';
import type { HttpResponse } from '../http/httpClient';
import type { AuditMode, ScanType, Severity, ReportSection, ScoreBucket, Metric } from '../types';

/** Analyzer output contract. Every analyzer returns findings + metrics + notes. */
export interface AnalyzerOutput {
  issues: AnalyzerIssue[];
  metrics: Metric[];
  notes: string[];
}

/** Issue as produced by an analyzer (before normalization). */
export interface AnalyzerIssue {
  section: ReportSection;
  bucket: ScoreBucket | 'none';
  severity: Severity;
  title: string;
  whyItMatters: string;
  recommendedFix: string;
  area?: string;
  evidence: { type: 'text' | 'url' | 'selector' | 'header' | 'code'; label?: string; value: string }[];
}

export interface RedirectHop {
  url: string;
  statusCode: number;
}

/** Homepage + one crawled page share this shape. */
export interface HtmlDoc {
  url: string;
  finalUrl: string;
  statusCode: number;
  headers: HttpResponse['headers'];
  html: string;
  text: string;
  sizeBytes: number;
  ttfbMs: number;
  durationMs: number;
  httpVersion: string;
  redirects: RedirectHop[];
  tls: HttpResponse['tls'];
  $: CheerioAPI;
}

export interface CrawledPageMeta {
  url: string;
  finalUrl: string;
  statusCode: number;
  title: string;
  depth: number;
  sizeBytes: number;
  durationMs: number;
  redirects: number;
  redirectedOffsite?: boolean;
  offsiteUrl?: string;
  error?: string;
}

export interface PageLink {
  url: string;
  text: string;
  to: 'internal' | 'external';
  broken?: boolean;
}

export interface RobotsInfo {
  fetched: boolean;
  statusCode: number | null;
  allowsCrawl: boolean;
  disallowAll: boolean;
  sitemaps: string[];
  bodyExcerpt: string;
}

export interface FetchedAsset {
  url: string;
  kind: 'script' | 'style' | 'font' | 'image' | 'other';
  host: string;
  sizeBytes: number;
  statusCode: number;
  compression: string | null;
  cacheControl: string | null;
  isCacheable: boolean;
  /** Stylesheet body (bounded) so media-query detection works without a browser. */
  cssText?: string | null;
  error?: string;
}

export interface ImageAsset {
  url: string;
  alt: string;
  hasAlt: boolean;
  loading: string | null;
  widthAttr: string | null;
  heightAttr: string | null;
  srcset: boolean;
  host: string;
  inFirstScreenful: boolean;
  sizeBytes: number | null;
  statusCode: number | null;
  guessedFormat: string;
  fetched: boolean;
  error?: string;
}

export interface BrowserMetrics {
  viewport: string;
  nav: {
    domContentLoadedMs: number;
    loadMs: number;
    ttfbMs: number;
    transferSize: number;
    resources: number;
  };
  vitals: {
    fcpMs: number | null;
    lcpMs: number | null;
    cls: number | null;
    tbtMs: number | null;
  };
  resources: {
    totalBytes: number;
    jsBytes: number;
    cssBytes: number;
    imageBytes: number;
    fontBytes: number;
    thirdPartyBytes: number;
    thirdPartyRequests: number;
    jsFiles: number;
    cssFiles: number;
    fontFiles: number;
    imageFiles: number;
    requests: number;
  };
  mobile: {
    horizontalOverflow: boolean;
    overflowPx: number;
    tapTargetsTooSmall: number;
    textTooSmall: number;
    fixedHeaderCoversContent: boolean;
    viewportWidth: number;
  };
}

export interface ScanLimits {
  maxPages: number;
  maxDepth: number;
}

export interface ProtocolProbeResult {
  scheme: 'http' | 'https';
  statusCode: number | null;
  finalUrl: string | null;
  /** True when the other scheme redirected back to the audited scheme. */
  redirectedToMain: boolean | null;
  error: string | null;
}

export interface ProtocolProbe {
  mainScheme: 'http' | 'https';
  other: ProtocolProbeResult | null;
}

export interface AuditContext {
  scanType: ScanType;
  mode: AuditMode;
  limits: ScanLimits;
  inputUrl: string;
  normalizedUrl: string;
  domain: string;
  host: string;
  homepage: HtmlDoc;
  crawledPages: CrawledPageMeta[];
  robots: RobotsInfo | null;
  sitemap: { fetched: boolean; statusCode: number | null; urlCount: number | null; urls: string[] } | null;
  protocolProbe: ProtocolProbe | null;
  assets: FetchedAsset[];
  images: ImageAsset[];
  /** Raw axe violations (normalized to plain data). */
  axeViolations: AxeViolation[];
  browserMetrics: BrowserMetrics | null;
  links: PageLink[];
  /** Extra origin pages fetched while crawling, keyed by final URL. */
  pageDocs: Map<string, { title: string | null; metaDescription: string | null; canonical: string | null; h1s: string[]; wordCount: number; links: PageLink[]; statusCode: number; url: string }>;
  homepageLinks: PageLink[];
  internalTargets: string[];
}

export interface AxeViolation {
  id: string;
  impact: 'minor' | 'moderate' | 'serious' | 'critical' | null;
  description: string;
  help: string;
  helpUrl: string;
  nodes: { target: string; html: string; summary: string }[];
}
