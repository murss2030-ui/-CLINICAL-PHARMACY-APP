import { Check, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { FollowUpPlan } from '@shared/ai';
import { FOLLOWUP_STATUS_LABEL, FOLLOWUP_STATUSES, FOLLOWUP_WINDOWS, type FollowUpStatus, type FollowUpWindow } from '@shared/domain';
import { AIDraftBanner, AIErrorPanel, AILoading } from '@/components/AIBlocks';
import { Tag } from '@/components/Labels';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Checkbox, Field, Input, Select } from '@/components/ui/form';
import { EmptyState, SectionTitle } from '@/components/ui/misc';
import type { CaseBundle } from '@/lib/bundle';
import { audit, db } from '@/lib/db';
import { useAiRunner, useSettings } from '@/lib/hooks';
import type { FollowUp } from '@/lib/types';
import { addDays, formatDate, nowIso, todayIso, uid } from '@/lib/utils';
import { decide, runCaseAction, useLatestAnalysis } from './caseAi';
import { ThinkFirst } from './ThinkFirst';

const WINDOW_LABEL: Record<FollowUpWindow, string> = { today: 'Today', next_review: 'Next review', reassessment: 'Reassessment', discharge: 'Discharge', outpatient: 'Outpatient follow-up' };
const WINDOW_DAYS: Record<FollowUpWindow, number | undefined> = { today: 0, next_review: 1, reassessment: 3, discharge: undefined, outpatient: undefined };

/** Creating a follow-up also creates a linked task (unless the trainee opts out). */
export async function createFollowUp(caseId: string, f: Omit<FollowUp, 'id' | 'caseId' | 'createdAt' | 'status'>, owner: string, withTask = true): Promise<string> {
  const id = uid();
  await db.followups.add({ ...f, id, caseId, status: 'pending', createdAt: nowIso() });
  if (withTask) {
    await db.tasks.add({ id: uid(), caseId, title: `Follow up: ${f.parameter}`, priority: f.window === 'today' ? 'high' : 'medium', dueDate: f.dueDate, owner: owner || undefined, status: 'open', followUpId: id, origin: 'followup', createdAt: nowIso() });
  }
  await audit('followup.add', { caseId, detail: f.parameter });
  return id;
}

type FollowUpDraft = { window: FollowUpWindow; dueDate: string; parameter: string; reassess: string; target: string; failureCriteria: string; actionIfAbnormal: string; interventionId: string };

