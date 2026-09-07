import Link from 'next/link';
import {
  Activity,
  ArrowRight,
  FileSearch,
  Gauge,
  Image as ImageIcon,
  Link2,
  ListChecks,
  Lock,
  MessageSquareText,
  MousePointerClick,
  RefreshCw,
  Search,
  Shield,
  Smartphone,
  Sparkles,
  Star,
  Wrench,
} from 'lucide-react';
import { AuditForm } from '@/components/audit-form';
import { ExampleSection } from '@/components/example-section';
import { buttonVariants } from '@/components/ui';
import { SectionHeading } from '@/components/ui';
import { cn } from '@/lib/cn';

export default function LandingPage() {
  return (
    <>
      <Hero />
      <HowItWorks />
      <ChecksGrid />
      <ScoringSection />
      <ExampleSection />
      <Features />
      <Faq />
      <Cta />
    </>
  );
}

function Hero() {
  return (
    <section id="top" className="scroll-mt-14 border-b border-border bg-gradient-to-b from-blue-50/60 via-background to-background dark:from-blue-500/[0.04]">
      <div className="container mx-auto flex flex-col items-center py-16 text-center sm:py-24">
        <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden />
          Real analysis · Evidence-based scores · No fake numbers
        </p>
        <h1 className="text-balance max-w-3xl text-4xl font-bold tracking-tight sm:text-6xl sm:leading-[1.05]">
          Website Health Audit
        </h1>
        <p className="mt-4 max-w-xl text-pretty text-lg text-muted-foreground">
          Find the problems holding your website back. Enter any website URL and receive a detailed performance, SEO, accessibility,
          security, mobile, and technical health report.
        </p>
        <div className="mt-9 flex w-full justify-center px-4">
          <AuditForm autoFocus={false} />
        </div>
        <div className="mt-12 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-2">
            <Gauge className="h-4 w-4 text-primary" aria-hidden /> 10 audit categories
          </span>
          <span className="inline-flex items-center gap-2">
            <ListChecks className="h-4 w-4 text-primary" aria-hidden /> 100+ reproducible checks
          </span>
          <span className="inline-flex items-center gap-2">
            <FileSearch className="h-4 w-4 text-primary" aria-hidden /> PDF &amp; JSON reports
          </span>
        </div>
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    {
      n: '01',
      icon: Search,
      title: 'Enter Website',
      body: 'Paste any public URL, choose Quick, Standard or Deep scan, and let SitePulse verify the target safely.',
    },
    {
      n: '02',
      icon: Activity,
      title: 'Run Real Audit',
      body: 'The engine fetches your site, inspects HTML and headers, measures resources and crawls internal pages within strict limits.',
    },
    {
      n: '03',
      icon: RefreshCw,
      title: 'Get Your Health Report',
      body: 'A transparent 0–100 score with evidence for every finding: what is wrong, why it matters and how to fix it.',
    },
  ];
  return (
    <section id="how-it-works" className="scroll-mt-20 py-20">
      <div className="container mx-auto">
        <SectionHeading
          eyebrow="How it works"
          title="From URL to professional health report in under a minute"
          description="Three steps, zero accounts, real measurements."
        />
        <ol className="grid gap-6 md:grid-cols-3">
          {steps.map((s) => (
            <li key={s.n}>
              <div className="h-full rounded-xl border border-border bg-card p-6">
                <div className="flex items-center justify-between">
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <s.icon className="h-5 w-5" aria-hidden />
                  </span>
                  <span className="text-3xl font-bold tracking-tight text-muted-foreground/20">{s.n}</span>
                </div>
                <h3 className="mt-4 text-lg font-semibold">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function ChecksGrid() {
  const checks = [
    { icon: Gauge, label: 'Performance', body: 'Response time, page weight, compression, caching, Core Web Vitals when a browser is available.' },
    { icon: Search, label: 'SEO', body: 'Title, meta description, headings, canonical, robots, sitemap, Open Graph, structured data, links.' },
    { icon: Smartphone, label: 'Mobile', body: 'Viewport, responsive CSS, horizontal overflow, tap targets and text size at mobile widths.' },
    { icon: MousePointerClick, label: 'Accessibility', body: 'axe-core rules where possible plus structural checks: labels, alt text, landmarks, heading order, ARIA.' },
    { icon: Shield, label: 'Security', body: 'HTTPS/TLS, HSTS, CSP, security headers, cookie attributes, mixed content. Configuration audit only.' },
    { icon: Wrench, label: 'Technical', body: 'HTTP status, redirect chains, robots.txt, sitemap, favicon, charset and broken internal resources.' },
    { icon: MessageSquareText, label: 'Content', body: 'Visible copy volume, placeholder text, heading sanity, contact info and empty sections.' },
    { icon: ImageIcon, label: 'Images', body: 'Real transferred byte sizes, missing alt/dimensions, lazy loading and modern formats.' },
    { icon: Link2, label: 'Links', body: 'Controlled same-origin crawl verifying internal pages for 2xx, 3xx, 4xx and 5xx responses.' },
    { icon: Star, label: 'Conversion', body: 'Observational UX opportunities — clear CTAs, contact routes, trust signals and form friction.' },
  ];
  return (
    <section id="checks" className="scroll-mt-20 border-t border-border bg-muted/30 py-20">
      <div className="container mx-auto">
        <SectionHeading
          eyebrow="What we check"
          title="Ten areas of website health — all measured from the real site"
          description="Every section reports passed checks, warnings and errors with technical evidence behind each finding."
        />
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {checks.map((c) => (
            <li key={c.label} className="rounded-xl border border-border bg-card p-5 transition-shadow hover:shadow-sm">
              <div className="flex items-center gap-3">
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-foreground">
                  <c.icon className="h-4.5 w-4.5 h-[18px] w-[18px]" aria-hidden />
                </span>
                <h3 className="font-semibold">{c.label}</h3>
              </div>
              <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">{c.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

const BANDS = [
  { range: '90 – 100', label: 'Excellent', cls: 'bg-emerald-500' },
  { range: '80 – 89', label: 'Good', cls: 'bg-green-500' },
  { range: '70 – 79', label: 'Fair', cls: 'bg-amber-500' },
  { range: '60 – 69', label: 'Needs improvement', cls: 'bg-orange-500' },
  { range: '0 – 59', label: 'Poor', cls: 'bg-red-500' },
];

const WEIGHTS = [
  { label: 'Performance', w: 25 },
  { label: 'SEO', w: 20 },
  { label: 'Mobile', w: 15 },
  { label: 'Accessibility', w: 15 },
  { label: 'Security', w: 10 },
  { label: 'Technical', w: 10 },
  { label: 'Content', w: 5 },
];

function ScoringSection() {
  return (
    <section id="scoring" className="scroll-mt-20 py-20">
      <div className="container mx-auto grid items-start gap-12 lg:grid-cols-[1fr_420px]">
        <div>
          <SectionHeading
            align="left"
            eyebrow="Transparent scoring"
            title="A score you can verify, not a magic number"
            description="SitePulse never generates random scores. Each category starts at 100 and loses fixed points per finding severity. Run the same site twice and you get the same reproducible result."
          />
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[480px] text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Severity</th>
                  <th className="px-4 py-3 font-medium">Point penalty</th>
                  <th className="px-4 py-3 font-medium">Example</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {[
                  ['Critical', '−30', 'HTTPS unavailable'],
                  ['High', '−15', 'Missing meta description'],
                  ['Medium', '−7', 'Oversized images'],
                  ['Low', '−2', 'Missing favicon'],
                  ['Passed', '±0', 'Title present'],
                ].map(([sev, pen, ex]) => (
                  <tr key={sev}>
                    <td className="px-4 py-2.5 font-medium">{sev}</td>
                    <td className="tabular px-4 py-2.5 text-muted-foreground">{pen}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{ex}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Overall = weighted average of the seven weighted categories. Findings that cannot be measured reliably are shown as{' '}
            <em>Not available</em> — never invented.
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-6">
          <h3 className="text-base font-semibold">Overall score weights</h3>
          <ul className="mt-5 space-y-3.5">
            {WEIGHTS.map((w) => (
              <li key={w.label}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="font-medium">{w.label}</span>
                  <span className="tabular text-muted-foreground">{w.w}%</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${w.label} weight ${w.w} percent`}>
                  <div className="h-full rounded-full bg-primary" style={{ width: `${w.w * 4}%` }} />
                </div>
              </li>
            ))}
          </ul>
          <h4 className="mt-6 text-sm font-semibold">Grade bands</h4>
          <ul className="mt-3 space-y-1.5">
            {BANDS.map((b) => (
              <li key={b.range} className="flex items-center justify-between text-sm">
                <span className="inline-flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${b.cls}`} aria-hidden />
                  {b.label}
                </span>
                <span className="tabular text-muted-foreground">{b.range}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function Features() {
  const features = [
    { icon: FileSearch, title: 'Evidence on every finding', body: 'Each issue lists the measured evidence — headers, markup, URLs and byte sizes — so you can verify the result yourself.' },
    { icon: ListChecks, title: 'Priority triage', body: 'Critical, high, medium and low classification tells you exactly what to fix first. Passed checks are reported too.' },
    { icon: Shield, title: 'Safe by design', body: 'SSRF protection, private-IP blocking, timeouts, size limits, robots.txt respect and a bounded crawler keep scans safe and fast.' },
    { icon: MousePointerClick, title: 'Before / after style fixes', body: 'Every important issue includes the problem, why it matters, and a concrete recommended fix in plain language.' },
  ];
  return (
    <section id="features" className="border-t border-border bg-muted/30 py-20">
      <div className="container mx-auto">
        <SectionHeading eyebrow="Feature cards" title="Built for developers, agencies and site owners" />
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((f) => (
            <li key={f.title} className="rounded-xl border border-border bg-card p-6">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <f.icon className="h-5 w-5" aria-hidden />
              </span>
              <h3 className="mt-4 font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Faq() {
  const faqs = [
    {
      q: 'Is this a real audit or an estimate?',
      a: 'A real audit. SitePulse fetches the website you submit, inspects the HTML it returns, measures response times and resource sizes, checks headers and TLS, and crawls internal pages within strict limits. Every score is calculated from those measurements.',
    },
    {
      q: 'Which metrics need a real browser?',
      a: 'Paint and layout metrics such as LCP, CLS and TBT are measured in a headless Chromium browser when one is installed (npm run setup:browsers in backend). Without a browser the engine still performs a full HTTP and DOM audit and shows browser-only metrics as “Not available” instead of guessing.',
    },
    {
      q: 'Is the security check a penetration test?',
      a: 'No. The Security section is explicitly a Security Configuration Audit: it inspects publicly observable signals such as HTTPS, TLS version, security headers, cookie attributes and mixed content. SitePulse never exploits, brute-forces or probes beyond safe configuration checks.',
    },
    {
      q: 'Does the accessibility check claim full WCAG compliance?',
      a: 'No. Automated rules (axe-core where available, plus structural checks) find many issues but cannot catch everything. The report states that manual testing may identify additional issues.',
    },
    {
      q: 'Can SitePulse be abused as an SSRF proxy?',
      a: 'No. Targets are validated by DNS and IP policy: loopback, private, link-local and cloud-metadata ranges are blocked, redirects are re-validated at every hop, and requests are bounded by timeouts and size limits.',
    },
    {
      q: 'Will the scan slow down my website?',
      a: 'No. Scans are bounded: Quick audits 1 page, Standard up to 10 pages at depth 2, Deep up to 50 at depth 3 — with concurrency limits, robots.txt respect and a hard overall deadline.',
    },
  ];
  return (
    <section id="faq" className="scroll-mt-20 py-20">
      <div className="container mx-auto max-w-3xl">
        <SectionHeading eyebrow="FAQ" title="Questions, answered" />
        <div className="space-y-3">
          {faqs.map((f) => (
            <details key={f.q} className="group rounded-xl border border-border bg-card px-5 py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium [&::-webkit-details-marker]:hidden">
                {f.q}
                <span className="text-muted-foreground transition-transform group-open:rotate-45" aria-hidden>
                  +
                </span>
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function Cta() {
  return (
    <section className="border-t border-border py-20">
      <div className="container mx-auto">
        <div className="rounded-2xl border border-border bg-card px-6 py-14 text-center sm:px-12">
          <Lock className="mx-auto h-8 w-8 text-primary" aria-hidden />
          <h2 className="mt-4 text-balance text-2xl font-semibold tracking-tight sm:text-3xl">Find out what is slowing your website down</h2>
          <p className="mx-auto mt-3 max-w-lg text-pretty text-muted-foreground">
            Run a real audit now — no account, no installation, no obligation.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <a href="#top" className={cn(buttonVariants({ size: 'lg' }), 'cursor-pointer')}>
              Analyze Your Website <ArrowRight className="h-4 w-4" aria-hidden />
            </a>
            <Link href="/history" className="inline-flex h-12 items-center rounded-xl border border-border bg-card px-7 text-[15px] font-medium hover:bg-muted">
              View previous audits
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
