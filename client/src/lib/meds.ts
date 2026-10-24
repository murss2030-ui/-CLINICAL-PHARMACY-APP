// Medication name normalisation and a small curated class map used by the
// rule-based safety screen, reconciliation and duplicate detection.
// The lists are intentionally conservative and educational; they are not a
// substitute for a drug interaction or dosing reference.

export const DRUG_CLASSES = {
  penicillin: ['penicillin', 'amoxicillin', 'ampicillin', 'piperacillin', 'flucloxacillin', 'dicloxacillin', 'cloxacillin', 'nafcillin', 'oxacillin', 'benzylpenicillin', 'phenoxymethylpenicillin', 'co-amoxiclav', 'augmentin', 'tazocin'],
  cephalosporin: ['cefalexin', 'cephalexin', 'cefazolin', 'cefuroxime', 'ceftriaxone', 'cefotaxime', 'ceftazidime', 'cefepime', 'cefixime', 'cefpodoxime', 'ceftaroline', 'cefoxitin', 'cefiderocol', 'cefadroxil'],
  carbapenem: ['meropenem', 'imipenem', 'ertapenem', 'doripenem'],
  sulfonamide_antibiotic: ['sulfamethoxazole', 'co-trimoxazole', 'cotrimoxazole', 'trimethoprim-sulfamethoxazole', 'bactrim', 'septrin', 'septra', 'sulfadiazine'],
  nsaid: ['ibuprofen', 'naproxen', 'diclofenac', 'ketorolac', 'indomethacin', 'celecoxib', 'meloxicam', 'etoricoxib', 'ketoprofen', 'piroxicam', 'mefenamic'],
  anticoagulant: ['warfarin', 'heparin', 'enoxaparin', 'dalteparin', 'tinzaparin', 'fondaparinux', 'apixaban', 'rivaroxaban', 'dabigatran', 'edoxaban', 'argatroban', 'bivalirudin'],
  antiplatelet: ['aspirin', 'clopidogrel', 'ticagrelor', 'prasugrel', 'dipyridamole'],
  ppi: ['omeprazole', 'esomeprazole', 'pantoprazole', 'lansoprazole', 'rabeprazole'],
  acei: ['lisinopril', 'enalapril', 'ramipril', 'captopril', 'perindopril', 'fosinopril', 'quinapril'],
  arb: ['losartan', 'valsartan', 'candesartan', 'irbesartan', 'telmisartan', 'olmesartan', 'sacubitril'],
  k_sparing: ['spironolactone', 'eplerenone', 'amiloride', 'triamterene', 'finerenone'],
  k_supplement: ['potassium chloride', 'potassium citrate', 'kcl', 'slow-k', 'potassium'],
  loop_diuretic: ['furosemide', 'bumetanide', 'torsemide', 'torasemide'],
  statin: ['simvastatin', 'atorvastatin', 'rosuvastatin', 'pravastatin', 'lovastatin', 'fluvastatin', 'pitavastatin'],
  cyp3a4_statin: ['simvastatin', 'lovastatin', 'atorvastatin'],
  strong_cyp3a4_inhibitor: ['clarithromycin', 'erythromycin', 'itraconazole', 'ketoconazole', 'posaconazole', 'voriconazole', 'ritonavir', 'cobicistat'],
  beta_blocker: ['metoprolol', 'bisoprolol', 'carvedilol', 'atenolol', 'propranolol', 'nebivolol', 'labetalol', 'sotalol'],
  benzodiazepine: ['diazepam', 'lorazepam', 'midazolam', 'alprazolam', 'clonazepam', 'temazepam', 'oxazepam', 'chlordiazepoxide'],
  opioid: ['morphine', 'oxycodone', 'hydromorphone', 'fentanyl', 'tramadol', 'codeine', 'methadone', 'tapentadol', 'pethidine', 'buprenorphine'],
  ssri_snri: ['sertraline', 'citalopram', 'escitalopram', 'fluoxetine', 'paroxetine', 'fluvoxamine', 'venlafaxine', 'duloxetine'],
  qt_prolonging: ['amiodarone', 'sotalol', 'dofetilide', 'haloperidol', 'ondansetron', 'citalopram', 'escitalopram', 'azithromycin', 'clarithromycin', 'erythromycin', 'levofloxacin', 'moxifloxacin', 'ciprofloxacin', 'fluconazole', 'posaconazole', 'voriconazole', 'methadone', 'quetiapine', 'domperidone', 'hydroxychloroquine', 'droperidol'],
  insulin: ['insulin', 'glargine', 'detemir', 'degludec', 'aspart', 'lispro', 'glulisine'],
  sulfonylurea: ['gliclazide', 'glipizide', 'glimepiride', 'glyburide', 'glibenclamide'],
  aminoglycoside: ['gentamicin', 'amikacin', 'tobramycin'],
  chemotherapy: ['methotrexate', 'cyclophosphamide', 'cytarabine', 'daunorubicin', 'doxorubicin', 'idarubicin', 'epirubicin', 'vincristine', 'vinblastine', 'cisplatin', 'carboplatin', 'oxaliplatin', 'paclitaxel', 'docetaxel', 'etoposide', 'fluorouracil', 'capecitabine', 'gemcitabine', 'azacitidine', 'decitabine', 'fludarabine', 'bendamustine', 'ifosfamide', 'mercaptopurine', 'imatinib', 'venetoclax'],
} as const;

