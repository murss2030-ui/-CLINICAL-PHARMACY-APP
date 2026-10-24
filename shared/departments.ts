// Department adaptation. The clinical reasoning engine is identical for every
// department; only the prompts, checks and learning priorities change.

export const DEPARTMENT_IDS = [
  'internal_medicine',
  'cardiology',
  'icu',
  'ccu',
  'emergency',
  'surgery',
  'pediatrics',
  'neonatal',
  'oncology',
  'hematology',
  'infectious_disease',
  'nephrology',
  'neurology',
  'psychiatry',
  'gastroenterology',
  'hepatology',
  'endocrinology',
  'pulmonology',
  'rheumatology',
  'obgyn',
  'outpatient',
  'transitions_of_care',
] as const;
export type DepartmentId = (typeof DEPARTMENT_IDS)[number];

/** Keys of the data-check catalogue (client/src/lib/datacheck.ts). */
export type DataKey =
  | 'age'
  | 'sex'
  | 'weight'
  | 'height'
  | 'allergies'
  | 'medications'
  | 'scr'
  | 'potassium'
  | 'sodium'
  | 'magnesium'
  | 'cbc'
  | 'anc'
  | 'platelets'
  | 'inr'
  | 'lfts'
  | 'albumin'
  | 'uric_acid'
  | 'glucose'
  | 'vitals'
  | 'temperature'
  | 'cultures'
  | 'ecg'
  | 'lactate'
  | 'bilirubin'
  | 'urine_output';

export interface DepartmentProfile {
  id: DepartmentId;
  label: string;
  focus: string[];
  monitoringPriorities: string[];
  medicationClasses: string[];
  drpPrompts: string[];
  learningTopics: string[];
  requiredData: DataKey[];
}

const BASE_REQUIRED: DataKey[] = ['age', 'sex', 'weight', 'allergies', 'medications', 'scr', 'vitals'];

