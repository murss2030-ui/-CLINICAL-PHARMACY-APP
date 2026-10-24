import { describe, expect, it } from 'vitest';
import { caseCompleteness, stageDone } from '@/lib/completeness';
import { dataCheck } from '@/lib/datacheck';
import { reconcile } from '@/lib/reconciliation';
import { estimateCrcl, safetyAlerts } from '@/lib/safety';
import type { ExtractedItem } from '@/lib/types';
import { allergy, bundle, caseRecord, lab, med } from './helpers';

const titles = (b: ReturnType<typeof bundle>) => safetyAlerts(b).map((a) => `${a.severity}:${a.category}:${a.title}`);

describe('safety layer (decision support alerts)', () => {
  it('flags a direct allergy class match in red', () => {
    const t = titles(bundle({ allergies: [allergy('Penicillin', 'anaphylaxis')], meds: [med('Amoxicillin', { dose: '500', unit: 'mg' })] }));
    expect(t.some((x) => x.startsWith('red:allergy'))).toBe(true);
  });
  it('treats penicillin allergy with a cephalosporin as a review, not a contraindication', () => {
    const a = safetyAlerts(bundle({ allergies: [allergy('Penicillin', 'rash')], meds: [med('Ceftriaxone')] }));
    expect(a.find((x) => x.category === 'allergy')?.severity).toBe('yellow');
  });
  it('flags sulfonamide antibiotic allergy against co-trimoxazole', () => {
    expect(titles(bundle({ allergies: [allergy('Sulfa drugs')], meds: [med('Co-trimoxazole')] })).some((x) => x.startsWith('red:allergy'))).toBe(true);
  });
  it('does not over-match unrelated allergies (heparin ≠ warfarin, carbamazepine ≠ ARB)', () => {
    const a = safetyAlerts(bundle({ allergies: [allergy('Heparin'), allergy('Carbamazepine')], meds: [med('Warfarin'), med('Losartan')] }));
    expect(a.filter((x) => x.category === 'allergy')).toHaveLength(0);
  });
  it('asks for allergy documentation when missing', () => {
    expect(titles(bundle({ meds: [med('Paracetamol')] })).some((x) => x.includes('Allergy status not documented'))).toBe(true);
    expect(titles(bundle({ case: caseRecord({ nkda: true }), meds: [med('Paracetamol')] })).some((x) => x.includes('Allergy status'))).toBe(false);
  });
  it('detects duplicate anticoagulation and warfarin + NSAID', () => {
    const t = titles(bundle({ case: caseRecord({ nkda: true }), meds: [med('Warfarin'), med('Enoxaparin'), med('Ibuprofen')] }));
    expect(t.some((x) => x.startsWith('orange:duplicate:Duplicate therapy: anticoagulants'))).toBe(true);
    expect(t.some((x) => x.startsWith('red:interaction:Warfarin + NSAID'))).toBe(true);
  });
  it('raises hyperkalaemia combination to red when potassium is high', () => {
    const a = safetyAlerts(bundle({ case: caseRecord({ nkda: true }), meds: [med('Lisinopril'), med('Spironolactone'), med('Potassium chloride')], labs: [lab('Potassium', '5.6', { unit: 'mmol/L' })] }));
    expect(a.find((x) => x.title === 'Hyperkalaemia risk combination')?.severity).toBe('red');
  });
  it('flags renally cleared drugs when CrCl is low', () => {
    const b = bundle({ case: caseRecord({ age: 78, sex: 'Female', weightKg: 58, nkda: true }), meds: [med('Metformin'), med('Enoxaparin')], labs: [lab('Creatinine', '1.8', { unit: 'mg/dL' })] });
    expect(Math.round(estimateCrcl(b)!)).toBe(24);
    const renal = safetyAlerts(b).find((a) => a.category === 'renal');
    expect(renal?.severity).toBe('orange');
    expect(renal?.medications).toEqual(['Metformin', 'Enoxaparin']);
  });
  it('flags critical laboratory values', () => {
    const t = titles(bundle({ case: caseRecord({ nkda: true }), labs: [lab('Potassium', '6.3'), lab('Platelets', '18'), lab('INR', '5.4')] }));
    expect(t.filter((x) => x.startsWith('red:critical_lab'))).toHaveLength(3);
  });
  it('flags missing monitoring (warfarin without INR)', () => {
    expect(titles(bundle({ case: caseRecord({ nkda: true }), meds: [med('Warfarin')] })).some((x) => x.includes('No INR documented'))).toBe(true);
  });
  it('ignores held, stopped and rejected medications', () => {
    const b = bundle({ case: caseRecord({ nkda: true }), meds: [med('Warfarin'), med('Ibuprofen', { status: 'held' }), med('Naproxen', { prov: { origin: 'extracted', verification: 'rejected' } })], labs: [lab('INR', '2.5')] });
    expect(safetyAlerts(b).some((a) => a.category === 'interaction')).toBe(false);
  });
});

