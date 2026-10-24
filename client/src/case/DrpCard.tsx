import { BookMarked, ChevronDown, ChevronUp, MessagesSquare, ShieldCheck, Sparkles, Trash2, Wrench } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { discussionSchema, type Discussion } from '@shared/ai';
import { DRP_CATEGORY_LABEL, DRP_STATUS_LABEL, type DrpStatus } from '@shared/domain';
import { AIDraftBanner, AIErrorPanel, AILoading } from '@/components/AIBlocks';
import { Tag } from '@/components/Labels';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox, Select } from '@/components/ui/form';
import { aiRequest } from '@/lib/api';
import type { CaseBundle } from '@/lib/bundle';
import { buildCaseContext } from '@/lib/context';
import { audit, db } from '@/lib/db';
import { useAiRunner } from '@/lib/hooks';
import type { Drp } from '@/lib/types';
import { nowIso, pct } from '@/lib/utils';
import { demoOf, language, saveAnalysis } from './caseAi';
import { DialogueSheet } from './DialogueSheet';
import { EvidenceList, EvidenceSheet } from './EvidenceSheet';

const STATUS_TONE: Record<DrpStatus, 'green' | 'yellow' | 'neutral' | 'orange'> = { confirmed: 'green', possible: 'yellow', not_supported: 'neutral', needs_data: 'orange' };

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{title}</p>
      <div className="mt-0.5 text-sm text-navy-900">{children}</div>
    </div>
  );
}

