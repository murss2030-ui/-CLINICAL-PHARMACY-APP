// Evidence records are entered by the trainee for sources they actually
// checked. The AI never supplies citations; its statements stay "SOURCE NOT VERIFIED".
import { useLiveQuery } from 'dexie-react-hooks';
import { ExternalLink, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Sheet } from '@/components/ui/sheet';
import { audit, db } from '@/lib/db';
import type { EvidenceRecord } from '@/lib/types';
import { formatDate, nowIso, todayIso, uid } from '@/lib/utils';

const TYPES: Record<EvidenceRecord['sourceType'], string> = {
  guideline: 'Guideline',
  drug_reference: 'Drug reference',
  study: 'Study',
  systematic_review: 'Systematic review',
  protocol: 'Institutional protocol',
  other: 'Other',
};

export function EvidenceList({ caseId, drpId }: { caseId: string; drpId?: string }) {
  const rows = useLiveQuery(() => db.evidence.where('caseId').equals(caseId).filter((e) => !drpId || e.drpId === drpId).toArray(), [caseId, drpId], []);
  if (!rows.length) return null;
  return (
    <ul className="space-y-1.5">
      {rows.map((e) => (
        <li key={e.id} className="rounded-lg border border-med-200 bg-med-50/50 p-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="green">Checked by you · {formatDate(e.dateChecked)}</Badge>
            <Badge tone="navy">{TYPES[e.sourceType]}</Badge>
            <span className="font-semibold">{e.title}</span>
            {e.year && <span className="text-slate-600">({e.year})</span>}
            {e.url && (
              <a href={e.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-brand-600 underline">
                link <ExternalLink className="size-3" />
              </a>
            )}
            <button type="button" className="ml-auto text-red-700" aria-label="Delete evidence" onClick={() => db.evidence.delete(e.id)}>
              <Trash2 className="size-4" />
            </button>
          </div>
          {e.citation && <p className="text-xs text-slate-600">{e.citation}</p>}
          {e.application && <p className="mt-0.5 text-slate-800">Application to this patient: {e.application}</p>}
        </li>
      ))}
    </ul>
  );
}

export function EvidenceSheet({ open, onClose, caseId, drpId }: { open: boolean; onClose: () => void; caseId: string; drpId?: string }) {
  const [f, setF] = useState({ sourceType: 'guideline' as EvidenceRecord['sourceType'], title: '', year: '', citation: '', url: '', dateChecked: todayIso(), application: '' });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = async () => {
    if (!f.title.trim()) return;
    await db.evidence.add({ id: uid(), caseId, drpId, ...f, title: f.title.trim(), createdAt: nowIso() });
    await audit('evidence.add', { caseId, detail: f.title });
    setF((x) => ({ ...x, title: '', year: '', citation: '', url: '', application: '' }));
  };
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()} title="Evidence" description="Record only sources you actually checked. Never cite something you have not read." wide footer={<Button onClick={save} disabled={!f.title.trim()}>Add evidence</Button>}>
      <div className="space-y-3">
        <EvidenceList caseId={caseId} drpId={drpId} />
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="Source type">
            {(id) => (
              <Select id={id} value={f.sourceType} onChange={set('sourceType')}>
                {Object.entries(TYPES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Title">{(id) => <Input id={id} value={f.title} onChange={set('title')} />}</Field>
          <Field label="Year">{(id) => <Input id={id} value={f.year} onChange={set('year')} inputMode="numeric" />}</Field>
          <Field label="Date checked">{(id) => <Input id={id} type="date" value={f.dateChecked} onChange={set('dateChecked')} />}</Field>
          <Field label="Citation" className="sm:col-span-2">{(id) => <Input id={id} value={f.citation} onChange={set('citation')} />}</Field>
          <Field label="URL" className="sm:col-span-2">{(id) => <Input id={id} value={f.url} onChange={set('url')} type="url" />}</Field>
          <Field label="How does this evidence apply to this patient?" className="sm:col-span-2">{(id) => <Textarea id={id} value={f.application} onChange={set('application')} />}</Field>
        </div>
      </div>
    </Sheet>
  );
}
