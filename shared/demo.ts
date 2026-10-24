// SYNTHETIC DEMO DATA — fictional patients only. Never real patient information.
// The client renders these documents into images; the server's DemoProvider
// returns the scripted, clearly labelled responses below so the full workflow
// can be explored without any AI key. Document text and scripted
// extractions are generated from the same definitions, so they always agree.
import type {
  CaseAnalysis,
  Discussion,
  DrpAnalysis,
  FollowUpPlan,
  ImageAnalysis,
  LabExtraction,
  MedicationExtraction,
  MonitoringPlan,
  PatientExtraction,
  PatientField,
  RoundNote,
  TeachingQuestions,
  Timeline,
} from './ai';
import type { DepartmentId } from './departments';
import type { Priority, SourceType } from './domain';

export interface DemoMed {
  name: string;
  dose?: string;
  unit?: string;
  route?: string;
  frequency?: string;
  indication?: string;
  status?: 'active' | 'stopped' | 'held' | 'unknown';
  listType: 'home' | 'admission' | 'current' | 'discharge' | 'unknown';
  confidence: number;
  alternatives?: string[];
  page?: number;
  /** How the line is written on the document (defaults to a generated line). */
  line?: string;
}

export interface DemoLab {
  name: string;
  value: string;
  unit?: string;
  refRange?: string;
  flag: 'high' | 'low' | 'critical' | 'normal' | 'unknown';
  takenAt: string;
  confidence?: number;
  page?: number;
}

export interface DemoPatientItem {
  field: PatientField;
  value: string;
  unit?: string;
  detail?: string;
  date?: string;
  confidence?: number;
  alternatives?: string[];
  /** Line as printed on the document; omitted when the item shares a line already printed. */
  line?: string;
  page?: number;
}

export interface DemoDoc {
  key: string;
  sourceType: SourceType;
  title: string;
  date: string;
  handwritten?: boolean;
  /** Free lines per page, printed before the structured items of that page. */
  pages: Array<{ header: string[]; footer?: string[] }>;
  patient?: DemoPatientItem[];
  meds?: DemoMed[];
  labs?: DemoLab[];
}

export interface DemoCase {
  key: string;
  department: DepartmentId;
  title: string;
  ward: string;
  age: number;
  sex: 'Female' | 'Male';
  mainProblem: string;
  priority: Priority;
  summary: string;
  docs: DemoDoc[];
  timeline: Timeline;
  analysis: CaseAnalysis;
  drps: DrpAnalysis;
  discussion: Discussion;
  monitoring: MonitoringPlan;
  followUp: FollowUpPlan;
  teaching: TeachingQuestions;
  roundNoteText: string;
  roundNote: RoundNote;
}

export const DEMO_BANNER = 'SYNTHETIC DEMO DOCUMENT — FICTIONAL PATIENT — NOT FOR CLINICAL USE';

// ───────────────────────── rendering helpers ─────────────────────────

export function medLine(m: DemoMed): string {
  return m.line ?? [m.name, m.dose && `${m.dose}${m.unit ? ` ${m.unit}` : ''}`, m.route, m.frequency].filter(Boolean).join(' ');
}

function labLine(l: DemoLab): string {
  return `${l.name} | ${l.value} | ${l.unit ?? ''} | ${l.refRange ?? ''}${l.flag === 'high' ? ' | H' : l.flag === 'low' ? ' | L' : l.flag === 'critical' ? ' | CRIT' : ''}`;
}

/** Lines of text for each page of a demo document (used to render images and as the scripted transcription). */
export function demoDocPages(doc: DemoDoc): string[][] {
  return doc.pages.map((page, i) => {
    const n = i + 1;
    const lines = [DEMO_BANNER, ...page.header];
    for (const p of doc.patient ?? []) if ((p.page ?? 1) === n && p.line) lines.push(p.line);
    const meds = (doc.meds ?? []).filter((m) => (m.page ?? 1) === n);
    if (meds.length) {
      if (!doc.handwritten) lines.push('Medications:');
      meds.forEach((m, idx) => lines.push(doc.handwritten ? `${idx + 1}. ${medLine(m)}` : `- ${medLine(m)}`));
    }
    const labs = (doc.labs ?? []).filter((l) => (l.page ?? 1) === n);
    if (labs.length) {
      lines.push('Test | Result | Unit | Reference');
      labs.forEach((l) => lines.push(labLine(l)));
    }
    lines.push(...(page.footer ?? []));
    return lines;
  });
}

const conf = (v: number | undefined, fallback: number) => v ?? fallback;

export function demoImageAnalysis(doc: DemoDoc): ImageAnalysis {
  const pages = demoDocPages(doc);
  return {
    pages: pages.map((lines, i) => {
      const uncertain = (doc.meds ?? []).filter((m) => (m.page ?? 1) === i + 1 && m.confidence < 0.85);
      let transcription = lines.join('\n');
      for (const m of uncertain) transcription = transcription.replace(medLine(m), `[?${medLine(m)}?]`);
      return {
        page: i + 1,
        documentType: doc.sourceType,
        readable: true,
        qualityIssues: [],
        rotationDegrees: 0,
        handwritten: Boolean(doc.handwritten),
        transcription,
        uncertainReadings: uncertain.map((m) => ({
          text: medLine(m),
          bestReading: medLine(m),
          alternatives: m.alternatives ?? [],
          confidence: m.confidence,
        })),
        pageConfidence: doc.handwritten ? 0.72 : 0.96,
      };
    }),
    documentDate: doc.date,
    summary: `${doc.title} (${pages.length} page${pages.length > 1 ? 's' : ''}).`,
  };
}

export function demoPatientExtraction(doc: DemoDoc): PatientExtraction {
  return {
    items: (doc.patient ?? []).map((p) => ({
      field: p.field,
      value: p.value,
      unit: p.unit,
      detail: p.detail,
      date: p.date,
      page: p.page ?? 1,
      confidence: conf(p.confidence, doc.handwritten ? 0.78 : 0.95),
      alternatives: p.alternatives ?? [],
      evidenceText: (p.line ?? p.value).slice(0, 200),
      handwritten: Boolean(doc.handwritten),
    })),
    notDocumented: [],
  };
}

export function demoMedicationExtraction(doc: DemoDoc): MedicationExtraction {
  return {
    medications: (doc.meds ?? []).map((m) => ({
      name: m.name,
      dose: m.dose,
      unit: m.unit,
      route: m.route,
      frequency: m.frequency,
      indication: m.indication,
      status: m.status ?? 'active',
      listType: m.listType,
      page: m.page ?? 1,
      confidence: m.confidence,
      alternatives: m.alternatives ?? [],
      evidenceText: medLine(m),
      handwritten: Boolean(doc.handwritten),
    })),
  };
}

export function demoLabExtraction(doc: DemoDoc): LabExtraction {
  return {
    labs: (doc.labs ?? []).map((l) => ({
      name: l.name,
      value: l.value,
      unit: l.unit,
      refRange: l.refRange,
      flag: l.flag,
      takenAt: l.takenAt,
      page: l.page ?? 1,
      confidence: conf(l.confidence, 0.97),
      alternatives: [],
      evidenceText: labLine(l),
      handwritten: false,
    })),
  };
}

// ───────────────────────── Case 1 · Internal Medicine ─────────────────────────

