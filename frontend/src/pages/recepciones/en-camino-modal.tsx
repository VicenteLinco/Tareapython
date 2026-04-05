import { useState, useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Package, CheckCircle2, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import api from '@/lib/api'
import { cn } from '@/lib/utils'

interface EnCaminoItem {
  id: string
  producto_nombre: string
  cantidad_sugerida: string
  unidad: string
  proveedor_nombre: string | null
  estado: string
}

interface EnCaminoModalProps {
  recepcionId: string
  proveedorId: number | null
  onClose: () => void
  onDone: () => void
}

export function EnCaminoModal({ recepcionId, proveedorId, onClose, onDone }: EnCaminoModalProps) {
  const queryClient = useQueryClient()
  const [items, setItems] = useState<EnCaminoItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!proveedorId) { onDone(); return }
    api.get<{ data: EnCaminoItem[] }>('/solicitudes-compra', {
      params: { proveedor_id: proveedorId, estado: 'en_camino', per_page: 50 }
    }).then(r => {
      const data = r.data.data ?? []
      setItems(data)
      setSeleccionados(new Set(data.map(i => i.id)))
      if (data.length === 0) onDone()
    }).catch(() => onDone())
      .finally(() => setIsLoading(false))
  }, [proveedorId])

  const toggleItem = (id: string) => {
    setSeleccionados(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const reconciliarMutation = useMutation({
    mutationFn: () => api.post(`/recepciones/${recepcionId}/reconciliar`, {
      item_ids: Array.from(seleccionados)
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recepciones'] })
      queryClient.invalidateQueries({ queryKey: ['solicitudes-historial'] })
      toast.success(`${seleccionados.size} ítem${seleccionados.size !== 1 ? 's' : ''} marcado${seleccionados.size !== 1 ? 's' : ''} como recibido${seleccionados.size !== 1 ? 's' : ''}`)
      onDone()
    },
    onError: () => toast.error('Error al reconciliar ítems'),
  })

  if (isLoading) return null

  return (
    <div className="modal modal-open">
      <div className="modal-box max-w-lg">
        <h3 className="font-bold text-lg mb-1 flex items-center gap-2">
          <Package className="h-5 w-5 text-warning" />
          ¿Llegaron estos productos esperados?
        </h3>
        <p className="text-sm opacity-50 mb-4">
          Estos ítems estaban en camino del mismo proveedor. Marca los que llegaron en esta recepción.
        </p>

        <div className="space-y-2 max-h-64 overflow-y-auto mb-4">
          {items.map(item => {
            const checked = seleccionados.has(item.id)
            return (
              <label
                key={item.id}
                className={cn(
                  'flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all',
                  checked ? 'bg-success/5 border-success/30' : 'bg-warning/5 border-warning/20'
                )}
              >
                <input
                  type="checkbox"
                  className="checkbox checkbox-sm checkbox-success"
                  checked={checked}
                  onChange={() => toggleItem(item.id)}
                />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm truncate">{item.producto_nombre}</p>
                  <p className="text-xs opacity-50">{item.cantidad_sugerida} {item.unidad}</p>
                </div>
                {checked
                  ? <span className="badge badge-success badge-sm gap-1"><CheckCircle2 className="h-3 w-3" />Recibido</span>
                  : <span className="badge badge-warning badge-sm gap-1"><AlertTriangle className="h-3 w-3" />Pendiente</span>
                }
              </label>
            )
          })}
        </div>

        <div className="modal-action">
          <button className="btn btn-ghost" onClick={onClose}>Omitir</button>
          <button
            className="btn btn-success gap-2"
            disabled={seleccionados.size === 0 || reconciliarMutation.isPending}
            onClick={() => reconciliarMutation.mutate()}
          >
            {reconciliarMutation.isPending
              ? <span className="loading loading-spinner loading-sm" />
              : <><CheckCircle2 className="h-4 w-4" />Marcar {seleccionados.size} como recibido{seleccionados.size !== 1 ? 's' : ''}</>
            }
          </button>
        </div>
      </div>
      <div className="modal-backdrop" onClick={onClose} />
    </div>
  )
}
