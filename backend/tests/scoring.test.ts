import { describe, expect, it } from 'vitest';
import type { Issue } from '../src/types';
import { BUCKET_PENALTY, computeCategoryScores, computeOverall, gradeForScore, scoreFromIssues } from '../src/scoring/scoring';

function issue(partial: Partial<Issue> & { severity: Issue['severity'] }): Issue {
  const merged: Issue = {
    code: 'X-00',
    section: 'seo',
    bucket: 'none',
    title: 't',
    whyItMatters: 'w',
    recommendedFix: 'f',
    evidence: [],
    ...partial,
  } as Issue;
  return merged;
}

describe('scoring engine is deterministic and transparent', () => {
  it('exposes the documented penalty table', () => {
    expect(BUCKET_PENALTY).toEqual({ critical: 30, high: 15, medium: 7, low: 2 });
  });

  it('starts at 100 and subtracts penalties', () => {
    expect(scoreFromIssues([])).toBe(100);
    expect(scoreFromIssues([issue({ severity: 'low' })])).toBe(98);
    expect(scoreFromIssues([issue({ severity: 'medium' })])).toBe(93);
    expect(scoreFromIssues([issue({ severity: 'high' })])).toBe(85);
    expect(scoreFromIssues([issue({ severity: 'critical' })])).toBe(70);
    expect(scoreFromIssues([issue({ severity: 'high', bucket: 'seo' }), issue({ severity: 'medium', bucket: 'seo' })])).toBe(78);
  });

  it('ignores passed findings', () => {
    expect(scoreFromIssues([issue({ severity: 'passed' }), issue({ severity: 'passed' })])).toBe(100);
  });

  it('clamps at zero', () => {
    expect(scoreFromIssues([issue({ severity: 'critical' }), issue({ severity: 'critical' }), issue({ severity: 'critical' }), issue({ severity: 'critical' })])).toBe(0);
  });

  it('only counts issues in their own bucket', () => {
    const scores = computeCategoryScores([
      issue({ severity: 'critical', bucket: 'security' }),
      issue({ severity: 'high', bucket: 'seo' }),
      issue({ severity: 'high', bucket: 'none' }), // unweighted recommendation
    ]);
    expect(scores.security.score).toBe(70);
    expect(scores.seo.score).toBe(85);
    expect(scores.performance.score).toBe(100);
    expect(scores.content.score).toBe(100);
  });

  it('computes a reproducible overall weighted score', () => {
    const scores = computeCategoryScores([
      issue({ severity: 'critical', bucket: 'security' }), // security 70
      issue({ severity: 'medium', bucket: 'performance' }), // performance 93
      issue({ severity: 'high', bucket: 'seo' }), // seo 85
    ]);
    // 93*0.25 + 85*0.20 + 100*0.15 + 100*0.15 + 70*0.10 + 100*0.10 + 100*0.05
    expect(computeOverall(scores)).toBe(92);
  });

  it('is reproducible: same issues, same score, twice', () => {
    const list = [issue({ severity: 'medium', bucket: 'technical' }), issue({ severity: 'low', bucket: 'content' }), issue({ severity: 'high', bucket: 'seo' })];
    const a = computeOverall(computeCategoryScores(list));
    const b = computeOverall(computeCategoryScores(list));
    expect(a).toBe(b);
  });

  it('maps score bands to grades', () => {
    expect(gradeForScore(95)).toBe('Excellent');
    expect(gradeForScore(85)).toBe('Good');
    expect(gradeForScore(75)).toBe('Fair');
    expect(gradeForScore(65)).toBe('Needs improvement');
    expect(gradeForScore(45)).toBe('Poor');
    expect(gradeForScore(null)).toBe('Not available');
  });
});
