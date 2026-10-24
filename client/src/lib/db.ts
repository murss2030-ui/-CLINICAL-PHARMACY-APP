// Offline-first local store (IndexedDB via Dexie). All case data lives on the
// device; nothing here is ever sent to a server except the de-identified case
// context the student explicitly asks the AI to analyse.
import Dexie, { type Table } from 'dexie';
import type {
  AIAnalysisRecord,
  Allergy,
  AppSettings,
  AuditEvent,
  CaseRecord,
  CaseSource,
  ClinicalProblem,
  Competency,
  Diagnostic,
  Dialogue,
  Drp,
  EvidenceRecord,
  ExtractedItem,
  FollowUp,
  Intervention,
  KnowledgeGap,
  LabResult,
  Medication,
  MetaEntry,
  MonitoringItem,
  PresentationRecord,
  ProfileEntry,
  ReconDecision,
  Reflection,
  Rotation,
  RoundEntry,
  SourceImage,
  StudentAnswer,
  Task,
  TimelineEvent,
  VitalSign,
} from './types';
import { nowIso, uid } from './utils';

export class PreceptorDB extends Dexie {
  cases!: Table<CaseRecord, string>;
  sources!: Table<CaseSource, string>;
  images!: Table<SourceImage, string>;
  extracted!: Table<ExtractedItem, string>;
  profiles!: Table<ProfileEntry, string>;
  allergies!: Table<Allergy, string>;
  medications!: Table<Medication, string>;
  labs!: Table<LabResult, string>;
  vitals!: Table<VitalSign, string>;
  diagnostics!: Table<Diagnostic, string>;
  problems!: Table<ClinicalProblem, string>;
  timeline!: Table<TimelineEvent, string>;
  drps!: Table<Drp, string>;
  interventions!: Table<Intervention, string>;
  monitoring!: Table<MonitoringItem, string>;
  followups!: Table<FollowUp, string>;
  tasks!: Table<Task, string>;
  reflections!: Table<Reflection, string>;
  evidence!: Table<EvidenceRecord, string>;
  presentations!: Table<PresentationRecord, string>;
  aiAnalyses!: Table<AIAnalysisRecord, string>;
  audit!: Table<AuditEvent, string>;
  answers!: Table<StudentAnswer, string>;
  recon!: Table<ReconDecision, string>;
  dialogues!: Table<Dialogue, string>;
  rounds!: Table<RoundEntry, string>;
  rotations!: Table<Rotation, string>;
  competencies!: Table<Competency, string>;
  gaps!: Table<KnowledgeGap, string>;
  meta!: Table<MetaEntry, string>;

  constructor(name = 'preceptor') {
    super(name);
    this.version(1).stores({
      cases: 'id, code, status, department, updatedAt',
      sources: 'id, caseId, createdAt',
      images: 'id, caseId, sourceId, sha256',
      extracted: 'id, caseId, sourceId, status, kind',
      profiles: 'id, caseId, key',
      allergies: 'id, caseId',
      medications: 'id, caseId, list',
      labs: 'id, caseId, name',
      vitals: 'id, caseId',
      diagnostics: 'id, caseId',
      problems: 'id, caseId',
      timeline: 'id, caseId',
      drps: 'id, caseId, status, createdAt',
      interventions: 'id, caseId, drpId, createdAt',
      monitoring: 'id, caseId, createdAt',
      followups: 'id, caseId, status, dueDate, createdAt',
      tasks: 'id, caseId, status, dueDate, createdAt',
      reflections: 'id, caseId, createdAt',
      evidence: 'id, caseId, drpId',
      presentations: 'id, caseId, createdAt',
      aiAnalyses: 'id, caseId, sourceId, action, createdAt',
      audit: 'id, caseId, ts',
      answers: 'id, caseId, exerciseId, context, createdAt',
      recon: 'id, caseId, key',
      dialogues: 'id, caseId, mode, updatedAt',
      rounds: 'id, caseId, createdAt',
      rotations: 'id, isCurrent',
      competencies: 'id',
      gaps: 'id, domain, status, lastSeen',
      meta: 'key',
    });
  }
}

export const db = new PreceptorDB();

