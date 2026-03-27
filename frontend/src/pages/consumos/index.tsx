import { useState, useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { v4 as uuidv4 } from 'uuid'
import { 
  Search, Plus, Minus, Trash2, Send, 
  Zap, AlertTriangle, ShoppingCart, 
  Package, LayoutGrid, CheckCircle2
} from 'lucide-react'
import { useAreaStore } from '@/hooks/use-area-store'
import api from '@/lib/api'
import type { Area, ConsumoBatchRequest } from '@/types'
import { toast } from 'sonner'
import { cn, formatCantidad } from '@/lib/utils'

// Tipos locales basados en la respuesta de /stock/area/{id}
interface StockProduct {
  producto_id: number | string
  codigo_interno: string
  nombre: string
  unidad: string
  unidad_plural: string
  stock_minimo: number | null
  stock: number
  lotes: any[]
}

interface CartItem extends StockProduct {
  cantidad_descontar: number
}

export default function ConsumosPage() {
  const globalAreaId = useAreaStore((s) => s.selectedAreaId)
  const [areaId, setAreaId] = useState<number | null>(globalAreaId)
  const [searchQuery, setSearchQuery] = useState('')
  const [cart, setCart] = useState<Record<string | number, CartItem>>({})
  const [notas, setNotas] = useState('')
  
  const queryClient = useQueryClient()

  // --- Datos ---
  const { data: areas } = useQuery({
    queryKey: ['areas'],
    queryFn: () => api.get<Area[]>('/areas').then((r) => r.data),
  })

  // Usamos el endpoint de stock por área para tener las cantidades reales en esa área
  const { data: stockData, isLoading: isLoadingStock } = useQuery({
    queryKey: ['stock-area', areaId],
    queryFn: () => api.get<{ productos: StockProduct[] }>(`/stock/area/${areaId}`).then((r) => r.data),
    enabled: !!areaId,
  })

  const productos = stockData?.productos || []

  // --- Lógica de Carrito ---
  const addToCart = (producto: StockProduct) => {
    setCart(prev => {
      const id = producto.producto_id
      const existing = prev[id]
      return {
        ...prev,
        [id]: {
          ...producto,
          cantidad_descontar: (existing?.cantidad_descontar || 0) + 1
        }
      }
    })
    toast.success(`${producto.nombre} añadido`, { duration: 1000 })
  }

  const updateQuantity = (id: string | number, delta: number) => {
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

  const removeFromCart = (id: string | number) => {
    setCart(prev => {
      const { [id]: _, ...rest } = prev
      return rest
    })
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
    onError: () => toast.error('Error al registrar el consumo'),
  })

  const handleConfirm = () => {
    if (!areaId || Object.keys(cart).length === 0) return
    batchMutation.mutate({
      area_id: areaId,
      items: Object.values(cart).map(i => ({ 
        producto_id: i.producto_id, 
        cantidad: i.cantidad_descontar,
        unidad: 'base'
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
            className="select select-bordered select-sm rounded-xl focus:ring-2 ring-primary/20"
            value={areaId ?? ''}
            onChange={(e) => setAreaId(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Seleccionar Área...</option>
            {areas?.map(a => <option key={a.id} value={a.id}>{a.nombre}</option>)}
          </select>
        </div>

        {/* Omnibar de Búsqueda */}
        <div className="relative group">
          <Search className="absolute left-5 top-1/2 -translate-y-1/2 h-5 w-5 opacity-30 group-focus-within:opacity-100 group-focus-within:text-primary transition-all" />
          <input 
            type="text"
            placeholder="Buscar por nombre, código o escaneo..."
            className="input input-lg w-full pl-14 bg-base-100 border-base-200 rounded-3xl shadow-sm focus:outline-none focus:ring-4 ring-primary/5 transition-all text-base"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          <kbd className="absolute right-5 top-1/2 -translate-y-1/2 kbd kbd-sm bg-base-200/50 border-none opacity-50">ESC</kbd>
        </div>

        {/* Resultados / Frecuentes */}
        <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
          {!areaId ? (
            <div className="h-full flex flex-col items-center justify-center opacity-30 text-center">
              <LayoutGrid className="h-16 w-16 mb-4" />
              <p className="font-medium">Selecciona un área para comenzar</p>
            </div>
          ) : isLoadingStock ? (
            <div className="flex items-center justify-center h-40">
              <span className="loading loading-spinner loading-lg text-primary opacity-20"></span>
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="py-20 text-center opacity-30">
              <p>No se encontraron productos con stock en esta área.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 pb-4">
              {filteredProducts.map(p => (
                <button
                  key={p.producto_id}
                  onClick={() => addToCart(p)}
                  className="group flex flex-col p-4 bg-base-100 border border-base-200 rounded-3xl hover:border-primary/50 hover:shadow-md transition-all text-left relative overflow-hidden active:scale-[0.98]"
                >
                  <div className="flex justify-between items-start mb-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider opacity-40">#{p.codigo_interno}</span>
                    {p.stock <= (p.stock_minimo || 0) && (
                      <div className="badge badge-error badge-xs p-1.5 animate-pulse"></div>
                    )}
                  </div>
                  <h3 className="font-bold text-base leading-tight mb-1 group-hover:text-primary transition-colors">{p.nombre}</h3>
                  <div className="flex items-center gap-2 mt-auto">
                    <span className={cn(
                      "text-xs font-medium px-2 py-0.5 rounded-lg",
                      p.stock <= (p.stock_minimo || 0) ? "bg-error/10 text-error" : "bg-base-200"
                    )}>
                      {formatCantidad(p.stock, p.unidad, p.unidad_plural)}
                    </span>
                  </div>
                  <div className="absolute bottom-0 right-0 p-3 translate-y-2 translate-x-2 opacity-0 group-hover:translate-y-0 group-hover:translate-x-0 group-hover:opacity-100 transition-all">
                    <div className="bg-primary text-primary-content p-1.5 rounded-xl shadow-lg">
                      <Plus className="h-4 w-4" />
                    </div>
                  </div>
                </button>
              ))}
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
              const isCritical = (item.stock - item.cantidad_descontar) <= (item.stock_minimo || 0);
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
                    <span className="text-[10px] font-bold opacity-40 uppercase tracking-tighter">
                      {item.cantidad_descontar === 1 ? item.unidad : item.unidad_plural}
                    </span>
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
                Confirmar Despacho
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
