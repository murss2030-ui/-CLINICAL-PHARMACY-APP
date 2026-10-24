// VERIFICATION queue: every extracted field shows value, source, page,
// confidence and status. Nothing reaches official case data without a
// trainee decision. Handwriting is never silently guessed.
import { AlertOctagon, Check, Copy, PenLine, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { CONFIDENCE, confidenceBand } from '@shared/domain';
import { ConfidenceBadge } from '@/components/Labels';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox, Input, Select } from '@/components/ui/form';
import { EmptyState, Tabs } from '@/components/ui/misc';
import { activeConflict, describeMed } from '@/lib/dedupe';
import { sourceLabel } from '@/lib/pipeline';
import type { CaseSource, ExtractedItem, ExtractedKind } from '@/lib/types';
import { pct } from '@/lib/utils';
import { bulkEligible, rejectAllDuplicates, rejectItem, resolveConflict, verifyAllHighConfidence, verifyItem } from '@/lib/verify';

const KIND_LABEL: Record<ExtractedKind, string> = {
  demographic: 'Demographics',
  history: 'History',
  allergy: 'Allergies',
  nkda: 'Allergies',
  medication: 'Medications',
  lab: 'Laboratory',
  vital: 'Vital signs',
  diagnostic: 'Diagnostics',
  diagnosis: 'Diagnoses',
};

const FIELD_LABEL: Record<string, string> = {
  age: 'Age',
  sex: 'Sex',
  weight_kg: 'Weight',
  height_cm: 'Height',
  chief_complaint: 'Chief complaint',
  hpi: 'HPI',
  pmh: 'Past medical history',
  social_history: 'Social history',
  family_history: 'Family history',
  physical_exam: 'Physical examination',
  admission_date: 'Admission date',
};

export function itemTitle(i: ExtractedItem): string {
  const d = i.data;
  switch (i.kind) {
    case 'medication':
      return describeMed(d);
    case 'lab':
      return `${d.name}: ${d.value}${d.unit ? ` ${d.unit}` : ''}${d.takenAt ? ` · ${d.takenAt.replace('T', ' ')}` : ''}`;
    case 'vital':
      return `${d.type}: ${d.value}${d.unit ? ` ${d.unit}` : ''}${d.takenAt ? ` · ${d.takenAt.replace('T', ' ')}` : ''}`;
    case 'demographic':
      return `${FIELD_LABEL[d.field ?? ''] ?? d.field}: ${d.value}${d.unit ? ` ${d.unit}` : ''}`;
    case 'history':
      return `${FIELD_LABEL[d.key ?? ''] ?? d.key}: ${d.value}`;
    case 'allergy':
      return `Allergy: ${d.value}${d.reaction ? ` (${d.reaction})` : ''}`;
    case 'nkda':
      return 'No known drug allergies';
    case 'diagnostic':
      return `${d.type}: ${d.value}`;
    case 'diagnosis':
      return `Diagnosis: ${d.value}`;
  }
}

const EDIT_FIELDS: Record<ExtractedKind, Array<{ key: string; label: string }>> = {
  medication: [
    { key: 'name', label: 'Drug' },
    { key: 'dose', label: 'Dose' },
    { key: 'unit', label: 'Unit' },
    { key: 'route', label: 'Route' },
    { key: 'frequency', label: 'Frequency' },
    { key: 'indication', label: 'Indication' },
  ],
  lab: [
    { key: 'name', label: 'Test' },
    { key: 'value', label: 'Result' },
    { key: 'unit', label: 'Unit' },
    { key: 'takenAt', label: 'Collected (YYYY-MM-DDTHH:MM)' },
  ],
  vital: [
    { key: 'type', label: 'Vital' },
    { key: 'value', label: 'Value' },
    { key: 'unit', label: 'Unit' },
    { key: 'takenAt', label: 'Time' },
  ],
  demographic: [{ key: 'value', label: 'Value' }],
  history: [{ key: 'value', label: 'Text' }],
  allergy: [
    { key: 'value', label: 'Allergen' },
    { key: 'reaction', label: 'Reaction' },
  ],
  nkda: [],
  diagnostic: [
    { key: 'type', label: 'Test' },
    { key: 'value', label: 'Result' },
  ],
  diagnosis: [{ key: 'value', label: 'Diagnosis' }],
};

