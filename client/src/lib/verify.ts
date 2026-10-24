// VERIFICATION: the only path from extracted data to official case data.
// Low-confidence items (<60 %) can never be bulk-accepted; conflicts must be
// resolved explicitly by the trainee.
import { CONFIDENCE } from '@shared/domain';
import { audit, db, touchCase } from './db';
import { activeConflict } from './dedupe';
import { numericValue } from './labs';
import type { CaseRecord, ExtractedItem, MedList, Provenance, Sex } from './types';
import { nowIso, uid } from './utils';

function provFor(item: ExtractedItem, sourceLabel: string, corrected: boolean, demo: boolean): Provenance {
  return {
    origin: demo ? 'demo' : 'extracted',
    sourceId: item.sourceId,
    sourceLabel,
    page: item.page,
    confidence: item.confidence,
    verification: corrected ? 'corrected' : 'verified',
    verifiedAt: nowIso(),
    alternatives: item.alternatives,
    handwritten: item.handwritten,
    evidenceText: item.evidenceText,
  };
}

function normalizeSex(v?: string): Sex {
  const s = (v ?? '').trim().toLowerCase();
  if (['f', 'female', 'woman', 'أنثى', 'انثى'].includes(s)) return 'Female';
  if (['m', 'male', 'man', 'ذكر'].includes(s)) return 'Male';
  return s ? 'Other' : 'Unknown';
}

const LISTS: MedList[] = ['home', 'admission', 'current', 'discharge'];

/** Commit one item (optionally with trainee corrections) into the case tables. */
export async function verifyItem(itemId: string, edits?: Record<string, string | undefined>): Promise<void> {
  const item = await db.extracted.get(itemId);
  if (!item || item.status !== 'pending') return;
  const source = await db.sources.get(item.sourceId);
  const record = await db.cases.get(item.caseId);
  if (!record) return;
  const corrected = Boolean(edits && Object.entries(edits).some(([k, v]) => (item.data[k] ?? '') !== (v ?? '')));
  const data = { ...item.data, ...(edits ?? {}) };
  const prov = provFor(item, source ? `${source.code} · ${source.label || source.type}` : 'source', corrected, Boolean(record.isDemo));
  const caseId = item.caseId;
  const id = uid();
  const createdAt = nowIso();
  let table = '';

  await db.transaction('rw', [db.extracted, db.cases, db.medications, db.labs, db.vitals, db.allergies, db.profiles, db.problems, db.diagnostics], async () => {
    switch (item.kind) {
      case 'medication': {
        const list = LISTS.includes(data.listType as MedList) ? (data.listType as MedList) : 'current';
        const status = (['active', 'stopped', 'held'].includes(data.status ?? '') ? data.status : 'active') as 'active' | 'stopped' | 'held';
        await db.medications.add({ id, caseId, name: data.name ?? '', dose: data.dose, unit: data.unit, route: data.route, frequency: data.frequency, indication: data.indication, startDate: data.startDate, stopDate: data.stopDate, list, status, prov, createdAt });
        table = 'medications';
        break;
      }
      case 'lab':
        await db.labs.add({ id, caseId, name: data.name ?? '', value: data.value ?? '', unit: data.unit, refRange: data.refRange, flag: data.flag, takenAt: data.takenAt, prov, createdAt });
        table = 'labs';
        break;
      case 'vital':
        await db.vitals.add({ id, caseId, type: data.type ?? 'Vital', value: data.value ?? '', unit: data.unit, takenAt: data.takenAt, prov, createdAt });
        table = 'vitals';
        break;
      case 'allergy':
        await db.allergies.add({ id, caseId, substance: data.value ?? '', reaction: data.reaction, prov, createdAt });
        table = 'allergies';
        break;
      case 'nkda':
        await db.cases.update(caseId, { nkda: true, updatedAt: nowIso() });
        table = 'cases';
        break;
      case 'diagnosis':
        await db.problems.add({ id, caseId, name: data.value ?? '', status: 'active', origin: 'documented', prov, createdAt });
        table = 'problems';
        break;
      case 'diagnostic':
        await db.diagnostics.add({ id, caseId, type: data.type ?? 'Diagnostic', result: data.value ?? '', date: data.date, prov, createdAt });
        table = 'diagnostics';
        break;
      case 'history':
        await db.profiles.add({ id, caseId, key: (data.key ?? 'hpi') as never, value: data.value ?? '', prov, createdAt });
        table = 'profiles';
        break;
      case 'demographic': {
        const patch: Partial<CaseRecord> = { demographicsProv: { ...(record.demographicsProv ?? {}) } };
        const n = numericValue(data.value);
        const dp = patch.demographicsProv!;
        if (data.field === 'age' && n !== undefined) {
          patch.age = Math.round(n);
          dp.age = prov;
        } else if (data.field === 'weight_kg' && n !== undefined) {
          patch.weightKg = n;
          dp.weightKg = prov;
        } else if (data.field === 'height_cm' && n !== undefined) {
          patch.heightCm = n;
          dp.heightCm = prov;
        } else if (data.field === 'sex') {
          patch.sex = normalizeSex(data.value);
          dp.sex = prov;
        }
        await db.cases.update(caseId, { ...patch, updatedAt: nowIso() });
        table = 'cases';
        break;
      }
    }
    await db.extracted.update(itemId, { status: corrected ? 'corrected' : 'verified', data, decidedAt: nowIso(), committedRef: { table, id } });
  });
  await audit(corrected ? 'verify.corrected' : 'verify.accepted', { caseId, detail: `${item.kind}: ${data.name ?? data.value ?? ''}` });
}

