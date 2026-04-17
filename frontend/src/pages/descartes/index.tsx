import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { v4 as uuidv4 } from 'uuid'
import {
  Trash2,
  Search,
  Calendar,
  PackageX,
  MapPin,
  Clock,
  AlertTriangle,
  ChevronRight,
  ShieldCheck,
} from 'lucide-react'
import { useAreaStore } from '@/hooks/use-area-store'
import api from '@/lib/api'
import { parseApiError } from '@/lib/api-error'
import type { Area, StockPorArea, DescarteRequest } from '@/types'
import { toast } from 'sonner'
import { cn, formatCantidad, daysUntil, formatDate } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Select } from '@/components/ui/select'

interface DescarteItemLocal extends StockPorArea {
  cantidad_descartar: number
  motivo: 'vencido' | 'dañado' | 'contaminado' | 'otro'
  seleccionado: boolean
}

export default function DescartesPage() {
  const globalAreaId = useAreaStore((s) => s.selectedAreaId)
  const [areaId, setAreaId] = useState<number | null>(globalAreaId)
  const [search, setSearch] = useState('')
  const [filterExpiring, setFilterExpiring] = useState(false)
  const [items, setItems] = useState<Record<string, DescarteItemLocal>>({})
  const [showHealthyWarning, setShowHealthyWarning] = useState(false)
  const [healthyJustification, setHealthyJustification] = useState('')
  const [showSanosPopover, setShowSanosPopover] = useState(false)

  const queryClient = useQueryClient()

  const { data: areas } = useQuery({
    queryKey: ['areas'],
    queryFn: () => api.get<Area[]>('/areas').then((r) => r.data),
  })

  const { data: stock, isLoading } = useQuery({
    queryKey: ['stock-area-lotes', areaId],
    queryFn: () => api.get<StockPorArea[]>(`/stock/area/${areaId}/lotes`).then(r => r.data),
    enabled: !!areaId
  })

  const filteredStock = useMemo(() => {
    if (!stock) return []
    return stock.filter(s => {
      const matchesSearch = s.producto_nombre.toLowerCase().includes(search.toLowerCase()) ||
                           s.codigo_lote.toLowerCase().includes(search.toLowerCase())
      
      if (filterExpiring) {
        const days = daysUntil(s.fecha_vencimiento)
        return matchesSearch && days !== null && days <= 30
      }
      
      return matchesSearch
    })
  }, [stock, search, filterExpiring])

  const descarteMutation = useMutation({
    mutationFn: (data: DescarteRequest) => 
      api.post('/descartes', data, { headers: { 'X-Idempotency-Key': uuidv4() } }),
    onSuccess: () => {
      toast.success('Descarte registrado correctamente')
      queryClient.invalidateQueries({ queryKey: ['stock'] })
      queryClient.invalidateQueries({ queryKey: ['stock-area-lotes'] })
      setItems({})
    },
    onError: (err: any) => toast.error(parseApiError(err))
  })

  const toggleItem = (loteId: string) => {
    setItems(prev => {
      if (prev[loteId]) {
        const { [loteId]: _, ...rest } = prev
        return rest
      }
      const stockItem = stock?.find(s => s.lote_id === loteId)
      if (!stockItem) return prev
      return {
        ...prev,
        [loteId]: {
          ...stockItem,
          cantidad_descartar: stockItem.cantidad,
          motivo: 'vencido',
          seleccionado: true
        }
      }
    })
  }

  const updateItem = (loteId: string, field: keyof DescarteItemLocal, value: any) => {
    setItems(prev => ({
      ...prev,
      [loteId]: { ...prev[loteId], [field]: value }
    }))
  }

  const selectedItems = Object.values(items)
  const totalSelected = selectedItems.length

  const healthyItems = selectedItems.filter(item => {
    const days = daysUntil(item.fecha_vencimiento)
    return item.motivo !== 'vencido' && (days === null || days > 30)
  })
  const hasHealthyItems = healthyItems.length > 0

  const executeDescarte = (justificacion?: string) => {
    if (totalSelected === 0 || !areaId) return

    const payload: DescarteRequest = {
      items: selectedItems.map(i => {
        const days = daysUntil(i.fecha_vencimiento)
        const isHealthy = i.motivo !== 'vencido' && (days === null || days > 30)
        
        // Map frontend "motivo" to backend "tipo"
        const tipo = i.motivo === 'vencido' ? 'DESCARTE_VENCIDO' : 'DESCARTE_DAÑADO'

        return {
          lote_id: i.lote_id,
          area_id: areaId,
          cantidad: i.cantidad_descartar,
          tipo,
          ...(justificacion && isHealthy && { nota: justificacion })
        }
      })
    }

    descarteMutation.mutate(payload)
    setShowHealthyWarning(false)
    setHealthyJustification('')
  }

  const handleConfirm = () => {
    if (hasHealthyItems) {
      setShowHealthyWarning(true)
    } else {
      executeDescarte()
    }
  }

  const areaOptions = useMemo(() => 
    areas?.map(a => ({ value: a.id, label: a.nombre })) || [], 
  [areas])

  return (
    <div className="flex flex-col lg:flex-row h-[calc(100vh-120px)] gap-6">
      
      {/* List side */}
      <div className="flex-1 flex flex-col min-w-0 gap-4">
        <div className="flex flex-col gap-3 bg-base-100 p-4 rounded-2xl border border-base-200">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold flex items-center gap-2">
                <PackageX className="w-5 h-5 text-error" />
                Gestión de Descartes
              </h1>
              <p className="text-xs opacity-50">Retiro de insumos dañados o vencidos</p>
            </div>
            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4 opacity-30" />
              <Select
                value={areaId || ""}
                onChange={(e) => {
                  setAreaId(Number(e.target.value))
                  setItems({})
                }}
                options={areaOptions}
                placeholder="Seleccionar área"
                className="w-[200px] select-sm"
              />
            </div>
          </div>

          {/* Stepper de pasos */}
          <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider flex-wrap">
            {[
              { n: 1, label: 'Área', done: !!areaId },
              { n: 2, label: 'Filtros', done: !!areaId },
              { n: 3, label: 'Selección', done: totalSelected > 0 },
              { n: 4, label: 'Motivo y confirmación', done: false },
            ].map((step, idx, arr) => (
              <div key={step.n} className="flex items-center gap-1">
                <span className={cn(
                  "w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-black shrink-0",
                  step.done ? "bg-success text-success-content" : "bg-base-200 text-base-content/40"
                )}>
                  {step.done ? '✓' : step.n}
                </span>
                <span className={cn(step.done ? "text-success" : "text-base-content/40")}>{step.label}</span>
                {idx < arr.length - 1 && <ChevronRight className="w-3 h-3 text-base-content/20 shrink-0" />}
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 opacity-30" />
            <Input 
              placeholder="Buscar por insumo o lote..." 
              className="pl-9"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <Button 
            variant={filterExpiring ? "default" : "outline"}
            size="sm"
            onClick={() => setFilterExpiring(!filterExpiring)}
            className="gap-2"
          >
            <Clock className="w-4 h-4" />
            Vencimiento &lt; 30d
          </Button>
        </div>

        {/* Footer sticky: selección y sanos */}
        {totalSelected > 0 && (
          <div className="sticky bottom-0 bg-base-100 border border-base-200 rounded-2xl shadow-lg px-4 py-3 flex items-center justify-between gap-3 z-10">
            <div className="flex items-center gap-3 min-w-0">
              <span className="text-sm font-bold shrink-0">
                {totalSelected} {totalSelected === 1 ? 'ítem seleccionado' : 'ítems seleccionados'}
              </span>
              {hasHealthyItems && (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold text-warning flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5" /> {healthyItems.length} sanos
                  </span>
                  <div className="relative">
                    <button
                      className="text-[10px] text-warning underline underline-offset-2 hover:opacity-80"
                      onClick={e => { e.stopPropagation(); setShowSanosPopover(v => !v) }}
                    >
                      Ver detalle
                    </button>
                    {showSanosPopover && (
                      <div className="absolute bottom-full left-0 mb-2 z-50 bg-base-100 border border-base-200 rounded-2xl shadow-2xl p-3 min-w-[240px] max-h-48 overflow-y-auto">
                        <p className="text-[10px] font-bold opacity-50 uppercase tracking-wider mb-2">Items sanos seleccionados</p>
                        <ul className="space-y-1">
                          {healthyItems.map(i => (
                            <li key={i.lote_id} className="text-xs flex items-center justify-between gap-2">
                              <span className="truncate font-medium">{i.producto_nombre}</span>
                              <span className="text-[9px] font-mono opacity-50 shrink-0">{i.codigo_lote}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
            <button
              className="btn btn-error btn-sm rounded-xl gap-1.5 shrink-0"
              onClick={handleConfirm}
              disabled={descarteMutation.isPending}
            >
              <Trash2 className="w-3.5 h-3.5" />
              Continuar
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto rounded-xl border border-base-200 bg-base-100">
          <table className="table w-full">
            <thead className="sticky top-0 bg-base-100 z-10">
              <tr className="bg-base-200/50 text-[11px] uppercase tracking-wider opacity-60">
                <th className="w-10"></th>
                <th>Insumo / Lote</th>
                <th>Vencimiento</th>
                <th className="text-right">Stock</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                [1, 2, 3].map(i => <tr key={i}><td colSpan={4}><div className="h-12 bg-base-200 animate-pulse rounded-lg" /></td></tr>)
              ) : !areaId ? (
                <tr><td colSpan={4} className="py-20 text-center opacity-40 italic">Selecciona un área para ver el stock</td></tr>
              ) : filteredStock.length === 0 ? (
                <tr><td colSpan={4} className="py-20 text-center opacity-40 italic">No se encontraron ítems</td></tr>
              ) : (
                filteredStock.map(s => {
                  const days = daysUntil(s.fecha_vencimiento)
                  const isExpired = days !== null && days < 0
                  const isExpiring = days !== null && days <= 30
                  const isSelected = !!items[s.lote_id]
                  const isSano = !isExpired && (days === null || days > 30)

                  return (
                    <tr
                      key={s.lote_id}
                      className={cn(
                        "hover:bg-base-200/30 cursor-pointer transition-colors",
                        isSelected && "bg-primary/5 hover:bg-primary/10"
                      )}
                      onClick={() => toggleItem(s.lote_id)}
                    >
                      <td>
                        <input
                          type="checkbox"
                          className="checkbox checkbox-sm checkbox-error"
                          checked={isSelected}
                          readOnly
                        />
                      </td>
                      <td>
                        <div className="flex flex-col gap-0.5">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-bold text-sm">{s.producto_nombre}</span>
                            {isSano && (
                              <span
                                className="inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-success/10 text-success border border-success/20"
                                title="Vencimiento > 30 días. Requerirá justificación para descartar."
                              >
                                <ShieldCheck className="w-2.5 h-2.5" /> sano
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] font-mono opacity-50">LOTE: {s.codigo_lote}</span>
                        </div>
                      </td>
                      <td>
                        <div className="flex items-center gap-2">
                          <Calendar className="w-3.5 h-3.5 opacity-30" />
                          <span className={cn(
                            "text-xs font-medium",
                            isExpired ? "text-error" : isExpiring ? "text-warning" : ""
                          )}>
                            {formatDate(s.fecha_vencimiento)}
                          </span>
                          {isExpired && <Badge variant="destructive" className="h-4 text-[8px] px-1">VENCIDO</Badge>}
                        </div>
                      </td>
                      <td className="text-right">
                        <span className="font-mono font-bold text-sm">
                          {formatCantidad(s.cantidad, s.unidad_base_nombre, s.unidad_base_nombre_plural)}
                        </span>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Cart Side */}
      <div className={cn(
        "w-full lg:w-96 flex flex-col bg-base-100 border border-base-200 rounded-2xl shadow-xl transition-all",
        totalSelected === 0 && "opacity-50 grayscale"
      )}>
        <div className="p-6 border-b border-base-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Trash2 className="w-5 h-5 text-error" />
            <h2 className="font-bold">Ítems a Descartar</h2>
          </div>
          <Badge variant="outline">{totalSelected}</Badge>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {totalSelected === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center opacity-30 gap-2">
              <PackageX className="w-12 h-12" />
              <p className="text-sm">Selecciona ítems de la lista<br/>para procesar el descarte</p>
            </div>
          ) : (
            selectedItems.map(item => (
              <div key={item.lote_id} className="p-4 bg-base-200/50 rounded-xl border border-base-300 space-y-3">
                <div className="flex justify-between items-start">
                  <span className="text-xs font-bold line-clamp-1">{item.producto_nombre}</span>
                  <button onClick={() => toggleItem(item.lote_id)} className="text-error opacity-50 hover:opacity-100">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-[9px] font-bold opacity-40 uppercase tracking-wider">Cantidad</label>
                    <input 
                      type="number"
                      className="input input-bordered input-xs w-full font-mono font-bold"
                      value={item.cantidad_descartar}
                      max={item.cantidad}
                      onChange={e => updateItem(item.lote_id, 'cantidad_descartar', Number(e.target.value))}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] font-bold opacity-40 uppercase tracking-wider">Motivo</label>
                    <select 
                      className="select select-bordered select-xs w-full text-[10px]"
                      value={item.motivo}
                      onChange={e => updateItem(item.lote_id, 'motivo', e.target.value)}
                    >
                      <option value="vencido">Vencido</option>
                      <option value="dañado">Dañado</option>
                      <option value="contaminado">Contaminado</option>
                      <option value="otro">Otro</option>
                    </select>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="p-6 border-t border-base-200 bg-base-200/30">
          <Button 
            className="w-full h-12 rounded-xl gap-2" 
            variant="destructive"
            disabled={totalSelected === 0 || descarteMutation.isPending}
            onClick={handleConfirm}
          >
            {descarteMutation.isPending ? <span className="loading loading-spinner" /> : <Trash2 className="w-4 h-4" />}
            Confirmar Descarte
          </Button>
          <p className="text-[10px] text-center mt-3 opacity-40 leading-tight">
            Esta acción es irreversible y generará movimientos de salida tipo DESCARTE en el historial.
          </p>
        </div>
      </div>

      {/* Modal advertencia ítems saludables */}
      {showHealthyWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-base-100 rounded-3xl shadow-2xl border border-error/30 w-full max-w-md mx-4 overflow-hidden">
            <div className="bg-error/10 px-6 py-5 flex items-center gap-3 border-b border-error/20">
              <AlertTriangle className="w-6 h-6 text-error shrink-0" />
              <div>
                <h3 className="font-bold text-base">¿Descartar insumos en buen estado?</h3>
                <p className="text-xs opacity-60 mt-0.5">
                  Descartando {totalSelected} {totalSelected === 1 ? 'ítem' : 'ítems'} · {healthyItems.length} {healthyItems.length === 1 ? 'sano requiere' : 'sanos requieren'} justificación
                </p>
              </div>
            </div>

            <div className="p-6 space-y-4">
              <p className="text-sm opacity-70">
                Los siguientes lotes no están vencidos ni próximos a vencer:
              </p>

              <ul className="space-y-1.5 max-h-40 overflow-y-auto">
                {healthyItems.map(item => (
                  <li key={item.lote_id} className="flex items-center justify-between text-xs bg-base-200/50 rounded-xl px-3 py-2">
                    <span className="font-bold truncate">{item.producto_nombre}</span>
                    <span className="font-mono opacity-60 ml-2 shrink-0">{item.cantidad_descartar} uds</span>
                  </li>
                ))}
              </ul>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-widest opacity-50">
                  Justificación obligatoria
                </label>
                <textarea
                  className="textarea textarea-bordered w-full rounded-2xl bg-base-100 resize-none text-sm h-20 focus:ring-2 ring-error/20"
                  placeholder="Explica por qué se descarta este material en buen estado..."
                  value={healthyJustification}
                  onChange={e => setHealthyJustification(e.target.value)}
                />
                <p className="text-[10px] opacity-40 text-right">
                  {healthyJustification.length}/10 caracteres mínimos
                </p>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  className="btn btn-ghost btn-block"
                  onClick={() => { setShowHealthyWarning(false); setHealthyJustification('') }}
                >
                  Cancelar
                </button>
                <button
                  className="btn btn-error btn-block gap-2"
                  disabled={healthyJustification.trim().length < 10 || descarteMutation.isPending}
                  onClick={() => executeDescarte(healthyJustification.trim())}
                >
                  {descarteMutation.isPending ? <span className="loading loading-spinner loading-sm" /> : <Trash2 className="w-4 h-4" />}
                  Confirmar de todas formas
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
