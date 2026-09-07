'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, Loader2, PlayCircle } from 'lucide-react';
import { fetchAudit, fetchAudits, fetchMeta, startAudit } from '@/lib/api';
import type { AuditJobRecord } from '@/lib/types';
import { gradeRing, gradeColor, hostOf } from '@/lib/format';
import { SectionHeading } from '@/components/ui';

/**
 * Real "Example audit" block: shows the most recent completed audit stored
 * on the backend (live data, never a mock) or starts a fresh one.
 */
export function ExampleSection() {
  return (
    <section id="example" className="scroll-mt-20 border-t border-border py-20">
      <div className="container mx-auto">
        <SectionHeading
          eyebrow="Example audit"
          title="See a real report before you run your own"
          description="This panel shows an actual audit produced by the engine against a live website — no mock data."
        />
        <ExampleBody />
      </div>
    </section>
  );
}

function ExampleBody() {
  const router = useRouter();
  const [record, setRecord] = useState<AuditJobRecord | null>(null);
  const [exampleUrl, setExampleUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [meta, list] = await Promise.all([fetchMeta(), fetchAudits(10)]);
        if (!mounted) return;
        setExampleUrl(meta.exampleUrl);
        const done = list.items.find((i) => i.status === 'completed' && i.overallScore !== null);
        if (done) {
          const rec = await fetchAudit(done.id);
          if (mounted) setRecord(rec);
        }
      } catch {
        /* backend offline — hide section content gracefully */
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  async function runExample() {
    if (!exampleUrl) return;
    setBusy(true);
    try {
      const res = await startAudit(exampleUrl, 'standard');
      router.push(`/audit/${res.auditId}`);
    } catch {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center rounded-xl border border-border bg-card text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> Loading example…
      </div>
    );
  }

  const r = record?.result;
  const score = r?.overallScore ?? null;
  const cats = r ? Object.values(r.categoryScores).sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0)) : [];

  return (
    <div className="grid items-stretch gap-6 lg:grid-cols-[1fr_380px]">
      <div className="rounded-xl border border-border bg-card">
        {record && r ? (
          <Link href={`/audit/${record.id}`} className="block p-6 transition hover:bg-muted/40">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Latest audit · {record.domain}</p>
                <p className="mt-1 truncate text-sm text-muted-foreground">{r.normalizedUrl}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {cats.slice(0, 7).map((c) => (
                    <span
                      key={c.label}
                      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 text-xs"
                    >
                      <span className="h-2 w-2 rounded-full" style={{ background: gradeRing(c.score ? labelFromScore(c.score) : null) }} aria-hidden />
                      {c.label}
                      <span className="tabular font-semibold">{c.score}</span>
                    </span>
                  ))}
                </div>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-primary/10 px-3 py-2 text-sm font-medium text-primary">
                Open report <ArrowRight className="h-4 w-4" aria-hidden />
              </span>
            </div>
            {r.summary ? (
              <p className="mt-4 border-t border-border pt-4 text-sm leading-relaxed text-muted-foreground">{r.summary.headline}</p>
            ) : null}
          </Link>
        ) : (
          <div className="p-6 text-sm text-muted-foreground">
            No completed audit is stored yet — run one and this space will show the real result.
          </div>
        )}
      </div>

      <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-muted/40 p-8 text-center">
        <div className="relative flex h-28 w-28 items-center justify-center">
          <div
            className="flex h-28 w-28 items-center justify-center rounded-full"
            style={{ background: `conic-gradient(${gradeRing(labelFromScore(score))} ${(score ?? 0) * 3.6}deg, hsl(var(--muted)) 0deg)` }}
            role="img"
            aria-label={score === null ? 'No score yet' : `Overall score ${score}`}
          >
            <div className="flex h-[86px] w-[86px] flex-col items-center justify-center rounded-full bg-card">
              <span className="tabular text-2xl font-bold">{score ?? '–'}</span>
              <span className="text-[10px] text-muted-foreground">/ 100</span>
            </div>
          </div>
        </div>
        <p className={`mt-3 text-sm font-semibold ${gradeColor(r?.summary?.grade)}`}>{record?.result?.summary?.grade ?? 'No score'}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {record ? `Audit of ${hostOf(record.url)}` : exampleUrl ? `Example target: ${hostOf(exampleUrl)}` : ''}
        </p>
        {!record && exampleUrl ? (
          <button
            onClick={runExample}
            disabled={busy}
            className="mt-5 inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <PlayCircle className="h-4 w-4" aria-hidden />}
            {busy ? 'Starting…' : 'Run the example audit'}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function labelFromScore(score: number | null): string | null {
  if (score === null) return null;
  if (score >= 90) return 'Excellent';
  if (score >= 80) return 'Good';
  if (score >= 70) return 'Fair';
  if (score >= 60) return 'Needs improvement';
  return 'Poor';
}
