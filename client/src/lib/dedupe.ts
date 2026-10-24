// Duplicate and conflict detection for extracted data.
// Duplicates: the same fact captured twice (kept once after verification).
// Conflicts: the same item with different values in different sources —
// never auto-resolved; the trainee must verify which value is correct.
import { canonicalLab, numericValue } from './labs';
import { normalizeDose, normalizeFrequency, normalizeName, normalizeRoute, sameDrug } from './meds';
import type { Allergy, CaseRecord, ExtractedItem, LabResult, Medication } from './types';

export interface DetectionContext {
  /** Previously extracted items for the case (any status except rejected are considered). */
  existing: ExtractedItem[];
  meds: Medication[];
  labs: LabResult[];
  allergies: Allergy[];
  caseRecord?: CaseRecord;
  sourceLabel: (sourceId: string) => string;
}

type Group = 'home' | 'inpatient' | 'discharge';
const listGroup = (list?: string): Group => (list === 'home' ? 'home' : list === 'discharge' ? 'discharge' : 'inpatient');

const where = (item: ExtractedItem, ctx: DetectionContext) => `${ctx.sourceLabel(item.sourceId)}${item.page ? ` p${item.page}` : ''}`;

export function describeMed(d: Record<string, string | undefined>): string {
  return [d.name, d.dose && `${d.dose}${d.unit ? ` ${d.unit}` : ''}`, d.route, d.frequency].filter(Boolean).join(' ');
}

type Comparison = 'duplicate' | 'conflict' | 'different';

function compareMed(a: Record<string, string | undefined>, b: Record<string, string | undefined>): Comparison {
  if (!a.name || !b.name || !sameDrug(a.name, b.name)) return 'different';
  if (listGroup(a.listType ?? a.list) !== listGroup(b.listType ?? b.list)) return 'different';
  const da = normalizeDose(a.dose, a.unit);
  const dbb = normalizeDose(b.dose, b.unit);
  const fa = normalizeFrequency(a.frequency);
  const fb = normalizeFrequency(b.frequency);
  const ra = normalizeRoute(a.route);
  const rb = normalizeRoute(b.route);
  if ((da && dbb && da !== dbb) || (fa && fb && fa !== fb) || (ra && rb && ra !== rb)) return 'conflict';
  return 'duplicate';
}

const hourKey = (t?: string) => (t ? t.replace(' ', 'T').slice(0, 13) : undefined);

function compareLab(a: Record<string, string | undefined>, b: Record<string, string | undefined>): Comparison {
  const ka = canonicalLab(a.name ?? '');
  const kb = canonicalLab(b.name ?? '');
  if (!ka || ka !== kb) return normalizeName(a.name ?? '') === normalizeName(b.name ?? '') && a.takenAt === b.takenAt && a.value === b.value ? 'duplicate' : 'different';
  const ta = hourKey(a.takenAt);
  const tb = hourKey(b.takenAt);
  if (!ta || !tb || ta !== tb) return 'different';
  return numericValue(a.value) === numericValue(b.value) ? 'duplicate' : 'conflict';
}

function compareItems(a: ExtractedItem, b: ExtractedItem): Comparison {
  if (a.kind === 'medication' && b.kind === 'medication') return compareMed(a.data, b.data);
  if (a.kind === 'lab' && b.kind === 'lab') return compareLab(a.data, b.data);
  if ((a.kind === 'allergy' && b.kind === 'nkda') || (a.kind === 'nkda' && b.kind === 'allergy')) return 'conflict';
  if (a.kind !== b.kind) return 'different';
  const va = normalizeName(a.data.value ?? '');
  const vb = normalizeName(b.data.value ?? '');
  switch (a.kind) {
    case 'allergy':
      return va && vb && (va.includes(vb) || vb.includes(va)) ? 'duplicate' : 'different';
    case 'nkda':
      return 'duplicate';
    case 'demographic':
      if (a.data.field !== b.data.field) return 'different';
      return numericValue(a.data.value) !== undefined && numericValue(a.data.value) === numericValue(b.data.value) ? 'duplicate' : va === vb ? 'duplicate' : 'conflict';
    case 'vital':
      return normalizeName(a.data.type ?? '') === normalizeName(b.data.type ?? '') && hourKey(a.data.takenAt) === hourKey(b.data.takenAt) && va === vb ? 'duplicate' : 'different';
    case 'history':
      return a.data.key === b.data.key && va === vb ? 'duplicate' : 'different';
    case 'diagnosis':
    case 'diagnostic':
      return va === vb ? 'duplicate' : 'different';
    default:
      return 'different';
  }
}

export interface DetectionResult {
  items: ExtractedItem[];
  /** Existing pending items that now conflict with a new item. */
  updates: Array<{ id: string; conflictWith: string[]; conflictNote: string }>;
}

