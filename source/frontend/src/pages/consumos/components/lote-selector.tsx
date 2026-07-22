import { useState } from "react";
import { ChevronDown, Sparkles, Check } from "lucide-react";
import { cn, formatCantidad, formatDate, daysUntil } from "@/lib/utils";

export interface LoteDisponible {
  lote_id: string;
  numero_lote: string;
  stock: number;
  fecha_vencimiento: string;
  area_id: number;
  area_nombre: string;
}

interface LoteSelectorProps {
  lotes: LoteDisponible[];
  cargandoLotes: boolean;
  loteElegidoId: string | null; // null = FEFO automático
  unidad: string;
  unidad_plural: string;
  isTrazable?: boolean;
  onChange: (loteId: string | null) => void;
}

export function LoteSelector({
  lotes,
  cargandoLotes,
  loteElegidoId,
  unidad,
  unidad_plural,
  isTrazable,
  onChange,
}: LoteSelectorProps) {
  const [open, setOpen] = useState(false);

  if (cargandoLotes) {
    return (
      <div className="flex items-center gap-1.5 h-7">
        <span className="loading loading-spinner loading-xs opacity-40" />
        <span className="text-[11px] text-base-content/40">
          Cargando lotes…
        </span>
      </div>
    );
  }

  if (lotes.length === 0) {
    return (
      <span className="text-[11px] text-warning/80 font-medium">
        Sin lotes disponibles
      </span>
    );
  }

  const loteActual = lotes.find((l) => l.lote_id === loteElegidoId);
  const label = loteActual
    ? loteActual.numero_lote
    : isTrazable
      ? "Seleccionar lote *"
      : "FEFO automático";

  return (
    <div className="relative">
      {/* Trigger — pill coloreado */}
      <button
        type="button"
        className={cn(
          "flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg transition-all duration-150",
          loteActual
            ? "bg-primary/10 text-primary hover:bg-primary/18 border border-primary/20"
            : isTrazable
              ? "bg-warning/10 text-warning hover:bg-warning/18 border border-warning/20"
              : "bg-success/10 text-success hover:bg-success/18 border border-success/20",
        )}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
      >
        {!loteActual && !isTrazable && (
          <Sparkles className="h-3 w-3 flex-shrink-0" />
        )}
        <span className="max-w-[110px] truncate">{label}</span>
        <ChevronDown
          className={cn(
            "h-3 w-3 flex-shrink-0 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="app-floating-menu absolute top-full left-0 mt-1.5 rounded-box min-w-[220px] max-h-56 overflow-y-auto">
          {/* FEFO automático */}
          {!isTrazable && (
            <>
              <button
                type="button"
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 text-xs transition-colors text-left",
                  loteElegidoId === null
                    ? "bg-success/8 text-success"
                    : "hover:bg-base-200 text-base-content",
                )}
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                }}
              >
                <Sparkles className="h-3.5 w-3.5 flex-shrink-0 text-success" />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold">FEFO automático</div>
                  <div className="text-base-content/40 font-normal text-[11px]">
                    El sistema elige el lote más próximo a vencer
                  </div>
                </div>
                {loteElegidoId === null && (
                  <Check className="h-3.5 w-3.5 text-success flex-shrink-0" />
                )}
              </button>
              <div className="border-t border-base-200 mx-2" />
            </>
          )}

          {lotes.map((l) => {
            const isSelected = loteElegidoId === l.lote_id;
            // Lote vencido: no se consume, sólo se descarta. Se muestra bloqueado
            // para que el usuario VEA que hay algo y entienda la acción correcta.
            const diasParaVencer = daysUntil(l.fecha_vencimiento);
            const vencido = diasParaVencer !== null && diasParaVencer < 0;
            if (vencido) {
              return (
                <div
                  key={l.lote_id}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-xs text-left opacity-60 cursor-not-allowed select-none"
                  title="Lote vencido — sólo puede descartarse, no consumirse"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold font-mono line-through text-base-content/50">
                      {l.numero_lote}
                    </div>
                    <div className="text-error/70 font-bold text-[11px] uppercase tracking-tight">
                      Vencido — descartar
                    </div>
                  </div>
                </div>
              );
            }
            return (
              <button
                key={l.lote_id}
                type="button"
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 text-xs transition-colors text-left",
                  isSelected
                    ? "bg-primary/8 text-primary"
                    : "hover:bg-base-200 text-base-content",
                )}
                onClick={() => {
                  onChange(l.lote_id);
                  setOpen(false);
                }}
              >
                <div className="flex-1 min-w-0">
                  <div className="font-semibold font-mono">{l.numero_lote}</div>
                  <div className="text-base-content/40 font-normal text-[11px]">
                    {formatCantidad(l.stock, unidad, unidad_plural)} · vence{" "}
                    {formatDate(l.fecha_vencimiento)}
                  </div>
                </div>
                {isSelected && (
                  <Check className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
