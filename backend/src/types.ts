/**
 * SitePulse shared domain types.
 *
 * Everything the audit engine produces is serializable JSON. The frontend
 * mirrors these shapes in frontend/src/lib/types.ts.
 */

export type Severity = 'passed' | 'low' | 'medium' | 'high' | 'critical';

export type ScanType = 'quick' | 'standard' | 'deep';

export type AuditMode = 'browser' | 'static';

export type AuditStatus = 'queued' | 'running' | 'completed' | 'failed';

export type ScoreBucket =
  | 'performance'
  | 'seo'
  | 'mobile'
  | 'accessibility'
  | 'security'
  | 'technical'
  | 'content'
  | 'conversion';

/** Display area a finding belongs to (10 report sections). */
export type ReportSection =
  | 'performance'
  | 'seo'
  | 'mobile'
  | 'accessibility'
  | 'security'
  | 'technical'
  | 'content'
  | 'images'
  | 'links'
  | 'conversion';

export interface Metric {
  key: string;
  label: string;
  /** Null when the metric could not be measured -> displayed as "Not available". */
  value: string | number | null;
  unit?: string;
  status: 'good' | 'warn' | 'bad' | 'neutral' | 'na';
  hint?: string;
}

export interface EvidenceItem {
  type: 'text' | 'url' | 'selector' | 'header' | 'code';
  label?: string;
  value: string;
}

export interface Issue {
  /** Stable unique code, e.g. "SEO-003". Reproducible. */
  code: string;
  /** Display grouping (one of the ten report sections). */
  section: ReportSection;
  /** Which weighted bucket this finding penalises (or none for pure recommendations). */
  bucket: ScoreBucket | 'none';
  severity: Severity;
  title: string;
  whyItMatters: string;
  recommendedFix: string;
  evidence: EvidenceItem[];
  /** Optional sub-category label such as "Meta description". */
  area?: string;
}

export interface CategoryScore {
  /** 0-100 or null when the bucket produced no measurable checks. */
  score: number | null;
  label: string;
  /** 'weighted' buckets feed the overall score; 'reference' buckets do not. */
  kind: 'weighted' | 'reference';
  weight?: number;
  issues: { passed: number; low: number; medium: number; high: number; critical: number };
}

export interface StageState {
  id: string;
  label: string;
  status: 'pending' | 'active' | 'done' | 'skipped' | 'failed';
}

export interface PageScan {
  url: string;
  statusCode: number;
  title: string;
  depth: number;
  sizeBytes: number;
  durationMs: number;
  redirects: number;
}

export interface TechSignal {
  name: string;
  category: 'framework' | 'cms' | 'server' | 'cdn' | 'analytics' | 'language' | 'other';
  confidence: 'high' | 'medium' | 'low';
  evidence: string;
}

export interface Recommendation {
  id: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  problem: string;
  whyItMatters: string;
  recommendedFix: string;
  section: ReportSection;
  estimatedImpact: 'high' | 'medium' | 'low';
}

export interface CrawlPolicy {
  maxPages: number;
  maxDepth: number;
  respectsRobotsTxt: boolean;
  sameDomainOnly: boolean;
  robotsAllowedCrawl: boolean;
  notes: string[];
}

export interface AuditSummary {
  grade: string;
  headline: string;
  strengths: string[];
  opportunities: string[];
  aiGenerated?: boolean;
}

export interface AiInfo {
  used: boolean;
  note: string;
}

export interface AuditResult {
  id: string;
  url: string;
  normalizedUrl: string;
  domain: string;
  scanType: ScanType;
  status: AuditStatus;
  mode: AuditMode;
  createdAt: string;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  pagesScanned: number;
  pages: PageScan[];
  stages: StageState[];
  metrics: Metric[];
  issues: Issue[];
  categoryScores: Record<string, CategoryScore>;
  overallScore: number | null;
  summary: AuditSummary | null;
  recommendations: Recommendation[];
  technologies: TechSignal[];
  crawlPolicy: CrawlPolicy;
  ai: AiInfo;
  error?: { code: string; message: string } | null;
  /** Internal diagnostics (never rendered verbatim to end users). */
  notes: string[];
  engineVersion: string;
  /** Filename of the homepage screenshot when the browser took one. */
  screenshot: string | null;
}

/** Wrapper object stored in the data store. */
export interface AuditRecord {
  id: string;
  url: string;
  status: AuditStatus;
  scanType: ScanType;
  createdAt: string;
  startedAt: string;
  completedAt: string | null;
  /** Full result payload when completed. */
  result: AuditResult | null;
  /** Client-safe failure reason when failed. */
  error?: { code: string; message: string } | null;
  /** Live progress while queued/running. */
  progress?: { stages: StageState[] | null; message: string } | null;
}

export interface StageEvent {
  stage: string;
  message: string;
}
