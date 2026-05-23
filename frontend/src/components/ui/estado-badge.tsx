import { cn } from '@/lib/utils'

/* Paleta fija por significado semántico */
const ESTADO_CONFIG: Record<string, { label: string; cls: string }> = {
  /* neutro — no confirmado aún */
  borrador:              { label: 'Borrador',          cls: 'badge-ghost border border-base-300' },
  /* en proceso */
  en_proceso:            { label: 'En proceso',        cls: 'badge-info' },
  en_progreso:           { label: 'En progreso',       cls: 'badge-info' },
  pendiente_aprobacion:  { label: 'Pend. aprobación',  cls: 'badge-warning' },
  pendiente:             { label: 'Pendiente',         cls: 'badge-warning' },
  guardada:              { label: 'Pendiente',         cls: 'badge-warning' },
  parcialmente_enviada:  { label: 'Env. parcial',      cls: 'badge-info' },
  parcialmente_recibida: { label: 'Rec. parcial',      cls: 'badge-warning' },
  enviada:               { label: 'Enviada',           cls: 'badge-info' },
  /* ok / finalizado */
  confirmada:            { label: 'Confirmada',        cls: 'badge-success' },
  confirmado:            { label: 'Confirmado',        cls: 'badge-success' },
  completa:              { label: 'Completa',          cls: 'badge-success' },
  completada:            { label: 'Completada',        cls: 'badge-success' },
  aprobada:              { label: 'Aprobada',          cls: 'badge-success' },
  cerrada:               { label: 'Cerrada',           cls: 'badge-success badge-outline' },
  /* peligro / denegado */
  rechazada:             { label: 'Rechazada',         cls: 'badge-error' },
  cancelado:             { label: 'Cancelado',         cls: 'badge-error badge-outline' },
  cancelada:             { label: 'Cancelada',         cls: 'badge-error badge-outline' },
}

interface EstadoBadgeProps {
  estado: string
  size?: 'sm' | 'md'
  className?: string
  title?: string
}

export function EstadoBadge({ estado, size = 'md', className, title }: EstadoBadgeProps) {
  const config = ESTADO_CONFIG[estado] ?? { label: estado, cls: 'badge-ghost' }

  return (
    <span
      className={cn(
        'badge font-medium',
        size === 'sm' ? 'badge-sm' : '',
        config.cls,
        className,
      )}
      title={title}
    >
      {config.label}
    </span>
  )
}
