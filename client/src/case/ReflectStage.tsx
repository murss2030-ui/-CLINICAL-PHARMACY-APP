import { useLiveQuery } from 'dexie-react-hooks';
import { CheckCircle2, CircleDashed, Download, Gavel, Presentation as PresentationIcon, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { presentationSchema, type Presentation } from '@shared/ai';
import { COMPETENCY_DOMAINS, COMPETENCY_LABEL, type CompetencyDomain } from '@shared/domain';
import { buildTemplatePresentation, DATA_NOT_AVAILABLE } from '@shared/presentation';
import { AIDraftBanner, AIErrorPanel, AILoading } from '@/components/AIBlocks';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Select, Textarea } from '@/components/ui/form';
import { Progress, Tabs } from '@/components/ui/misc';
import { Sheet } from '@/components/ui/sheet';
import { aiRequest } from '@/lib/api';
import type { CaseBundle } from '@/lib/bundle';
import { caseCompleteness } from '@/lib/completeness';
import { buildCaseContext } from '@/lib/context';
import { audit, db, touchCase } from '@/lib/db';
import { useAiRunner } from '@/lib/hooks';
import { recordGaps } from '@/lib/learning';
import { oneMinuteSummary } from '@/lib/notes';
import type { PresentationRecord } from '@/lib/types';
import { downloadText, formatDateTime, nowIso, uid } from '@/lib/utils';
import { demoOf, language, saveAnalysis } from './caseAi';
import { DialogueSheet } from './DialogueSheet';

export const REFLECTION_QUESTIONS = [
  { key: 'learned', q: 'What did I learn?' },
  { key: 'correct', q: 'What did I identify correctly?' },
  { key: 'difficult', q: 'What was difficult?' },
  { key: 'missed', q: 'What did I miss, and what should I have checked?' },
  { key: 'drp', q: 'Which DRP did I identify?' },
  { key: 'evidence', q: 'What evidence did I review?' },
  { key: 'differently', q: 'What would I do differently?' },
  { key: 'gap', q: 'What knowledge gap did I discover?' },
  { key: 'next', q: 'What should I study next?' },
];