/** Tables whose rows belong to a single case (deleted / duplicated together). */
export const CASE_TABLES = [
  'sources',
  'images',
  'extracted',
  'profiles',
  'allergies',
  'medications',
  'labs',
  'vitals',
  'diagnostics',
  'problems',
  'timeline',
  'drps',
  'interventions',
  'monitoring',
  'followups',
  'tasks',
  'reflections',
  'evidence',
  'presentations',
  'aiAnalyses',
  'audit',
  'answers',
  'recon',
  'dialogues',
  'rounds',
] as const;
export type CaseTable = (typeof CASE_TABLES)[number];

// ───────────────────────── settings & counters ─────────────────────────

export const DEFAULT_SETTINGS: AppSettings = {
  apiBase: '',
  accessCode: '',
  aiProvider: 'auto',
  language: 'en',
  largeText: false,
  defaultDepartment: 'internal_medicine',
  ownerName: '',
  privacyAcknowledged: false,
};

export async function getSettings(database: PreceptorDB = db): Promise<AppSettings> {
  const row = await database.meta.get('settings');
  return { ...DEFAULT_SETTINGS, ...((row?.value as Partial<AppSettings>) ?? {}) };
}

export async function saveSettings(patch: Partial<AppSettings>, database: PreceptorDB = db): Promise<AppSettings> {
  const next = { ...(await getSettings(database)), ...patch };
  await database.meta.put({ key: 'settings', value: next });
  return next;
}

export async function nextCaseCode(database: PreceptorDB = db): Promise<string> {
  return database.transaction('rw', database.meta, database.cases, async () => {
    const row = await database.meta.get('caseCounter');
    const used = (await database.cases.toArray()).map((c) => Number.parseInt(c.code.replace(/\D/g, ''), 10)).filter(Number.isFinite);
    const next = Math.max((row?.value as number) ?? 0, ...used, 0) + 1;
    await database.meta.put({ key: 'caseCounter', value: next });
    return `CASE-${String(next).padStart(4, '0')}`;
  });
}

export async function nextSourceCode(caseId: string, database: PreceptorDB = db): Promise<string> {
  const count = await database.sources.where('caseId').equals(caseId).count();
  return `SRC-${String(count + 1).padStart(2, '0')}`;
}

// ───────────────────────── audit ─────────────────────────

export async function audit(action: string, opts: { caseId?: string; actor?: AuditEvent['actor']; detail?: string } = {}, database: PreceptorDB = db) {
  await database.audit.add({ id: uid(), ts: nowIso(), action, actor: opts.actor ?? 'student', caseId: opts.caseId, detail: opts.detail?.slice(0, 500) });
}

// ───────────────────────── case lifecycle ─────────────────────────

export async function deleteCase(caseId: string, database: PreceptorDB = db): Promise<void> {
  const tables = CASE_TABLES.map((t) => database.table(t));
  await database.transaction('rw', [database.cases, ...tables], async () => {
    for (const t of tables) await t.where('caseId').equals(caseId).delete();
    await database.cases.delete(caseId);
  });
}

/** Duplicate a case's clinical data (not its images, AI logs or audit) under a new code. */
export async function duplicateCase(caseId: string, database: PreceptorDB = db): Promise<string> {
  const original = await database.cases.get(caseId);
  if (!original) throw new Error('Case not found');
  const newId = uid();
  const code = await nextCaseCode(database);
  const copyTables = ['profiles', 'allergies', 'medications', 'labs', 'vitals', 'diagnostics', 'problems', 'timeline', 'drps', 'interventions', 'monitoring', 'followups'] as const;
  const byTable: Record<string, Array<Record<string, unknown>>> = {};
  for (const t of copyTables) byTable[t] = await database.table(t).where('caseId').equals(caseId).toArray();
  const remapped = remapRows(byTable, newId);
  await database.transaction('rw', [database.cases, ...copyTables.map((t) => database.table(t))], async () => {
    await database.cases.add({ ...original, id: newId, code, status: 'active', isDemo: original.isDemo, createdAt: nowIso(), updatedAt: nowIso(), completedAt: undefined });
    for (const t of copyTables) if (remapped[t]!.length) await database.table(t).bulkAdd(remapped[t]!);
  });
  await audit('case.duplicate', { caseId: newId, detail: `from ${original.code}` }, database);
  return newId;
}

