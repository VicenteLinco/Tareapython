import { HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface MetricTooltipProps {
  text: string;
  className?: string;
  /** 'sm' = ícono 2.5, 'md' = ícono 3.5 (default) */
  size?: "sm" | "md";
  /** Posición del tooltip DaisyUI */
  position?: "top" | "bottom" | "left" | "right";
}

/**
 * Ícono de ayuda con tooltip al hacer hover.
 * Usa el sistema tooltip de DaisyUI (data-tip).
 */
export function MetricTooltip({
  text,
  className,
  size = "md",
  position = "top",
}: MetricTooltipProps) {
  const iconClass = size === "sm" ? "w-2.5 h-2.5" : "w-3.5 h-3.5";
  return (
    <span
      className={cn(`tooltip tooltip-${position} cursor-help`, className)}
      data-tip={text}
    >
      <HelpCircle
        className={cn(
          iconClass,
          "text-base-content/30 hover:text-base-content/60 transition-colors",
        )}
      />
    </span>
  );
}