function ReflectionForm({ bundle }: { bundle: CaseBundle }) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [domain, setDomain] = useState<CompetencyDomain>('clinical_reasoning');
  const [saved, setSaved] = useState(false);
  const save = async () => {
    const filled = Object.fromEntries(Object.entries(answers).filter(([, v]) => v.trim()));
    if (!Object.keys(filled).length) return;
    await db.reflections.add({ id: uid(), caseId: bundle.case.id, answers: filled, nextLearningTarget: filled.next, createdAt: nowIso() });
    if (filled.gap) await recordGaps([{ topic: filled.gap.slice(0, 160), domain }], `${bundle.case.code} reflection`);
    await audit('reflection.save', { caseId: bundle.case.id });
    setAnswers({});
    setSaved(true);
  };
  return (
    <Card>
      <CardHeader title="Reflection" subtitle="Saved to your portfolio. Honest reflection drives your next learning target." />
      <CardBody className="space-y-3">
        {bundle.reflections.map((r) => (
          <details key={r.id} className="rounded-xl bg-slate-50 p-3 text-sm">
            <summary className="cursor-pointer font-semibold text-navy-900">Reflection · {formatDateTime(r.createdAt)}</summary>
            <dl className="mt-2 space-y-1">
              {REFLECTION_QUESTIONS.filter((q) => r.answers[q.key]).map((q) => (
                <div key={q.key}>
                  <dt className="font-semibold text-slate-600">{q.q}</dt>
                  <dd className="text-navy-900">{r.answers[q.key]}</dd>
                </div>
              ))}
            </dl>
          </details>
        ))}
        {saved && <p className="rounded-lg bg-med-50 px-3 py-2 text-sm font-semibold text-med-700" role="status">Reflection saved to your portfolio.</p>}
        {REFLECTION_QUESTIONS.map((q) => (
          <Field key={q.key} label={q.q}>
            {(id) => <Textarea id={id} rows={2} value={answers[q.key] ?? ''} onChange={(e) => setAnswers((a) => ({ ...a, [q.key]: e.target.value }))} />}
          </Field>
        ))}
        <Field label="Competency domain of the knowledge gap">
          {(id) => (
            <Select id={id} value={domain} onChange={(e) => setDomain(e.target.value as CompetencyDomain)}>
              {COMPETENCY_DOMAINS.map((d) => (
                <option key={d} value={d}>
                  {COMPETENCY_LABEL[d]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Button onClick={save}>Save reflection</Button>
      </CardBody>
    </Card>
  );
}

function Completeness({ bundle }: { bundle: CaseBundle }) {
  const { percent, items, missing } = caseCompleteness(bundle);
  const [confirm, setConfirm] = useState(false);
  const completed = bundle.case.status === 'completed';
  const complete = async () => {
    await touchCase(bundle.case.id, { status: 'completed', completedAt: nowIso() });
    await audit('case.complete', { caseId: bundle.case.id, detail: `${percent}%` });
    setConfirm(false);
  };
  return (
    <Card>
      <CardHeader title={`CASE COMPLETENESS: ${percent}%`} subtitle={missing.length ? `MISSING: ${missing.join(', ')}` : 'All required elements are documented.'} />
      <CardBody className="space-y-3">
        <Progress value={percent} tone={percent === 100 ? 'med' : 'navy'} />
        <ul className="grid gap-1 sm:grid-cols-2">
          {items.map((i) => (
            <li key={i.key} className="flex items-center gap-2 text-sm">
              {i.done ? <CheckCircle2 className="size-4 text-med-600" /> : <CircleDashed className="size-4 text-red-600" />}
              <span className={i.done ? 'text-navy-900' : 'font-semibold text-red-800'}>{i.label}</span>
              {!i.done && <span className="text-xs text-slate-500">— {i.hint}</span>}
            </li>
          ))}
        </ul>
        <Field label="Case outcome">
          {(id) => <Textarea id={id} rows={2} defaultValue={bundle.case.outcome ?? ''} onBlur={(e) => touchCase(bundle.case.id, { outcome: e.target.value })} placeholder="What happened? Was the recommendation accepted? Clinical outcome?" />}
        </Field>
        {completed ? (
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="green">Case completed</Badge>
            <Button size="sm" variant="ghost" onClick={() => touchCase(bundle.case.id, { status: 'active', completedAt: undefined })}>
              Reopen
            </Button>
          </div>
        ) : (
          <Button variant="med" onClick={() => (missing.length ? setConfirm(true) : complete())}>
            Complete case
          </Button>
        )}
        <Sheet
          open={confirm}
          onOpenChange={setConfirm}
          title={`Complete at ${percent}%?`}
          description="The case is not fully documented. It will be recorded as incomplete in your portfolio."
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirm(false)}>
                Keep working
              </Button>
              <Button variant="med" onClick={complete}>
                Complete anyway
              </Button>
            </>
          }
        >
          <p className="text-sm text-slate-700">Missing: {missing.join(', ')}</p>
        </Sheet>
      </CardBody>
    </Card>
  );
}

export function SlideDeck({ data }: { data: Presentation }) {
  return (
    <ol className="space-y-2">
      {data.slides.map((s, i) => (
        <li key={`${s.heading}-${i}`} className={`rounded-xl border p-3 ${s.dataAvailable ? 'border-slate-200 bg-white' : 'border-red-200 bg-red-50/60'}`}>
          <p className="text-xs font-semibold text-slate-500">Slide {i + 1}</p>
          <p className="font-bold text-navy-900">{s.heading}</p>
          <ul className="mt-1 list-disc pl-5 text-sm">
            {s.bullets.map((b, j) => (
              <li key={j} className={b === DATA_NOT_AVAILABLE ? 'font-semibold text-red-700' : 'text-slate-800'}>
                {b}
              </li>
            ))}
          </ul>
          {s.speakerNotes && <p className="mt-1 text-xs italic text-slate-500">Notes: {s.speakerNotes}</p>}
        </li>
      ))}
    </ol>
  );
}

function presentationText(p: PresentationRecord): string {
  return [p.data.title, ...p.data.slides.map((s, i) => `\n[${i + 1}] ${s.heading}\n${s.bullets.map((b) => `• ${b}`).join('\n')}${s.speakerNotes ? `\nNotes: ${s.speakerNotes}` : ''}`), p.data.learningPoints.length ? `\nLearning points:\n${p.data.learningPoints.map((l) => `• ${l}`).join('\n')}` : ''].join('\n');
}

function Presentations({ bundle }: { bundle: CaseBundle }) {
  const [minutes, setMinutes] = useState<'5' | '10' | '15'>('10');
  const [defense, setDefense] = useState(false);
  const ai = useAiRunner();
  const records = useLiveQuery(() => db.presentations.where('caseId').equals(bundle.case.id).reverse().sortBy('createdAt'), [bundle.case.id], []);
  const latest = records[0];
  const extras = () => ({
    goals: bundle.case.goals ? [bundle.case.goals] : [],
    monitoring: bundle.monitoring.map((m) => `${m.parameter}${m.target ? ` → ${m.target}` : ''}${m.frequency ? ` (${m.frequency})` : ''}`),
    followUps: bundle.followups.map((f) => `${f.dueDate ?? f.window}: ${f.parameter}${f.outcome ? ` — ${f.outcome}` : ''}`),
    outcomes: [bundle.case.outcome, ...bundle.interventions.filter((i) => i.outcome).map((i) => `${i.recommendation}: ${i.outcome}`)].filter((x): x is string => Boolean(x)),
    learningPoints: bundle.reflections.flatMap((r) => [r.answers.learned].filter((x): x is string => Boolean(x))),
  });
  const save = async (data: Presentation, generatedBy: PresentationRecord['generatedBy']) => {
    await db.presentations.add({ id: uid(), caseId: bundle.case.id, minutes: Number(minutes) as 5 | 10 | 15, data, generatedBy, createdAt: nowIso() });
    await audit('presentation.create', { caseId: bundle.case.id, detail: `${minutes} min · ${generatedBy}` });
  };
  const generate = () =>
    ai.run(async () => {
      const { data, meta } = await aiRequest('presentation', { context: buildCaseContext(bundle), minutes: Number(minutes), language: await language() }, presentationSchema, { demo: demoOf(bundle.case) });
      await saveAnalysis(bundle.case.id, 'presentation', data, meta);
      await save(data, meta.provider);
    });
  return (
    <Card>
      <CardHeader title="Case presentation" icon={<PresentationIcon />} subtitle="Missing sections are marked DATA NOT AVAILABLE — never filled in." />
      <CardBody className="space-y-3">
        <Tabs value={minutes} onChange={setMinutes} items={[{ value: '5', label: '5 minutes' }, { value: '10', label: '10 minutes' }, { value: '15', label: '15-minute case conference' }]} />
        <div className="flex flex-wrap gap-2">
          <Button variant="brand" onClick={generate} disabled={ai.loading}>
            <Sparkles /> Generate with AI
          </Button>
          <Button variant="secondary" onClick={() => save(buildTemplatePresentation(buildCaseContext(bundle), Number(minutes) as 5 | 10 | 15, extras()), 'template')}>
            Build from case data (offline)
          </Button>
          {latest && (
            <>
              <Button variant="soft" onClick={() => setDefense(true)}>
                <Gavel /> Defend it
              </Button>
              <Button variant="ghost" onClick={() => downloadText(`${bundle.case.code}-presentation.txt`, presentationText(latest))}>
                <Download /> Export
              </Button>
            </>
          )}
        </div>
        {ai.loading && <AILoading label="Building presentation…" />}
        {ai.error && <AIErrorPanel error={ai.error} onRetry={ai.retry} onManual={() => save(buildTemplatePresentation(buildCaseContext(bundle), Number(minutes) as 5 | 10 | 15, extras()), 'template')} />}
        {latest && (
          <div className="space-y-2">
            <p className="text-sm font-semibold text-navy-900">
              {latest.data.title} · {latest.minutes} min · {formatDateTime(latest.createdAt)}
            </p>
            {latest.generatedBy === 'template' ? <Badge tone="blue">Built from case data</Badge> : <AIDraftBanner provider={latest.generatedBy} />}
            <SlideDeck data={latest.data} />
          </div>
        )}
        <DialogueSheet open={defense} onClose={() => setDefense(false)} bundle={bundle} mode="defense" />
      </CardBody>
    </Card>
  );
}

export function ReflectStage({ bundle }: { bundle: CaseBundle }) {
  return (
    <div className="space-y-5">
      <ReflectionForm bundle={bundle} />
      <Completeness bundle={bundle} />
      <Card>
        <CardHeader title="One-minute clinical summary" />
        <CardBody>
          <pre className="whitespace-pre-wrap text-sm text-navy-900">{oneMinuteSummary(bundle)}</pre>
        </CardBody>
      </Card>
      <Presentations bundle={bundle} />
    </div>
  );
}
