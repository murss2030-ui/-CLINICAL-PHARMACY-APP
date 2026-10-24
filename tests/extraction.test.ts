import { describe, expect, it } from 'vitest';
import { drpAnalysisSchema, imageAnalysisSchema, labExtractionSchema, medicationExtractionSchema, patientExtractionSchema } from '@shared/ai';
import { DEMO_CASES, demoImageAnalysis, demoLabExtraction, demoMedicationExtraction, demoPatientExtraction } from '@shared/demo';
import { confidenceBand, uncertaintyLabel } from '@shared/domain';
import { activeConflict, detectDuplicatesAndConflicts } from '@/lib/dedupe';
import { medsToItems, patientToItems } from '@/lib/pipeline';
import type { ExtractedItem } from '@/lib/types';
import { bulkEligible } from '@/lib/verify';
import { guardDrpAnalysis, guardLabExtraction, guardMedicationExtraction, LINK_REPLACEMENT, normalizeConfidence, stripLinks } from '../server/src/ai/guards';
import { caseRecord, med } from './helpers';

let k = 0;
function item(kind: ExtractedItem['kind'], data: Record<string, string>, patch: Partial<ExtractedItem> = {}): ExtractedItem {
  return { id: `x${++k}`, caseId: 'case-1', sourceId: patch.sourceId ?? 'srcA', kind, data, confidence: 0.95, alternatives: [], status: 'pending', createdAt: '', ...patch };
}
const ctx = (existing: ExtractedItem[] = [], extra: Partial<Parameters<typeof detectDuplicatesAndConflicts>[1]> = {}) => ({ existing, meds: [], labs: [], allergies: [], sourceLabel: (id: string) => id, ...extra });

describe('confidence handling', () => {
  it('uses the specified bands', () => {
    expect(confidenceBand(0.85)).toBe('high');
    expect(confidenceBand(0.849)).toBe('review');
    expect(confidenceBand(0.6)).toBe('review');
    expect(confidenceBand(0.599)).toBe('low');
    expect(uncertaintyLabel(0.61)).toBe('POSSIBLE');
    expect(uncertaintyLabel(0.4)).toBe('UNCERTAIN');
  });
  it('only lets high-confidence, unflagged items be bulk-verified', () => {
    const a = item('medication', { name: 'Metformin', dose: '1000', unit: 'mg' });
    const low = item('medication', { name: 'Ceftriaxone' }, { confidence: 0.61, handwritten: true });
    const review = item('lab', { name: 'K', value: '5.4' }, { confidence: 0.84 });
    expect(bulkEligible(a, [a, low, review])).toBe(true);
    expect(bulkEligible(low, [a, low, review])).toBe(false);
    expect(bulkEligible(review, [a, low, review])).toBe(false);
  });
  it('normalises model confidences given as percentages and clamps them', () => {
    expect(normalizeConfidence(97)).toBe(0.97);
    expect(normalizeConfidence(1.5e3)).toBe(1);
    expect(normalizeConfidence(-1)).toBe(0);
    expect(normalizeConfidence(Number.NaN)).toBe(0);
  });
});

