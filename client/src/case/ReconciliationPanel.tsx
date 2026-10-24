import { useLiveQuery } from 'dexie-react-hooks';
import { Badge } from '@/components/ui/badge';
import { Checkbox, Input, Select } from '@/components/ui/form';
import { EmptyState } from '@/components/ui/misc';
import type { CaseBundle } from '@/lib/bundle';
import { audit, db } from '@/lib/db';
import { DISCREPANCY_LABEL, reconcile } from '@/lib/reconciliation';
import type { Medication, ReconDecision } from '@/lib/types';
import { nowIso, uid } from '@/lib/utils';

const show = (m?: Medication) => (m ? [m.dose && `${m.dose}${m.unit ? ` ${m.unit}` : ''}`, m.route, m.frequency, m.status !== 'active' && m.status !== 'unknown' ? m.status : ''].filter(Boolean).join(' ') || '✓' : '—');

export function ReconciliationPanel({ bundle }: { bundle: CaseBundle }) {
  const rows = reconcile(bundle.meds);
  const decisions = useLiveQuery(() => db.recon.where('caseId').equals(bundle.case.id).toArray(), [bundle.case.id], []);
  const save = async (key: string, patch: Partial<ReconDecision>) => {
    const existing = decisions.find((d) => d.key === key);
    if (existing) await db.recon.update(existing.id, { ...patch, updatedAt: nowIso() });
    else await db.recon.add({ id: uid(), caseId: bundle.case.id, key, classification: 'uncertain', verified: false, ...patch, updatedAt: nowIso() });
    await audit('medrec.classify', { caseId: bundle.case.id, detail: key });
  };
  const lists = new Set(bundle.meds.filter((m) => m.prov.verification !== 'rejected').map((m) => m.list));
  if (rows.length === 0) return <EmptyState title="No medications to reconcile">Add the home (pre-admission) list and the inpatient list in Collect.</EmptyState>;
  const total = rows.reduce((n, r) => n + r.discrepancies.length, 0);
  const classified = decisions.filter((d) => d.verified).length;
  return (
    <div className="space-y-3">
      {!lists.has('home') && <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-900">No home medication list recorded — obtain a best possible medication history first.</p>}
      <p className="text-sm text-slate-700">
        {total} discrepancy(ies) · {classified} verified by you. Classify each as intentional, potentially unintentional or uncertain.
      </p>
      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full min-w-[46rem] text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Medication</th>
              <th className="px-3 py-2">Home</th>
              <th className="px-3 py-2">Admission / current</th>
              <th className="px-3 py-2">Discharge</th>
              <th className="px-3 py-2">Discrepancies & pharmacist verification</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.key} className="align-top">
                <td className="px-3 py-2 font-semibold text-navy-900">{r.name}</td>
                <td className="px-3 py-2">{show(r.home)}</td>
                <td className="px-3 py-2">{show(r.inpatient)}</td>
                <td className="px-3 py-2">{show(r.discharge)}</td>
                <td className="space-y-2 px-3 py-2">
                  {r.discrepancies.length === 0 && <Badge tone="green">No discrepancy</Badge>}
                  {r.discrepancies.map((d) => {
                    const dec = decisions.find((x) => x.key === d.key);
                    return (
                      <div key={d.key} className="rounded-lg bg-slate-50 p-2" data-testid="recon-discrepancy">
                        <p>
                          <Badge tone="orange">{DISCREPANCY_LABEL[d.type]}</Badge> <span className="text-xs text-slate-500">{d.transition.replace('_', ' ')}</span>
                        </p>
                        <p className="text-xs text-slate-700">{d.detail}</p>
                        <div className="mt-1 flex flex-wrap gap-2">
                          <Select className="min-h-9 w-auto text-sm" value={dec?.classification ?? 'uncertain'} onChange={(e) => save(d.key, { classification: e.target.value as ReconDecision['classification'] })} aria-label={`Classify ${r.name} ${d.type}`}>
                            <option value="uncertain">Uncertain</option>
                            <option value="intentional">Intentional</option>
                            <option value="potentially_unintentional">Potentially unintentional</option>
                          </Select>
                          <Input className="min-h-9 flex-1 text-sm" defaultValue={dec?.note ?? ''} placeholder="Note" onBlur={(e) => save(d.key, { note: e.target.value })} aria-label="Reconciliation note" />
                        </div>
                        <Checkbox className="min-h-9" label="Verified by pharmacist" checked={Boolean(dec?.verified)} onChange={(v) => save(d.key, { verified: v })} />
                      </div>
                    );
                  })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
