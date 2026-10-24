// Validated clinical calculators. Each shows inputs, formula, result, units,
// interpretation and limitations. Calculators never create prescribing
// decisions — results are inputs to the trainee's own assessment.

export type Sex = 'Female' | 'Male';

export function bmi(weightKg: number, heightCm: number): number {
  const m = heightCm / 100;
  return weightKg / (m * m);
}

/** Mosteller: √(height[cm] × weight[kg] / 3600). */
export function bsaMosteller(weightKg: number, heightCm: number): number {
  return Math.sqrt((heightCm * weightKg) / 3600);
}

/** Devine ideal body weight. */
export function idealBodyWeight(heightCm: number, sex: Sex): number {
  const inches = heightCm / 2.54;
  return (sex === 'Male' ? 50 : 45.5) + 2.3 * (inches - 60);
}

export function adjustedBodyWeight(actualKg: number, ibwKg: number): number {
  return ibwKg + 0.4 * (actualKg - ibwKg);
}

/** Cockcroft-Gault creatinine clearance (mL/min). */
export function crclCockcroftGault(p: { age: number; weightKg: number; scrMgDl: number; sex: Sex }): number {
  const value = ((140 - p.age) * p.weightKg) / (72 * p.scrMgDl);
  return p.sex === 'Female' ? value * 0.85 : value;
}

/** CKD-EPI 2021 creatinine equation (race-free), mL/min/1.73 m². */
export function egfrCkdEpi2021(p: { age: number; scrMgDl: number; sex: Sex }): number {
  const female = p.sex === 'Female';
  const kappa = female ? 0.7 : 0.9;
  const alpha = female ? -0.241 : -0.302;
  const ratio = p.scrMgDl / kappa;
  return 142 * Math.min(ratio, 1) ** alpha * Math.max(ratio, 1) ** -1.2 * 0.9938 ** p.age * (female ? 1.012 : 1);
}

/** Payne correction: Ca + 0.8 × (4.0 − albumin), mg/dL and g/dL. */
export function correctedCalcium(caMgDl: number, albuminGdl: number): number {
  return caMgDl + 0.8 * (4 - albuminGdl);
}

export function anionGap(na: number, cl: number, hco3: number): number {
  return na - (cl + hco3);
}

export function albuminCorrectedAnionGap(ag: number, albuminGdl: number): number {
  return ag + 2.5 * (4 - albuminGdl);
}

export function qtc(qtMs: number, heartRate: number) {
  const rr = 60 / heartRate;
  return {
    bazett: qtMs / Math.sqrt(rr),
    fridericia: qtMs / Math.cbrt(rr),
    framingham: qtMs + 154 * (1 - rr),
  };
}

// ───────────────────────── UI definitions ─────────────────────────

export interface CalcInput {
  key: string;
  label: string;
  unit?: string;
  kind?: 'number' | 'sex';
  min?: number;
  max?: number;
  step?: number;
}

export interface CalcResult {
  lines: Array<{ label: string; value: string }>;
  interpretation: string;
}

export interface CalculatorDef {
  id: string;
  name: string;
  inputs: CalcInput[];
  formula: string;
  limitations: string[];
  compute: (v: Record<string, number | string | undefined>) => CalcResult | { error: string };
}

const num = (v: number | string | undefined) => (typeof v === 'number' ? v : v === undefined || v === '' ? NaN : Number(v));
const fmt = (n: number, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : '—');

function requireAll(v: Record<string, number | string | undefined>, keys: string[], ranges: Record<string, [number, number]>): string | undefined {
  for (const k of keys) {
    const n = num(v[k]);
    if (!Number.isFinite(n)) return `Enter ${k}.`;
    const r = ranges[k];
    if (r && (n < r[0] || n > r[1])) return `${k} must be between ${r[0]} and ${r[1]}.`;
  }
  return undefined;
}

const RANGES: Record<string, [number, number]> = {
  age: [18, 120],
  weightKg: [20, 350],
  heightCm: [100, 250],
  scr: [0.1, 20],
  ca: [3, 20],
  albumin: [0.5, 7],
  na: [90, 190],
  cl: [60, 150],
  hco3: [2, 60],
  qt: [200, 800],
  hr: [20, 250],
};

