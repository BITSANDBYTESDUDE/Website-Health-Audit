import PDFDocument from 'pdfkit';
import type { AuditResult, Issue, Metric } from '../types';
import { formatBytes } from '../analyzers/helpers';

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#DC2626',
  high: '#EA580C',
  medium: '#D97706',
  low: '#2563EB',
  passed: '#059669',
};
const SCORE_COLORS: Record<string, string> = {
  Excellent: '#059669',
  Good: '#16A34A',
  Fair: '#D97706',
  'Needs improvement': '#EA580C',
  Poor: '#DC2626',
};

export function generatePdfReport(result: AuditResult): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 56, bottom: 56, left: 50, right: 50 },
      info: { Title: `Website Health Audit — ${result.domain}`, Author: 'SitePulse', Creator: 'SitePulse Audit Engine' },
      bufferPages: true,
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageWidth = doc.page.width;
    const contentWidth = pageWidth - 100;
    let y = 0;

    const footer = (): void => {
      const pages = doc.bufferedPageRange();
      for (let i = pages.start; i < pages.start + pages.count; i += 1) {
        doc.switchToPage(i);
        const footerY = doc.page.height - 36;
        doc.font('Helvetica').fontSize(7).fillColor('#94A3B8');
        doc.text('SitePulse — Website Health Audit · Analyze. Improve. Grow.', 50, footerY, { width: contentWidth, align: 'left' });
        doc.text(`Page ${i - pages.start + 1} of ${pages.count}`, 50, footerY, { width: contentWidth, align: 'right' });
        doc.font('Helvetica').fontSize(7).fillColor('#CBD5E1').text(`Report generated ${new Date(result.completedAt ?? Date.now()).toLocaleString('en-US', { timeZone: 'UTC' })} UTC — automated analysis`, 50, footerY + 9, { width: contentWidth, align: 'left' });
      }
    };

    // ================= COVER =================
    doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(30).text('SitePulse', 50, 90);
    doc.fillColor('#64748B').font('Helvetica').fontSize(11).text('Website Health Audit Report', 50, 124);
    doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(12).text('Analyze. Improve. Grow.', 50, 140);

    doc.moveTo(50, 175).lineTo(pageWidth - 50, 175).strokeColor('#E2E8F0').lineWidth(1).stroke();

    doc.fillColor('#475569').font('Helvetica').fontSize(10);
    doc.text('Website', 50, 200);
    doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(14).text(result.domain, 50, 215, { width: contentWidth });
    doc.fillColor('#475569').font('Helvetica').fontSize(10).text(`URL: ${result.normalizedUrl}`, 50, 236, { width: contentWidth });
    const metaY = 268;
    const meta = [
      ['Audit date', new Date(result.completedAt ?? result.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })],
      ['Scan type', result.scanType[0].toUpperCase() + result.scanType.slice(1)],
      ['Pages scanned', String(result.pagesScanned)],
      ['Duration', result.durationMs !== null ? `${Math.round(result.durationMs / 1000)}s` : '—'],
      ['Mode', result.mode === 'browser' ? 'Browser-rendered' : 'Static (HTTP + DOM)'],
    ];
    meta.forEach(([k, v], i) => {
      const xx = 50 + (i % 3) * (contentWidth / 3);
      const yy = metaY + Math.floor(i / 3) * 46;
      doc.fillColor('#94A3B8').font('Helvetica').fontSize(8).text(k.toUpperCase(), xx, yy);
      doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(11).text(String(v), xx, yy + 12, { width: contentWidth / 3 - 20 });
    });

    const overall = result.overallScore ?? 0;
    const grade = result.summary?.grade ?? 'Not available';
    doc.roundedRect(50, 420, contentWidth, 130, 8).fillAndStroke('#F8FAFC', '#E2E8F0');
    doc.fillColor('#64748B').font('Helvetica').fontSize(10).text('OVERALL WEBSITE HEALTH', 78, 448);
    doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(58).text(String(overall), 78, 460, { width: 130 });
    doc.fillColor('#94A3B8').font('Helvetica').fontSize(13).text('/ 100', 158, 486);
    doc.fillColor(SCORE_COLORS[grade] ?? '#0F172A').font('Helvetica-Bold').fontSize(18).text(grade.toUpperCase(), 78, 512);
    doc.font('Helvetica').fontSize(9).fillColor('#475569');
    const summaryText = (result.summary?.headline ?? '').slice(0, 420);
    doc.text(summaryText, 260, 460, { width: contentWidth - 230, height: 70 });

    doc.addPage();

    // ================= EXECUTIVE SUMMARY =================
    y = 70;
    doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(16).text('Executive Summary', 50, y);
    y += 26;
    doc.font('Helvetica').fontSize(10.5).fillColor('#334155').text(result.summary?.headline ?? 'No summary available.', 50, y, { width: contentWidth, lineGap: 5 });
    y += doc.y + 30;
    if (result.summary) {
      y = drawLabeledList(doc, 'Strengths', result.summary.strengths, 50, y, contentWidth);
      y = drawLabeledList(doc, 'Opportunities', result.summary.opportunities, 50, y + 12, contentWidth);
    }
    y += 20;
    if (y > 620) { doc.addPage(); y = 70; }
    doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(13).text('Category Scores', 50, y);
    y += 22;
    const categories = Object.values(result.categoryScores).sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0));
    for (const cat of categories) {
      if (cat.score === null) continue;
      const rowY = y;
      const barW = 180;
      doc.fillColor('#334155').font('Helvetica').fontSize(10).text(`${cat.label}  (${cat.weight}%)`, 50, rowY, { width: 150 });
      doc.roundedRect(210, rowY - 1, barW, 12, 6).fill('#E2E8F0');
      const fill = Math.max(0, Math.min(1, (cat.score ?? 0) / 100));
      doc.roundedRect(210, rowY - 1, Math.max(3, barW * fill), 12, 6).fill(scoreBarColor(cat.score ?? 0));
      doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(10).text(`${cat.score}`, 405, rowY, { width: 60 });
      const issueCount = cat.issues.high + cat.issues.critical;
      doc.fillColor('#94A3B8').font('Helvetica').fontSize(8).text(issueCount ? `${issueCount} high/critical` : 'healthy', 50, rowY + 15, { width: 180 });
      y += 34;
      if (y > 760) { doc.addPage(); y = 70; }
    }

    // ================= ISSUES =================
    doc.addPage();
    y = 70;
    doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(16).text('Key Issues & Recommendations', 50, y);
    y += 26;
    const criticalHigh = result.issues.filter((i) => i.severity === 'critical' || i.severity === 'high');
    const mediumLow = result.issues.filter((i) => i.severity === 'medium' || i.severity === 'low');
    y = drawIssueSection(doc, 'Critical issues', criticalHigh.filter((i) => i.severity === 'critical'), 50, y, contentWidth);
    y = drawIssueSection(doc, 'High priority issues', criticalHigh.filter((i) => i.severity === 'high'), 50, y + 6, contentWidth);
    y = drawIssueSection(doc, 'Medium priority issues', mediumLow.filter((i) => i.severity === 'medium'), 50, y + 6, contentWidth);
    y = drawIssueSection(doc, 'Low priority issues', mediumLow.filter((i) => i.severity === 'low'), 50, y + 6, contentWidth);

    footer();
    doc.end();
  });
}

