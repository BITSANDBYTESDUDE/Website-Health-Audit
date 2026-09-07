import { MongoClient, type Db, type Collection } from 'mongodb';
import fs from 'node:fs';
import path from 'node:path';
import { config, ensureDataDir } from '../config';
import type { AuditRecord, StageState } from '../types';
import { log } from '../utils/log';

/** Storage abstraction so the MVP works without a database. */
export interface AuditStore {
  kind: 'memory' | 'mongo';
  create(record: AuditRecord): Promise<void>;
  get(id: string): Promise<AuditRecord | null>;
  update(id: string, patch: Partial<AuditRecord>): Promise<AuditRecord | null>;
  list(limit: number, offset: number): Promise<AuditRecord[]>;
  count(): Promise<number>;
}

export class MemoryAuditStore implements AuditStore {
  kind = 'memory' as const;
  private records = new Map<string, AuditRecord>();
  private readonly file: string;
  private readonly persistInterval: ReturnType<typeof setInterval>;

  constructor(filePath: string) {
    this.file = filePath;
    if (fs.existsSync(this.file)) {
      try {
        const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as AuditRecord[];
        for (const r of raw) this.records.set(r.id, r);
      } catch {
        log.warn('could not load audit history file; starting empty');
      }
    }
    this.persistInterval = setInterval(() => this.persist(), 10_000);
    this.persistInterval.unref?.();
  }

  private persist(): void {
    try {
      ensureDataDir();
      const all = [...this.records.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 60);
      fs.writeFileSync(this.file, JSON.stringify(all));
    } catch (err) {
      log.error('audit history persist failed', { error: String(err) });
    }
  }

  async create(record: AuditRecord): Promise<void> {
    this.records.set(record.id, record);
  }
  async get(id: string): Promise<AuditRecord | null> {
    return this.records.get(id) ?? null;
  }
  async update(id: string, patch: Partial<AuditRecord>): Promise<AuditRecord | null> {
    const cur = this.records.get(id);
    if (!cur) return null;
    const next = { ...cur, ...patch };
    this.records.set(id, next);
    this.persist();
    return next;
  }
  async list(limit: number, offset: number): Promise<AuditRecord[]> {
    return [...this.records.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(offset, offset + limit);
  }
  async count(): Promise<number> {
    return this.records.size;
  }
}

export class MongoAuditStore implements AuditStore {
  kind = 'mongo' as const;
  private client: MongoClient | null = null;
  private col!: Collection<AuditRecord & { _id?: string }>;
  private db!: Db;

  async connect(uri: string, dbName: string): Promise<void> {
    this.client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
    await this.client.connect();
    this.db = this.client.db(dbName);
    this.col = this.db.collection('audits') as Collection<AuditRecord & { _id?: string }>;
    await this.col.createIndex({ createdAt: -1 });
    await this.col.createIndex({ status: 1 });
    log.info('connected to MongoDB');
  }
  async disconnect(): Promise<void> {
    await this.client?.close();
  }
  private map(doc: AuditRecord & { _id?: string } | null): AuditRecord | null {
    if (!doc) return null;
    const { _id, ...rest } = doc;
    void _id;
    return rest;
  }
  async create(record: AuditRecord): Promise<void> {
    await this.col.insertOne({ ...record });
  }
  async get(id: string): Promise<AuditRecord | null> {
    return this.map(await this.col.findOne({ id }));
  }
  async update(id: string, patch: Partial<AuditRecord>): Promise<AuditRecord | null> {
    await this.col.updateOne({ id }, { $set: patch });
    return this.map(await this.col.findOne({ id }));
  }
  async list(limit: number, offset: number): Promise<AuditRecord[]> {
    const docs = await this.col.find().sort({ createdAt: -1 }).skip(offset).limit(limit).toArray();
    return docs.map((d) => this.map(d) as AuditRecord);
  }
  async count(): Promise<number> {
    return this.col.countDocuments();
  }
}

let store: AuditStore;

export async function initStore(): Promise<AuditStore> {
  if (store) return store;
  if (config.mongodbUri) {
    const m = new MongoAuditStore();
    try {
      await m.connect(config.mongodbUri, config.mongodbDb);
      store = m;
      return store;
    } catch (err) {
      log.error('MongoDB unavailable — falling back to the file-backed store', { error: String(err) });
    }
  }
  store = new MemoryAuditStore(path.join(ensureDataDir(), 'audits.json'));
  return store;
}

export function getStore(): AuditStore {
  if (!store) throw new Error('Store not initialised');
  return store;
}

export { StageState };
export type { AuditRecord };
