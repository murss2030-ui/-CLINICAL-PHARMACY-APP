import type { AuditRecord, AuditRepository, AuditSummary } from './repository';

export class MemoryAuditRepository implements AuditRepository {
  readonly kind = 'memory' as const;
  private readonly rows: AuditRecord[] = [];

  constructor(private readonly max = 5000) {}

  record(entry: AuditRecord): void {
    this.rows.push(entry);
    if (this.rows.length > this.max) this.rows.splice(0, this.rows.length - this.max);
  }

  summarySince(sinceIso: string): AuditSummary {
    const summary: AuditSummary = { requests: 0, errors: {}, cacheHits: 0 };
    for (const r of this.rows) {
      if (r.ts < sinceIso) continue;
      summary.requests++;
      if (r.cached) summary.cacheHits++;
      if (r.status === 'error' && r.errorCode) summary.errors[r.errorCode] = (summary.errors[r.errorCode] ?? 0) + 1;
    }
    return summary;
  }

  recent(limit: number): AuditRecord[] {
    return this.rows.slice(-limit).reverse();
  }

  close(): void {}
}
