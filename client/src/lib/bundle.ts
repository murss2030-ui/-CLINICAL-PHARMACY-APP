import type { PreceptorDB } from './db';
import type {
  Allergy,
  CaseRecord,
  CaseSource,
  ClinicalProblem,
  Diagnostic,
  Drp,
  ExtractedItem,
  FollowUp,
  Intervention,
  LabResult,
  Medication,
  MonitoringItem,
  ProfileEntry,
  Reflection,
  TimelineEvent,
  VitalSign,
} from './types';

/** Everything known about one case, loaded together for rules and views. */
export interface CaseBundle {
  case: CaseRecord;
  sources: CaseSource[];
  extracted: ExtractedItem[];
  profiles: ProfileEntry[];
  allergies: Allergy[];
  meds: Medication[];
  labs: LabResult[];
  vitals: VitalSign[];
  diagnostics: Diagnostic[];
  problems: ClinicalProblem[];
  timeline: TimelineEvent[];
  drps: Drp[];
  interventions: Intervention[];
  monitoring: MonitoringItem[];
  followups: FollowUp[];
  reflections: Reflection[];
}

export async function loadBundle(database: PreceptorDB, caseId: string): Promise<CaseBundle | undefined> {
  const record = await database.cases.get(caseId);
  if (!record) return undefined;
  const by = <T,>(table: { where(i: string): { equals(v: string): { toArray(): Promise<T[]> } } }) => table.where('caseId').equals(caseId).toArray();
  const [sources, extracted, profiles, allergies, meds, labs, vitals, diagnostics, problems, timeline, drps, interventions, monitoring, followups, reflections] = await Promise.all([
    by<CaseSource>(database.sources),
    by<ExtractedItem>(database.extracted),
    by<ProfileEntry>(database.profiles),
    by<Allergy>(database.allergies),
    by<Medication>(database.medications),
    by<LabResult>(database.labs),
    by<VitalSign>(database.vitals),
    by<Diagnostic>(database.diagnostics),
    by<ClinicalProblem>(database.problems),
    by<TimelineEvent>(database.timeline),
    by<Drp>(database.drps),
    by<Intervention>(database.interventions),
    by<MonitoringItem>(database.monitoring),
    by<FollowUp>(database.followups),
    by<Reflection>(database.reflections),
  ]);
  const byCreated = <T extends { createdAt: string }>(a: T, b: T) => a.createdAt.localeCompare(b.createdAt);
  return {
    case: record,
    sources: sources.sort(byCreated),
    extracted: extracted.sort(byCreated),
    profiles: profiles.sort(byCreated),
    allergies,
    meds: meds.sort(byCreated),
    labs: labs.sort((a, b) => (a.takenAt ?? a.createdAt).localeCompare(b.takenAt ?? b.createdAt)),
    vitals,
    diagnostics,
    problems: problems.sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999) || a.createdAt.localeCompare(b.createdAt)),
    timeline,
    drps: drps.sort(byCreated),
    interventions: interventions.sort(byCreated),
    monitoring: monitoring.sort(byCreated),
    followups: followups.sort(byCreated),
    reflections: reflections.sort(byCreated),
  };
}

export const isVerified = (p: { prov: { verification: string } }) => p.prov.verification === 'verified' || p.prov.verification === 'corrected';

/** Active medications the patient is receiving now (current list, or admission list if no current list). */
export function activeMeds(b: Pick<CaseBundle, 'meds'>): Medication[] {
  const live = b.meds.filter((m) => m.prov.verification !== 'rejected');
  const current = live.filter((m) => m.list === 'current');
  const base = current.length ? current : live.filter((m) => m.list === 'admission');
  return base.filter((m) => m.status === 'active' || m.status === 'unknown');
}

export function profileValue(b: Pick<CaseBundle, 'profiles'>, key: ProfileEntry['key']): string | undefined {
  const rows = b.profiles.filter((p) => p.key === key && p.prov.verification !== 'rejected');
  return rows.length ? rows.map((r) => r.value).join('; ') : undefined;
}
