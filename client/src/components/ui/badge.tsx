import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const badgeVariants = cva('inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold uppercase tracking-wide [&_svg]:size-3.5', {
  variants: {
    tone: {
      neutral: 'bg-slate-100 text-slate-700',
      navy: 'bg-navy-100 text-navy-900',
      blue: 'bg-brand-100 text-brand-700',
      green: 'bg-med-100 text-med-700',
      yellow: 'bg-amber-100 text-amber-800',
      orange: 'bg-orange-100 text-orange-800',
      red: 'bg-red-100 text-red-800',
      purple: 'bg-violet-100 text-violet-800',
      outline: 'border border-slate-300 text-slate-700',
    },
  },
  defaultVariants: { tone: 'neutral' },
});

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