function ItemRow({ item, all, sources }: { item: ExtractedItem; all: ExtractedItem[]; sources: CaseSource[] }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string | undefined>>(item.data);
  const [confirmLow, setConfirmLow] = useState(false);
  const band = confidenceBand(item.confidence);
  const conflict = activeConflict(item, all);
  const duplicate = Boolean(item.duplicateOf || item.duplicateNote);
  const source = sources.find((s) => s.id === item.sourceId);
  const conflictPeers = (item.conflictWith ?? []).filter((id) => { const o = all.find((x) => x.id === id); return o !== undefined && o.status !== 'rejected'; });
  const mustOpen = band === 'low';

  const accept = async () => {
    if (conflict && conflictPeers.length) await resolveConflict(item.id, conflictPeers, editing ? draft : undefined);
    else await verifyItem(item.id, editing ? draft : undefined);
  };

  return (
    <li className={`rounded-xl border p-3 ${conflict ? 'border-red-300 bg-red-50/60' : band === 'low' ? 'border-amber-300 bg-amber-50/50' : 'border-slate-200 bg-white'}`} data-testid="verify-item">
      <p className="font-semibold break-words text-navy-900">{itemTitle(item)}</p>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        <ConfidenceBadge value={item.confidence} />
        {item.kind === 'medication' && item.data.listType && item.data.listType !== 'unknown' && <Badge tone="navy">{item.data.listType}</Badge>}
        {item.kind === 'medication' && item.data.status && !['active', 'unknown'].includes(item.data.status) && <Badge tone="yellow">{item.data.status}</Badge>}
        {item.handwritten && <Badge tone="purple">Handwriting</Badge>}
        {conflict && (
          <Badge tone="red">
            <AlertOctagon /> Conflict detected
          </Badge>
        )}
        {duplicate && !conflict && (
          <Badge tone="orange">
            <Copy /> Duplicate
          </Badge>
        )}
      </div>
      <p className="mt-0.5 text-xs text-slate-600">
        Source: {source ? sourceLabel(source) : 'unknown'}
        {item.page ? ` · page ${item.page}` : ''} · status: {conflict ? 'CONFLICT' : 'pending verification'}
      </p>
      {item.evidenceText && <p className="mt-1 border-l-2 border-slate-300 pl-2 text-xs italic text-slate-600">“{item.evidenceText}”</p>}
      {band !== 'high' && (
        <p className="mt-1 text-sm text-amber-900">
          {band === 'low' ? 'Low confidence — will not be committed without your explicit verification. ' : 'Review required. '}
          Possible reading: <strong>{item.kind === 'medication' ? describeMed(item.data) : item.kind === 'lab' ? `${item.data.name} ${item.data.value}${item.data.unit ? ` ${item.data.unit}` : ''}` : item.data.value}</strong> · confidence {pct(item.confidence)}
          {item.alternatives.length > 0 && <> · alternatives: {item.alternatives.join(', ')}</>}
        </p>
      )}
      {conflict && item.conflictNote && <p className="mt-1 text-sm font-semibold text-red-800">{item.conflictNote} Verify which value is correct — the app will not choose.</p>}
      {conflict && conflictPeers.some((id) => all.find((o) => o.id === id)?.status !== 'pending') && (
        <p className="mt-1 text-xs text-red-800">The other value is already verified. “Keep this value” retracts it from case data; “Reject” keeps the verified value.</p>
      )}
      {duplicate && !conflict && item.duplicateNote && <p className="mt-1 text-sm text-orange-800">{item.duplicateNote}</p>}

      {(editing || (mustOpen && confirmLow)) && (
        <div className="mt-2 space-y-2 rounded-lg bg-slate-50 p-2">
          {item.alternatives.length > 0 && (
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-xs font-semibold text-slate-600">Use alternative:</span>
              {item.alternatives.map((a) => (
                <Button key={a} size="sm" variant="secondary" onClick={() => setDraft((d) => ({ ...d, [item.kind === 'medication' ? 'name' : 'value']: a }))}>
                  {a}
                </Button>
              ))}
            </div>
          )}
          <div className="grid gap-2 sm:grid-cols-3">
            {EDIT_FIELDS[item.kind].map((f) => (
              <label key={f.key} className="text-xs font-semibold text-slate-600">
                {f.label}
                <Input className="mt-0.5 min-h-10" value={draft[f.key] ?? ''} onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))} />
              </label>
            ))}
            {item.kind === 'medication' && (
              <label className="text-xs font-semibold text-slate-600">
                List
                <Select className="mt-0.5 min-h-10" value={draft.listType ?? 'current'} onChange={(e) => setDraft((d) => ({ ...d, listType: e.target.value }))}>
                  {['home', 'admission', 'current', 'discharge'].map((l) => (
                    <option key={l}>{l}</option>
                  ))}
                </Select>
              </label>
            )}
          </div>
        </div>
      )}

      <div className="mt-2 flex flex-wrap gap-2">
        {mustOpen && !confirmLow && !editing ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setConfirmLow(true);
              setEditing(true);
            }}
          >
            <PenLine /> Verify
          </Button>
        ) : (
          <Button size="sm" variant="med" onClick={accept} aria-label={`Verify ${itemTitle(item)}`}>
            <Check /> {conflict ? 'Keep this value' : editing ? 'Save & verify' : 'Verify'}
          </Button>
        )}
        {!editing && (
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            <PenLine /> Edit
          </Button>
        )}
        <Button size="sm" variant="ghost" className="text-red-700" onClick={() => rejectItem(item.id, duplicate ? 'duplicate' : 'rejected')}>
          <X /> {duplicate && !conflict ? 'Discard duplicate' : 'Reject'}
        </Button>
      </div>
    </li>
  );
}