export const DEPARTMENTS: Record<DepartmentId, DepartmentProfile> = {
  internal_medicine: {
    id: 'internal_medicine',
    label: 'Internal Medicine',
    focus: ['Polypharmacy', 'Renal dosing', 'VTE prophylaxis', 'Glycaemic control', 'Infection', 'Electrolytes'],
    monitoringPriorities: ['Renal function', 'Electrolytes', 'Blood glucose', 'Blood pressure', 'Signs of infection'],
    medicationClasses: ['Anticoagulants', 'Antimicrobials', 'Insulin and oral hypoglycaemics', 'Antihypertensives', 'Analgesics'],
    drpPrompts: [
      'Is every medication indicated for an active problem?',
      'Is there an untreated indication (e.g. VTE prophylaxis, stress ulcer prophylaxis only if indicated)?',
      'Does renal function require a dose review?',
    ],
    learningTopics: ['Medication reconciliation', 'Renal dose adjustment', 'Diabetes in hospital', 'Community-acquired pneumonia', 'AKI and nephrotoxins'],
    requiredData: [...BASE_REQUIRED, 'potassium', 'sodium', 'glucose', 'cbc'],
  },
  cardiology: {
    id: 'cardiology',
    label: 'Cardiology',
    focus: ['Heart failure (GDMT)', 'ACS', 'Arrhythmias', 'Anticoagulation', 'Antiplatelets', 'Blood pressure'],
    monitoringPriorities: ['Potassium', 'Magnesium', 'Renal function', 'Heart rate', 'Blood pressure', 'QTc', 'Bleeding signs', 'Weight / fluid status'],
    medicationClasses: ['Beta-blockers', 'ACEi / ARB / ARNI', 'MRAs', 'SGLT2 inhibitors', 'Loop diuretics', 'Antiplatelets', 'Anticoagulants', 'Antiarrhythmics', 'Statins'],
    drpPrompts: [
      'Is guideline-directed medical therapy complete and appropriately titrated?',
      'Does the anticoagulant / antiplatelet combination match the bleeding and thrombotic risk?',
      'Are potassium, renal function and QTc compatible with the current regimen?',
    ],
    learningTopics: ['Heart failure GDMT', 'Anticoagulation in AF', 'Dual antiplatelet therapy', 'QT prolongation', 'Digoxin safety'],
    requiredData: [...BASE_REQUIRED, 'potassium', 'magnesium', 'ecg', 'inr'],
  },
  icu: {
    id: 'icu',
    label: 'Intensive Care (ICU)',
    focus: ['Hemodynamics', 'Sedation and analgesia', 'Vasopressors', 'Antimicrobials', 'TDM', 'Renal dosing / RRT'],
    monitoringPriorities: ['MAP / vasopressor dose', 'Lactate', 'Renal function and urine output', 'Drug levels (TDM)', 'Sedation scores', 'Electrolytes'],
    medicationClasses: ['Vasopressors', 'Sedatives', 'Opioids', 'Broad-spectrum antimicrobials', 'Stress ulcer prophylaxis', 'Insulin infusions'],
    drpPrompts: [
      'Do antimicrobial doses account for augmented or reduced clearance?',
      'Is stress-ulcer and VTE prophylaxis indicated and present?',
      'Are sedation and analgesia goals defined?',
    ],
    learningTopics: ['Septic shock pharmacotherapy', 'Vancomycin TDM', 'Sedation / analgesia', 'Dosing in renal replacement therapy'],
    requiredData: [...BASE_REQUIRED, 'potassium', 'lactate', 'cultures', 'urine_output', 'cbc'],
  },
  ccu: {
    id: 'ccu',
    label: 'Coronary Care (CCU)',
    focus: ['ACS', 'Cardiogenic shock', 'Arrhythmias', 'Anticoagulation'],
    monitoringPriorities: ['ECG / rhythm', 'Potassium and magnesium', 'Bleeding', 'Renal function', 'Blood pressure'],
    medicationClasses: ['Antiplatelets', 'Anticoagulants', 'Inotropes', 'Antiarrhythmics', 'Nitrates', 'Beta-blockers'],
    drpPrompts: ['Is antithrombotic therapy appropriate to bleeding risk and renal function?', 'Are electrolytes optimised for arrhythmia risk?'],
    learningTopics: ['ACS pharmacotherapy', 'Antithrombotic combinations', 'Amiodarone safety'],
    requiredData: [...BASE_REQUIRED, 'potassium', 'magnesium', 'ecg', 'cbc'],
  },
  emergency: {
    id: 'emergency',
    label: 'Emergency',
    focus: ['Acute stabilisation', 'Medication history', 'Toxicology', 'Time-critical therapy'],
    monitoringPriorities: ['Vital signs', 'Glucose', 'Electrolytes', 'Response to acute therapy'],
    medicationClasses: ['Analgesics', 'Antidotes', 'Antimicrobials', 'Anticoagulant reversal'],
    drpPrompts: ['Was the home medication history obtained?', 'Is any time-critical medication missed or delayed?'],
    learningTopics: ['Best possible medication history', 'Anticoagulant reversal', 'Acute pain management'],
    requiredData: [...BASE_REQUIRED, 'glucose', 'potassium'],
  },
  surgery: {
    id: 'surgery',
    label: 'Surgery',
    focus: ['Perioperative medication management', 'Surgical prophylaxis', 'VTE prophylaxis', 'Analgesia', 'PONV'],
    monitoringPriorities: ['Pain scores', 'Bleeding', 'Renal function', 'Bowel function', 'Wound / infection signs'],
    medicationClasses: ['Anticoagulants', 'Opioids', 'Antiemetics', 'Prophylactic antibiotics'],
    drpPrompts: ['Were chronic medications held or resumed appropriately?', 'Is surgical prophylaxis duration appropriate?'],
    learningTopics: ['Perioperative anticoagulation', 'Multimodal analgesia', 'Surgical antibiotic prophylaxis'],
    requiredData: [...BASE_REQUIRED, 'cbc', 'inr'],
  },
  pediatrics: {
    id: 'pediatrics',
    label: 'Pediatrics',
    focus: ['Weight-based dosing', 'Formulations', 'Fluid and electrolytes', 'Infection'],
    monitoringPriorities: ['Weight', 'Hydration / urine output', 'Electrolytes', 'Temperature', 'Response to therapy'],
    medicationClasses: ['Antimicrobials', 'Antipyretics', 'Bronchodilators', 'Anticonvulsants'],
    drpPrompts: ['Is every dose calculated on a current, documented weight?', 'Is the formulation appropriate for age?'],
    learningTopics: ['Weight-based dosing', 'Paediatric fluid therapy', 'Paediatric antimicrobials'],
    requiredData: ['age', 'sex', 'weight', 'height', 'allergies', 'medications', 'scr', 'vitals'],
  },
  neonatal: {
    id: 'neonatal',
    label: 'Neonatal',
    focus: ['Gestational / postnatal age dosing', 'Weight-based dosing', 'Nutrition (PN)', 'Infection'],
    monitoringPriorities: ['Weight', 'Drug levels', 'Bilirubin', 'Glucose', 'Electrolytes'],
    medicationClasses: ['Aminoglycosides', 'Caffeine', 'Antimicrobials', 'Parenteral nutrition'],
    drpPrompts: ['Does dosing reflect gestational and postnatal age?', 'Are levels needed for narrow-therapeutic-index drugs?'],
    learningTopics: ['Neonatal pharmacokinetics', 'Gentamicin dosing and levels'],
    requiredData: ['age', 'weight', 'allergies', 'medications', 'scr', 'vitals', 'glucose', 'bilirubin'],
  },
  oncology: {
    id: 'oncology',
    label: 'Oncology',
    focus: ['Antineoplastic safety', 'Supportive care', 'Antiemetics', 'Febrile neutropenia', 'Tumour lysis syndrome', 'Renal / hepatic dose adjustment'],
    monitoringPriorities: ['CBC with ANC', 'Platelets', 'Renal function', 'LFTs', 'Uric acid / potassium / phosphate (TLS)', 'Temperature', 'Nausea / vomiting'],
    medicationClasses: ['Chemotherapy', 'Antiemetics', 'Growth factors', 'Antimicrobial prophylaxis', 'Allopurinol / rasburicase', 'Opioids'],
    drpPrompts: [
      'Is the chemotherapy dose verified against BSA, protocol and organ function?',
      'Is antiemetic prophylaxis matched to emetogenic risk?',
      'Are TLS prophylaxis and antimicrobial prophylaxis indicated?',
    ],
    learningTopics: [
      'Chemotherapy safety and verification',
      'Supportive care',
      'Antiemetic prophylaxis',
      'Febrile neutropenia',
      'Tumour lysis syndrome',
      'Antimicrobial prophylaxis',
      'Anaemia, thrombocytopenia and neutropenia',
      'Drug interactions with antineoplastics',
      'Renal / hepatic dose adjustment',
      'Patient counselling on chemotherapy',
    ],
    requiredData: [...BASE_REQUIRED, 'height', 'cbc', 'anc', 'platelets', 'lfts', 'uric_acid', 'potassium', 'temperature'],
  },
  hematology: {
    id: 'hematology',
    label: 'Hematology / Leukemia',
    focus: ['Leukemia induction / consolidation', 'Febrile neutropenia', 'Tumour lysis syndrome', 'Transfusion support', 'Antimicrobial prophylaxis', 'Drug interactions (azoles)'],
    monitoringPriorities: ['CBC with ANC', 'Platelets and haemoglobin', 'TLS labs (K, phosphate, uric acid, SCr)', 'LFTs', 'Temperature', 'Drug levels (e.g. azoles)'],
    medicationClasses: ['Chemotherapy', 'Azole antifungals', 'Antivirals', 'Antiemetics', 'Allopurinol / rasburicase', 'G-CSF'],
    drpPrompts: [
      'Are azole interactions with chemotherapy checked?',
      'Is febrile neutropenia managed promptly with appropriate empiric therapy?',
      'Is TLS prophylaxis matched to risk?',
    ],
    learningTopics: ['Chemotherapy', 'Supportive care', 'Antiemetics', 'Febrile neutropenia', 'Tumour lysis syndrome', 'Antimicrobial prophylaxis', 'Anaemia', 'Thrombocytopenia', 'Neutropenia', 'Interactions', 'Renal / hepatic dosing', 'Chemotherapy safety', 'Counselling'],
    requiredData: [...BASE_REQUIRED, 'height', 'cbc', 'anc', 'platelets', 'lfts', 'uric_acid', 'potassium', 'temperature'],
  },
  infectious_disease: {
    id: 'infectious_disease',
    label: 'Infectious Diseases',
    focus: ['Antimicrobial selection', 'Indication and spectrum', 'Cultures', 'Dose and renal adjustment', 'De-escalation', 'Duration', 'IV-to-oral conversion', 'Stewardship'],
    monitoringPriorities: ['Temperature', 'WBC / CRP / procalcitonin trend', 'Cultures and susceptibilities', 'Renal function', 'Drug levels', 'Adverse effects'],
    medicationClasses: ['Beta-lactams', 'Glycopeptides', 'Aminoglycosides', 'Fluoroquinolones', 'Antifungals', 'Antivirals'],
    drpPrompts: [
      'Is there a documented indication and planned duration?',
      'Can therapy be de-escalated based on cultures?',
      'Is the patient eligible for IV-to-oral conversion?',
    ],
    learningTopics: ['Antimicrobial stewardship', 'Vancomycin TDM', 'IV-to-oral switch', 'Interpreting susceptibility reports'],
    requiredData: [...BASE_REQUIRED, 'temperature', 'cultures', 'cbc'],
  },
  nephrology: {
    id: 'nephrology',
    label: 'Nephrology',
    focus: ['Renal dose adjustment', 'Electrolytes', 'Nephrotoxins', 'Dialysis dosing', 'CKD complications'],
    monitoringPriorities: ['SCr trend', 'Potassium', 'Phosphate / calcium', 'Fluid balance / weight', 'Haemoglobin'],
    medicationClasses: ['Diuretics', 'Phosphate binders', 'ESAs', 'Potassium binders', 'Antihypertensives'],
    drpPrompts: ['Which medications are renally cleared or nephrotoxic?', 'Is dosing appropriate for the dialysis modality?'],
    learningTopics: ['Estimating renal function', 'Dosing in AKI vs CKD', 'Hyperkalaemia management'],
    requiredData: [...BASE_REQUIRED, 'potassium', 'sodium', 'urine_output', 'cbc'],
  },
  neurology: {
    id: 'neurology',
    label: 'Neurology',
    focus: ['Antiepileptics', 'Stroke prevention', 'Drug interactions', 'TDM'],
    monitoringPriorities: ['Seizure frequency', 'Drug levels', 'Sodium', 'LFTs', 'Neurological status'],
    medicationClasses: ['Antiepileptics', 'Antithrombotics', 'Statins'],
    drpPrompts: ['Are antiepileptic levels and interactions reviewed?', 'Is secondary stroke prevention complete?'],
    learningTopics: ['Antiepileptic TDM', 'Secondary stroke prevention'],
    requiredData: [...BASE_REQUIRED, 'sodium', 'lfts'],
  },
  psychiatry: {
    id: 'psychiatry',
    label: 'Psychiatry',
    focus: ['Antipsychotic safety', 'Metabolic monitoring', 'Lithium TDM', 'QT prolongation', 'Serotonin syndrome'],
    monitoringPriorities: ['Weight / BMI', 'Glucose and lipids', 'ECG / QTc', 'Drug levels (lithium, clozapine)', 'Sodium'],
    medicationClasses: ['Antipsychotics', 'Antidepressants', 'Mood stabilisers', 'Benzodiazepines'],
    drpPrompts: ['Is metabolic and QTc monitoring in place?', 'Are serotonergic combinations assessed?'],
    learningTopics: ['Lithium monitoring', 'Clozapine monitoring', 'Antipsychotic metabolic effects'],
    requiredData: [...BASE_REQUIRED, 'sodium', 'ecg', 'glucose'],
  },
  gastroenterology: {
    id: 'gastroenterology',
    label: 'Gastroenterology',
    focus: ['GI bleeding', 'IBD therapy', 'Acid suppression stewardship', 'Nutrition'],
    monitoringPriorities: ['Haemoglobin', 'LFTs', 'Electrolytes', 'Stool output'],
    medicationClasses: ['PPIs', 'Immunomodulators', 'Biologics', 'Laxatives', 'Antiemetics'],
    drpPrompts: ['Is acid suppression indicated and of defined duration?', 'Are bleeding-risk medications reviewed?'],
    learningTopics: ['Upper GI bleed pharmacotherapy', 'PPI deprescribing'],
    requiredData: [...BASE_REQUIRED, 'cbc', 'lfts'],
  },
  hepatology: {
    id: 'hepatology',
    label: 'Hepatology',
    focus: ['Hepatic dose adjustment', 'Cirrhosis complications', 'Hepatic encephalopathy', 'Ascites', 'Variceal bleeding'],
    monitoringPriorities: ['Bilirubin / INR / albumin', 'Sodium', 'Renal function', 'Mental status', 'Bleeding'],
    medicationClasses: ['Lactulose / rifaximin', 'Diuretics', 'Non-selective beta-blockers', 'Antimicrobials (SBP)'],
    drpPrompts: ['Which medications need hepatic dose review (Child-Pugh)?', 'Are hepatotoxic or sedating drugs avoided?'],
    learningTopics: ['Child-Pugh and drug dosing', 'Hepatic encephalopathy', 'Diuretics in ascites'],
    requiredData: [...BASE_REQUIRED, 'lfts', 'bilirubin', 'albumin', 'inr', 'sodium'],
  },
  endocrinology: {
    id: 'endocrinology',
    label: 'Endocrinology',
    focus: ['Diabetes', 'Insulin regimens', 'Thyroid disorders', 'Adrenal insufficiency'],
    monitoringPriorities: ['Blood glucose', 'HbA1c', 'Potassium', 'Renal function'],
    medicationClasses: ['Insulins', 'Oral hypoglycaemics', 'GLP-1 RAs', 'SGLT2 inhibitors', 'Thyroid agents', 'Corticosteroids'],
    drpPrompts: ['Is hypoglycaemia risk addressed?', 'Is insulin adjusted for intake and renal function?'],
    learningTopics: ['Inpatient insulin', 'DKA management', 'Sick-day rules'],
    requiredData: [...BASE_REQUIRED, 'glucose', 'potassium'],
  },
  pulmonology: {
    id: 'pulmonology',
    label: 'Pulmonology',
    focus: ['COPD / asthma', 'Inhaler technique', 'Pneumonia', 'Corticosteroids'],
    monitoringPriorities: ['SpO2', 'Respiratory rate', 'Glucose (steroids)', 'Inhaler technique'],
    medicationClasses: ['Bronchodilators', 'Inhaled corticosteroids', 'Systemic corticosteroids', 'Antimicrobials'],
    drpPrompts: ['Is inhaler technique and adherence checked?', 'Is the steroid course duration defined?'],
    learningTopics: ['COPD exacerbation', 'Inhaler counselling'],
    requiredData: [...BASE_REQUIRED, 'glucose'],
  },
  rheumatology: {
    id: 'rheumatology',
    label: 'Rheumatology',
    focus: ['DMARDs', 'Biologics', 'Corticosteroids', 'Infection risk', 'Bone health'],
    monitoringPriorities: ['CBC', 'LFTs', 'Renal function', 'Infection signs'],
    medicationClasses: ['Methotrexate', 'Biologics', 'Corticosteroids', 'NSAIDs'],
    drpPrompts: ['Is DMARD monitoring up to date?', 'Is folic acid / bone protection addressed?'],
    learningTopics: ['Methotrexate safety', 'Steroid-induced osteoporosis'],
    requiredData: [...BASE_REQUIRED, 'cbc', 'lfts'],
  },
  obgyn: {
    id: 'obgyn',
    label: 'Obstetrics & Gynecology',
    focus: ['Medication safety in pregnancy and lactation', 'Hypertension in pregnancy', 'VTE prophylaxis', 'Infection'],
    monitoringPriorities: ['Blood pressure', 'Foetal considerations', 'Bleeding', 'Renal function'],
    medicationClasses: ['Antihypertensives', 'Uterotonics', 'Anticoagulants', 'Antimicrobials'],
    drpPrompts: ['Is every medication appropriate in pregnancy / lactation?', 'Is VTE risk assessed?'],
    learningTopics: ['Drugs in pregnancy', 'Pre-eclampsia pharmacotherapy'],
    requiredData: [...BASE_REQUIRED, 'cbc'],
  },
  outpatient: {
    id: 'outpatient',
    label: 'Outpatient / Ambulatory',
    focus: ['Adherence', 'Chronic disease management', 'Deprescribing', 'Access and cost'],
    monitoringPriorities: ['Blood pressure', 'HbA1c / glucose', 'Lipids', 'Renal function', 'Adherence'],
    medicationClasses: ['Antihypertensives', 'Antidiabetics', 'Statins', 'Inhalers'],
    drpPrompts: ['Is the patient taking medications as intended?', 'Are any medications candidates for deprescribing?'],
    learningTopics: ['Adherence assessment', 'Deprescribing'],
    requiredData: ['age', 'sex', 'weight', 'allergies', 'medications', 'vitals'],
  },
  transitions_of_care: {
    id: 'transitions_of_care',
    label: 'Discharge / Transitions of Care',
    focus: ['Discharge reconciliation', 'Counselling', 'Follow-up plans', 'Access to medications'],
    monitoringPriorities: ['Post-discharge labs', 'Adherence', 'Adverse effects'],
    medicationClasses: ['All discharge medications'],
    drpPrompts: ['Do discharge medications match the intended plan?', 'Were changes communicated to the patient and community providers?'],
    learningTopics: ['Discharge reconciliation', 'Discharge counselling'],
    requiredData: ['age', 'sex', 'allergies', 'medications', 'scr'],
  },
};

export const DEPARTMENT_LIST = DEPARTMENT_IDS.map((id) => DEPARTMENTS[id]);

export function departmentLabel(id: string | undefined): string {
  return (id && (DEPARTMENTS as Record<string, DepartmentProfile>)[id]?.label) || 'General';
}
