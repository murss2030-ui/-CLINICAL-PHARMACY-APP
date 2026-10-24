import { ArrowDown, ArrowUp, CalendarClock, Check, ListPlus, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { CaseAnalysis } from '@shared/ai';
import { PRIORITIES, type Priority } from '@shared/domain';
import { AIDraftBanner, AIErrorPanel, AILoading } from '@/components/AIBlocks';
import { ProvenanceTag, SourceLine, Tag } from '@/components/Labels';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Input, Select, Textarea } from '@/components/ui/form';
import { EmptyState, SectionTitle } from '@/components/ui/misc';
import { activeMeds, profileValue, type CaseBundle } from '@/lib/bundle';
import { audit, db } from '@/lib/db';
import { useAiRunner } from '@/lib/hooks';
import type { ClinicalProblem, Provenance } from '@/lib/types';
import { formatDate, nowIso, uid } from '@/lib/utils';
import { decide, runCaseAction, runTimeline, useLatestAnalysis } from './caseAi';
import { itemTitle } from './collect/VerificationQueue';
import { ThinkFirst } from './ThinkFirst';

const notRejected = (x: { prov: Provenance }) => x.prov.verification !== 'rejected';

function Row({ label, children, missing }: { label: string; children?: ReactNode; missing?: boolean }) {
  return (
    <div className="grid gap-1 border-b border-slate-100 py-2.5 sm:grid-cols-[11rem_1fr]">
      <p className="text-sm font-semibold text-slate-600">{label}</p>
      <div className="min-w-0 text-sm text-navy-900">{missing ? <Tag kind="missing" /> : children}</div>
    </div>
  );
}

