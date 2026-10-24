import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Progress({ value, className, tone = 'navy' }: { value: number; className?: string; tone?: 'navy' | 'med' | 'amber' | 'red' }) {
  const color = { navy: 'bg-navy-900', med: 'bg-med-600', amber: 'bg-amber-500', red: 'bg-red-600' }[tone];
  return (
    <div className={cn('h-2.5 w-full overflow-hidden rounded-full bg-slate-200', className)} role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn('h-full rounded-full', color)} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, items, className }: { value: T; onChange: (v: T) => void; items: Array<{ value: T; label: ReactNode; count?: number }>; className?: string }) {
  return (
    <div role="tablist" className={cn('flex gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1', className)}>
      {items.map((item) => (
        <button
          key={item.value}
          role="tab"
          type="button"
          aria-selected={value === item.value}
          onClick={() => onChange(item.value)}
          className={cn(
            'min-h-10 shrink-0 rounded-lg px-3 text-sm font-semibold whitespace-nowrap transition-colors',
            value === item.value ? 'bg-white text-navy-900 shadow-sm' : 'text-slate-600 hover:text-navy-900',
          )}
        >
          {item.label}
          {item.count !== undefined && item.count > 0 && <span className="ml-1.5 rounded-full bg-navy-900 px-1.5 text-xs text-white">{item.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-slate-300 bg-white/60 px-6 py-8 text-center">
      {icon && <div className="mb-2 text-slate-400 [&_svg]:size-8">{icon}</div>}
      <p className="font-semibold text-navy-900">{title}</p>
      {children && <div className="mt-1 max-w-md text-sm text-slate-600">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 mt-1 flex items-center justify-between gap-2">
      <h2 className="text-sm font-bold uppercase tracking-wider text-slate-500">{children}</h2>
      {action}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cn('inline-block size-5 animate-spin rounded-full border-2 border-current border-t-transparent', className)} aria-hidden />;
}

export function KeyValue({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-wrap gap-x-2 text-sm">
      <span className="font-semibold text-slate-600">{label}:</span>
      <span className="text-navy-900">{children}</span>
    </div>
  );
}
