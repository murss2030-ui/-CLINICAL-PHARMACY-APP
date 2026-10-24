import { Check, LineChart, Plus, Trash2, X } from 'lucide-react';
import { useState } from 'react';
import type { MonitoringPlan } from '@shared/ai';
import { MONITORING_CATEGORIES, type MonitoringCategory } from '@shared/domain';
import { AIDraftBanner, AIErrorPanel, AILoading } from '@/components/AIBlocks';
import { Tag } from '@/components/Labels';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/form';
import { EmptyState, SectionTitle } from '@/components/ui/misc';
import type { CaseBundle } from '@/lib/bundle';
import { audit, db } from '@/lib/db';
import { useAiRunner } from '@/lib/hooks';
import { nowIso, uid } from '@/lib/utils';
import { decide, runCaseAction, useLatestAnalysis } from './caseAi';
import { LabTrends } from './LabTrends';
import { ThinkFirst } from './ThinkFirst';

const CAT_LABEL: Record<MonitoringCategory, string> = {
  clinical_response: 'Clinical response',
  safety: 'Safety',
  laboratory: 'Laboratory',
  drug_specific: 'Drug-specific',
  disease_specific: 'Disease-specific',
  patient_reported: 'Patient-reported',
};

type MonitoringDraft = { parameter: string; category: MonitoringCategory; why: string; baseline: string; target: string; timing: string; frequency: string; actionIfAbnormal: string; interventionId: string };

