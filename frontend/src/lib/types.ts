/** Mirrors backend/src/types.ts (kept in sync by hand). */

export type Severity = 'passed' | 'low' | 'medium' | 'high' | 'critical';
export type ScanType = 'quick' | 'standard' | 'deep';
export type AuditStatus = 'queued' | 'running' | 'completed' | 'failed';
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
  code: string;
  section: ReportSection;
  severity: Severity;
  title: string;
  whyItMatters: string;
  recommendedFix: string;
  evidence: EvidenceItem[];
  area?: string;
}

export interface CategoryScore {
  score: number | null;
  label: string;
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
  category: string;
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

export interface AuditSummary {
  grade: string;
  headline: string;
  strengths: string[];
  opportunities: string[];
  aiGenerated?: boolean;
}

export interface AuditResult {
  id: string;
  url: string;
  normalizedUrl: string;
  domain: string;
  scanType: ScanType;
  status: AuditStatus;
  mode: 'browser' | 'static';
  createdAt: string;
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  pagesScanned: number;
  pages: PageScan[];
  crawlPolicy: {
    maxPages: number;
    maxDepth: number;
    respectsRobotsTxt: boolean;
    sameDomainOnly: boolean;
    robotsAllowedCrawl: boolean;
    notes: string[];
  };
  metrics: Metric[];
  issues: Issue[];
  categoryScores: Record<string, CategoryScore>;
  overallScore: number | null;
  summary: AuditSummary | null;
  recommendations: Recommendation[];
  technologies: TechSignal[];
  ai: { used: boolean; note: string };
  error?: { code: string; message: string } | null;
  notes: string[];
  engineVersion: string;
  screenshot: string | null;
}

export interface AuditJobRecord {
  id: string;
  url: string;
  domain: string;
  status: AuditStatus;
  scanType: ScanType;
  createdAt: string;
  startedAt: string;
  completedAt: string | null;
  error: { code: string; message: string } | null;
  progress: { stages: StageState[] | null; message: string } | null;
  result: AuditResult | null;
}

export interface AuditListItem {
  id: string;
  url: string;
  domain: string;
  status: AuditStatus;
  scanType: ScanType;
  createdAt: string;
  completedAt: string | null;
  overallScore: number | null;
  grade: string | null;
}

export interface MetaResponse {
  version: string;
  browserAvailable: boolean;
  browserChecked: boolean;
  auditConcurrency: number;
  scanLimits: Record<ScanType, { pages: number; depth: number; label: string }>;
  demoUrl: string | null;
  exampleUrl: string | null;
}
