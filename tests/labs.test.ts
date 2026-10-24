import { describe, expect, it } from 'vitest';
import { canonicalLab, labSeries, latestLab, normalizeLab, numericValue } from '@/lib/labs';
import { lab } from './helpers';

describe('laboratory normalisation', () => {
  it.each([
    ['Creatinine', 'creatinine'],
    ['Serum creatinine', 'creatinine'],
    ['Urea (BUN)', 'bun'],
    ['K', 'potassium'],
    ['Glucose (random)', 'glucose'],
    ['ANC', 'anc'],
    ['WBC', 'wbc'],
    ['Hb', 'hemoglobin'],
    ['Platelets', 'platelets'],
    ['eGFR', 'egfr'],
    ['NT-proBNP', 'bnp'],
    ['Digoxin level', 'digoxin'],
    ['Lactate dehydrogenase', 'ldh'],
    ['Lactate', 'lactate'],
    ['Uric acid', 'uric_acid'],
    ['Bilirubin (total)', 'bilirubin'],
  ])('%s → %s', (name, key) => expect(canonicalLab(name)).toBe(key));

  it('does not confuse look-alike tests', () => {
    expect(canonicalLab('Creatinine clearance')).not.toBe('creatinine');
    expect(canonicalLab('Urine albumin-to-creatinine ratio')).toBeUndefined();
    expect(canonicalLab('CA 19-9')).not.toBe('calcium');
  });

  it('parses numbers from result strings', () => {
    expect(numericValue('<5')).toBe(5);
    expect(numericValue('1,250')).toBe(1250);
    expect(numericValue('pending')).toBeUndefined();
  });

  it('converts SI units to the reference unit', () => {
    expect(normalizeLab('Creatinine', '159', 'µmol/L')!.value).toBeCloseTo(1.8, 1);
    expect(normalizeLab('Glucose', '10', 'mmol/L')!.value).toBe(180);
    expect(normalizeLab('Calcium', '2.1', 'mmol/L')!.value).toBeCloseTo(8.42, 2);
    expect(normalizeLab('Platelets', '210000', '/uL')!.value).toBe(210);
    expect(normalizeLab('Albumin', '32', 'g/L')!.value).toBe(3.2);
  });

  it('builds time-ordered series and finds the latest value', () => {
    const labs = [lab('Creatinine', '2.1', { takenAt: '2026-03-11T06:00' }), lab('Creatinine', '1.8', { takenAt: '2026-03-10T08:40' }), lab('Potassium', '5.4')];
    expect(labSeries(labs, 'creatinine').map((p) => p.value)).toEqual([1.8, 2.1]);
    expect(latestLab(labs, 'creatinine')!.value).toBe(2.1);
  });
});