function scoreBarColor(score: number): string {
  if (score >= 90) return '#059669';
  if (score >= 80) return '#16A34A';
  if (score >= 70) return '#D97706';
  if (score >= 60) return '#EA580C';
  return '#DC2626';
}

function drawLabeledList(doc: PDFKit.PDFDocument, title: string, items: string[], x: number, y: number, w: number): number {
  doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(10.5).text(title, x, y);
  y += 16;
  doc.font('Helvetica').fontSize(9.5).fillColor('#334155');
  if (!items.length) {
    doc.text('—', x + 12, y);
    return y + 18;
  }
  for (const it of items.slice(0, 8)) {
    doc.text('•', x + 6, y);
    doc.text(cap(it), x + 18, y, { width: w - 30 });
    y += 15;
    if (y > 750) { doc.addPage(); y = 70; }
  }
  return y;
}

function drawIssueSection(doc: PDFKit.PDFDocument, title: string, issues: Issue[], x: number, y: number, w: number): number {
  doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(12).text(title, x, y);
  y += 18;
  if (!issues.length) {
    doc.font('Helvetica').fontSize(9.5).fillColor('#64748B').text('None found.', x + 2, y);
    return y + 18;
  }
  for (const issue of issues.slice(0, 14)) {
    const color = SEVERITY_COLORS[issue.severity] ?? '#334155';
    doc.roundedRect(x, y, 6, 34, 2).fill(color);
    doc.fillColor('#0F172A').font('Helvetica-Bold').fontSize(10).text(issue.title, x + 14, y, { width: w - 24 });
    doc.fillColor('#64748B').font('Helvetica').fontSize(8).text(
      `${issue.area ? issue.area + ' · ' : ''}${issue.code} · ${issue.severity.toUpperCase()}`,
      x + 14,
      y + 13,
      { width: w - 24 },
    );
    const evLine = issue.evidence[0] ? ' ' + issue.evidence[0].value.split('\n')[0] : '';
    doc.font('Helvetica').fontSize(8.5).fillColor('#475569').text(issue.whyItMatters + evLine, x + 14, y + 26, { width: w - 24, height: 26, ellipsis: true });
    y += 74;
    if (y > 700) { doc.addPage(); y = 70; }
  }
  return y;
}

