import { useLiveQuery } from 'dexie-react-hooks';
import { Eye, FileImage, FileText, Mic, Sparkles, Trash2 } from 'lucide-react';
import { transcriptionSchema } from '@shared/ai';
import { useEffect, useState } from 'react';
import { SOURCE_TYPE_LABEL } from '@shared/domain';
import { AIErrorPanel, AILoading } from '@/components/AIBlocks';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/misc';
import { Sheet } from '@/components/ui/sheet';
import { aiRequest, AiError } from '@/lib/api';
import { blobToBase64 } from '@/lib/image';
import { audit, db } from '@/lib/db';
import { useSettings } from '@/lib/hooks';
import { analyzeSource, sourceLabel } from '@/lib/pipeline';
import type { CaseSource, ExtractedItem, ProcessingStatus } from '@/lib/types';
import { formatDate, nowIso, pct } from '@/lib/utils';
import { UNTRANSCRIBED } from './TextVoiceSheets';

const PROCESSING: Record<ProcessingStatus, { label: string; tone: 'neutral' | 'blue' | 'green' | 'red' | 'yellow' }> = {
  captured: { label: 'Not analysed', tone: 'neutral' },
  analyzing: { label: 'Reading pages…', tone: 'blue' },
  transcribed: { label: 'Transcribed', tone: 'blue' },
  extracting: { label: 'Extracting…', tone: 'blue' },
  extracted: { label: 'Extracted', tone: 'green' },
  failed: { label: 'AI failed', tone: 'red' },
};