function FollowUpForm({ bundle, onDone, initial, onSaved }: { bundle: CaseBundle; onDone: () => void; initial?: Partial<FollowUpDraft>; onSaved?: () => Promise<void> }) {
  const settings = useSettings();
  const [f, setF] = useState<FollowUpDraft>({ window: 'next_review', dueDate: addDays(1), parameter: '', reassess: '', target: '', failureCriteria: '', actionIfAbnormal: '', interventionId: '', ...initial });
  const [task, setTask] = useState(true);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <div className="grid gap-2 rounded-2xl border border-brand-200 bg-brand-50/40 p-3 sm:grid-cols-2">
      <Field label="When">
        {(id) => (
          <Select
            id={id}
            value={f.window}
            onChange={(e) => {
              const w = e.target.value as FollowUpWindow;
              const d = WINDOW_DAYS[w];
              setF((x) => ({ ...x, window: w, dueDate: d !== undefined ? addDays(d) : x.dueDate }));
            }}
          >
            {FOLLOWUP_WINDOWS.map((w) => (
              <option key={w} value={w}>
                {WINDOW_LABEL[w]}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Follow-up date">{(id) => <Input id={id} type="date" value={f.dueDate} onChange={set('dueDate')} />}</Field>
      <Field label="Parameter / problem" className="sm:col-span-2">{(id) => <Input id={id} value={f.parameter} onChange={set('parameter')} placeholder="e.g. INR and bleeding signs" />}</Field>
      <Field label="What to reassess">{(id) => <Input id={id} value={f.reassess} onChange={set('reassess')} />}</Field>
      <Field label="Target / expected result">{(id) => <Input id={id} value={f.target} onChange={set('target')} />}</Field>
      <Field label="Failure criteria">{(id) => <Input id={id} value={f.failureCriteria} onChange={set('failureCriteria')} />}</Field>
      <Field label="Action if abnormal">{(id) => <Input id={id} value={f.actionIfAbnormal} onChange={set('actionIfAbnormal')} />}</Field>
      <Field label="Linked intervention" className="sm:col-span-2">
        {(id) => (
          <Select id={id} value={f.interventionId} onChange={set('interventionId')}>
            <option value="">— none —</option>
            {bundle.interventions.map((i) => (
              <option key={i.id} value={i.id}>
                {i.recommendation.slice(0, 80)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Checkbox className="sm:col-span-2" label="Also create a task in My Clinical Tasks" checked={task} onChange={setTask} />
      <div className="flex gap-2 sm:col-span-2">
        <Button
          disabled={!f.parameter.trim()}
          onClick={async () => {
            await createFollowUp(bundle.case.id, { ...f, parameter: f.parameter.trim(), interventionId: f.interventionId || undefined, origin: onSaved ? 'ai_draft' : 'student' }, settings.ownerName, task);
            await onSaved?.();
            onDone();
          }}
        >
          Save follow-up
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function AiFollowUp({ bundle }: { bundle: CaseBundle }) {
  const ai = useAiRunner();
  const settings = useSettings();
  const analysis = useLatestAnalysis<FollowUpPlan>(bundle.case.id, 'follow-up');
  const r = analysis?.result;
  const [editing, setEditing] = useState<number | null>(null);
  const accept = async (i: number) => {
    const x = r!.items[i]!;
    const days = x.dueInDays ?? WINDOW_DAYS[x.window];
    await createFollowUp(
      bundle.case.id,
      { window: x.window, dueDate: days !== undefined ? addDays(days) : undefined, parameter: x.problem, reassess: x.reassess, target: x.expected, failureCriteria: x.failureCriteria, actionIfAbnormal: x.nextAction, origin: analysis!.provider === 'demo' ? 'demo' : 'ai_draft' },
      settings.ownerName,
    );
    await decide(analysis!.id, i, 'accepted');
  };
  return (
    <Card>
      <CardHeader
        title="AI follow-up plan draft"
        action={
          <Button size="sm" variant="brand" onClick={() => ai.run(() => runCaseAction(bundle, 'follow-up'))} disabled={ai.loading}>
            {r ? 'Regenerate' : 'Draft follow-up plan'}
          </Button>
        }
      />
      <CardBody className="space-y-2">
        {ai.loading && <AILoading label="Drafting follow-up plan…" />}
        {ai.error && <AIErrorPanel error={ai.error} onRetry={ai.retry} onManual={ai.reset} />}
        {r && analysis && (
          <>
            <AIDraftBanner meta={{ provider: analysis.provider, model: analysis.model, warnings: analysis.warnings, cached: false }} />
            <ul className="space-y-2">
              {r.items.map((x, i) => {
                const d = analysis.decisions?.[i];
                return (
                  <li key={`${x.problem}-${i}`} className="rounded-xl border border-violet-200 bg-violet-50/40 p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Tag kind="ai_suggestion" />
                      <Badge tone="navy">{WINDOW_LABEL[x.window]}</Badge>
                      <span className="font-semibold text-navy-900">{x.problem}</span>
                      {d && <Badge tone={d === 'accepted' ? 'green' : 'neutral'}>{d}</Badge>}
                    </div>
                    <p className="mt-1 text-slate-700">Reassess: {x.reassess}</p>
                    <p className="text-slate-700">
                      Expected: {x.expected} · failure: {x.failureCriteria}
                    </p>
                    <p className="text-slate-700">Next action: {x.nextAction}</p>
                    {!d && editing === i && (
                      <div className="mt-2">
                        <FollowUpForm
                          bundle={bundle}
                          initial={{
                            window: x.window,
                            dueDate: addDays(x.dueInDays ?? WINDOW_DAYS[x.window] ?? 1),
                            parameter: x.problem,
                            reassess: x.reassess,
                            target: x.expected,
                            failureCriteria: x.failureCriteria,
                            actionIfAbnormal: x.nextAction,
                          }}
                          onSaved={() => decide(analysis.id, i, 'accepted')}
                          onDone={() => setEditing(null)}
                        />
                      </div>
                    )}
                    {!d && editing !== i && (
                      <div className="mt-2 flex gap-2">
                        <Button size="sm" variant="med" onClick={() => accept(i)}>
                          <Check /> Accept & schedule
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(i)}>
                          Edit
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => decide(analysis.id, i, 'dismissed')}>
                          <X /> Dismiss
                        </Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </CardBody>
    </Card>
  );
}

export function FollowUpRow({ f, onNewDrp }: { f: FollowUp; onNewDrp?: () => void }) {
  const overdue = f.status === 'pending' && f.dueDate && f.dueDate < todayIso();
  return (
    <li className="rounded-xl border border-slate-200 bg-white p-3" data-testid="followup">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone={f.status === 'pending' ? (overdue ? 'red' : 'yellow') : f.status === 'worsened' || f.status === 'new_drp' ? 'red' : 'green'}>{FOLLOWUP_STATUS_LABEL[f.status]}</Badge>
        <span className="text-xs font-semibold text-slate-600">
          {f.dueDate ? formatDate(f.dueDate) : WINDOW_LABEL[f.window]}
          {overdue ? ' · overdue' : ''}
        </span>
        {f.origin !== 'student' && <Tag kind="ai_suggestion">AI · accepted</Tag>}
      </div>
      <p className="mt-1 font-semibold text-navy-900">{f.parameter}</p>
      <p className="text-sm text-slate-700">{[f.reassess && `Reassess: ${f.reassess}`, f.target && `Target: ${f.target}`, f.failureCriteria && `Failure: ${f.failureCriteria}`, f.actionIfAbnormal && `If abnormal: ${f.actionIfAbnormal}`].filter(Boolean).join(' · ')}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Select
          className="min-h-10 w-auto"
          value={f.status}
          onChange={async (e) => {
            const status = e.target.value as FollowUpStatus;
            await db.followups.update(f.id, { status, completedAt: status === 'pending' ? undefined : nowIso() });
            if (status !== 'pending') await db.tasks.where('caseId').equals(f.caseId).filter((t) => t.followUpId === f.id && t.status !== 'done').modify({ status: 'done', completedAt: nowIso() });
            await audit('followup.status', { caseId: f.caseId, detail: `${f.parameter} → ${status}` });
          }}
          aria-label="Follow-up status"
        >
          {FOLLOWUP_STATUSES.map((s) => (
            <option key={s} value={s}>
              {FOLLOWUP_STATUS_LABEL[s]}
            </option>
          ))}
        </Select>
        <Input className="min-h-10 min-w-40 flex-1" defaultValue={f.outcome ?? ''} placeholder="Outcome" onBlur={(e) => db.followups.update(f.id, { outcome: e.target.value })} aria-label="Follow-up outcome" />
        {f.status === 'new_drp' && onNewDrp && (
          <Button size="sm" variant="danger-soft" onClick={onNewDrp}>
            Document new DRP
          </Button>
        )}
      </div>
    </li>
  );
}

export function FollowUpStage({ bundle }: { bundle: CaseBundle }) {
  const [adding, setAdding] = useState(false);
  const [params, setParams] = useSearchParams();
  const toAssess = () => {
    const next = new URLSearchParams(params);
    next.set('stage', 'assess');
    setParams(next);
  };
  return (
    <div className="space-y-5">
      <ThinkFirst bundle={bundle} stage="followup" question="When will you reassess, what result do you expect, and what result would mean the plan is failing?" hint="Today → next review → reassessment → discharge → outpatient.">
        {() => <AiFollowUp bundle={bundle} />}
      </ThinkFirst>
      <SectionTitle
        action={
          !adding && (
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus /> Add follow-up
            </Button>
          )
        }
      >
        Follow-up timeline ({bundle.followups.length})
      </SectionTitle>
      {adding && <FollowUpForm bundle={bundle} onDone={() => setAdding(false)} />}
      {bundle.followups.length === 0 && !adding ? (
        <EmptyState title="No follow-up scheduled">Each follow-up has a date, parameter, target, failure criteria and action — and creates a task.</EmptyState>
      ) : (
        FOLLOWUP_WINDOWS.map((w) => {
          const rows = bundle.followups.filter((f) => f.window === w);
          if (!rows.length) return null;
          return (
            <div key={w}>
              <p className="mb-1.5 text-xs font-bold uppercase tracking-wider text-slate-500">{WINDOW_LABEL[w]}</p>
              <ul className="space-y-2">
                {rows.map((f) => (
                  <FollowUpRow key={f.id} f={f} onNewDrp={toAssess} />
                ))}
              </ul>
            </div>
          );
        })
      )}
    </div>
  );
}
