import { AlertTriangle, AlertCircle, Info, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'

type Urgencia = 'critica' | 'alta' | 'media' | 'ok'

const CONFIG: Record<Urgencia, { label: string; cls: string; Icon: React.ElementType }> = {
  critica: { label: 'Crítica',  cls: 'badge-error',   Icon: AlertCircle },
  alta:    { label: 'Alta',     cls: 'badge-warning',  Icon: AlertTriangle },
  media:   { label: 'Media',    cls: 'badge-info',     Icon: Info },
  ok:      { label: 'Normal',   cls: 'badge-success',  Icon: CheckCircle2 },
}

interface UrgenciaTagProps {
  valor: string
  showLabel?: boolean
  size?: 'sm' | 'md'
  className?: string
}

export function UrgenciaTag({ valor, showLabel = true, size = 'md', className }: UrgenciaTagProps) {
  const cfg = CONFIG[valor as Urgencia] ?? CONFIG.ok
  const { label, cls, Icon } = cfg

  return (
    <span
      className={cn(
        'badge gap-1 font-medium',
        size === 'sm' ? 'badge-sm' : '',
        cls,
        className,
      )}
      title={showLabel ? undefined : label}
    >
      <Icon className={size === 'sm' ? 'size-3' : 'size-3.5'} />
      {showLabel && label}
    </span>
  )
}
