// Data-access abstraction. The server stores only a technical AI audit log:
// no patient content, prompts, images or AI results. Case data stays on the
// device (IndexedDB). Implementations: SQLite (default) and in-memory; a
// PostgreSQL implementation only needs to satisfy this interface.

export interface AuditRecord {
  ts: string;
  action: string;
  provider: string;
  model: string;
  caseCode?: string;
  status: 'ok' | 'error';
  errorCode?: string;
  latencyMs: number;
  cached: boolean;
  imageCount?: number;
  warnings?: number;
}

export interface AuditSummary {
  requests: number;
  errors: Record<string, number>;
  cacheHits: number;
}

export interface AuditRepository {
  readonly kind: 'sqlite' | 'memory';
  record(entry: AuditRecord): void;
  summarySince(sinceIso: string): AuditSummary;
  recent(limit: number): AuditRecord[];
  close(): void;
}
