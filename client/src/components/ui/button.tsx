import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-5 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-navy-900 text-white hover:bg-navy-800 active:bg-navy-700',
        brand: 'bg-brand-600 text-white hover:bg-brand-700',
        med: 'bg-med-600 text-white hover:bg-med-700',
        secondary: 'bg-white text-navy-900 border border-slate-300 hover:bg-slate-50',
        soft: 'bg-navy-50 text-navy-900 hover:bg-navy-100',
        ghost: 'text-navy-900 hover:bg-slate-100',
        danger: 'bg-red-600 text-white hover:bg-red-700',
        'danger-soft': 'bg-red-50 text-red-700 hover:bg-red-100 border border-red-200',
      },
      size: {
        sm: 'min-h-10 px-3 text-sm',
        md: 'min-h-12 px-4 text-[0.95rem]',
        lg: 'min-h-14 px-5 text-base',
        xl: 'min-h-20 px-6 text-lg',
        icon: 'size-11',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild, type, ...props }, ref) => {
  const Comp = asChild ? Slot : 'button';
  return <Comp ref={ref} type={asChild ? undefined : (type ?? 'button')} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
});
Button.displayName = 'Button';
