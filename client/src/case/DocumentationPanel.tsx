import { useLiveQuery } from 'dexie-react-hooks';
import { Copy, Download } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Tabs } from '@/components/ui/misc';
import type { CaseBundle } from '@/lib/bundle';
import { db } from '@/lib/db';
import { dischargeNote, drpInterventionNote, followUpNote, medRecNote, monitoringNote, oneMinuteSummary, pharmacistHandover, soapNote } from '@/lib/notes';
import { copyText, downloadText } from '@/lib/utils';

type Doc = 'soap' | 'drp' | 'medrec' | 'monitoring' | 'followup' | 'discharge' | 'summary' | 'handover';

export function DocumentationPanel({ bundle }: { bundle: CaseBundle }) {
  const [doc, setDoc] = useState<Doc>('soap');
  const [copied, setCopied] = useState(false);
  const decisions = useLiveQuery(() => db.recon.where('caseId').equals(bundle.case.id).toArray(), [bundle.case.id], []);
  const text = {
    soap: soapNote(bundle),
    drp: drpInterventionNote(bundle),
    medrec: medRecNote(bundle, decisions),
    monitoring: monitoringNote(bundle),
    followup: followUpNote(bundle),
    discharge: dischargeNote(bundle),
    summary: oneMinuteSummary(bundle),
    handover: pharmacistHandover(bundle),
  }[doc];
  return (
    <div className="space-y-3">
      <Tabs
        value={doc}
        onChange={(d) => {
          setDoc(d);
          setCopied(false);
        }}
        items={[
          { value: 'soap', label: 'SOAP' },
          { value: 'drp', label: 'DRP / intervention' },
          { value: 'medrec', label: 'Med rec' },
          { value: 'monitoring', label: 'Monitoring' },
          { value: 'followup', label: 'Follow-up' },
          { value: 'discharge', label: 'Discharge' },
          { value: 'summary', label: 'One-minute summary' },
          { value: 'handover', label: 'Handover' },
        ]}
      />
      <pre className="max-h-[55dvh] overflow-auto whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-sm text-navy-900" data-testid="doc-text">
        {text}
      </pre>
      <div className="flex gap-2">
        <Button variant="secondary" onClick={async () => setCopied(await copyText(text))}>
          <Copy /> {copied ? 'Copied' : 'Copy'}
        </Button>
        <Button variant="ghost" onClick={() => downloadText(`${bundle.case.code}-${doc}.txt`, text)}>
          <Download /> Download
        </Button>
      </div>
      <p className="text-xs text-slate-500">Generated only from data in this case. Review and edit in your institution’s record system as required.</p>
    </div>
  );
}