export function ClinicalSnapshot({ bundle }: { bundle: CaseBundle }) {
  const c = bundle.case;
  const pending = bundle.extracted.filter((e) => e.status === 'pending');
  const profile = (key: Parameters<typeof profileValue>[1]) => bundle.profiles.filter((p) => p.key === key && notRejected(p));
  const meds = activeMeds(bundle);
  const labs = bundle.labs.filter(notRejected);
  const abnormal = labs.filter((l) => l.flag && !/normal|unknown/i.test(l.flag));
  const demoProv = Object.values(c.demographicsProv ?? {})[0];

  const TextRows = ({ k }: { k: Parameters<typeof profileValue>[1] }) => (
    <div className="space-y-1.5">
      {profile(k).map((p) => (
        <div key={p.id}>
          <p className="whitespace-pre-line">{p.value}</p>
          <div className="mt-0.5 flex flex-wrap items-center gap-2">
            <ProvenanceTag prov={p.prov} />
            <SourceLine prov={p.prov} />
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <Card>
      <CardHeader title="Clinical snapshot" subtitle="Verified facts with their source. Unverified documents and AI inferences are shown separately." />
      <CardBody>
        <div className="mb-2 flex flex-wrap gap-1.5">
          <Tag kind="patient_fact" />
          <Tag kind="verified" />
          <Tag kind="requires_verification" />
          <Tag kind="ai_inference" />
          <Tag kind="missing" />
        </div>
        <Row label="Demographics" missing={c.age === undefined && !c.sex}>
          <p>{[c.age !== undefined && `${c.age} years`, c.sex, c.weightKg && `${c.weightKg} kg`, c.heightCm && `${c.heightCm} cm`].filter(Boolean).join(' · ') || '—'}</p>
          {demoProv && <ProvenanceTag prov={demoProv} />}
        </Row>
        <Row label="Chief complaint" missing={profile('chief_complaint').length === 0}>
          <TextRows k="chief_complaint" />
        </Row>
        <Row label="HPI" missing={profile('hpi').length === 0}>
          <TextRows k="hpi" />
        </Row>
        <Row label="PMH" missing={profile('pmh').length === 0}>
          <ul className="list-disc pl-5">
            {profile('pmh').map((p) => (
              <li key={p.id}>{p.value}</li>
            ))}
          </ul>
        </Row>
        <Row label="Allergies" missing={!c.nkda && bundle.allergies.filter(notRejected).length === 0}>
          {c.nkda ? (
            <Tag kind="patient_fact">NKDA</Tag>
          ) : (
            <ul className="space-y-1">
              {bundle.allergies.filter(notRejected).map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-2">
                  <strong>{a.substance}</strong> {a.reaction && `(${a.reaction})`} <ProvenanceTag prov={a.prov} />
                </li>
              ))}
            </ul>
          )}
        </Row>
        <Row label="Current medications" missing={meds.length === 0}>
          <ul className="space-y-1">
            {meds.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-2">
                <span>
                  <strong>{m.name}</strong> {[m.dose && `${m.dose}${m.unit ? ` ${m.unit}` : ''}`, m.route, m.frequency].filter(Boolean).join(' ')}
                </span>
                <ProvenanceTag prov={m.prov} />
              </li>
            ))}
          </ul>
        </Row>
        <Row label="Vital signs" missing={bundle.vitals.filter(notRejected).length === 0}>
          <p>
            {bundle.vitals
              .filter(notRejected)
              .slice(-8)
              .map((v) => `${v.type} ${v.value}${v.unit ? ` ${v.unit}` : ''}`)
              .join(' · ')}
          </p>
        </Row>
        <Row label="Laboratory findings" missing={labs.length === 0}>
          {abnormal.length > 0 ? (
            <ul className="grid gap-1 sm:grid-cols-2">
              {abnormal.slice(-16).map((l) => (
                <li key={l.id}>
                  <strong>{l.name}</strong> {l.value} {l.unit} <span className="text-xs text-slate-500">{l.takenAt?.slice(0, 10)}</span>{' '}
                  <Badge tone={l.flag === 'critical' ? 'red' : 'yellow'}>{l.flag}</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p>{labs.length} result(s), none flagged abnormal.</p>
          )}
        </Row>
        <Row label="Diagnostics" missing={bundle.diagnostics.filter(notRejected).length === 0 && !c.diagnosticsNotApplicable}>
          <ul className="space-y-1">
            {bundle.diagnostics.filter(notRejected).map((d) => (
              <li key={d.id}>
                <strong>{d.type}:</strong> {d.result} <ProvenanceTag prov={d.prov} />
              </li>
            ))}
            {c.diagnosticsNotApplicable && <li>Not applicable</li>}
          </ul>
        </Row>
        <Row label="Diagnoses" missing={bundle.problems.filter((p) => p.origin === 'documented' && notRejected(p)).length === 0}>
          <ul className="list-disc pl-5">
            {bundle.problems
              .filter((p) => p.origin === 'documented' && notRejected(p))
              .map((p) => (
                <li key={p.id}>{p.name}</li>
              ))}
          </ul>
        </Row>
        <Row label="Pending information">
          {pending.length ? (
            <div>
              <Tag kind="requires_verification">{pending.length} documented item(s) awaiting verification</Tag>
              <ul className="mt-1 list-disc pl-5 text-xs text-slate-600">
                {pending.slice(0, 6).map((p) => (
                  <li key={p.id}>{itemTitle(p)}</li>
                ))}
              </ul>
            </div>
          ) : (
            <span className="text-slate-500">None awaiting verification.</span>
          )}
        </Row>
      </CardBody>
    </Card>
  );
}

function TimelineCard({ bundle }: { bundle: CaseBundle }) {
  const ai = useAiRunner();
  const [label, setLabel] = useState('');
  const [date, setDate] = useState('');
  const events = [...bundle.timeline].sort((a, b) => (a.date ?? a.dayLabel ?? '').localeCompare(b.date ?? b.dayLabel ?? ''));
  const hasAi = events.some((e) => e.origin !== 'manual');
  return (
    <Card>
      <CardHeader
        title="Timeline"
        icon={<CalendarClock />}
        action={
          <Button size="sm" variant="brand" onClick={() => ai.run(() => runTimeline(bundle))} disabled={ai.loading}>
            <Sparkles /> {hasAi ? 'Rebuild' : 'Build with AI'}
          </Button>
        }
      />
      <CardBody className="space-y-3">
        {ai.loading && <AILoading label="Building timeline from documents…" />}
        {ai.error && <AIErrorPanel error={ai.error} onRetry={ai.retry} onManual={ai.reset} />}
        {hasAi && <AIDraftBanner provider={events.find((e) => e.origin !== 'manual')?.origin === 'demo' ? 'demo' : undefined} />}
        {events.length === 0 ? (
          <p className="text-sm text-slate-600">No events yet. Build the timeline from your sources or add events manually.</p>
        ) : (
          <ol className="relative space-y-3 border-l-2 border-navy-100 pl-4">
            {events.map((e) => (
              <li key={e.id} className="relative">
                <span className="absolute -left-[1.4rem] top-1 size-3 rounded-full bg-navy-700" aria-hidden />
                <p className="text-xs font-semibold text-slate-500">
                  {e.date ? formatDate(e.date) : ''} {e.dayLabel && `· ${e.dayLabel}`} {e.sourceLabel && `· ${e.sourceLabel}`}
                </p>
                <p className="text-sm font-semibold text-navy-900">{e.label}</p>
                {e.detail && <p className="text-sm text-slate-600">{e.detail}</p>}
                {e.origin === 'manual' ? <Badge tone="blue">Student</Badge> : null}
              </li>
            ))}
          </ol>
        )}
        <div className="flex flex-wrap gap-2">
          <Input className="min-w-40 flex-1" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Add event…" aria-label="Event" />
          <Input className="w-40" type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Event date" />
          <Button
            variant="secondary"
            disabled={!label.trim()}
            onClick={async () => {
              await db.timeline.add({ id: uid(), caseId: bundle.case.id, date: date || undefined, kind: 'clinical_event', label: label.trim(), origin: 'manual', createdAt: nowIso() });
              setLabel('');
              setDate('');
            }}
          >
            <Plus /> Add
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

function AiUnderstanding({ bundle }: { bundle: CaseBundle }) {
  const ai = useAiRunner();
  const analysis = useLatestAnalysis<CaseAnalysis>(bundle.case.id, 'analyze-case');
  const r = analysis?.result;
  const [editing, setEditing] = useState<{ index: number; name: string } | null>(null);
  const accept = async (i: number, editedName?: string) => {
    const p = r!.suggestedProblems[i]!;
    await db.problems.add({
      id: uid(),
      caseId: bundle.case.id,
      name: editedName?.trim() || p.name,
      status: 'active',
      priority: p.priority,
      origin: 'ai',
      rationale: p.rationale,
      priorityReason: p.priorityReason,
      prov: { origin: analysis!.provider === 'demo' ? 'demo' : 'ai', verification: 'verified', verifiedAt: nowIso() },
      createdAt: nowIso(),
    });
    await decide(analysis!.id, i, 'accepted');
  };
  return (
    <Card>
      <CardHeader
        title="AI patient overview & suggested problems"
        icon={<Sparkles />}
        action={
          <Button size="sm" variant="brand" onClick={() => ai.run(() => runCaseAction(bundle, 'analyze-case'))} disabled={ai.loading}>
            {r ? 'Regenerate' : 'Generate'}
          </Button>
        }
      />
      <CardBody className="space-y-3">
        {ai.loading && <AILoading label="Reviewing the case…" />}
        {ai.error && <AIErrorPanel error={ai.error} onRetry={ai.retry} onManual={ai.reset} />}
        {!r && !ai.loading && <p className="text-sm text-slate-600">Uses only verified and flagged-unverified case data. Nothing is added to the problem list until you accept it.</p>}
        {r && analysis && (
          <>
            <AIDraftBanner meta={{ provider: analysis.provider, model: analysis.model, warnings: analysis.warnings, cached: false }} />
            <div className="space-y-2 text-sm">
              <p>
                <Tag kind="ai_inference">Overview</Tag> <span className="ml-1">{r.overview.presentingProblem}</span>
              </p>
              {r.overview.relevantHistory && <p className="text-slate-700">{r.overview.relevantHistory}</p>}
              {[
                ['Important findings', r.overview.importantFindings],
                ['Clinical instability', r.overview.clinicalInstability],
                ['Potential medication concerns', r.overview.potentialMedicationConcerns],
              ].map(([title, list]) =>
                (list as string[]).length ? (
                  <div key={title as string}>
                    <p className="font-semibold text-navy-900">{title as string}</p>
                    <ul className="list-disc pl-5 text-slate-700">
                      {(list as string[]).map((x) => (
                        <li key={x}>{x}</li>
                      ))}
                    </ul>
                  </div>
                ) : null,
              )}
            </div>
            <SectionTitle>Suggested problems</SectionTitle>
            <ul className="space-y-2">
              {r.suggestedProblems.map((p, i) => {
                const d = analysis.decisions?.[i];
                return (
                  <li key={p.name} className="rounded-xl border border-violet-200 bg-violet-50/40 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Tag kind="ai_suggestion" />
                      <span className="font-semibold text-navy-900">{p.name}</span>
                      <Badge tone={p.priority === 'high' ? 'red' : p.priority === 'medium' ? 'yellow' : 'neutral'}>{p.priority}</Badge>
                      {d && <Badge tone={d === 'accepted' ? 'green' : 'neutral'}>{d}</Badge>}
                    </div>
                    <p className="mt-1 text-sm text-slate-700">{p.rationale}</p>
                    {p.priorityReason && <p className="text-sm text-slate-600">Priority: {p.priorityReason}</p>}
                    {p.supportingData.length > 0 && <p className="text-xs text-slate-600">Data: {p.supportingData.join('; ')}</p>}
                    {!d && editing?.index === i && (
                      <div className="mt-2 flex gap-2">
                        <Input value={editing.name} onChange={(e) => setEditing({ index: i, name: e.target.value })} aria-label="Edit suggested problem" />
                        <Button
                          size="sm"
                          variant="med"
                          onClick={async () => {
                            await accept(i, editing.name);
                            setEditing(null);
                          }}
                        >
                          Save
                        </Button>
                      </div>
                    )}
                    {!d && editing?.index !== i && (
                      <div className="mt-2 flex gap-2">
                        <Button size="sm" variant="med" onClick={() => accept(i)}>
                          <Check /> Accept
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditing({ index: i, name: p.name })}>
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
            {r.missingInformation.length > 0 && (
              <div>
                <SectionTitle>Missing information</SectionTitle>
                <ul className="space-y-1.5 text-sm">
                  {r.missingInformation.map((m) => (
                    <li key={m.item}>
                      <Tag kind="missing">{m.item}</Tag> <span className="text-slate-700">{m.whyItMatters}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {r.inferences.length > 0 && (
              <div>
                <SectionTitle>AI inferences (not patient facts)</SectionTitle>
                <ul className="space-y-1.5 text-sm">
                  {r.inferences.map((m) => (
                    <li key={m.statement}>
                      <Tag kind="ai_inference" /> {m.statement} <span className="text-slate-500">— basis: {m.basis}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}

export function ProblemList({ bundle }: { bundle: CaseBundle }) {
  const [name, setName] = useState('');
  const problems = bundle.problems.filter(notRejected).filter((p) => p.status !== 'resolved');
  const resolved = bundle.problems.filter((p) => p.status === 'resolved');
  const update = (p: ClinicalProblem, patch: Partial<ClinicalProblem>) => db.problems.update(p.id, patch);
  const reorder = async (idx: number, dir: -1 | 1) => {
    const list = [...problems];
    const j = idx + dir;
    if (j < 0 || j >= list.length) return;
    [list[idx], list[j]] = [list[j]!, list[idx]!];
    await Promise.all(list.map((p, i) => db.problems.update(p.id, { rank: i + 1 })));
    await audit('problem.prioritise', { caseId: bundle.case.id });
  };
  return (
    <Card>
      <CardHeader title="Problem list & prioritisation" subtitle="Which problem should be addressed first? Order by severity, urgency, safety, risk of harm and need for intervention." icon={<ListPlus />} />
      <CardBody className="space-y-3">
        {problems.length === 0 ? (
          <EmptyState title="No problems listed yet">Add the problems you identified. Documented diagnoses appear here once verified.</EmptyState>
        ) : (
          <ol className="space-y-2">
            {problems.map((p, i) => (
              <li key={p.id} className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="grid size-7 place-items-center rounded-full bg-navy-900 text-sm font-bold text-white">{i + 1}</span>
                  <span className="min-w-0 flex-1 font-semibold text-navy-900">{p.name}</span>
                  <Badge tone={p.origin === 'student' ? 'blue' : p.origin === 'ai' ? 'purple' : 'navy'}>{p.origin === 'student' ? 'Student' : p.origin === 'ai' ? 'AI · accepted' : 'Documented'}</Badge>
                  <Select className="min-h-10 w-28" value={p.priority ?? ''} onChange={(e) => update(p, { priority: (e.target.value || undefined) as Priority })} aria-label={`Priority of ${p.name}`}>
                    <option value="">Priority</option>
                    {PRIORITIES.map((x) => (
                      <option key={x}>{x}</option>
                    ))}
                  </Select>
                  <Button size="icon" variant="ghost" aria-label="Move up" onClick={() => reorder(i, -1)} disabled={i === 0}>
                    <ArrowUp />
                  </Button>
                  <Button size="icon" variant="ghost" aria-label="Move down" onClick={() => reorder(i, 1)} disabled={i === problems.length - 1}>
                    <ArrowDown />
                  </Button>
                  <Button size="icon" variant="ghost" aria-label="Mark resolved" onClick={() => update(p, { status: 'resolved' })}>
                    <Check />
                  </Button>
                  {p.origin !== 'documented' && (
                    <Button size="icon" variant="ghost" className="text-red-700" aria-label="Delete problem" onClick={() => db.problems.delete(p.id)}>
                      <Trash2 />
                    </Button>
                  )}
                </div>
                {i === 0 && (
                  <Textarea
                    className="mt-2"
                    rows={2}
                    defaultValue={p.priorityReason ?? ''}
                    onBlur={(e) => update(p, { priorityReason: e.target.value })}
                    placeholder="Why is this the first problem to address? (severity, urgency, safety, risk of harm…)"
                    aria-label="Why is this first?"
                  />
                )}
              </li>
            ))}
          </ol>
        )}
        <div className="flex gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Add a clinical problem…" aria-label="New problem" />
          <Button
            variant="secondary"
            disabled={!name.trim()}
            onClick={async () => {
              await db.problems.add({ id: uid(), caseId: bundle.case.id, name: name.trim(), status: 'active', origin: 'student', rank: problems.length + 1, prov: { origin: 'manual', verification: 'verified', verifiedAt: nowIso() }, createdAt: nowIso() });
              setName('');
            }}
          >
            <Plus /> Add
          </Button>
        </div>
        {resolved.length > 0 && <p className="text-xs text-slate-500">Resolved: {resolved.map((p) => p.name).join(', ')}</p>}
      </CardBody>
    </Card>
  );
}

export function UnderstandStage({ bundle }: { bundle: CaseBundle }) {
  return (
    <div className="space-y-5">
      <ClinicalSnapshot bundle={bundle} />
      <TimelineCard bundle={bundle} />
      <ThinkFirst
        bundle={bundle}
        stage="understand"
        question="What are the main clinical problems, and which should be addressed first? Why?"
        hint="Think about severity, urgency, safety and what could harm the patient in the next 24 hours."
      >
        {() => <AiUnderstanding bundle={bundle} />}
      </ThinkFirst>
      <ProblemList bundle={bundle} />
    </div>
  );
}
