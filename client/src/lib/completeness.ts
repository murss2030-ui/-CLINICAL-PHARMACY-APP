// CASE COMPLETENESS. Never reports 100 % while required information is missing.
import { isVerified, type CaseBundle } from './bundle';

export interface CompletenessItem {
  key: string;
  label: string;
  done: boolean;
  hint: string;
}

export function caseCompleteness(b: CaseBundle): { percent: number; items: CompletenessItem[]; missing: string[] } {
  const c = b.case;
  const verifiedMeds = b.meds.filter(isVerified);
  const items: CompletenessItem[] = [
    { key: 'demographics', label: 'Demographics', done: c.age !== undefined && !!c.sex && c.sex !== 'Unknown' && c.weightKg !== undefined, hint: 'Age, sex and weight' },
    { key: 'history', label: 'History', done: b.profiles.some((p) => (p.key === 'chief_complaint' || p.key === 'hpi') && isVerified(p)), hint: 'Chief complaint or HPI' },
    { key: 'allergies', label: 'Allergies', done: Boolean(c.nkda) || b.allergies.some(isVerified), hint: 'Allergies or NKDA documented' },
    { key: 'medications', label: 'Medication list', done: verifiedMeds.length > 0, hint: 'At least one verified medication' },
    { key: 'conditions', label: 'Medical conditions', done: b.problems.some((p) => p.prov.verification !== 'rejected'), hint: 'Problem list' },
    { key: 'labs', label: 'Laboratory data', done: b.labs.some(isVerified), hint: 'Verified laboratory results' },
    { key: 'diagnostics', label: 'Diagnostics', done: Boolean(c.diagnosticsNotApplicable) || b.diagnostics.some(isVerified), hint: 'Diagnostics or marked not applicable' },
    { key: 'drps', label: 'DRP assessment', done: b.drps.some((d) => d.status !== 'needs_data') || Boolean(c.noDrpReasoning?.trim()), hint: 'At least one assessed DRP or documented "no DRP" reasoning' },
    { key: 'goals', label: 'Therapeutic goals', done: Boolean(c.goals?.trim()) || b.interventions.some((i) => i.goal?.trim()), hint: 'Goals of therapy' },
    { key: 'plan', label: 'Plan / interventions', done: b.interventions.some((i) => i.status !== 'rejected'), hint: 'At least one intervention' },
    { key: 'monitoring', label: 'Monitoring', done: b.monitoring.length > 0, hint: 'Monitoring plan' },
    { key: 'followup', label: 'Follow-up', done: b.followups.length > 0, hint: 'Follow-up scheduled' },
    { key: 'outcome', label: 'Outcome', done: Boolean(c.outcome?.trim()) || b.followups.some((f) => f.status !== 'pending' && Boolean(f.outcome?.trim())), hint: 'Documented outcome' },
  ];
  const done = items.filter((i) => i.done).length;
  const percent = Math.floor((done / items.length) * 100);
  return { percent, items, missing: items.filter((i) => !i.done).map((i) => i.label) };
}

/** Stage completion used by the stepper (derived from data, never self-reported). */
export function stageDone(b: CaseBundle): Record<string, boolean> {
  return {
    collect: b.meds.some(isVerified) || b.labs.some(isVerified) || b.profiles.some(isVerified),
    understand: b.problems.some((p) => p.prov.verification !== 'rejected'),
    assess: b.drps.length > 0 || Boolean(b.case.noDrpReasoning?.trim()),
    act: b.interventions.length > 0,
    monitor: b.monitoring.length > 0,
    followup: b.followups.length > 0,
    reflect: b.reflections.length > 0,
  };
}