describe('medication reconciliation', () => {
  const meds = [
    med('Lisinopril', { list: 'home', dose: '20', unit: 'mg', frequency: 'once daily' }),
    med('Lisinopril', { list: 'current', dose: '20', unit: 'mg', frequency: 'daily' }),
    med('Metformin', { list: 'home', dose: '1000', unit: 'mg', frequency: 'twice daily' }),
    med('Metformin', { list: 'current', dose: '500', unit: 'mg', frequency: 'BID' }),
    med('Furosemide', { list: 'home', dose: '40', unit: 'mg', route: 'PO', frequency: 'daily' }),
    med('Furosemide', { list: 'current', dose: '40', unit: 'mg', route: 'IV', frequency: 'twice daily' }),
    med('Atorvastatin', { list: 'home', dose: '20', unit: 'mg' }),
    med('Ibuprofen', { list: 'home', dose: '400', unit: 'mg' }),
    med('Ibuprofen', { list: 'current', status: 'held' }),
    med('Warfarin', { list: 'current', dose: '5', unit: 'mg' }),
    med('Enoxaparin', { list: 'current', dose: '40', unit: 'mg' }),
  ];
  const rows = reconcile(meds);
  const types = (name: string) => rows.find((r) => r.name === name)!.discrepancies.map((d) => d.type);

  it('treats equivalent frequency wording as unchanged', () => expect(types('Lisinopril')).toEqual([]));
  it('detects dose changes', () => expect(types('Metformin')).toContain('dose_change'));
  it('detects route and frequency changes', () => expect(types('Furosemide')).toEqual(expect.arrayContaining(['route_change', 'frequency_change'])));
  it('detects omissions', () => expect(types('Atorvastatin')).toContain('omission'));
  it('detects held medicines', () => expect(types('Ibuprofen')).toContain('held'));
  it('detects additions and therapeutic duplication', () => {
    expect(types('Warfarin')).toEqual(expect.arrayContaining(['addition', 'duplication']));
    expect(types('Enoxaparin')).toContain('duplication');
  });
  it('gives every discrepancy a stable key for the pharmacist decision', () => {
    const keys = rows.flatMap((r) => r.discrepancies.map((d) => d.key));
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('case completeness', () => {
  it('reports 0 % and lists everything missing for an empty case', () => {
    const r = caseCompleteness(bundle());
    expect(r.percent).toBe(0);
    expect(r.missing).toHaveLength(13);
  });
  it('never reaches 100 % while an element is missing', () => {
    const b = bundle({
      case: caseRecord({ age: 70, sex: 'Male', weightKg: 80, nkda: true, goals: 'INR 2–3', diagnosticsNotApplicable: true, outcome: 'Improved' }),
      profiles: [{ id: 'p', caseId: 'case-1', key: 'hpi', value: 'x', prov: { origin: 'manual', verification: 'verified' }, createdAt: '' }],
      meds: [med('Warfarin')],
      labs: [lab('INR', '2.4')],
      problems: [{ id: 'pr', caseId: 'case-1', name: 'AF', status: 'active', origin: 'student', prov: { origin: 'manual', verification: 'verified' }, createdAt: '' }],
      drps: [{ id: 'd', caseId: 'case-1', category: 'dose_too_high', description: 'x', patientEvidence: [], priority: 'high', status: 'confirmed', origin: 'student', createdAt: '', updatedAt: '' }],
      interventions: [{ id: 'i', caseId: 'case-1', type: 'dose_change', recommendation: 'x', status: 'accepted', origin: 'student', createdAt: '', updatedAt: '' }],
      monitoring: [{ id: 'm', caseId: 'case-1', parameter: 'INR', category: 'laboratory', origin: 'student', createdAt: '' }],
    });
    const partial = caseCompleteness(b);
    expect(partial.percent).toBeLessThan(100);
    expect(partial.missing).toEqual(['Follow-up']);
    const full = caseCompleteness({ ...b, followups: [{ id: 'f', caseId: 'case-1', window: 'today', parameter: 'INR', status: 'pending', origin: 'student', createdAt: '' }] });
    expect(full.percent).toBe(100);
  });
  it('derives stage completion from data, not self-report', () => {
    expect(stageDone(bundle()).collect).toBe(false);
    expect(stageDone(bundle({ meds: [med('X')] })).collect).toBe(true);
  });
});

describe('data check', () => {
  const pendingInr: ExtractedItem = { id: 'e1', caseId: 'case-1', sourceId: 's', kind: 'lab', data: { name: 'INR', value: '4.2' }, confidence: 0.9, alternatives: [], status: 'pending', createdAt: '' };
  it('requires INR when the patient takes warfarin and explains why', () => {
    const item = dataCheck(bundle({ meds: [med('Warfarin')] })).find((i) => i.key === 'inr')!;
    expect(item.state).toBe('missing');
    expect(item.why).toMatch(/anticoagulation status and safety/);
  });
  it('distinguishes needs-verification from known', () => {
    expect(dataCheck(bundle({ meds: [med('Warfarin')], extracted: [pendingInr] })).find((i) => i.key === 'inr')!.state).toBe('needs_verification');
    expect(dataCheck(bundle({ meds: [med('Warfarin')], labs: [lab('INR', '2.5')] })).find((i) => i.key === 'inr')!.state).toBe('known');
  });
  it('adapts required data to the department', () => {
    const onc = dataCheck(bundle({ case: caseRecord({ department: 'hematology' }) })).map((i) => i.key);
    expect(onc).toEqual(expect.arrayContaining(['anc', 'uric_acid', 'height']));
  });
});
