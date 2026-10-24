import { Copy, MessageSquareText, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DRP_CATEGORY_LABEL, INTERVENTION_TYPE_LABEL, INTERVENTION_TYPES, type InterventionType } from '@shared/domain';
import { Tag } from '@/components/Labels';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { EmptyState, SectionTitle, Tabs } from '@/components/ui/misc';
import { Sheet } from '@/components/ui/sheet';
import type { CaseBundle } from '@/lib/bundle';
import { audit, db } from '@/lib/db';
import { nursingCommunication, patientCounseling, pharmacistHandover, physicianRecommendation } from '@/lib/notes';
import type { Drp, Intervention } from '@/lib/types';
import { copyText, nowIso, uid } from '@/lib/utils';
import { ThinkFirst } from './ThinkFirst';

const STATUSES: Intervention['status'][] = ['draft', 'proposed', 'accepted', 'modified', 'rejected', 'implemented'];
const STATUS_TONE: Record<Intervention['status'], 'neutral' | 'blue' | 'green' | 'yellow' | 'red'> = { draft: 'neutral', proposed: 'blue', accepted: 'green', modified: 'yellow', rejected: 'red', implemented: 'green' };

function guessType(d?: Drp): InterventionType {
  if (!d) return 'prescriber_communication';
  switch (d.category) {
    case 'unnecessary_therapy':
    case 'duplicate_therapy':
      return 'stop_therapy';
    case 'needs_additional_therapy':
      return 'start_therapy';
    case 'dose_too_high':
    case 'dose_too_low':
      return 'dose_change';
    case 'monitoring_problem':
      return 'monitoring_recommendation';
    case 'adverse_drug_reaction':
      return 'adr_management';
    case 'non_adherence':
      return 'adherence_intervention';
    case 'ineffective_therapy':
      return 'substitution';
    default:
      return 'safety_intervention';
  }
}

