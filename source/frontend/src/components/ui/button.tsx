import { cn } from "@/lib/utils";

const variantClasses = {
  default: "btn-primary",
  destructive: "btn-error",
  outline: "btn-outline",
  secondary: "btn-ghost",
  ghost: "btn-ghost",
  link: "btn-link",
} as const;

const sizeClasses = {
  default: "btn-md",
  sm: "btn-sm",
  lg: "btn-lg",
  icon: "btn-square btn-md",
} as const;

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variantClasses;
  size?: keyof typeof sizeClasses;
}

export function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        "btn",
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...props}
    />
  );
}
