import type { Issue, ScoreBucket, CategoryScore, Severity } from '../types';

/**
 * Transparent, reproducible scoring engine.
 *
 * Every category score is derived solely from the severity of the findings
 * assigned to that category:
 *
 *   score = clamp(100 − Σ penalties, 0, 100)
 *   penalties: critical 30 · high 15 · medium 7 · low 2 · passed 0
 *
 * Overall = weighted average over the seven weighted categories
 * (Performance 25%, SEO 20%, Mobile 15%, Accessibility 15%,
 *  Security 10%, Technical 10%, Content 5%).
 *
 * The same rules run identically on every audit, so the score is exactly
 * reproducible from the issue list.
 */

export const BUCKET_PENALTY: Record<Exclude<Severity, 'passed'>, number> = {
  critical: 30,
  high: 15,
  medium: 7,
  low: 2,
};

export const WEIGHTED_BUCKETS: { key: ScoreBucket; label: string; weight: number }[] = [
  { key: 'performance', label: 'Performance', weight: 25 },
  { key: 'seo', label: 'SEO', weight: 20 },
  { key: 'mobile', label: 'Mobile', weight: 15 },
  { key: 'accessibility', label: 'Accessibility', weight: 15 },
  { key: 'security', label: 'Security', weight: 10 },
  { key: 'technical', label: 'Technical', weight: 10 },
  { key: 'content', label: 'Content', weight: 5 },
];

export const OVERALL_WEIGHT_SUM = WEIGHTED_BUCKETS.reduce((s, b) => s + b.weight, 0); // 100

export interface Counts {
  passed: number;
  low: number;
  medium: number;
  high: number;
  critical: number;
}

export function emptyCounts(): Counts {
  return { passed: 0, low: 0, medium: 0, high: 0, critical: 0 };
}

export function countIssues(issues: Issue[]): Counts {
  const c = emptyCounts();
  for (const i of issues) {
    if (i.severity === 'passed') c.passed += 1;
    else c[i.severity] += 1;
  }
  return c;
}

export function scoreFromIssues(issues: Issue[]): number {
  let penalty = 0;
  for (const i of issues) {
    if (i.severity === 'passed') continue;
    penalty += BUCKET_PENALTY[i.severity];
  }
  return Math.max(0, Math.min(100, 100 - penalty));
}

/** Compute the seven weighted category scores for an issue set. */
export function computeCategoryScores(issues: Issue[]): Record<string, CategoryScore> {
  const out: Record<string, CategoryScore> = {};
  for (const b of WEIGHTED_BUCKETS) {
    const bucketIssues = issues.filter((i) => i.bucket === b.key);
    out[b.key] = {
      score: scoreFromIssues(bucketIssues),
      label: b.label,
      kind: 'weighted',
      weight: b.weight,
      issues: countIssues(bucketIssues),
    };
  }
  return out;
}

/** Compute the overall 0–100 score from category scores (weights are 100 total). */
export function computeOverall(categoryScores: Record<string, CategoryScore>): number | null {
  let acc = 0;
  let weightSum = 0;
  for (const b of WEIGHTED_BUCKETS) {
    const cs = categoryScores[b.key];
    if (!cs || cs.score === null) continue;
    acc += cs.score * b.weight;
    weightSum += b.weight;
  }
  if (weightSum === 0) return null;
  return Math.round(acc / weightSum);
}

export function gradeForScore(score: number | null): string {
  if (score === null) return 'Not available';
  if (score >= 90) return 'Excellent';
  if (score >= 80) return 'Good';
  if (score >= 70) return 'Fair';
  if (score >= 60) return 'Needs improvement';
  return 'Poor';
}

export const GRADE_BANDS: { min: number; label: string; color: string }[] = [
  { min: 90, label: 'Excellent', color: 'emerald' },
  { min: 80, label: 'Good', color: 'green' },
  { min: 70, label: 'Fair', color: 'amber' },
  { min: 60, label: 'Needs improvement', color: 'orange' },
  { min: 0, label: 'Poor', color: 'red' },
];
