import { ArrowLeft, ArrowRight, Calculator, ClipboardCheck, FileText, MoreHorizontal, Pencil, Sparkles, Stethoscope } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { departmentLabel } from '@shared/departments';
import { CASE_MODES, STAGE_INFO, STAGES, type CaseMode, type StageId } from '@shared/domain';
import { AIErrorPanel, AILoading } from '@/components/AIBlocks';
import { Stepper } from '@/components/Stepper';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody } from '@/components/ui/card';
import { EmptyState, Progress, Spinner } from '@/components/ui/misc';
import { Sheet } from '@/components/ui/sheet';
import { ActStage } from '@/case/ActStage';
import { AssessStage } from '@/case/AssessStage';
import { CaseDetailsSheet, CaseMenuSheet } from '@/case/CaseHeaderSheets';
import { runCaseAction } from '@/case/caseAi';
import { CalculatorsPanel } from '@/case/CalculatorsPanel';
import { CollectStage } from '@/case/collect/CollectStage';
import { DocumentationPanel } from '@/case/DocumentationPanel';
import { FollowUpStage } from '@/case/FollowUpStage';
import { MonitorStage } from '@/case/MonitorStage';
import { ReconciliationPanel } from '@/case/ReconciliationPanel';
import { ReflectStage } from '@/case/ReflectStage';
import { RoundsPanel } from '@/case/RoundsPanel';
import { UnderstandStage } from '@/case/UnderstandStage';
import { caseCompleteness, stageDone } from '@/lib/completeness';
import { audit, touchCase } from '@/lib/db';
import { useAiRunner, useBundle } from '@/lib/hooks';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

type Tool = 'calc' | 'recon' | 'rounds' | 'docs' | 'details' | 'menu' | null;

const MODE_LABEL: Record<CaseMode, string> = { teach: 'Teach', assist: 'Assist', autodraft: 'Auto-draft' };

