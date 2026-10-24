import { useLiveQuery } from 'dexie-react-hooks';
import { Activity, AlertTriangle, ArrowRight, BookOpen, Camera, CheckCircle2, ClipboardList, FileHeart, FlaskConical, FolderOpen, GraduationCap, Pill, ScrollText, ShieldCheck, Stethoscope, Target } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { departmentLabel } from '@shared/departments';
import { STAGE_INFO, type SourceType } from '@shared/domain';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Progress, SectionTitle } from '@/components/ui/misc';
import { DEMO_CASES, loadDemoCase } from '@/demo/loader';
import { db, saveSettings } from '@/lib/db';
import { useSettings } from '@/lib/hooks';
import { useT } from '@/lib/i18n';
import { dailyMissions, learningTarget, todaysActivity, type Activity as Act } from '@/lib/learning';
import { formatDate, todayIso } from '@/lib/utils';
import { ScanTargetSheet } from './ScanTargetSheet';

export function PrivacyNotice({ compact }: { compact?: boolean }) {
  const t = useT();
  return (
    <div className="flex items-start gap-2 rounded-xl border border-navy-200 bg-navy-50 px-3 py-2.5 text-sm text-navy-900">
      <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p>
        <strong>{t('Do not enter unnecessary personally identifiable patient information.')}</strong>
        {!compact && ' Use anonymous case codes and enter clinical data only as permitted by your institution’s privacy policy and authorisation.'}
      </p>
    </div>
  );
}

