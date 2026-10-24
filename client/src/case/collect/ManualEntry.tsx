// Manual structured entry. Data typed by the trainee is a documented fact
// (origin "manual", verified) and works fully offline.
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/form';
import { Tabs } from '@/components/ui/misc';
import { Sheet } from '@/components/ui/sheet';
import { touchCase } from '@/lib/db';
import type { CaseRecord, MedList, ProfileKey } from '@/lib/types';
import { addManual } from '@/lib/verify';

type TabKey = 'medication' | 'lab' | 'vital' | 'allergy' | 'history' | 'problem' | 'diagnostic';

const HISTORY_KEYS: Array<{ key: ProfileKey; label: string }> = [
  { key: 'chief_complaint', label: 'Chief complaint' },
  { key: 'hpi', label: 'History of present illness' },
  { key: 'pmh', label: 'Past medical history' },
  { key: 'social_history', label: 'Social history' },
  { key: 'family_history', label: 'Family history' },
  { key: 'physical_exam', label: 'Physical examination' },
  { key: 'admission_date', label: 'Admission date' },
];


export function ManualEntrySheet({ open, onClose, record, initialTab = 'medication' }: { open: boolean; onClose: () => void; record: CaseRecord; initialTab?: TabKey }) {
  const [tab, setTab] = useState<TabKey>(initialTab);
  const [f, setF] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState('');
  const v = (k: string) => f[k] ?? '';
  const set = (k: string) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const caseId = record.id;

  const save = async () => {
    const t = (k: string) => v(k).trim() || undefined;
    switch (tab) {
      case 'medication':
        if (!t('name')) return;
        await addManual('medications', { caseId, name: t('name')!, dose: t('dose'), unit: t('unit'), route: t('route'), frequency: t('frequency'), indication: t('indication'), list: (t('list') ?? 'current') as MedList, status: (t('status') ?? 'active') as 'active' });
        break;
      case 'lab':
        if (!t('name') || !t('value')) return;
        await addManual('labs', { caseId, name: t('name')!, value: t('value')!, unit: t('unit'), refRange: t('refRange'), takenAt: t('takenAt') });
        break;
      case 'vital':
        if (!t('type') || !t('value')) return;
        await addManual('vitals', { caseId, type: t('type')!, value: t('value')!, unit: t('unit'), takenAt: t('takenAt') });
        break;
      case 'allergy':
        if (!t('substance')) return;
        await addManual('allergies', { caseId, substance: t('substance')!, reaction: t('reaction'), severity: t('severity') });
        break;
      case 'history':
        if (!t('text')) return;
        await addManual('profiles', { caseId, key: (t('key') ?? 'hpi') as ProfileKey, value: t('text')! });
        break;
      case 'problem':
        if (!t('problem')) return;
        await addManual('problems', { caseId, name: t('problem')!, status: 'active', origin: 'student', rationale: t('rationale') });
        break;
      case 'diagnostic':
        if (!t('type') || !t('result')) return;
        await addManual('diagnostics', { caseId, type: t('type')!, result: t('result')!, date: t('date') });
        break;
    }
    setSaved(`Saved to case (${tab}).`);
    setF((x) => ({ key: x.key ?? '', list: x.list ?? '' }));
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Manual entry"
      description="Typed data is recorded as a verified patient fact entered by you. Works offline."
      wide
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Done
          </Button>
          <Button onClick={save}>Add to case</Button>
        </>
      }
    >
      <div className="space-y-3">
        <Tabs
          value={tab}
          onChange={(x) => {
            setTab(x);
            setSaved('');
          }}
          items={[
            { value: 'medication', label: 'Medication' },
            { value: 'lab', label: 'Lab' },
            { value: 'vital', label: 'Vital' },
            { value: 'allergy', label: 'Allergy' },
            { value: 'history', label: 'History' },
            { value: 'problem', label: 'Problem' },
            { value: 'diagnostic', label: 'Diagnostic' },
          ]}
        />
        {saved && <p className="rounded-lg bg-med-50 px-3 py-2 text-sm font-semibold text-med-700" role="status">{saved}</p>}
        {tab === 'medication' && (
          <div className="grid gap-2 sm:grid-cols-3">
            <Field label="Drug name">{(id) => <Input id={id} value={v('name')} onChange={set('name')} />}</Field>
            <Field label="Dose">{(id) => <Input id={id} value={v('dose')} onChange={set('dose')} placeholder="5" />}</Field>
            <Field label="Unit">{(id) => <Input id={id} value={v('unit')} onChange={set('unit')} placeholder="mg" />}</Field>
            <Field label="Route">{(id) => <Input id={id} value={v('route')} onChange={set('route')} placeholder="PO" />}</Field>
            <Field label="Frequency">{(id) => <Input id={id} value={v('frequency')} onChange={set('frequency')} placeholder="once daily" />}</Field>
            <Field label="Indication">{(id) => <Input id={id} value={v('indication')} onChange={set('indication')} />}</Field>
            <Field label="List">
              {(id) => (
                <Select id={id} value={v('list') || 'current'} onChange={set('list')}>
                  <option value="home">Home (pre-admission)</option>
                  <option value="admission">Admission</option>
                  <option value="current">Current inpatient</option>
                  <option value="discharge">Discharge</option>
                </Select>
              )}
            </Field>
            <Field label="Status">
              {(id) => (
                <Select id={id} value={v('status') || 'active'} onChange={set('status')}>
                  <option value="active">Active</option>
                  <option value="held">Held</option>
                  <option value="stopped">Stopped</option>
                </Select>
              )}
            </Field>
          </div>
        )}
        {tab === 'lab' && (
          <div className="grid gap-2 sm:grid-cols-3">
            <Field label="Test">{(id) => <Input id={id} value={v('name')} onChange={set('name')} placeholder="Creatinine" />}</Field>
            <Field label="Result">{(id) => <Input id={id} value={v('value')} onChange={set('value')} />}</Field>
            <Field label="Unit">{(id) => <Input id={id} value={v('unit')} onChange={set('unit')} placeholder="mg/dL" />}</Field>
            <Field label="Reference range">{(id) => <Input id={id} value={v('refRange')} onChange={set('refRange')} />}</Field>
            <Field label="Collected">{(id) => <Input id={id} type="datetime-local" value={v('takenAt')} onChange={set('takenAt')} />}</Field>
          </div>
        )}
        {tab === 'vital' && (
          <div className="grid gap-2 sm:grid-cols-4">
            <Field label="Vital">
              {(id) => (
                <Select id={id} value={v('type')} onChange={set('type')}>
                  <option value="">Select…</option>
                  {['BP', 'HR', 'RR', 'Temp', 'SpO2', 'Weight', 'Pain', 'Urine output'].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Value">{(id) => <Input id={id} value={v('value')} onChange={set('value')} />}</Field>
            <Field label="Unit">{(id) => <Input id={id} value={v('unit')} onChange={set('unit')} />}</Field>
            <Field label="Time">{(id) => <Input id={id} type="datetime-local" value={v('takenAt')} onChange={set('takenAt')} />}</Field>
          </div>
        )}
        {tab === 'allergy' && (
          <div className="space-y-2">
            <div className="grid gap-2 sm:grid-cols-3">
              <Field label="Allergen">{(id) => <Input id={id} value={v('substance')} onChange={set('substance')} />}</Field>
              <Field label="Reaction">{(id) => <Input id={id} value={v('reaction')} onChange={set('reaction')} placeholder="rash, anaphylaxis…" />}</Field>
              <Field label="Severity">{(id) => <Input id={id} value={v('severity')} onChange={set('severity')} />}</Field>
            </div>
            <Checkbox label="No known drug allergies (NKDA) — confirmed" checked={Boolean(record.nkda)} onChange={(x) => touchCase(caseId, { nkda: x })} />
          </div>
        )}
        {tab === 'history' && (
          <div className="space-y-2">
            <Field label="Section">
              {(id) => (
                <Select id={id} value={v('key') || 'hpi'} onChange={set('key')}>
                  {HISTORY_KEYS.map((h) => (
                    <option key={h.key} value={h.key}>
                      {h.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Text">{(id) => <Textarea id={id} value={v('text')} onChange={set('text')} rows={4} />}</Field>
          </div>
        )}
        {tab === 'problem' && (
          <div className="grid gap-2">
            <Field label="Clinical problem">{(id) => <Input id={id} value={v('problem')} onChange={set('problem')} />}</Field>
            <Field label="Supporting data (optional)">{(id) => <Textarea id={id} value={v('rationale')} onChange={set('rationale')} />}</Field>
          </div>
        )}
        {tab === 'diagnostic' && (
          <div className="grid gap-2 sm:grid-cols-3">
            <Field label="Test">{(id) => <Input id={id} value={v('type')} onChange={set('type')} placeholder="ECG, CXR, culture…" />}</Field>
            <Field label="Result" className="sm:col-span-2">{(id) => <Input id={id} value={v('result')} onChange={set('result')} />}</Field>
            <Field label="Date">{(id) => <Input id={id} type="date" value={v('date')} onChange={set('date')} />}</Field>
          </div>
        )}
      </div>
    </Sheet>
  );
}
