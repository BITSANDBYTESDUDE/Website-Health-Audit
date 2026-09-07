'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronDown,
  Clipboard,
  Download,
  FileText,
  Gauge,
  Globe,
  Image as ImageIcon,
  Link2,
  ListChecks,
  Loader2,
  Lock,
  MessageSquareText,
  MousePointerClick,
  RefreshCw,
  Search,
  SearchX,
  Shield,
  Smartphone,
  Sparkles,
  Star,
  Wrench,
  XCircle,
} from 'lucide-react';
import { fetchAudit, reportUrl, screenshotUrl, startAudit } from '@/lib/api';
import type { AuditJobRecord, AuditResult, Issue, Metric, ReportSection, ScanType, StageState } from '@/lib/types';
import { cn } from '@/lib/cn';
import {
  SECTION_META,
  SEVERITY_META,
  formatBytes,
  formatDate,
  formatDuration,
  formatSeconds,
  gradeColor,
  gradeRing,
  scoreColor,
  severityRank,
  sortIssues,
} from '@/lib/format';
import { AuditForm } from '@/components/audit-form';
import { Badge, Button, Card, CardContent, Skeleton } from '@/components/ui';

const ICONS: Record<ReportSection, typeof Gauge> = {
  performance: Gauge,
  seo: Search,
  mobile: Smartphone,
  accessibility: MousePointerClick,
  security: Shield,
  technical: Wrench,
  content: MessageSquareText,
  images: ImageIcon,
  links: Link2,
  conversion: Star,
};

const SECTION_ORDER: ReportSection[] = [
  'performance',
  'seo',
  'mobile',
  'accessibility',
  'security',
  'technical',
  'content',
  'images',
  'links',
  'conversion',
];

type TabId = 'overview' | 'issues' | 'recommendations' | ReportSection;

const TAB_LABELS: Record<TabId, string> = {
  overview: 'Overview',
  issues: 'Issues',
  recommendations: 'Recommendations',
  performance: 'Performance',
  seo: 'SEO',
  mobile: 'Mobile',
  accessibility: 'Accessibility',
  security: 'Security',
  technical: 'Technical',
  content: 'Content',
  images: 'Images',
  links: 'Links',
  conversion: 'Conversion',
};

export function AuditViewer({ id }: { id: string }) {
  const [record, setRecord] = useState<AuditJobRecord | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [polling, setPolling] = useState(true);

  const load = useCallback(async () => {
    try {
      const rec = await fetchAudit(id);
      setRecord(rec);
      setNotFound(false);
      if (rec.status === 'completed' || rec.status === 'failed') setPolling(false);
    } catch {
      setNotFound(true);
      setPolling(false);
    }
  }, [id]);

  useEffect(() => {
    setRecord(null);
    setNotFound(false);
    setPolling(true);
    void load();
    if (!polling) return;
    const t = setInterval(() => void load(), 1400);
    return () => clearInterval(t);
  }, [load, polling]);

  if (notFound) {
    return (
      <div className="container mx-auto py-24 text-center">
        <SearchX className="mx-auto h-10 w-10 text-muted-foreground" aria-hidden />
        <h1 className="mt-4 text-2xl font-semibold">Audit not found</h1>
        <p className="mt-2 text-muted-foreground">No audit exists with that id, or the backend is not reachable.</p>
        <Link href="/" className="mt-6 inline-flex h-10 items-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground hover:bg-primary/90">
          <ArrowLeft className="mr-2 h-4 w-4" aria-hidden /> Back to homepage
        </Link>
      </div>
    );
  }

  if (!record) {
    return <ShellSkeleton />;
  }

  if (record.status === 'failed' || (record.status === 'completed' && !record.result)) {
    return <FailedState record={record} />;
  }

  if (record.status === 'queued' || record.status === 'running' || !record.result) {
    return <ProgressView record={record} />;
  }

  return <Dashboard record={record} result={record.result} />;
}

