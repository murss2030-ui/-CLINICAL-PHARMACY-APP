// THINK-FIRST ENGINE: question → trainee answer → preceptor feedback →
// correct / missed elements → explanation → next-time strategy.
// In TEACH mode AI suggestions stay locked until the trainee commits an answer.
import { useLiveQuery } from 'dexie-react-hooks';
import { Brain, CheckCircle2, Lock, MessageSquareQuote, XCircle } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { reasoningEvaluationSchema, type AIMeta, type ReasoningEvaluation } from '@shared/ai';
import { AIDraftBanner, AIErrorPanel, AILoading } from '@/components/AIBlocks';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/form';
import { aiRequest } from '@/lib/api';
import type { CaseBundle } from '@/lib/bundle';
import { buildCaseContext } from '@/lib/context';
import { audit, db } from '@/lib/db';
import { useAiRunner } from '@/lib/hooks';
import { recordEvaluation } from '@/lib/learning';
import { nowIso, uid } from '@/lib/utils';
import { demoOf, language } from './caseAi';

export function EvaluationView({ ev, meta, provider }: { ev: ReasoningEvaluation; meta?: Pick<AIMeta, 'provider' | 'model' | 'warnings' | 'cached'>; provider?: string }) {
  const tone = ev.overall === 'on_track' ? 'green' : ev.overall === 'partially' ? 'yellow' : 'red';
  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-3">
      <AIDraftBanner meta={meta} provider={provider} />
      <div className="flex items-center gap-2">
        <span className="text-sm font-bold text-navy-900">Preceptor feedback</span>
        <Badge tone={tone}>{ev.overall === 'on_track' ? 'On track' : ev.overall === 'partially' ? 'Partially there' : 'Needs work'}</Badge>
      </div>
      {ev.correctElements.length > 0 && (
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-med-700">What you got right</p>
          <ul className="mt-1 space-y-1 text-sm">
            {ev.correctElements.map((c) => (
              <li key={c} className="flex gap-2">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-med-600" /> {c}
              </li>
            ))}
          </ul>
        </div>
      )}
      {(ev.missedElements.length > 0 || ev.inaccuracies.length > 0) && (
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-red-700">Missed or inaccurate</p>
          <ul className="mt-1 space-y-1 text-sm">
            {[...ev.missedElements, ...ev.inaccuracies].map((c) => (
              <li key={c} className="flex gap-2">
                <XCircle className="mt-0.5 size-4 shrink-0 text-red-600" /> {c}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="text-sm">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Explanation</p>
        <p className="mt-1 whitespace-pre-line text-navy-900">{ev.explanation}</p>
      </div>
      <div className="rounded-lg bg-navy-50 p-2.5 text-sm">
        <p className="text-xs font-bold uppercase tracking-wide text-navy-700">Next-time strategy</p>
        <p className="mt-0.5 text-navy-900">{ev.nextTimeStrategy}</p>
      </div>
      {ev.followUpQuestion && (
        <p className="flex gap-2 text-sm text-navy-900">
          <MessageSquareQuote className="mt-0.5 size-4 shrink-0" /> {ev.followUpQuestion}
        </p>
      )}
    </div>
  );
}

export function ThinkFirst({
  bundle,
  stage,
  question,
  hint,
  children,
}: {
  bundle: CaseBundle;
  stage: string;
  question: string;
  hint?: string;
  children: (unlocked: boolean) => ReactNode;
}) {
  const caseId = bundle.case.id;
  const answers = useLiveQuery(() => db.answers.where('caseId').equals(caseId).filter((a) => a.stage === stage && a.question === question).sortBy('createdAt'), [caseId, stage, question], []);
  const latest = answers[answers.length - 1];
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const [meta, setMeta] = useState<AIMeta | undefined>();
  const ai = useAiRunner();
  const teach = bundle.case.mode === 'teach';
  const unlocked = !teach || Boolean(latest);
  const [open, setOpen] = useState(teach);

  const commit = async () => {
    if (!draft.trim()) return;
    await db.answers.add({ id: uid(), caseId, context: 'case', stage, question, answer: draft.trim(), createdAt: nowIso() });
    await audit('student.answer', { caseId, detail: `${stage}: ${question}` });
    setDraft('');
    setEditing(false);
  };

  const evaluate = () =>
    ai.run(async () => {
      if (!latest) return;
      const { data, meta: m } = await aiRequest(
        'teaching',
        { mode: 'evaluate', context: buildCaseContext(bundle), stage, question, answer: latest.answer, language: await language() },
        reasoningEvaluationSchema,
        { demo: demoOf(bundle.case) },
      );
      await db.answers.update(latest.id, { evaluation: data, evaluatedBy: m.provider });
      await recordEvaluation(data, question);
      setMeta(m);
    });

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border-2 border-navy-200 bg-white p-4">
        <div className="flex items-start gap-3">
          <Brain className="mt-0.5 size-6 shrink-0 text-navy-700" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold uppercase tracking-wider text-navy-700">{teach ? 'Think first' : 'Your reasoning (recommended)'}</p>
            <p className="mt-0.5 font-semibold text-navy-900">{question}</p>
            {hint && <p className="mt-1 text-sm text-slate-600">Hint: {hint}</p>}
          </div>
          {!teach && !latest && (
            <Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)}>
              {open ? 'Hide' : 'Answer'}
            </Button>
          )}
        </div>

        {latest && !editing ? (
          <div className="mt-3 space-y-2">
            <div className="rounded-xl bg-brand-50 p-3 text-sm">
              <Badge tone="blue">Your answer</Badge>
              <p className="mt-1 whitespace-pre-line text-navy-900">{latest.answer}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {!latest.evaluation && (
                <Button size="sm" variant="brand" onClick={evaluate} disabled={ai.loading}>
                  Get preceptor feedback
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setDraft(latest.answer);
                  setEditing(true);
                }}
              >
                Revise answer
              </Button>
            </div>
            {ai.loading && <AILoading label="Preceptor is reviewing your reasoning…" />}
            {ai.error && <AIErrorPanel error={ai.error} onRetry={ai.retry} onManual={ai.reset} />}
            {latest.evaluation && <EvaluationView ev={latest.evaluation} meta={meta} provider={latest.evaluatedBy} />}
          </div>
        ) : (
          (open || editing) && (
            <div className="mt-3 space-y-2">
              <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={4} placeholder="Write your reasoning in English, Arabic or both…" aria-label={question} />
              <div className="flex gap-2">
                <Button size="sm" onClick={commit} disabled={!draft.trim()}>
                  Commit my answer
                </Button>
                {editing && (
                  <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                    Cancel
                  </Button>
                )}
              </div>
            </div>
          )
        )}
      </div>
      {unlocked ? (
        children(true)
      ) : (
        <div className="flex items-center gap-3 rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-4 text-sm text-slate-600">
          <Lock className="size-5 shrink-0" aria-hidden />
          AI suggestions unlock after you commit your own answer (Teach mode). Switch to Assist mode to see suggestions immediately.
        </div>
      )}
    </div>
  );
}
