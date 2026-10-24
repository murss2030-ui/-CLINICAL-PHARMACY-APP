import { Keyboard, Mic, PenSquare } from 'lucide-react';
import { useState } from 'react';
import { SOURCE_TYPE_LABEL, SOURCE_TYPES, type SourceType } from '@shared/domain';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Select } from '@/components/ui/form';
import { SectionTitle } from '@/components/ui/misc';
import { PrivacyNotice } from '@/pages/HomePage';
import type { CaseBundle } from '@/lib/bundle';
import { CaptureTray } from './CaptureTray';
import { DataCheckPanel } from './DataCheckPanel';
import { ManualEntrySheet } from './ManualEntry';
import { SourceLibrary } from './SourceLibrary';
import { TextSourceSheet, VoiceSheet } from './TextVoiceSheets';
import { VerificationQueue } from './VerificationQueue';

export function CollectStage({ bundle, initialCapture, initialType, onNext }: { bundle: CaseBundle; initialCapture: string | null; initialType: string | null; onNext: () => void }) {
  const [type, setType] = useState<SourceType>(SOURCE_TYPES.includes(initialType as SourceType) ? (initialType as SourceType) : 'patient_chart');
  const [manual, setManual] = useState(initialCapture === 'manual');
  const [text, setText] = useState(false);
  const [voice, setVoice] = useState(false);
  const [autoAnalyseId, setAutoAnalyseId] = useState<string>();
  const pending = bundle.extracted.filter((e) => e.status === 'pending').length;

  const saved = (id: string, analyse: boolean) => {
    if (analyse) setAutoAnalyseId(id);
  };

  return (
    <div className="space-y-5">
      <PrivacyNotice compact />
      <Card>
        <CardHeader title="Add to this case" subtitle="Photograph pages, add text or dictate. Documents found later are added here — never as a new case." />
        <CardBody className="space-y-3">
          <label className="block text-sm font-semibold text-navy-900">
            Document type
            <Select className="mt-1" value={type} onChange={(e) => setType(e.target.value as SourceType)}>
              {SOURCE_TYPES.filter((t) => t !== 'voice_note').map((t) => (
                <option key={t} value={t}>
                  {SOURCE_TYPE_LABEL[t]}
                </option>
              ))}
            </Select>
          </label>
          <CaptureTray caseId={bundle.case.id} type={type} onTypeChange={setType} onSaved={saved} autoFocusCamera={initialCapture === 'camera'} />
          <div className="grid grid-cols-3 gap-2">
            <Button variant="soft" onClick={() => setText(true)}>
              <Keyboard /> Text
            </Button>
            <Button variant="soft" onClick={() => setVoice(true)}>
              <Mic /> Voice
            </Button>
            <Button variant="soft" onClick={() => setManual(true)}>
              <PenSquare /> Manual
            </Button>
          </div>
        </CardBody>
      </Card>

      <section>
        <SectionTitle>Source library ({bundle.sources.length})</SectionTitle>
        <SourceLibrary sources={bundle.sources} extracted={bundle.extracted} autoAnalyseId={autoAnalyseId} onManual={() => setManual(true)} />
      </section>

      <VerificationQueue caseId={bundle.case.id} items={bundle.extracted} sources={bundle.sources} />

      <DataCheckPanel bundle={bundle} />

      <div className="rounded-2xl border border-navy-200 bg-navy-50 p-4 text-sm text-navy-900">
        {pending > 0 ? (
          <p>
            <strong>{pending} extracted item(s)</strong> still need verification. You can move on and return later — unverified data is never used as patient fact.
          </p>
        ) : (
          <p>When you know enough to describe the patient, move on: “What is happening with this patient?”</p>
        )}
        <Button className="mt-2" onClick={onNext}>
          Continue to Understand
        </Button>
      </div>

      <ManualEntrySheet open={manual} onClose={() => setManual(false)} record={bundle.case} />
      <TextSourceSheet open={text} onClose={() => setText(false)} record={bundle.case} onSaved={saved} />
      <VoiceSheet open={voice} onClose={() => setVoice(false)} record={bundle.case} onSaved={saved} />
    </div>
  );
}
