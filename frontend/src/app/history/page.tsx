import type { Metadata } from 'next';
import { HistoryList } from '@/components/history-list';

export const metadata: Metadata = {
  title: 'Audit history',
  description: 'Previous SitePulse website health audits.',
};

export default function HistoryPage() {
  return (
    <div className="container mx-auto py-12">
      <h1 className="text-2xl font-semibold tracking-tight">Audit history</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Audits stored on this SitePulse instance. Score changes between scans of the same domain are highlighted.
      </p>
      <div className="mt-8">
        <HistoryList />
      </div>
    </div>
  );
}