export async function rejectItem(itemId: string, reason = 'rejected'): Promise<void> {
  const item = await db.extracted.get(itemId);
  if (!item || item.status !== 'pending') return;
  await db.extracted.update(itemId, { status: 'rejected', decidedAt: nowIso() });
  await audit('verify.rejected', { caseId: item.caseId, detail: `${item.kind} (${reason})` });
}

/** Items that may be accepted in bulk: high confidence, not a duplicate, no open conflict. */
export function bulkEligible(item: ExtractedItem, all: ExtractedItem[]): boolean {
  return item.status === 'pending' && item.confidence >= CONFIDENCE.high && !item.duplicateOf && !item.duplicateNote && !activeConflict(item, all);
}

export async function verifyAllHighConfidence(caseId: string): Promise<number> {
  const all = await db.extracted.where('caseId').equals(caseId).toArray();
  const eligible = all.filter((i) => bulkEligible(i, all));
  for (const item of eligible) await verifyItem(item.id);
  return eligible.length;
}

/** Duplicates are rejected as duplicates, keeping the first captured value. */
export async function rejectAllDuplicates(caseId: string): Promise<number> {
  const all = await db.extracted.where('caseId').equals(caseId).toArray();
  const dups = all.filter((i) => i.status === 'pending' && (i.duplicateOf || i.duplicateNote) && !activeConflict(i, all));
  for (const d of dups) await rejectItem(d.id, 'duplicate');
  return dups.length;
}

/**
 * Resolve a conflict by keeping one value (optionally corrected) and rejecting
 * the others. A counterpart that was already verified is retracted from case
 * data (marked rejected) so two contradictory values never coexist silently.
 */
export async function resolveConflict(keepId: string, rejectIds: string[], edits?: Record<string, string | undefined>): Promise<void> {
  await verifyItem(keepId, edits);
  for (const id of rejectIds) {
    const other = await db.extracted.get(id);
    if (!other) continue;
    if (other.status === 'pending') {
      await rejectItem(id, 'conflict resolved');
      continue;
    }
    if (other.status === 'rejected') continue;
    const ref = other.committedRef;
    if (ref && ref.table !== 'cases') {
      const row = (await db.table(ref.table).get(ref.id)) as { prov?: Provenance } | undefined;
      if (row?.prov) await db.table(ref.table).update(ref.id, { prov: { ...row.prov, verification: 'rejected' } });
    }
    await db.extracted.update(id, { status: 'rejected', decidedAt: nowIso() });
    await audit('verify.retracted', { caseId: other.caseId, detail: `${other.kind} replaced after conflict review` });
  }
}

export async function addManual<T extends { id: string; caseId: string }>(table: 'medications' | 'labs' | 'vitals' | 'allergies' | 'diagnostics' | 'profiles' | 'problems', row: Omit<T, 'id' | 'prov' | 'createdAt'> & Record<string, unknown>): Promise<string> {
  const id = uid();
  const prov: Provenance = { origin: 'manual', verification: 'verified', verifiedAt: nowIso() };
  await db.table(table).add({ ...row, id, prov, createdAt: nowIso() });
  await touchCase(row.caseId as string);
  await audit(`manual.${table}`, { caseId: row.caseId as string });
  return id;
}
