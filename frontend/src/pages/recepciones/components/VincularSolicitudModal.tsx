// frontend/src/pages/recepciones/components/VincularSolicitudModal.tsx
import { Badge } from '@/components/ui/badge'
import { Dialog } from '@/components/ui/dialog'
import { formatDate } from '@/lib/utils'
import type { SolicitudResumen } from '@/types'

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface Props {
  open: boolean
  onClose: () => void
  solicitudes: SolicitudResumen[] | undefined
  solicitudIdActual: string | null
  onVincular: (id: string, numero: string) => void
  onDesvincular: () => void
}

// ─── Componente ───────────────────────────────────────────────────────────────

export function VincularSolicitudModal({
  open,
  onClose,
  solicitudes,
  onVincular,
}: Props) {
  return (
    <Dialog open={open} onClose={onClose} title="Vincular Solicitud">
      <div className="space-y-2">
        {solicitudes?.map(s => (
          <button
            key={s.id}
            className="w-full p-4 border rounded-xl hover:bg-base-200 text-left"
            onClick={() => onVincular(s.id, s.numero_documento)}
          >
            <div className="flex justify-between items-center">
              <div>
                <p className="font-bold text-sm">{s.numero_documento}</p>
                <p className="text-xs opacity-50">{formatDate(s.fecha_creacion)}</p>
              </div>
              <Badge variant="outline">{s.items_count} ítems</Badge>
            </div>
          </button>
        ))}
        {solicitudes?.length === 0 && (
          <p className="text-center py-8 opacity-40 text-sm">No hay solicitudes aprobadas para este proveedor.</p>
        )}
      </div>
    </Dialog>
  )
}