export function detectDuplicatesAndConflicts(newItems: ExtractedItem[], ctx: DetectionContext): DetectionResult {
  const updates = new Map<string, { id: string; conflictWith: string[]; conflictNote: string }>();
  const pool: ExtractedItem[] = ctx.existing.filter((e) => e.status !== 'rejected');
  const result: ExtractedItem[] = [];

  for (const raw of newItems) {
    const item: ExtractedItem = { ...raw, conflictWith: [...(raw.conflictWith ?? [])] };
    for (const other of pool) {
      const cmp = compareItems(item, other);
      if (cmp === 'duplicate' && !item.duplicateOf) {
        item.duplicateOf = other.id;
        item.duplicateNote = `Already captured from ${where(other, ctx)}.`;
      } else if (cmp === 'conflict') {
        item.conflictWith!.push(other.id);
        const note = `CONFLICT: ${summarize(item)} (${where(item, ctx)}) vs ${summarize(other)} (${where(other, ctx)}).`;
        item.conflictNote = note;
        if (other.status === 'pending') {
          const prev = updates.get(other.id) ?? { id: other.id, conflictWith: [...(other.conflictWith ?? [])], conflictNote: note };
          prev.conflictWith.push(item.id);
          prev.conflictNote = note;
          updates.set(other.id, prev);
        }
      }
    }
    // Compare with data already committed to the case.
    if (!item.duplicateOf && !item.conflictNote) {
      const committed = compareWithCase(item, ctx);
      if (committed?.type === 'duplicate') item.duplicateNote = committed.note;
      if (committed?.type === 'conflict') item.conflictNote = committed.note;
    }
    result.push(item);
    pool.push(item);
  }
  return { items: result, updates: [...updates.values()] };
}

function summarize(item: ExtractedItem): string {
  if (item.kind === 'medication') return describeMed(item.data);
  if (item.kind === 'lab') return `${item.data.name} ${item.data.value}${item.data.unit ? ` ${item.data.unit}` : ''}`;
  if (item.kind === 'nkda') return 'No known drug allergies';
  if (item.kind === 'allergy') return `Allergy: ${item.data.value}`;
  return `${item.data.field ?? item.kind}: ${item.data.value}`;
}

function compareWithCase(item: ExtractedItem, ctx: DetectionContext): { type: 'duplicate' | 'conflict'; note: string } | undefined {
  if (item.kind === 'medication') {
    for (const m of ctx.meds) {
      if (m.prov.verification === 'rejected') continue;
      const cmp = compareMed(item.data, { name: m.name, dose: m.dose, unit: m.unit, route: m.route, frequency: m.frequency, list: m.list });
      if (cmp === 'duplicate') return { type: 'duplicate', note: `Already in the case medication list (${describeMed({ name: m.name, dose: m.dose, unit: m.unit, route: m.route, frequency: m.frequency })}).` };
      if (cmp === 'conflict') return { type: 'conflict', note: `CONFLICT with case medication list: ${describeMed({ name: m.name, dose: m.dose, unit: m.unit, route: m.route, frequency: m.frequency })} vs ${describeMed(item.data)}.` };
    }
  }
  if (item.kind === 'lab') {
    for (const l of ctx.labs) {
      if (l.prov.verification === 'rejected') continue;
      const cmp = compareLab(item.data, { name: l.name, value: l.value, unit: l.unit, takenAt: l.takenAt });
      if (cmp === 'duplicate') return { type: 'duplicate', note: 'Already in the case laboratory results.' };
      if (cmp === 'conflict') return { type: 'conflict', note: `CONFLICT with case laboratory result ${l.name} ${l.value}${l.unit ? ` ${l.unit}` : ''} at the same time.` };
    }
  }
  if (item.kind === 'allergy') {
    if (ctx.caseRecord?.nkda) return { type: 'conflict', note: 'CONFLICT: the case records no known drug allergies.' };
    const v = normalizeName(item.data.value ?? '');
    if (ctx.allergies.some((a) => normalizeName(a.substance) === v)) return { type: 'duplicate', note: 'Allergy already recorded.' };
  }
  if (item.kind === 'nkda' && ctx.allergies.some((a) => a.prov.verification !== 'rejected')) {
    return { type: 'conflict', note: 'CONFLICT: allergies are already recorded for this case.' };
  }
  if (item.kind === 'demographic' && ctx.caseRecord) {
    const field = item.data.field as 'age' | 'sex' | 'weight_kg' | 'height_cm';
    const current = { age: ctx.caseRecord.age, sex: ctx.caseRecord.sex, weight_kg: ctx.caseRecord.weightKg, height_cm: ctx.caseRecord.heightCm }[field];
    if (current !== undefined && current !== null && String(current) !== '') {
      const same = typeof current === 'number' ? numericValue(item.data.value) === current : normalizeName(String(current)) === normalizeName(item.data.value ?? '');
      return same ? { type: 'duplicate', note: 'Matches the case record.' } : { type: 'conflict', note: `CONFLICT with case record: ${field.replace('_', ' ')} is ${current}.` };
    }
  }
  return undefined;
}

/**
 * A pending item is still in conflict while any counterpart has not been
 * rejected (accepting one value does not silently settle the other), or when
 * it conflicts with data already in the case.
 */
export function activeConflict(item: ExtractedItem, all: ExtractedItem[]): boolean {
  if (item.status !== 'pending') return false;
  if (item.conflictWith?.some((id) => { const o = all.find((x) => x.id === id); return o !== undefined && o.status !== 'rejected'; })) return true;
  return Boolean(item.conflictNote && !item.conflictWith?.length);
}
