import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { DEPARTMENT_LIST, type DepartmentId } from '@shared/departments';
import { CASE_MODES, PRIORITIES, type CaseMode, type Priority } from '@shared/domain';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/form';
import { audit, db, nextCaseCode } from '@/lib/db';
import { useSettings } from '@/lib/hooks';
import type { CaseRecord, Sex } from '@/lib/types';
import { nowIso, uid } from '@/lib/utils';
import { PrivacyNotice } from './HomePage';

const MODE_HELP: Record<CaseMode, string> = {
  teach: 'Teach — you answer first; the preceptor gives feedback and then reveals AI suggestions.',
  assist: 'Assist — guided AI suggestions available on request.',
  autodraft: 'Auto-draft — AI drafts a full preliminary workup for you to verify.',
};

export default function NewCasePage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const settings = useSettings();
  const rotation = useLiveQuery(() => db.rotations.filter((r) => r.isCurrent).first(), []);
  const [form, setForm] = useState({
    department: '' as DepartmentId | '',
    ward: '',
    age: '',
    sex: 'Unknown' as Sex,
    weightKg: '',
    heightCm: '',
    mainProblem: '',
    priority: 'medium' as Priority,
    mode: 'teach' as CaseMode,
  });
  const department = (form.department || rotation?.department || settings.defaultDepartment) as DepartmentId;
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const num = (s: string) => (s.trim() === '' ? undefined : Number(s));

  const create = async () => {
    const id = uid();
    const record: CaseRecord = {
      id,
      code: await nextCaseCode(),
      department,
      ward: form.ward.trim() || undefined,
      age: num(form.age),
      sex: form.sex,
      weightKg: num(form.weightKg),
      heightCm: num(form.heightCm),
      demographicsProv: {},
      mainProblem: form.mainProblem.trim() || undefined,
      priority: form.priority,
      status: 'active',
      stage: 'collect',
      mode: form.mode,
      rotationId: rotation?.id,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    await db.cases.add(record);
    await audit('case.create', { caseId: id, detail: record.code });
    const capture = params.get('capture');
    const type = params.get('type');
    navigate(`/cases/${id}?stage=collect${capture ? `&capture=${capture}` : ''}${type ? `&type=${type}` : ''}`, { replace: true });
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-navy-900">New case</h1>
      <PrivacyNotice />
      <Card>
        <CardBody className="space-y-4">
          <p className="text-sm text-slate-600">An anonymous code (CASE-0001…) is assigned automatically. Patient names are never needed. All fields can be completed later from documents.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Department">
              {(id) => (
                <Select id={id} value={department} onChange={(e) => set('department', e.target.value as DepartmentId)}>
                  {DEPARTMENT_LIST.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Ward / unit (optional)">{(id) => <Input id={id} value={form.ward} onChange={(e) => set('ward', e.target.value)} placeholder="e.g. Ward 4B" />}</Field>
            <Field label="Age (years)">{(id) => <Input id={id} inputMode="numeric" value={form.age} onChange={(e) => set('age', e.target.value.replace(/[^\d.]/g, ''))} />}</Field>
            <Field label="Sex">
              {(id) => (
                <Select id={id} value={form.sex} onChange={(e) => set('sex', e.target.value as Sex)}>
                  {['Unknown', 'Female', 'Male', 'Other'].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Weight (kg)">{(id) => <Input id={id} inputMode="decimal" value={form.weightKg} onChange={(e) => set('weightKg', e.target.value.replace(/[^\d.]/g, ''))} />}</Field>
            <Field label="Height (cm)">{(id) => <Input id={id} inputMode="decimal" value={form.heightCm} onChange={(e) => set('heightCm', e.target.value.replace(/[^\d.]/g, ''))} />}</Field>
            <Field label="Main clinical problem (optional)" className="sm:col-span-2">
              {(id) => <Input id={id} value={form.mainProblem} onChange={(e) => set('mainProblem', e.target.value)} placeholder="e.g. Community-acquired pneumonia with AKI" />}
            </Field>
            <Field label="Priority">
              {(id) => (
                <Select id={id} value={form.priority} onChange={(e) => set('priority', e.target.value as Priority)}>
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {p[0]!.toUpperCase() + p.slice(1)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Case mode" hint={MODE_HELP[form.mode]}>
              {(id) => (
                <Select id={id} value={form.mode} onChange={(e) => set('mode', e.target.value as CaseMode)}>
                  {CASE_MODES.map((m) => (
                    <option key={m} value={m}>
                      {m === 'autodraft' ? 'Auto-draft' : m[0]!.toUpperCase() + m.slice(1)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <Button size="lg" className="w-full sm:w-auto" onClick={create}>
            Create case
          </Button>
        </CardBody>
      </Card>
    </div>
  );
}