const IM: DemoCase = {
  key: 'im-cap-aki',
  department: 'internal_medicine',
  title: 'Community-acquired pneumonia with AKI on warfarin',
  ward: 'Ward 4B',
  age: 78,
  sex: 'Female',
  mainProblem: 'Community-acquired pneumonia, AKI on CKD, supratherapeutic INR',
  priority: 'high',
  summary: '78-year-old woman with pneumonia, acute kidney injury, atrial fibrillation on warfarin and recent ibuprofen use.',
  docs: [
    {
      key: 'admission',
      sourceType: 'admission_note',
      title: 'Admission note',
      date: '2026-03-10',
      pages: [
        {
          header: ['CITY GENERAL HOSPITAL · INTERNAL MEDICINE · ADMISSION NOTE', 'Date: 2026-03-10    Ward 4B    ID: DEMO-IM-01'],
          footer: [
            'Plan: Admit. Blood and sputum cultures sent. IV fluids. Hold ibuprofen.',
            'Start ceftriaxone 1 g IV q24h and azithromycin 500 mg IV daily. Continue warfarin 5 mg daily.',
          ],
        },
      ],
      patient: [
        { field: 'age', value: '78', unit: 'years', line: 'Age: 78 years    Sex: Female' },
        { field: 'sex', value: 'Female' },
        { field: 'weight_kg', value: '58', unit: 'kg', line: 'Weight: 58 kg    Height: 160 cm' },
        { field: 'height_cm', value: '160', unit: 'cm' },
        { field: 'admission_date', value: '2026-03-10' },
        { field: 'chief_complaint', value: 'Productive cough, fever and new confusion for 3 days', line: 'Chief complaint: Productive cough, fever and new confusion for 3 days.' },
        {
          field: 'hpi',
          value: 'Three days of productive cough and fever with reduced oral intake. Daughter reports new confusion. Taking ibuprofen 400 mg three times daily for knee pain for one week.',
          line: 'HPI: 3 days productive cough, fever, reduced intake; new confusion. Ibuprofen 400 mg TID for knee pain x1 week.',
        },
        { field: 'pmh', value: 'Atrial fibrillation', line: 'PMH: Atrial fibrillation; Hypertension; Type 2 diabetes; CKD stage 3a (baseline creatinine 1.1 mg/dL); Osteoarthritis' },
        { field: 'pmh', value: 'Hypertension' },
        { field: 'pmh', value: 'Type 2 diabetes mellitus' },
        { field: 'pmh', value: 'Chronic kidney disease stage 3a (baseline creatinine 1.1 mg/dL)' },
        { field: 'pmh', value: 'Osteoarthritis' },
        { field: 'allergy', value: 'Penicillin', detail: 'Rash', line: 'Allergies: Penicillin (rash)' },
        { field: 'social_history', value: 'Lives with daughter. Non-smoker. No alcohol.', line: 'Social: Lives with daughter. Non-smoker. No alcohol.' },
        { field: 'vital', value: '104/62', unit: 'mmHg', detail: 'BP', date: '2026-03-10', line: 'Vitals: BP 104/62 mmHg | HR 112 irregular | RR 24 | Temp 38.6 °C | SpO2 91% RA' },
        { field: 'vital', value: '112', unit: 'bpm', detail: 'HR', date: '2026-03-10' },
        { field: 'vital', value: '24', unit: '/min', detail: 'RR', date: '2026-03-10' },
        { field: 'vital', value: '38.6', unit: '°C', detail: 'Temp', date: '2026-03-10' },
        { field: 'vital', value: '91', unit: '% RA', detail: 'SpO2', date: '2026-03-10' },
        { field: 'physical_exam', value: 'Crackles right lower zone. Dry mucous membranes. Oriented to person only.', line: 'Exam: Crackles right lower zone. Dry mucous membranes. Oriented to person only.' },
        { field: 'diagnostic', value: 'Right lower lobe consolidation', detail: 'Chest X-ray', date: '2026-03-10', line: 'CXR: Right lower lobe consolidation.' },
        { field: 'diagnosis', value: 'Community-acquired pneumonia', line: 'Impression: Community-acquired pneumonia; AKI on CKD; supratherapeutic INR on warfarin.' },
        { field: 'diagnosis', value: 'Acute kidney injury on CKD' },
        { field: 'diagnosis', value: 'Supratherapeutic INR on warfarin' },
      ],
      meds: [
        { name: 'Warfarin', dose: '5', unit: 'mg', route: 'PO', frequency: 'once daily', indication: 'Atrial fibrillation', listType: 'home', confidence: 0.97 },
        { name: 'Metformin', dose: '1000', unit: 'mg', route: 'PO', frequency: 'twice daily', indication: 'Type 2 diabetes', listType: 'home', confidence: 0.96 },
        { name: 'Lisinopril', dose: '20', unit: 'mg', route: 'PO', frequency: 'once daily', indication: 'Hypertension', listType: 'home', confidence: 0.96 },
        { name: 'Atorvastatin', dose: '20', unit: 'mg', route: 'PO', frequency: 'at night', listType: 'home', confidence: 0.95 },
        { name: 'Ibuprofen', dose: '400', unit: 'mg', route: 'PO', frequency: 'three times daily', indication: 'Knee pain (OTC)', listType: 'home', confidence: 0.95 },
        { name: 'Ibuprofen', listType: 'current', status: 'held', confidence: 0.9, line: 'Ibuprofen — HOLD' },
        { name: 'Ceftriaxone', dose: '1', unit: 'g', route: 'IV', frequency: 'q24h', indication: 'Pneumonia', listType: 'current', confidence: 0.93 },
        { name: 'Azithromycin', dose: '500', unit: 'mg', route: 'IV', frequency: 'daily', indication: 'Pneumonia', listType: 'current', confidence: 0.93 },
        { name: 'Warfarin', dose: '5', unit: 'mg', route: 'PO', frequency: 'daily', indication: 'Atrial fibrillation', listType: 'current', confidence: 0.92 },
      ],
    },
    {
      key: 'labs',
      sourceType: 'lab_report',
      title: 'Laboratory report',
      date: '2026-03-11',
      pages: [
        { header: ['LABORATORY REPORT · CHEMISTRY & HAEMATOLOGY', 'ID: DEMO-IM-01    Collected: 2026-03-10 08:40'] },
        { header: ['LABORATORY REPORT · CHEMISTRY & HAEMATOLOGY', 'ID: DEMO-IM-01    Collected: 2026-03-11 06:00'] },
      ],
      labs: [
        { name: 'Creatinine', value: '1.8', unit: 'mg/dL', refRange: '0.5-1.1', flag: 'high', takenAt: '2026-03-10T08:40' },
        { name: 'Urea (BUN)', value: '42', unit: 'mg/dL', refRange: '7-20', flag: 'high', takenAt: '2026-03-10T08:40' },
        { name: 'Sodium', value: '133', unit: 'mmol/L', refRange: '135-145', flag: 'low', takenAt: '2026-03-10T08:40' },
        { name: 'Potassium', value: '5.4', unit: 'mmol/L', refRange: '3.5-5.1', flag: 'high', takenAt: '2026-03-10T08:40' },
        { name: 'Glucose (random)', value: '212', unit: 'mg/dL', refRange: '70-140', flag: 'high', takenAt: '2026-03-10T08:40' },
        { name: 'WBC', value: '15.8', unit: 'x10^9/L', refRange: '4.0-11.0', flag: 'high', takenAt: '2026-03-10T08:40' },
        { name: 'Hemoglobin', value: '11.2', unit: 'g/dL', refRange: '12.0-15.5', flag: 'low', takenAt: '2026-03-10T08:40' },
        { name: 'Platelets', value: '210', unit: 'x10^9/L', refRange: '150-400', flag: 'normal', takenAt: '2026-03-10T08:40' },
        { name: 'INR', value: '4.2', refRange: '0.8-1.2', flag: 'high', takenAt: '2026-03-10T08:40' },
        { name: 'CRP', value: '148', unit: 'mg/L', refRange: '<5', flag: 'high', takenAt: '2026-03-10T08:40' },
        { name: 'Albumin', value: '3.0', unit: 'g/dL', refRange: '3.5-5.0', flag: 'low', takenAt: '2026-03-10T08:40' },
        { name: 'Creatinine', value: '2.1', unit: 'mg/dL', refRange: '0.5-1.1', flag: 'high', takenAt: '2026-03-11T06:00', page: 2 },
        { name: 'Potassium', value: '5.6', unit: 'mmol/L', refRange: '3.5-5.1', flag: 'high', takenAt: '2026-03-11T06:00', page: 2 },
        { name: 'INR', value: '3.6', refRange: '0.8-1.2', flag: 'high', takenAt: '2026-03-11T06:00', page: 2 },
        { name: 'WBC', value: '13.9', unit: 'x10^9/L', refRange: '4.0-11.0', flag: 'high', takenAt: '2026-03-11T06:00', page: 2 },
        { name: 'Glucose (random)', value: '186', unit: 'mg/dL', refRange: '70-140', flag: 'high', takenAt: '2026-03-11T06:00', page: 2 },
      ],
    },
    {
      key: 'orders',
      sourceType: 'medication_order',
      title: 'Handwritten inpatient medication orders',
      date: '2026-03-10',
      handwritten: true,
      pages: [{ header: ['Inpatient medication orders — Ward 4B — 10/03/2026'], footer: ['Signed: Dr [illegible]'] }],
      meds: [
        { name: 'Ceftriaxone', dose: '1', unit: 'g', route: 'IV', frequency: 'q24h', listType: 'current', confidence: 0.61, alternatives: ['Cefotaxime 1 g IV'] },
        { name: 'Azithromycin', dose: '500', unit: 'mg', route: 'IV', frequency: 'daily', listType: 'current', confidence: 0.82 },
        { name: 'Warfarin', dose: '2.5', unit: 'mg', route: 'PO', frequency: 'daily', listType: 'current', confidence: 0.74, alternatives: ['Warfarin 5 mg PO daily'] },
        { name: 'Metformin', dose: '1000', unit: 'mg', route: 'PO', frequency: 'BID', listType: 'current', confidence: 0.88 },
        { name: 'Lisinopril', dose: '20', unit: 'mg', route: 'PO', frequency: 'daily', listType: 'current', confidence: 0.86 },
        { name: 'Enoxaparin', dose: '40', unit: 'mg', route: 'SC', frequency: 'daily', listType: 'current', confidence: 0.79 },
        { name: 'Paracetamol', dose: '1', unit: 'g', route: 'PO', frequency: 'q6h PRN fever', listType: 'current', confidence: 0.9 },
        { name: 'Atorvastatin', dose: '20', unit: 'mg', route: 'PO', frequency: 'nocte', listType: 'current', confidence: 0.88 },
      ],
    },
  ],
  timeline: {
    events: [
      { dayLabel: 'Week before admission', kind: 'medication_start', label: 'Ibuprofen 400 mg TID started (OTC) for knee pain', detail: 'Documented in HPI.', sourceLabel: 'Admission note' },
      { date: '2026-03-07', dayLabel: '3 days before admission', kind: 'clinical_event', label: 'Cough, fever and reduced intake begin', detail: '', sourceLabel: 'Admission note' },
      { date: '2026-03-10', kind: 'admission', label: 'Admitted to Internal Medicine', detail: 'CAP with confusion; AKI; INR 4.2.', sourceLabel: 'Admission note' },
      { date: '2026-03-10', kind: 'lab', label: 'Creatinine 1.8 mg/dL, K 5.4, INR 4.2', detail: 'Baseline creatinine 1.1 mg/dL per PMH.', sourceLabel: 'Laboratory report' },
      { date: '2026-03-10', kind: 'medication_start', label: 'Ceftriaxone + azithromycin started', detail: '', sourceLabel: 'Admission note / orders' },
      { date: '2026-03-10', kind: 'medication_stop', label: 'Ibuprofen held', detail: '', sourceLabel: 'Admission note' },
      { date: '2026-03-10', kind: 'medication_change', label: 'Warfarin dose documented as 5 mg (note) and 2.5 mg (orders)', detail: 'Conflicting documentation.', sourceLabel: 'Admission note / orders' },
      { date: '2026-03-11', kind: 'lab', label: 'Creatinine 2.1 mg/dL, K 5.6, INR 3.6', detail: 'Renal function worsening.', sourceLabel: 'Laboratory report' },
    ],
    gaps: ['Time of last warfarin dose before admission is not documented.', 'Culture results are pending.'],
  },
  analysis: {
    overview: {
      presentingProblem: 'Community-acquired pneumonia with new confusion, tachypnoea and hypoxaemia in a 78-year-old woman.',
      relevantHistory: 'Atrial fibrillation on warfarin, hypertension, type 2 diabetes, CKD 3a (baseline creatinine 1.1 mg/dL), osteoarthritis with recent OTC ibuprofen.',
      importantMedications: ['Warfarin (5 mg home; 2.5 mg on inpatient orders)', 'Enoxaparin 40 mg SC daily', 'Metformin 1000 mg BID', 'Lisinopril 20 mg daily', 'Ibuprofen (held)', 'Ceftriaxone + azithromycin'],
      importantFindings: ['Creatinine 1.8 → 2.1 mg/dL (baseline 1.1)', 'Potassium 5.4 → 5.6 mmol/L', 'INR 4.2 → 3.6', 'SpO2 91% RA, RR 24, temperature 38.6 °C', 'Glucose 212 mg/dL'],
      clinicalInstability: ['Hypoxaemia and tachypnoea', 'New confusion', 'Worsening renal function'],
      potentialMedicationConcerns: [
        'Anticoagulant duplication (warfarin + enoxaparin) with supratherapeutic INR',
        'Metformin in acute kidney injury',
        'NSAID + ACE inhibitor in AKI with hyperkalaemia',
        'Conflicting warfarin dose documentation',
      ],
    },
    suggestedProblems: [
      { name: 'Community-acquired pneumonia (with confusion)', rationale: 'Cough, fever, crackles, RLL consolidation, WBC 15.8.', supportingData: ['CXR RLL consolidation', 'Temp 38.6 °C', 'WBC 15.8 x10^9/L'], priority: 'high', priorityReason: 'Acute infection with hypoxaemia and confusion.' },
      { name: 'Acute kidney injury on CKD 3a', rationale: 'Creatinine rose from baseline 1.1 to 1.8 then 2.1 mg/dL with dehydration, NSAID and ACE inhibitor exposure.', supportingData: ['Creatinine 1.8 → 2.1 mg/dL', 'Dry mucous membranes'], priority: 'high', priorityReason: 'Drives dosing of several drugs and hyperkalaemia risk.' },
      { name: 'Supratherapeutic INR / bleeding risk', rationale: 'INR 4.2 on warfarin with concurrent enoxaparin order.', supportingData: ['INR 4.2', 'Enoxaparin 40 mg SC daily'], priority: 'high', priorityReason: 'Immediate safety risk.' },
      { name: 'Hyperkalaemia', rationale: 'Potassium 5.4 → 5.6 mmol/L with ACE inhibitor in AKI.', supportingData: ['K 5.6 mmol/L', 'Lisinopril 20 mg'], priority: 'medium', priorityReason: 'Rising, needs monitoring and drug review.' },
      { name: 'Type 2 diabetes — inpatient glycaemic control', rationale: 'Glucose 212 and 186 mg/dL; metformin may need to be held in AKI.', supportingData: ['Glucose 212 mg/dL'], priority: 'medium', priorityReason: 'Hyperglycaemia during infection.' },
    ],
    missingInformation: [
      { item: 'Target INR and indication confirmation', whyItMatters: 'Needed to interpret INR 4.2 and to decide on warfarin dosing.' },
      { item: 'Blood and sputum culture results', whyItMatters: 'Guide de-escalation and duration of antimicrobial therapy.' },
      { item: 'HbA1c', whyItMatters: 'Helps plan inpatient and discharge glycaemic management.' },
      { item: 'Nature and timing of the penicillin reaction', whyItMatters: 'Determines the true risk of beta-lactam use.' },
      { item: 'Urine output', whyItMatters: 'Assesses AKI severity and volume status.' },
    ],
    inferences: [{ statement: 'AKI is likely pre-renal and drug-associated.', basis: 'Dehydration on exam, NSAID + ACE inhibitor exposure, infection. Not documented by the team.' }],
  },
  drps: {
    drps: [
      {
        category: 'duplicate_therapy',
        medication: 'Enoxaparin',
        condition: 'Atrial fibrillation / VTE prophylaxis',
        description: 'Enoxaparin prophylaxis ordered while the patient is anticoagulated with warfarin and the INR is supratherapeutic.',
        patientEvidence: ['INR 4.2 on admission, 3.6 next day', 'Warfarin on home and inpatient lists', 'Enoxaparin 40 mg SC daily on inpatient orders'],
        clinicalSignificance: 'Two anticoagulants with an INR above the usual AF range substantially increase bleeding risk in an elderly patient with AKI.',
        priority: 'high',
        evidenceBasis: 'Pharmacological VTE prophylaxis is generally unnecessary when a patient is therapeutically anticoagulated; combining anticoagulants increases bleeding risk.',
        suggestedAction: 'Discuss with the team whether enoxaparin should be stopped while warfarin anticoagulation is ongoing; verify against the local VTE protocol.',
        monitoring: 'Daily INR, haemoglobin, platelets, signs of bleeding.',
        followUp: 'Recheck the order and INR tomorrow.',
        missingData: ['Target INR'],
        confidence: 0.86,
        status: 'possible',
      },
      {
        category: 'dose_too_high',
        medication: 'Warfarin',
        condition: 'Atrial fibrillation',
        description: 'Supratherapeutic INR with conflicting warfarin dose documentation (5 mg vs 2.5 mg) and an interacting antibiotic started.',
        patientEvidence: ['INR 4.2 → 3.6', 'Admission note: continue warfarin 5 mg daily', 'Handwritten orders: warfarin 2.5 mg daily', 'Azithromycin started', 'Reduced oral intake'],
        clinicalSignificance: 'Bleeding risk; the intended dose is unclear, which is a medication safety issue in itself.',
        priority: 'high',
        evidenceBasis: 'INR above the target range requires dose holding or reduction according to INR level and bleeding; acute illness, reduced intake and some antibiotics can increase INR.',
        suggestedAction: 'Clarify the intended warfarin dose with the prescriber; consider holding doses until INR is in range per local anticoagulation protocol.',
        monitoring: 'Daily INR until stable; bleeding signs.',
        followUp: 'Reassess INR each morning.',
        missingData: ['Target INR', 'Time of last dose'],
        confidence: 0.82,
        status: 'possible',
      },
      {
        category: 'contraindication',
        medication: 'Metformin',
        condition: 'Acute kidney injury',
        description: 'Metformin continued during acute kidney injury with worsening creatinine and acute infection.',
        patientEvidence: ['Creatinine 1.8 → 2.1 mg/dL (baseline 1.1)', 'Estimated CrCl about 24 mL/min (Cockcroft-Gault, actual weight)', 'Metformin 1000 mg BID on inpatient orders'],
        clinicalSignificance: 'Risk of metformin accumulation and lactic acidosis during unstable renal function and sepsis.',
        priority: 'high',
        evidenceBasis: 'Metformin is usually withheld during acute kidney injury or acute illness with risk of hypoperfusion and restarted when renal function is stable.',
        suggestedAction: 'Recommend holding metformin and using an inpatient glycaemic plan; verify renal thresholds in a renal dosing reference.',
        monitoring: 'Creatinine daily, capillary glucose QID.',
        followUp: 'Review restart when renal function stabilises.',
        missingData: [],
        confidence: 0.84,
        status: 'possible',
      },
      {
        category: 'adverse_drug_reaction',
        medication: 'Lisinopril',
        condition: 'AKI with hyperkalaemia',
        description: 'ACE inhibitor continued during AKI with rising potassium, after recent NSAID exposure.',
        patientEvidence: ['Potassium 5.4 → 5.6 mmol/L', 'Creatinine rising', 'BP 104/62 mmHg', 'Ibuprofen 400 mg TID for one week before admission'],
        clinicalSignificance: 'ACE inhibitor + NSAID + volume depletion is a recognised cause of AKI and hyperkalaemia.',
        priority: 'high',
        evidenceBasis: 'ACE inhibitors are commonly withheld temporarily during AKI with hypotension or hyperkalaemia ("sick-day" principle).',
        suggestedAction: 'Suggest temporarily holding lisinopril; continue holding ibuprofen and choose non-NSAID analgesia.',
        monitoring: 'Potassium and creatinine daily; blood pressure.',
        followUp: 'Plan restart criteria before discharge.',
        missingData: ['Urine output'],
        confidence: 0.8,
        status: 'possible',
      },
      {
        category: 'contraindication',
        medication: 'Ceftriaxone',
        condition: 'Documented penicillin allergy (rash)',
        description: 'Ceftriaxone given with a documented penicillin allergy.',
        patientEvidence: ['Allergy: penicillin (rash)'],
        clinicalSignificance: 'Cross-reactivity between penicillins and third-generation cephalosporins with dissimilar side chains is low, particularly for non-severe reactions.',
        priority: 'low',
        evidenceBasis: 'A non-severe, remote penicillin rash is generally not a contraindication to third-generation cephalosporins; severe reactions require a different assessment.',
        suggestedAction: 'Document the allergy assessment (reaction type, timing) and monitor for hypersensitivity.',
        monitoring: 'Rash, urticaria, hypotension after doses.',
        followUp: '',
        missingData: ['Reaction severity and timing'],
        confidence: 0.7,
        status: 'not_supported',
      },
      {
        category: 'needs_additional_therapy',
        condition: 'Hyperglycaemia during infection',
        description: 'If metformin is held there is no glucose-lowering plan for glucose 186–212 mg/dL.',
        patientEvidence: ['Glucose 212 and 186 mg/dL'],
        clinicalSignificance: 'Hyperglycaemia during infection is associated with worse outcomes; hypoglycaemia risk also needs managing.',
        priority: 'medium',
        evidenceBasis: 'Hospitalised patients with persistent hyperglycaemia usually need a monitored insulin-based plan.',
        suggestedAction: 'Ask the team about capillary glucose monitoring and an insulin plan per local protocol.',
        monitoring: 'Capillary glucose before meals and at bedtime.',
        followUp: 'Daily glucose review.',
        missingData: ['HbA1c', 'Oral intake'],
        confidence: 0.65,
        status: 'needs_data',
      },
    ],
    medicationsReviewed: [
      { name: 'Warfarin', concern: 'flag', note: 'Supratherapeutic INR; conflicting dose.' },
      { name: 'Enoxaparin', concern: 'flag', note: 'Duplicate anticoagulation.' },
      { name: 'Metformin', concern: 'flag', note: 'AKI.' },
      { name: 'Lisinopril', concern: 'flag', note: 'AKI + hyperkalaemia.' },
      { name: 'Ibuprofen', concern: 'review', note: 'Held — keep held.' },
      { name: 'Ceftriaxone', concern: 'review', note: 'Allergy assessment.' },
      { name: 'Azithromycin', concern: 'review', note: 'May potentiate warfarin; QT.' },
      { name: 'Atorvastatin', concern: 'none', note: '' },
      { name: 'Paracetamol', concern: 'none', note: 'Preferred analgesic; watch total daily dose.' },
    ],
  },
  discussion: {
    problem: 'Duplicate anticoagulation: enoxaparin prophylaxis plus warfarin with an INR of 4.2.',
    patientEvidence: ['INR 4.2 then 3.6', 'Enoxaparin 40 mg SC daily ordered', 'Warfarin continued (5 mg vs 2.5 mg documented)', '78 years old, creatinine 2.1 mg/dL'],
    assessment: 'The patient is already anticoagulated above the usual AF range. Adding prophylactic LMWH gives no additional thrombotic protection but increases bleeding risk, which is amplified by age and renal impairment (enoxaparin is renally cleared).',
    evidenceSummary: 'VTE prophylaxis is not usually added for patients who are therapeutically anticoagulated. LMWH accumulates in renal impairment.',
    referencesToConsult: ['Local VTE prophylaxis protocol', 'Anticoagulation reference for INR management', 'Renal dosing reference for enoxaparin'],
    options: [
      { option: 'Stop enoxaparin; manage warfarin per INR', benefits: ['Removes duplicate anticoagulation', 'Simple'], risks: ['Gap in anticoagulation if warfarin is also held for long'] },
      { option: 'Hold warfarin and use a renally appropriate parenteral anticoagulant at treatment intensity once INR is in range', benefits: ['More controllable during acute illness'], risks: ['Complexity', 'Bleeding risk in renal impairment'] },
      { option: 'Continue both', benefits: [], risks: ['High bleeding risk', 'No added benefit'] },
    ],
    recommendationDraft: 'Suggest discontinuing enoxaparin 40 mg SC daily because the patient is anticoagulated with warfarin (INR 4.2). Clarify the intended warfarin dose and manage per INR and local protocol.',
    rationale: 'Avoids duplicate anticoagulation and bleeding in an elderly patient with AKI and supratherapeutic INR.',
    monitoring: ['INR daily', 'Haemoglobin and platelets', 'Signs of bleeding'],
    followUp: 'Confirm the order change and review INR tomorrow morning.',
    questionsForStudent: ['What is the usual INR target for AF and why?', 'What would you do if the patient developed melaena?', 'Which other drugs in this case could raise the INR?'],
  },
  monitoring: {
    items: [
      { parameter: 'INR', category: 'laboratory', why: 'Supratherapeutic on warfarin; azithromycin and acute illness may raise it.', baseline: '4.2 (10/03), 3.6 (11/03)', target: 'Within the documented target range (commonly 2–3 for AF)', timing: 'Every morning', frequency: 'Daily until stable', actionIfAbnormal: 'Hold or adjust warfarin per protocol; assess bleeding.', relatedTo: 'Warfarin' },
      { parameter: 'Serum creatinine', category: 'laboratory', why: 'AKI drives dosing of enoxaparin, metformin and antibiotics.', baseline: '1.8 → 2.1 mg/dL', target: 'Return toward baseline 1.1 mg/dL', timing: 'Morning bloods', frequency: 'Daily', actionIfAbnormal: 'Re-dose renally cleared drugs; review nephrotoxins.', relatedTo: 'AKI' },
      { parameter: 'Potassium', category: 'laboratory', why: 'Hyperkalaemia with ACE inhibitor in AKI.', baseline: '5.4 → 5.6 mmol/L', target: '3.5–5.0 mmol/L', timing: 'Morning bloods', frequency: 'Daily', actionIfAbnormal: 'Hold ACE inhibitor; escalate per hyperkalaemia protocol.', relatedTo: 'Lisinopril' },
      { parameter: 'Capillary blood glucose', category: 'laboratory', why: 'Hyperglycaemia with metformin held.', baseline: '212 mg/dL', target: 'Per local inpatient target', timing: 'Before meals and bedtime', frequency: 'QID', actionIfAbnormal: 'Adjust insulin plan; treat hypoglycaemia.', relatedTo: 'Diabetes' },
      { parameter: 'Temperature, RR, SpO2, confusion', category: 'clinical_response', why: 'Response to pneumonia therapy.', baseline: 'Temp 38.6, RR 24, SpO2 91%', target: 'Afebrile, RR < 20, SpO2 ≥ 94% RA, orientation normal', timing: 'Every nursing round', frequency: 'q4–6h', actionIfAbnormal: 'Review cultures and antimicrobial choice.', relatedTo: 'Pneumonia' },
      { parameter: 'Bleeding signs (stool, urine, gums, Hb)', category: 'safety', why: 'Anticoagulation above range.', baseline: 'Hb 11.2 g/dL', target: 'No bleeding; stable Hb', timing: 'Daily', frequency: 'Daily', actionIfAbnormal: 'Urgent review; hold anticoagulants.', relatedTo: 'Warfarin / enoxaparin' },
    ],
  },
  followUp: {
    items: [
      { window: 'today', dueInDays: 0, problem: 'Duplicate anticoagulation', reassess: 'Was enoxaparin stopped and the warfarin dose clarified?', expected: 'Single anticoagulant with clear dose', failureCriteria: 'Both still active', nextAction: 'Escalate to the consultant / anticoagulation service' },
      { window: 'next_review', dueInDays: 1, problem: 'AKI and hyperkalaemia', reassess: 'Creatinine, potassium, urine output', expected: 'Creatinine falling, K < 5.0', failureCriteria: 'Creatinine rising or K ≥ 6.0', nextAction: 'Review all renally cleared drugs; hyperkalaemia protocol' },
      { window: 'reassessment', dueInDays: 3, problem: 'Pneumonia', reassess: 'Clinical response, cultures, IV-to-oral eligibility, planned duration', expected: 'Afebrile, improving', failureCriteria: 'Persistent fever or deterioration', nextAction: 'Review antimicrobial choice with cultures' },
      { window: 'discharge', problem: 'Medication reconciliation', reassess: 'Restart plan for metformin and lisinopril; NSAID avoidance counselling', expected: 'Clear discharge list and counselling', failureCriteria: 'Unclear restart plan', nextAction: 'Discharge pharmacy note and patient counselling' },
    ],
  },
  teaching: {
    questions: [
      { question: 'What are this patient’s three highest-priority clinical problems, and why?', domain: 'problem_identification', hint: 'Think about what could harm the patient in the next 24 hours.', keyPoints: ['Pneumonia with confusion and hypoxaemia', 'Acute kidney injury', 'Supratherapeutic INR / bleeding risk'] },
      { question: 'Which medications need review because of the acute kidney injury?', domain: 'renal_dosing', hint: 'Look for renally cleared and nephrotoxic drugs.', keyPoints: ['Metformin', 'Enoxaparin', 'Lisinopril', 'Ibuprofen (NSAID)'] },
      { question: 'Is there a medication-related problem with the anticoagulants? What evidence supports it?', domain: 'drp_identification', hint: 'Compare all anticoagulant orders with the INR.', keyPoints: ['Duplicate anticoagulation warfarin plus enoxaparin', 'INR 4.2 above range', 'Conflicting warfarin dose 5 mg vs 2.5 mg'] },
      { question: 'What would you monitor over the next 48 hours, and how often?', domain: 'monitoring', hint: 'Link each parameter to a drug or problem.', keyPoints: ['INR daily', 'Creatinine and potassium daily', 'Capillary glucose', 'Bleeding signs', 'Temperature and oxygen saturation'] },
    ],
  },
  roundNoteText:
    'Ward round day 2. Patient less confused, still febrile 38.1. Team stopped enoxaparin. Warfarin held tonight, recheck INR tomorrow. Metformin held, start basal insulin per protocol. Lisinopril held. Sputum culture pending. Ask pharmacy to review antibiotic duration.',
  roundNote: {
    summary: 'Day 2: improving confusion, still febrile; anticoagulation and renal-risk drugs adjusted.',
    changes: ['Less confused', 'Still febrile (38.1 °C)'],
    medicationChanges: [
      { medication: 'Enoxaparin', change: 'Stopped' },
      { medication: 'Warfarin', change: 'Held tonight' },
      { medication: 'Metformin', change: 'Held' },
      { medication: 'Insulin (basal)', change: 'Start per protocol' },
      { medication: 'Lisinopril', change: 'Held' },
    ],
    decisions: ['Recheck INR tomorrow', 'Pharmacy to review antibiotic duration'],
    possibleNewDrps: ['Insulin dose and hypoglycaemia monitoring need checking'],
    followUpsRequired: ['INR tomorrow', 'Sputum culture result'],
    tasks: ['Review antibiotic duration', 'Check basal insulin order'],
  },
};

