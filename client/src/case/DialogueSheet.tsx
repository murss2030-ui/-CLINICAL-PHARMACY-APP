// "Argue with me" and "Head of Clinical Pharmacy" defence: Socratic dialogue
// focused on reasoning, one challenge at a time.
import { useLiveQuery } from 'dexie-react-hooks';
import { Gavel, MessagesSquare, Send } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { argueTurnSchema } from '@shared/ai';
import { AIDraftBanner, AIErrorPanel, AILoading } from '@/components/AIBlocks';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/form';
import { Sheet } from '@/components/ui/sheet';
import { aiRequest } from '@/lib/api';
import type { CaseBundle } from '@/lib/bundle';
import { buildCaseContext } from '@/lib/context';
import { audit, db } from '@/lib/db';
import { useAiRunner } from '@/lib/hooks';
import { recordGaps } from '@/lib/learning';
import type { Dialogue } from '@/lib/types';
import { cn, nowIso, uid } from '@/lib/utils';
import { demoOf, language } from './caseAi';

export function DialogueSheet({ open, onClose, bundle, mode, drpId, opener }: { open: boolean; onClose: () => void; bundle: CaseBundle; mode: 'argue' | 'defense'; drpId?: string; opener?: string }) {
  const dialogue = useLiveQuery(
    async () => (await db.dialogues.where('caseId').equals(bundle.case.id).filter((d) => d.mode === mode && d.drpId === drpId && !d.done).toArray()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0],
    [bundle.case.id, mode, drpId],
  );
  const [text, setText] = useState('');
  const ai = useAiRunner();
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Block body: newer browsers return a Promise from scrollIntoView, which must not become the effect cleanup.
    void end.current?.scrollIntoView({ block: 'end' });
  }, [dialogue?.turns.length]);
  useEffect(() => {
    if (open && !dialogue && opener) setText(opener);
  }, [open, dialogue, opener]);

  const send = () =>
    ai.run(async () => {
      const said = text.trim();
      if (!said) return;
      let d: Dialogue = dialogue ?? { id: uid(), caseId: bundle.case.id, mode, drpId, turns: [], done: false, createdAt: nowIso(), updatedAt: nowIso() };
      d = { ...d, turns: [...d.turns, { role: 'student', text: said }], updatedAt: nowIso() };
      await db.dialogues.put(d);
      setText('');
      const { data, meta } = await aiRequest('teaching', { mode, context: buildCaseContext(bundle), history: d.turns, language: await language() }, argueTurnSchema, { demo: demoOf(bundle.case) });
      const reply = [data.acknowledgement, data.challenge].filter(Boolean).join('\n\n');
      d = { ...d, turns: [...d.turns, { role: 'preceptor', text: reply }], done: data.done, summary: data.summary, provider: meta.provider, updatedAt: nowIso() };
      await db.dialogues.put(d);
      if (data.done) {
        await audit(`dialogue.${mode}.complete`, { caseId: bundle.case.id });
        if (data.summary?.gaps.length) await recordGaps(data.summary.gaps.slice(0, 3).map((g) => ({ topic: g, domain: 'clinical_reasoning' as const })), mode === 'argue' ? 'Argue with me' : 'Presentation defence');
      }
    });

  const Icon = mode === 'argue' ? MessagesSquare : Gavel;
  const title = mode === 'argue' ? 'Argue with me' : 'Head of Clinical Pharmacy — presentation defence';
  const starter = mode === 'argue' ? 'State your recommendation, e.g. “I recommend stopping enoxaparin.”' : 'Summarise your case and main recommendation in 2–3 sentences to begin the defence.';
  const turns = dialogue?.turns ?? [];
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()} title={title} description="The preceptor challenges your reasoning, not just your answer." wide>
      <div className="space-y-3">
        {dialogue?.provider && <AIDraftBanner provider={dialogue.provider} />}
        {turns.length === 0 && (
          <p className="flex items-center gap-2 rounded-xl bg-navy-50 p-3 text-sm text-navy-900">
            <Icon className="size-5" /> {starter}
          </p>
        )}
        <div className="space-y-2">
          {turns.map((t, i) => (
            <div key={i} className={cn('max-w-[90%] whitespace-pre-line rounded-2xl px-3 py-2 text-sm', t.role === 'student' ? 'ml-auto bg-brand-600 text-white' : 'bg-slate-100 text-navy-900')}>
              <p className="mb-0.5 text-[0.7rem] font-bold uppercase opacity-70">{t.role === 'student' ? 'You' : 'Preceptor'}</p>
              {t.text}
            </div>
          ))}
          <div ref={end} />
        </div>
        {ai.loading && <AILoading label="Preceptor is thinking…" />}
        {ai.error && <AIErrorPanel error={ai.error} onRetry={ai.retry} onManual={ai.reset} />}
        {dialogue?.done && dialogue.summary ? (
          <div className="rounded-xl border border-med-200 bg-med-50 p-3 text-sm">
            <p className="font-bold text-med-700">Dialogue summary</p>
            {dialogue.summary.strengths.length > 0 && <p className="mt-1">Strengths: {dialogue.summary.strengths.join('; ')}</p>}
            {dialogue.summary.gaps.length > 0 && <p>Gaps: {dialogue.summary.gaps.join('; ')}</p>}
            {dialogue.summary.learningPoint && <p className="mt-1 font-semibold">Learning point: {dialogue.summary.learningPoint}</p>}
          </div>
        ) : (
          <div className="flex gap-2">
            <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Your answer…" aria-label="Your answer" />
            <Button className="self-end" onClick={send} disabled={ai.loading || !text.trim()} aria-label="Send">
              <Send />
            </Button>
          </div>
        )}
      </div>
    </Sheet>
  );
}
