import { cva, type VariantProps } from 'class-variance-authority';

export const toggleVariants = cva(
  'inline-flex items-center justify-center gap-1.5 rounded-lg text-sm font-semibold ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=size-])]:size-4',
  {
    variants: {
      variant: {
        default:
          'bg-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:shadow-soft',
        outline:
          'border border-transparent bg-transparent hover:bg-accent hover:text-accent-foreground data-[state=on]:bg-accent data-[state=on]:text-accent-foreground data-[state=on]:border-border',
      },
      size: {
        default: 'h-10 px-3',
        sm: 'h-9 px-2.5 text-xs',
        lg: 'h-11 px-5 text-base',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export type ToggleVariants = VariantProps<typeof toggleVariants>;
