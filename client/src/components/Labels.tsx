// Visual vocabulary that keeps facts, evidence, interpretation and AI output distinguishable.
import type { ReactNode } from 'react';
import { AlertTriangle, Bot, CheckCircle2, CircleHelp, FileText, Info, PenLine, ShieldAlert, Sparkles, UserRound } from 'lucide-react';
import { confidenceBand, uncertaintyLabel } from '@shared/domain';
import { Badge } from '@/components/ui/badge';
import type { Provenance } from '@/lib/types';
import type { Severity } from '@/lib/safety';
import { cn, pct } from '@/lib/utils';

export type TagKind =
  | 'patient_fact'
  | 'verified'
  | 'documented'
  | 'source_evidence'
  | 'interpretation'
  | 'ai_suggestion'
  | 'ai_inference'
  | 'requires_verification'
  | 'missing'
  | 'student'
  | 'demo';

const TAGS: Record<TagKind, { label: string; tone: 'green' | 'navy' | 'blue' | 'purple' | 'yellow' | 'red' | 'neutral' | 'orange'; icon: typeof Info }> = {
  patient_fact: { label: 'Patient fact', tone: 'green', icon: UserRound },
  verified: { label: 'Verified', tone: 'green', icon: CheckCircle2 },
  documented: { label: 'Documented', tone: 'navy', icon: FileText },
  source_evidence: { label: 'Source evidence', tone: 'navy', icon: FileText },
  interpretation: { label: 'Clinical interpretation', tone: 'blue', icon: PenLine },
  ai_suggestion: { label: 'AI suggestion', tone: 'purple', icon: Sparkles },
  ai_inference: { label: 'AI inference', tone: 'purple', icon: Bot },
  requires_verification: { label: 'Requires verification', tone: 'yellow', icon: AlertTriangle },
  missing: { label: 'Missing data', tone: 'red', icon: CircleHelp },
  student: { label: 'Student decision', tone: 'blue', icon: PenLine },
  demo: { label: 'Synthetic demo', tone: 'orange', icon: Info },
};

export function Tag({ kind, className, children }: { kind: TagKind; className?: string; children?: ReactNode }) {
  const t = TAGS[kind];
  const Icon = t.icon;
  return (
    <Badge tone={t.tone} className={className}>
      <Icon aria-hidden />
      {children ?? t.label}
    </Badge>
  );
}

export function ProvenanceTag({ prov }: { prov: Provenance }) {
  if (prov.verification === 'rejected') return <Badge tone="red">Rejected</Badge>;
  if (prov.verification === 'pending' || prov.verification === 'conflict') return <Tag kind="requires_verification" />;
  if (prov.origin === 'manual') return <Tag kind="patient_fact">Entered · verified</Tag>;
  return <Tag kind="verified">{prov.verification === 'corrected' ? 'Verified · corrected' : 'Verified'}</Tag>;
}

export function SourceLine({ prov, className }: { prov: Provenance; className?: string }) {
  if (prov.origin === 'manual') return <span className={cn('text-xs text-slate-500', className)}>Manual entry</span>;
  return (
    <span className={cn('text-xs text-slate-500', className)}>
      {prov.sourceLabel ?? 'Source'}
      {prov.page ? ` · page ${prov.page}` : ''}
      {prov.confidence !== undefined ? ` · extraction confidence ${pct(prov.confidence)}` : ''}
    </span>
  );
}

export function ConfidenceBadge({ value }: { value: number }) {
  const band = confidenceBand(value);
  const tone = band === 'high' ? 'green' : band === 'review' ? 'yellow' : 'red';
  return (
    <Badge tone={tone} title={band === 'high' ? 'High confidence (≥85%)' : band === 'review' ? 'Review required (60–84%)' : 'Low confidence (<60%) — not committed automatically'}>
      {pct(value)} · {uncertaintyLabel(value)}
    </Badge>
  );
}

const SEVERITY: Record<Severity, { label: string; cls: string; dot: string }> = {
  red: { label: 'Urgent verification', cls: 'border-red-300 bg-red-50 text-red-900', dot: 'bg-red-600' },
  orange: { label: 'Important review', cls: 'border-orange-300 bg-orange-50 text-orange-900', dot: 'bg-orange-500' },
  yellow: { label: 'Review', cls: 'border-amber-300 bg-amber-50 text-amber-900', dot: 'bg-amber-400' },
  blue: { label: 'Educational', cls: 'border-sky-300 bg-sky-50 text-sky-900', dot: 'bg-sky-500' },
};

export function SeverityBox({ severity, title, children }: { severity: Severity; title: ReactNode; children?: ReactNode }) {
  const s = SEVERITY[severity];
  return (
    <div className={cn('rounded-xl border px-3 py-2.5', s.cls)} role={severity === 'red' ? 'alert' : undefined}>
      <div className="flex items-start gap-2">
        <span className={cn('mt-1.5 size-2.5 shrink-0 rounded-full', s.dot)} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            <span className="sr-only">{s.label}: </span>
            {title}
          </p>
          {children && <div className="mt-0.5 text-sm opacity-90">{children}</div>}
        </div>
        <span className="hidden shrink-0 text-[0.7rem] font-bold uppercase tracking-wide opacity-70 sm:inline">{s.label}</span>
      </div>
    </div>
  );
}

export function SafetyFooter() {
  return (
    <p className="flex items-start gap-1.5 text-xs text-slate-500">
      <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      Decision support for education. Verify against authoritative references and local protocols; the trainee and supervising clinicians remain responsible for every decision.
    </p>
  );
}
