// Test fixtures: small synthetic bundles (fictional data only).
import type { CaseBundle } from '@/lib/bundle';
import type { Allergy, CaseRecord, LabResult, Medication, MedList, Provenance } from '@/lib/types';

let n = 0;
const id = () => `id-${++n}`;
export const verified: Provenance = { origin: 'manual', verification: 'verified' };

export function caseRecord(patch: Partial<CaseRecord> = {}): CaseRecord {
  return { id: 'case-1', code: 'CASE-0001', department: 'internal_medicine', priority: 'medium', status: 'active', stage: 'collect', mode: 'teach', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', ...patch };
}

export function med(name: string, patch: Partial<Medication> = {}): Medication {
  return { id: id(), caseId: 'case-1', name, list: 'current' as MedList, status: 'active', prov: verified, createdAt: `2026-01-01T00:00:${String(n).padStart(2, '0')}Z`, ...patch };
}

export function lab(name: string, value: string, patch: Partial<LabResult> = {}): LabResult {
  return { id: id(), caseId: 'case-1', name, value, prov: verified, createdAt: '2026-01-01T00:00:00Z', ...patch };
}

export function allergy(substance: string, reaction?: string): Allergy {
  return { id: id(), caseId: 'case-1', substance, reaction, prov: verified, createdAt: '2026-01-01T00:00:00Z' };
}

export function bundle(patch: Partial<CaseBundle> = {}): CaseBundle {
  return {
    case: caseRecord(),
    sources: [],
    extracted: [],
    profiles: [],
    allergies: [],
    meds: [],
    labs: [],
    vitals: [],
    diagnostics: [],
    problems: [],
    timeline: [],
    drps: [],
    interventions: [],
    monitoring: [],
    followups: [],
    reflections: [],
    ...patch,
  };
}
