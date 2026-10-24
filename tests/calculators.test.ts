import { describe, expect, it } from 'vitest';
import { adjustedBodyWeight, albuminCorrectedAnionGap, anionGap, bmi, bsaMosteller, CALCULATORS, correctedCalcium, crclCockcroftGault, egfrCkdEpi2021, idealBodyWeight, qtc } from '@/lib/calculators';

describe('clinical calculators', () => {
  it('BMI', () => expect(bmi(70, 175)).toBeCloseTo(22.86, 2));
  it('BSA (Mosteller)', () => expect(bsaMosteller(70, 165)).toBeCloseTo(1.79, 2));
  it('Cockcroft-Gault applies the female factor', () => {
    expect(crclCockcroftGault({ age: 78, weightKg: 58, scrMgDl: 1.8, sex: 'Female' })).toBeCloseTo(23.6, 1);
    expect(crclCockcroftGault({ age: 78, weightKg: 58, scrMgDl: 1.8, sex: 'Male' })).toBeCloseTo(27.7, 1);
  });
  it('CKD-EPI 2021 (race-free) matches published values', () => {
    expect(egfrCkdEpi2021({ age: 60, scrMgDl: 1.2, sex: 'Male' })).toBeCloseTo(69.2, 0);
    expect(egfrCkdEpi2021({ age: 50, scrMgDl: 0.7, sex: 'Female' })).toBeCloseTo(105.3, 0);
  });
  it('ideal and adjusted body weight', () => {
    const ibw = idealBodyWeight(175, 'Male');
    expect(ibw).toBeCloseTo(70.5, 1);
    expect(adjustedBodyWeight(100, ibw)).toBeCloseTo(82.3, 1);
  });
  it('corrected calcium and anion gap', () => {
    expect(correctedCalcium(7.6, 3.2)).toBeCloseTo(8.24, 2);
    expect(anionGap(140, 104, 24)).toBe(12);
    expect(albuminCorrectedAnionGap(12, 2)).toBe(17);
  });
  it('QTc formulas', () => {
    const q = qtc(400, 75);
    expect(q.bazett).toBeCloseTo(447.2, 1);
    expect(q.fridericia).toBeCloseTo(430.9, 1);
    expect(q.framingham).toBeCloseTo(430.8, 1);
  });
  it('every calculator shows formula, limitations and validates input', () => {
    for (const c of CALCULATORS) {
      expect(c.formula.length).toBeGreaterThan(10);
      expect(c.limitations.length).toBeGreaterThan(0);
      expect('error' in c.compute({})).toBe(true);
    }
  });
  it('CrCl calculator interprets and reports alternative weights', () => {
    const calc = CALCULATORS.find((c) => c.id === 'crcl')!;
    const r = calc.compute({ age: 78, weightKg: 58, heightCm: 160, scr: 1.8, sex: 'Female' });
    expect('lines' in r && r.lines.length).toBe(3);
    expect('interpretation' in r && r.interpretation).toMatch(/Below 30/);
  });
  it('rejects implausible values', () => {
    const calc = CALCULATORS.find((c) => c.id === 'bmi')!;
    expect(calc.compute({ weightKg: 5000, heightCm: 170 })).toHaveProperty('error');
  });
});
