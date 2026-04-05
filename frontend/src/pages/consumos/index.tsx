import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { v4 as uuidv4 } from 'uuid'
import {
  Search, Plus, Minus,
  Zap,
  Camera, X, Check, Package
} from 'lucide-react'
import { ProductoImage } from '@/components/ui/producto-image'
import api from '@/lib/api'
import { parseApiError } from '@/lib/api-error'
import type { ConsumoBatchRequest, StockItem, PaginatedResponse } from '@/types'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { QrScanner } from '@/components/shared/qr-scanner'

interface LoteDisponible {
  lote_id: string
  numero_lote: string
  stock: number
  fecha_vencimiento: string
  area_id: number
  area_nombre: string
}

interface CartItem {
  producto_id: string
  nombre: string
  unidad: string
  unidad_plural: string
  stock_total: number
  area_id: number
  area_nombre: string
  imagen_url?: string | null
  codigo_interno: string
  categoria: string | null
  lotes: LoteDisponible[]
  lote_elegido_id: string | null  // null = FEFO automático
  cantidad_descontar: number
}

export default function ConsumosPage() {
  const [searchQuery, setSearchQuery] = useState('')
  const [cart, setCart] = useState<Record<string, CartItem>>({})
  const [notas, setNotas] = useState('')
  const [isScannerOpen, setIsScannerOpen] = useState(false)
  const [areaFiltro, setAreaFiltro] = useState<number | null>(null)

  const { data: areasData } = useQuery({
    queryKey: ['areas'],
    queryFn: () => api.get<{ id: number; nombre: string; activa: boolean }[]>('/areas').then(r => r.data),
    staleTime: 300_000,
  })
  const areas = areasData?.filter(a => a.activa) ?? []

  const queryClient = useQueryClient()

  const { data: stockResponse, isLoading } = useQuery({
    queryKey: ['stock-list', searchQuery, areaFiltro],
    queryFn: () => api.get<PaginatedResponse<StockItem>>('/stock', {
      params: {
        ...(searchQuery.length >= 2 && { q: searchQuery }),
        ...(areaFiltro && { area_id: areaFiltro }),
        per_page: 100,
        con_lotes: true,
      }
    }).then(r => r.data),
  })

  const addToCart = (p: StockItem) => {
    if ((p.stock_total || 0) <= 0) {
      toast.error('No hay stock disponible')
      return
    }
    const cartKey = p.producto_id
    setCart(prev => {
      if (prev[cartKey]) {
        return { ...prev, [cartKey]: { ...prev[cartKey], cantidad_descontar: prev[cartKey].cantidad_descontar + 1 } }
      }
      return {
        ...prev,
        [cartKey]: {
          producto_id: p.producto_id,
          nombre: p.producto_nombre,
          codigo_interno: p.codigo_interno,
          unidad: p.unidad,
          unidad_plural: p.unidad_plural || p.unidad,
          stock_total: p.stock_total || 0,
          area_id: p.area_id ?? areaFiltro ?? 0,
          area_nombre: p.area_nombre || '',
          imagen_url: p.imagen_url,
          categoria: (p as any).categoria || null,
          lotes: [],
          lote_elegido_id: null,
          cantidad_descontar: 1,
        }
      }
    })
    toast.success(`${p.producto_nombre} añadido`)

    // Fetch lotes for this product to populate the lot selector
    api.get<{ id: string; numero_lote: string; stock_total: string | null; fecha_vencimiento: string }[]>('/lotes', {
      params: {
        producto_id: p.producto_id,
        con_stock: true,
        vencido: false,
        ...(areaFiltro && { area_id: areaFiltro }),
      }
    }).then(res => {
      const lotes: LoteDisponible[] = res.data.map(l => ({
        lote_id: l.id,
        numero_lote: l.numero_lote,
        stock: parseFloat(l.stock_total ?? '0'),
        fecha_vencimiento: l.fecha_vencimiento,
        area_id: areaFiltro ?? p.area_id ?? 0,
        area_nombre: p.area_nombre || '',
      }))
      setCart(prev => {
        if (!prev[cartKey]) return prev
        return { ...prev, [cartKey]: { ...prev[cartKey], lotes } }
      })
    }).catch(() => {}) // lote list is optional; FEFO still works without it
  }

  const handleScan = async (code: string) => {
    try {
      const stockRes = await api.get<PaginatedResponse<StockItem>>('/stock', {
        params: { q: code, ...(areaFiltro && { area_id: areaFiltro }) }
      })
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
    const cartItems = Object.values(cart)
    if (cartItems.length === 0) return

    batchMutation.mutate({
      items: cartItems.map(i => ({
        producto_id: i.producto_id,
        cantidad: i.cantidad_descontar,
        unidad: 'base',
        area_id: i.area_id || undefined,
        ...(i.lote_elegido_id && { lote_id: i.lote_elegido_id }),
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
    <div className="flex h-[calc(100vh-120px)] gap-4 p-1 overflow-hidden">
      {/* COLUMNA IZQUIERDA — búsqueda + lista */}
      <div className="flex-1 flex flex-col gap-3 min-w-0 overflow-hidden">
        {/* Buscador + filtro área */}
        <div className="flex gap-2 items-center bg-base-100 p-3 rounded-2xl border border-base-200 shadow-sm">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 opacity-30" />
            <input
              className="input input-bordered w-full pl-9 h-10 rounded-xl text-sm"
              placeholder="Buscar producto (mín. 2 letras)..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>
          <select
            className="select select-bordered h-10 rounded-xl text-sm min-w-[140px]"
            value={areaFiltro ?? ''}
            onChange={e => setAreaFiltro(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Todas las áreas</option>
            {areas.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
          </select>
          <button
            className="btn btn-outline btn-sm h-10 rounded-xl gap-1"
            onClick={() => setIsScannerOpen(true)}
          >
            <Camera className="h-4 w-4" /> QR
          </button>
        </div>

        {/* Hint si búsqueda corta */}
        {searchQuery.length === 1 && (
          <p className="text-xs text-base-content/40 px-2">Escribe al menos 2 letras para buscar</p>
        )}

        {/* Lista de productos */}
        <div className="flex-1 overflow-y-auto space-y-2 pr-1">
          {isLoading ? (
            Array(6).fill(0).map((_, i) => <div key={i} className="h-20 bg-base-200 rounded-2xl animate-pulse" />)
          ) : (stockResponse?.data ?? []).length === 0 ? (
            <div className="py-16 text-center opacity-30">
              <Package className="h-10 w-10 mx-auto mb-2" />
              <p className="text-sm">{searchQuery.length >= 2 ? 'Sin resultados' : 'Busca o desplázate para ver productos'}</p>
            </div>
          ) : (
            (stockResponse?.data ?? []).map(p => {
              const enCarrito = !!cart[p.producto_id]
              const sinStock = (p.stock_total || 0) <= 0
              return (
                <div
                  key={p.producto_id}
                  className={cn(
                    "flex items-center gap-3 p-3 rounded-2xl border transition-all",
                    enCarrito ? "bg-primary/5 border-primary/30" : "bg-base-100 border-base-200 hover:border-primary/30",
                    sinStock && "opacity-40"
                  )}
                >
                  <ProductoImage src={p.imagen_url} size="sm" className="w-10 h-10 rounded-xl flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm truncate">{p.producto_nombre}</p>
                    <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                      {p.area_nombre && <span className="badge badge-xs bg-blue-100 text-blue-700 border-none">{p.area_nombre}</span>}
                      {p.categoria && <span className="badge badge-xs bg-green-100 text-green-700 border-none">{p.categoria}</span>}
                      <span className="text-xs text-base-content/50">{p.stock_total || 0} {p.unidad}</span>
                    </div>
                  </div>
                  <button
                    className={cn("btn btn-sm btn-circle rounded-xl", enCarrito ? "btn-primary" : "btn-outline")}
                    disabled={sinStock}
                    onClick={() => addToCart(p)}
                  >
                    {enCarrito ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                  </button>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* COLUMNA DERECHA — carrito */}
      <div className="w-80 flex-shrink-0 flex flex-col bg-base-100 rounded-2xl border border-base-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-base-200 flex items-center gap-2">
          <Zap className="h-4 w-4 text-primary" />
          <span className="font-bold text-sm">Carrito</span>
          <span className="badge badge-sm badge-primary ml-auto">{Object.keys(cart).length}</span>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {Object.keys(cart).length === 0 ? (
            <div className="py-12 text-center opacity-30 text-sm">Agrega productos desde la lista</div>
          ) : (
            Object.values(cart).map(item => (
              <div key={item.producto_id} className="bg-base-200/40 rounded-xl p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold text-xs leading-tight line-clamp-2">{item.nombre}</p>
                  <button
                    className="btn btn-ghost btn-xs btn-circle text-error"
                    onClick={() => setCart(prev => { const n = {...prev}; delete n[item.producto_id]; return n })}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>

                {/* Selector de lote — solo si hay múltiples */}
                {item.lotes.length > 1 && (
                  <div className="space-y-1">
                    <p className="text-[10px] font-bold uppercase opacity-50">Lote</p>
                    {item.lotes.slice(0, 3).map((l, idx) => (
                      <label key={l.lote_id} className={cn(
                        "flex items-center gap-2 p-1.5 rounded-lg cursor-pointer text-xs",
                        item.lote_elegido_id === l.lote_id ? "bg-primary/10" :
                        item.lote_elegido_id === null && idx === 0 ? "bg-success/10" : "bg-base-100"
                      )}>
                        <input
                          type="radio"
                          className="radio radio-xs radio-primary"
                          checked={item.lote_elegido_id === l.lote_id || (item.lote_elegido_id === null && idx === 0)}
                          onChange={() => setCart(prev => ({
                            ...prev,
                            [item.producto_id]: { ...prev[item.producto_id], lote_elegido_id: idx === 0 ? null : l.lote_id }
                          }))}
                        />
                        <div className="flex-1 min-w-0">
                          <span className="font-mono">{l.numero_lote}</span>
                          {idx === 0 && <span className="ml-1 text-[9px] bg-success text-white rounded px-1">FEFO</span>}
                          <span className="block text-[10px] opacity-50">{l.stock} disp · vence {l.fecha_vencimiento?.slice(0,10)}</span>
                        </div>
                      </label>
                    ))}
                  </div>
                )}
                {item.lotes.length === 1 && (
                  <p className="text-[10px] opacity-50">Lote FEFO: {item.lotes[0]?.numero_lote}</p>
                )}

                {/* Cantidad */}
                <div className="flex items-center gap-2">
                  <button className="btn btn-ghost btn-xs btn-circle"
                    onClick={() => setCart(prev => ({
                      ...prev,
                      [item.producto_id]: { ...prev[item.producto_id], cantidad_descontar: Math.max(1, item.cantidad_descontar - 1) }
                    }))}>
                    <Minus className="h-3 w-3" />
                  </button>
                  <input
                    type="number"
                    className="input input-bordered input-xs w-14 text-center font-bold"
                    value={item.cantidad_descontar}
                    onChange={e => setCart(prev => ({
                      ...prev,
                      [item.producto_id]: { ...prev[item.producto_id], cantidad_descontar: Math.max(1, parseInt(e.target.value) || 1) }
                    }))}
                  />
                  <button className="btn btn-ghost btn-xs btn-circle"
                    onClick={() => setCart(prev => ({
                      ...prev,
                      [item.producto_id]: { ...prev[item.producto_id], cantidad_descontar: item.cantidad_descontar + 1 }
                    }))}>
                    <Plus className="h-3 w-3" />
                  </button>
                  <span className="text-xs opacity-50">{item.unidad}</span>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Nota + Confirmar */}
        <div className="p-3 border-t border-base-200 space-y-2">
          <input
            className="input input-bordered input-sm w-full rounded-xl text-sm"
            placeholder="Nota (opcional)..."
            value={notas}
            onChange={e => setNotas(e.target.value)}
          />
          <button
            className="btn btn-primary w-full rounded-xl gap-2"
            disabled={Object.keys(cart).length === 0 || batchMutation.isPending}
            onClick={handleConfirm}
          >
            {batchMutation.isPending
              ? <span className="loading loading-spinner loading-sm" />
              : <><Zap className="h-4 w-4" /> Registrar consumo</>
            }
          </button>
        </div>
      </div>

      {/* Scanner QR */}
      {isScannerOpen && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setIsScannerOpen(false)}>
          <div className="relative" onClick={e => e.stopPropagation()}>
            <button
              className="absolute -top-3 -right-3 z-10 btn btn-circle btn-sm btn-error"
              onClick={() => setIsScannerOpen(false)}
            >
              <X className="h-4 w-4" />
            </button>
            <QrScanner onScan={handleScan} active={isScannerOpen} />
          </div>
        </div>
      )}
    </div>
  )
}