function MonitoringForm({ bundle, onDone, initial, onSaved }: { bundle: CaseBundle; onDone: () => void; initial?: Partial<MonitoringDraft>; onSaved?: () => Promise<void> }) {
  const [f, setF] = useState<MonitoringDraft>({ parameter: '', category: 'laboratory', why: '', baseline: '', target: '', timing: '', frequency: '', actionIfAbnormal: '', interventionId: '', ...initial });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = async () => {
    if (!f.parameter.trim()) return;
    await db.monitoring.add({ id: uid(), caseId: bundle.case.id, ...f, parameter: f.parameter.trim(), interventionId: f.interventionId || undefined, origin: onSaved ? 'ai_draft' : 'student', createdAt: nowIso() });
    await audit(onSaved ? 'monitoring.ai.edited' : 'monitoring.add', { caseId: bundle.case.id, detail: f.parameter });
    await onSaved?.();
    onDone();
  };
  return (
    <div className="grid gap-2 rounded-2xl border border-brand-200 bg-brand-50/40 p-3 sm:grid-cols-2">
      <Field label="Parameter">{(id) => <Input id={id} value={f.parameter} onChange={set('parameter')} placeholder="e.g. Potassium" />}</Field>
      <Field label="Category">
        {(id) => (
          <Select id={id} value={f.category} onChange={set('category')}>
            {MONITORING_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CAT_LABEL[c]}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Why monitor?" className="sm:col-span-2">{(id) => <Input id={id} value={f.why} onChange={set('why')} />}</Field>
      <Field label="Baseline">{(id) => <Input id={id} value={f.baseline} onChange={set('baseline')} />}</Field>
      <Field label="Target / expected">{(id) => <Input id={id} value={f.target} onChange={set('target')} />}</Field>
      <Field label="Timing">{(id) => <Input id={id} value={f.timing} onChange={set('timing')} placeholder="e.g. morning bloods" />}</Field>
      <Field label="Frequency">{(id) => <Input id={id} value={f.frequency} onChange={set('frequency')} placeholder="e.g. daily" />}</Field>
      <Field label="Action if abnormal" className="sm:col-span-2">{(id) => <Input id={id} value={f.actionIfAbnormal} onChange={set('actionIfAbnormal')} />}</Field>
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
      <div className="flex gap-2 sm:col-span-2">
        <Button onClick={save} disabled={!f.parameter.trim()}>
          Save
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function AiMonitoring({ bundle }: { bundle: CaseBundle }) {
  const ai = useAiRunner();
  const analysis = useLatestAnalysis<MonitoringPlan>(bundle.case.id, 'monitoring-plan');
  const r = analysis?.result;
  const [editing, setEditing] = useState<number | null>(null);
  const accept = async (i: number) => {
    const m = r!.items[i]!;
    await db.monitoring.add({ id: uid(), caseId: bundle.case.id, parameter: m.parameter, category: m.category, why: m.why, baseline: m.baseline, target: m.target, timing: m.timing, frequency: m.frequency, actionIfAbnormal: m.actionIfAbnormal, relatedTo: m.relatedTo, origin: analysis!.provider === 'demo' ? 'demo' : 'ai_draft', createdAt: nowIso() });
    await decide(analysis!.id, i, 'accepted');
  };
  return (
    <Card>
      <CardHeader
        title="AI monitoring plan draft"
        action={
          <Button size="sm" variant="brand" onClick={() => ai.run(() => runCaseAction(bundle, 'monitoring-plan'))} disabled={ai.loading}>
            {r ? 'Regenerate' : 'Draft monitoring plan'}
          </Button>
        }
      />
      <CardBody className="space-y-2">
        {ai.loading && <AILoading label="Drafting monitoring plan…" />}
        {ai.error && <AIErrorPanel error={ai.error} onRetry={ai.retry} onManual={ai.reset} />}
        {r && analysis && (
          <>
            <AIDraftBanner meta={{ provider: analysis.provider, model: analysis.model, warnings: analysis.warnings, cached: false }} />
            <ul className="space-y-2">
              {r.items.map((m, i) => {
                const d = analysis.decisions?.[i];
                return (
                  <li key={`${m.parameter}-${i}`} className="rounded-xl border border-violet-200 bg-violet-50/40 p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Tag kind="ai_suggestion" />
                      <span className="font-semibold text-navy-900">{m.parameter}</span>
                      <Badge tone="navy">{CAT_LABEL[m.category]}</Badge>
                      {d && <Badge tone={d === 'accepted' ? 'green' : 'neutral'}>{d}</Badge>}
                    </div>
                    <p className="mt-1 text-slate-700">Why: {m.why}</p>
                    <p className="text-slate-700">
                      Baseline {m.baseline} · target {m.target} · {m.timing} · {m.frequency}
                    </p>
                    <p className="text-slate-700">If abnormal: {m.actionIfAbnormal}</p>
                    {!d && editing === i && (
                      <div className="mt-2">
                        <MonitoringForm
                          bundle={bundle}
                          initial={{ parameter: m.parameter, category: m.category, why: m.why, baseline: m.baseline, target: m.target, timing: m.timing, frequency: m.frequency, actionIfAbnormal: m.actionIfAbnormal }}
                          onSaved={() => decide(analysis.id, i, 'accepted')}
                          onDone={() => setEditing(null)}
                        />
                      </div>
                    )}
                    {!d && editing !== i && (
                      <div className="mt-2 flex gap-2">
                        <Button size="sm" variant="med" onClick={() => accept(i)}>
                          <Check /> Accept
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

export function MonitorStage({ bundle }: { bundle: CaseBundle }) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Trends" icon={<LineChart />} subtitle="Verified laboratory results over time." />
        <CardBody>
          <LabTrends bundle={bundle} />
        </CardBody>
      </Card>
      <ThinkFirst bundle={bundle} stage="monitor" question="What will you monitor for your plan, how often, and what result would make you change course?" hint="Cover effectiveness and safety. Link each parameter to a drug or problem.">
        {() => <AiMonitoring bundle={bundle} />}
      </ThinkFirst>
      <SectionTitle
        action={
          !adding && (
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus /> Add parameter
            </Button>
          )
        }
      >
        Monitoring plan ({bundle.monitoring.length})
      </SectionTitle>
      {adding && <MonitoringForm bundle={bundle} onDone={() => setAdding(false)} />}
      {bundle.monitoring.length === 0 && !adding ? (
        <EmptyState title="No monitoring plan yet">For each intervention: parameter, why, baseline, target, timing, frequency and action if abnormal.</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="w-full min-w-[44rem] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                {['Parameter', 'Why', 'Baseline', 'Target', 'Timing / frequency', 'Action if abnormal', ''].map((h) => (
                  <th key={h} className="px-3 py-2 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {bundle.monitoring.map((m) => (
                <tr key={m.id} className="align-top">
                  <td className="px-3 py-2 font-semibold text-navy-900">
                    {m.parameter}
                    <div className="mt-0.5">{m.origin !== 'student' ? <Tag kind="ai_suggestion">AI · accepted</Tag> : <Tag kind="student">Student</Tag>}</div>
                  </td>
                  <td className="px-3 py-2">{m.why}</td>
                  <td className="px-3 py-2">{m.baseline}</td>
                  <td className="px-3 py-2">{m.target}</td>
                  <td className="px-3 py-2">{[m.timing, m.frequency].filter(Boolean).join(' · ')}</td>
                  <td className="px-3 py-2">{m.actionIfAbnormal}</td>
                  <td className="px-3 py-2">
                    <Button size="icon" variant="ghost" className="text-red-700" aria-label={`Delete ${m.parameter}`} onClick={() => db.monitoring.delete(m.id)}>
                      <Trash2 />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