describe('duplicate and conflict detection', () => {
  it('detects the warfarin 5 mg vs 2.5 mg conflict and never chooses a value', () => {
    const a = item('medication', { name: 'Warfarin', dose: '5', unit: 'mg', route: 'PO', frequency: 'daily', listType: 'current' }, { sourceId: 'note' });
    const b = item('medication', { name: 'Warfarin', dose: '2.5', unit: 'mg', route: 'PO', frequency: 'once daily', listType: 'current' }, { sourceId: 'orders' });
    const { items, updates } = detectDuplicatesAndConflicts([b], ctx([a]));
    expect(items[0]!.conflictWith).toEqual([a.id]);
    expect(items[0]!.conflictNote).toMatch(/CONFLICT/);
    expect(updates).toEqual([expect.objectContaining({ id: a.id, conflictWith: [b.id] })]);
    expect(items[0]!.status).toBe('pending');
    expect(activeConflict(items[0]!, [{ ...a, conflictWith: [b.id] }, items[0]!])).toBe(true);
    expect(activeConflict(items[0]!, [{ ...a, status: 'rejected' }, items[0]!])).toBe(false);
  });
  it('does not call a home-vs-inpatient change a conflict (that is reconciliation)', () => {
    const home = item('medication', { name: 'Warfarin', dose: '5', unit: 'mg', listType: 'home' });
    const cur = item('medication', { name: 'Warfarin', dose: '2.5', unit: 'mg', listType: 'current' });
    const { items } = detectDuplicatesAndConflicts([cur], ctx([home]));
    expect(items[0]!.conflictWith).toEqual([]);
  });
  it('flags exact duplicates across sources (1 g = 1000 mg, q24h = daily)', () => {
    const a = item('medication', { name: 'Ceftriaxone', dose: '1', unit: 'g', route: 'IV', frequency: 'q24h', listType: 'current' });
    const b = item('medication', { name: 'ceftriaxone', dose: '1000', unit: 'mg', route: 'intravenous', frequency: 'once daily', listType: 'unknown' });
    expect(detectDuplicatesAndConflicts([b], ctx([a])).items[0]!.duplicateOf).toBe(a.id);
  });
  it('compares labs only at the same time point', () => {
    const a = item('lab', { name: 'Creatinine', value: '1.8', takenAt: '2026-03-10T08:40' });
    const same = item('lab', { name: 'Serum creatinine', value: '1.8', takenAt: '2026-03-10 08:40' });
    const diff = item('lab', { name: 'Creatinine', value: '2.6', takenAt: '2026-03-10T08:55' });
    const later = item('lab', { name: 'Creatinine', value: '2.1', takenAt: '2026-03-11T06:00' });
    const r = detectDuplicatesAndConflicts([same, diff, later], ctx([a])).items;
    expect(r[0]!.duplicateOf).toBe(a.id);
    expect(r[1]!.conflictWith).toContain(a.id);
    expect(r[2]!.duplicateOf).toBeUndefined();
    expect(r[2]!.conflictWith).toEqual([]);
  });
  it('treats an allergy and "no known drug allergies" as a conflict', () => {
    const nkda = item('nkda', { value: 'NKDA' });
    const pen = item('allergy', { value: 'Penicillin' });
    expect(detectDuplicatesAndConflicts([pen], ctx([nkda])).items[0]!.conflictWith).toContain(nkda.id);
  });
  it('compares against data already committed to the case', () => {
    const r = detectDuplicatesAndConflicts([item('medication', { name: 'Warfarin', dose: '2.5', unit: 'mg', listType: 'current' })], ctx([], { meds: [med('Warfarin', { dose: '5', unit: 'mg' })] }));
    expect(r.items[0]!.conflictNote).toMatch(/CONFLICT with case medication list/);
    const d = detectDuplicatesAndConflicts([item('demographic', { field: 'age', value: '78' })], ctx([], { caseRecord: caseRecord({ age: 78 }) }));
    expect(d.items[0]!.duplicateNote).toMatch(/Matches/);
  });
});

