import { Calculator, Check, ClipboardCheck, Plus, ShieldAlert, Sparkles, X } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { DrpAnalysis } from '@shared/ai';
import { DEPARTMENTS } from '@shared/departments';
import { DRP_CATEGORIES, DRP_CATEGORY_LABEL, DRP_STATUS_LABEL, PRIORITIES, type DrpCategory, type DrpStatus, type Priority } from '@shared/domain';
import { AIDraftBanner, AIErrorPanel, AILoading } from '@/components/AIBlocks';
import { SafetyFooter, SeverityBox, Tag } from '@/components/Labels';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { EmptyState, SectionTitle, Tabs } from '@/components/ui/misc';
import { activeMeds, type CaseBundle } from '@/lib/bundle';
import { audit, db, touchCase } from '@/lib/db';
import { useAiRunner } from '@/lib/hooks';
import { sameDrug } from '@/lib/meds';
import { safetyAlerts } from '@/lib/safety';
import { nowIso, pct, uid } from '@/lib/utils';
import { decide, runCaseAction, useLatestAnalysis } from './caseAi';
import { DrpCard } from './DrpCard';
import { ThinkFirst } from './ThinkFirst';
import { Workup } from './Workup';

export function SafetyPanel({ bundle }: { bundle: CaseBundle }) {
  const alerts = safetyAlerts(bundle);
  const [all, setAll] = useState(false);
  const shown = all ? alerts : alerts.filter((a) => a.severity !== 'blue').slice(0, 6);
  return (
    <Card>
      <CardHeader title="Safety screen" subtitle={`${alerts.length} rule-based alert(s) from verified data · red urgent · orange important · yellow review · blue educational`} icon={<ShieldAlert />} />
      <CardBody className="space-y-2">
        {alerts.length === 0 ? (
          <p className="text-sm text-slate-600">No rule-based alerts. This does not mean the regimen is safe — complete your own assessment.</p>
        ) : (
          shown.map((a) => (
            <SeverityBox key={a.id} severity={a.severity} title={a.title}>
              {a.detail}
            </SeverityBox>
          ))
        )}
        {alerts.length > shown.length && (
          <Button size="sm" variant="ghost" onClick={() => setAll(true)}>
            Show all {alerts.length} alerts
          </Button>
        )}
        <SafetyFooter />
      </CardBody>
    </Card>
  );
}

type DrpDraft = { category: DrpCategory; medication: string; condition: string; description: string; evidence: string; priority: Priority; status: DrpStatus; reasoning: string };

