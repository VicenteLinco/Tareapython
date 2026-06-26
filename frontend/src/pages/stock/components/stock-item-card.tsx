import { ChevronRight } from "lucide-react";
import { ProductoImage } from "@/components/ui/producto-image";
import type { StockItem } from "@/types";
import { cn, formatCantidad } from "@/lib/utils";
import { StockBadge } from "./stock-badge";
import { AutonomiaBar } from "@/components/ui/autonomia-bar";

interface StockItemCardProps {
  item: StockItem;
  view: "grid" | "list";
  isSelected: boolean;
  onClick: () => void;
}

export function StockItemCard({
  item,
  view,
  isSelected,
  onClick,
}: StockItemCardProps) {
  const unitLabel = formatCantidad(
    item.stock_total ?? 0,
    item.unidad,
    item.unidad_plural ?? undefined,
  )
    .replace(/^[\d.,\s]+/, "")
    .trim();

  if (view === "list") {
    return (
      <tr
        className={cn(
          "hover:bg-primary/5 cursor-pointer transition-colors group border-base-200",
          isSelected && "bg-primary/5 active-row",
        )}
        onClick={onClick}
      >
        <td className="pl-6 py-4">
          <div className="flex items-center gap-2.5">
            <ProductoImage src={item.imagen_url} size="sm" />
            <div className="flex flex-col">
              <span className="font-bold text-sm text-base-content group-hover:text-primary transition-colors">
                {item.producto_nombre}
              </span>
              <span className="text-[10px] font-mono opacity-40 uppercase tracking-tighter">
                #{item.codigo_interno}
              </span>
            </div>
          </div>
        </td>
        <td>
          <span className="text-xs font-medium opacity-60 bg-base-200 px-2 py-1 rounded-lg">
            {item.categoria || "Sin categoría"}
          </span>
        </td>
        <td className="text-center">
          <div className="flex flex-col items-center">
            <span className="font-mono font-bold text-base leading-none">
              {Math.round(item.stock_total ?? 0)}
            </span>
            <span className="text-[9px] opacity-40 uppercase font-bold mt-1">
              {unitLabel}
            </span>
          </div>
        </td>
        <td>
          <StockBadge item={item} />
        </td>
        <td className="pr-6">
          <ChevronRight
            className={cn(
              "w-4 h-4 transition-all opacity-0 group-hover:opacity-100",
              isSelected
                ? "translate-x-1 opacity-100 text-primary"
                : "opacity-20",
            )}
          />
        </td>
      </tr>
    );
  }

  return (
    <button
      onClick={onClick}
      className={cn(
        "flex flex-col p-5 bg-base-100 border border-base-200 rounded-[2rem] text-left transition-all hover:border-primary/40 hover:shadow-xl group relative overflow-hidden",
        isSelected && "ring-2 ring-primary border-transparent shadow-xl",
      )}
    >
      <div className="flex justify-between items-start mb-4">
        <ProductoImage
          src={item.imagen_url}
          size="md"
          className="group-hover:ring-2 group-hover:ring-primary/20"
        />
        <StockBadge item={item} />
      </div>
      <h3 className="font-bold text-base leading-tight mb-1 line-clamp-2">
        {item.producto_nombre}
      </h3>
      <p className="text-[10px] font-mono opacity-40 uppercase mb-4 tracking-widest">
        #{item.codigo_interno}
      </p>

      <div className="mt-auto pt-4 border-t border-base-200/50 flex flex-col gap-2">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-[10px] font-bold opacity-30 uppercase mb-1">
              Disponible
            </p>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl font-bold tabular-nums leading-none">
                {Math.round(item.stock_total ?? 0)}
              </span>
              <span className="text-xs opacity-40">{unitLabel}</span>
            </div>
          </div>
          <div className="h-8 w-8 rounded-xl bg-base-200 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
            <ChevronRight className="w-4 h-4 opacity-40" />
          </div>
        </div>
        {item.dias_autonomia != null && (
          <AutonomiaBar dias={item.dias_autonomia} showLabel />
        )}
      </div>
    </button>
  );
}
