'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Globe, Loader2, Zap } from 'lucide-react';
import { ApiError, startAudit } from '@/lib/api';
import type { ScanType } from '@/lib/types';
import { cn } from '@/lib/cn';

const SCAN_TYPES: { id: ScanType; label: string; desc: string }[] = [
  { id: 'quick', label: 'Quick', desc: '1 page' },
  { id: 'standard', label: 'Standard', desc: 'up to 10 pages' },
  { id: 'deep', label: 'Deep', desc: 'up to 50 pages' },
];

export function AuditForm({
  compact = false,
  defaultUrl = '',
  autoFocus = false,
}: {
  compact?: boolean;
  defaultUrl?: string;
  autoFocus?: boolean;
}) {
  const router = useRouter();
  const [url, setUrl] = useState(defaultUrl);
  const [scan, setScan] = useState<ScanType>('standard');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed) {
      setError('Please enter a website URL.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await startAudit(trimmed, scan);
      router.push(`/audit/${res.auditId}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start the audit. Is the backend running?');
      setBusy(false);
    }
  }

  return (
    <div className={cn('w-full', compact ? 'max-w-xl' : 'max-w-2xl')}>
      <form onSubmit={submit} noValidate>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Globe
              className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <label htmlFor="audit-url" className="sr-only">
              Website URL to audit
            </label>
            <input
              id="audit-url"
              type="url"
              inputMode="url"
              autoComplete="url"
              autoFocus={autoFocus}
              placeholder="https://example.com"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                if (error) setError(null);
              }}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'audit-url-error' : undefined}
              className="h-12 w-full rounded-xl border border-input bg-card pl-10 pr-3 text-[15px] shadow-sm outline-none ring-offset-background transition placeholder:text-muted-foreground/70 focus:border-primary focus:ring-2 focus:ring-ring/40"
            />
          </div>
          <button
            type="submit"
            disabled={busy}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-primary px-6 text-[15px] font-medium text-primary-foreground shadow-sm transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Zap className="h-4 w-4" aria-hidden />}
            {busy ? 'Starting…' : 'Analyze Website'}
          </button>
        </div>
        {error ? (
          <p id="audit-url-error" role="alert" className="mt-2 text-sm font-medium text-destructive">
            {error}
          </p>
        ) : null}

        <fieldset className="mt-3">
          <legend className="sr-only">Scan depth</legend>
          <div className="inline-flex flex-wrap gap-1 rounded-lg border border-border bg-muted/40 p-1">
            {SCAN_TYPES.map((s) => (
              <label
                key={s.id}
                className={cn(
                  'cursor-pointer rounded-md px-3 py-1.5 text-[13px] transition',
                  scan === s.id ? 'bg-card text-foreground shadow-sm ring-1 ring-border' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <input
                  type="radio"
                  name="scanType"
                  value={s.id}
                  checked={scan === s.id}
                  onChange={() => setScan(s.id)}
                  className="sr-only"
                />
                <span className="font-medium">{s.label}</span>
                <span className={cn('ml-1.5', scan === s.id ? 'text-muted-foreground' : 'text-muted-foreground/70')}>{s.desc}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </form>
      {!compact ? (
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[13px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
            No installation required
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
            Real website analysis
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
            Detailed recommendations
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
            Professional report
          </span>
        </div>
      ) : (
        <ArrowRight className="hidden" aria-hidden />
      )}
    </div>
  );
}
