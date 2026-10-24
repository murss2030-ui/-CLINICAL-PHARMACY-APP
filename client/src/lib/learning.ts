// Adaptive learning: knowledge gaps from feedback, personal learning target,
// competency evidence and daily missions. Nothing here advances a
// competency level automatically and no performance is inflated.
import type { ReasoningEvaluation } from '@shared/ai';
import { DEPARTMENTS, type DepartmentId } from '@shared/departments';
import { COMPETENCY_LABEL, type CompetencyDomain } from '@shared/domain';
import { db } from './db';
import type { KnowledgeGap } from './types';
import { nowIso } from './utils';

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

export async function recordGaps(gaps: Array<{ topic: string; domain: CompetencyDomain }>, example?: string): Promise<void> {
  for (const g of gaps) {
    const id = `${g.domain}:${slug(g.topic)}`;
    const existing = await db.gaps.get(id);
    if (existing) {
      await db.gaps.update(id, {
        count: existing.count + 1,
        lastSeen: nowIso(),
        status: 'open',
        examples: example ? [...existing.examples, example].slice(-5) : existing.examples,
      });
    } else {
      await db.gaps.add({ id, topic: g.topic, domain: g.domain, count: 1, lastSeen: nowIso(), examples: example ? [example] : [], status: 'open' });
    }
  }
}

export async function recordEvaluation(ev: ReasoningEvaluation, question: string): Promise<void> {
  await recordGaps(ev.knowledgeGaps, question.slice(0, 200));
}

export interface LearningTarget {
  domain: CompetencyDomain;
  label: string;
  count: number;
  topics: string[];
}

/** Domain with the most repeated open gaps (needs at least 2 occurrences to count as a pattern). */
export function learningTarget(gaps: KnowledgeGap[]): LearningTarget | undefined {
  const byDomain = new Map<CompetencyDomain, { count: number; topics: string[] }>();
  for (const g of gaps.filter((x) => x.status !== 'resolved')) {
    const e = byDomain.get(g.domain) ?? { count: 0, topics: [] };
    e.count += g.count;
    e.topics.push(g.topic);
    byDomain.set(g.domain, e);
  }
  const top = [...byDomain.entries()].sort((a, b) => b[1].count - a[1].count)[0];
  if (!top || top[1].count < 2) return undefined;
  return { domain: top[0], label: COMPETENCY_LABEL[top[0]], count: top[1].count, topics: top[1].topics.slice(0, 4) };
}

// ───────────────────────── competency evidence ─────────────────────────

export async function competencyEvidence(): Promise<Partial<Record<CompetencyDomain, number>>> {
  const [drps, recon, monitoring, interventions, followups, reflections, answers, evidence, presentations, verified] = await Promise.all([
    db.drps.where('status').anyOf('confirmed', 'possible', 'not_supported').toArray(),
    db.recon.count(),
    db.monitoring.count(),
    db.interventions.toArray(),
    db.followups.toArray(),
    db.reflections.count(),
    db.answers.toArray(),
    db.evidence.count(),
    db.presentations.count(),
    db.extracted.where('status').anyOf('verified', 'corrected').count(),
  ]);
  const ev: Partial<Record<CompetencyDomain, number>> = {
    drp_identification: drps.filter((d) => d.origin === 'student' || d.status === 'confirmed').length,
    medication_reconciliation: recon,
    monitoring,
    intervention: interventions.length,
    communication: interventions.filter((i) => i.communicatedTo).length,
    follow_up: followups.filter((f) => f.status !== 'pending').length,
    evidence_based_practice: evidence,
    documentation: presentations + reflections,
    patient_assessment: verified,
  };
  for (const a of answers) for (const d of a.evaluation?.domains ?? []) ev[d] = (ev[d] ?? 0) + 1;
  return ev;
}

// ───────────────────────── daily missions ─────────────────────────

export type MissionKind = 'med_rec' | 'identify_drps' | 'evidence_question' | 'reflection' | 'monitoring' | 'verify_source' | 'followup' | 'targeted' | 'dept_topic';

export interface Mission {
  id: string;
  kind: MissionKind;
  text: string;
  target: number;
  progress: number;
  link: string;
}

export interface Activity {
  reconDecisions: number;
  studentDrps: number;
  trainingAnswers: number;
  reflections: number;
  monitoringItems: number;
  verifiedItems: number;
  followupsUpdated: number;
}

export async function todaysActivity(date = new Date()): Promise<Activity> {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const since = start.toISOString();
  const [recon, drps, answers, reflections, monitoring, extracted, followups] = await Promise.all([
    db.recon.filter((r) => r.updatedAt >= since).count(),
    db.drps.filter((d) => d.createdAt >= since && d.origin === 'student').count(),
    db.answers.filter((a) => a.createdAt >= since).count(),
    db.reflections.filter((r) => r.createdAt >= since).count(),
    db.monitoring.filter((m) => m.createdAt >= since).count(),
    db.extracted.filter((e) => (e.decidedAt ?? '') >= since && (e.status === 'verified' || e.status === 'corrected')).count(),
    db.followups.filter((f) => (f.completedAt ?? '') >= since).count(),
  ]);
  return { reconDecisions: recon, studentDrps: drps, trainingAnswers: answers, reflections, monitoringItems: monitoring, verifiedItems: extracted, followupsUpdated: followups };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Three missions per day: deterministic for the date, adapted to department and gaps, completed only by real activity. */
export function dailyMissions(dateKey: string, department: DepartmentId, activity: Activity, target?: LearningTarget): Mission[] {
  const dept = DEPARTMENTS[department] ?? DEPARTMENTS.internal_medicine;
  const topic = dept.learningTopics[hash(dateKey) % dept.learningTopics.length] ?? 'clinical reasoning';
  const catalog: Mission[] = [
    { id: 'med_rec', kind: 'med_rec', text: 'Complete one medication reconciliation (classify each discrepancy).', target: 1, progress: activity.reconDecisions, link: '/cases' },
    { id: 'identify_drps', kind: 'identify_drps', text: 'Identify two potential DRPs yourself before asking the AI.', target: 2, progress: activity.studentDrps, link: '/cases' },
    { id: 'evidence_question', kind: 'evidence_question', text: 'Answer one evidence-based pharmacotherapy question in Training.', target: 1, progress: activity.trainingAnswers, link: '/training' },
    { id: 'monitoring', kind: 'monitoring', text: 'Write a monitoring plan with targets and actions for one intervention.', target: 1, progress: activity.monitoringItems, link: '/cases' },
    { id: 'verify_source', kind: 'verify_source', text: 'Verify extracted data from one patient source.', target: 5, progress: activity.verifiedItems, link: '/cases' },
    { id: 'reflection', kind: 'reflection', text: 'Write one case reflection.', target: 1, progress: activity.reflections, link: '/cases' },
    { id: 'followup', kind: 'followup', text: 'Complete one follow-up and record the outcome.', target: 1, progress: activity.followupsUpdated, link: '/tasks' },
  ];
  const start = hash(dateKey) % catalog.length;
  const picked = [0, 1, 2].map((i) => catalog[(start + i * 3) % catalog.length]!);
  picked[2] = target
    ? { id: 'targeted', kind: 'targeted', text: `Targeted practice: ${target.label.toLowerCase()} (repeated gap).`, target: 1, progress: activity.trainingAnswers, link: '/training' }
    : { id: 'dept_topic', kind: 'dept_topic', text: `${dept.label}: practise a question on ${topic.toLowerCase()}.`, target: 1, progress: activity.trainingAnswers, link: '/training' };
  return picked.map((m) => ({ ...m, progress: Math.min(m.progress, m.target) }));
}
