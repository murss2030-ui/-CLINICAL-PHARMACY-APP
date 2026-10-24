import { useLiveQuery } from 'dexie-react-hooks';
import { Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { SOURCE_TYPE_LABEL, type SourceType } from '@shared/domain';
import { departmentLabel } from '@shared/departments';
import { Button } from '@/components/ui/button';
import { Sheet } from '@/components/ui/sheet';
import { db } from '@/lib/db';

/** Every document belongs to a case: ask whether it goes to an existing case or a new one. */
export function ScanTargetSheet({ type, capture, onClose }: { type: SourceType | null; capture: 'camera' | 'manual'; onClose: () => void }) {
  const navigate = useNavigate();
  const cases = useLiveQuery(() => db.cases.where('status').equals('active').reverse().sortBy('updatedAt'), [], []);
  const go = (caseId: string) => navigate(`/cases/${caseId}?stage=collect&capture=${capture}&type=${type ?? 'patient_chart'}`);
  return (
    <Sheet
      open={type !== null}
      onOpenChange={(o) => !o && onClose()}
      title={capture === 'manual' ? 'Add data manually' : `Scan: ${type ? SOURCE_TYPE_LABEL[type] : ''}`}
      description="Documents always attach to a patient case. Add to an existing case, or start a new one."
    >
      <Button size="lg" className="w-full" onClick={() => navigate(`/cases/new?capture=${capture}&type=${type ?? 'patient_chart'}`)}>
        <Plus /> New case
      </Button>
      {cases.length > 0 && (
        <div className="mt-4 space-y-2">
          <p className="text-sm font-semibold text-slate-600">Or add to an active case</p>
          {cases.slice(0, 8).map((c) => (
            <button key={c.id} type="button" onClick={() => go(c.id)} className="flex min-h-14 w-full items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 text-left hover:bg-slate-50">
              <span className="font-bold text-navy-900">{c.code}</span>
              <span className="min-w-0 flex-1 truncate text-sm text-slate-600">
                {[c.age && `${c.age}y`, c.sex, departmentLabel(c.department), c.mainProblem].filter(Boolean).join(' · ')}
              </span>
            </button>
          ))}
        </div>
      )}
    </Sheet>
  );
}
