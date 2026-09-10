import type { Metadata } from 'next';
import Link from 'next/link';
import { Activity, FileBarChart } from 'lucide-react';
import { Providers } from '@/components/providers';
import { ThemeToggle } from '@/components/theme-toggle';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'SitePulse — Website Health Audit', template: '%s · SitePulse' },
  description:
    'Enter any website URL and receive a professional, evidence-based health audit covering performance, SEO, accessibility, security, mobile, content, images and links. Analyze. Improve. Grow.',
  applicationName: 'SitePulse',
  keywords: ['website audit', 'SEO audit', 'performance', 'accessibility', 'SitePulse'],
  openGraph: {
    title: 'SitePulse — Website Health Audit',
    description: 'Analyze. Improve. Grow. Real, evidence-based website health audits.',
    type: 'website',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className="dark">
      <body className="min-h-screen font-sans">
        <Providers>
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-primary-foreground"
          >
            Skip to content
          </a>
          <SiteHeader />
          <main id="main">{children}</main>
          <SiteFooter />
        </Providers>
      </body>
    </html>
  );
}

function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
      <div className="container mx-auto flex h-14 items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight" aria-label="SitePulse home">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Activity className="h-4 w-4" aria-hidden />
          </span>
          <span className="text-[15px]">
            Site<span className="text-primary">Pulse</span>
          </span>
        </Link>
        <nav aria-label="Main navigation" className="flex items-center gap-1 text-sm text-muted-foreground">
          <Link href="/#how-it-works" className="hidden rounded-md px-3 py-1.5 hover:bg-muted hover:text-foreground sm:block">
            How it works
          </Link>
          <Link href="/#checks" className="hidden rounded-md px-3 py-1.5 hover:bg-muted hover:text-foreground sm:block">
            What we check
          </Link>
          <Link href="/#scoring" className="hidden rounded-md px-3 py-1.5 hover:bg-muted hover:text-foreground md:block">
            Scoring
          </Link>
          <Link href="/history" className="hidden items-center gap-1.5 rounded-md px-3 py-1.5 hover:bg-muted hover:text-foreground sm:flex">
            <FileBarChart className="h-3.5 w-3.5" aria-hidden />
            History
          </Link>
          <span className="mx-1" />
          <ThemeToggle />
          <a href="http://bitsandbytesdude.vercel.app" target="_blank" rel="noopener noreferrer" className="ml-4 text-sm font-medium text-muted-foreground hover:text-foreground">The SaaS or web application created by BITSANDBYTESDUDE</a>
        </nav>
      </div>
    </header>
  );
}

function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-border bg-muted/30">
      <div className="container mx-auto grid gap-8 py-10 sm:grid-cols-3">
        <div>
          <div className="flex items-center gap-2 font-semibold">
            <span className="inline-flex h-6 w-6 items-center justify-center rounded bg-primary text-primary-foreground">
              <Activity className="h-3.5 w-3.5" aria-hidden />
            </span>
            SitePulse
          </div>
          <p className="mt-3 max-w-xs text-sm text-muted-foreground">
            Evidence-based website health audits. Analyze. Improve. Grow.
          </p>
        </div>
        <div>
          <h2 className="text-sm font-semibold">Audit coverage</h2>
          <ul className="mt-3 grid grid-cols-2 gap-1.5 text-sm text-muted-foreground">
            {['Performance', 'SEO', 'Mobile', 'Accessibility', 'Security', 'Technical', 'Content', 'Images', 'Links', 'Conversion'].map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
        <div>
          <h2 className="text-sm font-semibold">About this tool</h2>
          <p className="mt-3 text-sm text-muted-foreground">
            SitePulse runs real, bounded checks against the website you submit. Scores are calculated deterministically from measured
            findings. This is not a penetration test and never claims to be one.
          </p>
        </div>
      </div>
      <div className="border-t border-border py-4">
        <div className="container mx-auto flex flex-col items-start justify-between gap-2 text-xs text-muted-foreground sm:flex-row sm:items-center">
          <p>© {new Date().getFullYear()} SitePulse. Analyze. Improve. Grow.</p>
          <p>Crawl policy: robots.txt respected · same-domain only · bounded depth &amp; pages</p>
        </div>
      </div>
    </footer>
  );
}