describe('extraction schemas and conversion', () => {
  it('accepts a well-formed extraction with provenance fields', () => {
    const parsed = medicationExtractionSchema.parse({ medications: [{ name: 'Warfarin', dose: '5', unit: 'mg', page: 1, confidence: 0.97, evidenceText: 'Warfarin 5 mg', listType: 'home' }] });
    const [x] = medsToItems('case-1', 'src', parsed);
    expect(x).toMatchObject({ kind: 'medication', page: 1, confidence: 0.97, status: 'pending', sourceId: 'src' });
  });
  it('rejects malformed AI output', () => {
    expect(labExtractionSchema.safeParse({ labs: [{ name: 'K' }] }).success).toBe(false);
    expect(drpAnalysisSchema.safeParse({ drps: [{ category: 'made_up', description: 'x' }] }).success).toBe(false);
    expect(drpAnalysisSchema.safeParse({ drps: [{ category: 'dose_too_high', description: 'x', clinicalSignificance: 'x', priority: 'high', evidenceBasis: 'x', suggestedAction: 'x', confidence: 0.9, status: 'confirmed' }] }).success).toBe(false);
  });
  it('maps patient fields to verification kinds', () => {
    const items = patientToItems('c', 's', patientExtractionSchema.parse({ items: [
      { field: 'age', value: '78', confidence: 0.95 },
      { field: 'allergy', value: 'Penicillin', detail: 'rash', confidence: 0.9 },
      { field: 'vital', value: '38.6', unit: '°C', detail: 'Temp', confidence: 0.9 },
      { field: 'diagnosis', value: 'CAP', confidence: 0.9 },
    ] }));
    expect(items.map((i) => i.kind)).toEqual(['demographic', 'allergy', 'vital', 'diagnosis']);
    expect(items[1]!.data.reaction).toBe('rash');
  });
  it('lowers confidence for values not found verbatim in the source text', () => {
    const warnings: string[] = [];
    const r = guardLabExtraction(labExtractionSchema.parse({ labs: [{ name: 'Creatinine', value: '1.8', confidence: 0.98 }, { name: 'Potassium', value: '9.9', confidence: 0.97 }] }), 'Creatinine | 1.8 | mg/dL', warnings);
    expect(r.labs[0]!.confidence).toBe(0.98);
    expect(r.labs[1]!.confidence).toBeLessThan(0.6);
    expect(warnings.join()).toMatch(/not found verbatim/);
    const m = guardMedicationExtraction(medicationExtractionSchema.parse({ medications: [{ name: 'Invented-drug', confidence: 99 }] }), 'Warfarin 5 mg', []);
    expect(m.medications[0]!.confidence).toBeLessThan(0.6);
  });
  it('removes links and DOIs so AI text can never look like a checked source', () => {
    const w: string[] = [];
    const out = stripLinks({ a: 'See https://example.org/guideline and doi:10.1000/xyz123 for details' }, w);
    expect(out.a).not.toMatch(/https?:|doi/);
    expect(out.a).toContain(LINK_REPLACEMENT);
    expect(w).toHaveLength(1);
  });
  it('downgrades DRPs naming medications that are not in the case', () => {
    const data = drpAnalysisSchema.parse({ drps: [
      { category: 'dose_too_high', medication: 'Warfarin', description: 'x', clinicalSignificance: 'x', priority: 'high', evidenceBasis: 'x', suggestedAction: 'x', confidence: 0.9, status: 'possible' },
      { category: 'drug_interaction', medication: 'Amiodarone', description: 'x', clinicalSignificance: 'x', priority: 'high', evidenceBasis: 'x', suggestedAction: 'x', confidence: 0.9, status: 'possible' },
      { category: 'needs_additional_therapy', medication: 'Insulin', description: 'x', clinicalSignificance: 'x', priority: 'medium', evidenceBasis: 'x', suggestedAction: 'x', confidence: 0.7, status: 'possible' },
    ] });
    const ctx2 = { caseCode: 'C', department: 'internal_medicine', medications: [{ name: 'Warfarin 5 mg tablet', list: 'current' as const, status: 'active' as const, verified: true }] } as never;
    const w: string[] = [];
    const r = guardDrpAnalysis(data, ctx2, w);
    expect(r.drps[0]!.status).toBe('possible');
    expect(r.drps[1]!.status).toBe('needs_data');
    expect(r.drps[1]!.confidence).toBeLessThanOrEqual(0.4);
    expect(r.drps[2]!.status).toBe('possible');
    expect(w).toHaveLength(1);
  });
});

describe('synthetic demo data integrity', () => {
  it.each(DEMO_CASES.map((c) => [c.key, c] as const))('%s: scripted responses satisfy the AI contracts', (_k, c) => {
    for (const doc of c.docs) {
      expect(imageAnalysisSchema.safeParse(demoImageAnalysis(doc)).success).toBe(true);
      expect(patientExtractionSchema.safeParse(demoPatientExtraction(doc)).success).toBe(true);
      expect(medicationExtractionSchema.safeParse(demoMedicationExtraction(doc)).success).toBe(true);
      expect(labExtractionSchema.safeParse(demoLabExtraction(doc)).success).toBe(true);
    }
    expect(drpAnalysisSchema.safeParse(c.drps).success).toBe(true);
    // Demo DRPs only name medications present in the synthetic documents.
    const names = c.docs.flatMap((d) => d.meds ?? []).map((m) => m.name.toLowerCase());
    for (const d of c.drps.drps) if (d.medication && d.category !== 'needs_additional_therapy') expect(names.some((n) => n.startsWith(d.medication!.toLowerCase().split(' ')[0]!))).toBe(true);
  });
  it('includes a handwritten low-confidence reading and a dose conflict to practise verification', () => {
    const im = DEMO_CASES[0]!;
    const meds = im.docs.flatMap((d) => d.meds ?? []);
    expect(meds.some((m) => m.confidence < 0.65 && (m.alternatives ?? []).length > 0)).toBe(true);
    const warfarinCurrent = meds.filter((m) => m.name === 'Warfarin' && m.listType === 'current').map((m) => m.dose);
    expect(new Set(warfarinCurrent).size).toBe(2);
  });
});
