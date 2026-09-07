import type { Metadata } from 'next';
import { AuditViewer } from '@/components/audit-viewer';

export const metadata: Metadata = {
  title: 'Audit report',
};

export default function AuditPage({ params }: { params: { id: string } }) {
  return (
    <div className="min-h-[70vh]">
      <AuditViewer id={params.id} />
    </div>
  );
}
