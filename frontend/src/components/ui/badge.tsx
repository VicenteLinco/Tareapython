import { cn } from '@/lib/utils'

const variantClasses = {
  default: 'bg-primary/10 text-primary border-primary/20',
  secondary: 'bg-base-200 text-base-content/60 border-base-300',
  destructive: 'bg-error/10 text-error border-error/20',
  warning: 'bg-warning/10 text-warning border-warning/20',
  success: 'bg-success/10 text-success border-success/20',
  info: 'bg-info/10 text-info border-info/20',
  outline: 'bg-transparent text-base-content/50 border-base-300',
} as const

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: keyof typeof variantClasses
}

export function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold leading-none whitespace-nowrap',
        variantClasses[variant],
        className
      )}
      {...props}
    />
  )
}
