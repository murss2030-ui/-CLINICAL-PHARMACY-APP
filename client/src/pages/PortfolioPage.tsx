import { useLiveQuery } from 'dexie-react-hooks';
import { Download, GraduationCap, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { DEPARTMENT_LIST, DEPARTMENTS, departmentLabel, type DepartmentId } from '@shared/departments';
import { COMPETENCY_DOMAINS, COMPETENCY_LABEL, COMPETENCY_LEVEL_LABEL, COMPETENCY_LEVELS, DRP_STATUS_LABEL, type CompetencyDomain, type CompetencyLevel } from '@shared/domain';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { EmptyState, Tabs } from '@/components/ui/misc';
import { REFLECTION_QUESTIONS } from '@/case/ReflectStage';
import { audit, db, exportAll } from '@/lib/db';
import { competencyEvidence, learningTarget } from '@/lib/learning';
import type { Rotation } from '@/lib/types';
import { downloadText, formatDate, nowIso, uid } from '@/lib/utils';

type Tab = 'overview' | 'rotation' | 'competencies' | 'gaps' | 'reflections' | 'cases';

const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);

function RotationEditor() {
  const rotations = useLiveQuery(() => db.rotations.toArray(), [], []);
  const current = rotations.find((r) => r.isCurrent);
  const [f, setF] = useState({ name: '', department: 'internal_medicine' as DepartmentId, startDate: '', endDate: '', objectives: '', diseaseStates: '', medicationClasses: '', clinicalSkills: '', epas: '', presentationRequirements: '' });
  useEffect(() => {
    if (current)
      setF({
        name: current.name,
        department: current.department,
        startDate: current.startDate ?? '',
        endDate: current.endDate ?? '',
        objectives: current.objectives.join('\n'),
        diseaseStates: current.diseaseStates.join('\n'),
        medicationClasses: current.medicationClasses.join('\n'),
        clinicalSkills: current.clinicalSkills.join('\n'),
        epas: current.epas.join('\n'),
        presentationRequirements: current.presentationRequirements ?? '',
      });
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = async (asNew: boolean) => {
    const row: Rotation = {
      id: !asNew && current ? current.id : uid(),
      name: f.name.trim() || departmentLabel(f.department),
      department: f.department,
      startDate: f.startDate || undefined,
      endDate: f.endDate || undefined,
      objectives: lines(f.objectives),
      diseaseStates: lines(f.diseaseStates),
      medicationClasses: lines(f.medicationClasses),
      clinicalSkills: lines(f.clinicalSkills),
      epas: lines(f.epas),
      presentationRequirements: f.presentationRequirements || undefined,
      isCurrent: true,
      createdAt: current && !asNew ? current.createdAt : nowIso(),
    };
    await db.transaction('rw', db.rotations, async () => {
      if (asNew) await db.rotations.toCollection().modify({ isCurrent: false });
      await db.rotations.put(row);
    });
    await audit('rotation.save', { detail: row.name });
  };
  const suggest = () => {
    const d = DEPARTMENTS[f.department];
    setF((x) => ({ ...x, diseaseStates: x.diseaseStates || d.learningTopics.join('\n'), medicationClasses: x.medicationClasses || d.medicationClasses.join('\n') }));
  };
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title={current ? 'Current rotation' : 'Set up your rotation'} subtitle="Department drives learning missions, clinical questions, monitoring priorities, medication classes and DRP prompts." icon={<GraduationCap />} />
        <CardBody className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Rotation name">{(id) => <Input id={id} value={f.name} onChange={set('name')} placeholder="e.g. Haematology rotation 2" />}</Field>
            <Field label="Department">
              {(id) => (
                <Select id={id} value={f.department} onChange={set('department')}>
                  {DEPARTMENT_LIST.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Start date">{(id) => <Input id={id} type="date" value={f.startDate} onChange={set('startDate')} />}</Field>
            <Field label="End date">{(id) => <Input id={id} type="date" value={f.endDate} onChange={set('endDate')} />}</Field>
            <Field label="Learning objectives (one per line)" className="sm:col-span-2">{(id) => <Textarea id={id} value={f.objectives} onChange={set('objectives')} />}</Field>
            <Field label="Disease states">{(id) => <Textarea id={id} value={f.diseaseStates} onChange={set('diseaseStates')} />}</Field>
            <Field label="Medication classes">{(id) => <Textarea id={id} value={f.medicationClasses} onChange={set('medicationClasses')} />}</Field>
            <Field label="Clinical skills">{(id) => <Textarea id={id} value={f.clinicalSkills} onChange={set('clinicalSkills')} />}</Field>
            <Field label="EPAs">{(id) => <Textarea id={id} value={f.epas} onChange={set('epas')} />}</Field>
            <Field label="Presentation requirements" className="sm:col-span-2">{(id) => <Input id={id} value={f.presentationRequirements} onChange={set('presentationRequirements')} placeholder="e.g. one 15-minute case conference" />}</Field>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => save(false)}>{current ? 'Save rotation' : 'Start rotation'}</Button>
            {current && (
              <Button variant="secondary" onClick={() => save(true)}>
                <Plus /> Start a new rotation
              </Button>
            )}
            <Button variant="ghost" onClick={suggest}>
              Suggest topics for department
            </Button>
          </div>
        </CardBody>
      </Card>
      {rotations.filter((r) => !r.isCurrent).length > 0 && (
        <Card>
          <CardHeader title="Previous rotations" />
          <CardBody>
            <ul className="space-y-1 text-sm">
              {rotations
                .filter((r) => !r.isCurrent)
                .map((r) => (
                  <li key={r.id}>
                    {r.name} · {departmentLabel(r.department)} · {formatDate(r.startDate)} – {formatDate(r.endDate)}
                  </li>
                ))}
            </ul>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function Competencies() {
  const rows = useLiveQuery(() => db.competencies.toArray(), [], []);
  const [evidence, setEvidence] = useState<Partial<Record<CompetencyDomain, number>>>({});
  useEffect(() => {
    void competencyEvidence().then(setEvidence);
  }, []);
  const save = async (id: CompetencyDomain, patch: { level?: CompetencyLevel; notes?: string; supervisorFeedback?: string }) => {
    const existing = rows.find((r) => r.id === id);
    await db.competencies.put({ id, level: existing?.level ?? 'not_exposed', notes: existing?.notes, supervisorFeedback: existing?.supervisorFeedback, ...patch, updatedAt: nowIso() });
    await audit('competency.update', { detail: `${id}${patch.level ? ` → ${patch.level}` : ''}` });
  };
  return (
    <Card>
      <CardHeader title="Competency tracking" subtitle="Self- or supervisor-rated entrustment levels. The app shows exposure evidence but never advances a level automatically." />
      <CardBody>
        <ul className="divide-y divide-slate-100">
          {COMPETENCY_DOMAINS.map((d) => {
            const row = rows.find((r) => r.id === d);
            return (
              <li key={d} className="grid gap-2 py-3 sm:grid-cols-[1fr_12rem]">
                <div>
                  <p className="font-semibold text-navy-900">{COMPETENCY_LABEL[d]}</p>
                  <p className="text-xs text-slate-500">Exposure evidence in your records: {evidence[d] ?? 0}</p>
                  <Input className="mt-1 min-h-10 text-sm" defaultValue={row?.supervisorFeedback ?? ''} placeholder="Supervisor feedback (optional)" onBlur={(e) => save(d, { supervisorFeedback: e.target.value })} aria-label={`Supervisor feedback for ${COMPETENCY_LABEL[d]}`} />
                </div>
                <Select value={row?.level ?? 'not_exposed'} onChange={(e) => save(d, { level: e.target.value as CompetencyLevel })} aria-label={`Level for ${COMPETENCY_LABEL[d]}`}>
                  {COMPETENCY_LEVELS.map((l) => (
                    <option key={l} value={l}>
                      {COMPETENCY_LEVEL_LABEL[l]}
                    </option>
                  ))}
                </Select>
              </li>
            );
          })}
        </ul>
      </CardBody>
    </Card>
  );
}

export default function PortfolioPage() {
  const [params] = useSearchParams();
  const [tab, setTab] = useState<Tab>((params.get('tab') as Tab) || 'overview');
  const cases = useLiveQuery(() => db.cases.toArray(), [], []);
  const drps = useLiveQuery(() => db.drps.toArray(), [], []);
  const interventions = useLiveQuery(() => db.interventions.toArray(), [], []);
  const followups = useLiveQuery(() => db.followups.toArray(), [], []);
  const evidence = useLiveQuery(() => db.evidence.count(), [], 0);
  const presentations = useLiveQuery(() => db.presentations.count(), [], 0);
  const reflections = useLiveQuery(() => db.reflections.toArray(), [], []);
  const gaps = useLiveQuery(() => db.gaps.toArray(), [], []);
  const rotations = useLiveQuery(() => db.rotations.count(), [], 0);
  const target = learningTarget(gaps);
  const code = (id?: string) => cases.find((c) => c.id === id)?.code ?? '—';

  const stats = [
    { label: 'Rotations', value: rotations },
    { label: 'Cases (completed)', value: `${cases.length} (${cases.filter((c) => c.status === 'completed').length})` },
    { label: 'DRPs documented', value: drps.length },
    { label: 'DRPs confirmed', value: drps.filter((d) => d.status === 'confirmed').length },
    { label: 'Interventions (accepted)', value: `${interventions.length} (${interventions.filter((i) => i.status === 'accepted' || i.status === 'implemented').length})` },
    { label: 'Follow-ups completed', value: followups.filter((f) => f.status !== 'pending').length },
    { label: 'Evidence records', value: evidence },
    { label: 'Presentations', value: presentations },
    { label: 'Reflections', value: reflections.length },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <h1 className="flex-1 text-2xl font-bold text-navy-900">Portfolio</h1>
        <Button variant="secondary" onClick={async () => downloadText(`preceptor-portfolio-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(await exportAll(), null, 2), 'application/json')}>
          <Download /> Export
        </Button>
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: 'overview', label: 'Overview' },
          { value: 'rotation', label: 'Rotation' },
          { value: 'competencies', label: 'Competencies' },
          { value: 'gaps', label: 'Knowledge gaps', count: gaps.filter((g) => g.status !== 'resolved').length },
          { value: 'reflections', label: 'Reflections' },
          { value: 'cases', label: 'Cases' },
        ]}
      />
      {tab === 'overview' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {stats.map((s) => (
              <div key={s.label} className="rounded-2xl border border-slate-200 bg-white p-3">
                <p className="text-2xl font-bold text-navy-900">{s.value}</p>
                <p className="text-xs font-semibold text-slate-600">{s.label}</p>
              </div>
            ))}
          </div>
          <Card>
            <CardHeader title="DRPs by status" />
            <CardBody className="flex flex-wrap gap-2">
              {(['confirmed', 'possible', 'needs_data', 'not_supported'] as const).map((s) => (
                <Badge key={s} tone={s === 'confirmed' ? 'green' : 'neutral'}>
                  {DRP_STATUS_LABEL[s]}: {drps.filter((d) => d.status === s).length}
                </Badge>
              ))}
            </CardBody>
          </Card>
          {target && (
            <Card>
              <CardHeader title="Next learning target" />
              <CardBody className="text-sm">
                {target.label}: {target.topics.join('; ')}{' '}
                <Link className="font-semibold text-brand-600 underline" to={`/training?focus=${target.domain}`}>
                  Practise
                </Link>
              </CardBody>
            </Card>
          )}
        </div>
      )}
      {tab === 'rotation' && <RotationEditor />}
      {tab === 'competencies' && <Competencies />}
      {tab === 'gaps' &&
        (gaps.length === 0 ? (
          <EmptyState title="No knowledge gaps recorded">Gaps come from preceptor feedback, self-checks, dialogues and your reflections.</EmptyState>
        ) : (
          <ul className="space-y-2">
            {[...gaps]
              .sort((a, b) => b.count - a.count)
              .map((g) => (
                <Card key={g.id} className="p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={g.count >= 2 ? 'orange' : 'neutral'}>{g.count}×</Badge>
                    <Badge tone="navy">{COMPETENCY_LABEL[g.domain]}</Badge>
                    <span className="flex-1 font-semibold text-navy-900">{g.topic}</span>
                    <Select className="min-h-10 w-auto" value={g.status} onChange={(e) => db.gaps.update(g.id, { status: e.target.value as typeof g.status })} aria-label="Gap status">
                      <option value="open">Open</option>
                      <option value="improving">Improving</option>
                      <option value="resolved">Resolved</option>
                    </Select>
                    <Button size="sm" variant="soft" asChild>
                      <Link to={`/training?focus=${g.domain}`}>Practise</Link>
                    </Button>
                  </div>
                  {g.examples.length > 0 && <p className="mt-1 text-xs text-slate-500">Seen in: {g.examples.join(' · ')}</p>}
                </Card>
              ))}
          </ul>
        ))}
      {tab === 'reflections' &&
        (reflections.length === 0 ? (
          <EmptyState title="No reflections yet">Reflect at the end of each case (Reflect stage).</EmptyState>
        ) : (
          <ul className="space-y-2">
            {[...reflections].reverse().map((r) => (
              <Card key={r.id} className="p-3 text-sm">
                <p className="text-xs font-semibold text-slate-500">
                  {formatDate(r.createdAt)} · {r.caseId ? <Link to={`/cases/${r.caseId}?stage=reflect`} className="text-brand-600 underline">{code(r.caseId)}</Link> : 'General'}
                </p>
                {REFLECTION_QUESTIONS.filter((q) => r.answers[q.key]).map((q) => (
                  <p key={q.key} className="mt-1">
                    <span className="font-semibold text-slate-600">{q.q} </span>
                    {r.answers[q.key]}
                  </p>
                ))}
              </Card>
            ))}
          </ul>
        ))}
      {tab === 'cases' && (
        <ul className="space-y-2">
          {cases
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
            .map((c) => (
              <Card key={c.id} className="p-3 text-sm">
                <Link to={`/cases/${c.id}`} className="font-semibold text-navy-900 underline">
                  {c.code}
                </Link>{' '}
                · {departmentLabel(c.department)} · {c.mainProblem || '—'} · <Badge tone={c.status === 'completed' ? 'green' : 'neutral'}>{c.status}</Badge>
                <p className="text-xs text-slate-600">
                  DRPs {drps.filter((d) => d.caseId === c.id).length} · interventions {interventions.filter((i) => i.caseId === c.id).length} · outcome: {c.outcome || '—'}
                </p>
              </Card>
            ))}
        </ul>
      )}
    </div>
  );
}