export default function HomePage() {
  const t = useT();
  const navigate = useNavigate();
  const settings = useSettings();
  const [scan, setScan] = useState<{ type: SourceType; capture: 'camera' | 'manual' } | null>(null);
  const [loadingDemo, setLoadingDemo] = useState<string | null>(null);
  const [activity, setActivity] = useState<Act | undefined>();

  const cases = useLiveQuery(() => db.cases.toArray(), [], []);
  const followups = useLiveQuery(() => db.followups.where('status').equals('pending').toArray(), [], []);
  const drps = useLiveQuery(() => db.drps.where('status').anyOf('possible', 'needs_data').toArray(), [], []);
  const tasks = useLiveQuery(() => db.tasks.where('status').anyOf('open', 'in_progress').toArray(), [], []);
  const gaps = useLiveQuery(() => db.gaps.toArray(), [], []);
  const rotation = useLiveQuery(() => db.rotations.filter((r) => r.isCurrent).first(), []);

  useEffect(() => {
    void todaysActivity().then(setActivity);
  }, [cases.length, drps.length, tasks.length]);

  const active = cases.filter((c) => c.status === 'active');
  const last = [...active].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  const waiting = active.filter((c) => c.stage === 'collect' || c.stage === 'understand').length;
  const today = todayIso();
  const dueFollowups = followups.filter((f) => !f.dueDate || f.dueDate <= today);
  const dueTasks = tasks.filter((x) => !x.dueDate || x.dueDate <= today);
  const target = learningTarget(gaps);
  const missions = useMemo(
    () => (activity ? dailyMissions(today, rotation?.department ?? settings.defaultDepartment, activity, target) : []),
    [activity, today, rotation?.department, settings.defaultDepartment, target],
  );
  const caseCode = (id?: string) => cases.find((c) => c.id === id)?.code ?? '';

  const SECONDARY: Array<{ label: string; type: SourceType; icon: typeof Camera }> = [
    { label: 'Scan laboratory', type: 'lab_report', icon: FlaskConical },
    { label: 'Scan medication list', type: 'medication_order', icon: Pill },
    { label: 'Scan progress note', type: 'progress_note', icon: ScrollText },
    { label: 'Scan diagnostic report', type: 'diagnostic_report', icon: Stethoscope },
  ];

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm font-semibold text-slate-500">{new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        <h1 className="text-2xl font-bold text-navy-900">What needs my attention now?</h1>
      </div>

      {!settings.privacyAcknowledged && (
        <div className="space-y-2">
          <PrivacyNotice />
          <Button size="sm" variant="soft" onClick={() => saveSettings({ privacyAcknowledged: true })}>
            I understand
          </Button>
        </div>
      )}

      <Button size="xl" className="w-full justify-start gap-4 text-left" onClick={() => setScan({ type: 'patient_chart', capture: 'camera' })}>
        <Camera className="!size-8" />
        <span>
          <span className="block text-lg font-bold uppercase tracking-wide">{t('Scan patient file')}</span>
          <span className="block text-sm font-normal text-navy-100">Camera or gallery · multiple pages</span>
        </span>
      </Button>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {SECONDARY.map((s) => (
          <Button key={s.type} variant="secondary" size="lg" className="h-auto justify-start py-2 text-left leading-tight whitespace-normal" onClick={() => setScan({ type: s.type, capture: 'camera' })}>
            <s.icon className="text-navy-700" /> <span>{t(s.label)}</span>
          </Button>
        ))}
        <Button variant="secondary" size="lg" className="h-auto justify-start py-2 text-left leading-tight whitespace-normal" onClick={() => setScan({ type: 'free_text', capture: 'manual' })}>
          <ClipboardList className="text-navy-700" /> {t('Add manually')}
        </Button>
        <Button variant="secondary" size="lg" className="h-auto justify-start py-2 text-left leading-tight whitespace-normal" asChild>
          <Link to="/cases">
            <FolderOpen className="text-navy-700" /> {t('Open case')}
          </Link>
        </Button>
      </div>

      {last && (
        <Card>
          <CardBody className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{t('Continue last case')}</p>
              <p className="truncate font-bold text-navy-900">
                {last.code} · {last.mainProblem || departmentLabel(last.department)}
              </p>
              <p className="text-sm text-slate-600">
                Stage: {STAGE_INFO[last.stage].label} — “{STAGE_INFO[last.stage].question}”
              </p>
            </div>
            <Button onClick={() => navigate(`/cases/${last.id}`)}>
              Continue <ArrowRight />
            </Button>
          </CardBody>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: 'Active cases', value: active.length, icon: FileHeart, to: '/cases' },
          { label: 'Waiting for assessment', value: waiting, icon: Activity, to: '/cases' },
          { label: t('Pending follow-ups'), value: dueFollowups.length, icon: CheckCircle2, to: '/tasks' },
          { label: t('Potential DRPs'), value: drps.length, icon: AlertTriangle, to: '/cases' },
        ].map((s) => (
          <Link key={s.label} to={s.to} className="rounded-2xl border border-slate-200 bg-white p-3 hover:border-navy-200">
            <s.icon className="size-5 text-navy-700" aria-hidden />
            <p className="mt-1 text-2xl font-bold text-navy-900">{s.value}</p>
            <p className="text-xs font-semibold text-slate-600">{s.label}</p>
          </Link>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader title={t("Today's missions")} subtitle="Completed only by real activity in your cases and training." icon={<Target />} />
          <CardBody className="space-y-3">
            {missions.map((m) => (
              <Link key={m.id} to={m.link} className="block rounded-xl p-1 hover:bg-slate-50">
                <div className="flex items-start gap-2">
                  {m.progress >= m.target ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-med-600" /> : <span className="mt-1 size-4 shrink-0 rounded-full border-2 border-slate-300" />}
                  <p className="flex-1 text-sm text-navy-900">{m.text}</p>
                  <span className="text-xs font-semibold text-slate-500">
                    {m.progress}/{m.target}
                  </span>
                </div>
                <Progress value={(m.progress / m.target) * 100} tone="med" className="mt-1.5 h-1.5" />
              </Link>
            ))}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Tasks & follow-ups due" icon={<ClipboardList />} action={<Link to="/tasks" className="text-sm font-semibold text-brand-600">All</Link>} />
          <CardBody className="space-y-2">
            {dueTasks.length === 0 && dueFollowups.length === 0 && <p className="text-sm text-slate-600">Nothing due today.</p>}
            {dueFollowups.slice(0, 4).map((f) => (
              <Link key={f.id} to={`/cases/${f.caseId}?stage=followup`} className="flex items-center gap-2 text-sm hover:underline">
                <Badge tone="yellow">Follow-up</Badge>
                <span className="flex-1 truncate">{f.parameter}</span>
                <span className="text-xs text-slate-500">{caseCode(f.caseId)}</span>
              </Link>
            ))}
            {dueTasks.slice(0, 4).map((x) => (
              <Link key={x.id} to="/tasks" className="flex items-center gap-2 text-sm hover:underline">
                <Badge tone={x.priority === 'high' ? 'red' : 'neutral'}>Task</Badge>
                <span className="flex-1 truncate">{x.title}</span>
                <span className="text-xs text-slate-500">{caseCode(x.caseId)}</span>
              </Link>
            ))}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={t('Current rotation')} icon={<GraduationCap />} action={<Link to="/portfolio?tab=rotation" className="text-sm font-semibold text-brand-600">{rotation ? 'Edit' : 'Set up'}</Link>} />
          <CardBody>
            {rotation ? (
              <div className="space-y-1 text-sm">
                <p className="font-bold text-navy-900">{rotation.name || departmentLabel(rotation.department)}</p>
                <p className="text-slate-600">
                  {departmentLabel(rotation.department)} · {formatDate(rotation.startDate)} – {formatDate(rotation.endDate)}
                </p>
                {rotation.objectives.length > 0 && <p className="text-slate-600">Objectives: {rotation.objectives.slice(0, 3).join('; ')}</p>}
              </div>
            ) : (
              <p className="text-sm text-slate-600">No rotation set. Your department drives missions, clinical questions and monitoring priorities.</p>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Learning target" subtitle={t('Knowledge gaps')} icon={<BookOpen />} />
          <CardBody>
            {target ? (
              <div className="space-y-2 text-sm">
                <p>
                  Repeated gap in <strong>{target.label}</strong> ({target.count} times): {target.topics.slice(0, 2).join('; ')}.
                </p>
                <Button size="sm" variant="soft" asChild>
                  <Link to={`/training?focus=${encodeURIComponent(target.domain)}`}>Start targeted practice</Link>
                </Button>
              </div>
            ) : (
              <p className="text-sm text-slate-600">No repeated gaps yet. Feedback from cases and training builds your personal learning target.</p>
            )}
          </CardBody>
        </Card>
      </div>

      <section>
        <SectionTitle>{t('Load demo case')} · synthetic patients only</SectionTitle>
        <div className="grid gap-2 sm:grid-cols-3">
          {DEMO_CASES.map((d) => (
            <button
              key={d.key}
              type="button"
              disabled={loadingDemo !== null}
              onClick={async () => {
                setLoadingDemo(d.key);
                try {
                  const id = await loadDemoCase(d);
                  navigate(`/cases/${id}`);
                } finally {
                  setLoadingDemo(null);
                }
              }}
              className="rounded-2xl border border-orange-200 bg-orange-50/60 p-3 text-left hover:bg-orange-50 disabled:opacity-60"
            >
              <Badge tone="orange">Synthetic demo</Badge>
              <p className="mt-1.5 font-bold text-navy-900">{departmentLabel(d.department)}</p>
              <p className="text-sm text-slate-700">{d.title}</p>
              <p className="mt-1 text-xs font-semibold text-orange-800">{loadingDemo === d.key ? 'Preparing documents…' : 'LOAD DEMO CASE →'}</p>
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-500">Demo cases work without any AI key: AI steps return clearly labelled scripted responses.</p>
      </section>

      <ScanTargetSheet type={scan?.type ?? null} capture={scan?.capture ?? 'camera'} onClose={() => setScan(null)} />
    </div>
  );
}