export type DrugClass = keyof typeof DRUG_CLASSES;

export const CLASS_LABEL: Partial<Record<DrugClass, string>> = {
  anticoagulant: 'anticoagulants',
  antiplatelet: 'antiplatelets',
  ppi: 'proton pump inhibitors',
  nsaid: 'NSAIDs',
  acei: 'ACE inhibitors',
  arb: 'ARBs / ARNI',
  statin: 'statins',
  beta_blocker: 'beta-blockers',
  benzodiazepine: 'benzodiazepines',
  opioid: 'opioids',
  k_sparing: 'potassium-sparing diuretics',
};

/** High-alert medication groups (ISMP-style) used for an educational double-check reminder. */
export const HIGH_ALERT: DrugClass[] = ['anticoagulant', 'insulin', 'opioid', 'chemotherapy', 'sulfonylurea'];
export const HIGH_ALERT_DRUGS = ['digoxin', 'amiodarone', 'potassium chloride', 'methotrexate', 'magnesium sulfate', 'heparin'];

/** Drugs commonly requiring renal dose review or avoidance at low clearance. */
export const RENAL_REVIEW = [
  'enoxaparin', 'dalteparin', 'fondaparinux', 'dabigatran', 'rivaroxaban', 'apixaban', 'edoxaban',
  'metformin', 'sitagliptin', 'gabapentin', 'pregabalin', 'vancomycin', 'gentamicin', 'amikacin', 'tobramycin',
  'piperacillin', 'meropenem', 'imipenem', 'cefepime', 'ceftazidime', 'levofloxacin', 'ciprofloxacin',
  'acyclovir', 'aciclovir', 'valacyclovir', 'valaciclovir', 'ganciclovir', 'valganciclovir', 'fluconazole', 'nitrofurantoin',
  'trimethoprim', 'sulfamethoxazole', 'co-trimoxazole', 'allopurinol', 'digoxin', 'lithium', 'spironolactone', 'methotrexate',
  'morphine', 'tramadol', 'famotidine', 'baclofen', 'colchicine', 'levetiracetam', 'oseltamivir', 'dapagliflozin', 'empagliflozin',
];

