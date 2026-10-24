// Builds the compact, de-identified case context sent to the AI.
// Only anonymous case codes are used; rejected data is excluded and
// unverified data is marked so the model treats it as uncertain.
import type { CaseContext } from '@shared/ai';
import { activeMeds, profileValue, type CaseBundle } from './bundle';
import { bmi, bsaMosteller, egfrCkdEpi2021 } from './calculators';
import { latestLab } from './labs';
import { estimateCrcl } from './safety';
import type { Provenance } from './types';

const ok = (p: { prov: Provenance }) => p.prov.verification !== 'rejected';
const verified = (p: { prov: Provenance }) => p.prov.verification === 'verified' || p.prov.verification === 'corrected';
const cut = (s: string | undefined, n: number) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s);
const round = (n: number | undefined, d = 1) => (n === undefined || !Number.isFinite(n) ? undefined : Math.round(n * 10 ** d) / 10 ** d);

export function buildCaseContext(b: CaseBundle, opts: { notes?: string } = {}): CaseContext {
  const c = b.case;
  const scr = latestLab(b.labs.filter(ok), 'creatinine');
  const sexKnown = c.sex === 'Female' || c.sex === 'Male';
  const active = new Set(activeMeds(b).map((m) => m.id));
  return {
    caseCode: c.code,
    department: c.department,
    demographics: {
      age: c.age,
      sex: c.sex,
      weightKg: c.weightKg,
      heightCm: c.heightCm,
    },
    history: {
      chiefComplaint: cut(profileValue(b, 'chief_complaint'), 3000),
      hpi: cut(profileValue(b, 'hpi'), 6000),
      pmh: cut(profileValue(b, 'pmh'), 3000),
      socialHistory: cut(profileValue(b, 'social_history'), 2000),
      familyHistory: cut(profileValue(b, 'family_history'), 2000),
      physicalExam: cut(profileValue(b, 'physical_exam'), 3000),
    },
    allergies: b.allergies.filter(ok).slice(0, 60).map((a) => ({ substance: a.substance, reaction: a.reaction, verified: verified(a) })),
    nkda: c.nkda,
    medications: b.meds
      .filter(ok)
      .slice(0, 150)
      .map((m) => ({
        name: m.name,
        dose: [m.dose, m.unit].filter(Boolean).join(' ') || undefined,
        route: m.route,
        frequency: m.frequency,
        indication: m.indication,
        list: m.list,
        status: active.has(m.id) ? 'active' : m.status,
        startDate: m.startDate,
        verified: verified(m),
      })),
    labs: b.labs.filter(ok).slice(-300).map((l) => ({ name: l.name, value: l.value, unit: l.unit, takenAt: l.takenAt, flag: l.flag, verified: verified(l) })),
    vitals: b.vitals.filter(ok).slice(-120).map((v) => ({ type: v.type, value: `${v.value}${v.unit ? ` ${v.unit}` : ''}`, takenAt: v.takenAt })),
    diagnostics: b.diagnostics.filter(ok).slice(0, 60).map((d) => ({ type: d.type, result: cut(d.result, 2000)!, date: d.date })),
    problems: b.problems.filter(ok).slice(0, 60).map((p) => ({ name: p.name, status: p.status, priority: p.priority })),
    calculated: {
      crclMlMin: round(estimateCrcl(b), 0),
      egfr: scr && c.age && sexKnown ? round(egfrCkdEpi2021({ age: c.age, scrMgDl: scr.value, sex: c.sex as 'Female' | 'Male' }), 0) : undefined,
      bmi: c.weightKg && c.heightCm ? round(bmi(c.weightKg, c.heightCm)) : undefined,
      bsa: c.weightKg && c.heightCm ? round(bsaMosteller(c.weightKg, c.heightCm), 2) : undefined,
    },
    drps: b.drps
      .filter((d) => d.status !== 'not_supported')
      .slice(0, 40)
      .map((d) => ({ category: d.category, medication: d.medication, description: cut(d.description, 1500)!, status: d.status })),
    interventions: b.interventions.slice(0, 40).map((i) => ({ type: i.type, recommendation: cut(i.recommendation, 1500)!, status: i.status })),
    notes: cut(opts.notes, 60_000),
  };
}
