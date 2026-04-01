import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { 
  Zap, Package, ClipboardCheck, 
  ArrowLeft, ShoppingCart, 
  Trash2, CheckCircle2,
  ChevronUp, ChevronDown, PackageCheck,
  AlertCircle
} from 'lucide-react'
import { v4 as uuidv4 } from 'uuid'
import { toast } from 'sonner'

import api from '@/lib/api'
import { useAreaStore } from '@/hooks/use-area-store'
import { QrScanner } from '@/components/shared/qr-scanner'
import { cn } from '@/lib/utils'
import type { Area, ConsumoBatchRequest } from '@/types'

// ─── Tipos ─────────────────────────────────────────────────────────────────

type FlowState = 'SELECT_AREA' | 'SELECT_ACTION' | 'ACTIVE_SCAN'
type ActionType = 'CONSUMO' | 'RECEPCION' | 'CONTEO'

interface ScannedProduct {
  producto_id: string
  nombre: string
  unidad: string
  cantidad: number
}

// ─── Componente Principal ───────────────────────────────────────────────────

export default function ModoQrPage() {
  const [flow, setFlow] = useState<FlowState>('SELECT_AREA')
  const [action, setAction] = useState<ActionType | null>(null)
  
  // Sincronización con el almacén global de áreas
  const globalAreaId = useAreaStore((s) => s.selectedAreaId)
  const setGlobalAreaId = useAreaStore((s) => s.setSelectedArea)
  const [areaId, setAreaId] = useState<number | null>(globalAreaId)

  // Estado del Carrito (Sesión de Trabajo)
  const [cart, setCart] = useState<Record<string, ScannedProduct>>({})
  const [lastScanned, setLastScanned] = useState<ScannedProduct | null>(null)
  const [cartExpanded, setCartExpanded] = useState(false)

  const queryClient = useQueryClient()

  // --- Datos ---
  const { data: areas } = useQuery({
    queryKey: ['areas'],
    queryFn: () => api.get<Area[]>('/areas').then((r) => r.data),
  })

  // --- Lógica de Escaneo ---
  const handleScan = useCallback(async (code: string) => {
    let searchCode = code
    try {
      const parsed = JSON.parse(code)
      if (parsed.id) searchCode = parsed.id
    } catch { /* No es JSON, usar raw code */ }

    try {
      const res = await api.get<{
        encontrado: boolean
        producto_id: string
        producto_nombre: string
        unidad_base_nombre: string
      }>(`/productos/scan?codigo=${encodeURIComponent(searchCode)}`)

      if (!res.data.encontrado) {
        toast.error(`Código no reconocido: ${code}`)
        return
      }

      const pId = res.data.producto_id
      setCart(prev => {
        const existing = prev[pId]
        const updatedItem = {
          producto_id: pId,
          nombre: res.data.producto_nombre,
          unidad: res.data.unidad_base_nombre,
          cantidad: (existing?.cantidad || 0) + 1
        }
        
        const nextCart = {
          ...prev,
          [pId]: updatedItem
        }
        
        setLastScanned(updatedItem)
        // Limpiar el popup después de 1.5s
        setTimeout(() => setLastScanned(null), 1500)
        return nextCart
      })

    } catch (err) {
      toast.error("Error al buscar producto")
    }
  }, [])

  // --- Mutaciones (Consumo por ahora) ---
  const batchMutation = useMutation({
    mutationFn: (data: ConsumoBatchRequest) =>
      api.post('/consumos/batch', data, { headers: { 'X-Idempotency-Key': uuidv4() } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stock'] })
      queryClient.invalidateQueries({ queryKey: ['stock-area'] })
      queryClient.invalidateQueries({ queryKey: ['alertas'] })
      setCart({})
      setCartExpanded(false)
      setFlow('SELECT_ACTION')
      toast.success('Registro completado con éxito', {
        icon: <CheckCircle2 className="text-success" />
      })
    },
    onError: () => toast.error('Error al procesar la sesión'),
  })

  const handleConfirmSession = () => {
    if (!areaId || Object.keys(cart).length === 0) return
    
    if (action === 'CONSUMO') {
      batchMutation.mutate({
        area_id: areaId,
        items: Object.values(cart).map(i => ({ 
          producto_id: i.producto_id, 
          cantidad: i.cantidad,
          unidad: 'base'
        })),
        nota: "Registrado vía Modo QR (Móvil)"
      })
    } else {
      toast.info(`El modo ${action} estará disponible pronto en QR`)
    }
  }

  // --- Renderizado de Pasos ---

  // PASO 1: Selección de Área
  if (flow === 'SELECT_AREA') {
    return (
      <div className="min-h-screen bg-base-200 p-6 flex flex-col justify-center animate-in fade-in zoom-in duration-300">
        <div className="text-center mb-10">
          <div className="inline-flex p-4 bg-primary/10 rounded-3xl mb-4 text-primary">
            <Zap className="h-10 w-10" />
          </div>
          <h1 className="text-3xl font-black tracking-tight">Modo Rápido</h1>
          <p className="text-sm opacity-50 font-medium">Declara tu ubicación actual</p>
        </div>

        <div className="space-y-3">
          {areas?.map(a => (
            <button
              key={a.id}
              onClick={() => { setAreaId(a.id); setGlobalAreaId(a.id); setFlow('SELECT_ACTION') }}
              className={cn(
                "btn btn-lg btn-block h-20 rounded-3xl border-none shadow-sm transition-all",
                areaId === a.id ? "bg-primary text-primary-content" : "bg-base-100 hover:bg-base-300"
              )}
            >
              <div className="flex flex-col items-center">
                <span className="text-lg font-bold">{a.nombre}</span>
                <span className="text-[10px] opacity-40 font-bold uppercase tracking-widest">{a.es_bodega ? 'Bodega Principal' : 'Laboratorio'}</span>
              </div>
            </button>
          ))}
        </div>
      </div>
    )
  }

  // PASO 2: Selección de Acción (Bento Style)
  if (flow === 'SELECT_ACTION') {
    const bentoItems = [
      { id: 'CONSUMO', label: 'Consumos', icon: Zap, color: 'bg-blue-500', desc: 'Despacho rápido' },
      { id: 'RECEPCION', label: 'Recepción', icon: Package, color: 'bg-green-500', desc: 'Entrada stock', disabled: true },
      { id: 'CONTEO', label: 'Conteo', icon: ClipboardCheck, color: 'bg-orange-500', desc: 'Inventario', disabled: true },
    ]

    return (
      <div className="min-h-screen bg-base-100 p-6 animate-in slide-in-from-right duration-300">
        <header className="flex items-center justify-between mb-10 mt-4">
          <button onClick={() => setFlow('SELECT_AREA')} className="btn btn-ghost btn-circle">
            <ArrowLeft className="h-6 w-6" />
          </button>
          <div className="badge badge-outline border-base-300 h-8 px-4 rounded-full font-bold opacity-40">
            {areas?.find(a => a.id === areaId)?.nombre}
          </div>
        </header>

        <h2 className="text-2xl font-black mb-6">¿Qué vas a registrar?</h2>
        
        <div className="grid grid-cols-1 gap-4">
          {bentoItems.map(item => (
            <button
              key={item.id}
              onClick={() => { setAction(item.id as ActionType); setFlow('ACTIVE_SCAN') }}
              disabled={item.disabled}
              className={cn(
                "group flex items-center p-6 border border-base-200 rounded-[2.5rem] transition-all active:scale-95 text-left",
                item.disabled ? "opacity-50 grayscale" : "bg-base-200/50 hover:bg-base-200"
              )}
            >
              <div className={cn("p-5 rounded-[2rem] text-white shadow-lg mr-6", item.color)}>
                <item.icon className="h-8 w-8" />
              </div>
              <div className="flex-1">
                <h3 className="text-xl font-bold">{item.label}</h3>
                <p className="text-sm opacity-40">{item.disabled ? 'Próximamente' : item.desc}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    )
  }

  // PASO 3: Escaneo Activo
  const cartItems = Object.values(cart)
  
  return (
    <div className="min-h-screen bg-black flex flex-col overflow-hidden animate-in fade-in duration-500">
      
      {/* Header Escáner */}
      <div className="absolute top-0 inset-x-0 p-6 z-20 flex items-center justify-between bg-gradient-to-b from-black/80 to-transparent">
        <button 
          onClick={() => { setFlow('SELECT_ACTION'); setCart({}); }} 
          className="btn btn-circle bg-white/10 border-none backdrop-blur-xl text-white hover:bg-white/20"
        >
          <ArrowLeft className="h-6 w-6" />
        </button>
        <div className="px-4 py-2 bg-white/10 backdrop-blur-xl rounded-full text-white text-[10px] font-black uppercase tracking-widest border border-white/10">
          Modo {action} • {areas?.find(a => a.id === areaId)?.nombre}
        </div>
      </div>

      {/* Escáner Central */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 relative">
        <QrScanner 
          active={flow === 'ACTIVE_SCAN'} 
          onScan={handleScan}
          paused={cartExpanded || !!batchMutation.isPending}
        />

        {/* Feedback Popup */}
        {lastScanned && (
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-primary/90 backdrop-blur-xl text-primary-content px-8 py-4 rounded-[2rem] shadow-2xl z-30 flex flex-col items-center gap-2 animate-in zoom-in fade-in duration-200">
            <CheckCircle2 className="h-8 w-8" />
            <span className="text-lg font-black text-center leading-tight">{lastScanned.nombre}</span>
            <span className="badge badge-white font-bold tracking-tight">+1 {lastScanned.unidad}</span>
          </div>
        )}

        {cartItems.length === 0 && (
          <div className="mt-8 flex flex-col items-center opacity-30 animate-pulse">
            <AlertCircle className="h-6 w-6 text-white mb-2" />
            <p className="text-white text-[10px] font-bold uppercase tracking-[0.2em]">Esperando lectura...</p>
          </div>
        )}
      </div>

      {/* BARRA INFERIOR (Carrito Móvil) */}
      <div className={cn(
        "bg-base-100 rounded-t-[3rem] transition-all duration-500 ease-in-out z-40 pb-safe shadow-[0_-20px_50px_rgba(0,0,0,0.3)] border-t border-base-200",
        cartExpanded ? "h-[85vh]" : "h-28"
      )}>
        {/* Mango Táctil */}
        <div 
          className="h-10 flex items-center justify-center cursor-pointer active:bg-base-200 transition-colors rounded-t-[3rem]"
          onClick={() => cartItems.length > 0 && setCartExpanded(!cartExpanded)}
        >
          <div className="w-12 h-1.5 bg-base-300 rounded-full" />
        </div>

        {/* Resumen (Mini) */}
        {!cartExpanded && (
          <div className="px-8 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="relative">
                <ShoppingCart className={cn("h-8 w-8 transition-colors", cartItems.length > 0 ? "text-primary" : "opacity-20")} />
                {cartItems.length > 0 && (
                  <span className="absolute -top-2 -right-2 badge badge-primary badge-sm font-black ring-4 ring-base-100">
                    {cartItems.length}
                  </span>
                )}
              </div>
              <div className="flex flex-col">
                <span className="text-xs font-black opacity-30 uppercase tracking-tighter">Sesión Actual</span>
                <span className="text-sm font-bold leading-none">
                  {cartItems.length === 0 ? 'Sin productos' : `${cartItems.length} tipos de productos`}
                </span>
              </div>
            </div>
            
            {cartItems.length > 0 && (
              <button 
                onClick={() => setCartExpanded(true)}
                className="btn btn-circle btn-ghost"
              >
                <ChevronUp className="h-6 w-6" />
              </button>
            )}
          </div>
        )}

        {/* Contenido Expandido */}
        {cartExpanded && (
          <div className="px-6 flex flex-col h-full overflow-hidden">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-2xl font-black">Detalle de Sesión</h3>
              <button 
                className="btn btn-circle btn-ghost"
                onClick={() => setCartExpanded(false)}
              >
                <ChevronDown className="h-6 w-6" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3 custom-scrollbar mb-6">
              {cartItems.map(item => (
                <div key={item.producto_id} className="p-4 bg-base-200/50 rounded-3xl border border-base-300/50 flex items-center justify-between">
                  <div className="flex-1 min-w-0 pr-4">
                    <h4 className="font-bold text-sm line-clamp-2 leading-tight mb-1">{item.nombre}</h4>
                    <span className="text-[10px] font-bold opacity-30 uppercase tracking-widest">{item.unidad}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <button 
                      onClick={() => setCart(prev => {
                        const existing = prev[item.producto_id]
                        if (existing.cantidad <= 1) {
                          const { [item.producto_id]: _, ...rest } = prev
                          return rest
                        }
                        return { ...prev, [item.producto_id]: { ...existing, cantidad: existing.cantidad - 1 } }
                      })}
                      className="btn btn-square btn-ghost btn-sm bg-base-300/50 rounded-xl"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                    <span className="text-lg font-black w-8 text-center">{item.cantidad}</span>
                    <button 
                      onClick={() => setCart(prev => ({ 
                        ...prev, 
                        [item.producto_id]: { ...item, cantidad: item.cantidad + 1 } 
                      }))}
                      className="btn btn-square btn-primary btn-sm rounded-xl"
                    >
                      <PlusIcon className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Acciones Finales */}
            <div className="pb-10 space-y-3 mt-auto">
              <button 
                className="btn btn-primary btn-block h-16 rounded-3xl text-lg font-bold shadow-xl shadow-primary/20 gap-3"
                disabled={batchMutation.isPending}
                onClick={handleConfirmSession}
              >
                {batchMutation.isPending ? (
                  <span className="loading loading-spinner"></span>
                ) : (
                  <>
                    <PackageCheck className="h-6 w-6" />
                    Confirmar Todo
                  </>
                )}
              </button>
              <button 
                className="btn btn-ghost btn-block h-12 rounded-2xl text-sm font-bold opacity-40"
                onClick={() => { setCart({}); setCartExpanded(false); }}
                disabled={batchMutation.isPending}
              >
                Cancelar Sesión
              </button>
            </div>
          </div>
        )}
      </div>

    </div>
  )
}

function PlusIcon(props: any) {
  return (
    <svg 
      {...props} 
      xmlns="http://www.w3.org/2000/svg" 
      width="24" height="24" 
      viewBox="0 0 24 24" 
      fill="none" stroke="currentColor" 
      strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
    >
      <path d="M5 12h14" /><path d="M12 5v14" />
    </svg>
  )
}