export function DiscussionView({ d }: { d: Discussion }) {
  return (
    <div className="space-y-3">
      <Section title="1 · Problem">{d.problem}</Section>
      <Section title="2 · Patient-specific evidence">
        <ul className="list-disc pl-5">
          {d.patientEvidence.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      </Section>
      <Section title="3 · Assessment">{d.assessment}</Section>
      <Section title="4 · Evidence">
        <p>{d.evidenceSummary}</p>
        <p className="mt-1">
          <Badge tone="red">Source not verified</Badge> <span className="text-xs text-slate-600">Check: {d.referencesToConsult.join('; ') || 'an appropriate reference'}</span>
        </p>
      </Section>
      <Section title="5 · Options">
        <ul className="space-y-1.5">
          {d.options.map((o) => (
            <li key={o.option} className="rounded-lg bg-slate-50 p-2">
              <p className="font-semibold">{o.option}</p>
              {o.benefits.length > 0 && <p className="text-xs text-med-700">+ {o.benefits.join('; ')}</p>}
              {o.risks.length > 0 && <p className="text-xs text-red-700">− {o.risks.join('; ')}</p>}
            </li>
          ))}
        </ul>
      </Section>
      <Section title="6 · Recommendation draft">
        <p className="rounded-lg border border-violet-200 bg-violet-50 p-2">{d.recommendationDraft}</p>
      </Section>
      <Section title="7 · Rationale">{d.rationale}</Section>
      <Section title="8 · Monitoring">
        <ul className="list-disc pl-5">
          {d.monitoring.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      </Section>
      <Section title="9 · Follow-up">{d.followUp}</Section>
      {d.questionsForStudent.length > 0 && (
        <Section title="Think about">
          <ul className="list-disc pl-5">
            {d.questionsForStudent.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

export function DrpCard({ drp, bundle, onPlan }: { drp: Drp; bundle: CaseBundle; onPlan: (drpId: string) => void }) {
  const [open, setOpen] = useState(false);
  const [showDiscussion, setShowDiscussion] = useState(Boolean(drp.discussion));
  const [confirming, setConfirming] = useState(false);
  const [checked, setChecked] = useState(false);
  const [argue, setArgue] = useState(false);
  const [evidence, setEvidence] = useState(false);
  const ai = useAiRunner();

  const setStatus = async (status: DrpStatus) => {
    await db.drps.update(drp.id, { status, updatedAt: nowIso(), confirmedAt: status === 'confirmed' ? nowIso() : undefined });
    await audit('drp.status', { caseId: drp.caseId, detail: `${drp.category} → ${status}` });
  };

  const discuss = () =>
    ai.run(async () => {
      const { data, meta } = await aiRequest(
        'clinical-discussion',
        {
          context: buildCaseContext(bundle),
          drp: { category: drp.category, medication: drp.medication, condition: drp.condition, description: drp.description, patientEvidence: drp.patientEvidence, status: drp.status, studentReasoning: drp.studentReasoning },
          language: await language(),
        },
        discussionSchema,
        { demo: demoOf(bundle.case) },
      );
      await saveAnalysis(drp.caseId, 'clinical-discussion', data, meta);
      await db.drps.update(drp.id, { discussion: data, discussionProvider: meta.provider, updatedAt: nowIso() });
      setShowDiscussion(true);
    });

  return (
    <li className="rounded-2xl border border-slate-200 bg-white p-3" data-testid="drp-card">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone={STATUS_TONE[drp.status]}>{DRP_STATUS_LABEL[drp.status]}</Badge>
        <Badge tone={drp.priority === 'high' ? 'red' : drp.priority === 'medium' ? 'yellow' : 'neutral'}>{drp.priority}</Badge>
        {drp.origin === 'student' ? <Tag kind="student">Your DRP</Tag> : <Tag kind="ai_suggestion">{drp.origin === 'demo' ? 'Demo suggestion' : 'AI suggestion'}</Tag>}
        {drp.confidence !== undefined && <span className="text-xs text-slate-500">AI confidence {pct(drp.confidence)}</span>}
      </div>
      <p className="mt-1 font-semibold text-navy-900">
        {DRP_CATEGORY_LABEL[drp.category]}
        {drp.medication ? ` · ${drp.medication}` : ''}
        {drp.condition ? ` · ${drp.condition}` : ''}
      </p>
      <p className="text-sm text-slate-700">{drp.description}</p>
      {drp.patientEvidence.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {drp.patientEvidence.map((e) => (
            <span key={e} className="rounded-md bg-navy-50 px-2 py-0.5 text-xs text-navy-900">
              {e}
            </span>
          ))}
        </div>
      )}
      <button type="button" className="mt-2 flex items-center gap-1 text-sm font-semibold text-brand-600" onClick={() => setOpen((o) => !o)}>
        {open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />} {open ? 'Less' : 'Significance, evidence, action, monitoring'}
      </button>
      {open && (
        <div className="mt-2 space-y-2 rounded-xl bg-slate-50 p-3 text-sm">
          {drp.clinicalSignificance && <Section title="Clinical significance">{drp.clinicalSignificance}</Section>}
          {drp.evidenceBasis && (
            <Section title="Evidence">
              {drp.evidenceBasis} {drp.origin !== 'student' && <Badge tone="red">Source not verified</Badge>}
            </Section>
          )}
          {drp.suggestedAction && <Section title="Suggested action">{drp.suggestedAction}</Section>}
          {drp.monitoring && <Section title="Monitoring">{drp.monitoring}</Section>}
          {drp.followUp && <Section title="Follow-up">{drp.followUp}</Section>}
          {drp.missingData?.length ? <Section title="Missing data">{drp.missingData.join('; ')}</Section> : null}
          {drp.studentReasoning && <Section title="Your reasoning">{drp.studentReasoning}</Section>}
          <EvidenceList caseId={drp.caseId} drpId={drp.id} />
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Select className="min-h-10 w-auto" value={drp.status === 'confirmed' ? 'confirmed' : drp.status} onChange={(e) => (e.target.value === 'confirmed' ? setConfirming(true) : setStatus(e.target.value as DrpStatus))} aria-label="DRP status">
          <option value="possible">Possible</option>
          <option value="needs_data">Needs additional data</option>
          <option value="not_supported">Not supported</option>
          <option value="confirmed">Confirmed…</option>
        </Select>
        <Button size="sm" variant="brand" onClick={drp.discussion ? () => setShowDiscussion((s) => !s) : discuss} disabled={ai.loading}>
          <Sparkles /> {drp.discussion ? (showDiscussion ? 'Hide discussion' : 'Clinical discussion') : 'Clinical discussion'}
        </Button>
        <Button size="sm" variant="soft" onClick={() => setArgue(true)}>
          <MessagesSquare /> Argue with me
        </Button>
        <Button size="sm" variant="soft" onClick={() => setEvidence(true)}>
          <BookMarked /> Evidence
        </Button>
        <Button size="sm" variant="secondary" onClick={() => onPlan(drp.id)}>
          <Wrench /> Plan intervention
        </Button>
        <Button size="icon" variant="ghost" className="ml-auto text-red-700" aria-label="Delete DRP" onClick={() => db.drps.delete(drp.id)}>
          <Trash2 />
        </Button>
      </div>

      {confirming && (
        <div className="mt-3 rounded-xl border border-med-200 bg-med-50 p-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-med-700">
            <ShieldCheck className="size-4" /> Confirming a DRP is your clinical decision.
          </p>
          <Checkbox className="mt-1" label="I checked this against the patient’s verified data and an appropriate reference or local protocol." checked={checked} onChange={setChecked} />
          <div className="mt-2 flex gap-2">
            <Button
              size="sm"
              variant="med"
              disabled={!checked}
              onClick={async () => {
                await setStatus('confirmed');
                setConfirming(false);
              }}
            >
              Confirm DRP
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {ai.loading && <div className="mt-3"><AILoading label="Writing the clinical discussion…" /></div>}
      {ai.error && <div className="mt-3"><AIErrorPanel error={ai.error} onRetry={ai.retry} onManual={ai.reset} /></div>}
      {showDiscussion && drp.discussion && (
        <div className="mt-3 space-y-3 rounded-xl border border-violet-200 p-3">
          <AIDraftBanner provider={drp.discussionProvider} />
          <DiscussionView d={drp.discussion} />
          <p className="text-xs text-slate-500">The trainee and supervising clinicians remain responsible for verification and the final decision.</p>
          <Button size="sm" variant="ghost" onClick={discuss} disabled={ai.loading}>
            Regenerate
          </Button>
        </div>
      )}
      <DialogueSheet open={argue} onClose={() => setArgue(false)} bundle={bundle} mode="argue" drpId={drp.id} opener={drp.suggestedAction ? `I recommend: ${drp.suggestedAction}` : undefined} />
      <EvidenceSheet open={evidence} onClose={() => setEvidence(false)} caseId={drp.caseId} drpId={drp.id} />
    </li>
  );
}
