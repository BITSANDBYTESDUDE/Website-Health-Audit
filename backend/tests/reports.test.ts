import { describe, expect, it } from 'vitest';
import { auditToCsv, auditToJson, generatePdfReport } from '../src/reports/pdf';
import { makeSampleResult } from './fixtures/sampleResult';

describe('report exports', () => {
  it('generates a readable PDF buffer', async () => {
    const pdf = await generatePdfReport(makeSampleResult());
    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.length).toBeGreaterThan(500);
    expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('serialises the full audit as structured JSON', () => {
    const json = auditToJson(makeSampleResult());
    const parsed = JSON.parse(json) as {
      overallScore: number;
      grade: string;
      schema: string;
      issues: { code: string }[];
    };
    expect(parsed.schema).toBe('sitepulse/audit-result/v1');
    expect(parsed.overallScore).toBe(94);
    expect(parsed.grade).toBe('Excellent');
    expect(parsed.issues.map((i) => i.code)).toEqual(['SEO-001', 'SEC-002', 'PERF-003']);
  });

  it('flattens findings into CSV with a header row', () => {
    const csv = auditToCsv(makeSampleResult());
    const lines = csv.split('\n');
    expect(lines[0]).toContain('"section","severity","code"');
    expect(csv).toContain('"SEO-001"');
    expect(csv).toContain('"SEC-002"');
    // metrics block follows the issues
    expect(csv).toContain('"metric_key","metric_label","metric_value","metric_status"');
    expect(csv).toContain('"page_size"');
  });
});
