import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { v4 as uuidv4 } from 'uuid'
import {
  Search, Plus, Minus, Trash2, Send,
  Zap, AlertTriangle,
  Camera, X
} from 'lucide-react'
import { ProductoImage } from '@/components/ui/producto-image'
import api from '@/lib/api'
import { parseApiError } from '@/lib/api-error'
import type { ConsumoBatchRequest, StockItem, PaginatedResponse } from '@/types'
import { toast } from 'sonner'
import { cn, formatCantidad } from '@/lib/utils'
import { QrScanner } from '@/components/shared/qr-scanner'
import { Badge } from '@/components/ui/badge'

interface StockProduct {
  producto_id: string
  codigo_interno: string
  nombre: string
  unidad: string
  unidad_plural: string
  stock_minimo: number | null
  stock: number
  area_id: number
  area_nombre: string
  presentaciones?: {
    id: number
    nombre: string
    nombre_plural: string
    factor_conversion: number
  }[]
  lotes?: {
    lote_id: string
    numero_lote: string
    stock: number
    fecha_vencimiento: string
  }[]
  imagen_url?: string | null
}

interface CartItem extends StockProduct {
  cantidad_descontar: number
  unidad_usada: 'base' | 'presentacion'
  presentacion_id_usada?: number
  factor_usado: number
  nombre_unidad_usada: string
}