function SourceViewer({ source, onClose }: { source: CaseSource | null; onClose: () => void }) {
  const images = useLiveQuery(async () => (source ? db.images.where('sourceId').equals(source.id).sortBy('order') : []), [source?.id], []);
  const [urls, setUrls] = useState<string[]>([]);
  useEffect(() => {
    const u = images.map((i) => URL.createObjectURL(i.blob));
    setUrls(u);
    return () => u.forEach((x) => URL.revokeObjectURL(x));
  }, [images]);
  const [audioUrl, setAudioUrl] = useState<string>();
  useEffect(() => {
    if (!source?.audio) return setAudioUrl(undefined);
    const u = URL.createObjectURL(source.audio);
    setAudioUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [source?.audio]);
  if (!source) return null;
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()} title={sourceLabel(source)} description={`${formatDate(source.date)} · ${source.pageCount || 0} page(s)`} wide>
      <div className="space-y-4">
        {audioUrl && <audio controls src={audioUrl} className="w-full" />}
        {source.text && (
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Text</p>
            <pre className="mt-1 whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-sm">{source.text}</pre>
          </div>
        )}
        {urls.map((u, i) => {
          const page = source.pages?.find((p) => p.page === i + 1);
          return (
            <div key={u} className="grid gap-3 md:grid-cols-2">
              <img src={u} alt={`Page ${i + 1}`} className="w-full rounded-lg border" />
              <div className="space-y-2 text-sm">
                <p className="font-semibold">Page {i + 1}</p>
                {page ? (
                  <>
                    <div className="flex flex-wrap gap-1">
                      {page.handwritten && <Badge tone="purple">Handwriting</Badge>}
                      {page.pageConfidence !== undefined && <Badge tone={page.pageConfidence >= 0.85 ? 'green' : page.pageConfidence >= 0.6 ? 'yellow' : 'red'}>Transcription {pct(page.pageConfidence)}</Badge>}
                      {page.qualityIssues?.map((q) => (
                        <Badge key={q} tone="yellow">
                          {q.replace('_', ' ')}
                        </Badge>
                      ))}
                    </div>
                    {page.uncertainReadings?.length ? (
                      <div className="rounded-lg border border-amber-200 bg-amber-50 p-2">
                        <p className="text-xs font-bold uppercase text-amber-900">Uncertain readings — verify</p>
                        {page.uncertainReadings.map((u2) => (
                          <p key={u2.text} className="text-xs text-amber-900">
                            Possible reading: <strong>{u2.bestReading}</strong> ({pct(u2.confidence)}){u2.alternatives.length ? ` · alternatives: ${u2.alternatives.join(', ')}` : ''}
                          </p>
                        ))}
                      </div>
                    ) : null}
                    <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-xs">{page.transcription}</pre>
                  </>
                ) : (
                  <p className="text-slate-500">Not analysed yet.</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Sheet>
  );
}

export function SourceCard({ source, items, autoAnalyse, onManual }: { source: CaseSource; items: ExtractedItem[]; autoAnalyse: boolean; onManual: () => void }) {
  const settings = useSettings();
  const [progress, setProgress] = useState('');
  const [error, setError] = useState<AiError>();
  const [running, setRunning] = useState(false);
  const [view, setView] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const pending = items.filter((i) => i.status === 'pending').length;
  const decided = items.length - pending;

  const run = async () => {
    setRunning(true);
    setError(undefined);
    try {
      await analyzeSource(source.id, { language: settings.language, onProgress: (p) => setProgress(p.detail) });
    } catch (e) {
      setError(e instanceof AiError ? e : new AiError('SERVER_ERROR'));
    } finally {
      setRunning(false);
      setProgress('');
    }
  };

  useEffect(() => {
    if (autoAnalyse) void run();
  }, [autoAnalyse]); // eslint-disable-line react-hooks/exhaustive-deps

  const needsTranscript = source.type === 'voice_note' && Boolean(source.audio) && (!source.text || source.text === UNTRANSCRIBED);
  const transcribe = async () => {
    if (!source.audio) return;
    setRunning(true);
    setError(undefined);
    setProgress('Transcribing voice note…');
    try {
      const record = await db.cases.get(source.caseId);
      const { data } = await aiRequest(
        'transcribe',
        { audio: { mimeType: 'audio/wav', data: await blobToBase64(source.audio) }, languageHint: 'mixed' },
        transcriptionSchema,
        { demo: record?.isDemo && record.demoKey ? { caseKey: record.demoKey } : undefined },
      );
      await db.sources.update(source.id, { text: data.transcript, updatedAt: nowIso() });
      await audit('source.transcribe', { caseId: source.caseId, detail: source.code });
    } catch (e) {
      setError(e instanceof AiError ? e : new AiError('SERVER_ERROR'));
    } finally {
      setRunning(false);
      setProgress('');
    }
  };

  const Icon = source.type === 'voice_note' ? Mic : source.pageCount ? FileImage : FileText;
  const p = PROCESSING[running ? 'analyzing' : source.processing];
  return (
    <Card className="p-3" data-testid="source-card">
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 size-6 shrink-0 text-navy-700" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-navy-900">
            {source.code} · {source.label || SOURCE_TYPE_LABEL[source.type]}
          </p>
          <p className="text-xs text-slate-600">
            {SOURCE_TYPE_LABEL[source.type]} · {formatDate(source.date)} · {source.pageCount ? `${source.pageCount} page(s)` : 'text'}
          </p>
          <div className="mt-1 flex flex-wrap gap-1">
            <Badge tone={p.tone}>{p.label}</Badge>
            {items.length > 0 && <Badge tone={pending ? 'yellow' : 'green'}>{pending ? `${pending} to verify` : 'All verified'}</Badge>}
            {decided > 0 && <Badge tone="neutral">{decided} decided</Badge>}
          </div>
          {source.summary && <p className="mt-1 text-xs text-slate-600">{source.summary}</p>}
        </div>
      </div>
      {running && <AILoading label={progress || 'Analysing…'} />}
      {error && !running && <div className="mt-3"><AIErrorPanel error={error} onRetry={run} onManual={onManual} /></div>}
      <div className="mt-2 flex flex-wrap gap-2">
        {needsTranscript ? (
          <Button size="sm" variant="brand" onClick={transcribe} disabled={running}>
            <Mic /> Transcribe
          </Button>
        ) : source.processing !== 'extracted' ? (
          <Button size="sm" variant="brand" onClick={run} disabled={running}>
            <Sparkles /> Analyse with AI
          </Button>
        ) : (
          <Button size="sm" variant="soft" onClick={run} disabled={running}>
            <Sparkles /> Re-analyse
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => setView(true)}>
          <Eye /> View
        </Button>
        {!confirmDelete ? (
          <Button size="sm" variant="ghost" className="text-red-700" onClick={() => setConfirmDelete(true)}>
            <Trash2 /> Delete
          </Button>
        ) : (
          <Button
            size="sm"
            variant="danger-soft"
            onClick={async () => {
              await db.transaction('rw', db.sources, db.images, db.extracted, async () => {
                await db.images.where('sourceId').equals(source.id).delete();
                await db.extracted.where('sourceId').equals(source.id).filter((e) => e.status === 'pending').delete();
                await db.sources.delete(source.id);
              });
              await audit('source.delete', { caseId: source.caseId, detail: source.code });
            }}
          >
            Confirm delete (verified data stays)
          </Button>
        )}
      </div>
      {view && <SourceViewer source={source} onClose={() => setView(false)} />}
    </Card>
  );
}

export function SourceLibrary({ sources, extracted, autoAnalyseId, onManual }: { sources: CaseSource[]; extracted: ExtractedItem[]; autoAnalyseId?: string; onManual: () => void }) {
  if (sources.length === 0)
    return (
      <EmptyState icon={<FileImage />} title="No sources yet">
        Photograph chart pages, add text or a voice note. Every source stays attached to this case — add more at any time.
      </EmptyState>
    );
  return (
    <div className="space-y-2">
      {sources.map((s) => (
        <SourceCard key={s.id} source={s} items={extracted.filter((e) => e.sourceId === s.id)} autoAnalyse={autoAnalyseId === s.id} onManual={onManual} />
      ))}
    </div>
  );
}
