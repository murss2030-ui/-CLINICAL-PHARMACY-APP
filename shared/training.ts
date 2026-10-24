// Built-in synthetic training bank and an offline answer checker.
// All scenarios are fictional. Key points describe mainstream practice and
// must still be checked against current references and local protocols.
import type { DepartmentId } from './departments';
import type { CompetencyDomain, TrainingLevel } from './domain';

export interface TrainingQuestion {
  question: string;
  domain: CompetencyDomain;
  keyPoints: string[];
}

export interface TrainingExercise {
  id: string;
  level: TrainingLevel;
  department: DepartmentId;
  title: string;
  kind: 'mini_case' | 'drp_exercise' | 'medication_review' | 'reasoning_challenge' | 'communication';
  scenario: string;
  questions: TrainingQuestion[];
}

export const TRAINING_BANK: TrainingExercise[] = [
  {
    id: 'f1-bpmh-fall',
    level: 'foundations',
    department: 'internal_medicine',
    title: 'Medication history after a fall',
    kind: 'mini_case',
    scenario:
      'Fictional patient: 68-year-old man admitted after a fall at night. He brings a bag of medicines: amlodipine 5 mg daily, atorvastatin 40 mg at night, omeprazole 20 mg daily, zopiclone 7.5 mg at night (from a neighbour), and an over-the-counter "sleep aid" containing diphenhydramine. BP lying 128/76, standing 104/66 mmHg.',
    questions: [
      {
        question: 'Which sources would you use to complete a best possible medication history?',
        domain: 'medication_history',
        keyPoints: ['Interview the patient or caregiver', 'Community pharmacy dispensing records', 'Primary care or clinic medication list', 'Inspect medication containers', 'Include OTC, herbal and borrowed medicines', 'Confirm dose, frequency and actual adherence'],
      },
      {
        question: 'Which medicines may have contributed to the fall, and why?',
        domain: 'adr_assessment',
        keyPoints: ['Zopiclone: sedative hypnotic, falls risk', 'Diphenhydramine: anticholinergic and sedating in older adults', 'Amlodipine with orthostatic hypotension', 'Borrowed medicine is a safety concern'],
      },
    ],
  },
  {
    id: 'f2-dm-albuminuria',
    level: 'foundations',
    department: 'outpatient',
    title: 'Untreated indication in diabetes',
    kind: 'drp_exercise',
    scenario:
      'Fictional patient: 55-year-old woman with type 2 diabetes on metformin 500 mg twice daily. Clinic BP readings 152/94 and 148/92 mmHg on two visits. Urine albumin-to-creatinine ratio is raised on two samples. Creatinine 0.9 mg/dL, potassium 4.4 mmol/L. No antihypertensive therapy.',
    questions: [
      {
        question: 'Identify the drug-related problem, classify it, and state the supporting evidence.',
        domain: 'drp_identification',
        keyPoints: ['Needs additional drug therapy', 'Hypertension above target on repeated readings', 'Albuminuria in diabetes', 'ACE inhibitor or ARB is indicated'],
      },
      {
        question: 'What would you monitor after starting the new therapy?',
        domain: 'monitoring',
        keyPoints: ['Potassium', 'Serum creatinine within 1–2 weeks', 'Blood pressure', 'Albuminuria over time', 'Cough or angioedema with ACE inhibitor'],
      },
    ],
  },
  {
    id: 'd1-renal-dosing',
    level: 'developing',
    department: 'internal_medicine',
    title: 'Renal dose review',
    kind: 'medication_review',
    scenario:
      'Fictional patient: 82-year-old woman, weight 50 kg, serum creatinine 1.6 mg/dL (stable). Medications: enoxaparin 1 mg/kg SC every 12 hours for DVT, gabapentin 600 mg three times daily, nitrofurantoin 100 mg twice daily for cystitis.',
    questions: [
      {
        question: 'Estimate her creatinine clearance and show your calculation.',
        domain: 'renal_dosing',
        keyPoints: ['Cockcroft-Gault formula', 'Female factor 0.85', 'CrCl approximately 21 mL/min', 'State the weight used and its limitations'],
      },
      {
        question: 'Which medications need review and what would you recommend?',
        domain: 'renal_dosing',
        keyPoints: ['Enoxaparin treatment dose usually changed to once daily when CrCl below 30', 'Gabapentin dose reduction for renal function', 'Nitrofurantoin generally avoided at low CrCl', 'Verify each in a renal dosing reference'],
      },
    ],
  },
  {
    id: 'd2-statin-macrolide',
    level: 'developing',
    department: 'internal_medicine',
    title: 'Interaction with a new antibiotic',
    kind: 'drp_exercise',
    scenario:
      'Fictional patient: 60-year-old man on simvastatin 40 mg at night started clarithromycin 500 mg twice daily for pneumonia. On day 3 he reports diffuse muscle aches and dark urine.',
    questions: [
      {
        question: 'What is the medication-related problem and its mechanism?',
        domain: 'interaction_assessment',
        keyPoints: ['Clarithromycin strongly inhibits CYP3A4', 'Increased simvastatin exposure', 'Myopathy or rhabdomyolysis risk', 'Dark urine suggests myoglobinuria'],
      },
      {
        question: 'What would you recommend and monitor?',
        domain: 'intervention',
        keyPoints: ['Stop or hold simvastatin', 'Check CK and renal function', 'Consider a non-interacting antibiotic', 'Hydration and urine output', 'Counsel to report muscle symptoms'],
      },
    ],
  },
  {
    id: 'i1-gi-bleed',
    level: 'intermediate',
    department: 'gastroenterology',
    title: 'Prioritising problems in a GI bleed',
    kind: 'reasoning_challenge',
    scenario:
      'Fictional patient: 70-year-old man with atrial fibrillation on apixaban 5 mg twice daily, aspirin 81 mg daily (no documented coronary disease) and naproxen 500 mg twice daily for back pain. Presents with melaena; Hb 7.8 g/dL (baseline 12.1), HR 112, BP 96/60.',
    questions: [
      {
        question: 'List and prioritise his problems. Which comes first and why?',
        domain: 'clinical_reasoning',
        keyPoints: ['Active GI bleeding with haemodynamic compromise first', 'Anticoagulation management second', 'Aspirin without indication', 'NSAID use'],
      },
      {
        question: 'What DRPs do you identify?',
        domain: 'drp_identification',
        keyPoints: ['Unnecessary therapy: aspirin without indication', 'Adverse drug reaction: NSAID-associated GI bleeding', 'Combination of anticoagulant, antiplatelet and NSAID increases bleeding', 'Plan for anticoagulation restart decision'],
      },
    ],
  },
  {
    id: 'i2-vancomycin',
    level: 'intermediate',
    department: 'infectious_disease',
    title: 'Vancomycin monitoring',
    kind: 'mini_case',
    scenario:
      'Fictional patient: 45-year-old man, 80 kg, MRSA bacteraemia on vancomycin 1 g IV every 12 hours for 3 days. Creatinine 0.9 → 1.5 mg/dL. No vancomycin level has been taken. Also receiving IV contrast today and piperacillin-tazobactam.',
    questions: [
      {
        question: 'Build a monitoring plan for this patient.',
        domain: 'monitoring',
        keyPoints: ['Vancomycin levels or AUC-guided monitoring per protocol', 'Daily serum creatinine', 'Avoid or minimise concomitant nephrotoxins', 'Repeat blood cultures to confirm clearance', 'Plan treatment duration'],
      },
    ],
  },
  {
    id: 'a1-communication',
    level: 'advanced',
    department: 'cardiology',
    title: 'Communicating a recommendation',
    kind: 'communication',
    scenario:
      'Fictional patient: 77-year-old woman on digoxin 0.125 mg daily and furosemide 80 mg twice daily. Potassium 3.1 mmol/L, magnesium 1.5 mg/dL. Complains of nausea.',
    questions: [
      {
        question: 'Write a concise recommendation to the physician (problem, evidence, assessment, recommendation, rationale).',
        domain: 'communication',
        keyPoints: ['Hypokalaemia and hypomagnesaemia increase digoxin toxicity risk', 'Cite potassium and magnesium values and nausea', 'Recommend electrolyte replacement per protocol', 'Check digoxin level and ECG', 'Review diuretic dose', 'Respectful, concise wording'],
      },
    ],
  },
  {
    id: 'a2-warfarin-counselling',
    level: 'advanced',
    department: 'transitions_of_care',
    title: 'Discharge counselling on warfarin',
    kind: 'communication',
    scenario: 'Fictional patient: 64-year-old man starting warfarin for atrial fibrillation, discharged home tomorrow. First INR clinic appointment in 4 days.',
    questions: [
      {
        question: 'What are the essential counselling points?',
        domain: 'patient_counseling',
        keyPoints: ['Take at the same time daily; what to do with a missed dose', 'INR monitoring schedule', 'Signs of bleeding and when to seek help', 'Interacting medicines including NSAIDs, antibiotics and herbal products', 'Consistent vitamin K intake', 'Inform all healthcare providers; carry an alert card'],
      },
    ],
  },
  {
    id: 'c1-septic-shock',
    level: 'complex',
    department: 'icu',
    title: 'Septic shock polypharmacy',
    kind: 'reasoning_challenge',
    scenario:
      'Fictional patient: 58-year-old man, 90 kg, septic shock from pneumonia on norepinephrine. Meropenem 1 g IV every 8 hours, vancomycin, propofol and fentanyl infusions. Started continuous renal replacement therapy today. No stress-ulcer or VTE prophylaxis ordered.',
    questions: [
      {
        question: 'Which pharmacotherapy issues would you review today, in priority order?',
        domain: 'clinical_reasoning',
        keyPoints: ['Antimicrobial dosing during CRRT and critical illness', 'Therapeutic drug monitoring for vancomycin', 'Stress ulcer prophylaxis indication (shock, ventilation)', 'VTE prophylaxis', 'Sedation and analgesia goals', 'De-escalation plan when cultures return'],
      },
    ],
  },
  {
    id: 'c2-aml-supportive',
    level: 'complex',
    department: 'hematology',
    title: 'Leukaemia induction supportive care',
    kind: 'mini_case',
    scenario:
      'Fictional patient: 52-year-old man on AML induction day 4. Temperature 38.6 °C, ANC 0.1 x10^9/L, uric acid 10.2 mg/dL (rising), potassium 5.4 mmol/L, creatinine 1.4 mg/dL (baseline 0.9). On allopurinol, posaconazole, levofloxacin prophylaxis and ondansetron.',
    questions: [
      {
        question: 'Identify and prioritise the problems and medication-related problems.',
        domain: 'drp_identification',
        keyPoints: ['Febrile neutropenia needs urgent empiric antipseudomonal therapy', 'Laboratory tumour lysis syndrome with AKI', 'Rasburicase consideration after G6PD check', 'QT risk from posaconazole, levofloxacin and ondansetron', 'Renal dose review of renally cleared drugs'],
      },
    ],
  },
];

const STOPWORDS = new Set(
  'with from that this have will would should could into than then them they their there what which when where while about after before above below more most less such only also each other some very over under within without between dose doses patient usually generally'.split(' '),
);

function significantWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9.؀-ۿ ]/g, ' ')
    .split(/\s+/)
    .filter((w) => (w.length >= 4 || /\d/.test(w)) && !STOPWORDS.has(w));
}

/**
 * Offline self-check: which key points does the answer appear to cover?
 * This is keyword matching, not clinical evaluation, and is labelled as such.
 */
export function keywordEvaluate(answer: string, keyPoints: string[]): { covered: string[]; missed: string[] } {
  const words = new Set(significantWords(answer));
  const stems = [...words].map((w) => w.slice(0, 6));
  const covered: string[] = [];
  const missed: string[] = [];
  for (const kp of keyPoints) {
    const kw = significantWords(kp);
    if (kw.length === 0) continue;
    const hits = kw.filter((w) => words.has(w) || stems.includes(w.slice(0, 6))).length;
    (hits >= Math.max(1, Math.ceil(kw.length * 0.4)) ? covered : missed).push(kp);
  }
  return { covered, missed };
}
