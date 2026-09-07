import type {
  AuditResult,
  CategoryScore,
  CrawlPolicy,
  Issue,
  Metric,
  PageScan,
  Recommendation,
  StageState,
  TechSignal,
} from '../../src/types';

/**
 * Build a fully-typed, minimal but realistic AuditResult without running the
 * engine. Used by report-export tests to verify PDF/JSON/CSV generation.
 */
export function makeSampleResult(overrides: Partial<AuditResult> = {}): AuditResult {
  const emptyCounts = (): CategoryScore['issues'] => ({ passed: 0, low: 0, medium: 0, high: 0, critical: 0 });
  const categoryScores = (score: number | null, label: string, weight?: number): CategoryScore => ({
    score,
    label,
    kind: weight === undefined ? 'reference' : 'weighted',
    ...(weight !== undefined ? { weight } : {}),
    issues: emptyCounts(),
  });

  const issues: Issue[] = [
    {
      code: 'SEO-001',
      section: 'seo',
      bucket: 'seo',
      severity: 'high',
      title: 'Missing meta description',
      whyItMatters: 'Search engines use the description in results.',
      recommendedFix: 'Write a 120–160 character description.',
      evidence: [{ type: 'text', label: 'Homepage', value: 'https://example.test/' }],
      area: 'Meta description',
    },
    {
      code: 'SEC-002',
      section: 'security',
      bucket: 'security',
      severity: 'medium',
      title: 'Missing HSTS header',
      whyItMatters: 'Browsers can fall back to plain HTTP.',
      recommendedFix: 'Send Strict-Transport-Security.',
      evidence: [{ type: 'header', label: 'Response', value: 'no strict-transport-security header present' }],
    },
    {
      code: 'PERF-003',
      section: 'performance',
      bucket: 'performance',
      severity: 'low',
      title: 'Uncompressed response',
      whyItMatters: 'Larger transfers slow the page down.',
      recommendedFix: 'Enable gzip or brotli.',
      evidence: [{ type: 'code', value: 'content-encoding: identity' }],
    },
  ];

  const metrics: Metric[] = [
    { key: 'page_size', label: 'Page weight', value: 128, unit: 'kB', status: 'good' },
    { key: 'requests', label: 'Requests', value: 23, status: 'warn' },
    { key: 'lcp_estimate', label: 'Estimated LCP', value: null, unit: 's', status: 'na' },
  ];

  const pages: PageScan[] = [
    { url: 'https://example.test/', statusCode: 200, title: 'Example — test', depth: 0, sizeBytes: 131_072, durationMs: 310, redirects: 0 },
    { url: 'https://example.test/about', statusCode: 200, title: 'About', depth: 1, sizeBytes: 12_000, durationMs: 220, redirects: 0 },
  ];

  const stages: StageState[] = [
    { id: 'validate', label: 'Validating URL', status: 'done' },
    { id: 'seo', label: 'Analyzing SEO', status: 'done' },
    { id: 'security', label: 'Checking security configuration', status: 'done' },
  ];

  const recommendations: Recommendation[] = [
    {
      id: 'rec-1',
      priority: 'high',
      title: 'Add a meta description',
      problem: 'No meta description was found.',
      whyItMatters: 'Descriptions affect click-through from search results.',
      recommendedFix: 'Add <meta name="description">.',
      section: 'seo',
      estimatedImpact: 'medium',
    },
  ];

  const crawlPolicy: CrawlPolicy = {
    maxPages: 2,
    maxDepth: 1,
    respectsRobotsTxt: true,
    sameDomainOnly: true,
    robotsAllowedCrawl: true,
    notes: [],
  };

  const technologies: TechSignal[] = [
    { name: 'Example Server', category: 'server', confidence: 'high', evidence: 'Server header' },
  ];

  const result: AuditResult = {
    id: '00000000-0000-4000-8000-000000000001',
    url: 'https://example.test/',
    normalizedUrl: 'https://example.test/',
    domain: 'example.test',
    scanType: 'standard',
    status: 'completed',
    mode: 'static',
    createdAt: '2026-09-07T10:00:00.000Z',
    startedAt: '2026-09-07T10:00:00.100Z',
    completedAt: '2026-09-07T10:00:03.200Z',
    durationMs: 3100,
    pagesScanned: 2,
    pages,
    stages,
    metrics,
    issues,
    categoryScores: {
      performance: categoryScores(96, 'Performance', 25),
      seo: categoryScores(85, 'SEO', 20),
      mobile: categoryScores(100, 'Mobile', 15),
      accessibility: categoryScores(100, 'Accessibility', 15),
      security: categoryScores(93, 'Security', 10),
      technical: categoryScores(100, 'Technical', 10),
      content: categoryScores(100, 'Content', 5),
    },
    overallScore: 94,
    summary: {
      grade: 'Excellent',
      headline: 'example.test is in excellent health with a few quick wins available.',
      strengths: ['Fast and light homepage', 'Stable internal links'],
      opportunities: ['Add a meta description', 'Enable HSTS'],
    },
    recommendations,
    technologies,
    crawlPolicy,
    ai: { used: false, note: 'AI summaries disabled — scores and findings were computed locally.' },
    notes: ['deterministic test fixture'],
    engineVersion: 'test',
    screenshot: null,
    ...overrides,
  };
  return result;
}