function ShellSkeleton() {
  return (
    <div className="container mx-auto py-10">
      <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
        <Skeleton className="h-64" />
        <div className="space-y-4">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-48 w-full" />
        </div>
      </div>
    </div>
  );
}

function FailedState({ record }: { record: AuditJobRecord }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function retry() {
    setBusy(true);
    try {
      const res = await startAudit(record.url, record.scanType);
      router.replace(`/audit/${res.auditId}`);
    } catch {
      setBusy(false);
    }
  }
  return (
    <div className="container mx-auto max-w-xl py-20 text-center">
      <div className="rounded-2xl border border-border bg-card p-8">
        <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-400">
          <XCircle className="h-6 w-6" aria-hidden />
        </span>
        <h1 className="mt-4 text-xl font-semibold">We couldn&apos;t complete the audit</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{record.error?.message ?? 'An unexpected error occurred.'}</p>
        <div className="mt-3 rounded-lg bg-muted/60 px-4 py-3 text-left">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Target</p>
          <p className="mt-1 truncate text-sm">{record.url}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Code: {record.error?.code ?? 'UNKNOWN'} · Scan type: {record.scanType}
          </p>
        </div>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Button onClick={() => void retry()} variant="outline" disabled={busy}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="mr-2 h-4 w-4" aria-hidden />}
            {busy ? 'Restarting…' : 'Retry'}
          </Button>
          <Link href="/" className="inline-flex h-10 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            Audit another website
          </Link>
        </div>
      </div>
    </div>
  );
}

const STAGE_ICONS: Record<string, React.ElementType> = {
  validate: Globe,
  connect: Globe,
  robots: Search,
  crawl: Link2,
  browser: Smartphone,
  seo: Search,
  performance: Gauge,
  security: Lock,
  accessibility: MousePointerClick,
  mobile: Smartphone,
  images: ImageIcon,
  links: Link2,
  content: MessageSquareText,
  conversion: Star,
  score: Sparkles,
};