export function VerificationQueue({ caseId, items, sources }: { caseId: string; items: ExtractedItem[]; sources: CaseSource[] }) {
  const [tab, setTab] = useState<string>('all');
  const [showDecided, setShowDecided] = useState(false);
  const pending = items.filter((i) => i.status === 'pending');
  const kinds = useMemo(() => [...new Set(pending.map((i) => KIND_LABEL[i.kind]))], [pending]);
  const visible = pending.filter((i) => tab === 'all' || KIND_LABEL[i.kind] === tab);
  const eligible = pending.filter((i) => bulkEligible(i, items)).length;
  const dups = pending.filter((i) => (i.duplicateOf || i.duplicateNote) && !activeConflict(i, items)).length;
  const conflicts = pending.filter((i) => activeConflict(i, items)).length;
  const decided = items.filter((i) => i.status !== 'pending');

  if (items.length === 0) return null;
  return (
    <section className="space-y-3" aria-labelledby="verify-title">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1">
          <h3 id="verify-title" className="text-lg font-bold text-navy-900">
            Verification
          </h3>
          <p className="text-sm text-slate-600">
            {pending.length} pending · {conflicts} conflict(s) · high confidence ≥{CONFIDENCE.high * 100}% · review {CONFIDENCE.review * 100}–{CONFIDENCE.high * 100 - 1}% · below {CONFIDENCE.review * 100}% never auto-committed
          </p>
        </div>
        {eligible > 0 && (
          <Button size="sm" variant="med" onClick={() => verifyAllHighConfidence(caseId)}>
            <Check /> Verify all high-confidence ({eligible})
          </Button>
        )}
        {dups > 0 && (
          <Button size="sm" variant="secondary" onClick={() => rejectAllDuplicates(caseId)}>
            Discard duplicates ({dups})
          </Button>
        )}
      </div>
      {pending.length > 0 ? (
        <>
          <Tabs value={tab} onChange={setTab} items={[{ value: 'all', label: 'All', count: pending.length }, ...kinds.map((k) => ({ value: k, label: k, count: pending.filter((i) => KIND_LABEL[i.kind] === k).length }))]} />
          <ul className="space-y-2">
            {visible
              .sort((a, b) => Number(activeConflict(b, items)) - Number(activeConflict(a, items)) || a.confidence - b.confidence)
              .map((i) => (
                <ItemRow key={i.id} item={i} all={items} sources={sources} />
              ))}
          </ul>
        </>
      ) : (
        <EmptyState icon={<Check />} title="All extracted data has been reviewed">
          Verified values are now case data with their source and page attached.
        </EmptyState>
      )}
      {decided.length > 0 && (
        <div>
          <Checkbox label={`Show ${decided.length} decided item(s)`} checked={showDecided} onChange={setShowDecided} />
          {showDecided && (
            <ul className="mt-1 space-y-1 text-sm">
              {decided.map((i) => (
                <li key={i.id} className="flex items-center gap-2">
                  <Badge tone={i.status === 'rejected' ? 'red' : 'green'}>{i.status}</Badge>
                  <span className="truncate">{itemTitle(i)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
