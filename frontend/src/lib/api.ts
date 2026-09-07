import type { AuditJobRecord, AuditListItem, MetaResponse, ScanType } from './types';

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      if (body.error?.message) message = body.error.message;
    } catch {
      /* ignore */
    }
    throw new ApiError(message, res.status);
  }
  return (await res.json()) as T;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export async function startAudit(url: string, scanType: ScanType): Promise<{ auditId: string }> {
  return json('/api/audits', { method: 'POST', body: JSON.stringify({ url, scanType }) });
}

export async function fetchAudit(id: string): Promise<AuditJobRecord> {
  return json(`/api/audits/${encodeURIComponent(id)}`);
}

export async function fetchAudits(limit = 30): Promise<{ items: AuditListItem[]; total: number }> {
  return json(`/api/audits?limit=${limit}`);
}

export async function fetchMeta(): Promise<MetaResponse> {
  return json('/api/meta');
}

export function reportUrl(id: string, format: 'pdf' | 'json' | 'csv'): string {
  return `/api/audits/${encodeURIComponent(id)}/report?format=${format}`;
}

export function screenshotUrl(id: string): string {
  return `/api/audits/${encodeURIComponent(id)}/screenshot`;
}
