// Rule-based safety layer. Alerts are decision-support prompts for the
// trainee, never autonomous decisions. Every alert says what triggered it.
//   red    → urgent verification
//   orange → important review
//   yellow → review
//   blue   → educational
import { crclCockcroftGault } from './calculators';
import { activeMeds, type CaseBundle } from './bundle';
import { latestLab, type LabKey } from './labs';
import {
  CLASS_LABEL,
  DRUG_CLASSES,
  HEPATIC_REVIEW,
  HIGH_ALERT,
  HIGH_ALERT_DRUGS,
  RENAL_REVIEW,
  inClass,
  isAntiplateletDose,
  matchesTerm,
  normalizeName,
  type DrugClass,
} from './meds';
import type { Medication } from './types';

export type Severity = 'red' | 'orange' | 'yellow' | 'blue';

export interface SafetyAlert {
  id: string;
  severity: Severity;
  category:
    | 'allergy'
    | 'interaction'
    | 'contraindication'
    | 'dose'
    | 'duplicate'
    | 'renal'
    | 'hepatic'
    | 'high_risk'
    | 'critical_lab'
    | 'missing_monitoring'
    | 'missing_data';
  title: string;
  detail: string;
  medications: string[];
}

export const SEVERITY_ORDER: Record<Severity, number> = { red: 0, orange: 1, yellow: 2, blue: 3 };

type Bundle = Pick<CaseBundle, 'case' | 'meds' | 'allergies' | 'labs' | 'diagnostics' | 'monitoring'>;

export function estimateCrcl(b: Pick<CaseBundle, 'case' | 'labs'>): number | undefined {
  const scr = latestLab(b.labs.filter((l) => l.prov.verification !== 'rejected'), 'creatinine');
  const { age, weightKg, sex } = b.case;
  if (!scr || !age || !weightKg || (sex !== 'Female' && sex !== 'Male') || scr.value <= 0) return undefined;
  return crclCockcroftGault({ age, weightKg, scrMgDl: scr.value, sex });
}

const medLabel = (m: Medication) => [m.name, m.dose && `${m.dose}${m.unit ? ` ${m.unit}` : ''}`].filter(Boolean).join(' ');

const ALLERGY_CLASSES = ['penicillin', 'cephalosporin', 'carbapenem', 'sulfonamide_antibiotic', 'nsaid'] as const satisfies readonly DrugClass[];
const ALLERGY_CLASS_WORD: Record<(typeof ALLERGY_CLASSES)[number], string> = {
  penicillin: 'penicillin',
  cephalosporin: 'cephalosporin',
  carbapenem: 'carbapenem',
  sulfonamide_antibiotic: 'sulfonamide',
  nsaid: 'nsaid',
};

const INTERACTION_NOTE = 'Rule-based screen — confirm in a drug interaction reference.';

