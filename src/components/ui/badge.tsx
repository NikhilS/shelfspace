import * as React from 'react';
import {cva, type VariantProps} from 'class-variance-authority';
import {cn} from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center justify-center rounded-md border px-2 py-0.5 font-sans text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 whitespace-nowrap select-none',
  {
    variants: {
      variant: {
        default:
          'border-transparent bg-primary text-primary-foreground hover:bg-primary/85',
        secondary:
          'border-outline-variant/50 bg-surface-container text-on-surface hover:bg-surface-container-high',
        destructive:
          'border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/85',
        outline: 'border-outline-variant/70 bg-surface/80 text-on-surface',
        // Semantic Bookish Archival Tokens
        status:
          'font-label-caps text-label-caps border-outline-variant/50 bg-surface-container text-on-surface-variant',
        'status-read':
          'font-label-caps text-label-caps border-emerald-600/30 bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 font-bold',
        'status-reading':
          'font-label-caps text-label-caps border-amber-600/30 bg-amber-500/15 text-amber-800 dark:text-amber-300 font-bold',
        'status-to-read':
          'font-label-caps text-label-caps border-stone-400/40 bg-stone-500/10 text-stone-700 dark:text-stone-300 font-bold',
        'status-abandoned':
          'font-label-caps text-label-caps border-rose-600/30 bg-rose-500/15 text-rose-800 dark:text-rose-300 font-bold',
        genre:
          'font-label-caps text-label-caps border-primary/20 bg-surface-container-high/80 text-primary font-semibold hover:bg-primary hover:text-on-primary cursor-pointer transition-colors',
        subgenre:
          'font-label-caps text-label-caps border-outline-variant/50 bg-surface-container-low text-on-surface-variant hover:bg-surface-container-high hover:text-primary transition-colors',
        temporal:
          'font-mono tabular-nums text-label-caps-sm font-bold tracking-wider uppercase border-primary/20 bg-surface-container-high/70 text-primary rounded-sm',
        format:
          'font-label-caps-sm text-label-caps-sm uppercase font-bold tracking-wider rounded-sm border-outline-variant/60 bg-surface-container text-on-surface-variant',
      },
      size: {
        default: 'px-2.5 py-0.5 text-xs',
        sm: 'px-2 py-0.5 font-label-caps-sm text-label-caps-sm',
        lg: 'px-3 py-1 text-sm',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export type BadgeProps = React.HTMLAttributes<HTMLDivElement> &
  VariantProps<typeof badgeVariants>;

function Badge({className, variant, size, ...props}: BadgeProps) {
  return (
    <div className={cn(badgeVariants({variant, size}), className)} {...props} />
  );
}

export {Badge, badgeVariants};
