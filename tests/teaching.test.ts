import { describe, expect, it } from 'vitest';
import { buildTemplatePresentation, DATA_NOT_AVAILABLE } from '@shared/presentation';
import { keywordEvaluate, TRAINING_BANK } from '@shared/training';
import { caseContextSchema, presentationSchema } from '@shared/ai';
import { dailyMissions, learningTarget, type Activity } from '@/lib/learning';
import type { KnowledgeGap } from '@/lib/types';

const none: Activity = { reconDecisions: 0, studentDrps: 0, trainingAnswers: 0, reflections: 0, monitoringItems: 0, verifiedItems: 0, followupsUpdated: 0 };

describe('teaching engine', () => {
  it('offline self-check finds covered and missed key points', () => {
    const r = keywordEvaluate('Hold simvastatin because clarithromycin inhibits CYP3A4; check CK.', ['Clarithromycin strongly inhibits CYP3A4', 'Myopathy or rhabdomyolysis risk', 'Check CK and renal function']);
    expect(r.covered).toContain('Clarithromycin strongly inhibits CYP3A4');
    expect(r.missed).toContain('Myopathy or rhabdomyolysis risk');
  });
  it('built-in training bank covers all five levels with key points', () => {
    for (const level of ['foundations', 'developing', 'intermediate', 'advanced', 'complex']) expect(TRAINING_BANK.some((e) => e.level === level)).toBe(true);
    for (const e of TRAINING_BANK) for (const q of e.questions) expect(q.keyPoints.length).toBeGreaterThan(0);
  });
  it('missions are deterministic per day, capped and earned only by activity', () => {
    const a = dailyMissions('2026-10-23', 'oncology', none);
    expect(a).toHaveLength(3);
    expect(dailyMissions('2026-10-23', 'oncology', none)).toEqual(a);
    expect(a.every((m) => m.progress === 0)).toBe(true);
    const busy = dailyMissions('2026-10-23', 'oncology', { ...none, studentDrps: 9, reconDecisions: 9, trainingAnswers: 9, reflections: 9, monitoringItems: 9, verifiedItems: 99, followupsUpdated: 9 });
    expect(busy.every((m) => m.progress === m.target)).toBe(true);
  });
  it('builds a personal learning target only from repeated gaps', () => {
    const gap = (domain: KnowledgeGap['domain'], count: number): KnowledgeGap => ({ id: `${domain}${count}`, topic: 'renal dose alternatives', domain, count, lastSeen: '', examples: [], status: 'open' });
    expect(learningTarget([gap('renal_dosing', 1)])).toBeUndefined();
    expect(learningTarget([gap('renal_dosing', 2), gap('monitoring', 1)])?.domain).toBe('renal_dosing');
    expect(dailyMissions('2026-10-23', 'icu', none, learningTarget([gap('renal_dosing', 3)]))[2]!.kind).toBe('targeted');
  });
});

describe('presentation builder', () => {
  it('marks every missing section as DATA NOT AVAILABLE and invents nothing', () => {
    const p = buildTemplatePresentation(caseContextSchema.parse({ caseCode: 'CASE-0009', department: 'cardiology' }), 15);
    const missing = p.slides.filter((s) => !s.dataAvailable);
    expect(missing.length).toBeGreaterThan(15);
    for (const s of missing) expect(s.bullets).toEqual([DATA_NOT_AVAILABLE]);
  });
  it('always satisfies the presentation contract (bullet limits)', () => {
    const many = caseContextSchema.parse({ caseCode: 'CASE-0011', department: 'internal_medicine', medications: Array.from({ length: 25 }, (_, i) => ({ name: `Drug ${i}`, list: i % 2 ? 'home' : 'current' })), labs: Array.from({ length: 30 }, (_, i) => ({ name: `Lab ${i}`, value: String(i), flag: 'high' })) });
    for (const m of [5, 10, 15] as const) expect(presentationSchema.safeParse(buildTemplatePresentation(many, m)).success).toBe(true);
  });
  it('uses case data when present and merges sections for short talks', () => {
    const ctx = caseContextSchema.parse({ caseCode: 'CASE-0010', department: 'cardiology', demographics: { age: 74, sex: 'Male' }, medications: [{ name: 'Digoxin', dose: '0.25 mg', verified: true }] });
    const p5 = buildTemplatePresentation(ctx, 5);
    expect(p5.slides.length).toBeLessThanOrEqual(6);
    expect(JSON.stringify(p5)).toContain('Digoxin 0.25 mg');
    expect(JSON.stringify(p5)).toContain('74-year-old');
  });
});
