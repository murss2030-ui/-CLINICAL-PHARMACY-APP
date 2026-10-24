import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadBundle } from '@/lib/bundle';
import { db, deleteAllLocalData, deleteCase, duplicateCase, exportCase, importCase, nextCaseCode, PreceptorDB } from '@/lib/db';
import { commitExtraction } from '@/lib/pipeline';
import type { ExtractedItem } from '@/lib/types';
import { rejectItem, resolveConflict, verifyAllHighConfidence, verifyItem } from '@/lib/verify';
import { caseRecord } from './helpers';

let n = 0;
const ex = (kind: ExtractedItem['kind'], data: Record<string, string>, patch: Partial<ExtractedItem> = {}): ExtractedItem => ({ id: `e${++n}`, caseId: 'case-1', sourceId: 'src-1', kind, data, page: 1, confidence: 0.95, alternatives: [], status: 'pending', createdAt: new Date().toISOString(), ...patch });

beforeEach(async () => {
  await deleteAllLocalData();
  await db.cases.add(caseRecord());
  await db.sources.add({ id: 'src-1', caseId: 'case-1', code: 'SRC-01', type: 'admission_note', date: '2026-03-10', pageCount: 1, processing: 'extracted', createdAt: '', updatedAt: '' });
  await db.sources.add({ id: 'src-2', caseId: 'case-1', code: 'SRC-02', type: 'medication_order', date: '2026-03-10', pageCount: 1, processing: 'extracted', createdAt: '', updatedAt: '' });
});

