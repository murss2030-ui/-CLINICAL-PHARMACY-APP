import { useLiveQuery } from 'dexie-react-hooks';
import { ClipboardList, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PRIORITIES, type Priority } from '@shared/domain';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/form';
import { EmptyState, SectionTitle, Tabs } from '@/components/ui/misc';
import { FollowUpRow } from '@/case/FollowUpStage';
import { audit, db } from '@/lib/db';
import { useSettings } from '@/lib/hooks';
import type { Task } from '@/lib/types';
import { formatDate, nowIso, todayIso, uid } from '@/lib/utils';

const EXAMPLES = ['Review renal function', 'Check culture', 'Verify allergy', 'Follow potassium', 'Discuss recommendation', 'Counsel patient', 'Prepare presentation'];

export default function TasksPage() {
  const settings = useSettings();
  const [filter, setFilter] = useState<'open' | 'done' | 'all'>('open');
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ title: '', caseId: '', priority: 'medium' as Priority, dueDate: todayIso(), owner: '' });
  const tasks = useLiveQuery(() => db.tasks.toArray(), [], []);
  const cases = useLiveQuery(() => db.cases.toArray(), [], []);
  const followups = useLiveQuery(() => db.followups.where('status').equals('pending').toArray(), [], []);
  const code = (id?: string) => cases.find((c) => c.id === id)?.code;
  const visible = tasks
    .filter((t) => (filter === 'all' ? true : filter === 'open' ? t.status === 'open' || t.status === 'in_progress' : t.status === 'done' || t.status === 'cancelled'))
    .sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority));

  const add = async () => {
    if (!f.title.trim()) return;
    await db.tasks.add({ id: uid(), title: f.title.trim(), caseId: f.caseId || undefined, priority: f.priority, dueDate: f.dueDate || undefined, owner: f.owner || settings.ownerName || undefined, status: 'open', origin: 'manual', createdAt: nowIso() });
    await audit('task.add', { caseId: f.caseId || undefined, detail: f.title });
    setF((x) => ({ ...x, title: '' }));
    setAdding(false);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <h1 className="flex-1 text-2xl font-bold text-navy-900">My clinical tasks</h1>
        <Button onClick={() => setAdding((a) => !a)}>
          <Plus /> Task
        </Button>
      </div>
      {adding && (
        <Card className="space-y-3 p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Task" className="sm:col-span-2">
              {(id) => (
                <>
                  <Input id={id} list="task-examples" value={f.title} onChange={(e) => setF((x) => ({ ...x, title: e.target.value }))} />
                  <datalist id="task-examples">
                    {EXAMPLES.map((e) => (
                      <option key={e} value={e} />
                    ))}
                  </datalist>
                </>
              )}
            </Field>
            <Field label="Case">
              {(id) => (
                <Select id={id} value={f.caseId} onChange={(e) => setF((x) => ({ ...x, caseId: e.target.value }))}>
                  <option value="">— none —</option>
                  {cases.filter((c) => c.status === 'active').map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} {c.mainProblem ? `· ${c.mainProblem}` : ''}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Priority">
              {(id) => (
                <Select id={id} value={f.priority} onChange={(e) => setF((x) => ({ ...x, priority: e.target.value as Priority }))}>
                  {PRIORITIES.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Due date">{(id) => <Input id={id} type="date" value={f.dueDate} onChange={(e) => setF((x) => ({ ...x, dueDate: e.target.value }))} />}</Field>
            <Field label="Owner">{(id) => <Input id={id} value={f.owner} placeholder={settings.ownerName || 'me'} onChange={(e) => setF((x) => ({ ...x, owner: e.target.value }))} />}</Field>
          </div>
          <Button onClick={add} disabled={!f.title.trim()}>
            Add task
          </Button>
        </Card>
      )}
      <Tabs value={filter} onChange={setFilter} items={[{ value: 'open', label: 'Open', count: tasks.filter((t) => t.status === 'open' || t.status === 'in_progress').length }, { value: 'done', label: 'Done' }, { value: 'all', label: 'All' }]} />
      {visible.length === 0 ? (
        <EmptyState icon={<ClipboardList />} title="No tasks">Tasks are created from follow-ups and rounds, or added here.</EmptyState>
      ) : (
        <ul className="space-y-2">
          {visible.map((t) => {
            const overdue = t.status !== 'done' && t.dueDate && t.dueDate < todayIso();
            return (
              <Card key={t.id} className="p-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone={t.priority === 'high' ? 'red' : t.priority === 'medium' ? 'yellow' : 'neutral'}>{t.priority}</Badge>
                  {t.dueDate && <Badge tone={overdue ? 'red' : 'neutral'}>{overdue ? 'Overdue · ' : ''}{formatDate(t.dueDate)}</Badge>}
                  {t.caseId && (
                    <Link to={`/cases/${t.caseId}?stage=followup`} className="text-xs font-semibold text-brand-600 underline">
                      {code(t.caseId)}
                    </Link>
                  )}
                  {t.owner && <span className="text-xs text-slate-500">Owner: {t.owner}</span>}
                  <Badge tone="outline">{t.origin}</Badge>
                </div>
                <p className={`mt-1 font-semibold ${t.status === 'done' ? 'text-slate-500 line-through' : 'text-navy-900'}`}>{t.title}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Select
                    className="min-h-10 w-auto"
                    value={t.status}
                    onChange={(e) => db.tasks.update(t.id, { status: e.target.value as Task['status'], completedAt: e.target.value === 'done' ? nowIso() : undefined })}
                    aria-label="Task status"
                  >
                    <option value="open">Open</option>
                    <option value="in_progress">In progress</option>
                    <option value="done">Done</option>
                    <option value="cancelled">Cancelled</option>
                  </Select>
                  <Input className="min-h-10 min-w-40 flex-1" defaultValue={t.outcome ?? ''} placeholder="Outcome" onBlur={(e) => db.tasks.update(t.id, { outcome: e.target.value })} aria-label="Task outcome" />
                  <Button size="icon" variant="ghost" className="text-red-700" aria-label="Delete task" onClick={() => db.tasks.delete(t.id)}>
                    <Trash2 />
                  </Button>
                </div>
              </Card>
            );
          })}
        </ul>
      )}
      {followups.length > 0 && (
        <section>
          <SectionTitle>Pending follow-ups across cases ({followups.length})</SectionTitle>
          <ul className="space-y-2">
            {followups
              .sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'))
              .map((x) => (
                <div key={x.id}>
                  <Link to={`/cases/${x.caseId}?stage=followup`} className="text-xs font-semibold text-brand-600 underline">
                    {code(x.caseId)}
                  </Link>
                  <FollowUpRow f={x} />
                </div>
              ))}
          </ul>
        </section>
      )}
    </div>
  );
}