function ProgressView({ record }: { record: AuditJobRecord }) {
  const stages = record.progress?.stages ?? [];
  const message = record.progress?.message ?? 'Starting audit…';
  const order = [
    'validate',
    'connect',
    'robots',
    'crawl',
    'browser',
    'seo',
    'performance',
    'security',
    'accessibility',
    'mobile',
    'images',
    'links',
    'content',
    'conversion',
    'score',
  ];
  const sorted = [...stages].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  const active = sorted.find((s) => s.status === 'active');

  return (
    <div className="container mx-auto max-w-2xl py-16">
      <div className="rounded-2xl border border-border bg-card p-7">
        <div className="flex items-center gap-3">
          <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden />
          <div>
            <h1 className="text-lg font-semibold">Analyzing website…</h1>
            <p className="mt-0.5 truncate text-sm text-muted-foreground">{record.url}</p>
          </div>
        </div>
        <p className="mt-4 text-sm text-muted-foreground" aria-live="polite">
          {message}
        </p>
        <ul className="mt-6 space-y-2.5">
          {sorted.map((s) => (
            <li key={s.id} className="flex items-center gap-3 text-sm" aria-current={s.status === 'active' ? 'step' : undefined}>
              {s.status === 'done' ? (
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                  <Check className="h-3.5 w-3.5" aria-hidden />
                </span>
              ) : s.status === 'active' ? (
                <Loader2 className="h-6 w-6 animate-spin text-primary" aria-hidden />
              ) : (
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-border text-muted-foreground/40">
                  <StIcon id={s.id} />
                </span>
              )}
              <span className={cn(s.status === 'pending' ? 'text-muted-foreground/60' : s.status === 'active' ? 'font-medium text-foreground' : 'text-muted-foreground')}>
                {s.label}
              </span>
              {s.id === active?.id ? (
                <span className="ml-auto rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">in progress</span>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function StIcon({ id }: { id: string }) {
  const Icon = STAGE_ICONS[id] ?? Globe;
  return <Icon className="h-3 w-3" aria-hidden />;
}

function Dashboard({ record, result }: { record: AuditJobRecord; result: AuditResult }) {
  const [tab, setTab] = useState<TabId>('overview');
  return (
    <div className="container mx-auto py-8">
      <DashboardHeader record={record} result={result} />
      <TabBar tab={tab} onTab={setTab} result={result} />
      <div className="mt-6 animate-fade-in" key={tab}>
        {tab === 'overview' ? <OverviewTab result={result} goTo={setTab} /> : null}
        {tab === 'issues' ? <IssuesTab result={result} /> : null}
        {tab === 'recommendations' ? <RecommendationsTab result={result} /> : null}
        {SECTION_ORDER.includes(tab as ReportSection) ? <SectionTab result={result} section={tab as ReportSection} /> : null}
      </div>
    </div>
  );
}

function DashboardHeader({ record, result }: { record: AuditJobRecord; result: AuditResult }) {
  const [copied, setCopied] = useState(false);
  const overall = result.overallScore ?? null;
  const grade = result.summary?.grade ?? null;
  const share = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore */
    }
  };
  return (
    <div className="flex flex-wrap items-start justify-between gap-5">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
            ← Home
          </Link>
          <span aria-hidden className="text-muted-foreground/50">
            /
          </span>
          <h1 className="truncate text-xl font-semibold tracking-tight sm:text-2xl">{result.domain}</h1>
          <Badge className={gradeColor(grade)}>{grade ?? '—'}</Badge>
          {result.mode === 'browser' ? (
            <Badge className="border-violet-200 bg-violet-100 text-violet-800 dark:border-violet-500/30 dark:bg-violet-500/15 dark:text-violet-300">
              Browser-rendered audit
            </Badge>
          ) : (
            <Badge title="No browser engine was available, so browser-only metrics show as Not available." className="cursor-help">
              Static analysis mode
            </Badge>
          )}
        </div>
        <p className="mt-1.5 flex items-center gap-1.5 text-sm text-muted-foreground">
          <Globe className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="truncate">{result.normalizedUrl}</span>
        </p>
        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
          <span>
            Scan date: <span className="font-medium text-foreground">{formatDate(result.completedAt)}</span>
          </span>
          <span>
            Duration: <span className="font-medium text-foreground">{formatDuration(result.durationMs)}</span>
          </span>
          <span>
            Pages scanned: <span className="font-medium text-foreground">{result.pagesScanned}</span>
          </span>
          <span>
            Scan type: <span className="font-medium capitalize text-foreground">{result.scanType}</span>
          </span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-card p-1" role="group" aria-label="Download report">
          <a
            href={reportUrl(record.id, 'pdf')}
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted"
          >
            <Download className="h-4 w-4" aria-hidden /> PDF
          </a>
          <a
            href={reportUrl(record.id, 'json')}
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            JSON
          </a>
          <a
            href={reportUrl(record.id, 'csv')}
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            CSV
          </a>
        </div>
        <Button variant="outline" size="icon" onClick={share} aria-label="Copy report link" title="Copy report link">
          {copied ? <Check className="h-4 w-4 text-emerald-600" aria-hidden /> : <Clipboard className="h-4 w-4" aria-hidden />}
        </Button>
      </div>
    </div>
  );
}

function TabBar({ tab, onTab, result }: { tab: TabId; onTab: (t: TabId) => void; result: AuditResult }) {
  const countBySection = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of result.issues) m.set(i.section, (m.get(i.section) ?? 0) + 1);
    return m;
  }, [result]);
  const tabs: TabId[] = ['overview', ...SECTION_ORDER, 'issues', 'recommendations'];
  return (
    <nav aria-label="Report sections" className="mt-6 overflow-x-auto rounded-xl border border-border bg-card">
      <div className="flex min-w-max gap-0.5 p-1.5 text-sm">
        {tabs.map((t) => {
          const label = TAB_LABELS[t];
          const n = SECTION_ORDER.includes(t as ReportSection) ? (countBySection.get(t) ?? 0) : t === 'issues' ? result.issues.filter((i) => i.severity !== 'passed').length : null;
          const Icon = SECTION_ORDER.includes(t as ReportSection) ? ICONS[t as ReportSection] : t === 'issues' ? ListChecks : t === 'recommendations' ? Sparkles : Gauge;
          return (
            <button
              key={t}
              onClick={() => onTab(t)}
              aria-current={tab === t ? 'page' : undefined}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 font-medium transition-colors',
                tab === t ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <Icon className="h-4 w-4" aria-hidden />
              {label}
              {n !== null && n !== undefined && n > 0 ? (
                <span className={cn('tabular rounded-full px-1.5 text-[10px]', tab === t ? 'bg-white/20' : 'bg-muted text-muted-foreground')}>{n}</span>
              ) : null}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

function OverviewTab({ result, goTo }: { result: AuditResult; goTo: (t: TabId) => void }) {
  const overall = result.overallScore ?? null;
  const grade = result.summary?.grade ?? null;
  const summary = result.summary;
  const cats = SECTION_ORDER.filter((s) => result.categoryScores[s]).map((s) => ({ section: s, ...result.categoryScores[s] }));
  return (
    <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
      <div className="space-y-6">
        <Card className="overflow-hidden">
          <div className="p-6 text-center">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Website health</p>
            <div className="mx-auto mt-5 flex h-36 w-36 items-center justify-center rounded-full" style={{ background: `conic-gradient(${gradeRing(grade)} ${(overall ?? 0) * 3.6}deg, hsl(var(--muted)) 0deg)` }} role="img" aria-label={`Overall score ${overall ?? 'n/a'} of 100`}>
              <div className="flex h-[118px] w-[118px] flex-col items-center justify-center rounded-full bg-card">
                <span className="tabular text-5xl font-bold tracking-tight">{overall ?? '—'}</span>
                <span className="text-xs text-muted-foreground">/ 100</span>
              </div>
            </div>
            <p className={cn('mt-3 text-sm font-semibold uppercase tracking-wide', gradeColor(grade))}>{grade ?? 'Not available'}</p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>{result.ai.used ? 'Summary enhanced by AI' : 'Deterministic summary'}</span>
              {result.ai.used ? <Sparkles className="h-3 w-3 text-primary" aria-hidden /> : null}
            </div>
          </div>
          {result.screenshot ? (
            <a href={screenshotUrl(result.id)} target="_blank" rel="noreferrer" className="block border-t border-border p-3">
              <p className="mb-2 text-center text-xs font-medium uppercase tracking-wide text-muted-foreground">Website preview</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={screenshotUrl(result.id)} alt={`Screenshot of ${result.domain} homepage`} className="mx-auto max-h-44 rounded-md border border-border object-cover" loading="lazy" />
            </a>
          ) : null}
          <div className="grid grid-cols-2 gap-px border-t border-border bg-border">
            {[
              ['Duration', formatDuration(result.durationMs)],
              ['Pages', String(result.pagesScanned)],
              ['Mode', result.mode === 'browser' ? 'Browser' : 'Static'],
              ['Engine', `v${result.engineVersion}`],
            ].map(([k, v]) => (
              <div key={k} className="bg-card p-3.5">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{k}</p>
                <p className="tabular mt-0.5 text-sm font-semibold">{v}</p>
              </div>
            ))}
          </div>
        </Card>
        <Card className="p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Shield className="h-4 w-4 text-primary" aria-hidden /> Measurement notes
          </h2>
          <ul className="mt-3 space-y-2 text-xs leading-relaxed text-muted-foreground">
            {result.notes.slice(0, 8).map((n, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary/60" aria-hidden />
                {n}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="space-y-6">
        {summary ? (
          <Card className="p-6">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Executive summary</h2>
            <p className="mt-2 text-pretty text-[15px] leading-relaxed">{summary.headline}</p>
            {summary.strengths.length ? (
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Strengths
                  </p>
                  <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                    {summary.strengths.map((s) => (
                      <li key={s} className="capitalize">
                        {s}
                      </li>
                    ))}
                  </ul>
                </div>
                {summary.opportunities.length ? (
                  <div>
                    <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
                      <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> Opportunities
                    </p>
                    <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                      {summary.opportunities.map((s) => (
                        <li key={s} className="capitalize">
                          {s}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}
          </Card>
        ) : null}

        <section aria-label="Category scores">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {cats.map((c) => {
              const sev = c.issues.critical + c.issues.high;
              return (
                <button
                  key={c.section}
                  onClick={() => goTo(c.section)}
                  className="rounded-xl border border-border bg-card p-4 text-left transition hover:border-primary/40 hover:shadow-sm"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-2.5 text-sm font-semibold">
                      <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-secondary text-foreground">
                        {(() => {
                          const Icon = ICONS[c.section];
                          return <Icon className="h-4 w-4" aria-hidden />;
                        })()}
                      </span>
                      {c.label}
                      {c.weight ? <span className="text-[11px] font-normal text-muted-foreground">({c.weight}%)</span> : null}
                    </span>
                    <span className="tabular text-2xl font-bold" style={{ color: scoreColor(c.score) }}>
                      {c.score}
                    </span>
                  </div>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full" style={{ width: `${c.score ?? 0}%`, background: scoreColor(c.score) }} />
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {sev > 0 ? (
                      <span className="font-medium text-amber-600 dark:text-amber-400">
                        {sev} high/critical {sev === 1 ? 'issue' : 'issues'}
                      </span>
                    ) : c.issues.medium > 0 ? (
                      `${c.issues.medium} medium`
                    ) : (
                      <span className="text-emerald-600 dark:text-emerald-400">No issues found</span>
                    )}
                  </p>
                </button>
              );
            })}
          </div>
        </section>

        <Card>
          <CardContent className="pt-4">
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <Globe className="h-4 w-4 text-primary" aria-hidden /> Crawl policy
            </h3>
            <ul className="space-y-1.5 text-xs text-muted-foreground">
              <li>
                Scope: max {result.crawlPolicy.maxPages} page(s), depth {result.crawlPolicy.maxDepth}, same-domain only.
              </li>
              <li>robots.txt respected — {result.crawlPolicy.robotsAllowedCrawl ? 'crawling permitted' : 'crawling disallowed (homepage only)'}.</li>
            </ul>
            {result.technologies.length ? (
              <>
                <h4 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Detected technologies (heuristic)</h4>
                <div className="flex flex-wrap gap-1.5">
                  {result.technologies.map((t) => (
                    <Badge key={t.name + t.category} title={t.evidence} className="border-border bg-muted/60">
                      {t.name} <span className="text-muted-foreground">· {t.confidence}</span>
                    </Badge>
                  ))}
                </div>
              </>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SectionTab({ result, section }: { result: AuditResult; section: ReportSection }) {
  const meta = SECTION_META[section];
  const Icon = ICONS[section];
  const issues = sortIssues(result.issues.filter((i) => i.section === section));
  const passed = issues.filter((i) => i.severity === 'passed');
  const findings = issues.filter((i) => i.severity !== 'passed');
  const prefixes: Record<ReportSection, string[]> = {
    performance: ['perf_'],
    seo: ['seo_'],
    mobile: ['mob_'],
    accessibility: ['a11y_'],
    security: ['sec_'],
    technical: ['tech_'],
    content: ['content_'],
    images: ['img_'],
    links: ['lnk_'],
    conversion: ['conv_'],
  };
  const metrics = result.metrics.filter((m) => prefixes[section].some((p) => m.key.startsWith(p)));
  const imageBucketed = section === 'images' ? result.metrics.filter((m) => m.key.startsWith('perf_') && m.key.includes('img')) : [];

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <div className="space-y-5">
        <Card className="p-6">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Icon className="h-5 w-5" aria-hidden />
            </span>
            <div>
              <h2 className="text-xl font-semibold tracking-tight">{meta.label}</h2>
              <p className="text-sm text-muted-foreground">{meta.blurb}</p>
            </div>
            <span className="ml-auto text-right">
              {result.categoryScores[section]?.score !== undefined ? (
                <>
                  <span className="tabular block text-2xl font-bold" style={{ color: scoreColor(result.categoryScores[section]?.score ?? null) }}>
                    {result.categoryScores[section]?.score}
                  </span>
                  <span className="text-xs text-muted-foreground">/ 100</span>
                </>
              ) : (
                <>
                  <span className="tabular block text-lg font-semibold">{issues.length}</span>
                  <span className="text-xs text-muted-foreground">
                    {issues.length === 1 ? 'finding' : 'findings'} · not in overall
                  </span>
                </>
              )}
            </span>
          </div>
        </Card>

        {section === 'accessibility' ? (
          <p className="rounded-lg border border-border bg-card px-4 py-3 text-xs leading-relaxed text-muted-foreground">
            Automated accessibility audit — manual testing may identify additional issues. Visual rules (colour contrast etc.) are only
            reported when a real browser rendered the page.
          </p>
        ) : null}
        {section === 'security' ? (
          <p className="rounded-lg border border-border bg-card px-4 py-3 text-xs leading-relaxed text-muted-foreground">
            This section is a Security Configuration Audit. It checks publicly observable security configuration. It is not a penetration
            test.
          </p>
        ) : null}
        {section === 'conversion' ? (
          <p className="rounded-lg border border-border bg-card px-4 py-3 text-xs leading-relaxed text-muted-foreground">
            Conversion items are potential improvements based on observable UX signals — not conversion predictions. They are excluded from
            the overall health score.
          </p>
        ) : null}

        {passed.length ? (
          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4" aria-hidden /> Passed checks
            </h3>
            <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
              {passed.map((p) => (
                <li key={p.code} className="flex items-start gap-2 text-sm text-muted-foreground">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" aria-hidden />
                  {p.title}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {findings.length ? (
          <IssueList issues={findings} showSection={false} />
        ) : (
          <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            No issues found in this category — nice work.
          </div>
        )}
      </div>

      <div className="space-y-5">
        <Card>
          <CardContent className="space-y-3 pt-4">
            <h3 className="text-sm font-semibold">Measured signals</h3>
            {[...metrics, ...imageBucketed].length ? (
              [...metrics, ...imageBucketed].map((m) => <MetricRow key={m.key} metric={m} />)
            ) : (
              <p className="text-sm text-muted-foreground">No metrics recorded for this category.</p>
            )}
          </CardContent>
        </Card>
        {section === 'images' || section === 'links' ? <CrawlStatsPanel result={result} section={section} /> : null}
      </div>
    </div>
  );
}

function CrawlStatsPanel({ result, section }: { result: AuditResult; section: 'images' | 'links' }) {
  if (section === 'images') {
    const imgMetrics = result.metrics.filter((m) => m.key.startsWith('img_'));
    return (
      <Card>
        <CardContent className="pt-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <ImageIcon className="h-4 w-4 text-primary" aria-hidden /> Image summary
          </h3>
          <dl className="space-y-2 text-sm">
            {imgMetrics.map((m) => (
              <div key={m.key} className="flex items-center justify-between gap-3 border-b border-border pb-2 last:border-0">
                <dt className="text-muted-foreground">{m.label}</dt>
                <dd className="tabular font-medium">{m.value ?? '—'}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
    );
  }
  const linkMetrics = result.metrics.filter((m) => m.key.startsWith('lnk_'));
  return (
    <Card>
      <CardContent className="pt-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Link2 className="h-4 w-4 text-primary" aria-hidden /> Links summary
        </h3>
        <dl className="space-y-2 text-sm">
          {linkMetrics.map((m) => (
            <div key={m.key} className="flex items-center justify-between gap-3 border-b border-border pb-2 last:border-0">
              <dt className="text-muted-foreground">{m.label}</dt>
              <dd className="tabular font-medium">{m.value ?? '—'}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

function MetricRow({ metric }: { metric: Metric }) {
  const color =
    metric.status === 'good'
      ? 'text-emerald-600 dark:text-emerald-400'
      : metric.status === 'warn'
        ? 'text-amber-600 dark:text-amber-400'
        : metric.status === 'bad'
          ? 'text-red-600 dark:text-red-400'
          : metric.status === 'na'
            ? 'text-muted-foreground'
            : 'text-foreground';
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border py-2 last:border-0">
      <div className="min-w-0">
        <p className="text-sm text-muted-foreground">{metric.label}</p>
        {metric.hint ? <p className="mt-0.5 text-[11px] text-muted-foreground/70">{metric.hint}</p> : null}
      </div>
      <p className={cn('tabular shrink-0 text-sm font-semibold', color)} title={metric.value === null ? 'Not available — could not be measured reliably' : undefined}>
        {metric.value === null || metric.value === undefined ? 'Not available' : metric.value}
        {metric.unit && metric.value !== null && metric.value !== undefined && !/s$|%$|chars$|px$|KB|MB/.test(metric.unit) ? ` ${metric.unit}` : ''}
      </p>
    </div>
  );
}

function IssueList({ issues, showSection = true }: { issues: Issue[]; showSection?: boolean }) {
  return (
    <ul className="space-y-3">
      {issues.map((issue) => {
        const sev = SEVERITY_META[issue.severity];
        return (
          <li key={issue.code} className="overflow-hidden rounded-xl border border-border bg-card">
            <details className="group">
              <summary className="flex cursor-pointer list-none items-start gap-3 p-4 [&::-webkit-details-marker]:hidden">
                <span className={cn('mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full', sev.dot, 'text-white')} aria-hidden>
                  {issue.severity === 'critical' || issue.severity === 'high' ? <XCircle className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="text-[15px] font-medium leading-snug">{issue.title}</span>
                    <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide', sev.cls)}>
                      {sev.label}
                    </span>
                  </span>
                  <span className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] uppercase tracking-wide text-muted-foreground">
                    {showSection ? <span>{SECTION_META[issue.section].label}</span> : null}
                    {issue.area ? <span>{issue.area}</span> : null}
                    <span>{issue.code}</span>
                  </span>
                </span>
                <ChevronDown className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
              </summary>
              <div className="space-y-4 border-t border-border px-4 py-4 text-sm">
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">Why it matters</h4>
                  <p className="mt-1.5 leading-relaxed text-muted-foreground">{issue.whyItMatters}</p>
                </div>
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">Recommended fix</h4>
                  <p className="mt-1.5 leading-relaxed text-muted-foreground">{issue.recommendedFix}</p>
                </div>
                {issue.evidence.length ? (
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Evidence</h4>
                    <ul className="mt-1.5 space-y-1.5">
                      {issue.evidence.map((e, i) => (
                        <li key={i} className="rounded-md bg-muted/70 px-3 py-2 font-mono text-xs leading-relaxed text-muted-foreground">
                          {e.label ? <span className="mr-1.5 font-sans font-semibold">{e.label}:</span> : null}
                          {e.value}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </details>
          </li>
        );
      })}
    </ul>
  );
}

function IssuesTab({ result }: { result: AuditResult }) {
  const [q, setQ] = useState('');
  const [severity, setSeverity] = useState<'all' | 'critical' | 'high' | 'medium' | 'low' | 'passed'>('all');
  const [section, setSection] = useState<'all' | ReportSection>('all');
  const filtered = sortIssues(
    result.issues.filter((i) => {
      if (severity !== 'all' && i.severity !== severity) return false;
      if (section !== 'all' && i.section !== section) return false;
      if (q && !`${i.title} ${i.whyItMatters} ${i.recommendedFix} ${i.code}`.toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    }),
  );
  const counts = {
    critical: result.issues.filter((i) => i.severity === 'critical').length,
    high: result.issues.filter((i) => i.severity === 'high').length,
    medium: result.issues.filter((i) => i.severity === 'medium').length,
    low: result.issues.filter((i) => i.severity === 'low').length,
    passed: result.issues.filter((i) => i.severity === 'passed').length,
  };
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <label htmlFor="issue-search" className="sr-only">
              Search issues
            </label>
            <input
              id="issue-search"
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search issues…"
              className="h-10 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/30"
            />
          </div>
          <div className="flex flex-wrap items-center gap-1 rounded-lg border border-border bg-muted/40 p-1" role="group" aria-label="Filter by severity">
            {(['all', 'critical', 'high', 'medium', 'low', 'passed'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSeverity(s)}
                aria-pressed={severity === s}
                className={cn(
                  'rounded-md px-2.5 py-1 text-xs font-medium capitalize transition',
                  severity === s ? 'bg-card text-foreground shadow-sm ring-1 ring-border' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {s}
                {s !== 'all' ? <span className="tabular ml-1 text-muted-foreground/70">{counts[s]}</span> : null}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label htmlFor="issue-section" className="text-xs font-medium text-muted-foreground">
            Category
          </label>
          <select
            id="issue-section"
            value={section}
            onChange={(e) => setSection(e.target.value as 'all' | ReportSection)}
            className="h-8 rounded-md border border-input bg-card px-2 text-sm outline-none focus:border-primary"
          >
            <option value="all">All categories</option>
            {SECTION_ORDER.map((s) => (
              <option key={s} value={s}>
                {SECTION_META[s].label}
              </option>
            ))}
          </select>
          <span className="ml-auto text-xs text-muted-foreground">
            {filtered.length} of {result.issues.length} findings
          </span>
        </div>
      </Card>
      {filtered.length ? (
        <IssueList issues={filtered} />
      ) : (
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          No findings match your filters.
        </div>
      )}
    </div>
  );
}

function RecommendationsTab({ result }: { result: AuditResult }) {
  const recs = [...result.recommendations].sort((a, b) => severityRank(a.priority) - severityRank(b.priority));
  if (!recs.length) {
    return (
      <div className="rounded-xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
        No recommendations — the site passed every check we could make.
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {recs.map((rec) => {
        const sev = SEVERITY_META[rec.priority];
        return (
          <Card key={rec.id} className="p-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide', sev.cls)}>
                {sev.label} priority
              </span>
              <span className="text-xs uppercase tracking-wide text-muted-foreground">{SECTION_META[rec.section].label}</span>
              <span className="text-xs text-muted-foreground">· estimated impact {rec.estimatedImpact}</span>
            </div>
            <h3 className="mt-2 text-[15px] font-semibold leading-snug">{rec.title}</h3>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <div>
                <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Problem</h4>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{rec.problem}</p>
              </div>
              <div>
                <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Why it matters</h4>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{rec.whyItMatters}</p>
              </div>
            </div>
            <div className="mt-4 rounded-lg bg-emerald-500/5 px-4 py-3">
              <h4 className="text-[11px] font-semibold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">Recommended fix</h4>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{rec.recommendedFix}</p>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

export function NewAuditBanner() {
  const [showForm, setShowForm] = useState(false);
  return (
    <div className="mt-10 border-t border-border bg-muted/40 py-10">
      <div className="container mx-auto flex flex-col items-center gap-4">
        <h2 className="text-xl font-semibold">Want to check another website?</h2>
        {showForm ? <AuditForm compact /> : null}
        <Button variant={showForm ? 'secondary' : 'default'} onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Hide' : 'Run another audit'}
        </Button>
      </div>
    </div>
  );
}
