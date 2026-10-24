// DATA CHECK before assessment: KNOWN / NEEDS VERIFICATION / MISSING,
// with an explanation of why each item matters (part of the teaching engine).
import { DEPARTMENTS, type DataKey } from '@shared/departments';
import { activeMeds, type CaseBundle } from './bundle';
import { canonicalLab, type LabKey } from './labs';
import { inClass, matchesTerm, type DrugClass } from './meds';

export type DataState = 'known' | 'needs_verification' | 'missing';

export interface DataCheckItem {
  key: DataKey;
  label: string;
  state: DataState;
  value?: string;
  why: string;
}

const LABEL: Record<DataKey, string> = {
  age: 'Age',
  sex: 'Sex',
  weight: 'Weight',
  height: 'Height',
  allergies: 'Allergy status',
  medications: 'Medication list',
  scr: 'Serum creatinine',
  potassium: 'Potassium',
  sodium: 'Sodium',
  magnesium: 'Magnesium',
  cbc: 'Complete blood count',
  anc: 'Absolute neutrophil count',
  platelets: 'Platelets',
  inr: 'INR',
  lfts: 'Liver function tests',
  albumin: 'Albumin',
  uric_acid: 'Uric acid',
  glucose: 'Glucose',
  vitals: 'Vital signs',
  temperature: 'Temperature',
  cultures: 'Cultures',
  ecg: 'ECG / QTc',
  lactate: 'Lactate',
  bilirubin: 'Bilirubin',
  urine_output: 'Urine output / fluid balance',
};

const WHY: Record<DataKey, string> = {
  age: 'Age changes pharmacokinetics, renal function estimates and the risk of many adverse effects.',
  sex: 'Needed for renal function equations and some reference ranges.',
  weight: 'Required for weight-based dosing and creatinine clearance estimation.',
  height: 'Required for BSA (e.g. chemotherapy) and ideal/adjusted body weight.',
  allergies: 'Every medication decision must be checked against allergies and the nature of previous reactions.',
  medications: 'The medication list is the basis of every pharmacotherapy assessment and reconciliation.',
  scr: 'Renal function determines the dose of many renally cleared and nephrotoxic drugs.',
  potassium: 'Potassium abnormalities affect arrhythmia risk and drugs such as ACE inhibitors, MRAs, digoxin and diuretics.',
  sodium: 'Sodium disorders can be drug-induced (e.g. diuretics, SSRIs) and change management.',
  magnesium: 'Low magnesium increases arrhythmia risk with QT-prolonging drugs and digoxin.',
  cbc: 'Blood counts are needed to judge infection, bleeding and myelosuppression risk.',
  anc: 'Neutrophil count defines neutropenia, febrile neutropenia and infection risk.',
  platelets: 'Platelet count is essential before anticoagulants, antiplatelets and invasive procedures.',
  inr: 'INR is required to evaluate current anticoagulation status and safety in this clinical context.',
  lfts: 'Liver function guides hepatic dose adjustment and detection of hepatotoxicity.',
  albumin: 'Albumin affects protein binding and corrected calcium interpretation.',
  uric_acid: 'Uric acid is a key marker of tumour lysis syndrome risk.',
  glucose: 'Glucose is needed to assess glycaemic control and hypoglycaemia risk.',
  vitals: 'Vital signs show clinical stability and response to therapy.',
  temperature: 'Temperature defines fever (e.g. febrile neutropenia) and response to antimicrobials.',
  cultures: 'Cultures guide antimicrobial selection, de-escalation and duration.',
  ecg: 'ECG/QTc is needed with QT-prolonging drugs and arrhythmias.',
  lactate: 'Lactate helps assess perfusion and sepsis severity.',
  bilirubin: 'Bilirubin is needed for hepatic dosing and neonatal assessment.',
  urine_output: 'Urine output reflects renal perfusion and fluid balance.',
};

const LAB_FOR: Partial<Record<DataKey, LabKey[]>> = {
  scr: ['creatinine'],
  potassium: ['potassium'],
  sodium: ['sodium'],
  magnesium: ['magnesium'],
  cbc: ['wbc', 'hemoglobin', 'platelets'],
  anc: ['anc'],
  platelets: ['platelets'],
  inr: ['inr'],
  lfts: ['alt', 'ast', 'bilirubin'],
  albumin: ['albumin'],
  uric_acid: ['uric_acid'],
  glucose: ['glucose'],
  lactate: ['lactate'],
  bilirubin: ['bilirubin'],
};