export function safetyAlerts(b: Bundle): SafetyAlert[] {
  const alerts: SafetyAlert[] = [];
  const meds = activeMeds(b);
  const labs = b.labs.filter((l) => l.prov.verification !== 'rejected');
  const has = (cls: DrugClass) => meds.filter((m) => inClass(m.name, cls));
  const named = (...terms: string[]) => meds.filter((m) => terms.some((t) => matchesTerm(m.name, t)));
  const lab = (k: LabKey) => latestLab(labs, k)?.value;
  const push = (a: Omit<SafetyAlert, 'id'>) => alerts.push({ ...a, id: `${a.category}:${a.title}:${a.medications.join(',')}` });

  // ── Allergies ──
  const allergies = b.allergies.filter((a) => a.prov.verification !== 'rejected');
  for (const allergy of allergies) {
    const sub = normalizeName(allergy.substance);
    // Class-level matching only for classes where cross-sensitivity is clinically meaningful.
    const allergyClass = ALLERGY_CLASSES.find(
      (c) => sub.includes(ALLERGY_CLASS_WORD[c]) || (DRUG_CLASSES[c] as readonly string[]).some((t) => sub.includes(t)),
    );
    const sulfa = /sulf/.test(sub);
    for (const m of meds) {
      const direct = matchesTerm(m.name, sub) || normalizeName(m.name).includes(sub);
      const sameClass = (allergyClass && inClass(m.name, allergyClass)) || (sulfa && inClass(m.name, 'sulfonamide_antibiotic')) || (/nsaid/.test(sub) && inClass(m.name, 'nsaid'));
      if (direct || sameClass) {
        push({ severity: 'red', category: 'allergy', title: `Allergy match: ${allergy.substance}`, detail: `${medLabel(m)} may be contraindicated by the documented ${allergy.substance} allergy${allergy.reaction ? ` (${allergy.reaction})` : ''}. Verify the reaction history before administration.`, medications: [m.name] });
      } else if (allergyClass === 'penicillin' && (inClass(m.name, 'cephalosporin') || inClass(m.name, 'carbapenem'))) {
        push({ severity: 'yellow', category: 'allergy', title: 'Beta-lactam cross-reactivity check', detail: `${medLabel(m)} with a documented penicillin allergy${allergy.reaction ? ` (${allergy.reaction})` : ''}. Cross-reactivity is generally low but depends on reaction type and side chains — document the assessment.`, medications: [m.name] });
      }
    }
  }
  if (allergies.length === 0 && !b.case.nkda) {
    push({ severity: 'yellow', category: 'missing_data', title: 'Allergy status not documented', detail: 'Record allergies or confirm "no known drug allergies" before assessing medications.', medications: [] });
  }

  // ── Duplicate therapy ──
  const dupClasses: DrugClass[] = ['anticoagulant', 'ppi', 'nsaid', 'acei', 'arb', 'statin', 'beta_blocker', 'benzodiazepine'];
  for (const cls of dupClasses) {
    const list = has(cls);
    const distinct = [...new Map(list.map((m) => [normalizeName(m.name).split(' ')[0], m])).values()];
    if (distinct.length >= 2) {
      push({ severity: cls === 'anticoagulant' ? 'orange' : 'yellow', category: 'duplicate', title: `Duplicate therapy: ${CLASS_LABEL[cls] ?? cls}`, detail: `${distinct.map(medLabel).join(' + ')} are in the same therapeutic class. Confirm whether both are intended (e.g. bridging).`, medications: distinct.map((m) => m.name) });
    }
  }
  const acei = has('acei');
  const arb = has('arb');
  if (acei.length && arb.length) push({ severity: 'orange', category: 'duplicate', title: 'Dual RAAS blockade', detail: `${[...acei, ...arb].map(medLabel).join(' + ')}: combined ACE inhibitor and ARB/ARNI increases hyperkalaemia and AKI risk (ACE inhibitor with sacubitril is contraindicated).`, medications: [...acei, ...arb].map((m) => m.name) });

  // ── Interactions (curated, high-signal pairs) ──
  const warfarin = named('warfarin');
  const nsaids = has('nsaid');
  if (warfarin.length && nsaids.length) push({ severity: 'red', category: 'interaction', title: 'Warfarin + NSAID', detail: `Increased bleeding risk (GI bleeding, antiplatelet effect). ${INTERACTION_NOTE}`, medications: [...warfarin, ...nsaids].map((m) => m.name) });
  const inrRaisers = named('amiodarone', 'fluconazole', 'metronidazole', 'sulfamethoxazole', 'co-trimoxazole', 'clarithromycin', 'erythromycin', 'ciprofloxacin', 'levofloxacin', 'azithromycin', 'voriconazole');
  if (warfarin.length && inrRaisers.length) push({ severity: 'orange', category: 'interaction', title: 'Warfarin + INR-raising drug', detail: `${inrRaisers.map((m) => m.name).join(', ')} may increase the INR. Plan closer INR monitoring. ${INTERACTION_NOTE}`, medications: [...warfarin, ...inrRaisers].map((m) => m.name) });
  const anticoag = has('anticoagulant');
  const antiplatelets = has('antiplatelet');
  if (anticoag.length && antiplatelets.length) push({ severity: 'orange', category: 'interaction', title: 'Anticoagulant + antiplatelet', detail: `Additive bleeding risk. Confirm a current indication for combined therapy and its planned duration. ${INTERACTION_NOTE}`, medications: [...anticoag, ...antiplatelets].map((m) => m.name) });
  const raas = [...acei, ...arb];
  const kSparing = has('k_sparing');
  const kSupp = has('k_supplement');
  const k = lab('potassium');
  if (raas.length + kSparing.length + kSupp.length >= 2 && (kSupp.length > 0 || (raas.length > 0 && kSparing.length > 0))) {
    push({ severity: k !== undefined && k >= 5.0 ? 'red' : 'orange', category: 'interaction', title: 'Hyperkalaemia risk combination', detail: `${[...raas, ...kSparing, ...kSupp].map((m) => m.name).join(' + ')}${k !== undefined ? ` with potassium ${k} mmol/L` : ''}. ${INTERACTION_NOTE}`, medications: [...raas, ...kSparing, ...kSupp].map((m) => m.name) });
  }
  if (raas.length && nsaids.length) {
    const diuretic = [...has('loop_diuretic'), ...named('hydrochlorothiazide', 'chlorthalidone', 'indapamide')];
    push({ severity: 'orange', category: 'interaction', title: diuretic.length ? '"Triple whammy" (ACEi/ARB + diuretic + NSAID)' : 'ACE inhibitor/ARB + NSAID', detail: `Increased risk of acute kidney injury and hyperkalaemia. ${INTERACTION_NOTE}`, medications: [...raas, ...nsaids, ...diuretic].map((m) => m.name) });
  }
  const digoxin = named('digoxin');
  const digRaisers = named('amiodarone', 'clarithromycin', 'verapamil', 'dronedarone', 'itraconazole');
  if (digoxin.length && digRaisers.length) push({ severity: 'orange', category: 'interaction', title: 'Digoxin level-raising interaction', detail: `${digRaisers.map((m) => m.name).join(', ')} can raise digoxin concentrations. Review digoxin dose and levels. ${INTERACTION_NOTE}`, medications: [...digoxin, ...digRaisers].map((m) => m.name) });
  const statins = has('cyp3a4_statin');
  const inhibitors = has('strong_cyp3a4_inhibitor');
  if (statins.length && inhibitors.length) push({ severity: 'orange', category: 'interaction', title: 'Statin + strong CYP3A4 inhibitor', detail: `Increased risk of myopathy / rhabdomyolysis. ${INTERACTION_NOTE}`, medications: [...statins, ...inhibitors].map((m) => m.name) });
  const qt = has('qt_prolonging');
  if (qt.length >= 2) push({ severity: 'yellow', category: 'interaction', title: `${qt.length} QT-prolonging drugs`, detail: `${qt.map((m) => m.name).join(', ')}. Check a baseline ECG/QTc and keep K and Mg in range. ${INTERACTION_NOTE}`, medications: qt.map((m) => m.name) });
  const linezolid = named('linezolid');
  const serotonergic = has('ssri_snri');
  if (linezolid.length && serotonergic.length) push({ severity: 'orange', category: 'interaction', title: 'Linezolid + serotonergic drug', detail: `Risk of serotonin syndrome. ${INTERACTION_NOTE}`, medications: [...linezolid, ...serotonergic].map((m) => m.name) });
  const mtx = named('methotrexate');
  const tmp = named('trimethoprim', 'sulfamethoxazole', 'co-trimoxazole', 'cotrimoxazole');
  if (mtx.length && tmp.length) push({ severity: 'red', category: 'interaction', title: 'Methotrexate + trimethoprim', detail: `Risk of severe myelosuppression. ${INTERACTION_NOTE}`, medications: [...mtx, ...tmp].map((m) => m.name) });
  const allopurinol = named('allopurinol');
  const thiopurine = named('azathioprine', 'mercaptopurine');
  if (allopurinol.length && thiopurine.length) push({ severity: 'red', category: 'interaction', title: 'Allopurinol + thiopurine', detail: `Allopurinol markedly increases thiopurine toxicity (myelosuppression). ${INTERACTION_NOTE}`, medications: [...allopurinol, ...thiopurine].map((m) => m.name) });

  // ── Renal ──
  const crcl = estimateCrcl(b);
  if (crcl !== undefined && crcl < 60) {
    const renal = meds.filter((m) => RENAL_REVIEW.some((t) => matchesTerm(m.name, t)));
    if (renal.length)
      push({ severity: crcl < 30 ? 'orange' : 'yellow', category: 'renal', title: `Renal dose review (CrCl ≈ ${Math.round(crcl)} mL/min)`, detail: `${renal.map(medLabel).join(', ')} are renally cleared or nephrotoxic. Check each dose for the current renal function in a renal dosing reference. Cockcroft-Gault is unreliable if creatinine is changing.`, medications: renal.map((m) => m.name) });
    if (crcl < 30 && nsaids.length) push({ severity: 'orange', category: 'contraindication', title: 'NSAID with severe renal impairment', detail: `${nsaids.map((m) => m.name).join(', ')} with CrCl ≈ ${Math.round(crcl)} mL/min.`, medications: nsaids.map((m) => m.name) });
  }

  // ── Hepatic ──
  const bili = lab('bilirubin');
  const alt = lab('alt');
  if ((bili !== undefined && bili > 2) || (alt !== undefined && alt > 120)) {
    const hep = meds.filter((m) => HEPATIC_REVIEW.some((t) => matchesTerm(m.name, t)));
    if (hep.length) push({ severity: 'yellow', category: 'hepatic', title: 'Hepatic function abnormal', detail: `${hep.map((m) => m.name).join(', ')} may need hepatic review (bilirubin ${bili ?? '—'} mg/dL, ALT ${alt ?? '—'} U/L).`, medications: hep.map((m) => m.name) });
  }

  // ── Critical / important laboratory values ──
  const crit = (key: LabKey, test: (v: number) => Severity | undefined, label: string, unit: string) => {
    const v = lab(key);
    if (v === undefined) return;
    const sev = test(v);
    if (sev) push({ severity: sev, category: 'critical_lab', title: `${label} ${v} ${unit}`, detail: sev === 'red' ? 'Critical value — verify the result and escalate per local policy. Review medications that contribute.' : 'Important abnormal value — review contributing medications.', medications: [] });
  };
  crit('potassium', (v) => (v >= 6 || v <= 2.8 ? 'red' : v >= 5.5 || v <= 3.0 ? 'orange' : undefined), 'Potassium', 'mmol/L');
  crit('sodium', (v) => (v <= 125 || v >= 155 ? 'red' : v <= 130 ? 'yellow' : undefined), 'Sodium', 'mmol/L');
  crit('glucose', (v) => (v <= 54 || v >= 400 ? 'red' : v <= 70 ? 'orange' : undefined), 'Glucose', 'mg/dL');
  crit('inr', (v) => (v >= 5 ? 'red' : v >= 4 ? 'orange' : undefined), 'INR', '');
  crit('platelets', (v) => (v < 20 ? 'red' : v < 50 && anticoag.length ? 'orange' : undefined), 'Platelets', '×10⁹/L');
  crit('anc', (v) => (v < 0.5 ? 'red' : undefined), 'ANC', '×10⁹/L');
  crit('hemoglobin', (v) => (v < 7 ? 'red' : undefined), 'Haemoglobin', 'g/dL');
  crit('calcium', (v) => (v < 7 || v > 12 ? 'red' : undefined), 'Calcium', 'mg/dL');
  crit('magnesium', (v) => (v < 1.0 ? 'red' : undefined), 'Magnesium', 'mg/dL');
  crit('digoxin', (v) => (v > 2.0 ? 'red' : v > 1.2 ? 'orange' : undefined), 'Digoxin level', 'ng/mL');
  crit('lactate', (v) => (v >= 4 ? 'red' : undefined), 'Lactate', 'mmol/L');

  // ── Missing monitoring ──
  const planned = (re: RegExp) => b.monitoring.some((m) => re.test(m.parameter));
  const missing = (cond: boolean, title: string, detail: string, medsInvolved: Medication[]) => {
    if (cond && medsInvolved.length) push({ severity: 'yellow', category: 'missing_monitoring', title, detail, medications: medsInvolved.map((m) => m.name) });
  };
  missing(lab('inr') === undefined && !planned(/inr/i), 'No INR documented', 'Warfarin requires INR monitoring.', warfarin);
  const levelDrugs = [...named('vancomycin'), ...has('aminoglycoside')];
  missing(lab('vancomycin') === undefined && !planned(/level|trough|auc|tdm/i), 'No drug level / TDM plan', 'Vancomycin and aminoglycosides need therapeutic drug monitoring and renal function checks.', levelDrugs);
  missing(lab('digoxin') === undefined && !planned(/digoxin/i), 'No digoxin level', 'Check digoxin level and potassium, especially with renal impairment or interacting drugs.', digoxin);
  missing((lab('potassium') === undefined || lab('creatinine') === undefined) && !planned(/potassium|\bk\b|creatinine/i), 'Potassium / creatinine not documented', 'ACE inhibitors, ARBs and potassium-sparing diuretics need potassium and renal function monitoring.', [...raas, ...kSparing]);
  missing(lab('wbc') === undefined && lab('anc') === undefined && lab('platelets') === undefined && !planned(/cbc|blood count|anc|platelet/i), 'No blood count documented', 'Chemotherapy requires CBC monitoring before and after treatment.', has('chemotherapy'));
  missing(lab('glucose') === undefined && !planned(/glucose|bg|cbg/i), 'No glucose monitoring', 'Insulin and sulfonylureas need glucose monitoring (hypoglycaemia risk).', [...has('insulin'), ...has('sulfonylurea')]);
  const hasEcg = b.diagnostics.some((d) => /ecg|ekg|qtc/i.test(`${d.type} ${d.result}`));
  missing(qt.length >= 2 && !hasEcg && !planned(/ecg|qtc/i), 'No ECG / QTc documented', 'Multiple QT-prolonging drugs without a documented QTc.', qt);

  // ── High-alert medicines (educational) ──
  const highAlert = meds.filter((m) => HIGH_ALERT.some((c) => inClass(m.name, c) && !(c === 'anticoagulant' && isAntiplateletDose(m.name, m.dose))) || HIGH_ALERT_DRUGS.some((t) => matchesTerm(m.name, t)));
  if (highAlert.length) push({ severity: 'blue', category: 'high_risk', title: `${highAlert.length} high-alert medication${highAlert.length > 1 ? 's' : ''}`, detail: `${highAlert.map((m) => m.name).join(', ')} — use independent double checks for dose, route and monitoring.`, medications: highAlert.map((m) => m.name) });

  // De-duplicate by id and sort by severity.
  const unique = [...new Map(alerts.map((a) => [a.id, a])).values()];
  return unique.sort((a, b2) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b2.severity]);
}