const LINK_FIELDS = ['drpId', 'interventionId', 'followUpId', 'sourceId'] as const;

/** Give every row a new id and caseId while keeping intra-case links (drpId, sourceId, …) consistent. */
export function remapRows(byTable: Record<string, Array<Record<string, unknown>>>, newCaseId: string): Record<string, Array<Record<string, unknown>>> {
  const map = new Map<string, string>();
  for (const rows of Object.values(byTable)) for (const r of rows) map.set(String(r.id), uid());
  const out: Record<string, Array<Record<string, unknown>>> = {};
  for (const [table, rows] of Object.entries(byTable)) {
    out[table] = rows.map((r) => {
      const copy: Record<string, unknown> = { ...r, id: map.get(String(r.id)), caseId: newCaseId };
      for (const f of LINK_FIELDS) if (typeof copy[f] === 'string' && map.has(copy[f] as string)) copy[f] = map.get(copy[f] as string);
      return copy;
    });
  }
  return out;
}

export async function touchCase(caseId: string, patch: Partial<CaseRecord> = {}, database: PreceptorDB = db) {
  await database.cases.update(caseId, { ...patch, updatedAt: nowIso() });
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** JSON export of one case. Images are included as data URLs only when requested. */
export async function exportCase(caseId: string, includeImages = false, database: PreceptorDB = db): Promise<Record<string, unknown>> {
  const record = await database.cases.get(caseId);
  const out: Record<string, unknown> = { format: 'preceptor-case', version: 1, exportedAt: nowIso(), case: record };
  for (const t of CASE_TABLES) {
    if (t === 'images' && !includeImages) continue;
    let rows = await database.table(t).where('caseId').equals(caseId).toArray();
    if (t === 'images') rows = await Promise.all(rows.map(async (r: SourceImage) => ({ ...r, blob: await blobToDataUrl(r.blob) })));
    if (t === 'sources') rows = rows.map((r: CaseSource) => ({ ...r, audio: undefined }));
    out[t] = rows;
  }
  return out;
}

export async function exportAll(database: PreceptorDB = db): Promise<Record<string, unknown>> {
  const cases = await database.cases.toArray();
  return {
    format: 'preceptor-backup',
    version: 1,
    exportedAt: nowIso(),
    cases: await Promise.all(cases.map((c) => exportCase(c.id, false, database))),
    rotations: await database.rotations.toArray(),
    competencies: await database.competencies.toArray(),
    gaps: await database.gaps.toArray(),
    trainingAnswers: await database.answers.where('context').equals('training').toArray(),
    reflections: await database.reflections.filter((r) => !r.caseId).toArray(),
  };
}

/** Import a single-case export as a new case (new ids, new code). */
export async function importCase(json: Record<string, unknown>, database: PreceptorDB = db): Promise<string> {
  if (json.format !== 'preceptor-case' || !json.case) throw new Error('Not a PRECEPTOR case export');
  const newId = uid();
  const code = await nextCaseCode(database);
  const original = json.case as CaseRecord;
  const byTable: Record<string, Array<Record<string, unknown>>> = {};
  // Images are not imported (re-capture on the device); everything else keeps its links.
  for (const t of CASE_TABLES) if (t !== 'images') byTable[t] = (json[t] as Array<Record<string, unknown>> | undefined) ?? [];
  const remapped = remapRows(byTable, newId);
  await database.transaction('rw', [database.cases, ...CASE_TABLES.map((t) => database.table(t))], async () => {
    await database.cases.add({ ...original, id: newId, code, createdAt: nowIso(), updatedAt: nowIso() });
    for (const [t, rows] of Object.entries(remapped)) if (rows.length) await database.table(t).bulkAdd(rows);
  });
  await audit('case.import', { caseId: newId, detail: `imported as ${code}` }, database);
  return newId;
}

export async function deleteAllLocalData(database: PreceptorDB = db): Promise<void> {
  await database.transaction('rw', database.tables, async () => {
    for (const t of database.tables) await t.clear();
  });
}
