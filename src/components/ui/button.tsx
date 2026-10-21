import * as React from 'react';
import {cva, type VariantProps} from 'class-variance-authority';
import {cn} from '@/lib/utils';

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding font-sans text-sm font-medium whitespace-nowrap transition-all duration-150 outline-none select-none cursor-pointer focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 active:scale-[0.99] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          'bg-primary text-on-primary text-primary-foreground shadow-xs hover:bg-primary/90',
        editorial:
          'bg-primary text-on-primary text-primary-foreground font-sans font-semibold tracking-wide shadow-xs hover:bg-primary/90 active:scale-[0.98]',
        outline:
          'border-outline-variant/80 bg-surface text-on-surface hover:bg-surface-container-low hover:border-outline/50 shadow-2xs',
        secondary:
          'bg-surface-container-high text-on-surface hover:bg-surface-container-highest/80 border border-outline-variant/40',
        ghost:
          'text-on-surface-variant hover:bg-surface-container hover:text-on-surface',
        destructive:
          'bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive/90',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 rounded-lg px-3 text-xs',
        xs: 'h-7 rounded-md px-2.5 text-xs',
        lg: 'h-11 rounded-lg px-6 text-sm',
        icon: 'h-10 w-10 rounded-lg',
        'icon-sm': 'h-9 w-9 rounded-lg',
        'icon-lg': 'h-11 w-11 rounded-lg',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

const Button = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> &
    VariantProps<typeof buttonVariants>
>(({className, variant, size, ...props}, ref) => {
  return (
    <button
      className={cn(buttonVariants({variant, size, className}))}
      ref={ref}
      {...props}
    />
  );
});
Button.displayName = 'Button';

export {Button, buttonVariants};
