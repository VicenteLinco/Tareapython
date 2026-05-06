import { cn } from '@/lib/utils'

interface AutonomiaBarProps {
  /** Días de autonomía calculados (null = sin datos) */
  dias: number | null
  /** Ancho máximo en px o clase CSS (opcional) */
  className?: string
  showLabel?: boolean
}

function getZone(dias: number | null): { pct: number; color: string; label: string } {
  if (dias === null || dias < 0) return { pct: 0, color: 'bg-base-300', label: 'Sin datos' }
  /* zonas: 0-7 rojo, 8-30 amarillo, >30 verde — cap a 100% en 90 días */
  const pct = Math.min(100, (dias / 90) * 100)
  if (dias <= 7)  return { pct, color: 'bg-error',   label: `${Math.round(dias)}d` }
  if (dias <= 30) return { pct, color: 'bg-warning',  label: `${Math.round(dias)}d` }
  return             { pct, color: 'bg-success',  label: `${Math.round(dias)}d` }
}

export function AutonomiaBar({ dias, className, showLabel = true }: AutonomiaBarProps) {
  const { pct, color, label } = getZone(dias)

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="h-2 flex-1 rounded-full bg-base-300 overflow-hidden min-w-[60px]">
        <div
          className={cn('h-full rounded-full transition-all duration-300', color)}
          style={{ width: `${pct}%` }}
        />
      </div>
      {showLabel && (
        <span className="t-caption tabular-nums w-8 text-right shrink-0">{label}</span>
      )}
    </div>
  )
}
