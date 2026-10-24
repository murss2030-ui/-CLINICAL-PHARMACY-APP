import { useLiveQuery } from 'dexie-react-hooks';
import { Bot, Database, Download, FileUp, KeyRound, MonitorSmartphone, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CAPABILITY_LABELS, PROVIDER_INFO, describeAIError, providerLabel, type AIErrorCode, type AIProviderStatus } from '@shared/ai';
import { DEPARTMENT_LIST, type DepartmentId } from '@shared/departments';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Checkbox, Field, Input, Select } from '@/components/ui/form';
import { Spinner } from '@/components/ui/misc';
import { Sheet } from '@/components/ui/sheet';
import { db, deleteAllLocalData, exportAll, importCase, saveSettings } from '@/lib/db';
import { useAiStatus, useOnline, useSettings } from '@/lib/hooks';
import { useInstallPrompt } from '@/lib/install';
import type { AppSettings } from '@/lib/types';
import { downloadText, formatDateTime } from '@/lib/utils';
import { PrivacyNotice } from './HomePage';

function ProviderRow({ p, rank }: { p: AIProviderStatus; rank: number }) {
  const probe = p.probeError ? describeAIError(p.probeError, p.name) : undefined;
  return (
    <li className="rounded-xl border border-slate-200 p-3" data-testid={`provider-${p.name}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-bold text-navy-900">
          {rank}. {p.label}
        </span>
        <Badge tone={p.configured ? 'green' : 'neutral'}>{p.configured ? 'Key configured on server' : describeAIError('AI_KEY_NOT_CONFIGURED', p.name).title}</Badge>
        {p.configured && <Badge tone="navy" className="normal-case">Model: {p.model}</Badge>}
        {p.reachable === true && <Badge tone="green">Reachable</Badge>}
        {p.reachable === false && <Badge tone="red">{probe?.title ?? 'Not reachable'}</Badge>}
      </div>
      <p className="mt-1 text-xs text-slate-600">
        Handles: {p.capabilities.map((c) => CAPABILITY_LABELS[c]).join(' · ')}
        {p.note ? ` · ${p.note}` : ''}
        {!p.configured ? ` · set ${PROVIDER_INFO[p.name].keyEnv} on the server to enable` : ''}
      </p>
      {probe && <p className="mt-1 text-red-700">{probe.message}</p>}
      {p.probeDetails?.map((d) => (
        <p key={d} className="mt-1 text-xs text-red-700">
          {d}
        </p>
      ))}
    </li>
  );
}

function AIStatusCard() {
  const settings = useSettings();
  const { status, error, loading, refresh } = useAiStatus(false);
  const online = useOnline();
  return (
    <Card>
      <CardHeader title="AI providers" subtitle="All AI requests go through the PRECEPTOR server. The browser never sees any API key." icon={<Bot />} />
      <CardBody className="space-y-3 text-sm">
        {loading && <Spinner />}
        {!online && <p className="font-semibold text-amber-800">Offline — AI features are unavailable; everything else keeps working.</p>}
        {error && (
          <p className="text-red-700">
            {error.title}: {error.message}
          </p>
        )}
        {status && (
          <>
            <ul className="space-y-2">
              {status.providers.map((p, i) => (
                <ProviderRow key={p.name} p={p} rank={i + 1} />
              ))}
            </ul>
            {!status.configured && (
              <p className="rounded-lg bg-amber-50 p-2 text-amber-900">
                Set at least one of <code>GEMINI_API_KEY</code>, <code>DEEPSEEK_API_KEY</code> or <code>KIMI_API_KEY</code> in the <strong>server</strong> environment (.env or hosting secrets) and restart the server. Never paste a key into the app. Synthetic demo cases work without any key.
              </p>
            )}
            {status.accessCodeRequired && <Badge tone="yellow">Access code required</Badge>}
            <Field
              label="Preferred AI provider"
              hint="Tried first for every AI request. If it fails, the server automatically falls back to the next configured provider. Voice notes need Gemini; page images need Gemini or Kimi."
            >
              {(id) => (
                <Select id={id} value={settings.aiProvider} onChange={(e) => saveSettings({ aiProvider: e.target.value as AppSettings['aiProvider'] })}>
                  <option value="auto">Automatic — server order ({status.order.map((n) => providerLabel(n)).join(' → ')})</option>
                  {status.providers.map((p) => (
                    <option key={p.name} value={p.name} disabled={!p.configured && settings.aiProvider !== p.name}>
                      {p.label}
                      {p.configured ? '' : ' (not configured)'}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <p className="text-slate-600">
              Last 24 h: {status.usage.requests24h} AI request(s) · {status.usage.cacheHits24h} served from cache · limit {status.limits.rateLimitPerMinute}/min · max {status.limits.maxImages} images per request
            </p>
            {Object.keys(status.usage.errors24h).length > 0 && (
              <ul className="list-disc pl-5 text-slate-700">
                {Object.entries(status.usage.errors24h).map(([code, n]) => (
                  <li key={code}>
                    {describeAIError(code as AIErrorCode).title}: {n}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        <Button size="sm" variant="secondary" onClick={() => refresh(true)} disabled={loading || !online}>
          <RefreshCw /> Test connection
        </Button>
      </CardBody>
    </Card>
  );
}

export default function SettingsPage() {
  const settings = useSettings();
  const navigate = useNavigate();
  const { canInstall, installed, install } = useInstallPrompt();
  const [confirm, setConfirm] = useState<'delete' | 'clear' | null>(null);
  const [message, setMessage] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const auditRows = useLiveQuery(() => db.audit.orderBy('ts').reverse().limit(40).toArray(), [], []);

  const wipe = async (alsoCaches: boolean) => {
    await deleteAllLocalData();
    if (alsoCaches) {
      try {
        if ('caches' in window) for (const k of await caches.keys()) await caches.delete(k);
        const regs = (await navigator.serviceWorker?.getRegistrations?.()) ?? [];
        for (const r of regs) await r.unregister();
        localStorage.clear();
        sessionStorage.clear();
      } catch {
        // Best effort: storage may be unavailable in private mode.
      }
    }
    setConfirm(null);
    setMessage(alsoCaches ? 'All application data and caches were cleared.' : 'All local data was deleted.');
  };

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-navy-900">Settings</h1>
      {message && <p className="rounded-lg bg-med-50 px-3 py-2 text-sm font-semibold text-med-700" role="status">{message}</p>}
      <AIStatusCard />

      <Card>
        <CardHeader title="Server" subtitle="Needed for the Android app or when the API runs on another host." icon={<KeyRound />} />
        <CardBody className="space-y-3">
          <Field label="API base URL" hint="Leave empty when the app is served by the PRECEPTOR server (default).">
            {(id) => <Input id={id} defaultValue={settings.apiBase} placeholder="https://preceptor.example.org" onBlur={(e) => saveSettings({ apiBase: e.target.value.trim() })} />}
          </Field>
          <Field label="Server access code (optional)" hint="Only if your administrator set APP_ACCESS_TOKEN. This is NOT an AI provider key — never enter a Gemini, DeepSeek or Kimi key here.">
            {(id) => <Input id={id} type="password" autoComplete="off" defaultValue={settings.accessCode} onBlur={(e) => saveSettings({ accessCode: e.target.value.trim() })} />}
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Preferences" />
        <CardBody className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Interface language">
              {(id) => (
                <Select id={id} value={settings.language} onChange={(e) => saveSettings({ language: e.target.value as 'en' | 'ar' })}>
                  <option value="en">English</option>
                  <option value="ar">العربية (Arabic)</option>
                </Select>
              )}
            </Field>
            <Field label="Default department">
              {(id) => (
                <Select id={id} value={settings.defaultDepartment} onChange={(e) => saveSettings({ defaultDepartment: e.target.value as DepartmentId })}>
                  {DEPARTMENT_LIST.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Your initials (task owner)" hint="Optional. Stored only on this device.">
              {(id) => <Input id={id} defaultValue={settings.ownerName} onBlur={(e) => saveSettings({ ownerName: e.target.value.trim() })} />}
            </Field>
          </div>
          <Checkbox label="Large text" checked={settings.largeText} onChange={(v) => saveSettings({ largeText: v })} />
          <p className="text-xs text-slate-500">Arabic mode translates navigation and stage questions; clinical terms, drug and lab names stay in English. You can always write in Arabic, English or both.</p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Install" icon={<MonitorSmartphone />} />
        <CardBody className="space-y-2 text-sm">
          {installed ? (
            <Badge tone="green">Installed</Badge>
          ) : canInstall ? (
            <Button onClick={install}>Install PRECEPTOR</Button>
          ) : (
            <p className="text-slate-600">On Android Chrome: menu ⋮ → “Install app” / “Add to Home screen”. On iOS Safari: Share → “Add to Home Screen”.</p>
          )}
          <p className="text-slate-600">Installed, the app opens full-screen and keeps working offline for cases, manual entry, tasks and saved content.</p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Data & privacy" icon={<Database />} />
        <CardBody className="space-y-3">
          <PrivacyNotice />
          <p className="flex items-start gap-2 text-sm text-slate-700">
            <ShieldCheck className="mt-0.5 size-4 shrink-0" /> Case data is stored on this device (IndexedDB). The server keeps only a technical AI log (time, action, model, case code, status) — no patient content, images or API keys.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={async () => downloadText(`preceptor-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(await exportAll(), null, 2), 'application/json')}>
              <Download /> Export all data
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                try {
                  navigate(`/cases/${await importCase(JSON.parse(await f.text()))}`);
                } catch (err) {
                  setMessage(`Import failed: ${(err as Error).message}`);
                }
              }}
            />
            <Button variant="secondary" onClick={() => fileRef.current?.click()}>
              <FileUp /> Import case
            </Button>
            <Button variant="danger-soft" onClick={() => setConfirm('delete')}>
              <Trash2 /> Delete all local data
            </Button>
            <Button variant="danger-soft" onClick={() => setConfirm('clear')}>
              <Trash2 /> Clear application data
            </Button>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Activity & AI audit log (this device)" subtitle="Timestamp · case · action. Generated AI results are stored with each case." />
        <CardBody>
          {auditRows.length === 0 ? (
            <p className="text-sm text-slate-600">No activity yet.</p>
          ) : (
            <ul className="max-h-80 space-y-1 overflow-auto text-xs">
              {auditRows.map((a) => (
                <li key={a.id} className="flex gap-2">
                  <span className="shrink-0 text-slate-500">{formatDateTime(a.ts)}</span>
                  <Badge tone={a.actor === 'ai' ? 'purple' : a.actor === 'system' ? 'neutral' : 'blue'}>{a.actor}</Badge>
                  <span className="text-navy-900">{a.action}</span>
                  {a.detail && <span className="truncate text-slate-500">{a.detail}</span>}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <p className="text-center text-xs text-slate-500">PRECEPTOR 1.0 · Clinical pharmacy education & decision support · not an autonomous prescribing system</p>

      <Sheet
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm === 'clear' ? 'Clear all application data?' : 'Delete all local data?'}
        description="Every case, image, task, reflection and setting on this device is permanently removed. Export first if you need a copy."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => wipe(confirm === 'clear')}>
              <Trash2 /> {confirm === 'clear' ? 'Clear everything' : 'Delete all data'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-700">{confirm === 'clear' ? 'This also removes the offline cache and service worker; the app reloads fresh next time.' : 'The installed app and its offline cache are kept.'}</p>
      </Sheet>
    </div>
  );
}