export const HEPATIC_REVIEW = ['paracetamol', 'acetaminophen', 'methotrexate', 'amiodarone', 'fluconazole', 'voriconazole', 'posaconazole', 'isoniazid', 'rifampicin', 'valproate', 'statin', 'atorvastatin', 'simvastatin'];

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^a-z\- ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Grouping key: generic name with salt words kept (metoprolol tartrate ≠ metoprolol succinate). */
export function medKey(name: string): string {
  return normalizeName(name)
    .replace(/\b(tablets?|tabs?|capsules?|caps?|injection|inj|oral|iv|po|sc|im|solution|syrup|er|sr|xl|cr)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Two names refer to the same drug if keys match, or one is the bare generic of the other. */
export function sameDrug(a: string, b: string): boolean {
  const ka = medKey(a);
  const kb = medKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  const ta = ka.split(' ');
  const tb = kb.split(' ');
  return ta[0] === tb[0] && (ta.length === 1 || tb.length === 1);
}

export function matchesTerm(name: string, term: string): boolean {
  const n = ` ${normalizeName(name)} `;
  return n.includes(` ${term} `) || n.includes(` ${term}-`) || n.includes(`-${term} `) || (term.length >= 6 && n.includes(term));
}

export function inClass(name: string, cls: DrugClass): boolean {
  return (DRUG_CLASSES[cls] as readonly string[]).some((t) => matchesTerm(name, t));
}

export function classesOf(name: string): DrugClass[] {
  return (Object.keys(DRUG_CLASSES) as DrugClass[]).filter((c) => inClass(name, c));
}

export function isAntiplateletDose(name: string, dose?: string): boolean {
  return matchesTerm(name, 'aspirin') && Number.parseFloat(dose ?? '0') <= 325;
}

// Order matters: specific multi-dose patterns must be tested before the generic "daily".
const FREQ_SYNONYMS: Array<[RegExp, string]> = [
  [/\b(twice daily|twice a day|bid|b\.i\.d\.?|bd|q12h|every 12 hours)\b/i, 'q12h'],
  [/\b(three times daily|three times a day|tid|t\.i\.d\.?|tds|q8h|every 8 hours)\b/i, 'q8h'],
  [/\b(four times daily|four times a day|qid|q\.i\.d\.?|qds|q6h|every 6 hours)\b/i, 'q6h'],
  [/\b(at night|nocte|qhs|hs|bedtime|nightly)\b/i, 'qhs'],
  [/\b(weekly|once a week|q7d)\b/i, 'weekly'],
  [/\b(continuous|infusion|per 24 h)\b/i, 'continuous'],
  [/\b(once daily|daily|od|qd|q24h|every 24 hours|once a day|mane|in the morning)\b/i, 'q24h'],
];

export function normalizeFrequency(freq?: string): string | undefined {
  if (!freq) return undefined;
  const prn = /\bprn\b|as needed/i.test(freq) ? ' prn' : '';
  for (const [re, key] of FREQ_SYNONYMS) if (re.test(freq)) return key + prn;
  return freq.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function normalizeDose(dose?: string, unit?: string): string | undefined {
  if (!dose && !unit) return undefined;
  const text = `${dose ?? ''}${unit ?? ''}`.toLowerCase().replace(/\s+/g, '');
  const m = text.match(/(\d+(?:\.\d+)?)(mcg|µg|ug|mg|g|units?|iu|meq|mmol|ml)?/);
  if (!m) return text || undefined;
  let value = Number(m[1]);
  let u = m[2] ?? '';
  if (u === 'g') {
    value *= 1000;
    u = 'mg';
  }
  if (u === 'µg' || u === 'ug') u = 'mcg';
  if (u === 'unit' || u === 'iu') u = 'units';
  return `${value}${u}`;
}

export function normalizeRoute(route?: string): string | undefined {
  if (!route) return undefined;
  const r = route.toLowerCase();
  if (/\b(po|oral|by mouth|per os)\b/.test(r)) return 'po';
  if (/\b(iv|intravenous)/.test(r)) return 'iv';
  if (/\b(sc|sq|subcut|subcutaneous)/.test(r)) return 'sc';
  if (/\b(im|intramuscular)/.test(r)) return 'im';
  if (/\b(inh|inhaled|neb)/.test(r)) return 'inh';
  return r.trim();
}