function StudentDrpForm({ bundle, onDone, initial, onSaved, aiDerived }: { bundle: CaseBundle; onDone: () => void; initial?: Partial<DrpDraft>; onSaved?: () => Promise<void>; aiDerived?: boolean }) {
  const meds = activeMeds(bundle);
  const [f, setF] = useState<DrpDraft>({ category: 'dose_too_high', medication: '', condition: '', description: '', evidence: '', priority: 'medium', status: 'possible', reasoning: '', ...initial });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = async () => {
    if (!f.description.trim()) return;
    await db.drps.add({
      id: uid(),
      caseId: bundle.case.id,
      category: f.category,
      medication: f.medication || undefined,
      condition: f.condition || undefined,
      description: f.description.trim(),
      patientEvidence: f.evidence.split('\n').map((s) => s.trim()).filter(Boolean),
      priority: f.priority,
      status: f.status,
      origin: aiDerived ? 'ai' : 'student',
      studentReasoning: f.reasoning || undefined,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
    await audit(aiDerived ? 'drp.ai.edited' : 'drp.student', { caseId: bundle.case.id, detail: f.category });
    await onSaved?.();
    onDone();
  };
  return (
    <div className="space-y-3 rounded-2xl border border-brand-200 bg-brand-50/40 p-3">
      <p className="text-sm font-semibold text-navy-900">{aiDerived ? 'Edit the AI suggestion before accepting it' : 'Document a DRP you identified'}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Category">
          {(id) => (
            <Select id={id} value={f.category} onChange={set('category')}>
              {DRP_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {DRP_CATEGORY_LABEL[c]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Medication">
          {(id) => (
            <>
              <Input id={id} list={`${id}-meds`} value={f.medication} onChange={set('medication')} placeholder="Drug (or blank for untreated indication)" />
              <datalist id={`${id}-meds`}>
                {meds.map((m) => (
                  <option key={m.id} value={m.name} />
                ))}
              </datalist>
            </>
          )}
        </Field>
        <Field label="Condition / indication">{(id) => <Input id={id} value={f.condition} onChange={set('condition')} />}</Field>
        <Field label="Priority">
          {(id) => (
            <Select id={id} value={f.priority} onChange={set('priority')}>
              {PRIORITIES.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Problem description" className="sm:col-span-2">{(id) => <Textarea id={id} rows={2} value={f.description} onChange={set('description')} />}</Field>
        <Field label="Patient evidence (one per line)" className="sm:col-span-2" hint="Cite specific data: e.g. “INR 4.2 (10/03)”, “CrCl ≈ 24 mL/min”.">
          {(id) => <Textarea id={id} rows={3} value={f.evidence} onChange={set('evidence')} />}
        </Field>
        <Field label="Status">
          {(id) => (
            <Select id={id} value={f.status} onChange={set('status')}>
              {(['possible', 'needs_data', 'not_supported'] as DrpStatus[]).map((s) => (
                <option key={s} value={s}>
                  {DRP_STATUS_LABEL[s]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Your reasoning (optional)">{(id) => <Input id={id} value={f.reasoning} onChange={set('reasoning')} />}</Field>
      </div>
      <div className="flex gap-2">
        <Button onClick={save} disabled={!f.description.trim()}>
          Add DRP
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function AiDrpSuggestions({ bundle }: { bundle: CaseBundle }) {
  const ai = useAiRunner();
  const analysis = useLatestAnalysis<DrpAnalysis>(bundle.case.id, 'drp-analysis');
  const r = analysis?.result;
  const [editing, setEditing] = useState<number | null>(null);
  const accept = async (i: number) => {
    const d = r!.drps[i]!;
    await db.drps.add({
      id: uid(),
      caseId: bundle.case.id,
      category: d.category,
      medication: d.medication,
      condition: d.condition,
      description: d.description,
      patientEvidence: d.patientEvidence,
      clinicalSignificance: d.clinicalSignificance,
      priority: d.priority,
      evidenceBasis: d.evidenceBasis,
      suggestedAction: d.suggestedAction,
      monitoring: d.monitoring,
      followUp: d.followUp,
      missingData: d.missingData,
      confidence: d.confidence,
      status: d.status,
      origin: analysis!.provider === 'demo' ? 'demo' : 'ai',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
    await decide(analysis!.id, i, 'accepted');
  };
  return (
    <Card>
      <CardHeader
        title="AI potential DRPs"
        subtitle="Never confirmed automatically. Accept to discuss and assess; confirming is your decision."
        icon={<Sparkles />}
        action={
          <Button size="sm" variant="brand" onClick={() => ai.run(() => runCaseAction(bundle, 'drp-analysis'))} disabled={ai.loading}>
            {r ? 'Re-run' : 'Run DRP analysis'}
          </Button>
        }
      />
      <CardBody className="space-y-3">
        {ai.loading && <AILoading label="Assessing indication, effectiveness, safety, dose, interactions…" />}
        {ai.error && <AIErrorPanel error={ai.error} onRetry={ai.retry} onManual={ai.reset} />}
        {r && analysis && (
          <>
            <AIDraftBanner meta={{ provider: analysis.provider, model: analysis.model, warnings: analysis.warnings, cached: false }} />
            {r.drps.length === 0 && <p className="text-sm text-slate-600">The AI did not identify potential DRPs. Your own assessment still applies.</p>}
            <ul className="space-y-2">
              {r.drps.map((d, i) => {
                const dec = analysis.decisions?.[i];
                return (
                  <li key={`${d.category}-${d.medication}-${i}`} className="rounded-xl border border-violet-200 bg-violet-50/40 p-3" data-testid="ai-drp">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Tag kind="ai_suggestion">Potential DRP</Tag>
                      <Badge tone={d.status === 'possible' ? 'yellow' : d.status === 'needs_data' ? 'orange' : 'neutral'}>{DRP_STATUS_LABEL[d.status]}</Badge>
                      <Badge tone={d.priority === 'high' ? 'red' : d.priority === 'medium' ? 'yellow' : 'neutral'}>{d.priority}</Badge>
                      <span className="text-xs text-slate-500">confidence {pct(d.confidence)}</span>
                      {dec && <Badge tone={dec === 'accepted' ? 'green' : 'neutral'}>{dec}</Badge>}
                    </div>
                    <p className="mt-1 font-semibold text-navy-900">
                      {DRP_CATEGORY_LABEL[d.category]}
                      {d.medication ? ` · ${d.medication}` : ''}
                    </p>
                    <p className="text-sm text-slate-700">{d.description}</p>
                    {d.patientEvidence.length > 0 && <p className="mt-1 text-xs text-slate-600">Evidence: {d.patientEvidence.join('; ')}</p>}
                    {d.missingData.length > 0 && <p className="text-xs text-orange-800">Missing: {d.missingData.join('; ')}</p>}
                    {!dec && editing === i && (
                      <div className="mt-2">
                        <StudentDrpForm
                          bundle={bundle}
                          aiDerived
                          initial={{ category: d.category, medication: d.medication ?? '', condition: d.condition ?? '', description: d.description, evidence: d.patientEvidence.join('\n'), priority: d.priority, status: d.status }}
                          onSaved={() => decide(analysis.id, i, 'accepted')}
                          onDone={() => setEditing(null)}
                        />
                      </div>
                    )}
                    {!dec && editing !== i && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Button size="sm" variant="med" onClick={() => accept(i)}>
                          <Check /> Accept for assessment
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

function MedicationReview({ bundle }: { bundle: CaseBundle }) {
  const meds = activeMeds(bundle);
  const alerts = safetyAlerts(bundle);
  const analysis = useLatestAnalysis<DrpAnalysis>(bundle.case.id, 'drp-analysis');
  const reviewed = analysis?.result.medicationsReviewed ?? [];
  if (meds.length === 0) return <EmptyState title="No active medications">Verify the medication list in Collect first.</EmptyState>;
  return (
    <Card>
      <CardHeader title="Medication review" subtitle="Indication · effectiveness · safety · dose · route · frequency · duration · interactions · monitoring · adherence. Only medications needing attention are flagged." />
      <CardBody>
        <ul className="divide-y divide-slate-100">
          {meds.map((m) => {
            const mine = alerts.filter((a) => a.medications.some((n) => sameDrug(n, m.name)) && a.severity !== 'blue');
            const ai = reviewed.find((r) => sameDrug(r.name, m.name));
            return (
              <li key={m.id} className="py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold text-navy-900">
                    {m.name} <span className="font-normal text-slate-600">{[m.dose && `${m.dose}${m.unit ? ` ${m.unit}` : ''}`, m.route, m.frequency].filter(Boolean).join(' ')}</span>
                  </p>
                  {mine.length === 0 && !(ai && ai.concern !== 'none') && <Badge tone="green">No flags</Badge>}
                  {ai && ai.concern !== 'none' && <Tag kind="ai_suggestion">{ai.concern === 'flag' ? 'AI: flag' : 'AI: review'}</Tag>}
                </div>
                <Input
                  className="mt-1 min-h-10"
                  defaultValue={m.indication ?? ''}
                  placeholder="Indication (what is it for in this patient?)"
                  onBlur={(e) => e.target.value !== (m.indication ?? '') && db.medications.update(m.id, { indication: e.target.value })}
                  aria-label={`Indication for ${m.name}`}
                />
                {ai && ai.note && <p className="mt-1 text-xs text-violet-800">AI note: {ai.note}</p>}
                <div className="mt-1.5 space-y-1.5">
                  {mine.map((a) => (
                    <SeverityBox key={a.id} severity={a.severity} title={a.title} />
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      </CardBody>
    </Card>
  );
}

export function AssessStage({ bundle, openTool }: { bundle: CaseBundle; openTool: (t: 'calc' | 'recon') => void }) {
  const [tab, setTab] = useState<'drps' | 'review' | 'workup'>('drps');
  const [adding, setAdding] = useState(false);
  const [params, setParams] = useSearchParams();
  const dept = DEPARTMENTS[bundle.case.department];
  const plan = (drpId: string) => {
    const next = new URLSearchParams(params);
    next.set('stage', 'act');
    next.set('drp', drpId);
    setParams(next);
  };
  return (
    <div className="space-y-5">
      <SafetyPanel bundle={bundle} />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={() => openTool('calc')}>
          <Calculator /> Renal / dose calculators
        </Button>
        <Button size="sm" variant="secondary" onClick={() => openTool('recon')}>
          <ClipboardCheck /> Medication reconciliation
        </Button>
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: 'drps', label: 'Drug-related problems', count: bundle.drps.length },
          { value: 'review', label: 'Medication review' },
          { value: 'workup', label: 'Pharmacotherapy workup' },
        ]}
      />
      {tab === 'workup' && <Workup bundle={bundle} />}
      {tab === 'review' && <MedicationReview bundle={bundle} />}
      {tab === 'drps' && (
        <div className="space-y-4">
          {dept && (
            <div className="rounded-xl bg-navy-50 p-3 text-sm text-navy-900">
              <p className="font-semibold">{dept.label} prompts</p>
              <ul className="mt-1 list-disc pl-5">
                {dept.drpPrompts.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          )}
          <ThinkFirst bundle={bundle} stage="assess" question="Is there a medication-related problem? Name the drug, the problem category and the patient evidence that supports it." hint="Check indication, effectiveness, safety, dose, interactions and monitoring for each active drug.">
            {() => <AiDrpSuggestions bundle={bundle} />}
          </ThinkFirst>
          <SectionTitle
            action={
              !adding && (
                <Button size="sm" onClick={() => setAdding(true)}>
                  <Plus /> Add DRP
                </Button>
              )
            }
          >
            Case DRPs ({bundle.drps.length})
          </SectionTitle>
          {adding && <StudentDrpForm bundle={bundle} onDone={() => setAdding(false)} />}
          {bundle.drps.length === 0 && !adding ? (
            <div className="space-y-2">
              <EmptyState title="No DRPs documented">Add the DRPs you identify, accept AI suggestions you agree with, or document why there is none.</EmptyState>
              <Textarea rows={2} defaultValue={bundle.case.noDrpReasoning ?? ''} onBlur={(e) => touchCase(bundle.case.id, { noDrpReasoning: e.target.value })} placeholder="If you find no DRP, document your reasoning here." aria-label="No DRP reasoning" />
            </div>
          ) : (
            <ul className="space-y-3">
              {bundle.drps.map((d) => (
                <DrpCard key={d.id} drp={d} bundle={bundle} onPlan={plan} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