// ───────────────────────── Case 2 · Cardiology ─────────────────────────

const CARDIO: DemoCase = {
  key: 'cardio-hfref-dig',
  department: 'cardiology',
  title: 'Decompensated HFrEF with AF on digoxin and amiodarone',
  ward: 'Cardiology 2',
  age: 74,
  sex: 'Male',
  mainProblem: 'Acute decompensated HFrEF, AF, hyperkalaemia, raised digoxin level',
  priority: 'high',
  summary: '74-year-old man with HFrEF (EF 25%) admitted with fluid overload; on digoxin, recently started amiodarone and potassium supplements.',
  docs: [
    {
      key: 'admission',
      sourceType: 'admission_note',
      title: 'Cardiology admission note',
      date: '2026-04-02',
      pages: [
        {
          header: ['REGIONAL HEART CENTRE · CARDIOLOGY ADMISSION', 'Date: 2026-04-02    Cardiology 2    ID: DEMO-CA-02'],
          footer: ['Plan: IV furosemide 40 mg BID. Daily weights, strict fluid balance. Continue home medications.'],
        },
      ],
      patient: [
        { field: 'age', value: '74', unit: 'years', line: 'Age: 74 years    Sex: Male' },
        { field: 'sex', value: 'Male' },
        { field: 'weight_kg', value: '82', unit: 'kg', line: 'Weight: 82 kg (dry weight 78 kg)    Height: 175 cm' },
        { field: 'height_cm', value: '175', unit: 'cm' },
        { field: 'admission_date', value: '2026-04-02' },
        { field: 'chief_complaint', value: 'Worsening breathlessness, orthopnoea and leg swelling for one week', line: 'Chief complaint: Worsening breathlessness, orthopnoea and leg swelling for 1 week.' },
        { field: 'hpi', value: 'One week of progressive dyspnoea, 3-pillow orthopnoea and ankle swelling; 4 kg weight gain. Amiodarone started 3 weeks ago at an outside clinic for rate control. Reports nausea and poor appetite for 4 days.', line: 'HPI: Progressive dyspnoea, orthopnoea, +4 kg. Amiodarone started 3 weeks ago (outside clinic). Nausea, poor appetite x4 days.' },
        { field: 'pmh', value: 'Heart failure with reduced ejection fraction (EF 25%, echo 2025)', line: 'PMH: HFrEF (EF 25%, echo 2025); Atrial fibrillation; Hypertension; CKD stage 3a; previous hypokalaemia' },
        { field: 'pmh', value: 'Atrial fibrillation' },
        { field: 'pmh', value: 'Hypertension' },
        { field: 'pmh', value: 'Chronic kidney disease stage 3a' },
        { field: 'pmh', value: 'Previous hypokalaemia' },
        { field: 'nkda', value: 'No known drug allergies', line: 'Allergies: NKDA' },
        { field: 'vital', value: '98/60', unit: 'mmHg', detail: 'BP', date: '2026-04-02', line: 'Vitals: BP 98/60 | HR 108 irregular | RR 22 | SpO2 93% RA | Temp 36.8 °C' },
        { field: 'vital', value: '108', unit: 'bpm', detail: 'HR', date: '2026-04-02' },
        { field: 'vital', value: '22', unit: '/min', detail: 'RR', date: '2026-04-02' },
        { field: 'vital', value: '93', unit: '% RA', detail: 'SpO2', date: '2026-04-02' },
        { field: 'vital', value: '36.8', unit: '°C', detail: 'Temp', date: '2026-04-02' },
        { field: 'physical_exam', value: 'Raised JVP, bibasal crackles, pitting oedema to knees.', line: 'Exam: Raised JVP, bibasal crackles, pitting oedema to knees.' },
        { field: 'diagnosis', value: 'Acute decompensated heart failure (HFrEF)', line: 'Impression: Acute decompensated HFrEF; AF with rapid ventricular rate; hyperkalaemia.' },
        { field: 'diagnosis', value: 'Atrial fibrillation with rapid ventricular rate' },
        { field: 'diagnosis', value: 'Hyperkalaemia' },
      ],
      meds: [
        { name: 'Furosemide', dose: '40', unit: 'mg', route: 'PO', frequency: 'once daily', listType: 'home', confidence: 0.97 },
        { name: 'Lisinopril', dose: '10', unit: 'mg', route: 'PO', frequency: 'once daily', listType: 'home', confidence: 0.96 },
        { name: 'Spironolactone', dose: '25', unit: 'mg', route: 'PO', frequency: 'once daily', listType: 'home', confidence: 0.96 },
        { name: 'Metoprolol tartrate', dose: '25', unit: 'mg', route: 'PO', frequency: 'twice daily', listType: 'home', confidence: 0.95 },
        { name: 'Digoxin', dose: '0.25', unit: 'mg', route: 'PO', frequency: 'once daily', listType: 'home', confidence: 0.95 },
        { name: 'Apixaban', dose: '5', unit: 'mg', route: 'PO', frequency: 'twice daily', indication: 'AF', listType: 'home', confidence: 0.96 },
        { name: 'Potassium chloride', dose: '20', unit: 'mEq', route: 'PO', frequency: 'twice daily', listType: 'home', confidence: 0.94 },
        { name: 'Amiodarone', dose: '200', unit: 'mg', route: 'PO', frequency: 'once daily', indication: 'AF rate control', listType: 'home', confidence: 0.95 },
        { name: 'Furosemide', dose: '40', unit: 'mg', route: 'IV', frequency: 'twice daily', listType: 'current', confidence: 0.94 },
      ],
    },
    {
      key: 'labs',
      sourceType: 'lab_report',
      title: 'Admission laboratory report',
      date: '2026-04-02',
      pages: [{ header: ['LABORATORY REPORT', 'ID: DEMO-CA-02    Collected: 2026-04-02 10:15'] }],
      labs: [
        { name: 'Sodium', value: '131', unit: 'mmol/L', refRange: '135-145', flag: 'low', takenAt: '2026-04-02T10:15' },
        { name: 'Potassium', value: '5.6', unit: 'mmol/L', refRange: '3.5-5.1', flag: 'high', takenAt: '2026-04-02T10:15' },
        { name: 'Magnesium', value: '1.7', unit: 'mg/dL', refRange: '1.7-2.4', flag: 'normal', takenAt: '2026-04-02T10:15' },
        { name: 'Creatinine', value: '1.6', unit: 'mg/dL', refRange: '0.7-1.3', flag: 'high', takenAt: '2026-04-02T10:15' },
        { name: 'Urea (BUN)', value: '38', unit: 'mg/dL', refRange: '7-20', flag: 'high', takenAt: '2026-04-02T10:15' },
        { name: 'NT-proBNP', value: '4850', unit: 'pg/mL', refRange: '<450', flag: 'high', takenAt: '2026-04-02T10:15' },
        { name: 'Digoxin level', value: '2.3', unit: 'ng/mL', refRange: '0.8-2.0', flag: 'high', takenAt: '2026-04-02T10:15' },
        { name: 'Hemoglobin', value: '13.1', unit: 'g/dL', refRange: '13.5-17.5', flag: 'low', takenAt: '2026-04-02T10:15' },
        { name: 'Platelets', value: '190', unit: 'x10^9/L', refRange: '150-400', flag: 'normal', takenAt: '2026-04-02T10:15' },
      ],
    },
    {
      key: 'ecg',
      sourceType: 'ecg',
      title: 'ECG report',
      date: '2026-04-02',
      pages: [{ header: ['ECG REPORT', 'ID: DEMO-CA-02    2026-04-02 09:50'], footer: ['Reported by: cardiology registrar'] }],
      patient: [
        { field: 'diagnostic', value: 'Atrial fibrillation, ventricular rate 108 bpm, QTc 472 ms, no acute ST changes', detail: 'ECG', date: '2026-04-02', line: 'Rhythm: atrial fibrillation, ventricular rate 108 bpm. QTc 472 ms. No acute ST changes.' },
      ],
    },
  ],
  timeline: {
    events: [
      { dayLabel: '3 weeks before admission', kind: 'medication_start', label: 'Amiodarone 200 mg daily started (outside clinic)', detail: '', sourceLabel: 'Admission note' },
      { dayLabel: '4 days before admission', kind: 'clinical_event', label: 'Nausea and poor appetite', detail: 'Possible digoxin toxicity symptom.', sourceLabel: 'Admission note' },
      { date: '2026-04-02', kind: 'admission', label: 'Admitted with decompensated HFrEF', detail: '+4 kg above dry weight.', sourceLabel: 'Admission note' },
      { date: '2026-04-02', kind: 'lab', label: 'K 5.6, digoxin 2.3 ng/mL, creatinine 1.6 mg/dL', detail: '', sourceLabel: 'Laboratory report' },
      { date: '2026-04-02', kind: 'procedure', label: 'ECG: AF 108 bpm, QTc 472 ms', detail: '', sourceLabel: 'ECG report' },
      { date: '2026-04-02', kind: 'medication_start', label: 'IV furosemide 40 mg BID started', detail: '', sourceLabel: 'Admission note' },
    ],
    gaps: ['Date of last digoxin dose relative to the level is not documented.'],
  },
  analysis: {
    overview: {
      presentingProblem: 'Acute decompensated heart failure with fluid overload in a man with HFrEF (EF 25%).',
      relevantHistory: 'AF, hypertension, CKD 3a, previous hypokalaemia; amiodarone added 3 weeks ago.',
      importantMedications: ['Digoxin 0.25 mg daily', 'Amiodarone 200 mg daily (new)', 'Spironolactone + lisinopril + potassium chloride', 'Metoprolol tartrate 25 mg BID', 'Apixaban 5 mg BID'],
      importantFindings: ['Digoxin level 2.3 ng/mL with nausea', 'Potassium 5.6 mmol/L', 'Creatinine 1.6 mg/dL', 'QTc 472 ms', 'BP 98/60 mmHg'],
      clinicalInstability: ['Fluid overload with hypoxaemia', 'Borderline low blood pressure'],
      potentialMedicationConcerns: ['Digoxin–amiodarone interaction', 'Hyperkalaemia from triple potassium-raising therapy', 'Non-evidence-based beta-blocker for HFrEF', 'No SGLT2 inhibitor'],
    },
    suggestedProblems: [
      { name: 'Acute decompensated HFrEF', rationale: 'Dyspnoea, orthopnoea, oedema, raised JVP, +4 kg, NT-proBNP 4850.', supportingData: ['NT-proBNP 4850 pg/mL', 'Weight 82 kg vs dry 78 kg'], priority: 'high', priorityReason: 'Symptomatic and hypoxaemic.' },
      { name: 'Possible digoxin toxicity', rationale: 'Level 2.3 ng/mL with nausea after amiodarone was added and with reduced renal function.', supportingData: ['Digoxin 2.3 ng/mL', 'Nausea x4 days'], priority: 'high', priorityReason: 'Risk of arrhythmia.' },
      { name: 'Hyperkalaemia', rationale: 'K 5.6 on spironolactone, lisinopril and potassium supplements.', supportingData: ['K 5.6 mmol/L'], priority: 'high', priorityReason: 'Arrhythmia risk, especially with digoxin.' },
      { name: 'AF with rapid ventricular rate', rationale: 'HR 108 irregular.', supportingData: ['ECG AF 108 bpm'], priority: 'medium', priorityReason: 'Likely driven by decompensation.' },
    ],
    missingInformation: [
      { item: 'Timing of the digoxin level relative to the last dose', whyItMatters: 'Levels drawn within about 6 hours of a dose are not interpretable.' },
      { item: 'Urine output and daily weights', whyItMatters: 'Needed to judge diuretic response.' },
      { item: 'eGFR trend', whyItMatters: 'Guides digoxin, spironolactone and SGLT2 inhibitor decisions.' },
      { item: 'Thyroid and liver function', whyItMatters: 'Amiodarone monitoring baseline.' },
    ],
    inferences: [{ statement: 'Amiodarone likely increased digoxin exposure.', basis: 'Known interaction; level rose after amiodarone start (no previous level documented).' }],
  },
  drps: {
    drps: [
      {
        category: 'drug_interaction',
        medication: 'Digoxin',
        condition: 'AF / HFrEF',
        description: 'Elevated digoxin level with symptoms after amiodarone was added; reduced renal function.',
        patientEvidence: ['Digoxin level 2.3 ng/mL', 'Amiodarone started 3 weeks ago', 'Nausea and poor appetite', 'Creatinine 1.6 mg/dL', 'Age 74'],
        clinicalSignificance: 'Digoxin toxicity can cause life-threatening arrhythmias, especially with electrolyte disturbance.',
        priority: 'high',
        evidenceBasis: 'Amiodarone reduces digoxin clearance; digoxin dose is usually reduced when amiodarone is started and levels monitored. Lower concentrations are targeted in heart failure.',
        suggestedAction: 'Recommend holding digoxin, rechecking a correctly timed level and electrolytes, and reviewing the need for digoxin.',
        monitoring: 'Digoxin level, potassium, magnesium, ECG, symptoms.',
        followUp: 'Repeat level in 24–48 h before any restart.',
        missingData: ['Timing of level relative to dose'],
        confidence: 0.88,
        status: 'possible',
      },
      {
        category: 'unnecessary_therapy',
        medication: 'Potassium chloride',
        condition: 'Hyperkalaemia',
        description: 'Potassium supplement continued with spironolactone and lisinopril while potassium is 5.6 mmol/L.',
        patientEvidence: ['K 5.6 mmol/L', 'Spironolactone 25 mg daily', 'Lisinopril 10 mg daily', 'Creatinine 1.6 mg/dL'],
        clinicalSignificance: 'Further rise in potassium risks arrhythmia.',
        priority: 'high',
        evidenceBasis: 'Potassium supplements are generally not needed with an MRA and ACE inhibitor unless potassium is low.',
        suggestedAction: 'Recommend stopping potassium chloride; review spironolactone while K > 5.5 per local protocol.',
        monitoring: 'Potassium and creatinine daily during diuresis.',
        followUp: 'Recheck K in 24 h.',
        missingData: [],
        confidence: 0.9,
        status: 'possible',
      },
      {
        category: 'ineffective_therapy',
        medication: 'Metoprolol tartrate',
        condition: 'HFrEF',
        description: 'Metoprolol tartrate is not one of the beta-blockers with outcome evidence in HFrEF.',
        patientEvidence: ['EF 25%', 'Metoprolol tartrate 25 mg BID'],
        clinicalSignificance: 'Missed mortality benefit of evidence-based beta-blockade in HFrEF.',
        priority: 'medium',
        evidenceBasis: 'Evidence-based beta-blockers for HFrEF include bisoprolol, carvedilol and metoprolol succinate; switching is normally done when the patient is euvolaemic and stable.',
        suggestedAction: 'Plan substitution to an evidence-based beta-blocker once decompensation resolves and BP allows.',
        monitoring: 'Heart rate, blood pressure, symptoms.',
        followUp: 'Before discharge.',
        missingData: [],
        confidence: 0.78,
        status: 'possible',
      },
      {
        category: 'needs_additional_therapy',
        condition: 'HFrEF (EF 25%)',
        description: 'No SGLT2 inhibitor in a patient with HFrEF.',
        patientEvidence: ['EF 25%', 'Current medication list has no SGLT2 inhibitor'],
        clinicalSignificance: 'Missed guideline-directed therapy with outcome benefit.',
        priority: 'medium',
        evidenceBasis: 'SGLT2 inhibitors are a pillar of HFrEF therapy when renal function and volume status allow.',
        suggestedAction: 'Discuss initiation once haemodynamically stable; check eGFR threshold in the product information.',
        monitoring: 'eGFR, volume status, genital infection counselling.',
        followUp: 'Before discharge.',
        missingData: ['eGFR', 'Diabetes status'],
        confidence: 0.7,
        status: 'needs_data',
      },
      {
        category: 'dose_too_low',
        medication: 'Apixaban',
        condition: 'AF',
        description: 'Check whether apixaban dose reduction is required.',
        patientEvidence: ['Age 74', 'Weight 82 kg', 'Creatinine 1.6 mg/dL'],
        clinicalSignificance: 'Only one dose-reduction criterion (creatinine ≥ 1.5 mg/dL) is met; the standard dose is appropriate.',
        priority: 'low',
        evidenceBasis: 'For AF, apixaban dose reduction is labelled when at least two of age ≥ 80, weight ≤ 60 kg and creatinine ≥ 1.5 mg/dL are present.',
        suggestedAction: 'No change; document the assessment.',
        monitoring: 'Renal function, bleeding.',
        followUp: '',
        missingData: [],
        confidence: 0.85,
        status: 'not_supported',
      },
      {
        category: 'monitoring_problem',
        medication: 'Amiodarone',
        condition: 'QTc 472 ms',
        description: 'QTc is prolonged on amiodarone and magnesium is at the lower limit; no QTc or thyroid/liver monitoring plan documented.',
        patientEvidence: ['QTc 472 ms', 'Magnesium 1.7 mg/dL', 'Amiodarone 200 mg daily'],
        clinicalSignificance: 'Electrolyte depletion during diuresis increases arrhythmia risk.',
        priority: 'medium',
        evidenceBasis: 'Amiodarone requires ECG, thyroid and liver monitoring; electrolytes should be kept in range during diuresis.',
        suggestedAction: 'Recommend magnesium/potassium monitoring during diuresis, ECG follow-up and baseline TFT/LFT.',
        monitoring: 'ECG, Mg, K, TFT, LFT.',
        followUp: 'ECG in 24–48 h.',
        missingData: ['TFT', 'LFT'],
        confidence: 0.75,
        status: 'possible',
      },
    ],
    medicationsReviewed: [
      { name: 'Digoxin', concern: 'flag', note: 'Level 2.3 with interaction.' },
      { name: 'Potassium chloride', concern: 'flag', note: 'K 5.6.' },
      { name: 'Spironolactone', concern: 'review', note: 'K 5.6.' },
      { name: 'Lisinopril', concern: 'review', note: 'K 5.6; BP 98/60.' },
      { name: 'Metoprolol tartrate', concern: 'review', note: 'Not evidence-based in HFrEF.' },
      { name: 'Amiodarone', concern: 'review', note: 'Interaction and monitoring.' },
      { name: 'Apixaban', concern: 'none', note: 'Dose appropriate.' },
      { name: 'Furosemide', concern: 'none', note: 'IV for decongestion.' },
    ],
  },
  discussion: {
    problem: 'Elevated digoxin level after amiodarone was added.',
    patientEvidence: ['Digoxin 2.3 ng/mL', 'Nausea, poor appetite', 'Amiodarone started 3 weeks ago', 'Creatinine 1.6 mg/dL', 'K 5.6 mmol/L'],
    assessment: 'The level is above range with compatible symptoms and two mechanisms for accumulation (interaction and reduced clearance). Hyperkalaemia and diuretic-induced electrolyte shifts add arrhythmic risk.',
    evidenceSummary: 'Amiodarone inhibits P-glycoprotein and raises digoxin concentrations; digoxin doses are usually reduced when amiodarone is started. Lower serum concentrations are targeted in heart failure.',
    referencesToConsult: ['Drug interaction reference', 'Digoxin monograph / TDM guidance', 'Local heart failure protocol'],
    options: [
      { option: 'Hold digoxin, repeat a correctly timed level, then decide on a lower dose or discontinuation', benefits: ['Addresses toxicity risk', 'Allows reassessment of need'], risks: ['Less rate control in the short term'] },
      { option: 'Continue at a reduced dose immediately', benefits: ['Maintains rate control'], risks: ['Still toxic until level falls'] },
      { option: 'Discontinue digoxin and rely on beta-blockade', benefits: ['Removes interaction'], risks: ['Rate control may be insufficient during decompensation'] },
    ],
    recommendationDraft: 'Suggest holding digoxin, repeating the digoxin level with electrolytes, and reviewing whether digoxin is still needed given amiodarone; if continued, a reduced dose with level monitoring.',
    rationale: 'Elevated level with symptoms and a clear interaction mechanism in a patient with CKD.',
    monitoring: ['Digoxin level 24–48 h', 'K and Mg daily', 'ECG', 'Nausea, visual symptoms, bradycardia'],
    followUp: 'Review level and ECG before any restart.',
    questionsForStudent: ['Why is the timing of a digoxin level important?', 'How does hyperkalaemia or hypokalaemia change digoxin toxicity?', 'What alternatives exist for rate control in HFrEF?'],
  },
  monitoring: {
    items: [
      { parameter: 'Potassium', category: 'laboratory', why: 'Hyperkalaemia with MRA + ACE inhibitor + supplement; diuresis may shift it quickly.', baseline: '5.6 mmol/L', target: '4.0–5.0 mmol/L', timing: 'Morning bloods', frequency: 'Daily', actionIfAbnormal: 'Adjust supplements/MRA; hyperkalaemia protocol.', relatedTo: 'Potassium chloride / spironolactone' },
      { parameter: 'Digoxin level', category: 'drug_specific', why: 'Above range with interaction.', baseline: '2.3 ng/mL', target: 'Lower range used in heart failure (verify local target)', timing: '≥ 6 h post dose', frequency: 'Repeat in 24–48 h', actionIfAbnormal: 'Keep held; consider specialist advice if toxic features.', relatedTo: 'Digoxin' },
      { parameter: 'Weight and fluid balance', category: 'clinical_response', why: 'Response to decongestion.', baseline: '82 kg (dry 78 kg)', target: 'Return toward dry weight', timing: 'Same time daily', frequency: 'Daily', actionIfAbnormal: 'Adjust diuretic dose.', relatedTo: 'Furosemide' },
      { parameter: 'ECG / QTc and heart rate', category: 'safety', why: 'QTc 472 ms on amiodarone; digoxin toxicity.', baseline: 'QTc 472 ms, HR 108', target: 'No further QTc prolongation; rate control', timing: 'Daily', frequency: 'Daily and if symptoms', actionIfAbnormal: 'Correct electrolytes; review QT drugs.', relatedTo: 'Amiodarone' },
      { parameter: 'Creatinine', category: 'laboratory', why: 'Diuresis, ACE inhibitor, digoxin clearance.', baseline: '1.6 mg/dL', target: 'Stable', timing: 'Morning bloods', frequency: 'Daily', actionIfAbnormal: 'Review diuretic and renally cleared drugs.', relatedTo: 'Lisinopril / digoxin' },
    ],
  },
  followUp: {
    items: [
      { window: 'today', dueInDays: 0, problem: 'Hyperkalaemia and digoxin', reassess: 'Were potassium chloride and digoxin held?', expected: 'Orders updated', failureCriteria: 'Still active', nextAction: 'Escalate to the cardiology registrar' },
      { window: 'next_review', dueInDays: 1, problem: 'Electrolytes and decongestion', reassess: 'K, Mg, creatinine, weight', expected: 'K < 5.0, weight falling', failureCriteria: 'K rising, weight unchanged', nextAction: 'Review diuretic and MRA' },
      { window: 'reassessment', dueInDays: 2, problem: 'Digoxin', reassess: 'Repeat level and ECG', expected: 'Level falling, no toxicity signs', failureCriteria: 'Persistent symptoms or arrhythmia', nextAction: 'Discuss discontinuation' },
      { window: 'discharge', problem: 'GDMT optimisation', reassess: 'Beta-blocker substitution and SGLT2 inhibitor plan', expected: 'Evidence-based regimen documented', failureCriteria: 'No plan', nextAction: 'Heart failure discharge counselling' },
    ],
  },
  teaching: {
    questions: [
      { question: 'Which laboratory results are most dangerous for this patient right now and why?', domain: 'patient_assessment', hint: 'Think about arrhythmia risk.', keyPoints: ['Potassium 5.6', 'Digoxin level 2.3', 'QTc 472 ms', 'Magnesium at lower limit'] },
      { question: 'Explain the interaction between amiodarone and digoxin and what you would recommend.', domain: 'interaction_assessment', hint: 'Mechanism, expected effect, action.', keyPoints: ['Amiodarone reduces digoxin clearance (P-gp)', 'Digoxin level rises', 'Hold or reduce digoxin', 'Repeat level and monitor'] },
      { question: 'Is this patient on optimal guideline-directed therapy for HFrEF? What is missing?', domain: 'medication_review', hint: 'Check each pillar.', keyPoints: ['Evidence-based beta-blocker missing (tartrate)', 'No SGLT2 inhibitor', 'ACE inhibitor/ARNI present', 'MRA present but K high'] },
    ],
  },
  roundNoteText:
    'Day 2 cardiology round. Weight down 1.5 kilos, still crackles. Potassium 5.1 today. Digoxin held, potassium chloride stopped. Plan to start dapagliflozin before discharge if creatinine stable. Switch metoprolol tartrate to bisoprolol when euvolaemic.',
  roundNote: {
    summary: 'Day 2: diuresing; potassium improving after supplements stopped; digoxin held.',
    changes: ['Weight −1.5 kg', 'Persistent crackles', 'K 5.1 mmol/L'],
    medicationChanges: [
      { medication: 'Digoxin', change: 'Held' },
      { medication: 'Potassium chloride', change: 'Stopped' },
      { medication: 'Dapagliflozin', change: 'Planned before discharge if creatinine stable' },
      { medication: 'Metoprolol tartrate → bisoprolol', change: 'Planned when euvolaemic' },
    ],
    decisions: ['Continue IV diuresis'],
    possibleNewDrps: ['Check SGLT2 inhibitor renal threshold and volume status before initiation'],
    followUpsRequired: ['Repeat digoxin level', 'Daily K and creatinine'],
    tasks: ['Prepare GDMT counselling', 'Check dapagliflozin eGFR threshold'],
  },
};

