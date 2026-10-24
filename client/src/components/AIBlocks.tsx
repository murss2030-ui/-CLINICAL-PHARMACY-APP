import { Bot, RefreshCw, ShieldCheck, WifiOff } from 'lucide-react';
import { isModelProvider, providerLabel, type AIMeta } from '@shared/ai';
import { Button } from '@/components/ui/button';
import type { AiError } from '@/lib/api';
import { Spinner } from '@/components/ui/misc';
import { cn } from '@/lib/utils';

/** Banner on every AI-generated result, naming the provider and model that produced it. */
export function AIDraftBanner({ meta, provider, className }: { meta?: Pick<AIMeta, 'provider' | 'model' | 'warnings' | 'cached'>; provider?: string; className?: string }) {
  const p = meta?.provider ?? provider;
  const demo = p === 'demo';
  const source = [isModelProvider(p) ? providerLabel(p) : '', meta?.model ?? ''].filter(Boolean).join(' · ');
  const warnings = (meta?.warnings ?? []).filter((w) => !w.startsWith('SYNTHETIC DEMO RESPONSE'));
  return (
    <div className={cn('rounded-xl border px-3 py-2 text-sm', demo ? 'border-orange-300 bg-orange-50 text-orange-900' : 'border-violet-300 bg-violet-50 text-violet-900', className)}>
      <p className="flex flex-wrap items-center gap-x-2 font-bold tracking-wide">
        <Bot className="size-4" aria-hidden />
        {demo ? 'SYNTHETIC DEMO RESPONSE — SCRIPTED, NOT AI' : 'AI-GENERATED DRAFT'} · REQUIRES CLINICAL VERIFICATION
      </p>
      {!demo && (meta || source) && (
        <p className="mt-0.5 text-xs opacity-80">
          {source || 'AI'}
          {meta?.cached ? ' · cached' : ''} · Evidence statements are not verified sources.
        </p>
      )}
      {warnings.length > 0 && (
        <ul className="mt-1 list-disc pl-5 text-xs">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Shown whenever an AI call fails. Case data is never touched by a failure. */
export function AIErrorPanel({ error, onRetry, onManual, retrying }: { error: AiError; onRetry?: () => void; onManual?: () => void; retrying?: boolean }) {
  const offline = error.code === 'AI_NETWORK_ERROR';
  return (
    <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4" role="alert">
      <p className="flex items-center gap-2 font-bold text-amber-900">
        {offline ? <WifiOff className="size-5" aria-hidden /> : <Bot className="size-5" aria-hidden />}
        {offline ? 'AI SERVICE UNAVAILABLE' : error.title}
      </p>
      <p className="mt-1 text-sm text-amber-900">{error.message}</p>
      {error.details?.length ? (
        <ul className="mt-1 list-disc pl-5 text-xs text-amber-800">
          {error.details.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      ) : null}
      <p className="mt-2 flex items-center gap-1.5 text-sm font-semibold text-med-700">
        <ShieldCheck className="size-4" aria-hidden /> Your case data is safe.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {onRetry && error.retryable !== false && (
          <Button size="sm" variant="secondary" onClick={onRetry} disabled={retrying}>
            {retrying ? <Spinner className="size-4" /> : <RefreshCw />} Retry
          </Button>
        )}
        {onRetry && error.retryable === false && (
          <Button size="sm" variant="secondary" onClick={onRetry} disabled={retrying}>
            <RefreshCw /> Try again
          </Button>
        )}
        {onManual && (
          <Button size="sm" variant="soft" onClick={onManual}>
            Continue manually
          </Button>
        )}
      </div>
    </div>
  );
}

export function AILoading({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-900" role="status">
      <Spinner className="size-5 text-violet-700" />
      {label}
    </div>
  );
}
