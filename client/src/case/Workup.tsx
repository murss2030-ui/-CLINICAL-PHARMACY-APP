// Structured PHARMACOTHERAPY WORKUP — a clinical document, not a chat.
import type { ReactNode } from 'react';
import { DRP_CATEGORY_LABEL, DRP_STATUS_LABEL, FOLLOWUP_STATUS_LABEL, INTERVENTION_TYPE_LABEL } from '@shared/domain';
import { DATA_NOT_AVAILABLE } from '@shared/presentation';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Textarea } from '@/components/ui/form';
import { activeMeds, profileValue, type CaseBundle } from '@/lib/bundle';
import { touchCase } from '@/lib/db';
import { estimateCrcl } from '@/lib/safety';

function S({ n, title, children, empty }: { n: number; title: string; children?: ReactNode; empty?: boolean }) {
  return (
    <section className="border-b border-slate-100 py-3">
      <h4 className="text-sm font-bold text-navy-900">
        {n}. {title}
      </h4>
      <div className="mt-1 text-sm text-slate-800">{empty ? <span className="font-semibold text-red-700">{DATA_NOT_AVAILABLE}</span> : children}</div>
    </section>
  );
}

const ok = (x: { prov: { verification: string } }) => x.prov.verification !== 'rejected';

export function Workup({ bundle }: { bundle: CaseBundle }) {
  const c = bundle.case;
  const current = activeMeds(bundle);
  const past = bundle.meds.filter(ok).filter((m) => m.list === 'home' || m.status === 'stopped');
  const crcl = estimateCrcl(bundle);
  const drps = bundle.drps;
  const newDrps = bundle.followups.filter((f) => f.status === 'new_drp');
  const pharm = bundle.interventions.filter((i) => i.status !== 'rejected');
  const line = (m: (typeof current)[number]) => `${m.name} ${[m.dose && `${m.dose}${m.unit ? ` ${m.unit}` : ''}`, m.route, m.frequency].filter(Boolean).join(' ')}${m.indication ? ` — for ${m.indication}` : ''}${m.status === 'held' ? ' (held)' : ''}`;
  return (
    <Card>
      <CardHeader title="Pharmacotherapy workup" subtitle={`${c.code} · structured clinical pharmacy assessment`} />
      <CardBody>
        <S n={1} title="Patient information" empty={c.age === undefined && !c.weightKg}>
          {[c.age !== undefined && `${c.age} y`, c.sex, c.weightKg && `${c.weightKg} kg`, c.heightCm && `${c.heightCm} cm`, crcl !== undefined && `CrCl ≈ ${Math.round(crcl)} mL/min (Cockcroft-Gault)`].filter(Boolean).join(' · ')}
        </S>
        <S n={2} title="History (CC / HPI)" empty={!profileValue(bundle, 'chief_complaint') && !profileValue(bundle, 'hpi')}>
          <p>{profileValue(bundle, 'chief_complaint')}</p>
          <p className="mt-1">{profileValue(bundle, 'hpi')}</p>
        </S>
        <S n={3} title="Past medical history" empty={!profileValue(bundle, 'pmh')}>
          {profileValue(bundle, 'pmh')}
        </S>
        <S n={4} title="Current medications" empty={current.length === 0}>
          <ul className="list-disc pl-5">{current.map((m) => <li key={m.id}>{line(m)}</li>)}</ul>
        </S>
        <S n={5} title="Past / home medications" empty={past.length === 0}>
          <ul className="list-disc pl-5">{past.map((m) => <li key={m.id}>{line(m)}</li>)}</ul>
        </S>
        <S n={6} title="Vital signs" empty={bundle.vitals.filter(ok).length === 0}>
          {bundle.vitals.filter(ok).map((v) => `${v.type} ${v.value}${v.unit ? ` ${v.unit}` : ''}`).join(' · ')}
        </S>
        <S n={7} title="Physical examination" empty={!profileValue(bundle, 'physical_exam')}>
          {profileValue(bundle, 'physical_exam')}
        </S>
        <S n={8} title="Laboratory data" empty={bundle.labs.filter(ok).length === 0}>
          <div className="grid gap-x-4 sm:grid-cols-2">
            {bundle.labs.filter(ok).map((l) => (
              <p key={l.id}>
                {l.name}: <strong>{l.value}</strong> {l.unit} <span className="text-xs text-slate-500">{l.takenAt?.slice(0, 16).replace('T', ' ')}</span>
              </p>
            ))}
          </div>
        </S>
        <S n={9} title="Diagnostics" empty={bundle.diagnostics.filter(ok).length === 0}>
          {bundle.diagnostics.filter(ok).map((d) => <p key={d.id}>{d.type}: {d.result}</p>)}
        </S>
        <S n={10} title="Medical problems" empty={bundle.problems.filter(ok).length === 0}>
          <ol className="list-decimal pl-5">{bundle.problems.filter(ok).map((p) => <li key={p.id}>{p.name}{p.priority ? ` (${p.priority})` : ''}{p.status === 'resolved' ? ' — resolved' : ''}</li>)}</ol>
        </S>
        <S n={11} title="Medication assessment" empty={current.length === 0}>
          Assessed for indication, effectiveness, safety, dose, route, frequency, duration, interactions, contraindications, monitoring and adherence — see the medication review and safety alerts.
        </S>
        <S n={12} title="Drug-related problems" empty={drps.length === 0 && !c.noDrpReasoning}>
          <ul className="list-disc pl-5">
            {drps.map((d) => <li key={d.id}>{DRP_CATEGORY_LABEL[d.category]}{d.medication ? ` (${d.medication})` : ''}: {d.description} — <strong>{DRP_STATUS_LABEL[d.status]}</strong></li>)}
          </ul>
          {c.noDrpReasoning && <p>No DRP identified: {c.noDrpReasoning}</p>}
        </S>
        <S n={13} title="Goals of therapy">
          <Textarea rows={2} defaultValue={c.goals ?? ''} onBlur={(e) => touchCase(c.id, { goals: e.target.value })} placeholder="e.g. INR 2–3 without bleeding; creatinine back to baseline; afebrile within 72 h" aria-label="Goals of therapy" />
        </S>
        <S n={14} title="Non-pharmacological management">
          <Textarea rows={2} defaultValue={c.nonPharmPlan ?? ''} onBlur={(e) => touchCase(c.id, { nonPharmPlan: e.target.value })} placeholder="e.g. fluid balance, mobilisation, diet, education" aria-label="Non-pharmacological management" />
        </S>
        <S n={15} title="Pharmacological management & recommendations" empty={pharm.length === 0}>
          <ul className="list-disc pl-5">{pharm.map((i) => <li key={i.id}>{INTERVENTION_TYPE_LABEL[i.type]}: {i.recommendation} — {i.status}</li>)}</ul>
        </S>
        <S n={16} title="Monitoring" empty={bundle.monitoring.length === 0}>
          <ul className="list-disc pl-5">{bundle.monitoring.map((m) => <li key={m.id}>{m.parameter}{m.target ? ` → ${m.target}` : ''}{m.frequency ? ` (${m.frequency})` : ''}</li>)}</ul>
        </S>
        <S n={17} title="Outcomes" empty={!c.outcome && !bundle.followups.some((f) => f.outcome)}>
          {c.outcome}
          <ul className="list-disc pl-5">{bundle.followups.filter((f) => f.outcome).map((f) => <li key={f.id}>{f.parameter}: {f.outcome} ({FOLLOWUP_STATUS_LABEL[f.status]})</li>)}</ul>
        </S>
        <S n={18} title="Follow-up" empty={bundle.followups.length === 0}>
          <ul className="list-disc pl-5">{bundle.followups.map((f) => <li key={f.id}>{f.dueDate ?? f.window}: {f.parameter} — {FOLLOWUP_STATUS_LABEL[f.status]}</li>)}</ul>
        </S>
        <S n={19} title="New DRPs" empty={newDrps.length === 0}>
          <ul className="list-disc pl-5">{newDrps.map((f) => <li key={f.id}>{f.parameter}: {f.outcome}</li>)}</ul>
        </S>
      </CardBody>
    </Card>
  );
}
