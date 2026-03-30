import { useState, useMemo, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { v4 as uuidv4 } from 'uuid'
import { 
  Search, Plus, Minus, Trash2, Send,
  Zap, AlertTriangle, ShoppingCart,
  Package, CheckCircle2,
  Clock, Camera, X, MapPin
} from 'lucide-react'
import { useAreaStore } from '@/hooks/use-area-store'
import api from '@/lib/api'
import type { Area, ConsumoBatchRequest, StockItem, PaginatedResponse } from '@/types'
import { toast } from 'sonner'
import { cn, formatCantidad, daysUntil } from '@/lib/utils'
import { QrScanner } from '@/components/shared/qr-scanner'

// Tipos locales basados en la respuesta de /stock/area/{id}
interface StockProduct {
  producto_id: string
  codigo_interno: string
  nombre: string
  unidad: string
  unidad_plural: string
  stock_minimo: number | null
  stock: number
  area_id?: number // Para cuando viene de búsqueda global
  area_nombre?: string // Para cuando viene de búsqueda global
  presentaciones?: {
    id: number
    nombre: string
    nombre_plural: string
    factor_conversion: number
  }[]
  lotes: {
    lote_id: string
    numero_lote: string
    stock: number
    fecha_vencimiento: string
  }[]
}

interface CartItem extends StockProduct {
  cantidad_descontar: number
  unidad_usada: 'base' | 'presentacion'
  presentacion_id_usada?: number
  factor_usado: number
  nombre_unidad_usada: string
}

export default function ConsumosPage() {
  const [searchParams] = useSearchParams()
  const globalAreaId = useAreaStore((s) => s.selectedAreaId)
  const [areaId, setAreaId] = useState<number | null>(globalAreaId)
  const [searchQuery, setSearchQuery] = useState(searchParams.get('search') || '')
  const [cart, setCart] = useState<Record<string, CartItem>>({})
  const [notas, setNotas] = useState('')
  const [isScannerOpen, setIsScannerOpen] = useState(false)
  
  const queryClient = useQueryClient()

  // Sync search query if URL changes
  useEffect(() => {
    const q = searchParams.get('search')
    if (q) setSearchQuery(q)
  }, [searchParams])

  // --- Datos ---
  const { data: areas } = useQuery({
    queryKey: ['areas'],
    queryFn: () => api.get<Area[]>('/areas').then((r) => r.data),
  })

  // Búsqueda Global (cuando NO hay área seleccionada)
  const { data: globalStock, isLoading: isLoadingGlobal } = useQuery({
    queryKey: ['stock-global-search', searchQuery],
    queryFn: () => api.get<PaginatedResponse<StockItem>>('/stock', {
      params: { ...(searchQuery.length > 0 && { q: searchQuery }), per_page: 100 }
    }).then(r => r.data),
    enabled: !areaId
  })

  // Stock por Área (cuando SÍ hay área seleccionada)
  const { data: stockData, isLoading: isLoadingStock } = useQuery({
    queryKey: ['stock-area', areaId],
    queryFn: () => api.get<{ productos: StockProduct[] }>(`/stock/area/${areaId}`).then((r) => r.data),
    enabled: !!areaId,
  })

  const productos = stockData?.productos || []

  // --- Lógica de Carrito ---
  const addToCart = (producto: StockProduct, presentationId?: number) => {
    setCart(prev => {
      const id = producto.producto_id
      const existing = prev[id]
      
      const pres = presentationId 
        ? producto.presentaciones?.find(p => p.id === presentationId)
        : null

      return {
        ...prev,
        [id]: {
          ...producto,
          cantidad_descontar: (existing?.cantidad_descontar || 0) + 1,
          unidad_usada: pres ? 'presentacion' : 'base',
          presentacion_id_usada: pres?.id,
          factor_usado: pres?.factor_conversion || 1,
          nombre_unidad_usada: pres ? pres.nombre : producto.unidad
        }
      }
    })
    toast.success(`${producto.nombre} añadido`, { duration: 1000 })
  }

  // --- Selección desde búsqueda global ---
  const handleSelectGlobalProduct = (p: StockItem) => {
    // Construir un StockProduct compatible desde StockItem
    const stockProduct: StockProduct = {
      producto_id: p.producto_id,
      codigo_interno: p.codigo_interno,
      nombre: p.producto_nombre,
      unidad: p.unidad,
      unidad_plural: p.unidad_plural || p.unidad,
      stock_minimo: p.stock_minimo,
      stock: p.stock_total || 0,
      presentaciones: [],
      lotes: []
    }
    addToCart(stockProduct)
  }

  const updateQuantity = (id: string, delta: number) => {
    setCart(prev => {
      const item = prev[id]
      if (!item) return prev
      const newQty = Math.max(0, item.cantidad_descontar + delta)
      if (newQty === 0) {
        const { [id]: _, ...rest } = prev
        return rest
      }
      return { ...prev, [id]: { ...item, cantidad_descontar: newQty } }
    })
  }

  const changeUnidad = (id: string, presId?: number) => {
    setCart(prev => {
      const item = prev[id]
      if (!item) return prev
      
      const pres = presId 
        ? item.presentaciones?.find(p => p.id === presId)
        : null

      return {
        ...prev,
        [id]: {
          ...item,
          unidad_usada: pres ? 'presentacion' : 'base',
          presentacion_id_usada: pres?.id,
          factor_usado: pres?.factor_conversion || 1,
          nombre_unidad_usada: pres ? pres.nombre : item.unidad
        }
      }
    })
  }

  const removeFromCart = (id: string) => {
    setCart(prev => {
      const { [id]: _, ...rest } = prev
      return rest
    })
  }

  // --- Escaneo ---
  const handleScan = async (code: string) => {
    try {
      const res = await api.get('/productos/scan', { params: { codigo: code } })
      if (res.data.encontrado) {
        const pId = res.data.producto_id
        if (!areaId) {
            // Si escanea sin área, buscamos dónde está ese producto
            const stockRes = await api.get(`/stock?q=${code}`)
            if (stockRes.data.data.length > 0) {
                handleSelectGlobalProduct(stockRes.data.data[0])
            }
            return
        }
        const foundInStock = productos.find(p => p.producto_id === pId)
        if (foundInStock) {
          addToCart(foundInStock, res.data.presentacion_id)
          setIsScannerOpen(false)
        } else {
          toast.error('Producto encontrado pero no tiene stock en esta área')
        }
      } else {
        toast.error('Código no reconocido')
      }
    } catch (err) {
      toast.error('Error al escanear')
    }
  }

  // --- Mutación ---
  const batchMutation = useMutation({
    mutationFn: (data: ConsumoBatchRequest) =>
      api.post('/consumos/batch', data, { headers: { 'X-Idempotency-Key': uuidv4() } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stock'] })
      queryClient.invalidateQueries({ queryKey: ['stock-area'] })
      queryClient.invalidateQueries({ queryKey: ['alertas'] })
      setCart({})
      setNotas('')
      toast.success('Consumo registrado correctamente', {
        icon: <CheckCircle2 className="text-success" />
      })
    },
    onError: (err: any) => {
        const msg = err.response?.data?.error?.message || 'Error al registrar el consumo'
        toast.error(msg)
    },
  })

  const handleConfirm = () => {
    if (Object.keys(cart).length === 0) return
    batchMutation.mutate({
      ...(areaId && { area_id: areaId }),
      items: Object.values(cart).map(i => ({
        producto_id: i.producto_id,
        cantidad: i.cantidad_descontar,
        unidad: i.unidad_usada,
        presentacion_id: i.presentacion_id_usada
      })),
      nota: notas || undefined,
    })
  }

  // --- Filtros ---
  const filteredProducts = useMemo(() => {
    if (!productos) return []
    return productos.filter(p => 
      p.nombre.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.codigo_interno?.toLowerCase().includes(searchQuery.toLowerCase())
    )
  }, [productos, searchQuery])

  const cartItems = Object.values(cart)
  const isCartEmpty = cartItems.length === 0

  return (
    <div className="flex flex-col lg:flex-row h-[calc(100vh-120px)] gap-6 p-1">
      
      {/* PANEL IZQUIERDO: Acción y Búsqueda */}
      <div className="flex-1 flex flex-col min-w-0 gap-6 overflow-hidden">
        
        {/* Header con Selector de Área */}
        <div className="flex items-center justify-between bg-base-100 p-4 rounded-3xl border border-base-200 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-2xl">
              <Zap className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold">Registro de Consumos</h1>
              <p className="text-xs opacity-50">Despacho rápido de insumos</p>
            </div>
          </div>
          
          <select
            className="select select-bordered select-sm rounded-xl focus:ring-2 ring-primary/20 transition-all"
            value={areaId ?? ''}
            onChange={(e) => setAreaId(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Todas las áreas</option>
            {areas?.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
          </select>
        </div>

        {/* Omnibar de Búsqueda */}
        <div className="flex gap-2">
            <div className="relative group flex-1">
                <Search className="absolute left-5 top-1/2 -translate-y-1/2 h-5 w-5 opacity-30 group-focus-within:opacity-100 group-focus-within:text-primary transition-all" />
                <input 
                    type="text"
                    placeholder="Buscar por nombre o código en todo el inventario..."
                    className="input input-lg w-full pl-14 bg-base-100 border-base-200 rounded-3xl shadow-sm focus:outline-none focus:ring-4 ring-primary/5 transition-all text-base"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                />
            </div>
            <button 
                className={cn(
                    "btn btn-lg btn-circle rounded-3xl transition-all shadow-md",
                    isScannerOpen ? "btn-error" : "btn-primary"
                )}
                onClick={() => setIsScannerOpen(!isScannerOpen)}
                title="Escanear Código de Barras"
            >
                {isScannerOpen ? <X className="h-6 w-6" /> : <Camera className="h-6 w-6" />}
            </button>
        </div>

        {/* Scanner Overlay / Resultados */}
        <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
          {isScannerOpen ? (
            <div className="flex flex-col items-center justify-center p-4">
                <QrScanner onScan={handleScan} active={isScannerOpen} className="mb-4" />
                <p className="text-sm font-bold opacity-40 uppercase tracking-widest">Escaneando...</p>
            </div>
          ) : isLoadingStock || isLoadingGlobal ? (
            <div className="flex items-center justify-center h-40">
              <span className="loading loading-spinner loading-lg text-primary opacity-20"></span>
            </div>
          ) : !areaId ? (
            /* Resultados de Búsqueda Global */
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-4">
                {globalStock?.data.map(p => (
                    <button
                        key={p.producto_id}
                        onClick={() => handleSelectGlobalProduct(p)}
                        className="flex items-center gap-4 p-4 bg-base-100 border border-base-200 rounded-3xl hover:border-primary/50 transition-all text-left group"
                    >
                        <div className="p-3 bg-base-200 rounded-2xl group-hover:bg-primary/10 transition-colors">
                            <Package className="h-6 w-6 opacity-40 group-hover:text-primary group-hover:opacity-100" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <h3 className="font-bold text-sm truncate">{p.producto_nombre}</h3>
                            <div className="flex items-center gap-2 text-[10px] font-bold opacity-50 uppercase mt-1">
                                <MapPin className="h-3 w-3" />
                                <span>Click para localizar stock</span>
                            </div>
                        </div>
                        <div className="text-right">
                            <span className="text-xs font-bold block">{Math.round(p.stock_total || 0)}</span>
                            <span className="text-[10px] opacity-40 uppercase">{p.unidad}</span>
                        </div>
                    </button>
                ))}
                {globalStock?.data.length === 0 && (
                    <div className="col-span-full py-20 text-center opacity-30">
                        <p>No se encontró ningún producto con ese nombre.</p>
                    </div>
                )}
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="py-20 text-center opacity-30">
              <p>No se encontraron productos con stock en esta área.</p>
            </div>
          ) : (
            /* Resultados por Área (Vista Normal) */
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 pb-4">
              {filteredProducts.map(p => {
                const proximoVencimiento = p.lotes?.[0]?.fecha_vencimiento
                const days = proximoVencimiento ? daysUntil(proximoVencimiento) : null
                const isExpiringSoon = days !== null && days <= 90

                return (
                  <button
                    key={p.producto_id}
                    onClick={() => addToCart(p)}
                    className={cn(
                      "group flex flex-col p-4 bg-base-100 border rounded-3xl transition-all text-left relative overflow-hidden active:scale-[0.98]",
                      isExpiringSoon ? "border-warning/40 shadow-sm" : "border-base-200 hover:border-primary/50 hover:shadow-md"
                    )}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <span className="text-[10px] font-bold uppercase tracking-wider opacity-40">#{p.codigo_interno}</span>
                      <div className="flex gap-1">
                        {isExpiringSoon && (
                          <div className="badge badge-warning badge-xs gap-1 py-2 px-1.5 font-bold animate-pulse">
                            <Clock className="w-2.5 h-2.5" />
                            FEFO
                          </div>
                        )}
                        {p.stock <= (p.stock_minimo || 0) && (
                          <div className="badge badge-error badge-xs p-1.5 animate-pulse"></div>
                        )}
                      </div>
                    </div>
                    <h3 className="font-bold text-base leading-tight mb-1 group-hover:text-primary transition-colors">{p.nombre}</h3>
                    <div className="flex items-center gap-2 mt-auto">
                      <span className={cn(
                        "text-xs font-medium px-2 py-0.5 rounded-lg",
                        p.stock <= (p.stock_minimo || 0) ? "bg-error/10 text-error" : "bg-base-200"
                      )}>
                        {formatCantidad(p.stock, p.unidad, p.unidad_plural)}
                      </span>
                      {isExpiringSoon && (
                        <span className="text-[10px] font-bold text-warning uppercase">Vence en {days}d</span>
                      )}
                    </div>
                    <div className="absolute bottom-0 right-0 p-3 translate-y-2 translate-x-2 opacity-0 group-hover:translate-y-0 group-hover:translate-x-0 group-hover:opacity-100 transition-all">
                      <div className="bg-primary text-primary-content p-1.5 rounded-xl shadow-lg">
                        <Plus className="h-4 w-4" />
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* PANEL DERECHO: Sesión / Carrito */}
      <div className={cn(
        "w-full lg:w-96 bg-base-100 border border-base-200 rounded-[2rem] flex flex-col shadow-xl overflow-hidden transition-all",
        isCartEmpty ? "opacity-60 grayscale-[0.5]" : "opacity-100"
      )}>
        <div className="p-6 border-b border-base-200 flex items-center justify-between bg-base-200/20">
          <div className="flex items-center gap-3">
            <div className="relative">
              <ShoppingCart className="h-6 w-6 opacity-80" />
              {cartItems.length > 0 && (
                <span className="absolute -top-2 -right-2 badge badge-primary badge-sm font-bold border-2 border-base-100">
                  {cartItems.length}
                </span>
              )}
            </div>
            <h2 className="font-bold text-lg">Sesión Actual</h2>
          </div>
          <button 
            className="btn btn-ghost btn-sm btn-circle opacity-40 hover:opacity-100"
            onClick={() => setCart({})}
            disabled={isCartEmpty}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
          {isCartEmpty ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-8 opacity-40">
              <Package className="h-12 w-12 mb-3 stroke-[1.5px]" />
              <p className="text-sm font-medium">El carrito está vacío.<br/>Agrega productos de la lista.</p>
            </div>
          ) : (
            cartItems.map(item => {
              const totalDescuentoBase = item.cantidad_descontar * item.factor_usado;
              const isCritical = (item.stock - totalDescuentoBase) <= (item.stock_minimo || 0);
              
              return (
                <div 
                  key={item.producto_id} 
                  className={cn(
                    "group p-3 rounded-2xl border transition-all duration-300",
                    isCritical 
                      ? "bg-warning/5 border-warning/30" 
                      : "bg-base-200/50 border-transparent hover:border-base-300"
                  )}
                >
                  <div className="flex justify-between items-start gap-2 mb-2">
                    <span className="text-sm font-bold line-clamp-2 leading-tight">{item.nombre}</span>
                    <button 
                      onClick={() => removeFromCart(item.producto_id)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity text-error p-1"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <div className="flex items-center bg-base-100 rounded-xl border border-base-200 p-1">
                      <button 
                        onClick={() => updateQuantity(item.producto_id, -1)}
                        className="btn btn-ghost btn-xs btn-square"
                      >
                        <Minus className="h-3 w-3" />
                      </button>
                      <input 
                        type="number" 
                        className="w-12 text-center text-sm font-bold bg-transparent focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        value={item.cantidad_descontar}
                        onChange={(e) => {
                          const val = parseInt(e.target.value) || 0
                          setCart(prev => ({ ...prev, [item.producto_id]: { ...item, cantidad_descontar: Math.max(0, val) } }))
                        }}
                      />
                      <button 
                        onClick={() => updateQuantity(item.producto_id, 1)}
                        className="btn btn-ghost btn-xs btn-square"
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                    </div>

                    {/* Selector de Unidad/Presentación */}
                    {item.presentaciones && item.presentaciones.length > 0 ? (
                        <select 
                            className="select select-ghost select-xs text-[10px] font-bold uppercase tracking-tighter"
                            value={item.presentacion_id_usada || ''}
                            onChange={(e) => changeUnidad(item.producto_id, e.target.value ? Number(e.target.value) : undefined)}
                        >
                            <option value="">{item.unidad}</option>
                            {item.presentaciones.map(p => (
                                <option key={p.id} value={p.id}>{p.nombre} (x{p.factor_conversion})</option>
                            ))}
                        </select>
                    ) : (
                        <span className="text-[10px] font-bold opacity-40 uppercase tracking-tighter">
                            {item.cantidad_descontar === 1 ? item.unidad : item.unidad_plural}
                        </span>
                    )}
                  </div>

                  {isCritical && (
                    <div className="mt-2 flex items-center gap-1.5 text-[10px] font-bold text-warning-content bg-warning/20 p-1.5 rounded-lg">
                      <AlertTriangle className="h-3 w-3" />
                      <span>STOCK CRÍTICO TRAS ACCIÓN</span>
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>

        {/* Footer del Carrito */}
        <div className="p-6 bg-base-200/40 border-t border-base-200 space-y-4">
          <div className="space-y-2">
            <label className="text-[10px] font-bold uppercase tracking-widest opacity-40 ml-1">Notas de Sesión</label>
            <textarea 
              className="textarea textarea-bordered w-full rounded-2xl bg-base-100 border-base-200 focus:ring-2 ring-primary/10 transition-all resize-none text-sm h-20"
              placeholder="Ej: Muestras para control de calidad..."
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
            />
          </div>
          
          <button 
            className="btn btn-primary btn-block h-14 rounded-2xl shadow-lg shadow-primary/20 gap-3 text-base"
            disabled={isCartEmpty || batchMutation.isPending}
            onClick={handleConfirm}
          >
            {batchMutation.isPending ? (
              <span className="loading loading-spinner loading-md"></span>
            ) : (
              <>
                <Send className="h-5 w-5" />
                Confirmar Consumo
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}