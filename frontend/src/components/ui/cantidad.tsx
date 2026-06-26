import { formatCantidad } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface CantidadConUnidadProps {
  qty: number;
  unidad: string;
  pluralUnidad?: string | null;
  size?: "sm" | "md" | "lg";
  tone?: "default" | "warning" | "danger" | "success" | "muted";
  className?: string;
}

const sizeClass = {
  sm: "text-sm",
  md: "text-base",
  lg: "text-lg font-semibold",
};

const toneClass = {
  default: "",
  warning: "text-warning-content",
  danger: "text-error",
  success: "text-success",
  muted: "opacity-60",
};

export function CantidadConUnidad({
  qty,
  unidad,
  pluralUnidad,
  size = "md",
  tone = "default",
  className,
}: CantidadConUnidadProps) {
  return (
    <span
      className={cn(
        "tabular-nums",
        sizeClass[size],
        toneClass[tone],
        className,
      )}
    >
      {formatCantidad(qty, unidad, pluralUnidad)}
    </span>
  );
}
