// ROUND ASSISTANT: before (brief), during (quick notes) and after rounds
// (AI structuring into changes, decisions, follow-ups and tasks).
import { useLiveQuery } from 'dexie-react-hooks';
import { ListChecks, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { roundNoteSchema } from '@shared/ai';
import { AIDraftBanner, AIErrorPanel, AILoading } from '@/components/AIBlocks';
import { SeverityBox } from '@/components/Labels';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/form';
import { SectionTitle, Tabs } from '@/components/ui/misc';
import { aiRequest } from '@/lib/api';
import { activeMeds, type CaseBundle } from '@/lib/bundle';
import { buildCaseContext } from '@/lib/context';
import { dataCheck } from '@/lib/datacheck';
import { audit, db } from '@/lib/db';
import { useAiRunner, useSettings } from '@/lib/hooks';
import { safetyAlerts } from '@/lib/safety';
import type { RoundEntry } from '@/lib/types';
import { addDays, formatDateTime, nowIso, todayIso, uid } from '@/lib/utils';
import { demoOf, language } from './caseAi';
import { createFollowUp } from './FollowUpStage';

function Brief({ bundle }: { bundle: CaseBundle }) {
  const alerts = safetyAlerts(bundle);
  const critical = alerts.filter((a) => a.category === 'critical_lab');
  const risks = alerts.filter((a) => a.category !== 'critical_lab' && a.severity !== 'blue').slice(0, 5);
  const missing = dataCheck(bundle).filter((d) => d.state !== 'known');
  const due = bundle.followups.filter((f) => f.status === 'pending' && (!f.dueDate || f.dueDate <= todayIso()));
  return (
    <div className="space-y-3 text-sm">
      <p>
        <strong>{bundle.case.code}</strong> · {bundle.case.mainProblem || 'main problem not set'}
      </p>
      <div>
        <SectionTitle>Main problems</SectionTitle>
        <p>{bundle.problems.filter((p) => p.status !== 'resolved').map((p) => p.name).join(' · ') || '—'}</p>
      </div>
      <div>
        <SectionTitle>Active medications</SectionTitle>
        <p>{activeMeds(bundle).map((m) => m.name).join(' · ') || '—'}</p>
      </div>
      <div className="space-y-1.5">
        <SectionTitle>Critical labs</SectionTitle>
        {critical.length ? critical.map((a) => <SeverityBox key={a.id} severity={a.severity} title={a.title} />) : <p>None flagged.</p>}
      </div>
      <div>
        <SectionTitle>Pending investigations / missing data</SectionTitle>
        <p>{missing.map((m) => m.label).join(' · ') || 'None'}</p>
      </div>
      <div className="space-y-1.5">
        <SectionTitle>Medication risks</SectionTitle>
        {risks.length ? risks.map((a) => <SeverityBox key={a.id} severity={a.severity} title={a.title} />) : <p>None flagged.</p>}
      </div>
      <div>
        <SectionTitle>Follow-ups due</SectionTitle>
        <p>{due.map((f) => f.parameter).join(' · ') || 'None'}</p>
      </div>
    </div>
  );
}

export function RoundsPanel({ bundle }: { bundle: CaseBundle }) {
  const [tab, setTab] = useState<'before' | 'during' | 'after'>('before');
  const [text, setText] = useState('');
  const settings = useSettings();
  const ai = useAiRunner();
  const entries = useLiveQuery(() => db.rounds.where('caseId').equals(bundle.case.id).reverse().sortBy('createdAt'), [bundle.case.id], []);
  const save = async () => {
    if (!text.trim()) return;
    await db.rounds.add({ id: uid(), caseId: bundle.case.id, text: text.trim(), createdAt: nowIso() });
    await audit('rounds.note', { caseId: bundle.case.id });
    setText('');
  };
  const structure = (e: RoundEntry) =>
    ai.run(async () => {
      const { data, meta } = await aiRequest('round-note', { context: buildCaseContext(bundle), text: e.text, language: await language() }, roundNoteSchema, { demo: demoOf(bundle.case) });
      await db.rounds.update(e.id, { structured: data, provider: meta.provider });
    });
  const toTasks = async (e: RoundEntry) => {
    for (const t of e.structured?.tasks ?? []) await db.tasks.add({ id: uid(), caseId: bundle.case.id, title: t, priority: 'medium', dueDate: todayIso(), owner: settings.ownerName || undefined, status: 'open', origin: 'round', createdAt: nowIso() });
    for (const f of e.structured?.followUpsRequired ?? []) await createFollowUp(bundle.case.id, { window: 'next_review', dueDate: addDays(1), parameter: f, origin: 'student' }, settings.ownerName, false);
    await audit('rounds.convert', { caseId: bundle.case.id });
  };
  return (
    <div className="space-y-3">
      <Tabs value={tab} onChange={setTab} items={[{ value: 'before', label: 'Before rounds' }, { value: 'during', label: 'During rounds' }, { value: 'after', label: 'After rounds' }]} />
      {tab === 'before' && <Brief bundle={bundle} />}
      {tab === 'during' && (
        <div className="space-y-2">
          <p className="text-sm text-slate-600">Quick notes during rounds. For photos or dictation use Collect → Camera / Voice (they stay attached to this case).</p>
          <Textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder="What changed? Decisions? Medication changes?" aria-label="Round note" />
          <Button onClick={save} disabled={!text.trim()}>
            Save round note
          </Button>
        </div>
      )}
      {tab === 'after' && (
        <div className="space-y-3">
          {entries.length === 0 && <p className="text-sm text-slate-600">No round notes yet.</p>}
          {ai.loading && <AILoading label="Structuring round note…" />}
          {ai.error && <AIErrorPanel error={ai.error} onRetry={ai.retry} onManual={ai.reset} />}
          {entries.map((e) => (
            <div key={e.id} className="space-y-2 rounded-xl border border-slate-200 p-3 text-sm">
              <p className="text-xs text-slate-500">{formatDateTime(e.createdAt)}</p>
              <p className="whitespace-pre-line">{e.text}</p>
              {!e.structured ? (
                <Button size="sm" variant="brand" onClick={() => structure(e)} disabled={ai.loading}>
                  <Sparkles /> What changed? Structure with AI
                </Button>
              ) : (
                <div className="space-y-1.5">
                  <AIDraftBanner provider={e.provider} />
                  {[
                    ['What changed', e.structured.changes],
                    ['Medication changes', e.structured.medicationChanges.map((m) => `${m.medication}: ${m.change}`)],
                    ['Decisions', e.structured.decisions],
                    ['Possible new DRPs (assess in Assess)', e.structured.possibleNewDrps],
                    ['Follow-up required', e.structured.followUpsRequired],
                    ['Tasks', e.structured.tasks],
                  ].map(([title, list]) =>
                    (list as string[]).length ? (
                      <div key={title as string}>
                        <p className="font-semibold text-navy-900">{title as string}</p>
                        <ul className="list-disc pl-5">
                          {(list as string[]).map((x) => (
                            <li key={x}>{x}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null,
                  )}
                  <Button size="sm" variant="secondary" onClick={() => toTasks(e)}>
                    <ListChecks /> Create tasks & follow-ups
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
