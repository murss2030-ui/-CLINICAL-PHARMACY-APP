import { CheckCircle2, CircleHelp, TriangleAlert } from 'lucide-react';
import { departmentLabel } from '@shared/departments';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import type { CaseBundle } from '@/lib/bundle';
import { dataCheck, type DataState } from '@/lib/datacheck';
import { cn } from '@/lib/utils';

const STATE: Record<DataState, { label: string; icon: typeof CheckCircle2; cls: string }> = {
  known: { label: 'Known', icon: CheckCircle2, cls: 'text-med-700' },
  needs_verification: { label: 'Needs verification', icon: TriangleAlert, cls: 'text-amber-700' },
  missing: { label: 'Missing', icon: CircleHelp, cls: 'text-red-700' },
};

export function DataCheckPanel({ bundle }: { bundle: CaseBundle }) {
  const items = dataCheck(bundle);
  const counts = { known: 0, needs_verification: 0, missing: 0 } as Record<DataState, number>;
  items.forEach((i) => counts[i.state]++);
  return (
    <Card>
      <CardHeader
        title="Data check before assessment"
        subtitle={`${departmentLabel(bundle.case.department)} priorities · ${counts.known} known · ${counts.needs_verification} need verification · ${counts.missing} missing`}
      />
      <CardBody>
        <ul className="divide-y divide-slate-100">
          {items.map((i) => {
            const s = STATE[i.state];
            return (
              <li key={i.key} className="py-2.5">
                <div className="flex items-start gap-2">
                  <s.icon className={cn('mt-0.5 size-5 shrink-0', s.cls)} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-navy-900">
                      {i.label} <span className={cn('ml-1 text-xs font-bold uppercase', s.cls)}>{s.label}</span>
                    </p>
                    {i.value && <p className="text-sm text-slate-700">{i.value}</p>}
                    {i.state !== 'known' && (
                      <p className="mt-0.5 text-sm text-slate-600">
                        <span className="font-semibold">Why does this matter? </span>
                        {i.why}
                      </p>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </CardBody>
    </Card>
  );
}
