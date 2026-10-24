import { useLiveQuery } from 'dexie-react-hooks';
import { BookOpen, CheckCircle2, GraduationCap, Sparkles, Target, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { generatedCaseSchema, lessonSchema, reasoningEvaluationSchema, type AIMeta, type GeneratedCase, type Lesson } from '@shared/ai';
import { DEPARTMENT_LIST, type DepartmentId } from '@shared/departments';
import { COMPETENCY_LABEL, TRAINING_LEVEL_LABEL, TRAINING_LEVELS, type CompetencyDomain, type TrainingLevel } from '@shared/domain';
import { keywordEvaluate, TRAINING_BANK, type TrainingExercise, type TrainingQuestion } from '@shared/training';
import { AIDraftBanner, AIErrorPanel, AILoading } from '@/components/AIBlocks';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Select, Textarea } from '@/components/ui/form';
import { Tabs } from '@/components/ui/misc';
import { Sheet } from '@/components/ui/sheet';
import { EvaluationView } from '@/case/ThinkFirst';
import { aiRequest } from '@/lib/api';
import { db, getSettings } from '@/lib/db';
import { useAiRunner, useOnline, useSettings } from '@/lib/hooks';
import { learningTarget, recordEvaluation, recordGaps } from '@/lib/learning';
import type { StudentAnswer } from '@/lib/types';
import { nowIso, uid } from '@/lib/utils';

interface RunnableExercise {
  id: string;
  title: string;
  scenario: string;
  questions: TrainingQuestion[];
  synthetic: 'built-in' | 'ai';
  /** Who wrote an AI-generated case. */
  meta?: AIMeta;
}

