import { cn } from "@/lib/utils";

const variantClasses = {
  default: "badge-primary",
  secondary: "badge-neutral badge-outline",
  destructive: "badge-error",
  warning: "badge-warning",
  success: "badge-success",
  info: "badge-info",
  outline: "badge-outline",
} as const;

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: keyof typeof variantClasses;
}

export function Badge({
  className,
  variant = "default",
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        "badge badge-sm whitespace-nowrap font-semibold",
        variantClasses[variant],
        className,
      )}
      {...props}
    />
  );
}
