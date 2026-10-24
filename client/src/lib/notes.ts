// Documentation and communication generated from case data only.
// Structure: Problem → Evidence → Assessment → Recommendation → Rationale.
// Missing data is written as "not documented" — never invented.
import { departmentLabel } from '@shared/departments';
import { DRP_CATEGORY_LABEL, DRP_STATUS_LABEL, FOLLOWUP_STATUS_LABEL, INTERVENTION_TYPE_LABEL } from '@shared/domain';
import { activeMeds, profileValue, type CaseBundle } from './bundle';
import { reconcile, DISCREPANCY_LABEL } from './reconciliation';
import { estimateCrcl } from './safety';
import type { Drp, Intervention, ReconDecision } from './types';
import { formatDate } from './utils';

const ND = 'not documented';
const ok = (x: { prov: { verification: string } }) => x.prov.verification !== 'rejected';

function patientLine(b: CaseBundle): string {
  const c = b.case;
  const crcl = estimateCrcl(b);
  return [
    `${c.code}`,
    c.age !== undefined ? `${c.age}-year-old` : 'age not documented',
    c.sex && c.sex !== 'Unknown' ? c.sex.toLowerCase() : '',
    `(${departmentLabel(c.department)}${c.ward ? `, ${c.ward}` : ''})`,
    c.weightKg ? `weight ${c.weightKg} kg` : '',
    crcl !== undefined ? `CrCl ≈ ${Math.round(crcl)} mL/min` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

const medText = (m: { name: string; dose?: string; unit?: string; route?: string; frequency?: string }) => [m.name, m.dose && `${m.dose}${m.unit ? ` ${m.unit}` : ''}`, m.route, m.frequency].filter(Boolean).join(' ');

function drpLine(d: Drp): string {
  return `${DRP_CATEGORY_LABEL[d.category]}${d.medication ? ` — ${d.medication}` : ''}: ${d.description} [${DRP_STATUS_LABEL[d.status]}]`;
}

export function physicianRecommendation(b: CaseBundle, i: Intervention, d?: Drp): string {
  return [
    `Clinical pharmacy recommendation — ${patientLine(b)}`,
    '',
    `Problem: ${d ? drpLine(d) : i.goal || ND}`,
    `Evidence: ${d?.patientEvidence.length ? d.patientEvidence.join('; ') : ND}`,
    `Assessment: ${d?.clinicalSignificance || ND}`,
    `Recommendation: ${INTERVENTION_TYPE_LABEL[i.type]} — ${i.recommendation}`,
    `Rationale: ${i.rationale || ND}`,
    i.alternative ? `Alternative considered: ${i.alternative}` : '',
    `Monitoring: ${b.monitoring.filter((m) => !m.interventionId || m.interventionId === i.id).map((m) => `${m.parameter}${m.frequency ? ` (${m.frequency})` : ''}`).join('; ') || ND}`,
    '',
    'Happy to discuss. Please let me know whether you would like to proceed.',
  ]
    .filter((l) => l !== '')
    .join('\n');
}

export function nursingCommunication(b: CaseBundle, i: Intervention): string {
  return [
    `Pharmacy note for nursing — ${b.case.code}${b.case.ward ? `, ${b.case.ward}` : ''}`,
    `Change / action: ${i.recommendation} (status: ${i.status})`,
    `Please monitor: ${b.monitoring.map((m) => `${m.parameter}${m.frequency ? ` ${m.frequency}` : ''}${m.actionIfAbnormal ? ` — if abnormal: ${m.actionIfAbnormal}` : ''}`).join('; ') || ND}`,
    'Contact pharmacy with any questions or concerns.',
  ].join('\n');
}

export function patientCounseling(b: CaseBundle, i: Intervention): string {
  return [
    `Patient counselling points — ${b.case.code}`,
    `What is changing: ${i.recommendation}`,
    `Why: ${i.rationale || 'explain the reason in plain language'}`,
    'What to watch for: explain expected benefits and the side effects that need medical attention.',
    'How to take it: dose, timing, with or without food, what to do if a dose is missed.',
    'Check understanding with teach-back. Use plain language (Arabic or English as preferred).',
  ].join('\n');
}

export function pharmacistHandover(b: CaseBundle): string {
  const open = b.drps.filter((d) => d.status === 'confirmed' || d.status === 'possible' || d.status === 'needs_data');
  return [
    `Pharmacist handover — ${patientLine(b)}`,
    `Main problem: ${b.case.mainProblem || ND}`,
    `Active issues: ${open.map(drpLine).join(' | ') || 'none documented'}`,
    `Interventions: ${b.interventions.map((i) => `${i.recommendation} (${i.status})`).join(' | ') || 'none'}`,
    `Pending follow-ups: ${b.followups.filter((f) => f.status === 'pending').map((f) => `${f.dueDate ? formatDate(f.dueDate) : f.window}: ${f.parameter}`).join(' | ') || 'none'}`,
  ].join('\n');
}

export function soapNote(b: CaseBundle): string {
  const meds = activeMeds(b);
  const labs = b.labs.filter(ok).filter((l) => l.flag && !/normal|unknown/i.test(l.flag));
  return [
    `SOAP NOTE — Clinical Pharmacy — ${patientLine(b)}`,
    '',
    `S: ${profileValue(b, 'chief_complaint') ?? ND}. ${profileValue(b, 'hpi') ?? ''}`.trim(),
    `   PMH: ${profileValue(b, 'pmh') ?? ND}. Allergies: ${b.case.nkda ? 'NKDA' : b.allergies.filter(ok).map((a) => `${a.substance}${a.reaction ? ` (${a.reaction})` : ''}`).join(', ') || ND}.`,
    `O: Vitals: ${b.vitals.filter(ok).slice(-6).map((v) => `${v.type} ${v.value}`).join(', ') || ND}.`,
    `   Abnormal labs: ${labs.map((l) => `${l.name} ${l.value}${l.unit ? ` ${l.unit}` : ''}`).join(', ') || 'none flagged'}.`,
    `   Current medications: ${meds.map(medText).join('; ') || ND}.`,
    `A: Problems: ${b.problems.filter(ok).map((p) => p.name).join('; ') || ND}.`,
    `   DRPs: ${b.drps.map(drpLine).join(' | ') || b.case.noDrpReasoning || 'none documented'}.`,
    `P: ${b.interventions.map((i) => `${INTERVENTION_TYPE_LABEL[i.type]}: ${i.recommendation} (${i.status})`).join('; ') || ND}.`,
    `   Monitoring: ${b.monitoring.map((m) => `${m.parameter}${m.frequency ? ` ${m.frequency}` : ''}`).join('; ') || ND}.`,
    `   Follow-up: ${b.followups.map((f) => `${f.dueDate ? formatDate(f.dueDate) : f.window}: ${f.parameter}`).join('; ') || ND}.`,
  ].join('\n');
}

export function drpInterventionNote(b: CaseBundle): string {
  return [
    `DRP & INTERVENTION NOTE — ${patientLine(b)}`,
    ...b.drps.map((d, n) => {
      const ints = b.interventions.filter((i) => i.drpId === d.id);
      return [
        '',
        `${n + 1}. ${drpLine(d)}`,
        `   Evidence: ${d.patientEvidence.join('; ') || ND}`,
        `   Intervention: ${ints.map((i) => `${i.recommendation} → ${i.status}${i.outcome ? ` (outcome: ${i.outcome})` : ''}`).join('; ') || 'none yet'}`,
      ].join('\n');
    }),
  ].join('\n');
}

export function medRecNote(b: CaseBundle, decisions: ReconDecision[]): string {
  const rows = reconcile(b.meds);
  const lines = rows.flatMap((r) =>
    r.discrepancies.map((d) => {
      const dec = decisions.find((x) => x.key === d.key);
      return `- ${r.name}: ${DISCREPANCY_LABEL[d.type]} (${d.transition}) — ${d.detail} → ${dec ? dec.classification.replace('_', ' ') : 'NOT YET CLASSIFIED'}${dec?.note ? ` (${dec.note})` : ''}`;
    }),
  );
  return [`MEDICATION RECONCILIATION NOTE — ${patientLine(b)}`, `Sources: ${b.sources.map((s) => s.code).join(', ') || ND}`, ...(lines.length ? lines : ['No discrepancies detected between the documented lists.']), 'Pharmacist verification required for every discrepancy.'].join('\n');
}

export function monitoringNote(b: CaseBundle): string {
  return [
    `MONITORING PLAN — ${patientLine(b)}`,
    ...b.monitoring.map((m) => `- ${m.parameter}: why ${m.why || ND}; baseline ${m.baseline || ND}; target ${m.target || ND}; ${m.timing || ''} ${m.frequency || ''}; if abnormal: ${m.actionIfAbnormal || ND}`),
  ].join('\n');
}

export function followUpNote(b: CaseBundle): string {
  return [
    `FOLLOW-UP NOTE — ${patientLine(b)}`,
    ...b.followups.map((f) => `- ${f.dueDate ? formatDate(f.dueDate) : f.window}: ${f.parameter} — target ${f.target || ND}; status ${FOLLOWUP_STATUS_LABEL[f.status]}${f.outcome ? `; outcome: ${f.outcome}` : ''}`),
  ].join('\n');
}

export function dischargeNote(b: CaseBundle): string {
  const discharge = b.meds.filter(ok).filter((m) => m.list === 'discharge');
  return [
    `DISCHARGE PHARMACY NOTE — ${patientLine(b)}`,
    `Discharge medications: ${discharge.map(medText).join('; ') || 'discharge list not documented'}`,
    `Changes vs home list: see medication reconciliation.`,
    `Counselling: ${b.interventions.filter((i) => i.type === 'patient_counseling').map((i) => i.recommendation).join('; ') || ND}`,
    `Follow-up after discharge: ${b.followups.filter((f) => f.window === 'outpatient' || f.window === 'discharge').map((f) => f.parameter).join('; ') || ND}`,
  ].join('\n');
}

export function oneMinuteSummary(b: CaseBundle): string {
  const meds = activeMeds(b);
  return [
    `ONE-MINUTE CLINICAL SUMMARY — ${patientLine(b)}`,
    `Main problems: ${b.problems.filter(ok).slice(0, 4).map((p) => p.name).join('; ') || b.case.mainProblem || ND}`,
    `Important findings: ${b.labs.filter(ok).filter((l) => l.flag && !/normal|unknown/i.test(l.flag)).slice(-5).map((l) => `${l.name} ${l.value}`).join(', ') || ND}`,
    `Important medications: ${meds.slice(0, 8).map((m) => m.name).join(', ') || ND}`,
    `DRPs: ${b.drps.filter((d) => d.status !== 'not_supported').map((d) => `${DRP_CATEGORY_LABEL[d.category]}${d.medication ? ` (${d.medication})` : ''}`).join('; ') || 'none documented'}`,
    `Assessment/plan: ${b.interventions.map((i) => i.recommendation).join('; ') || ND}`,
    `Monitoring: ${b.monitoring.slice(0, 5).map((m) => m.parameter).join(', ') || ND}`,
    `Follow-up: ${b.followups.filter((f) => f.status === 'pending').slice(0, 3).map((f) => f.parameter).join(', ') || ND}`,
  ].join('\n');
}
