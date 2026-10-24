import { Archive, Copy, Download, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DEPARTMENT_LIST, type DepartmentId } from '@shared/departments';
import { PRIORITIES, type Priority } from '@shared/domain';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input, Select } from '@/components/ui/form';
import { Sheet } from '@/components/ui/sheet';
import { audit, deleteCase, duplicateCase, exportCase, touchCase } from '@/lib/db';
import type { CaseRecord, Provenance, Sex } from '@/lib/types';
import { downloadText, nowIso } from '@/lib/utils';

export function CaseDetailsSheet({ open, onClose, record }: { open: boolean; onClose: () => void; record: CaseRecord }) {
  const [f, setF] = useState(() => toForm(record));
  useEffect(() => {
    if (open) setF(toForm(record));
  }, [open, record]);
  const set = <K extends keyof ReturnType<typeof toForm>>(k: K, v: ReturnType<typeof toForm>[K]) => setF((x) => ({ ...x, [k]: v }));
  const num = (s: string) => (s.trim() === '' ? undefined : Number(s));

  const save = async () => {
    const manual: Provenance = { origin: 'manual', verification: 'verified', verifiedAt: nowIso() };
    const dp = { ...(record.demographicsProv ?? {}) };
    if (num(f.age) !== record.age) dp.age = manual;
    if (num(f.weightKg) !== record.weightKg) dp.weightKg = manual;
    if (num(f.heightCm) !== record.heightCm) dp.heightCm = manual;
    if (f.sex !== record.sex) dp.sex = manual;
    await touchCase(record.id, {
      department: f.department,
      ward: f.ward || undefined,
      encounter: f.encounter || undefined,
      age: num(f.age),
      sex: f.sex,
      weightKg: num(f.weightKg),
      heightCm: num(f.heightCm),
      mainProblem: f.mainProblem || undefined,
      priority: f.priority,
      nkda: f.nkda,
      diagnosticsNotApplicable: f.diagnosticsNA,
      demographicsProv: dp,
    });
    await audit('case.edit', { caseId: record.id });
    onClose();
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={`Edit ${record.code}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save}>Save</Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Department">
          {(id) => (
            <Select id={id} value={f.department} onChange={(e) => set('department', e.target.value as DepartmentId)}>
              {DEPARTMENT_LIST.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Ward">{(id) => <Input id={id} value={f.ward} onChange={(e) => set('ward', e.target.value)} />}</Field>
        <Field label="Encounter">{(id) => <Input id={id} value={f.encounter} onChange={(e) => set('encounter', e.target.value)} placeholder="e.g. Admission day 2" />}</Field>
        <Field label="Priority">
          {(id) => (
            <Select id={id} value={f.priority} onChange={(e) => set('priority', e.target.value as Priority)}>
              {PRIORITIES.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Age (years)">{(id) => <Input id={id} inputMode="numeric" value={f.age} onChange={(e) => set('age', e.target.value)} />}</Field>
        <Field label="Sex">
          {(id) => (
            <Select id={id} value={f.sex} onChange={(e) => set('sex', e.target.value as Sex)}>
              {['Unknown', 'Female', 'Male', 'Other'].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Weight (kg)">{(id) => <Input id={id} inputMode="decimal" value={f.weightKg} onChange={(e) => set('weightKg', e.target.value)} />}</Field>
        <Field label="Height (cm)">{(id) => <Input id={id} inputMode="decimal" value={f.heightCm} onChange={(e) => set('heightCm', e.target.value)} />}</Field>
        <Field label="Main clinical problem" className="sm:col-span-2">
          {(id) => <Input id={id} value={f.mainProblem} onChange={(e) => set('mainProblem', e.target.value)} />}
        </Field>
        <Checkbox className="sm:col-span-2" label="No known drug allergies (NKDA) confirmed" checked={f.nkda} onChange={(v) => set('nkda', v)} />
        <Checkbox className="sm:col-span-2" label="Diagnostics not applicable for this case" checked={f.diagnosticsNA} onChange={(v) => set('diagnosticsNA', v)} />
      </div>
    </Sheet>
  );
}

function toForm(r: CaseRecord) {
  return {
    department: r.department,
    ward: r.ward ?? '',
    encounter: r.encounter ?? '',
    age: r.age?.toString() ?? '',
    sex: (r.sex ?? 'Unknown') as Sex,
    weightKg: r.weightKg?.toString() ?? '',
    heightCm: r.heightCm?.toString() ?? '',
    mainProblem: r.mainProblem ?? '',
    priority: r.priority,
    nkda: Boolean(r.nkda),
    diagnosticsNA: Boolean(r.diagnosticsNotApplicable),
  };
}

export function CaseMenuSheet({ open, onClose, record }: { open: boolean; onClose: () => void; record: CaseRecord }) {
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState(false);
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (o) return;
        setConfirm(false);
        onClose();
      }}
      title={`${record.code} actions`}
    >
      <div className="grid gap-2">
        <Button variant="secondary" className="justify-start" onClick={async () => navigate(`/cases/${await duplicateCase(record.id)}`)}>
          <Copy /> Duplicate case
        </Button>
        <Button variant="secondary" className="justify-start" onClick={async () => downloadText(`${record.code}.json`, JSON.stringify(await exportCase(record.id), null, 2), 'application/json')}>
          <Download /> Export case (JSON)
        </Button>
        <Button variant="secondary" className="justify-start" onClick={async () => downloadText(`${record.code}-with-images.json`, JSON.stringify(await exportCase(record.id, true)), 'application/json')}>
          <Download /> Export case with images
        </Button>
        <Button variant="secondary" className="justify-start" onClick={async () => {
            await touchCase(record.id, { status: record.status === 'archived' ? 'active' : 'archived' });
            onClose();
          }}>
          <Archive /> {record.status === 'archived' ? 'Unarchive' : 'Archive'} case
        </Button>
        {!confirm ? (
          <Button variant="danger-soft" className="justify-start" onClick={() => setConfirm(true)}>
            <Trash2 /> Delete case
          </Button>
        ) : (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3">
            <p className="text-sm text-red-900">Permanently delete {record.code} and all its data from this device?</p>
            <div className="mt-2 flex gap-2">
              <Button
                variant="danger"
                size="sm"
                onClick={async () => {
                  await deleteCase(record.id);
                  navigate('/cases');
                }}
              >
                Delete permanently
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirm(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </Sheet>
  );
}