export const CALCULATORS: CalculatorDef[] = [
  {
    id: 'bmi',
    name: 'Body mass index (BMI)',
    inputs: [
      { key: 'weightKg', label: 'Weight', unit: 'kg' },
      { key: 'heightCm', label: 'Height', unit: 'cm' },
    ],
    formula: 'BMI = weight (kg) ÷ height (m)²',
    limitations: ['Does not distinguish fat from lean mass or oedema.', 'Not validated for children (use percentiles), pregnancy or amputees.'],
    compute: (v) => {
      const err = requireAll(v, ['weightKg', 'heightCm'], RANGES);
      if (err) return { error: err };
      const b = bmi(num(v.weightKg), num(v.heightCm));
      const cat = b < 18.5 ? 'Underweight' : b < 25 ? 'Normal range' : b < 30 ? 'Overweight' : 'Obesity';
      return { lines: [{ label: 'BMI', value: `${fmt(b)} kg/m²` }], interpretation: `${cat} (WHO adult categories).` };
    },
  },
  {
    id: 'bsa',
    name: 'Body surface area (Mosteller)',
    inputs: [
      { key: 'weightKg', label: 'Weight', unit: 'kg' },
      { key: 'heightCm', label: 'Height', unit: 'cm' },
    ],
    formula: 'BSA (m²) = √(height (cm) × weight (kg) ÷ 3600)',
    limitations: ['Different BSA formulas give slightly different results.', 'Chemotherapy dosing must follow the protocol (actual vs. adjusted weight, BSA capping).'],
    compute: (v) => {
      const err = requireAll(v, ['weightKg', 'heightCm'], RANGES);
      if (err) return { error: err };
      const b = bsaMosteller(num(v.weightKg), num(v.heightCm));
      return { lines: [{ label: 'BSA', value: `${fmt(b, 2)} m²` }], interpretation: 'Used for dosing of some drugs (e.g. chemotherapy). Verify against the protocol.' };
    },
  },
  {
    id: 'crcl',
    name: 'Creatinine clearance (Cockcroft-Gault)',
    inputs: [
      { key: 'age', label: 'Age', unit: 'years' },
      { key: 'weightKg', label: 'Weight', unit: 'kg' },
      { key: 'heightCm', label: 'Height (for IBW / AdjBW)', unit: 'cm' },
      { key: 'scr', label: 'Serum creatinine', unit: 'mg/dL', step: 0.1 },
      { key: 'sex', label: 'Sex', kind: 'sex' },
    ],
    formula: 'CrCl = [(140 − age) × weight] ÷ (72 × SCr) × 0.85 if female',
    limitations: [
      'Assumes stable renal function — unreliable in AKI or rapidly changing creatinine.',
      'Choice of weight (actual, ideal, adjusted) changes the result; follow the drug labelling or local policy.',
      'Less accurate at extremes of age, weight and muscle mass, and in amputees.',
      'Creatinine µmol/L ÷ 88.4 = mg/dL.',
    ],
    compute: (v) => {
      const err = requireAll(v, ['age', 'weightKg', 'scr'], RANGES);
      if (err) return { error: err };
      if (v.sex !== 'Female' && v.sex !== 'Male') return { error: 'Select sex.' };
      const sex = v.sex as Sex;
      const base = { age: num(v.age), scrMgDl: num(v.scr), sex };
      const actual = crclCockcroftGault({ ...base, weightKg: num(v.weightKg) });
      const lines = [{ label: 'CrCl (actual body weight)', value: `${fmt(actual, 0)} mL/min` }];
      const h = num(v.heightCm);
      if (Number.isFinite(h) && h >= 100) {
        const ibw = idealBodyWeight(h, sex);
        const adj = adjustedBodyWeight(num(v.weightKg), ibw);
        lines.push({ label: `Ideal body weight ${fmt(ibw)} kg → CrCl`, value: `${fmt(crclCockcroftGault({ ...base, weightKg: ibw }), 0)} mL/min` });
        lines.push({ label: `Adjusted body weight ${fmt(adj)} kg → CrCl`, value: `${fmt(crclCockcroftGault({ ...base, weightKg: adj }), 0)} mL/min` });
      }
      const interp =
        actual < 30
          ? 'Below 30 mL/min: many renally cleared drugs need dose adjustment or avoidance — check each drug in a renal dosing reference.'
          : actual < 60
            ? '30–59 mL/min: review renally cleared drugs against their labelling.'
            : 'At or above 60 mL/min: dose adjustment is less often required; still check narrow-therapeutic-index drugs.';
      return { lines, interpretation: interp };
    },
  },
  {
    id: 'egfr',
    name: 'eGFR (CKD-EPI 2021, race-free)',
    inputs: [
      { key: 'age', label: 'Age', unit: 'years' },
      { key: 'scr', label: 'Serum creatinine', unit: 'mg/dL', step: 0.1 },
      { key: 'sex', label: 'Sex', kind: 'sex' },
    ],
    formula: 'eGFR = 142 × min(SCr/κ,1)^α × max(SCr/κ,1)^−1.200 × 0.9938^age × 1.012 [female]; κ 0.7 F / 0.9 M; α −0.241 F / −0.302 M',
    limitations: ['Indexed to 1.73 m² body surface area — de-index for drug dosing in very small or large patients.', 'Not valid in AKI or unstable creatinine.', 'Validated in adults.'],
    compute: (v) => {
      const err = requireAll(v, ['age', 'scr'], RANGES);
      if (err) return { error: err };
      if (v.sex !== 'Female' && v.sex !== 'Male') return { error: 'Select sex.' };
      const e = egfrCkdEpi2021({ age: num(v.age), scrMgDl: num(v.scr), sex: v.sex as Sex });
      const cat = e >= 90 ? 'G1' : e >= 60 ? 'G2' : e >= 45 ? 'G3a' : e >= 30 ? 'G3b' : e >= 15 ? 'G4' : 'G5';
      return { lines: [{ label: 'eGFR', value: `${fmt(e, 0)} mL/min/1.73 m²` }], interpretation: `KDIGO GFR category ${cat} (staging CKD also needs chronicity and albuminuria).` };
    },
  },
  {
    id: 'corrca',
    name: 'Corrected calcium (albumin)',
    inputs: [
      { key: 'ca', label: 'Total calcium', unit: 'mg/dL', step: 0.1 },
      { key: 'albumin', label: 'Albumin', unit: 'g/dL', step: 0.1 },
    ],
    formula: 'Corrected Ca = measured Ca + 0.8 × (4.0 − albumin)',
    limitations: ['Approximation — ionised calcium is preferred in critical illness, renal failure and acid–base disturbance.', 'mmol/L × 4.008 = mg/dL; albumin g/L ÷ 10 = g/dL.'],
    compute: (v) => {
      const err = requireAll(v, ['ca', 'albumin'], RANGES);
      if (err) return { error: err };
      const c = correctedCalcium(num(v.ca), num(v.albumin));
      const interp = c < 8.5 ? 'Below the usual reference interval (≈8.5–10.5 mg/dL; laboratory-specific).' : c > 10.5 ? 'Above the usual reference interval (≈8.5–10.5 mg/dL; laboratory-specific).' : 'Within the usual reference interval (≈8.5–10.5 mg/dL; laboratory-specific).';
      return { lines: [{ label: 'Corrected calcium', value: `${fmt(c)} mg/dL` }], interpretation: interp };
    },
  },
  {
    id: 'aniongap',
    name: 'Anion gap',
    inputs: [
      { key: 'na', label: 'Sodium', unit: 'mmol/L' },
      { key: 'cl', label: 'Chloride', unit: 'mmol/L' },
      { key: 'hco3', label: 'Bicarbonate', unit: 'mmol/L' },
      { key: 'albumin', label: 'Albumin (optional)', unit: 'g/dL', step: 0.1 },
    ],
    formula: 'AG = Na − (Cl + HCO₃); albumin-corrected AG = AG + 2.5 × (4.0 − albumin)',
    limitations: ['Reference range depends on the laboratory analyser (often ≈8–12 mmol/L without potassium).', 'Hypoalbuminaemia lowers the measured gap.'],
    compute: (v) => {
      const err = requireAll(v, ['na', 'cl', 'hco3'], RANGES);
      if (err) return { error: err };
      const ag = anionGap(num(v.na), num(v.cl), num(v.hco3));
      const lines = [{ label: 'Anion gap', value: `${fmt(ag, 0)} mmol/L` }];
      const alb = num(v.albumin);
      if (Number.isFinite(alb) && alb > 0) lines.push({ label: 'Albumin-corrected AG', value: `${fmt(albuminCorrectedAnionGap(ag, alb), 0)} mmol/L` });
      return { lines, interpretation: 'Interpret with the laboratory reference range and the clinical picture (e.g. high-gap metabolic acidosis).' };
    },
  },
  {
    id: 'qtc',
    name: 'Corrected QT (QTc)',
    inputs: [
      { key: 'qt', label: 'Measured QT', unit: 'ms' },
      { key: 'hr', label: 'Heart rate', unit: 'bpm' },
      { key: 'sex', label: 'Sex', kind: 'sex' },
    ],
    formula: 'RR = 60 ÷ HR; Bazett QT/√RR; Fridericia QT/∛RR; Framingham QT + 154 × (1 − RR)',
    limitations: ['Bazett over-corrects at high heart rates; Fridericia or Framingham are preferred when HR > 90.', 'Unreliable in atrial fibrillation, bundle branch block and paced rhythms.', 'Machine-read QT should be confirmed manually.'],
    compute: (v) => {
      const err = requireAll(v, ['qt', 'hr'], RANGES);
      if (err) return { error: err };
      const q = qtc(num(v.qt), num(v.hr));
      const threshold = v.sex === 'Male' ? 450 : 460;
      const ref = Number(v.hr) > 90 ? q.fridericia : q.bazett;
      const interp =
        ref > 500
          ? 'QTc above 500 ms: high risk for torsades de pointes — urgent review of QT-prolonging drugs and electrolytes.'
          : ref > threshold
            ? `Prolonged (above ${threshold} ms ${v.sex ? `for ${String(v.sex).toLowerCase()}s` : ''}). Review QT-prolonging drugs and K/Mg.`
            : 'Not prolonged by the usual thresholds.';
      return {
        lines: [
          { label: 'Bazett', value: `${fmt(q.bazett, 0)} ms` },
          { label: 'Fridericia', value: `${fmt(q.fridericia, 0)} ms` },
          { label: 'Framingham', value: `${fmt(q.framingham, 0)} ms` },
        ],
        interpretation: interp,
      };
    },
  },
];
