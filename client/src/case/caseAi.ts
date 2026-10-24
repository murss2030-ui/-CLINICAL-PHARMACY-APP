// Case-level AI actions. Each result is stored as an AIAnalysis record
// (auditable, available offline afterwards) and shown as suggestions the
// trainee must accept, edit or dismiss.
import { useLiveQuery } from 'dexie-react-hooks';
import {
  caseAnalysisSchema,
  followUpPlanSchema,
  monitoringPlanSchema,
  drpAnalysisSchema,
  timelineSchema,
  type AIMeta,
} from '@shared/ai';
import type { z } from 'zod';
import { aiRequest, type DemoTarget } from '@/lib/api';
import type { CaseBundle } from '@/lib/bundle';
import { buildCaseContext } from '@/lib/context';
import { audit, db, getSettings } from '@/lib/db';
import type { AIAnalysisRecord, CaseRecord } from '@/lib/types';
import { nowIso, uid } from '@/lib/utils';

export const CASE_ACTIONS = {
  'analyze-case': caseAnalysisSchema,
  'drp-analysis': drpAnalysisSchema,
  'monitoring-plan': monitoringPlanSchema,
  'follow-up': followUpPlanSchema,
} as const;
export type CaseAction = keyof typeof CASE_ACTIONS;

export function demoOf(c: CaseRecord): DemoTarget | undefined {
  return c.isDemo && c.demoKey ? { caseKey: c.demoKey } : undefined;
}

export async function language(): Promise<'en' | 'ar'> {
  return (await getSettings()).language;
}

export async function saveAnalysis(caseId: string, action: string, result: unknown, meta: AIMeta): Promise<AIAnalysisRecord> {
  const rec: AIAnalysisRecord = { id: uid(), caseId, action, provider: meta.provider, model: meta.model, result, warnings: meta.warnings, verificationState: 'unreviewed', decisions: {}, createdAt: nowIso() };
  await db.aiAnalyses.add(rec);
  await audit(`ai.${action}`, { caseId, actor: 'ai', detail: `${meta.provider}/${meta.model}` });
  return rec;
}

export async function runCaseAction<A extends CaseAction>(b: CaseBundle, action: A): Promise<z.infer<(typeof CASE_ACTIONS)[A]>> {
  const schema: z.ZodTypeAny = CASE_ACTIONS[action];
  const { data, meta } = await aiRequest(action, { context: buildCaseContext(b), language: await language() }, schema, { demo: demoOf(b.case) });
  await saveAnalysis(b.case.id, action, data, meta);
  return data as z.infer<(typeof CASE_ACTIONS)[A]>;
}

/** Timeline from structured data plus source transcriptions; events are stored and labelled as AI-built. */
export async function runTimeline(b: CaseBundle): Promise<number> {
  const sourceTexts = b.sources
    .map((s) => ({ label: `${s.code} ${s.label ?? s.type}`, date: s.date, text: (s.pages?.map((p) => p.transcription ?? '').join('\n') || s.text || '').slice(0, 20_000) }))
    .filter((s) => s.text.trim())
    .slice(0, 20);
  const { data, meta } = await aiRequest('timeline', { context: buildCaseContext(b), sourceTexts, language: await language() }, timelineSchema, { demo: demoOf(b.case) });
  await saveAnalysis(b.case.id, 'timeline', data, meta);
  const origin = meta.provider === 'demo' ? 'demo' : 'ai';
  await db.transaction('rw', db.timeline, async () => {
    const old = await db.timeline.where('caseId').equals(b.case.id).filter((t) => t.origin !== 'manual').primaryKeys();
    await db.timeline.bulkDelete(old);
    await db.timeline.bulkAdd(
      data.events.map((e) => ({ id: uid(), caseId: b.case.id, date: e.date, dayLabel: e.dayLabel, kind: e.kind, label: e.label, detail: e.detail, sourceLabel: e.sourceLabel, origin, createdAt: nowIso() })),
    );
  });
  return data.events.length;
}

/** Latest stored analysis of a given action for a case (works offline). */
export function useLatestAnalysis<T>(caseId: string, action: string): (AIAnalysisRecord & { result: T }) | undefined {
  return useLiveQuery(
    async () => {
      const rows = await db.aiAnalyses.where('caseId').equals(caseId).filter((a) => a.action === action).toArray();
      return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] as (AIAnalysisRecord & { result: T }) | undefined;
    },
    [caseId, action],
  );
}

export async function decide(analysisId: string, index: number, decision: 'accepted' | 'dismissed') {
  const rec = await db.aiAnalyses.get(analysisId);
  if (!rec) return;
  await db.aiAnalyses.update(analysisId, { decisions: { ...(rec.decisions ?? {}), [index]: decision }, verificationState: 'reviewed' });
  await audit(`ai.suggestion.${decision}`, { caseId: rec.caseId, detail: `${rec.action} #${index}` });
}
