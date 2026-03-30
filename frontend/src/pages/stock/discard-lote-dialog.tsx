import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import api from '@/lib/api'
import { AlertCircle, History, AlertTriangle } from 'lucide-react'
import { daysUntil, cn } from '@/lib/utils'
import type { StockPorArea } from '@/types'

interface DiscardLoteDialogProps {
  open: boolean
  loteId: string | null
  numeroLote: string
  productoNombre: string
  defaultAreaId: number | null
  onClose: () => void
}

export function DiscardLoteDialog({ open, loteId, numeroLote, productoNombre, defaultAreaId, onClose }: DiscardLoteDialogProps) {
  const queryClient = useQueryClient()
  const [areaId, setAreaId] = useState<string>('')
  const [cantidad, setCantidad] = useState<string>('')
  const [tipo, setTipo] = useState<string>('DESCARTE_VENCIDO')
  const [nota, setNota] = useState('')
  const [error, setError] = useState('')

  // Fetch lot details to get stock per area
  const { data, isLoading } = useQuery({
    queryKey: ['lote-detail', loteId],
    queryFn: () => api.get(`/lotes/${loteId}`).then(r => r.data),
    enabled: !!loteId && open
  })

  const stockPorArea: StockPorArea[] = data?.stock_por_area || []
  const fechaVencimiento = data?.fecha_vencimiento
  const isExpired = fechaVencimiento ? (daysUntil(fechaVencimiento) ?? 1) <= 0 : false

  // Initialize areaId and context-aware type when data loads
  useEffect(() => {
    if (stockPorArea.length > 0) {
      if (defaultAreaId && stockPorArea.some(s => s.area_id === defaultAreaId)) {
        setAreaId(defaultAreaId.toString())
      } else if (!areaId) {
        setAreaId(stockPorArea[0].area_id.toString())
      }
    }
    
    if (fechaVencimiento) {
      setTipo(isExpired ? 'DESCARTE_VENCIDO' : 'DESCARTE_OTRO')
    }
  }, [stockPorArea, defaultAreaId, open, fechaVencimiento, isExpired])

  // Update max quantity when area changes
  useEffect(() => {
    if (areaId) {
      const stock = stockPorArea.find(s => s.area_id === Number(areaId))
      if (stock) {
        setCantidad(Math.round(stock.cantidad).toString())
      } else {
        setCantidad('')
      }
    }
  }, [areaId, stockPorArea])

  const mutation = useMutation({
    mutationFn: async () => {
      if (!loteId || !areaId || !cantidad) throw new Error('Faltan datos')
      
      const idemKey = `idem-discard-${loteId}-${Date.now()}`

      await api.post('/descartes', {
        items: [{
          lote_id: loteId,
          area_id: Number(areaId),
          cantidad: Number(cantidad),
          tipo,
          nota: nota || undefined
        }]
      }, { headers: { 'X-Idempotency-Key': idemKey } })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stock'] })
      queryClient.invalidateQueries({ queryKey: ['lotes'] })
      queryClient.invalidateQueries({ queryKey: ['alertas'] })
      onClose()
    },
    onError: (err: any) => {
      const msg = err.response?.data?.error || err.response?.data?.message || err.message || 'Error al descartar lote'
      setError(msg)
    }
  })

  // Reset state when opened
  useEffect(() => {
    if (open) {
      setError('')
      setNota('')
    }
  }, [open])

  const maxCantidad = areaId ? stockPorArea.find(s => s.area_id === Number(areaId))?.cantidad ?? 0 : 0

  return (
    <Dialog open={open} onClose={onClose} title="Descartar Lote">
      <div className="space-y-4">
        {/* Context Info */}
        <div className={cn(
          "p-3 rounded-xl border flex items-start gap-3",
          isExpired ? "bg-error/5 border-error/20" : "bg-base-200/50 border-base-200"
        )}>
          {isExpired ? (
             <AlertTriangle className="w-5 h-5 text-error shrink-0" />
          ) : (
             <History className="w-5 h-5 text-primary shrink-0 opacity-50" />
          )}
          <div className="text-sm">
            <p className="font-bold leading-none mb-1">{productoNombre}</p>
            <p className="opacity-50 text-xs">Lote: <span className="font-mono">{numeroLote}</span></p>
            {isExpired && (
              <p className="text-error font-bold text-[10px] uppercase mt-1">Lote Vencido el {fechaVencimiento}</p>
            )}
          </div>
        </div>

        {error && (
          <div className="p-3 bg-error/10 text-error rounded-lg text-sm flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {isLoading ? (
          <div className="py-4 text-center text-sm opacity-50">Cargando información del lote...</div>
        ) : stockPorArea.length === 0 && !isLoading ? (
          <div className="py-12 text-center text-sm opacity-50 space-y-2">
            <AlertTriangle className="w-10 h-10 mx-auto opacity-20" />
            <p>Este lote no tiene stock disponible en ninguna área.</p>
          </div>
        ) : (
          <form 
            onSubmit={(e) => {
              e.preventDefault()
              mutation.mutate()
            }} 
            className="space-y-4"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label text-[10px] font-bold uppercase tracking-wider opacity-50">Área de Retiro</label>
                <Select 
                  value={areaId} 
                  onChange={(e) => setAreaId(e.target.value)} 
                  required
                  placeholder="Seleccione área"
                  options={stockPorArea.map(s => ({
                    value: s.area_id.toString(),
                    label: `${s.area_nombre} (${Math.round(s.cantidad)})`
                  }))}
                />
              </div>

              <div>
                <label className="label text-[10px] font-bold uppercase tracking-wider opacity-50">Cantidad a Descartar</label>
                <div className="relative">
                  <Input 
                    type="number" 
                    min="1" 
                    max={Math.round(maxCantidad)}
                    value={cantidad} 
                    onChange={(e) => setCantidad(e.target.value)} 
                    required 
                    className="font-mono font-bold"
                  />
                  <div className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold opacity-30">MAX: {Math.round(maxCantidad)}</div>
                </div>
              </div>
            </div>

            <div>
              <label className="label text-[10px] font-bold uppercase tracking-wider opacity-50">Motivo del Descarte</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  className={cn(
                    "btn btn-sm h-12 rounded-xl flex flex-col items-center justify-center gap-0.5 border-2 transition-all",
                    tipo === 'DESCARTE_VENCIDO' 
                      ? "btn-error text-white border-error shadow-lg shadow-error/20" 
                      : "btn-ghost border-base-200 opacity-50",
                    !isExpired && "pointer-events-none opacity-20" // Vencido es forzado si ya venció
                  )}
                  onClick={() => setTipo('DESCARTE_VENCIDO')}
                >
                  <span className="text-xs font-bold">Vencimiento</span>
                </button>
                <button
                  type="button"
                  className={cn(
                    "btn btn-sm h-12 rounded-xl flex flex-col items-center justify-center gap-0.5 border-2 transition-all",
                    tipo === 'DESCARTE_OTRO' 
                      ? "btn-primary text-primary-content border-primary shadow-lg shadow-primary/20" 
                      : "btn-ghost border-base-200 opacity-50",
                    isExpired && "pointer-events-none opacity-20" // No puedes elegir otro si ya venció
                  )}
                  onClick={() => setTipo('DESCARTE_OTRO')}
                >
                  <span className="text-xs font-bold">Deterioro / Daño</span>
                </button>
              </div>
            </div>

            <div>
              <label className="label text-[10px] font-bold uppercase tracking-wider opacity-50">Notas de Auditoría</label>
              <textarea 
                className="textarea textarea-bordered w-full rounded-2xl bg-base-100 border-base-200 focus:ring-2 ring-primary/10 transition-all resize-none text-sm h-20"
                placeholder={isExpired ? "Opcional: Detalles del retiro..." : "Obligatorio: Describa el motivo del descarte..."}
                value={nota}
                onChange={(e) => setNota(e.target.value)}
                required={!isExpired} // Obligatorio si no es vencimiento
                maxLength={100}
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={onClose} disabled={mutation.isPending}>
                Cancelar
              </Button>
              <Button 
                type="submit" 
                variant={isExpired ? "destructive" : "default"} 
                disabled={mutation.isPending || !areaId || !cantidad || (!isExpired && !nota)}
                className="h-11 px-8 rounded-xl"
              >
                {mutation.isPending ? 'Procesando...' : isExpired ? 'Confirmar Baja por Vencimiento' : 'Confirmar Descarte Manual'}
              </Button>
            </div>
          </form>
        )}
      </div>
    </Dialog>
  )
}