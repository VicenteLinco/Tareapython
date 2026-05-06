// frontend/src/pages/solicitudes-compra/components/horizonte-chips.tsx
import { cn } from '@/lib/utils'

const CHIPS = [7, 15, 30, 90, 180, 365]

interface HorizonteChipsProps {
  horizonteDias: number | null        // chip activo actual (null = modo manual)
  horizonteSugerido: number | null    // valor sugerido por el sistema
  horizonteRazon: string | null       // texto del badge verde
  consumoDiario: number               // para calcular "cubre ~X días"
  cantidad: number                    // para calcular "cubre ~X días"
  onChipSelect: (dias: number) => void
}

export function HorizonteChips({
  horizonteDias,
  horizonteSugerido,
  horizonteRazon,
  consumoDiario,
  cantidad,
  onChipSelect,
}: HorizonteChipsProps) {
  const diasCubiertos = consumoDiario > 0 ? Math.round(cantidad / consumoDiario) : null

  return (
    <div className="mt-1.5 space-y-1">
      {/* Chips */}
      <div className="flex items-center gap-1 flex-wrap">
        <span className="text-[9px] font-bold opacity-40 uppercase tracking-wide mr-0.5">
          Horizonte:
        </span>
        {CHIPS.map(chip => {
          const isActive = horizonteDias === chip
          const isSugerido = horizonteSugerido === chip
          return (
            <button
              key={chip}
              onClick={() => onChipSelect(chip)}
              className={cn(
                "px-2 py-0.5 rounded-full text-[10px] font-bold border transition-all",
                isActive
                  ? "bg-primary text-primary-content border-primary"
                  : "bg-base-100 text-base-content/50 border-base-300 hover:border-primary/40 hover:text-primary"
              )}
            >
              {isSugerido && !isActive && (
                <span className="text-success mr-0.5">★</span>
              )}
              {chip >= 365 ? '1a' : chip >= 180 ? '6m' : chip >= 90 ? '3m' : `${chip}d`}
            </button>
          )
        })}
      </div>

      {/* Razón del sugerido + cobertura actual */}
      <div className="flex items-center gap-2 flex-wrap">
        {diasCubiertos !== null && (
          <span className={cn(
            "text-[10px] font-semibold",
            horizonteDias !== null ? "text-primary/70" : "text-base-content/40"
          )}>
            cubre ~{diasCubiertos} días
          </span>
        )}
        {horizonteRazon && horizonteDias !== null && (
          <span className="text-[9px] bg-success/10 text-success border border-success/20 rounded-md px-1.5 py-0.5 font-medium">
            ★ {horizonteRazon}
          </span>
        )}
        {horizonteDias === null && (
          <span className="text-[9px] opacity-30 italic">cantidad manual</span>
        )}
      </div>
    </div>
  )
}
