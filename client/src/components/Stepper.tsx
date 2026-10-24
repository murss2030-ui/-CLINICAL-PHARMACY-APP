import { Check } from 'lucide-react';
import { STAGE_INFO, STAGES, type StageId } from '@shared/domain';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export function Stepper({ current, done, onSelect }: { current: StageId; done: Record<string, boolean>; onSelect: (s: StageId) => void }) {
  const t = useT();
  const idx = STAGES.indexOf(current);
  return (
    <nav aria-label="Clinical reasoning pathway">
      {/* Compact mobile stepper */}
      <div className="sm:hidden">
        <div className="flex items-center gap-1.5">
          {STAGES.map((s, i) => (
            <button
              key={s}
              type="button"
              onClick={() => onSelect(s)}
              aria-label={`${STAGE_INFO[s].label}${done[s] ? ' (done)' : ''}`}
              aria-current={s === current ? 'step' : undefined}
              className={cn('h-2.5 flex-1 rounded-full', s === current ? 'bg-navy-900' : done[s] ? 'bg-med-500' : i < idx ? 'bg-navy-200' : 'bg-slate-200')}
            />
          ))}
        </div>
        <p className="mt-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
          Step {idx + 1} of {STAGES.length} · {t(STAGE_INFO[current].label)}
        </p>
      </div>
      {/* Horizontal stepper (tablet/desktop) */}
      <ol className="hidden items-center gap-1 sm:flex">
        {STAGES.map((s, i) => (
          <li key={s} className="flex flex-1 items-center gap-1">
            <button
              type="button"
              onClick={() => onSelect(s)}
              aria-current={s === current ? 'step' : undefined}
              className={cn(
                'flex min-h-11 w-full items-center gap-2 rounded-xl px-2 text-left text-sm font-semibold transition-colors',
                s === current ? 'bg-navy-900 text-white' : 'text-navy-900 hover:bg-slate-100',
              )}
            >
              <span
                className={cn(
                  'grid size-6 shrink-0 place-items-center rounded-full text-xs',
                  s === current ? 'bg-white text-navy-900' : done[s] ? 'bg-med-600 text-white' : 'bg-slate-200 text-slate-700',
                )}
              >
                {done[s] && s !== current ? <Check className="size-3.5" /> : i + 1}
              </span>
              <span className="truncate">{t(STAGE_INFO[s].label)}</span>
            </button>
            {i < STAGES.length - 1 && <span className="h-px w-2 shrink-0 bg-slate-300" aria-hidden />}
          </li>
        ))}
      </ol>
    </nav>
  );
}