function InterventionForm({ bundle, drpId, onDone }: { bundle: CaseBundle; drpId?: string; onDone: () => void }) {
  const drp = bundle.drps.find((d) => d.id === drpId);
  const draftText = drp?.discussion?.recommendationDraft ?? drp?.suggestedAction ?? '';
  const [f, setF] = useState({
    drpId: drpId ?? '',
    type: guessType(drp),
    recommendation: '',
    goal: '',
    rationale: drp?.discussion?.rationale ?? '',
    alternative: '',
    expectedOutcome: '',
    communicatedTo: '',
    status: 'draft' as Intervention['status'],
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = async () => {
    if (!f.recommendation.trim()) return;
    await db.interventions.add({
      id: uid(),
      caseId: bundle.case.id,
      drpId: f.drpId || undefined,
      type: f.type,
      recommendation: f.recommendation.trim(),
      goal: f.goal || undefined,
      rationale: f.rationale || undefined,
      alternative: f.alternative || undefined,
      expectedOutcome: f.expectedOutcome || undefined,
      communicatedTo: f.communicatedTo || undefined,
      status: f.status,
      origin: f.recommendation.trim() === draftText.trim() && draftText ? 'ai_draft' : 'student',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
    await audit('intervention.add', { caseId: bundle.case.id, detail: f.type });
    onDone();
  };
  return (
    <div className="space-y-3 rounded-2xl border border-brand-200 bg-brand-50/40 p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <Field label="Linked problem / DRP">
          {(id) => (
            <Select id={id} value={f.drpId} onChange={set('drpId')}>
              <option value="">— none —</option>
              {bundle.drps.map((d) => (
                <option key={d.id} value={d.id}>
                  {DRP_CATEGORY_LABEL[d.category]}
                  {d.medication ? ` · ${d.medication}` : ''}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Intervention type">
          {(id) => (
            <Select id={id} value={f.type} onChange={set('type')}>
              {INTERVENTION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {INTERVENTION_TYPE_LABEL[t]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Clinical goal">{(id) => <Input id={id} value={f.goal} onChange={set('goal')} placeholder="e.g. INR back in range without bleeding" />}</Field>
        <Field label="Expected outcome">{(id) => <Input id={id} value={f.expectedOutcome} onChange={set('expectedOutcome')} />}</Field>
        <Field label="Recommended action" className="sm:col-span-2">
          {(id) => (
            <>
              <Textarea id={id} rows={2} value={f.recommendation} onChange={set('recommendation')} placeholder="Write your recommendation first." />
              {draftText && (
                <div className="mt-1 rounded-lg border border-violet-200 bg-violet-50 p-2 text-sm">
                  <Tag kind="ai_suggestion">AI draft</Tag> <span className="ml-1">{draftText}</span>
                  <Button size="sm" variant="ghost" className="ml-1" onClick={() => setF((x) => ({ ...x, recommendation: draftText }))}>
                    Use & edit
                  </Button>
                </div>
              )}
            </>
          )}
        </Field>
        <Field label="Rationale (evidence + patient)" className="sm:col-span-2">{(id) => <Textarea id={id} rows={2} value={f.rationale} onChange={set('rationale')} />}</Field>
        <Field label="Alternative considered">{(id) => <Input id={id} value={f.alternative} onChange={set('alternative')} />}</Field>
        <Field label="Communicated to">{(id) => <Input id={id} value={f.communicatedTo} onChange={set('communicatedTo')} placeholder="e.g. ward registrar" />}</Field>
        <Field label="Status">
          {(id) => (
            <Select id={id} value={f.status} onChange={set('status')}>
              {STATUSES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <div className="flex gap-2">
        <Button onClick={save} disabled={!f.recommendation.trim()}>
          Save intervention
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function CommunicationSheet({ bundle, intervention, onClose }: { bundle: CaseBundle; intervention: Intervention | null; onClose: () => void }) {
  const [tab, setTab] = useState<'physician' | 'nursing' | 'patient' | 'handover'>('physician');
  const [copied, setCopied] = useState(false);
  if (!intervention) return null;
  const drp = bundle.drps.find((d) => d.id === intervention.drpId);
  const text = { physician: physicianRecommendation(bundle, intervention, drp), nursing: nursingCommunication(bundle, intervention), patient: patientCounseling(bundle, intervention), handover: pharmacistHandover(bundle) }[tab];
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title="Communicate the recommendation" description="Problem · evidence · assessment · recommendation · rationale. Clear, respectful, confident language." wide>
      <div className="space-y-3">
        <Tabs
          value={tab}
          onChange={(t) => {
            setTab(t);
            setCopied(false);
          }}
          items={[
            { value: 'physician', label: 'Physician' },
            { value: 'nursing', label: 'Nursing' },
            { value: 'patient', label: 'Patient counselling' },
            { value: 'handover', label: 'Pharmacist handover' },
          ]}
        />
        <pre className="whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-sm text-navy-900">{text}</pre>
        <Button
          variant="secondary"
          onClick={async () => {
            setCopied(await copyText(text));
            await db.interventions.update(intervention.id, { communicatedTo: intervention.communicatedTo || tab, updatedAt: nowIso() });
          }}
        >
          <Copy /> {copied ? 'Copied' : 'Copy text'}
        </Button>
      </div>
    </Sheet>
  );
}

export function ActStage({ bundle }: { bundle: CaseBundle }) {
  const [params] = useSearchParams();
  const preselect = params.get('drp') ?? undefined;
  const [adding, setAdding] = useState(Boolean(preselect));
  const [comm, setComm] = useState<Intervention | null>(null);
  return (
    <div className="space-y-5">
      <ThinkFirst bundle={bundle} stage="act" question="What would you recommend for the highest-priority problem, and why? What alternative did you consider?" hint="Evidence + patient = clinical decision. Consider age, weight, renal and hepatic function, allergies, interactions and goals of care.">
        {() => (
          <Card>
            <CardBody className="text-sm text-slate-700">
              Recommendation drafts appear inside each intervention form when a clinical discussion exists for the linked DRP. Accept, edit or reject them — the plan is yours.
            </CardBody>
          </Card>
        )}
      </ThinkFirst>
      <SectionTitle
        action={
          !adding && (
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus /> Add intervention
            </Button>
          )
        }
      >
        Interventions ({bundle.interventions.length})
      </SectionTitle>
      {adding && <InterventionForm bundle={bundle} drpId={preselect} onDone={() => setAdding(false)} />}
      {bundle.interventions.length === 0 && !adding ? (
        <EmptyState title="No interventions yet">Every intervention links to a problem, evidence, rationale and expected outcome.</EmptyState>
      ) : (
        <ul className="space-y-3">
          {bundle.interventions.map((i) => {
            const drp = bundle.drps.find((d) => d.id === i.drpId);
            return (
              <Card key={i.id} className="p-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone="navy">{INTERVENTION_TYPE_LABEL[i.type]}</Badge>
                  <Badge tone={STATUS_TONE[i.status]}>{i.status}</Badge>
                  {i.origin === 'ai_draft' && <Tag kind="ai_suggestion">From AI draft</Tag>}
                  {i.communicatedTo && <Badge tone="green">Communicated · {i.communicatedTo}</Badge>}
                </div>
                <p className="mt-1 font-semibold text-navy-900">{i.recommendation}</p>
                {drp && <p className="text-xs text-slate-600">For: {DRP_CATEGORY_LABEL[drp.category]}{drp.medication ? ` · ${drp.medication}` : ''}</p>}
                <div className="mt-1 space-y-0.5 text-sm text-slate-700">
                  {i.goal && <p>Goal: {i.goal}</p>}
                  {i.rationale && <p>Rationale: {i.rationale}</p>}
                  {i.alternative && <p>Alternative: {i.alternative}</p>}
                  {i.expectedOutcome && <p>Expected outcome: {i.expectedOutcome}</p>}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Select className="min-h-10 w-auto" value={i.status} onChange={(e) => db.interventions.update(i.id, { status: e.target.value as Intervention['status'], updatedAt: nowIso() })} aria-label="Intervention status">
                    {STATUSES.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </Select>
                  <Input className="min-h-10 min-w-40 flex-1" defaultValue={i.outcome ?? ''} placeholder="Outcome (accepted? what happened?)" onBlur={(e) => db.interventions.update(i.id, { outcome: e.target.value, updatedAt: nowIso() })} aria-label="Intervention outcome" />
                  <Button size="sm" variant="soft" onClick={() => setComm(i)}>
                    <MessageSquareText /> Communicate
                  </Button>
                  <Button size="icon" variant="ghost" className="text-red-700" aria-label="Delete intervention" onClick={() => db.interventions.delete(i.id)}>
                    <Trash2 />
                  </Button>
                </div>
              </Card>
            );
          })}
        </ul>
      )}
      <CommunicationSheet bundle={bundle} intervention={comm} onClose={() => setComm(null)} />
      <Card>
        <CardHeader title="Mental model" />
        <CardBody className="text-sm text-slate-700">Patient → Problem → Evidence → Medication → Assessment → DRP → Plan → Monitoring → Follow-up → Reflection</CardBody>
      </Card>
    </div>
  );
}
