import { useLiveQuery } from 'dexie-react-hooks';
import { Archive, ArchiveRestore, Copy, Download, FileUp, Plus, Search, Trash2 } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { DEPARTMENT_LIST, departmentLabel } from '@shared/departments';
import { STAGE_INFO } from '@shared/domain';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/form';
import { EmptyState } from '@/components/ui/misc';
import { Sheet } from '@/components/ui/sheet';
import { db, deleteCase, duplicateCase, exportCase, importCase, touchCase } from '@/lib/db';
import type { CaseRecord } from '@/lib/types';
import { downloadText, formatDate } from '@/lib/utils';

const PRIORITY_TONE = { high: 'red', medium: 'yellow', low: 'neutral' } as const;

export default function CasesPage() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [dept, setDept] = useState('');
  const [status, setStatus] = useState<'active' | 'completed' | 'archived' | 'all'>('active');
  const [confirmDelete, setConfirmDelete] = useState<CaseRecord | null>(null);
  const [importError, setImportError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const cases = useLiveQuery(() => db.cases.toArray(), [], []);
  const followups = useLiveQuery(() => db.followups.where('status').equals('pending').toArray(), [], []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return cases
      .filter((c) => status === 'all' || c.status === status)
      .filter((c) => !dept || c.department === dept)
      .filter((c) => !needle || [c.code, c.mainProblem, c.ward, departmentLabel(c.department)].some((v) => v?.toLowerCase().includes(needle)))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [cases, q, dept, status]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="flex-1 text-2xl font-bold text-navy-900">Cases</h1>
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            try {
              const id = await importCase(JSON.parse(await f.text()));
              navigate(`/cases/${id}`);
            } catch (err) {
              setImportError((err as Error).message);
            }
          }}
        />
        <Button variant="secondary" onClick={() => fileRef.current?.click()}>
          <FileUp /> Import
        </Button>
        <Button asChild>
          <Link to="/cases/new">
            <Plus /> New case
          </Link>
        </Button>
      </div>
      {importError && <p className="text-sm text-red-700">Import failed: {importError}</p>}

      <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-slate-400" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search code, problem, ward…" className="pl-10" aria-label="Search cases" />
        </div>
        <Select value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Filter by department">
          <option value="">All departments</option>
          {DEPARTMENT_LIST.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
        </Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label="Filter by status">
          <option value="active">Active</option>
          <option value="completed">Completed</option>
          <option value="archived">Archived</option>
          <option value="all">All statuses</option>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="No cases" action={<Button asChild><Link to="/cases/new">Create a case</Link></Button>}>
          Create a case with an anonymous code, or load a synthetic demo case from Home.
        </EmptyState>
      ) : (
        <div className="space-y-2">
          {filtered.map((c) => {
            const pending = followups.filter((f) => f.caseId === c.id).length;
            return (
              <Card key={c.id} className="p-3">
                <div className="flex items-start gap-3">
                  <button type="button" onClick={() => navigate(`/cases/${c.id}`)} className="min-w-0 flex-1 text-left">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-bold text-navy-900">{c.code}</span>
                      <Badge tone={PRIORITY_TONE[c.priority]}>{c.priority}</Badge>
                      <Badge tone="navy">{STAGE_INFO[c.stage].label}</Badge>
                      {c.status !== 'active' && <Badge>{c.status}</Badge>}
                      {c.isDemo && <Badge tone="orange">Demo</Badge>}
                      {pending > 0 && <Badge tone="yellow">{pending} follow-up{pending > 1 ? 's' : ''}</Badge>}
                    </div>
                    <p className="mt-1 truncate text-sm font-semibold text-navy-900">{c.mainProblem || 'Main problem not set'}</p>
                    <p className="text-xs text-slate-600">
                      {[c.age !== undefined && `${c.age} y`, c.sex, departmentLabel(c.department), c.ward].filter(Boolean).join(' · ')} · updated {formatDate(c.updatedAt)}
                    </p>
                  </button>
                  <div className="flex shrink-0 flex-col gap-1 sm:flex-row">
                    <Button size="icon" variant="ghost" aria-label={`Duplicate ${c.code}`} onClick={async () => navigate(`/cases/${await duplicateCase(c.id)}`)}>
                      <Copy />
                    </Button>
                    <Button size="icon" variant="ghost" aria-label={`Export ${c.code}`} onClick={async () => downloadText(`${c.code}.json`, JSON.stringify(await exportCase(c.id), null, 2), 'application/json')}>
                      <Download />
                    </Button>
                    <Button size="icon" variant="ghost" aria-label={c.status === 'archived' ? `Unarchive ${c.code}` : `Archive ${c.code}`} onClick={() => touchCase(c.id, { status: c.status === 'archived' ? 'active' : 'archived' })}>
                      {c.status === 'archived' ? <ArchiveRestore /> : <Archive />}
                    </Button>
                    <Button size="icon" variant="ghost" className="text-red-700" aria-label={`Delete ${c.code}`} onClick={() => setConfirmDelete(c)}>
                      <Trash2 />
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Sheet
        open={confirmDelete !== null}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
        title={`Delete ${confirmDelete?.code}?`}
        description="This permanently removes the case, its images and all linked data from this device."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                if (confirmDelete) await deleteCase(confirmDelete.id);
                setConfirmDelete(null);
              }}
            >
              <Trash2 /> Delete case
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-700">Export the case first if you need to keep it for your portfolio.</p>
      </Sheet>
    </div>
  );
}