function cap(s: string): string {
  return s.length > 1 ? s[0].toUpperCase() + s.slice(1) : s;
}

/** JSON export: the full structured audit. */
export function auditToJson(result: AuditResult): string {
  return JSON.stringify(
    {
      schema: 'sitepulse/audit-result/v1',
      generatedAt: new Date().toISOString(),
      url: result.url,
      normalizedUrl: result.normalizedUrl,
      domain: result.domain,
      scanType: result.scanType,
      mode: result.mode,
      overallScore: result.overallScore,
      grade: result.summary?.grade,
      summary: result.summary,
      categoryScores: result.categoryScores,
      pagesScanned: result.pagesScanned,
      pages: result.pages,
      metrics: result.metrics,
      issues: result.issues,
      recommendations: result.recommendations,
      technologies: result.technologies,
      crawlPolicy: result.crawlPolicy,
      ai: result.ai,
    },
    null,
    2,
  );
}

/** CSV export: flat technical findings. */
export function auditToCsv(result: AuditResult): string {
  const header = ['section', 'severity', 'code', 'title', 'why_it_matters', 'recommended_fix', 'evidence', 'area'];
  const esc = (v: string | number | undefined | null): string => {
    const s = v === undefined || v === null ? '' : String(v).replace(/"/g, '""');
    return `"${s}"`;
  };
  const rows: string[][] = [header];
  for (const i of result.issues) {
    rows.push([
      i.section,
      i.severity,
      i.code,
      i.title,
      i.whyItMatters,
      i.recommendedFix,
      i.evidence.map((e) => (e.label ? `${e.label}: ` : '') + e.value).join(' | ').slice(0, 800),
      i.area ?? '',
    ]);
  }
  const metricHeader = ['metric_key', 'metric_label', 'metric_value', 'metric_status'];
  rows.push(metricHeader);
  for (const m of result.metrics) {
    rows.push([m.key, m.label, m.value === null || m.value === undefined ? '' : String(m.value), m.status]);
  }
  return rows.map((r) => r.map(esc).join(',')).join('\n');
}

export function metricValueLine(m: Metric): string {
  const v = m.value === null || m.value === undefined ? 'Not available' : String(m.value);
  return `${m.label}: ${v}${m.unit ? ' ' + m.unit : ''}`;
}

export { formatBytes };