/** Extra requirements triggered by the medications the patient receives. */
function conditionalKeys(b: CaseBundle): Array<{ key: DataKey; why?: string }> {
  const meds = activeMeds(b);
  const any = (cls: DrugClass) => meds.some((m) => inClass(m.name, cls));
  const named = (...t: string[]) => meds.some((m) => t.some((x) => matchesTerm(m.name, x)));
  const out: Array<{ key: DataKey; why?: string }> = [];
  if (named('warfarin')) out.push({ key: 'inr', why: WHY.inr });
  if (any('anticoagulant')) out.push({ key: 'platelets', why: 'Platelets and haemoglobin are needed to judge bleeding risk on anticoagulants.' });
  if (any('chemotherapy')) out.push({ key: 'cbc' }, { key: 'anc' }, { key: 'height', why: 'Height is needed for BSA-based chemotherapy dose verification.' });
  if (any('aminoglycoside') || named('vancomycin')) out.push({ key: 'scr' }, { key: 'cultures', why: 'Cultures and susceptibilities determine whether this antimicrobial is still needed.' });
  if (any('acei') || any('arb') || any('k_sparing') || any('k_supplement') || named('digoxin')) out.push({ key: 'potassium' });
  if (any('insulin') || any('sulfonylurea')) out.push({ key: 'glucose' });
  if (meds.filter((m) => inClass(m.name, 'qt_prolonging')).length >= 2 || named('amiodarone', 'sotalol')) out.push({ key: 'ecg' }, { key: 'magnesium' });
  return out;
}

export function dataCheck(b: CaseBundle): DataCheckItem[] {
  const dept = DEPARTMENTS[b.case.department] ?? DEPARTMENTS.internal_medicine;
  const keys = new Map<DataKey, string>();
  for (const k of dept.requiredData) keys.set(k, WHY[k]);
  for (const c of conditionalKeys(b)) keys.set(c.key, c.why ?? WHY[c.key]);

  const pending = b.extracted.filter((e) => e.status === 'pending');
  const labs = b.labs.filter((l) => l.prov.verification !== 'rejected');
  const pendingLab = (keysWanted: LabKey[]) => pending.some((e) => e.kind === 'lab' && keysWanted.includes(canonicalLab(e.data.name ?? '') as LabKey));
  const pendingField = (field: string) => pending.some((e) => e.kind === 'demographic' && e.data.field === field);

  const items: DataCheckItem[] = [];
  for (const [key, why] of keys) {
    let state: DataState = 'missing';
    let value: string | undefined;
    const labKeys = LAB_FOR[key];
    if (labKeys) {
      const found = labs.filter((l) => labKeys.includes(canonicalLab(l.name) as LabKey));
      if (found.length) {
        state = 'known';
        const last = found[found.length - 1]!;
        value = `${last.name} ${last.value}${last.unit ? ` ${last.unit}` : ''}`;
      } else if (pendingLab(labKeys)) state = 'needs_verification';
    } else {
      switch (key) {
        case 'age':
        case 'sex':
        case 'weight':
        case 'height': {
          const field = { age: 'age', sex: 'sex', weight: 'weight_kg', height: 'height_cm' }[key];
          const v = { age: b.case.age, sex: b.case.sex, weight: b.case.weightKg, height: b.case.heightCm }[key];
          if (v !== undefined && v !== null && v !== 'Unknown') {
            state = 'known';
            value = String(v);
          } else if (pendingField(field)) state = 'needs_verification';
          break;
        }
        case 'allergies': {
          const verified = b.allergies.filter((a) => a.prov.verification !== 'rejected');
          if (verified.length || b.case.nkda) {
            state = 'known';
            value = b.case.nkda ? 'NKDA' : verified.map((a) => a.substance).join(', ');
          } else if (pending.some((e) => e.kind === 'allergy' || e.kind === 'nkda')) state = 'needs_verification';
          break;
        }
        case 'medications': {
          const meds = b.meds.filter((m) => m.prov.verification !== 'rejected');
          if (meds.length) {
            state = 'known';
            value = `${meds.length} medication record(s)`;
          } else if (pending.some((e) => e.kind === 'medication')) state = 'needs_verification';
          break;
        }
        case 'vitals':
        case 'temperature': {
          const v = b.vitals.filter((x) => x.prov.verification !== 'rejected' && (key === 'vitals' || /temp/i.test(x.type)));
          if (v.length) {
            state = 'known';
            value = v.slice(-3).map((x) => `${x.type} ${x.value}`).join(', ');
          } else if (pending.some((e) => e.kind === 'vital' && (key === 'vitals' || /temp/i.test(e.data.type ?? '')))) state = 'needs_verification';
          break;
        }
        case 'cultures':
        case 'ecg': {
          const re = key === 'ecg' ? /ecg|ekg|qtc/i : /culture|sensitivit|susceptib/i;
          if (b.diagnostics.some((d) => re.test(`${d.type} ${d.result}`))) state = 'known';
          else if (pending.some((e) => e.kind === 'diagnostic' && re.test(`${e.data.type} ${e.data.value}`))) state = 'needs_verification';
          break;
        }
        case 'urine_output':
          if (b.vitals.some((v) => /urine|output|fluid/i.test(v.type))) state = 'known';
          break;
      }
    }
    items.push({ key, label: LABEL[key], state, value, why });
  }
  const order: Record<DataState, number> = { missing: 0, needs_verification: 1, known: 2 };
  return items.sort((a, b2) => order[a.state] - order[b2.state]);
}
