import { useState } from "react";
import { ChevronDown, ChevronUp, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

export interface QuickChip {
  label: string;
  value: string;
  active: boolean;
  onClick: () => void;
}

interface FilterBarProps {
  search?: React.ReactNode;
  primaryFilter?: React.ReactNode;
  secondaryFilters?: React.ReactNode;
  activeSecondaryCount?: number;
  chips?: QuickChip[];
  actions?: React.ReactNode;
  defaultExpanded?: boolean;
  className?: string;
}

export function FilterBar({
  search,
  primaryFilter,
  secondaryFilters,
  activeSecondaryCount = 0,
  chips,
  actions,
  defaultExpanded = false,
  className,
}: FilterBarProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center gap-2 flex-wrap">
        {search && <div className="flex-1 min-w-[200px]">{search}</div>}
        {primaryFilter && <div className="w-auto">{primaryFilter}</div>}
        {secondaryFilters && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className={cn(
              "inline-flex items-center gap-1.5 h-10 px-3 rounded-xl border text-xs font-semibold transition-all shrink-0",
              expanded
                ? "bg-primary/10 border-primary/30 text-primary"
                : "bg-base-100 border-base-300 text-base-content/70 hover:border-base-400 hover:text-base-content",
            )}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Filtros
            {activeSecondaryCount > 0 && (
              <Badge className="h-4 min-w-4 px-1 text-[10px] font-bold bg-primary text-primary-content border-0">
                {activeSecondaryCount}
              </Badge>
            )}
            {expanded ? (
              <ChevronUp className="h-3 w-3 ml-0.5" />
            ) : (
              <ChevronDown className="h-3 w-3 ml-0.5" />
            )}
          </button>
        )}
        {actions && (
          <div className="ml-auto flex items-center gap-2">{actions}</div>
        )}
      </div>

      {secondaryFilters && expanded && (
        <div className="bg-base-100 border border-base-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-base-200/60">
            <span className="text-[10px] font-bold uppercase tracking-widest text-base-content/40">
              Filtros avanzados
            </span>
            <button
              className="text-[11px] font-semibold text-base-content/40 hover:text-base-content transition-colors"
              onClick={() => setExpanded(false)}
            >
              Cerrar ✕
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 p-4">
            {secondaryFilters}
          </div>
        </div>
      )}

      {chips && chips.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {chips.map((chip) => (
            <button
              type="button"
              key={chip.value}
              onClick={chip.onClick}
              className={cn(
                "inline-flex items-center rounded-full px-3 py-0.5 text-xs font-medium transition-colors border",
                chip.active
                  ? "bg-primary text-primary-content border-primary"
                  : "bg-base-100 text-base-content/60 border-base-300 hover:bg-base-200 hover:text-base-content",
              )}
            >
              {chip.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
