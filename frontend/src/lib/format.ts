import type { Issue, ReportSection, Severity } from './types';

export const SECTION_META: Record<ReportSection, { label: string; short: string; blurb: string }> = {
  performance: { label: 'Performance', short: 'Speed', blurb: 'Speed, page weight, caching and rendering' },
  seo: { label: 'SEO', short: 'SEO', blurb: 'Metadata, headings, structure and indexability' },
  mobile: { label: 'Mobile', short: 'Mobile', blurb: 'Viewport, touch and responsive behaviour' },
  accessibility: { label: 'Accessibility', short: 'A11y', blurb: 'Automated axe-core + structural checks' },
  security: { label: 'Security', short: 'Security', blurb: 'HTTPS/TLS, headers, cookies, mixed content' },
  technical: { label: 'Technical', short: 'Tech', blurb: 'HTTP status, redirects, robots, sitemap, resources' },
  content: { label: 'Content', short: 'Content', blurb: 'Visible copy quality and structure' },
  images: { label: 'Images', short: 'Images', blurb: 'Image weight, formats and attributes' },
  links: { label: 'Links', short: 'Links', blurb: 'Internal page health and link statistics' },
  conversion: { label: 'Conversion', short: 'CRO', blurb: 'Observational UX improvement opportunities' },
};

export const SEVERITY_META: Record<Severity, { label: string; cls: string; dot: string }> = {
  critical: { label: 'Critical', cls: 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300 border-red-200 dark:border-red-500/30', dot: 'bg-red-600' },
  high: { label: 'High', cls: 'bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300 border-orange-200 dark:border-orange-500/30', dot: 'bg-orange-500' },
  medium: { label: 'Medium', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300 border-amber-200 dark:border-amber-500/30', dot: 'bg-amber-500' },
  low: { label: 'Low', cls: 'bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300 border-blue-200 dark:border-blue-500/30', dot: 'bg-blue-600' },
  passed: { label: 'Passed', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300 border-emerald-200 dark:border-emerald-500/30', dot: 'bg-emerald-600' },
};

export function gradeColor(grade?: string | null): string {
  switch (grade) {
    case 'Excellent':
      return 'text-emerald-600 dark:text-emerald-400';
    case 'Good':
      return 'text-green-600 dark:text-green-400';
    case 'Fair':
      return 'text-amber-600 dark:text-amber-400';
    case 'Needs improvement':
      return 'text-orange-600 dark:text-orange-400';
    case 'Poor':
      return 'text-red-600 dark:text-red-400';
    default:
      return 'text-muted-foreground';
  }
}

export function gradeRing(grade?: string | null): string {
  switch (grade) {
    case 'Excellent':
      return '#10B981';
    case 'Good':
      return '#22C55E';
    case 'Fair':
      return '#F59E0B';
    case 'Needs improvement':
      return '#F97316';
    case 'Poor':
      return '#EF4444';
    default:
      return '#94A3B8';
  }
}

export function scoreColor(score: number | null): string {
  if (score === null) return '#94A3B8';
  if (score >= 90) return '#10B981';
  if (score >= 80) return '#22C55E';
  if (score >= 70) return '#F59E0B';
  if (score >= 60) return '#F97316';
  return '#EF4444';
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return '—';
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export function formatSeconds(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function severityRank(s: Severity): number {
  return s === 'critical' ? 0 : s === 'high' ? 1 : s === 'medium' ? 2 : s === 'low' ? 3 : 4;
}

export function sortIssues(issues: Issue[]): Issue[] {
  return [...issues].sort((a, b) => {
    const s = severityRank(a.severity) - severityRank(b.severity);
    return s !== 0 ? s : a.section.localeCompare(b.section) || a.code.localeCompare(b.code);
  });
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function statusText(status: Issue['severity'] | 'failed' | string): string {
  return status;
}
