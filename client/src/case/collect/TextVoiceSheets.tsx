import { Mic, Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { transcriptionSchema, type AIMeta } from '@shared/ai';
import { SOURCE_TYPE_LABEL, type SourceType } from '@shared/domain';
import { AIDraftBanner, AIErrorPanel, AILoading } from '@/components/AIBlocks';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Sheet } from '@/components/ui/sheet';
import { aiRequest } from '@/lib/api';
import { blobToBase64 } from '@/lib/image';
import { canRecord, startRecording, toWav16k } from '@/lib/audio';
import { audit, db, nextSourceCode, touchCase } from '@/lib/db';
import { useAiRunner } from '@/lib/hooks';
import type { CaseRecord } from '@/lib/types';
import { nowIso, todayIso, uid } from '@/lib/utils';

/** Text stored for a voice note that has not been transcribed yet. */
export const UNTRANSCRIBED = '(not yet transcribed)';

async function createTextSource(record: CaseRecord, type: SourceType, text: string, label?: string, audio?: Blob): Promise<string> {
  const id = uid();
  await db.sources.add({
    id,
    caseId: record.id,
    code: await nextSourceCode(record.id),
    type,
    label: label?.trim() || undefined,
    date: todayIso(),
    pageCount: 0,
    text,
    audio,
    audioMime: audio?.type,
    processing: 'captured',
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });
  await touchCase(record.id);
  await audit('source.text', { caseId: record.id, detail: SOURCE_TYPE_LABEL[type] });
  return id;
}

export function TextSourceSheet({ open, onClose, record, onSaved }: { open: boolean; onClose: () => void; record: CaseRecord; onSaved: (id: string, analyse: boolean) => void }) {
  const [type, setType] = useState<SourceType>('free_text');
  const [label, setLabel] = useState('');
  const [text, setText] = useState('');
  const save = async (analyse: boolean) => {
    if (!text.trim()) return;
    const id = await createTextSource(record, type, text.trim(), label);
    setText('');
    setLabel('');
    onSaved(id, analyse);
    onClose();
  };
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title="Add text source"
      description="Paste or type a note (English, Arabic or mixed). Do not include names or identifiers."
      footer={
        <>
          <Button variant="secondary" onClick={() => save(false)} disabled={!text.trim()}>
            Save only
          </Button>
          <Button variant="med" onClick={() => save(true)} disabled={!text.trim()}>
            Save & extract with AI
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="Type">
            {(id) => (
              <Select id={id} value={type} onChange={(e) => setType(e.target.value as SourceType)}>
                {Object.entries(SOURCE_TYPE_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Label (optional)">{(id) => <Input id={id} value={label} onChange={(e) => setLabel(e.target.value)} />}</Field>
        </div>
        <Field label="Text">{(id) => <Textarea id={id} rows={10} value={text} onChange={(e) => setText(e.target.value)} />}</Field>
      </div>
    </Sheet>
  );
}

/** VOICE → TRANSCRIPTION → STRUCTURING → EXTRACTION → VERIFICATION, with "What I heard" before saving. */
export function VoiceSheet({ open, onClose, record, onSaved }: { open: boolean; onClose: () => void; record: CaseRecord; onSaved: (id: string, analyse: boolean) => void }) {
  const [recording, setRecording] = useState<{ stop: () => Promise<Blob>; cancel: () => void } | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [wav, setWav] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string>();
  const [hint, setHint] = useState<'mixed' | 'en' | 'ar'>('mixed');
  const [transcript, setTranscript] = useState('');
  const [meta, setMeta] = useState<AIMeta>();
  const [micError, setMicError] = useState('');
  const ai = useAiRunner();
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!wav) return setUrl(undefined);
    const u = URL.createObjectURL(wav);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [wav]);
  useEffect(() => () => window.clearInterval(timer.current), []);

  const start = async () => {
    setMicError('');
    try {
      const r = await startRecording();
      setRecording(r);
      setSeconds(0);
      setTranscript('');
      setWav(null);
      timer.current = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch {
      setMicError('Microphone unavailable. Allow microphone access, or type the note instead.');
    }
  };
  const stop = async () => {
    if (!recording) return;
    window.clearInterval(timer.current);
    const blob = await recording.stop();
    setRecording(null);
    try {
      setWav(await toWav16k(blob));
    } catch {
      setMicError('Could not process the recording on this device.');
    }
  };
  const transcribe = () =>
    ai.run(async () => {
      if (!wav) return;
      const { data, meta: m } = await aiRequest('transcribe', { audio: { mimeType: 'audio/wav', data: await blobToBase64(wav) }, languageHint: hint }, transcriptionSchema, {
        demo: record.isDemo && record.demoKey ? { caseKey: record.demoKey } : undefined,
      });
      setTranscript(data.transcript);
      setMeta(m);
    });
  const save = async (analyse: boolean) => {
    const id = await createTextSource(record, 'voice_note', transcript.trim() || UNTRANSCRIBED, 'Voice note', wav ?? undefined);
    setWav(null);
    setTranscript('');
    onSaved(id, analyse && Boolean(transcript.trim()));
    onClose();
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (o) return;
        recording?.cancel();
        onClose();
      }}
      title="Voice note" description="Arabic, English or mixed medical terminology. You will see what was heard before anything is extracted.">
      <div className="space-y-3">
        {!canRecord() && <p className="text-sm text-amber-800">Audio recording is not supported in this browser. Use a text source instead.</p>}
        <Field label="Spoken language">
          {(id) => (
            <Select id={id} value={hint} onChange={(e) => setHint(e.target.value as typeof hint)}>
              <option value="mixed">Mixed Arabic + English</option>
              <option value="en">English</option>
              <option value="ar">Arabic</option>
            </Select>
          )}
        </Field>
        {!recording ? (
          <Button size="lg" className="w-full" onClick={start} disabled={!canRecord()}>
            <Mic /> {wav ? 'Record again' : 'Start recording'}
          </Button>
        ) : (
          <Button size="lg" variant="danger" className="w-full" onClick={stop}>
            <Square /> Stop ({seconds}s)
          </Button>
        )}
        {micError && <p className="text-sm text-red-700">{micError}</p>}
        {url && <audio controls src={url} className="w-full" />}
        {wav && !transcript && (
          <Button variant="brand" onClick={transcribe} disabled={ai.loading}>
            Transcribe with AI
          </Button>
        )}
        {ai.loading && <AILoading label="Transcribing…" />}
        {ai.error && <AIErrorPanel error={ai.error} onRetry={ai.retry} onManual={() => save(false)} />}
        {transcript && (
          <div className="space-y-2">
            <AIDraftBanner meta={meta} />
            <Field label="WHAT I HEARD (edit before saving)">{(id) => <Textarea id={id} rows={6} value={transcript} onChange={(e) => setTranscript(e.target.value)} />}</Field>
            <p className="text-xs text-slate-600">Next, “Save & extract” shows WHAT I EXTRACTED in the verification queue — nothing is added to case data until you verify it.</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="med" onClick={() => save(true)}>
                Save & extract
              </Button>
              <Button variant="secondary" onClick={() => save(false)}>
                Save transcript only
              </Button>
            </div>
          </div>
        )}
        {wav && !transcript && !ai.loading && (
          <Button variant="ghost" onClick={() => save(false)}>
            Save recording to transcribe later
          </Button>
        )}
      </div>
    </Sheet>
  );
}