export default function ConsumosPage() {
  const [searchQuery, setSearchQuery] = useState('')
  const [cart, setCart] = useState<Record<string, CartItem>>({})
  const [notas, setNotas] = useState('')
  const [isScannerOpen, setIsScannerOpen] = useState(false)

  const queryClient = useQueryClient()

  const { data: stockResponse, isLoading } = useQuery({
    queryKey: ['stock-list', searchQuery],
    queryFn: () => api.get<PaginatedResponse<StockItem>>('/stock', {
      params: {
        ...(searchQuery.length > 2 && { q: searchQuery }),
        per_page: 100
      }
    }).then(r => r.data),
  })

  const addToCart = (p: StockItem) => {
    if ((p.stock_total || 0) <= 0) {
      toast.error('No hay stock disponible', { icon: <AlertTriangle className="text-error" /> })
      return
    }

    const cartKey = `${p.producto_id}-${p.area_id}`
    
    setCart(prev => {
      const existing = prev[cartKey]
      return {
        ...prev,
        [cartKey]: {
          producto_id: p.producto_id,
          codigo_interno: p.codigo_interno,
          nombre: p.producto_nombre,
          unidad: p.unidad,
          unidad_plural: p.unidad_plural || p.unidad,
          stock_minimo: p.stock_minimo,
          stock: p.stock_total || 0,
          area_id: p.area_id!,
          area_nombre: p.area_nombre || '',
          imagen_url: p.imagen_url,
          cantidad_descontar: (existing?.cantidad_descontar || 0) + 1,
          unidad_usada: 'base',
          factor_usado: 1,
          nombre_unidad_usada: p.unidad
        }
      }
    })
    toast.success(`${p.producto_nombre} añadido`)
  }

  const handleScan = async (code: string) => {
    try {
      const stockRes = await api.get<PaginatedResponse<StockItem>>('/stock', { params: { q: code } })
      const items = stockRes.data.data
      if (items.length === 0) {
        toast.error('Producto sin stock en ninguna área')
        return
      }
      const toAdd = items[0]
      addToCart(toAdd)
      setIsScannerOpen(false)
    } catch {
      toast.error('Error al escanear')
    }
  }

  const handleConfirm = () => {
    const items = Object.values(cart)
    if (items.length === 0) return
    
    batchMutation.mutate({
      items: items.map(i => ({
        producto_id: i.producto_id,
        cantidad: i.cantidad_descontar,
        unidad: i.unidad_usada,
        area_id: i.area_id
      })),
      nota: notas || undefined,
    })
  }

  const batchMutation = useMutation({
    mutationFn: (data: ConsumoBatchRequest) =>
      api.post('/consumos/batch', data, { headers: { 'X-Idempotency-Key': uuidv4() } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stock'] })
      queryClient.invalidateQueries({ queryKey: ['stock-list'] })
      setCart({})
      setNotas('')
      toast.success('Consumo registrado')
    },
    onError: (err: any) => toast.error(parseApiError(err)),
  })

  return (
    <div className="flex flex-col lg:flex-row h-[calc(100vh-120px)] gap-6 p-1">
      <div className="flex-1 flex flex-col min-w-0 gap-6 overflow-hidden">
        <div className="flex items-center gap-3 bg-base-100 p-4 rounded-3xl border border-base-200 shadow-sm">
          <Zap className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-bold">Registro de Consumos</h1>
        </div>

        <div className="flex gap-2">
            <div className="relative flex-1">
                <Search className="absolute left-5 top-1/2 -translate-y-1/2 h-5 w-5 opacity-30" />
                <input 
                    type="text"
                    placeholder="Escribe para buscar..."
                    className="input input-lg w-full pl-14 bg-base-100 border-base-200 rounded-3xl shadow-sm focus:outline-none"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                />
            </div>
            <button className={cn("btn btn-lg btn-circle rounded-3xl", isScannerOpen ? "btn-error" : "btn-primary")} onClick={() => setIsScannerOpen(!isScannerOpen)}>
                {isScannerOpen ? <X /> : <Camera />}
            </button>
        </div>

        <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
          {isScannerOpen ? (
            <div className="flex flex-col items-center justify-center p-4">
                <QrScanner onScan={handleScan} active={isScannerOpen} />
            </div>
          ) : isLoading ? (
            <div className="flex items-center justify-center h-40"><span className="loading loading-spinner loading-lg text-primary opacity-20"></span></div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2 pb-4">
                {stockResponse?.data.map(p => (
                    <button
                        key={`${p.producto_id}-${p.area_id}`}
                        onClick={() => addToCart(p)}
                        className="flex items-center gap-3 px-3 py-2.5 bg-base-100 border border-base-200 rounded-xl hover:border-primary/50 hover:bg-base-200/30 transition-all text-left group"
                    >
                        <ProductoImage src={p.imagen_url} size="sm" className="shrink-0" />
                        <div className="flex-1 min-w-0">
                            <h3 className="font-semibold text-sm leading-tight truncate">{p.producto_nombre}</h3>
                            {p.area_nombre && (
                                <span className="text-[10px] opacity-40 font-medium">{p.area_nombre}</span>
                            )}
                        </div>
                        <div className="text-right shrink-0">
                            <span className="text-xs font-bold tabular-nums">
                                {formatCantidad(p.stock_total || 0, p.unidad, p.unidad_plural ?? undefined)}
                            </span>
                        </div>
                    </button>
                ))}
            </div>
          )}
        </div>
      </div>

      <div className="w-full lg:w-96 bg-base-100 border border-base-200 rounded-[2rem] flex flex-col shadow-xl overflow-hidden">
        <div className="p-6 border-b border-base-200 flex items-center justify-between bg-base-200/20">
          <h2 className="font-bold text-lg">Sesión Actual</h2>
          <button className="btn btn-ghost btn-sm btn-circle opacity-40" onClick={() => setCart({})}>
            <Trash2 className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {Object.values(cart).map(item => (
            <div key={`${item.producto_id}-${item.area_id}`} className="p-3 rounded-2xl bg-base-200/50 border border-transparent">
              <div className="flex justify-between items-start mb-1">
                <div className="min-w-0">
                  <p className="text-sm font-bold truncate">{item.nombre}</p>
                  <span className="text-[9px] font-bold opacity-40 uppercase bg-base-300/50 px-1 rounded">{item.area_nombre}</span>
                </div>
                <button onClick={() => {
                  const key = `${item.producto_id}-${item.area_id}`;
                  setCart(prev => { const { [key]: _, ...rest } = prev; return rest; });
                }} className="text-error"><X className="w-4 h-4" /></button>
              </div>
              <div className="flex items-center justify-between mt-2">
                <div className="flex items-center bg-base-100 rounded-xl border border-base-200 p-1">
                  <button onClick={() => {
                    const key = `${item.producto_id}-${item.area_id}`;
                    setCart(prev => {
                      const it = prev[key];
                      if (it.cantidad_descontar <= 1) { const { [key]: _, ...rest } = prev; return rest; }
                      return { ...prev, [key]: { ...it, cantidad_descontar: it.cantidad_descontar - 1 } };
                    });
                  }} className="btn btn-ghost btn-xs"><Minus className="w-3 h-3" /></button>
                  <span className="w-8 text-center text-sm font-bold">{item.cantidad_descontar}</span>
                  <button onClick={() => {
                    const key = `${item.producto_id}-${item.area_id}`;
                    setCart(prev => ({ ...prev, [key]: { ...prev[key], cantidad_descontar: prev[key].cantidad_descontar + 1 } }));
                  }} className="btn btn-ghost btn-xs"><Plus className="w-3 h-3" /></button>
                </div>
                <span className="text-[10px] font-bold opacity-40 uppercase">
                  {item.cantidad_descontar === 1 ? item.unidad : (item.unidad_plural || item.unidad)}
                </span>
              </div>
            </div>
          ))}
        </div>

        <div className="p-6 bg-base-200/40 border-t border-base-200 space-y-4">
          <textarea 
            className="textarea textarea-bordered w-full rounded-2xl bg-base-100 text-sm h-20"
            placeholder="Notas..."
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
          />
          <button className="btn btn-primary btn-block h-14 rounded-2xl" disabled={Object.keys(cart).length === 0 || batchMutation.isPending} onClick={handleConfirm}>
            {batchMutation.isPending ? <span className="loading loading-spinner"></span> : <><Send className="h-5 w-5" /> Confirmar</>}
          </button>
        </div>
      </div>
    </div>
  )
}