function QuestionBlock({ ex, q, index }: { ex: RunnableExercise; q: TrainingQuestion; index: number }) {
  const [answer, setAnswer] = useState('');
  const [result, setResult] = useState<StudentAnswer | undefined>();
  const [meta, setMeta] = useState<AIMeta | undefined>();
  const [self, setSelf] = useState<{ covered: string[]; missed: string[] } | undefined>();
  const ai = useAiRunner();

  const store = async (extra: Partial<StudentAnswer>) => {
    const row: StudentAnswer = { id: uid(), exerciseId: ex.id, context: 'training', question: q.question, answer: answer.trim(), referencePoints: q.keyPoints, createdAt: nowIso(), ...extra };
    await db.answers.add(row);
    setResult(row);
  };

  const feedback = () =>
    ai.run(async () => {
      const lang = (await getSettings()).language;
      const { data, meta: m } = await aiRequest('teaching', { mode: 'evaluate', scenario: ex.scenario, question: q.question, answer: answer.trim(), referencePoints: q.keyPoints, language: lang }, reasoningEvaluationSchema);
      await recordEvaluation(data, q.question);
      setMeta(m);
      await store({ evaluation: data, evaluatedBy: m.provider });
    });

  const selfCheck = async () => {
    const r = keywordEvaluate(answer, q.keyPoints);
    setSelf(r);
    if (r.missed.length) await recordGaps(r.missed.slice(0, 3).map((m) => ({ topic: m.slice(0, 160), domain: q.domain })), q.question);
    await store({ evaluatedBy: 'self' });
  };

  return (
    <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
      <p className="text-xs font-bold uppercase tracking-wide text-navy-700">
        Question {index + 1} · {COMPETENCY_LABEL[q.domain]}
      </p>
      <p className="font-semibold text-navy-900">{q.question}</p>
      {!result ? (
        <>
          <Textarea rows={4} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Think first. Write your answer (English, Arabic or both)…" aria-label={q.question} />
          <div className="flex flex-wrap gap-2">
            <Button variant="brand" onClick={feedback} disabled={!answer.trim() || ai.loading}>
              <Sparkles /> Get preceptor feedback
            </Button>
            <Button variant="secondary" onClick={selfCheck} disabled={!answer.trim()}>
              Offline self-check
            </Button>
          </div>
          {ai.loading && <AILoading label="Reviewing your reasoning…" />}
          {ai.error && <AIErrorPanel error={ai.error} onRetry={ai.retry} onManual={selfCheck} />}
        </>
      ) : (
        <>
          <div className="rounded-lg bg-brand-50 p-2 text-sm">
            <Badge tone="blue">Your answer</Badge>
            <p className="mt-1 whitespace-pre-line">{result.answer}</p>
          </div>
          {result.evaluation && <EvaluationView ev={result.evaluation} meta={meta} />}
          {self && (
            <div className="space-y-2 rounded-xl border border-slate-200 p-3 text-sm">
              <Badge tone="orange">Offline self-check — keyword comparison, not AI evaluation</Badge>
              <ul className="space-y-1">
                {self.covered.map((c) => (
                  <li key={c} className="flex gap-2">
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-med-600" /> {c}
                  </li>
                ))}
                {self.missed.map((c) => (
                  <li key={c} className="flex gap-2">
                    <XCircle className="mt-0.5 size-4 shrink-0 text-red-600" /> {c}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-slate-500">Key points describe mainstream practice; verify against current references.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ExerciseRunner({ ex, onClose }: { ex: RunnableExercise | null; onClose: () => void }) {
  if (!ex) return null;
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title={ex.title} description={ex.synthetic === 'ai' ? 'AI-generated synthetic case' : 'Built-in synthetic case'} wide>
      <div className="space-y-3">
        {ex.synthetic === 'ai' && <AIDraftBanner meta={ex.meta} />}
        <div className="rounded-xl bg-navy-50 p-3 text-sm text-navy-900">
          <Badge tone="orange">Fictional scenario</Badge>
          <p className="mt-1 whitespace-pre-line">{ex.scenario}</p>
        </div>
        {ex.questions.map((q, i) => (
          <QuestionBlock key={`${ex.id}-${i}`} ex={ex} q={q} index={i} />
        ))}
        <p className="text-xs text-slate-500">Pathway: problem identification → prioritisation → assessment → DRP → plan → monitoring → follow-up → reflection.</p>
      </div>
    </Sheet>
  );
}

function TargetedPractice({ domain, department, onStart }: { domain: CompetencyDomain; department: DepartmentId; onStart: (ex: RunnableExercise) => void }) {
  const ai = useAiRunner();
  const lessonAi = useAiRunner();
  const [lesson, setLesson] = useState<{ data: Lesson; meta: AIMeta }>();
  const focus = COMPETENCY_LABEL[domain];
  const builtIn = TRAINING_BANK.find((e) => e.questions.some((q) => q.domain === domain));
  return (
    <Card className="border-amber-200">
      <CardHeader title={`Targeted practice: ${focus}`} subtitle="Lesson → mini case → question → reassessment" icon={<Target />} />
      <CardBody className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Button
            variant="soft"
            onClick={() =>
              lessonAi.run(async () => {
                const lang = (await getSettings()).language;
                setLesson(await aiRequest('teaching', { mode: 'lesson', focus, department, language: lang }, lessonSchema));
              })
            }
            disabled={lessonAi.loading}
          >
            <BookOpen /> 1 · Targeted lesson
          </Button>
          <Button
            variant="brand"
            onClick={() =>
              ai.run(async () => {
                const lang = (await getSettings()).language;
                const { data, meta } = await aiRequest('teaching', { mode: 'generate_case', level: 'intermediate', focus, department, language: lang }, generatedCaseSchema);
                onStart({ id: `ai-${uid()}`, title: data.title, scenario: data.scenario, questions: data.questions, synthetic: 'ai', meta });
              })
            }
            disabled={ai.loading}
          >
            <Sparkles /> 2 · AI mini case
          </Button>
          {builtIn && (
            <Button variant="secondary" onClick={() => onStart({ ...builtIn, synthetic: 'built-in' })}>
              Built-in case (offline)
            </Button>
          )}
        </div>
        {(lessonAi.loading || ai.loading) && <AILoading label="Preparing practice…" />}
        {lessonAi.error && <AIErrorPanel error={lessonAi.error} onRetry={lessonAi.retry} onManual={lessonAi.reset} />}
        {ai.error && <AIErrorPanel error={ai.error} onRetry={ai.retry} onManual={() => builtIn && onStart({ ...builtIn, synthetic: 'built-in' })} />}
        {lesson && (
          <div className="space-y-2 rounded-xl border border-violet-200 bg-violet-50/40 p-3 text-sm">
            <AIDraftBanner meta={lesson.meta} />
            <p className="font-bold text-navy-900">{lesson.data.topic}</p>
            <ul className="list-disc pl-5">
              {lesson.data.keyConcepts.map((k) => (
                <li key={k}>{k}</li>
              ))}
            </ul>
            <p className="font-semibold">Common pitfalls</p>
            <ul className="list-disc pl-5">
              {lesson.data.commonPitfalls.map((k) => (
                <li key={k}>{k}</li>
              ))}
            </ul>
            <p>
              <strong>Practice question:</strong> {lesson.data.practiceQuestion}
            </p>
            <p className="text-xs text-slate-600">
              <Badge tone="red">Source not verified</Badge> Consult: {lesson.data.referencesToConsult.join('; ')}
            </p>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

export default function TrainingPage() {
  const settings = useSettings();
  const online = useOnline();
  const [params] = useSearchParams();
  const rotation = useLiveQuery(() => db.rotations.filter((r) => r.isCurrent).first(), []);
  const [department, setDepartment] = useState<DepartmentId | ''>('');
  const dept = (department || rotation?.department || settings.defaultDepartment) as DepartmentId;
  const [level, setLevel] = useState<TrainingLevel>('foundations');
  const [running, setRunning] = useState<RunnableExercise | null>(null);
  const gaps = useLiveQuery(() => db.gaps.toArray(), [], []);
  const attempts = useLiveQuery(() => db.answers.where('context').equals('training').toArray(), [], []);
  const target = learningTarget(gaps);
  const focusParam = params.get('focus') as CompetencyDomain | null;
  const focusDomain = focusParam ?? target?.domain;
  const gen = useAiRunner();

  useEffect(() => {
    if (focusParam) window.scrollTo({ top: 0 });
  }, [focusParam]);

  const exercises = TRAINING_BANK.filter((e) => e.level === level);
  const done = (e: TrainingExercise) => attempts.some((a) => a.exerciseId === e.id);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-navy-900">Training</h1>
          <p className="text-sm text-slate-600">Ask → think → analyse → explain → verify → decide → learn. The same reasoning pathway as real cases.</p>
        </div>
        <label className="text-sm font-semibold text-navy-900">
          Department
          <Select className="mt-1 min-h-11" value={dept} onChange={(e) => setDepartment(e.target.value as DepartmentId)}>
            {DEPARTMENT_LIST.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label}
              </option>
            ))}
          </Select>
        </label>
      </div>

      {focusDomain && <TargetedPractice domain={focusDomain} department={dept} onStart={setRunning} />}

      <Tabs value={level} onChange={setLevel} items={TRAINING_LEVELS.map((l) => ({ value: l, label: TRAINING_LEVEL_LABEL[l].split(' · ')[1]!, count: TRAINING_BANK.filter((e) => e.level === l && done(e)).length }))} />
      <p className="text-sm font-semibold text-navy-900">{TRAINING_LEVEL_LABEL[level]}</p>

      <div className="grid gap-3 sm:grid-cols-2">
        {exercises.map((e) => (
          <Card key={e.id} className="flex flex-col">
            <CardBody className="flex flex-1 flex-col gap-2">
              <div className="flex flex-wrap gap-1.5">
                <Badge tone="navy">{e.kind.replace('_', ' ')}</Badge>
                {done(e) && <Badge tone="green">Attempted</Badge>}
              </div>
              <p className="font-bold text-navy-900">{e.title}</p>
              <p className="line-clamp-3 flex-1 text-sm text-slate-600">{e.scenario}</p>
              <Button variant="secondary" onClick={() => setRunning({ ...e, synthetic: 'built-in' })}>
                <GraduationCap /> Start
              </Button>
            </CardBody>
          </Card>
        ))}
        <Card className="border-violet-200">
          <CardBody className="flex h-full flex-col gap-2">
            <Badge tone="purple">AI simulated case</Badge>
            <p className="font-bold text-navy-900">New synthetic case for {TRAINING_LEVEL_LABEL[level].split(' · ')[1]}</p>
            <p className="flex-1 text-sm text-slate-600">Multi-DRP, high-risk medication or incomplete-information cases generated for your department.</p>
            <Button
              variant="brand"
              disabled={gen.loading || !online}
              onClick={() =>
                gen.run(async () => {
                  const lang = (await getSettings()).language;
                  const { data, meta } = await aiRequest('teaching', { mode: 'generate_case', level, department: dept, language: lang }, generatedCaseSchema);
                  const g: GeneratedCase = data;
                  setRunning({ id: `ai-${uid()}`, title: g.title, scenario: g.scenario, questions: g.questions, synthetic: 'ai', meta });
                })
              }
            >
              <Sparkles /> Generate case
            </Button>
            {gen.loading && <AILoading label="Writing a synthetic case…" />}
            {gen.error && <AIErrorPanel error={gen.error} onRetry={gen.retry} onManual={gen.reset} />}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="Recent training answers" subtitle={`${attempts.length} answer(s) · feedback never converts into a numeric competence score`} />
        <CardBody>
          {attempts.length === 0 ? (
            <p className="text-sm text-slate-600">No attempts yet.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {attempts
                .slice(-8)
                .reverse()
                .map((a) => (
                  <li key={a.id} className="flex items-center gap-2">
                    <Badge tone={a.evaluation?.overall === 'on_track' ? 'green' : a.evaluation ? 'yellow' : 'neutral'}>{a.evaluation ? a.evaluation.overall.replace('_', ' ') : 'self-check'}</Badge>
                    <span className="truncate">{a.question}</span>
                  </li>
                ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <ExerciseRunner ex={running} onClose={() => setRunning(null)} />
    </div>
  );
}
