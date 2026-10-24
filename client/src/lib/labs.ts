// Laboratory name canonicalisation and unit normalisation.
// Values are converted to one reference unit per analyte so rules and trends
// can compare results captured from different laboratories.

export type LabKey =
  | 'creatinine'
  | 'bun'
  | 'potassium'
  | 'sodium'
  | 'chloride'
  | 'bicarbonate'
  | 'magnesium'
  | 'calcium'
  | 'phosphate'
  | 'albumin'
  | 'glucose'
  | 'inr'
  | 'wbc'
  | 'anc'
  | 'hemoglobin'
  | 'platelets'
  | 'alt'
  | 'ast'
  | 'bilirubin'
  | 'uric_acid'
  | 'crp'
  | 'procalcitonin'
  | 'lactate'
  | 'ldh'
  | 'digoxin'
  | 'vancomycin'
  | 'bnp'
  | 'troponin'
  | 'hba1c'
  | 'tsh'
  | 'ck'
  | 'egfr';

const PATTERNS: Array<[LabKey, RegExp]> = [
  ['egfr', /\begfr\b/i],
  ['creatinine', /^(?!.*(clearance|\bcrcl\b|ratio|urine|urinary)).*\b(s?cr|creat(inine)?|serum creatinine)\b/i],
  ['bun', /\b(bun|urea)\b/i],
  ['potassium', /\b(k\+?|potassium)\b/i],
  ['sodium', /\b(na\+?|sodium)\b/i],
  ['chloride', /\b(cl-?|chloride)\b/i],
  ['bicarbonate', /\b(hco3-?|bicarb(onate)?|total co2|tco2)\b/i],
  ['magnesium', /\b(mg|magnesium)\b(?!\s*\/)/i],
  ['phosphate', /\b(po4|phos(phate|phorus)?)\b/i],
  ['albumin', /^(?!.*(ratio|urine|urinary|micro)).*\b(alb|albumin)\b/i],
  ['calcium', /^(?!.*ioni[sz]ed).*\b(ca|calcium)\b(?![\s-]*\d)/i],
  ['glucose', /\b(glu(cose)?|bg|blood sugar|fbs|rbs)\b/i],
  ['inr', /\binr\b/i],
  ['anc', /\b(anc|absolute neutrophils?|neutrophils? \(abs|neut abs)/i],
  ['wbc', /\b(wbc|white (blood )?cells?|leu[ck]ocytes?)\b/i],
  ['hemoglobin', /\b(hb|hgb|ha?emoglobin)\b/i],
  ['platelets', /\b(plt|platelets?)\b/i],
  ['alt', /\b(alt|sgpt|alanine aminotransferase)\b/i],
  ['ast', /\b(ast|sgot|aspartate aminotransferase)\b/i],
  ['bilirubin', /\b(t\.? ?bili|bilirubin)\b/i],
  ['uric_acid', /\b(uric acid|urate)\b/i],
  ['crp', /\b(crp|c-reactive protein)\b/i],
  ['procalcitonin', /\b(pct|procalcitonin)\b/i],
  ['ldh', /\b(ldh|lactate dehydrogenase)\b/i],
  ['lactate', /\b(lactate|lactic acid)\b/i],
  ['digoxin', /\bdigoxin\b/i],
  ['vancomycin', /\bvanc(omycin)?\b/i],
  ['bnp', /\b(nt-?pro-?bnp|bnp)\b/i],
  ['troponin', /\b(trop(onin)?|hs-?tn[it])\b/i],
  ['hba1c', /\b(hba1c|a1c|glycated)\b/i],
  ['tsh', /\btsh\b/i],
  ['ck', /\b(ck|cpk|creatine kinase)\b/i],
];

export const LAB_LABEL: Record<LabKey, string> = {
  creatinine: 'Serum creatinine',
  bun: 'BUN / urea',
  potassium: 'Potassium',
  sodium: 'Sodium',
  chloride: 'Chloride',
  bicarbonate: 'Bicarbonate',
  magnesium: 'Magnesium',
  calcium: 'Calcium',
  phosphate: 'Phosphate',
  albumin: 'Albumin',
  glucose: 'Glucose',
  inr: 'INR',
  wbc: 'WBC',
  anc: 'ANC',
  hemoglobin: 'Haemoglobin',
  platelets: 'Platelets',
  alt: 'ALT',
  ast: 'AST',
  bilirubin: 'Bilirubin',
  uric_acid: 'Uric acid',
  crp: 'CRP',
  procalcitonin: 'Procalcitonin',
  lactate: 'Lactate',
  ldh: 'LDH',
  digoxin: 'Digoxin level',
  vancomycin: 'Vancomycin level',
  bnp: 'BNP / NT-proBNP',
  troponin: 'Troponin',
  hba1c: 'HbA1c',
  tsh: 'TSH',
  ck: 'CK',
  egfr: 'eGFR',
};

/** Canonical unit each analyte is normalised to. */
export const LAB_UNIT: Partial<Record<LabKey, string>> = {
  creatinine: 'mg/dL',
  bun: 'mg/dL',
  potassium: 'mmol/L',
  sodium: 'mmol/L',
  chloride: 'mmol/L',
  bicarbonate: 'mmol/L',
  magnesium: 'mg/dL',
  calcium: 'mg/dL',
  phosphate: 'mg/dL',
  albumin: 'g/dL',
  glucose: 'mg/dL',
  wbc: 'x10^9/L',
  anc: 'x10^9/L',
  hemoglobin: 'g/dL',
  platelets: 'x10^9/L',
  uric_acid: 'mg/dL',
  bilirubin: 'mg/dL',
};

export function canonicalLab(name: string): LabKey | undefined {
  const n = name.trim();
  // "Urea (BUN)" etc. — the first matching pattern wins; order matters (eGFR before creatinine, ANC before WBC).
  for (const [key, re] of PATTERNS) if (re.test(n)) return key;
  return undefined;
}

/** First number in a result string ("<5" → 5, "1,250" → 1250). */
export function numericValue(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const m = value.replace(/,(?=\d{3}\b)/g, '').match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : undefined;
}

export interface NormalizedLab {
  key: LabKey;
  value: number;
  unit: string;
}

export function normalizeLab(name: string, value: string, unit?: string): NormalizedLab | undefined {
  const key = canonicalLab(name);
  const raw = numericValue(value);
  if (!key || raw === undefined) return undefined;
  const u = (unit ?? '').toLowerCase().replace(/\s/g, '').replace('µ', 'u').replace('μ', 'u');
  let v = raw;
  switch (key) {
    case 'creatinine':
      if (u.includes('umol') || (!u && raw > 20)) v = raw / 88.4;
      break;
    case 'bun':
      if (u.includes('mmol')) v = raw * 2.8;
      break;
    case 'glucose':
      if (u.includes('mmol') || (!u && raw < 35)) v = raw * 18;
      break;
    case 'calcium':
      if (u.includes('mmol') || (!u && raw < 4)) v = raw * 4.008;
      break;
    case 'magnesium':
      if (u.includes('mmol')) v = raw * 2.43;
      break;
    case 'phosphate':
      if (u.includes('mmol')) v = raw * 3.097;
      break;
    case 'albumin':
    case 'hemoglobin':
      if (u.includes('g/l') && !u.includes('g/dl')) v = raw / 10;
      break;
    case 'uric_acid':
      if (u.includes('umol')) v = raw / 59.48;
      break;
    case 'bilirubin':
      if (u.includes('umol')) v = raw / 17.1;
      break;
    case 'platelets':
    case 'wbc':
    case 'anc':
      if (raw >= 1000) v = raw / 1000; // per µL → ×10^9/L
      break;
  }
  return { key, value: Math.round(v * 1000) / 1000, unit: LAB_UNIT[key] ?? unit ?? '' };
}

export interface LabLike {
  name: string;
  value: string;
  unit?: string;
  takenAt?: string;
  createdAt?: string;
}

export interface LabPoint<T extends LabLike = LabLike> {
  value: number;
  unit: string;
  at: string;
  lab: T;
}

export function labSeries<T extends LabLike>(labs: T[], key: LabKey): LabPoint<T>[] {
  return labs
    .map((lab) => ({ lab, n: normalizeLab(lab.name, lab.value, lab.unit) }))
    .filter((x): x is { lab: T; n: NormalizedLab } => x.n?.key === key)
    .map(({ lab, n }) => ({ value: n.value, unit: n.unit, at: lab.takenAt ?? lab.createdAt ?? '', lab }))
    .sort((a, b) => a.at.localeCompare(b.at));
}

export function latestLab<T extends LabLike>(labs: T[], key: LabKey): LabPoint<T> | undefined {
  const s = labSeries(labs, key);
  return s[s.length - 1];
}
