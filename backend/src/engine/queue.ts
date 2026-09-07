import { randomUUID } from 'node:crypto';
import { config } from '../config';
import type { AuditRecord, AuditStatus, StageState } from '../types';
import type { AuditStore } from '../store';
import { runAudit } from './auditEngine';
import { log } from '../utils/log';

/**
 * In-process audit job queue with bounded concurrency. Each job runs the
 * full deterministic engine and updates the shared store as it progresses.
 */
interface QueuedJob {
  id: string;
  run: () => Promise<void>;
}

const queue: QueuedJob[] = [];
let active = 0;

export function enqueueAudit(
  store: AuditStore,
  input: { url: string; scanType: 'quick' | 'standard' | 'deep' },
): Promise<AuditRecord> {
  return new Promise((resolve) => {
    const auditId = randomUUID();
    const now = new Date().toISOString();
    const record: AuditRecord = {
      id: auditId,
      url: input.url,
      status: 'queued',
      scanType: input.scanType,
      createdAt: now,
      startedAt: now,
      completedAt: null,
      result: null,
      progress: { stages: null, message: 'Queued — waiting for a worker.' },
    };
    const run = async (): Promise<void> => {
      resolve(record); // resolve immediately; the record id is known
      active += 1;
      await store.update(auditId, { status: 'running' });
      const done = async (status: AuditStatus, patch: Partial<AuditRecord>): Promise<void> => {
        await store.update(auditId, { status, ...patch });
        active -= 1;
        pump();
      };
      try {
        const { result, fatal } = await runAudit(
          { id: auditId, url: input.url, scanType: input.scanType },
          {
            onStage: (stages: StageState[], _activeId, message) => {
              const stageCopy = stages.map((s) => ({ ...s }));
              const rec = { progress: { stages: stageCopy, message }, status: 'running' as const };
              void store.update(auditId, rec).catch((err) => log.error('progress update failed', { error: String(err) }));
              log.info('audit stage', { audit: auditId.slice(0, 8), url: input.url, message: message.slice(0, 80) });
            },
          },
        );
        await done(result.status, { completedAt: new Date().toISOString(), result, error: fatal ?? null });
      } catch (err) {
        log.error('audit worker crashed', { error: String(err) });
        await done('failed', {
          completedAt: new Date().toISOString(),
          error: { code: 'INTERNAL', message: 'The audit could not be completed due to an internal error.' },
        });
      }
    };
    void store.create(record).catch((err) => log.error('failed to persist queued audit', { error: String(err) }));
    queue.push({ id: auditId, run });
    pump();
  });
}

function pump(): void {
  while (active < config.auditConcurrency && queue.length > 0) {
    const job = queue.shift();
    if (!job) break;
    void job.run();
  }
}

export function queueStats(): { queued: number; active: number } {
  return { queued: queue.length, active };
}
