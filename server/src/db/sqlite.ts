import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { MemoryAuditRepository } from './memory';
import type { AuditRecord, AuditRepository, AuditSummary } from './repository';

interface Statement {
  run(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}
interface Database {
  exec(sql: string): void;
  prepare(sql: string): Statement;
  close(): void;
}

/** SQLite via Node's built-in node:sqlite (Node ≥ 22.13) — no native build step. */
export class SqliteAuditRepository implements AuditRepository {
  readonly kind = 'sqlite' as const;
  private readonly db: Database;
  private readonly insert: Statement;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    const require = createRequire(import.meta.url);
    const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (p: string) => Database };
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS ai_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL,
        action TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        case_code TEXT,
        status TEXT NOT NULL,
        error_code TEXT,
        latency_ms INTEGER NOT NULL,
        cached INTEGER NOT NULL,
        image_count INTEGER,
        warnings INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_ai_audit_ts ON ai_audit(ts);
    `);
    this.insert = this.db.prepare(
      'INSERT INTO ai_audit (ts, action, provider, model, case_code, status, error_code, latency_ms, cached, image_count, warnings) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
  }

  record(e: AuditRecord): void {
    this.insert.run(e.ts, e.action, e.provider, e.model, e.caseCode ?? null, e.status, e.errorCode ?? null, Math.round(e.latencyMs), e.cached ? 1 : 0, e.imageCount ?? null, e.warnings ?? null);
  }

  summarySince(sinceIso: string): AuditSummary {
    const rows = this.db
      .prepare('SELECT status, error_code AS errorCode, cached, COUNT(*) AS n FROM ai_audit WHERE ts >= ? GROUP BY status, error_code, cached')
      .all(sinceIso) as Array<{ status: string; errorCode: string | null; cached: number; n: number }>;
    const summary: AuditSummary = { requests: 0, errors: {}, cacheHits: 0 };
    for (const r of rows) {
      summary.requests += r.n;
      if (r.cached) summary.cacheHits += r.n;
      if (r.status === 'error' && r.errorCode) summary.errors[r.errorCode] = (summary.errors[r.errorCode] ?? 0) + r.n;
    }
    return summary;
  }

  recent(limit: number): AuditRecord[] {
    const rows = this.db
      .prepare(
        'SELECT ts, action, provider, model, case_code AS caseCode, status, error_code AS errorCode, latency_ms AS latencyMs, cached, image_count AS imageCount, warnings FROM ai_audit ORDER BY id DESC LIMIT ?',
      )
      .all(limit) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      ts: String(r.ts),
      action: String(r.action),
      provider: String(r.provider),
      model: String(r.model),
      caseCode: (r.caseCode as string | null) ?? undefined,
      status: r.status === 'ok' ? 'ok' : 'error',
      errorCode: (r.errorCode as string | null) ?? undefined,
      latencyMs: Number(r.latencyMs),
      cached: Boolean(r.cached),
      imageCount: (r.imageCount as number | null) ?? undefined,
      warnings: (r.warnings as number | null) ?? undefined,
    }));
  }

  close(): void {
    this.db.close();
  }
}

export function openAuditRepository(path: string, log: (msg: string) => void): AuditRepository {
  try {
    return new SqliteAuditRepository(path);
  } catch (err) {
    log(`SQLite unavailable (${(err as Error).message}); using in-memory audit log.`);
    return new MemoryAuditRepository();
  }
}