describe('offline case storage (IndexedDB)', () => {
  it('assigns sequential anonymous case codes', async () => {
    const a = await nextCaseCode();
    const b = await nextCaseCode();
    expect(a).toMatch(/^CASE-\d{4}$/);
    expect(Number(b.slice(5))).toBe(Number(a.slice(5)) + 1);
  });

  it('commits a verified value with source, page, confidence and status', async () => {
    const item = ex('medication', { name: 'Warfarin', dose: '5', unit: 'mg', route: 'PO', frequency: 'daily', listType: 'home' }, { evidenceText: 'Warfarin 5 mg PO daily' });
    await commitExtraction('case-1', 'src-1', [item]);
    await verifyItem(item.id);
    const [m] = await db.medications.where('caseId').equals('case-1').toArray();
    expect(m).toMatchObject({ name: 'Warfarin', list: 'home', prov: { origin: 'extracted', sourceId: 'src-1', page: 1, confidence: 0.95, verification: 'verified', evidenceText: 'Warfarin 5 mg PO daily' } });
    expect((await db.extracted.get(item.id))!.status).toBe('verified');
  });

  it('records trainee corrections and updates demographics', async () => {
    const age = ex('demographic', { field: 'age', value: '87' }, { confidence: 0.62 });
    await commitExtraction('case-1', 'src-1', [age]);
    await verifyItem(age.id, { value: '78' });
    expect((await db.cases.get('case-1'))!.age).toBe(78);
    expect((await db.cases.get('case-1'))!.demographicsProv!.age!.verification).toBe('corrected');
  });

  it('never bulk-verifies low-confidence or conflicting items', async () => {
    const high = ex('lab', { name: 'Creatinine', value: '1.8', takenAt: '2026-03-10T08:40' });
    const low = ex('medication', { name: 'Ceftriaxone', listType: 'current' }, { confidence: 0.61, sourceId: 'src-2' });
    const w1 = ex('medication', { name: 'Warfarin', dose: '5', unit: 'mg', listType: 'current' });
    const w2 = ex('medication', { name: 'Warfarin', dose: '2.5', unit: 'mg', listType: 'current' }, { sourceId: 'src-2' });
    await commitExtraction('case-1', 'src-1', [high, w1]);
    await commitExtraction('case-1', 'src-2', [low, w2]);
    expect(await verifyAllHighConfidence('case-1')).toBe(1);
    expect((await db.extracted.get(low.id))!.status).toBe('pending');
    expect((await db.extracted.get(w1.id))!.status).toBe('pending');
  });

  it('resolving a conflict retracts an already-verified contradictory value', async () => {
    const w1 = ex('medication', { name: 'Warfarin', dose: '5', unit: 'mg', listType: 'current' });
    await commitExtraction('case-1', 'src-1', [w1]);
    await verifyItem(w1.id);
    const w2 = ex('medication', { name: 'Warfarin', dose: '2.5', unit: 'mg', listType: 'current' }, { sourceId: 'src-2' });
    await commitExtraction('case-1', 'src-2', [w2]);
    expect((await db.extracted.get(w2.id))!.conflictNote).toMatch(/CONFLICT/);
    await resolveConflict(w2.id, [w1.id]);
    const meds = await db.medications.where('caseId').equals('case-1').toArray();
    expect(meds.map((m) => [m.dose, m.prov.verification]).sort()).toEqual([
      ['2.5', 'verified'],
      ['5', 'rejected'],
    ]);
  });

  it('re-analysis replaces undecided items but keeps decided ones', async () => {
    const a = ex('lab', { name: 'INR', value: '4.2' });
    const b = ex('lab', { name: 'K', value: '5.4' });
    await commitExtraction('case-1', 'src-1', [a, b]);
    await verifyItem(a.id);
    await commitExtraction('case-1', 'src-1', [ex('lab', { name: 'K', value: '5.4' })]);
    const rows = await db.extracted.where('sourceId').equals('src-1').toArray();
    expect(rows.find((r) => r.id === a.id)!.status).toBe('verified');
    expect(rows.find((r) => r.id === b.id)).toBeUndefined();
    expect(rows).toHaveLength(2);
  });

  it('keeps data across a new database connection (app restart)', async () => {
    await db.drps.add({ id: 'd1', caseId: 'case-1', category: 'dose_too_high', description: 'INR 4.2', patientEvidence: ['INR 4.2'], priority: 'high', status: 'possible', origin: 'student', createdAt: '', updatedAt: '' });
    const reopened = new PreceptorDB('preceptor');
    await reopened.open();
    expect((await loadBundle(reopened, 'case-1'))!.drps).toHaveLength(1);
    reopened.close();
  });

  it('duplicates a case with consistent internal links', async () => {
    await db.drps.add({ id: 'd1', caseId: 'case-1', category: 'dose_too_high', description: 'x', patientEvidence: [], priority: 'high', status: 'possible', origin: 'student', createdAt: '', updatedAt: '' });
    await db.interventions.add({ id: 'i1', caseId: 'case-1', drpId: 'd1', type: 'dose_change', recommendation: 'reduce', status: 'draft', origin: 'student', createdAt: '', updatedAt: '' });
    const copyId = await duplicateCase('case-1');
    const copy = (await loadBundle(db, copyId))!;
    expect(copy.case.code).not.toBe('CASE-0001');
    expect(copy.interventions[0]!.drpId).toBe(copy.drps[0]!.id);
    expect(copy.drps[0]!.id).not.toBe('d1');
  });

  it('exports and imports a case without losing links', async () => {
    await db.drps.add({ id: 'd1', caseId: 'case-1', category: 'dose_too_high', description: 'x', patientEvidence: [], priority: 'high', status: 'possible', origin: 'student', createdAt: '', updatedAt: '' });
    await db.followups.add({ id: 'f1', caseId: 'case-1', drpId: 'd1', window: 'today', parameter: 'INR', status: 'pending', origin: 'student', createdAt: '' });
    const json = JSON.parse(JSON.stringify(await exportCase('case-1')));
    expect(json.format).toBe('preceptor-case');
    const newId = await importCase(json);
    const b = (await loadBundle(db, newId))!;
    expect(b.followups[0]!.drpId).toBe(b.drps[0]!.id);
  });

  it('deletes a case and everything attached to it', async () => {
    await db.labs.add({ id: 'l1', caseId: 'case-1', name: 'K', value: '5', prov: { origin: 'manual', verification: 'verified' }, createdAt: '' });
    await deleteCase('case-1');
    expect(await db.cases.get('case-1')).toBeUndefined();
    expect(await db.labs.where('caseId').equals('case-1').count()).toBe(0);
    expect(await db.sources.where('caseId').equals('case-1').count()).toBe(0);
  });

  it('rejecting keeps the item out of case data', async () => {
    const a = ex('allergy', { value: 'Penicillin' });
    await commitExtraction('case-1', 'src-1', [a]);
    await rejectItem(a.id);
    expect(await db.allergies.count()).toBe(0);
  });
});
