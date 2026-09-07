'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, FileBarChart2, History, Loader2, TrendingDown, TrendingUp } from 'lucide-react';
import { fetchAudits } from '@/lib/api';
import type { AuditListItem } from '@/lib/types';
import { formatDate, gradeColor, scoreColor } from '@/lib/format';
import { Badge } from '@/components/ui';

export function HistoryList() {
  const [items, setItems] = useState<AuditListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      const res = await fetchAudits(50);
      setItems(res.items);
      setTotal(res.total);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load audit history.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const deltas = useMemo(() => {
    // items are newest-first; compare each completed row with the previous
    // (older) completed scan of the same domain, if any.
    const out = new Map<string, number | null>();
    for (let i = 0; i < items.length; i += 1) {
      const cur = items[i];
      if (cur.status !== 'completed' || cur.overallScore === null) {
        out.set(cur.id, null);
        continue;
      }
      const older = items.slice(i + 1).find((x) => x.domain === cur.domain && x.status === 'completed' && x.overallScore !== null);
      out.set(cur.id, older && older.overallScore !== null ? cur.overallScore - older.overallScore : null);
    }
    return out;
  }, [items]);

  if (loading) {
    return (
      <div className="flex h-48 items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading history…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
        <History className="mx-auto mb-2 h-8 w-8" aria-hidden />
        {error}
      </div>
    );
  }

  if (!items.length) {
    return (
      <div className="rounded-xl border border-dashed border-border p-12 text-center">
        <FileBarChart2 className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden />
        <h2 className="mt-3 font-semibold">No audits yet</h2>
        <p className="mt-1 text-sm text-muted-foreground">Run your first audit from the homepage — results appear here automatically.</p>
        <Link href="/" className="mt-5 inline-flex h-10 items-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground hover:bg-primary/90">
          Analyze a website
        </Link>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-[720px] text-sm">
        <caption className="sr-only">Previous audits with scores</caption>
        <thead>
          <tr className="border-b border-border bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th className="px-4 py-3 font-medium">Website</th>
            <th className="px-4 py-3 font-medium">Score</th>
            <th className="px-4 py-3 font-medium">Change</th>
            <th className="px-4 py-3 font-medium">Scan type</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Date</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {items.map((item) => {
            const rawDelta = item.status === 'completed' && item.overallScore !== null ? deltas.get(item.id) : null;
            const delta = rawDelta === undefined ? null : rawDelta;
            const improved = (delta ?? 0) > 0;
            return (
              <tr key={item.id} className="transition-colors hover:bg-muted/40">
                <td className="px-4 py-3">
                  <Link href={`/audit/${item.id}`} className="font-medium hover:text-primary">
                    {item.domain}
                  </Link>
                  <p className="max-w-[220px] truncate text-xs text-muted-foreground">{item.url}</p>
                </td>
                <td className="tabular px-4 py-3">
                  {item.overallScore === null ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <span className="font-bold" style={{ color: scoreColor(item.overallScore) }}>
                      {item.overallScore}
                      <span className="text-xs font-normal text-muted-foreground">/100</span>
                    </span>
                  )}
                  {item.grade ? <p className={`text-[11px] font-medium ${gradeColor(item.grade)}`}>{item.grade}</p> : null}
                </td>
                <td className="px-4 py-3">
                  {item.status === 'completed' && delta !== null ? (
                    delta === 0 ? (
                      <span className="text-muted-foreground">±0</span>
                    ) : (
                      <span className={`inline-flex items-center gap-1 font-medium ${improved ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                        {improved ? <TrendingUp className="h-3.5 w-3.5" aria-hidden /> : <TrendingDown className="h-3.5 w-3.5" aria-hidden />}
                        {delta > 0 ? '+' : ''}
                        {delta}
                      </span>
                    )
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <Badge className="border-border bg-muted/60 capitalize">{item.scanType}</Badge>
                </td>
                <td className="px-4 py-3">
                  <Badge
                    className={
                      item.status === 'completed'
                        ? 'border-emerald-200 bg-emerald-100 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300'
                        : item.status === 'failed'
                          ? 'border-red-200 bg-red-100 text-red-800 dark:border-red-500/30 dark:bg-red-500/15 dark:text-red-300'
                          : 'border-blue-200 bg-blue-100 text-blue-800 dark:border-blue-500/30 dark:bg-blue-500/15 dark:text-blue-300'
                    }
                  >
                    {item.status}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-muted-foreground">{formatDate(item.completedAt ?? item.createdAt)}</td>
                <td className="px-4 py-3 text-right">
                  <Link href={`/audit/${item.id}`} aria-label={`Open audit report for ${item.domain}`} className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border hover:bg-muted">
                    <ArrowUpRight className="h-4 w-4" aria-hidden />
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
        Showing {items.length} of {total} stored audit(s). Scans are bounded and identical re-scans produce identical scores.
      </p>
    </div>
  );
}