// ───────────────────────── Case 3 · Hematology / Leukemia ─────────────────────────

const ONC: DemoCase = {
  key: 'heme-aml-induction',
  department: 'hematology',
  title: 'AML induction day 3: fever, neutropenia and rising uric acid',
  ward: 'Haematology 1',
  age: 45,
  sex: 'Female',
  mainProblem: 'AML on 7+3 induction with febrile neutropenia and laboratory tumour lysis',
  priority: 'high',
  summary: '45-year-old woman with newly diagnosed AML on cytarabine + daunorubicin induction; febrile and neutropenic on day 3.',
  docs: [
    {
      key: 'chemo',
      sourceType: 'oncology_sheet',
      title: 'Chemotherapy and supportive care orders',
      date: '2026-05-04',
      pages: [
        {
          header: [
            'HAEMATOLOGY · CHEMOTHERAPY ORDER SHEET',
            'ID: DEMO-HE-03    Regimen: "7+3" induction    Start: 2026-05-04 (Day 1)',
            'Diagnosis: Acute myeloid leukaemia (newly diagnosed)',
          ],
          footer: ['Supportive care ordered on Day 1. Prescriber and pharmacist double-check required.'],
        },
      ],
      patient: [
        { field: 'age', value: '45', unit: 'years', line: 'Age: 45 years    Sex: Female' },
        { field: 'sex', value: 'Female' },
        { field: 'height_cm', value: '165', unit: 'cm', line: 'Height: 165 cm    Weight: 70 kg    BSA: 1.79 m2' },
        { field: 'weight_kg', value: '70', unit: 'kg' },
        { field: 'allergy', value: 'Sulfonamide antibiotics', detail: 'Hives', line: 'Allergies: Sulfonamide antibiotics (hives)' },
        { field: 'diagnosis', value: 'Acute myeloid leukaemia (newly diagnosed)' },
        { field: 'admission_date', value: '2026-05-03' },
      ],
      meds: [
        { name: 'Cytarabine', dose: '180', unit: 'mg', route: 'IV continuous infusion', frequency: 'per 24 h, days 1-7', indication: 'AML (100 mg/m2/day)', listType: 'current', confidence: 0.95, line: 'Cytarabine 100 mg/m2/day = 180 mg IV continuous infusion per 24 h, days 1-7' },
        { name: 'Daunorubicin', dose: '170', unit: 'mg', route: 'IV', frequency: 'daily, days 1-3', indication: 'AML (60 mg/m2)', listType: 'current', confidence: 0.94, line: 'Daunorubicin 60 mg/m2 = 170 mg IV daily, days 1-3' },
        { name: 'Ondansetron', dose: '8', unit: 'mg', route: 'IV', frequency: 'every 8 hours', listType: 'current', confidence: 0.95 },
        { name: 'Allopurinol', dose: '300', unit: 'mg', route: 'PO', frequency: 'once daily', listType: 'current', confidence: 0.95 },
        { name: 'Posaconazole', dose: '300', unit: 'mg', route: 'PO', frequency: 'once daily', indication: 'Antifungal prophylaxis', listType: 'current', confidence: 0.94 },
        { name: 'Levofloxacin', dose: '500', unit: 'mg', route: 'PO', frequency: 'once daily', indication: 'Antibacterial prophylaxis', listType: 'current', confidence: 0.94 },
        { name: 'Acyclovir', dose: '400', unit: 'mg', route: 'PO', frequency: 'twice daily', indication: 'Antiviral prophylaxis', listType: 'current', confidence: 0.94 },
      ],
    },
    {
      key: 'labs',
      sourceType: 'lab_report',
      title: 'Laboratory results day 1 and day 3',
      date: '2026-05-06',
      pages: [
        { header: ['LABORATORY REPORT', 'ID: DEMO-HE-03    Collected: 2026-05-04 06:30 (Day 1)'] },
        { header: ['LABORATORY REPORT', 'ID: DEMO-HE-03    Collected: 2026-05-06 06:30 (Day 3)'] },
      ],
      labs: [
        { name: 'Creatinine', value: '0.8', unit: 'mg/dL', refRange: '0.5-1.1', flag: 'normal', takenAt: '2026-05-04T06:30' },
        { name: 'Uric acid', value: '7.1', unit: 'mg/dL', refRange: '2.5-6.0', flag: 'high', takenAt: '2026-05-04T06:30' },
        { name: 'Potassium', value: '4.3', unit: 'mmol/L', refRange: '3.5-5.1', flag: 'normal', takenAt: '2026-05-04T06:30' },
        { name: 'Phosphate', value: '4.0', unit: 'mg/dL', refRange: '2.5-4.5', flag: 'normal', takenAt: '2026-05-04T06:30' },
        { name: 'WBC', value: '1.2', unit: 'x10^9/L', refRange: '4.0-11.0', flag: 'low', takenAt: '2026-05-04T06:30' },
        { name: 'Creatinine', value: '1.3', unit: 'mg/dL', refRange: '0.5-1.1', flag: 'high', takenAt: '2026-05-06T06:30', page: 2 },
        { name: 'Uric acid', value: '9.8', unit: 'mg/dL', refRange: '2.5-6.0', flag: 'high', takenAt: '2026-05-06T06:30', page: 2 },
        { name: 'Potassium', value: '5.2', unit: 'mmol/L', refRange: '3.5-5.1', flag: 'high', takenAt: '2026-05-06T06:30', page: 2 },
        { name: 'Phosphate', value: '5.6', unit: 'mg/dL', refRange: '2.5-4.5', flag: 'high', takenAt: '2026-05-06T06:30', page: 2 },
        { name: 'Calcium', value: '7.6', unit: 'mg/dL', refRange: '8.5-10.5', flag: 'low', takenAt: '2026-05-06T06:30', page: 2 },
        { name: 'Albumin', value: '3.2', unit: 'g/dL', refRange: '3.5-5.0', flag: 'low', takenAt: '2026-05-06T06:30', page: 2 },
        { name: 'LDH', value: '980', unit: 'U/L', refRange: '120-250', flag: 'high', takenAt: '2026-05-06T06:30', page: 2 },
        { name: 'WBC', value: '0.6', unit: 'x10^9/L', refRange: '4.0-11.0', flag: 'low', takenAt: '2026-05-06T06:30', page: 2 },
        { name: 'ANC', value: '0.2', unit: 'x10^9/L', refRange: '1.5-7.5', flag: 'critical', takenAt: '2026-05-06T06:30', page: 2 },
        { name: 'Hemoglobin', value: '7.4', unit: 'g/dL', refRange: '12.0-15.5', flag: 'low', takenAt: '2026-05-06T06:30', page: 2 },
        { name: 'Platelets', value: '18', unit: 'x10^9/L', refRange: '150-400', flag: 'critical', takenAt: '2026-05-06T06:30', page: 2 },
        { name: 'ALT', value: '48', unit: 'U/L', refRange: '7-35', flag: 'high', takenAt: '2026-05-06T06:30', page: 2 },
        { name: 'Bilirubin (total)', value: '1.0', unit: 'mg/dL', refRange: '0.2-1.2', flag: 'normal', takenAt: '2026-05-06T06:30', page: 2 },
      ],
    },
    {
      key: 'nursing',
      sourceType: 'nursing_note',
      title: 'Handwritten nursing note',
      date: '2026-05-06',
      handwritten: true,
      pages: [{ header: ['Nursing note — Haem 1 — 06/05 22:00'], footer: ['RN [illegible]'] }],
      patient: [
        { field: 'vital', value: '38.4', unit: '°C', detail: 'Temp', date: '2026-05-06T22:00', confidence: 0.81, line: 'T 38.4 C, HR 118, BP 100/58. Rigors. Dr informed.' },
        { field: 'vital', value: '118', unit: 'bpm', detail: 'HR', date: '2026-05-06T22:00', confidence: 0.8 },
        { field: 'vital', value: '100/58', unit: 'mmHg', detail: 'BP', date: '2026-05-06T22:00', confidence: 0.72, alternatives: ['100/68'] },
        { field: 'hpi', value: 'Rigors on day 3; nausea with two episodes of vomiting.', confidence: 0.76, line: 'Pt c/o nausea, vomited x2.' },
      ],
    },
  ],
  timeline: {
    events: [
      { date: '2026-05-03', kind: 'admission', label: 'Admitted with newly diagnosed AML', detail: '', sourceLabel: 'Order sheet' },
      { date: '2026-05-04', dayLabel: 'Day 1', kind: 'medication_start', label: '7+3 induction started (cytarabine CI + daunorubicin)', detail: 'Supportive care and prophylaxis started.', sourceLabel: 'Order sheet' },
      { date: '2026-05-04', dayLabel: 'Day 1', kind: 'lab', label: 'Creatinine 0.8, uric acid 7.1, K 4.3, phosphate 4.0', detail: '', sourceLabel: 'Laboratory report' },
      { date: '2026-05-06', dayLabel: 'Day 3', kind: 'lab', label: 'Creatinine 1.3, uric acid 9.8, K 5.2, phosphate 5.6, Ca 7.6; ANC 0.2, platelets 18', detail: 'Pattern consistent with laboratory TLS.', sourceLabel: 'Laboratory report' },
      { date: '2026-05-06', dayLabel: 'Day 3 22:00', kind: 'clinical_event', label: 'Fever 38.4 °C with rigors, HR 118; vomiting x2', detail: '', sourceLabel: 'Nursing note' },
    ],
    gaps: ['Whether empiric antibiotics were started after the fever is not documented.', 'G6PD status not documented.'],
  },
  analysis: {
    overview: {
      presentingProblem: 'Febrile neutropenia on day 3 of AML induction with laboratory evidence of tumour lysis.',
      relevantHistory: 'Newly diagnosed AML; sulfonamide allergy (hives).',
      importantMedications: ['Cytarabine 180 mg/24 h CI', 'Daunorubicin 170 mg IV days 1–3', 'Allopurinol 300 mg', 'Posaconazole, levofloxacin, acyclovir prophylaxis', 'Ondansetron 8 mg IV q8h'],
      importantFindings: ['Temperature 38.4 °C with rigors, HR 118', 'ANC 0.2 x10^9/L', 'Uric acid 7.1 → 9.8 mg/dL', 'K 5.2, phosphate 5.6, calcium 7.6', 'Creatinine 0.8 → 1.3 mg/dL', 'Platelets 18 x10^9/L, Hb 7.4 g/dL'],
      clinicalInstability: ['Fever with tachycardia and borderline BP in a neutropenic patient'],
      potentialMedicationConcerns: ['No empiric broad-spectrum antibiotic documented', 'Daunorubicin dose does not match 60 mg/m2 × BSA', 'TLS not controlled by allopurinol alone', 'Additive QT risk (posaconazole, levofloxacin, ondansetron) without documented QTc'],
    },
    suggestedProblems: [
      { name: 'Febrile neutropenia', rationale: 'T 38.4 °C with ANC 0.2 x10^9/L.', supportingData: ['T 38.4 °C', 'ANC 0.2'], priority: 'high', priorityReason: 'Medical emergency; antibiotics are time-critical.' },
      { name: 'Laboratory tumour lysis syndrome with AKI', rationale: 'Rising uric acid, potassium, phosphate, falling calcium and creatinine rise.', supportingData: ['Uric acid 9.8', 'Creatinine 1.3'], priority: 'high', priorityReason: 'Risk of renal failure and arrhythmia.' },
      { name: 'Chemotherapy dose verification (daunorubicin)', rationale: '170 mg does not equal 60 mg/m2 × 1.79 m2 (~107 mg).', supportingData: ['BSA 1.79 m2', 'Daunorubicin 170 mg'], priority: 'high', priorityReason: 'Potential medication error with a high-alert drug.' },
      { name: 'Chemotherapy-induced nausea and vomiting', rationale: 'Vomited twice on ondansetron alone.', supportingData: ['Vomiting x2'], priority: 'medium', priorityReason: 'Affects intake and oral prophylaxis absorption.' },
      { name: 'Severe thrombocytopenia and anaemia', rationale: 'Platelets 18, Hb 7.4.', supportingData: ['Plt 18', 'Hb 7.4'], priority: 'medium', priorityReason: 'Transfusion thresholds per protocol.' },
    ],
    missingInformation: [
      { item: 'Blood cultures and empiric antibiotic orders after the fever', whyItMatters: 'Febrile neutropenia needs prompt empiric therapy.' },
      { item: 'G6PD status', whyItMatters: 'Required before rasburicase.' },
      { item: 'Baseline ECG / QTc', whyItMatters: 'Several QT-prolonging drugs and electrolyte shifts.' },
      { item: 'Baseline ejection fraction', whyItMatters: 'Anthracycline cardiotoxicity risk.' },
      { item: 'Fluid balance / urine output', whyItMatters: 'TLS management.' },
    ],
    inferences: [{ statement: 'The daunorubicin dose may reflect a calculation error or a different dose intent.', basis: '170 mg ÷ 1.79 m2 ≈ 95 mg/m2, which matches neither 60 nor 90 mg/m2.' }],
  },
  drps: {
    drps: [
      {
        category: 'needs_additional_therapy',
        condition: 'Febrile neutropenia',
        description: 'Fever with ANC 0.2 and no empiric broad-spectrum (antipseudomonal) antibiotic documented; levofloxacin is prophylaxis only.',
        patientEvidence: ['Temperature 38.4 °C with rigors', 'ANC 0.2 x10^9/L', 'HR 118, BP 100/58', 'Current antibacterial: levofloxacin prophylaxis only'],
        clinicalSignificance: 'Delay in empiric therapy in febrile neutropenia increases mortality.',
        priority: 'high',
        evidenceBasis: 'Febrile neutropenia is managed as an emergency with prompt empiric antipseudomonal beta-lactam therapy after cultures; prophylactic fluoroquinolone is usually stopped when empiric therapy starts.',
        suggestedAction: 'Urgently confirm cultures and empiric antipseudomonal therapy per local febrile neutropenia protocol, considering the sulfonamide allergy and renal function.',
        monitoring: 'Temperature, haemodynamics, cultures, renal function.',
        followUp: 'Reassess at 48–72 h with cultures.',
        missingData: ['Blood culture status', 'Local antibiogram'],
        confidence: 0.9,
        status: 'possible',
      },
      {
        category: 'dose_too_high',
        medication: 'Daunorubicin',
        condition: 'AML induction',
        description: 'Ordered dose 170 mg does not match the written 60 mg/m2 × BSA 1.79 m2 (≈107 mg).',
        patientEvidence: ['Order: daunorubicin 60 mg/m2 = 170 mg', 'Height 165 cm, weight 70 kg, BSA 1.79 m2'],
        clinicalSignificance: 'Anthracycline overdose increases myelosuppression, mucositis and cardiotoxicity.',
        priority: 'high',
        evidenceBasis: 'Chemotherapy doses must be independently verified against protocol, BSA and organ function before each dose.',
        suggestedAction: 'Stop and verify the dose and intended mg/m2 with the prescriber and the protocol before the next dose; report per medication-safety policy.',
        monitoring: 'CBC, mucositis, cardiac function.',
        followUp: 'Confirm verification before next administration.',
        missingData: ['Protocol dose intent (60 vs 90 mg/m2)'],
        confidence: 0.9,
        status: 'possible',
      },
      {
        category: 'ineffective_therapy',
        medication: 'Allopurinol',
        condition: 'Laboratory tumour lysis syndrome',
        description: 'Uric acid is rising on allopurinol with creatinine rise — allopurinol does not lower existing uric acid quickly.',
        patientEvidence: ['Uric acid 7.1 → 9.8 mg/dL', 'Creatinine 0.8 → 1.3 mg/dL', 'K 5.2, phosphate 5.6, Ca 7.6'],
        clinicalSignificance: 'Progression to clinical TLS with renal failure or arrhythmia.',
        priority: 'high',
        evidenceBasis: 'Established hyperuricaemia in TLS is commonly treated with rasburicase (contraindicated in G6PD deficiency) plus aggressive hydration.',
        suggestedAction: 'Discuss rasburicase per protocol after confirming G6PD status; review hydration and electrolytes.',
        monitoring: 'TLS labs every 6–12 h, urine output.',
        followUp: 'Repeat TLS panel today.',
        missingData: ['G6PD status', 'Urine output'],
        confidence: 0.8,
        status: 'needs_data',
      },
      {
        category: 'monitoring_problem',
        medication: 'Posaconazole',
        condition: 'QT prolongation risk',
        description: 'Three QT-prolonging drugs (posaconazole, levofloxacin, ondansetron) with electrolyte shifts and no documented QTc.',
        patientEvidence: ['Posaconazole 300 mg daily', 'Levofloxacin 500 mg daily', 'Ondansetron 8 mg IV q8h', 'Calcium 7.6 mg/dL', 'K 5.2 mmol/L'],
        clinicalSignificance: 'Risk of torsades de pointes.',
        priority: 'medium',
        evidenceBasis: 'Combinations of QT-prolonging drugs require baseline and follow-up ECG and electrolyte correction.',
        suggestedAction: 'Recommend baseline ECG with QTc and electrolyte correction; reconsider levofloxacin once empiric therapy starts.',
        monitoring: 'ECG / QTc, K, Mg, Ca.',
        followUp: 'ECG today.',
        missingData: ['QTc', 'Magnesium'],
        confidence: 0.78,
        status: 'possible',
      },
      {
        category: 'ineffective_therapy',
        medication: 'Ondansetron',
        condition: 'Chemotherapy-induced nausea and vomiting',
        description: 'Breakthrough vomiting on ondansetron monotherapy.',
        patientEvidence: ['Vomited x2 on day 3', 'Ondansetron 8 mg IV q8h only'],
        clinicalSignificance: 'Poor intake, dehydration (worsens TLS/AKI) and reduced absorption of oral prophylaxis.',
        priority: 'medium',
        evidenceBasis: 'Antiemetic prophylaxis should match the emetogenic risk of the regimen; breakthrough nausea needs an agent from a different class.',
        suggestedAction: 'Suggest adding a breakthrough antiemetic from another class, considering QT risk.',
        monitoring: 'Nausea/vomiting episodes, intake, electrolytes.',
        followUp: 'Next morning.',
        missingData: [],
        confidence: 0.72,
        status: 'possible',
      },
    ],
    medicationsReviewed: [
      { name: 'Daunorubicin', concern: 'flag', note: 'Dose mismatch.' },
      { name: 'Cytarabine', concern: 'none', note: '100 mg/m2 × 1.79 ≈ 179 mg — consistent.' },
      { name: 'Allopurinol', concern: 'review', note: 'TLS progressing.' },
      { name: 'Posaconazole', concern: 'review', note: 'QT; interactions.' },
      { name: 'Levofloxacin', concern: 'review', note: 'QT; prophylaxis vs treatment.' },
      { name: 'Ondansetron', concern: 'review', note: 'Breakthrough vomiting; QT.' },
      { name: 'Acyclovir', concern: 'review', note: 'Renally cleared — creatinine rising.' },
    ],
  },
  discussion: {
    problem: 'Febrile neutropenia without documented empiric antibiotic therapy.',
    patientEvidence: ['T 38.4 °C, rigors', 'ANC 0.2 x10^9/L', 'HR 118, BP 100/58', 'Levofloxacin prophylaxis only', 'Sulfonamide allergy', 'Creatinine 1.3 mg/dL'],
    assessment: 'This meets the usual definition of febrile neutropenia and the patient is tachycardic with borderline blood pressure. Empiric antipseudomonal therapy should not wait for culture results.',
    evidenceSummary: 'Febrile neutropenia is treated as an emergency with empiric broad-spectrum antipseudomonal beta-lactam therapy after cultures; additional cover depends on instability, suspected source and local resistance.',
    referencesToConsult: ['Local febrile neutropenia protocol', 'Local antibiogram', 'Renal dosing reference'],
    options: [
      { option: 'Antipseudomonal beta-lactam monotherapy per protocol', benefits: ['Standard empiric cover'], risks: ['Renal dose adjustment needed'] },
      { option: 'Beta-lactam plus additional gram-positive cover', benefits: ['Covers line infection/instability'], risks: ['Nephrotoxicity', 'Not always indicated'] },
      { option: 'Wait for cultures', benefits: [], risks: ['Unsafe delay'] },
    ],
    recommendationDraft: 'Suggest urgent blood cultures and immediate empiric antipseudomonal beta-lactam per local febrile neutropenia protocol, renally adjusted; stop levofloxacin prophylaxis when empiric therapy starts.',
    rationale: 'Time to first antibiotic dose is critical in febrile neutropenia; the patient shows early haemodynamic compromise.',
    monitoring: ['Temperature curve', 'BP, HR, lactate if unstable', 'Cultures', 'Creatinine'],
    followUp: 'Review cultures and response at 48–72 h.',
    questionsForStudent: ['What defines febrile neutropenia?', 'Why stop levofloxacin when empiric therapy starts?', 'How does the sulfonamide allergy affect your choice?'],
  },
  monitoring: {
    items: [
      { parameter: 'TLS panel (K, phosphate, Ca, uric acid, creatinine)', category: 'laboratory', why: 'Laboratory TLS developing.', baseline: 'K 5.2, PO4 5.6, Ca 7.6, UA 9.8, SCr 1.3', target: 'Normalising values', timing: 'Every 6–12 h', frequency: 'Until stable', actionIfAbnormal: 'Escalate TLS management.', relatedTo: 'Allopurinol / TLS' },
      { parameter: 'Temperature and haemodynamics', category: 'clinical_response', why: 'Febrile neutropenia response.', baseline: 'T 38.4, HR 118, BP 100/58', target: 'Afebrile, stable', timing: 'Hourly if unstable', frequency: 'q1–4h', actionIfAbnormal: 'Sepsis escalation; broaden therapy per protocol.', relatedTo: 'Empiric antibiotics' },
      { parameter: 'CBC (ANC, platelets, Hb)', category: 'laboratory', why: 'Myelosuppression, transfusion thresholds.', baseline: 'ANC 0.2, Plt 18, Hb 7.4', target: 'Per transfusion protocol', timing: 'Daily', frequency: 'Daily', actionIfAbnormal: 'Transfusion support per protocol.', relatedTo: 'Chemotherapy' },
      { parameter: 'ECG / QTc', category: 'safety', why: 'Posaconazole + levofloxacin + ondansetron.', baseline: 'not available', target: 'QTc within safe range', timing: 'Today, then after changes', frequency: 'As indicated', actionIfAbnormal: 'Correct electrolytes; review QT drugs.', relatedTo: 'Posaconazole' },
      { parameter: 'Nausea/vomiting and oral intake', category: 'patient_reported', why: 'Breakthrough CINV.', baseline: 'Vomited x2', target: 'No vomiting', timing: 'Each shift', frequency: 'q8h', actionIfAbnormal: 'Add/adjust antiemetic.', relatedTo: 'Ondansetron' },
    ],
  },
  followUp: {
    items: [
      { window: 'today', dueInDays: 0, problem: 'Febrile neutropenia', reassess: 'Cultures taken and empiric antibiotic given?', expected: 'First dose within protocol time', failureCriteria: 'No empiric therapy', nextAction: 'Escalate immediately' },
      { window: 'today', dueInDays: 0, problem: 'Daunorubicin dose', reassess: 'Dose verified with prescriber and protocol', expected: 'Verified dose documented', failureCriteria: 'Unresolved discrepancy', nextAction: 'Withhold dose pending verification; incident report' },
      { window: 'next_review', dueInDays: 1, problem: 'TLS', reassess: 'TLS panel, G6PD result, urine output', expected: 'Uric acid falling', failureCriteria: 'Rising K or creatinine', nextAction: 'Escalate TLS management' },
      { window: 'reassessment', dueInDays: 3, problem: 'Antimicrobial therapy', reassess: 'Cultures, fever curve, de-escalation', expected: 'Afebrile, cultures guide therapy', failureCriteria: 'Persistent fever', nextAction: 'Review per protocol (including antifungal assessment)' },
    ],
  },
  teaching: {
    questions: [
      { question: 'Which problem would you address first tonight, and why?', domain: 'problem_identification', hint: 'Which problem is time-critical?', keyPoints: ['Febrile neutropenia is a medical emergency', 'Empiric antibiotics are time-critical', 'TLS and the dose discrepancy are also urgent'] },
      { question: 'Verify the chemotherapy doses. Are they correct?', domain: 'medication_safety', hint: 'Use BSA 1.79 m2.', keyPoints: ['Cytarabine 100 mg/m2 x 1.79 = 179 mg correct', 'Daunorubicin 60 mg/m2 x 1.79 = 107 mg', '170 mg does not match', 'Verify with prescriber/protocol before next dose'] },
      { question: 'What do the day 1 and day 3 labs tell you, and what would you recommend?', domain: 'patient_assessment', hint: 'Look at the trend.', keyPoints: ['Laboratory TLS: uric acid, K, phosphate up; calcium down', 'Creatinine rising', 'Rasburicase consideration after G6PD', 'Hydration and monitoring'] },
    ],
  },
  roundNoteText:
    'Day 4 haematology round. Spiked again overnight, cultures taken, started piperacillin-tazobactam at 23:30. Levofloxacin stopped. Daunorubicin dose clarified with consultant: 60 per metre squared, corrected to 107 mg. G6PD normal, rasburicase given. ECG QTc 468.',
  roundNote: {
    summary: 'Day 4: empiric therapy started; dose discrepancy corrected; rasburicase given.',
    changes: ['Fever overnight', 'Cultures taken', 'QTc 468 ms'],
    medicationChanges: [
      { medication: 'Piperacillin-tazobactam', change: 'Started 23:30' },
      { medication: 'Levofloxacin', change: 'Stopped' },
      { medication: 'Daunorubicin', change: 'Dose corrected to 107 mg (60 mg/m2)' },
      { medication: 'Rasburicase', change: 'Given (G6PD normal)' },
    ],
    decisions: ['Continue TLS monitoring'],
    possibleNewDrps: ['Check piperacillin-tazobactam dose for current renal function'],
    followUpsRequired: ['Culture results', 'TLS panel after rasburicase'],
    tasks: ['Renal dose check for piperacillin-tazobactam', 'Document dose-discrepancy intervention'],
  },
};

export const DEMO_CASES: DemoCase[] = [IM, CARDIO, ONC];

export function findDemoCase(key: string | undefined): DemoCase | undefined {
  return DEMO_CASES.find((c) => c.key === key);
}

export function findDemoDoc(caseKey: string | undefined, docKey: string | undefined): DemoDoc | undefined {
  return findDemoCase(caseKey)?.docs.find((d) => d.key === docKey);
}