export default function CaseWorkspace() {
  const { caseId } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const bundle = useBundle(caseId);
  const t = useT();
  const [tool, setTool] = useState<Tool>(null);
  const draft = useAiRunner();
  const [draftStep, setDraftStep] = useState('');

  const stageParam = params.get('stage') as StageId | null;
  const stage: StageId = stageParam && STAGES.includes(stageParam) ? stageParam : (bundle?.case.stage ?? 'collect');

  useEffect(() => {
    if (bundle?.case && stage !== bundle.case.stage) void touchCase(bundle.case.id, { stage });
  }, [bundle?.case, stage]);

  if (bundle === null)
    return (
      <div className="grid place-items-center py-20">
        <Spinner />
      </div>
    );
  if (!bundle) return <EmptyState title="Case not found" action={<Button asChild><Link to="/cases">Back to cases</Link></Button>} />;

  const c = bundle.case;
  const done = stageDone(bundle);
  const completeness = caseCompleteness(bundle);
  const idx = STAGES.indexOf(stage);
  const goto = (s: StageId) => {
    const next = new URLSearchParams(params);
    next.set('stage', s);
    next.delete('capture');
    setParams(next);
  };
  const setMode = async (m: CaseMode) => {
    await touchCase(c.id, { mode: m });
    await audit('case.mode', { caseId: c.id, detail: m });
  };

  const autoDraft = () =>
    draft.run(async () => {
      setDraftStep('Understanding the patient…');
      await runCaseAction(bundle, 'analyze-case');
      setDraftStep('Identifying potential DRPs…');
      await runCaseAction(bundle, 'drp-analysis');
      setDraftStep('Drafting monitoring plan…');
      await runCaseAction(bundle, 'monitoring-plan');
      setDraftStep('Drafting follow-up plan…');
      await runCaseAction(bundle, 'follow-up');
      setDraftStep('');
    });

  const demographics = [c.age !== undefined && `${c.age} y`, c.sex && c.sex !== 'Unknown' && c.sex, c.weightKg && `${c.weightKg} kg`].filter(Boolean).join(' · ');

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" aria-label="Back to cases" onClick={() => navigate('/cases')}>
          <ArrowLeft />
        </Button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h1 className="text-xl font-bold text-navy-900">{c.code}</h1>
            <Badge tone={c.priority === 'high' ? 'red' : c.priority === 'medium' ? 'yellow' : 'neutral'}>{c.priority} priority</Badge>
            <Badge tone={c.status === 'active' ? 'green' : 'neutral'}>{c.status}</Badge>
            {c.isDemo && <Badge tone="orange">Synthetic demo</Badge>}
          </div>
          <p className="truncate text-sm text-slate-600">
            {[demographics || 'Demographics not set', departmentLabel(c.department), c.ward, c.encounter].filter(Boolean).join(' · ')}
          </p>
        </div>
        <Button variant="ghost" size="icon" aria-label="Edit case details" onClick={() => setTool('details')}>
          <Pencil />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Case actions" onClick={() => setTool('menu')}>
          <MoreHorizontal />
        </Button>
      </div>

      <Card>
        <CardBody className="space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
            <p className="min-w-0 flex-1 text-sm">
              <span className="font-semibold text-slate-600">Main problem: </span>
              <span className="font-semibold text-navy-900">{c.mainProblem || 'not set'}</span>
            </p>
            <button type="button" onClick={() => goto('reflect')} className="flex items-center gap-2 text-sm" aria-label={`Case completeness ${completeness.percent}%`}>
              <span className="font-semibold text-slate-600">Completeness</span>
              <span className="w-20">
                <Progress value={completeness.percent} tone={completeness.percent === 100 ? 'med' : 'navy'} />
              </span>
              <span className="font-bold text-navy-900">{completeness.percent}%</span>
            </button>
          </div>
          <Stepper current={stage} done={done} onSelect={goto} />
          <div className="flex flex-wrap items-center gap-2">
            <div role="radiogroup" aria-label="Case mode" className="flex rounded-xl bg-slate-100 p-1">
              {CASE_MODES.map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={c.mode === m}
                  onClick={() => setMode(m)}
                  className={cn('min-h-9 rounded-lg px-3 text-sm font-semibold', c.mode === m ? 'bg-white text-navy-900 shadow-sm' : 'text-slate-600')}
                >
                  {MODE_LABEL[m]}
                </button>
              ))}
            </div>
            <div className="flex flex-1 flex-wrap justify-end gap-1.5">
              <Button size="sm" variant="soft" onClick={() => setTool('calc')}>
                <Calculator /> Calculators
              </Button>
              <Button size="sm" variant="soft" onClick={() => setTool('recon')}>
                <ClipboardCheck /> Med rec
              </Button>
              <Button size="sm" variant="soft" onClick={() => setTool('rounds')}>
                <Stethoscope /> Rounds
              </Button>
              <Button size="sm" variant="soft" onClick={() => setTool('docs')}>
                <FileText /> Notes
              </Button>
            </div>
          </div>
        </CardBody>
      </Card>

      {c.mode === 'autodraft' && (
        <Card className="border-violet-200 bg-violet-50/50">
          <CardBody className="space-y-2">
            <p className="text-sm text-violet-900">
              <strong>Auto-draft mode.</strong> Generate a preliminary workup (overview, problems, potential DRPs, monitoring and follow-up). Every item stays an AI-GENERATED DRAFT until you accept it.
            </p>
            <Button variant="brand" onClick={autoDraft} disabled={draft.loading}>
              <Sparkles /> Generate full preliminary workup
            </Button>
            {draft.loading && <AILoading label={draftStep || 'Working…'} />}
            {draft.error && <AIErrorPanel error={draft.error} onRetry={draft.retry} onManual={draft.reset} />}
          </CardBody>
        </Card>
      )}

      <section aria-labelledby="stage-title" className="space-y-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-med-700">
            {t(STAGE_INFO[stage].label)} · step {idx + 1}
          </p>
          <h2 id="stage-title" className="text-xl font-bold text-navy-900">
            {t(STAGE_INFO[stage].question)}
          </h2>
        </div>
        {stage === 'collect' && <CollectStage bundle={bundle} initialCapture={params.get('capture')} initialType={params.get('type')} onNext={() => goto('understand')} />}
        {stage === 'understand' && <UnderstandStage bundle={bundle} />}
        {stage === 'assess' && <AssessStage bundle={bundle} openTool={(x) => setTool(x)} />}
        {stage === 'act' && <ActStage bundle={bundle} />}
        {stage === 'monitor' && <MonitorStage bundle={bundle} />}
        {stage === 'followup' && <FollowUpStage bundle={bundle} />}
        {stage === 'reflect' && <ReflectStage bundle={bundle} />}
      </section>

      <div className="flex justify-between gap-2 border-t border-slate-200 pt-4">
        <Button variant="secondary" disabled={idx === 0} onClick={() => goto(STAGES[idx - 1]!)}>
          <ArrowLeft /> {idx > 0 ? t(STAGE_INFO[STAGES[idx - 1]!].label) : 'Back'}
        </Button>
        {idx < STAGES.length - 1 && (
          <Button onClick={() => goto(STAGES[idx + 1]!)}>
            Next: {t(STAGE_INFO[STAGES[idx + 1]!].label)} <ArrowRight />
          </Button>
        )}
      </div>

      <Sheet open={tool === 'calc'} onOpenChange={(o) => !o && setTool(null)} title="Clinical calculators" description="Validated formulas. Results support — never replace — your assessment." wide>
        <CalculatorsPanel bundle={bundle} />
      </Sheet>
      <Sheet open={tool === 'recon'} onOpenChange={(o) => !o && setTool(null)} title="Medication reconciliation" description="Home → admission/inpatient → discharge. Pharmacist verification required." wide>
        <ReconciliationPanel bundle={bundle} />
      </Sheet>
      <Sheet open={tool === 'rounds'} onOpenChange={(o) => !o && setTool(null)} title="Round assistant" description="Before, during and after ward rounds." wide>
        <RoundsPanel bundle={bundle} />
      </Sheet>
      <Sheet open={tool === 'docs'} onOpenChange={(o) => !o && setTool(null)} title="Documentation" description="Generated from case data — nothing to retype. Review before use." wide>
        <DocumentationPanel bundle={bundle} />
      </Sheet>
      <CaseDetailsSheet open={tool === 'details'} onClose={() => setTool(null)} record={c} />
      <CaseMenuSheet open={tool === 'menu'} onClose={() => setTool(null)} record={c} />
    </div>
  );
}
