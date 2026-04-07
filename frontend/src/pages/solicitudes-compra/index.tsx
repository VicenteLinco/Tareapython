import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useLocation, useSearchParams } from 'react-router-dom'
import {
  Search,
  Plus,
  Trash2,
  FileDown,
  CheckCircle2,
  History,
  User,
  ClipboardCheck,
  ShoppingCart,
  ArrowRight,
  Minus,
} from 'lucide-react'
import { toast } from 'sonner'
import api from '@/lib/api'
import type {
  PaginatedResponse,
  SolicitudResumen,
  SolicitudDetalle,
  SolicitudItem,
  ItemRecomendado,
  UpdateSolicitudRequest,
  Producto,
  EnCaminoItem
} from '@/types'
import { autoPlural, cn, formatDate } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuthStore } from '@/hooks/use-auth-store'
import { exportarSolicitudPDF } from '@/lib/solicitud-pdf'
import { Dialog } from '@/components/ui/dialog'
import { ProductoImage } from '@/components/ui/producto-image'

// ─── Helper functions ────────────────────────────────────────────────────────

function unidadLabel(item: SolicitudItem, qty: number): string {
  if (item.presentacion_nombre) {
    return qty === 1
      ? item.presentacion_nombre
      : (item.presentacion_nombre_plural ?? item.presentacion_nombre + 's')
  }
  return qty === 1
    ? item.unidad_base
    : (item.unidad_base_plural ?? autoPlural(item.unidad_base))
}

function equivalenciaBase(item: SolicitudItem): string | null {
  if (!item.presentacion_id || !item.factor_conversion) return null
  const total = item.cantidad * item.factor_conversion
  return `(${total} ${item.unidad_base_plural || autoPlural(item.unidad_base)})`
}

function formatPesos(val: number | string | null, monedaCodigo = 'CLP'): string {
  if (val === null) return '$0'
  const n = typeof val === 'string' ? parseFloat(val) : val
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: monedaCodigo }).format(n)
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function SolicitudesCompraPage() {
  useAuthStore()
  const queryClient = useQueryClient()
  const location = useLocation()
  const [searchParams] = useSearchParams()

  // States
  const [view, setView] = useState<'crear' | 'historial'>('crear')
  const [items, setItems] = useState<SolicitudItem[]>([])
  const [productSearch, setProductSearch] = useState('')
  const [searchAreaId, setSearchAreaId] = useState<number | null>(null)
  const [showRecomendaciones, setShowRecomendaciones] = useState(true)
  const [solicitudId, setSolicitudId] = useState<string | null>(null) // ID del borrador actual
  const [isSaving, setIsSaving] = useState(false)
  const [historialSearch, setHistorialSearch] = useState('')

  // Historial & Detail
  const [selectedSolicitudId, setSelectedSolicitudId] = useState<string | null>(null)
  
  // Sync view from state (if navigated from elsewhere)
  useEffect(() => {
    if (location.state?.view) setView(location.state.view)
  }, [location.state])

  // Queries
  const { data: recomendaciones, isLoading: isLoadingRecs } = useQuery({
    queryKey: ['solicitudes-recomendaciones'],
    queryFn: () => api.get<ItemRecomendado[]>('/solicitudes-compra/recomendaciones').then(r => r.data),
    enabled: view === 'crear'
  })

  const { data: areas } = useQuery({
    queryKey: ['areas'],
    queryFn: () => api.get<{ id: number; nombre: string; activa: boolean }[]>('/areas').then(r => r.data),
    staleTime: 300_000,
  })

  const { data: searchResults, isLoading: isSearching } = useQuery({
    queryKey: ['productos-search', productSearch, searchAreaId],
    queryFn: () => api.get<PaginatedResponse<Producto>>('/productos', {
      params: { q: productSearch, per_page: 10, ...(searchAreaId && { area_id: searchAreaId }) }
    }).then(r => r.data),
    enabled: productSearch.length >= 2
  })

  const { data: historial, isLoading: isLoadingHistorial } = useQuery({
    queryKey: ['solicitudes-historial', historialSearch],
    queryFn: () => api.get<PaginatedResponse<SolicitudResumen>>('/solicitudes-compra', {
        params: { q: historialSearch || undefined }
    }).then(r => r.data),
    enabled: view === 'historial'
  })

  useQuery({
    queryKey: ['solicitudes-en-camino'],
    queryFn: () => api.get<{ data: EnCaminoItem[] }>('/solicitudes-compra/en-camino').then(r => r.data),
    enabled: view === 'crear'
  })

  // Cargar borrador inicial si existe; si viene ?select=ID, agregar ese producto al final
  useEffect(() => {
    if (view !== 'crear' || items.length > 0) return

    const productoId = searchParams.get('select')

    api.get<{ borrador: SolicitudDetalle | null }>('/solicitudes-compra/borrador')
      .then(res => {
        const b = res.data.borrador
        const borradorItems: SolicitudItem[] = b ? b.items.map(item => ({
          producto_id: item.producto_id,
          producto_nombre: item.producto_nombre,
          codigo_proveedor: item.codigo_proveedor,
          codigo_maestro: item.codigo_maestro,
          proveedor_id: null,
          proveedor_nombre: item.proveedor_nombre || 'Desconocido',
          lead_time: 0,
          presentacion_id: item.presentacion_id,
          presentacion_nombre: item.presentacion_nombre,
          presentacion_nombre_plural: item.presentacion_nombre_plural,
          factor_conversion: item.factor_conversion ? parseFloat(item.factor_conversion) : null,
          unidad_base: item.unidad,
          unidad_base_plural: autoPlural(item.unidad),
          cantidad: parseFloat(item.cantidad_sugerida),
          precio_unitario: item.precio_unitario ? parseFloat(item.precio_unitario) : 0,
          imagen_url: item.imagen_url,
        })) : []

        if (b) setSolicitudId(b.id)

        // Si hay ?select=, agregar ese producto si no está ya en el borrador
        if (productoId && !borradorItems.some(i => i.producto_id === productoId)) {
          api.get<Producto>(`/productos/${productoId}`)
            .then(res2 => {
              const p = res2.data
              if (!p) { setItems(borradorItems); return }
              const newItem: SolicitudItem = {
                producto_id: p.id,
                producto_nombre: p.nombre,
                codigo_proveedor: p.codigo_proveedor,
                codigo_maestro: p.codigo_maestro,
                proveedor_id: p.proveedor_id,
                proveedor_nombre: 'Manual',
                lead_time: p.lead_time_propio || 0,
                presentacion_id: null,
                presentacion_nombre: null,
                presentacion_nombre_plural: null,
                factor_conversion: null,
                unidad_base: 'u', // Producto type only exposes unidad_base_id; 'u' is a display placeholder until draft is saved and refetched
                unidad_base_plural: 'u',
                cantidad: 1,
                precio_unitario: p.precio_unidad ? parseFloat(String(p.precio_unidad)) : 0,
                imagen_url: p.imagen_url,
              }
              setItems([...borradorItems, newItem])
              setView('crear')
            })
            .catch(() => { setItems(borradorItems) })
        } else {
          setItems(borradorItems)
        }
      })
  }, [view, items.length, searchParams])

  // Mutation: Guardar Borrador
  const saveMutation = useMutation({
    mutationFn: (data: UpdateSolicitudRequest) => {
      if (solicitudId) {
        return api.put(`/solicitudes-compra/${solicitudId}`, data)
      } else {
        return api.post('/solicitudes-compra', data)
      }
    },
    onSuccess: (res) => {
      if (!solicitudId) setSolicitudId(res.data.id)
      queryClient.invalidateQueries({ queryKey: ['solicitudes-historial'] })
      toast.success('Borrador guardado')
    }
  })

  // Acciones
  const handleAddFromRec = (r: ItemRecomendado) => {
    if (items.find(i => i.producto_id === r.producto_id)) {
      toast.error('Producto ya está en la lista')
      return
    }
    const qty = r.cantidad_sugerida_presentacion 
      ? Math.ceil(parseFloat(r.cantidad_sugerida_presentacion))
      : Math.ceil(parseFloat(r.cantidad_sugerida_base))
      
    const newItem: SolicitudItem = {
      producto_id: r.producto_id,
      producto_nombre: r.producto_nombre,
      codigo_proveedor: r.codigo_proveedor,
      codigo_maestro: r.codigo_maestro,
      proveedor_id: r.proveedor_id,
      proveedor_nombre: r.proveedor_nombre || 'S/P',
      lead_time: r.lead_time,
      presentacion_id: r.presentacion_id,
      presentacion_nombre: r.presentacion_nombre,
      presentacion_nombre_plural: r.presentacion_nombre_plural,
      factor_conversion: r.factor_conversion ? parseFloat(r.factor_conversion) : null,
      unidad_base: r.unidad_base,
      unidad_base_plural: r.unidad_base_plural || autoPlural(r.unidad_base),
      cantidad: qty,
      precio_unitario: r.precio_ultima_recepcion ? parseFloat(r.precio_ultima_recepcion) : 0,
      imagen_url: r.imagen_url,
    }
    setItems(prev => [...prev, newItem])
  }

  const handleUpdateQty = (pid: string, val: number) => {
    setItems(prev => prev.map(i => i.producto_id === pid ? { ...i, cantidad: Math.max(1, val) } : i))
  }

  const handleRemove = (pid: string) => {
    setItems(prev => prev.filter(i => i.producto_id !== pid))
  }

  const handleSaveBorrador = () => {
    if (items.length === 0) return
    setIsSaving(true)
    saveMutation.mutate({
      nota: null,
      items: items.map(i => ({
        producto_id: i.producto_id,
        cantidad_sugerida: i.cantidad.toString(),
        unidad: i.unidad_base,
        precio_unitario: i.precio_unitario.toString(),
        presentacion_id: i.presentacion_id,
        cantidad_presentaciones: i.cantidad.toString()
      }))
    }, { onSettled: () => setIsSaving(false) })
  }

  const enviarMutation = useMutation({
    mutationFn: () => api.post(`/solicitudes-compra/${solicitudId}/enviar`),
    onSuccess: () => {
      toast.success('Solicitud enviada a revisión')
      setItems([])
      setSolicitudId(null)
      setView('historial')
      queryClient.invalidateQueries({ queryKey: ['solicitudes-historial'] })
    }
  })

  // Configuración del sistema
  const { data: configuracion } = useQuery({
    queryKey: ['configuracion'],
    queryFn: () => api.get<{ nombre_laboratorio: string; logo_base64: string; moneda_simbolo: string; moneda_codigo: string }>('/configuracion').then(r => r.data),
    staleTime: 300_000,
  })

  const monedaCodigo = configuracion?.moneda_codigo ?? 'CLP'
  const fmt = (v: number | string | null) => formatPesos(v, monedaCodigo)

  // Render Detalle Modal
  const { data: detail, isLoading: isLoadingDetail } = useQuery({
    queryKey: ['solicitud-detail', selectedSolicitudId],
    queryFn: () => api.get<SolicitudDetalle>(`/solicitudes-compra/${selectedSolicitudId}`).then(r => r.data),
    enabled: !!selectedSolicitudId
  })

  return (
    <div className="flex flex-col h-[calc(100vh-100px)] gap-6 p-2">
      {/* Header & Tabs */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ShoppingCart className="h-6 w-6 text-primary" />
            Solicitudes de Compra
          </h1>
          <p className="text-sm opacity-50">Gestiona tus pedidos y revisa recomendaciones basadas en stock</p>
        </div>
        
        <div className="tabs tabs-boxed bg-base-200 p-1 rounded-2xl self-start">
          <button 
            className={cn("tab gap-2 rounded-xl transition-all px-6 h-10", view === 'crear' ? "tab-active bg-primary text-primary-content font-bold shadow-lg" : "hover:bg-base-300")}
            onClick={() => setView('crear')}
          >
            <Plus className="h-4 w-4" /> Crear Nueva
          </button>
          <button 
            className={cn("tab gap-2 rounded-xl transition-all px-6 h-10", view === 'historial' ? "tab-active bg-primary text-primary-content font-bold shadow-lg" : "hover:bg-base-300")}
            onClick={() => setView('historial')}
          >
            <History className="h-4 w-4" /> Historial
          </button>
        </div>
      </div>

      {view === 'crear' ? (
        <div className="flex-1 flex flex-col lg:flex-row gap-6 min-h-0">

          {/* LADO IZQUIERDO: Recomendaciones y Búsqueda */}
          <div className="flex-1 flex flex-col gap-6 min-w-0 min-h-0">

            {/* Buscador de productos */}
            <div className="relative">
              <div className="flex gap-2 bg-base-100 border border-base-300 rounded-2xl shadow-sm p-2 focus-within:ring-2 focus-within:ring-primary/20 transition-all">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 opacity-30 pointer-events-none" />
                  <Input
                    placeholder="Buscar producto por nombre o código..."
                    className="pl-9 h-10 bg-transparent border-none shadow-none focus-visible:ring-0 text-sm"
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                  />
                  {isSearching && <span className="loading loading-spinner loading-xs absolute right-3 top-1/2 -translate-y-1/2 opacity-30"></span>}
                </div>
                <select
                  className="select select-sm h-10 min-w-[160px] bg-base-200/60 border-none rounded-xl text-xs font-medium"
                  value={searchAreaId ?? ''}
                  onChange={(e) => setSearchAreaId(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">Todas las áreas</option>
                  {areas?.filter(a => a.activa).map(a => (
                    <option key={a.id} value={a.id}>{a.nombre}</option>
                  ))}
                </select>
              </div>

              {/* Resultados búsqueda */}
              {searchResults && productSearch.length >= 2 && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-base-100 border border-base-300 rounded-2xl shadow-2xl z-[200] overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150">
                  <div className="max-h-72 overflow-y-auto p-1.5">
                    {searchResults.data.map(p => (
                      <button
                        key={p.id}
                        className="w-full flex items-center justify-between gap-3 p-3 hover:bg-base-200 rounded-xl transition-colors text-left group"
                        onClick={() => {
                          const fakeRec: ItemRecomendado = {
                            producto_id: p.id,
                            producto_nombre: p.nombre,
                            codigo_proveedor: p.codigo_proveedor,
                            codigo_maestro: p.codigo_maestro,
                            proveedor_id: p.proveedor_id,
                            proveedor_nombre: 'Manual',
                            lead_time: p.lead_time_propio || 0,
                            autonomia_dias: 0,
                            nivel_urgencia: 'normal',
                            stock_actual: '0',
                            stock_minimo: p.stock_minimo,
                            consumo_diario_30d: '0',
                            cantidad_sugerida_base: '1',
                            presentacion_id: null,
                            presentacion_nombre: null,
                            presentacion_nombre_plural: null,
                            factor_conversion: null,
                            cantidad_sugerida_presentacion: null,
                            precio_ultima_recepcion: p.precio_unidad,
                            unidad_base: 'u',
                            unidad_base_plural: 'u',
                            solicitudes_pendientes: 0
                          }
                          handleAddFromRec(fakeRec)
                          setProductSearch('')
                        }}
                      >
                        <div className="flex-1 min-w-0">
                          <p className="font-bold text-sm truncate">{p.nombre}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[10px] opacity-40 uppercase font-mono">#{p.codigo_interno}</span>
                            {searchAreaId && (
                              <span className="badge badge-xs bg-blue-100 text-blue-700 border-none">
                                {areas?.find(a => a.id === searchAreaId)?.nombre}
                              </span>
                            )}
                            {p.precio_unidad && (
                              <span className="text-[10px] font-bold text-success opacity-70">
                                {formatPesos(p.precio_unidad, monedaCodigo)}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="h-7 w-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Plus className="h-3.5 w-3.5" />
                        </div>
                      </button>
                    ))}
                    {searchResults.data.length === 0 && (
                      <p className="p-4 text-center text-sm opacity-40">No se encontraron productos</p>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Recomendaciones */}
            <div className="flex-1 flex flex-col bg-base-100 rounded-[2rem] border border-base-300 shadow-sm overflow-hidden min-h-[300px]">
              <div className="p-6 border-b border-base-200 flex items-center justify-between bg-base-200/20">
                <div className="flex items-center gap-3">
                  <ClipboardCheck className="h-5 w-5 text-primary" />
                  <h2 className="font-bold">Sugerencias por Quiebre de Stock</h2>
                </div>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="rounded-xl h-8"
                  onClick={() => setShowRecomendaciones(!showRecomendaciones)}
                >
                  {showRecomendaciones ? 'Ocultar' : 'Mostrar'}
                </Button>
              </div>

              {showRecomendaciones && (
                <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
                  {isLoadingRecs ? (
                    Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-24 w-full rounded-2xl" />)
                  ) : recomendaciones?.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center opacity-30 text-center p-10">
                      <CheckCircle2 className="h-12 w-12 mb-4 stroke-[1.5px]" />
                      <p className="font-bold">¡Todo al día!</p>
                      <p className="text-sm">No hay productos que necesiten reposición urgente.</p>
                    </div>
                  ) : (
                    recomendaciones?.map(r => {
                      const alreadyAdded = items.some(i => i.producto_id === r.producto_id)
                      return (
                        <div 
                          key={r.producto_id} 
                          className={cn(
                            "group p-4 rounded-2xl border transition-all duration-300 flex items-center gap-4",
                            alreadyAdded ? "bg-base-200/50 opacity-60 border-transparent" : "bg-base-100 border-base-200 hover:border-primary/50 hover:shadow-md"
                          )}
                        >
                          <div className={cn(
                            "w-1 h-12 rounded-full",
                            r.nivel_urgencia === 'critica' ? 'bg-error' : r.nivel_urgencia === 'alta' ? 'bg-warning' : 'bg-primary'
                          )} />
                          
                          <div className="flex-1 min-w-0">
                            <h3 className="font-bold text-sm truncate">{r.producto_nombre}</h3>
                            <div className="flex items-center gap-2 mt-1">
                              <Badge variant="secondary" className="text-[9px] uppercase font-bold">{r.proveedor_nombre || 'Sin Proveedor'}</Badge>
                              <span className="text-[10px] opacity-40 font-bold uppercase tracking-wider">
                                Stock: {parseFloat(r.stock_actual)} / {parseFloat(r.stock_minimo)}
                              </span>
                            </div>
                          </div>

                          <div className="text-right">
                            <p className="text-[10px] font-bold opacity-40 uppercase leading-none mb-1">Sugerido</p>
                            <p className="font-black text-primary">
                              {r.cantidad_sugerida_presentacion 
                                ? `${Math.ceil(parseFloat(r.cantidad_sugerida_presentacion))} ${r.presentacion_nombre_plural || r.presentacion_nombre}`
                                : `${Math.ceil(parseFloat(r.cantidad_sugerida_base))} ${r.unidad_base_plural || r.unidad_base}`
                              }
                            </p>
                          </div>

                          <button 
                            className="btn btn-primary btn-sm btn-circle rounded-xl shadow-lg shadow-primary/20 scale-90 active:scale-75 transition-all"
                            onClick={() => handleAddFromRec(r)}
                            disabled={alreadyAdded}
                          >
                            <Plus className="h-4 w-4" />
                          </button>
                        </div>
                      )
                    })
                  )}
                </div>
              )}
            </div>
          </div>

          {/* LADO DERECHO: Borrador Actual */}
          <div className="w-full lg:w-[450px] flex flex-col bg-base-100 rounded-[2.5rem] border border-base-300 shadow-2xl overflow-hidden relative">
            <div className="p-8 border-b border-base-200 flex items-center justify-between bg-primary/5">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-primary text-primary-content rounded-2xl shadow-xl">
                  <ShoppingCart className="h-6 w-6" />
                </div>
                <div>
                  <h2 className="text-lg font-bold">Nueva Solicitud</h2>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-primary/60">
                    {items.length} productos en lista
                  </p>
                </div>
              </div>
              {solicitudId && (
                <div className="tooltip tooltip-left" data-tip="Borrador guardado">
                  <Badge className="bg-success/10 text-success border-success/20 px-3 py-1">Auto-guardado</Badge>
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar">
              {items.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center opacity-30 p-10">
                  <div className="w-20 h-20 bg-base-200 rounded-full flex items-center justify-center mb-6 animate-pulse">
                    <Plus className="h-10 w-10" />
                  </div>
                  <p className="text-lg font-bold">Tu lista está vacía</p>
                  <p className="text-sm">Agrega productos desde las sugerencias o usa el buscador superior.</p>
                </div>
              ) : (
                items.map(item => (
                  <div key={item.producto_id} className="card bg-base-200/40 border-transparent hover:border-primary/20 hover:bg-base-200/60 transition-all p-4 rounded-3xl group">
                    <div className="flex justify-between items-start gap-4 mb-3">
                      <div className="flex items-start gap-3 min-w-0 flex-1">
                        <ProductoImage src={item.imagen_url} size="sm" className="shrink-0 mt-0.5" />
                        <div className="min-w-0">
                          <h4 className="font-bold text-sm leading-tight line-clamp-2 mb-1">{item.producto_nombre}</h4>
                          <p className="text-[10px] font-bold opacity-40 uppercase tracking-tighter">
                            {item.proveedor_nombre} • LT: {item.lead_time}d
                          </p>
                        </div>
                      </div>
                      <button
                        className="btn btn-ghost btn-xs btn-circle text-error opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => handleRemove(item.producto_id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="flex items-center bg-base-100 rounded-2xl border border-base-300 p-1 shadow-inner">
                          <button 
                            className="btn btn-ghost btn-xs btn-circle h-8 w-8"
                            onClick={() => handleUpdateQty(item.producto_id, item.cantidad - 1)}
                          >
                            <Minus className="h-3 w-3" />
                          </button>
                          <input 
                            type="number" 
                            className="w-12 text-center text-sm font-black bg-transparent focus:outline-none"
                            value={item.cantidad}
                            onChange={(e) => handleUpdateQty(item.producto_id, parseInt(e.target.value) || 1)}
                          />
                          <button 
                            className="btn btn-ghost btn-xs btn-circle h-8 w-8"
                            onClick={() => handleUpdateQty(item.producto_id, item.cantidad + 1)}
                          >
                            <Plus className="h-3 w-3" />
                          </button>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-xs font-bold text-primary">{unidadLabel(item, item.cantidad)}</span>
                          {equivalenciaBase(item) && (
                            <span className="text-[9px] opacity-40 font-medium">{equivalenciaBase(item)}</span>
                          )}
                        </div>
                      </div>

                      <div className="text-right">
                        <p className="text-[10px] font-bold opacity-40 uppercase">Referencia</p>
                        <p className="text-xs font-bold font-mono">
                          {fmt(item.precio_unitario)}/u
                        </p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="p-8 bg-base-200/50 border-t border-base-300 space-y-4">
              <div className="flex justify-between items-center text-sm font-bold px-2">
                <span className="opacity-50 uppercase tracking-widest text-[10px]">Costo Estimado</span>
                <span className="text-lg flex items-center gap-2">
                  {fmt(items.reduce((acc, i) => acc + (i.cantidad * i.precio_unitario), 0))}
                  <span className="badge badge-ghost badge-xs font-mono">{monedaCodigo}</span>
                </span>
              </div>
              
              <div className="grid grid-cols-2 gap-3">
                <Button 
                  variant="outline" 
                  className="rounded-2xl h-12 font-bold"
                  onClick={handleSaveBorrador}
                  disabled={items.length === 0 || isSaving}
                >
                  {isSaving ? <span className="loading loading-spinner loading-sm"></span> : 'Guardar Borrador'}
                </Button>
                <Button 
                  className="rounded-2xl h-12 font-bold gap-2 shadow-xl shadow-primary/20"
                  disabled={items.length === 0 || enviarMutation.isPending || !solicitudId}
                  onClick={() => enviarMutation.mutate()}
                >
                  Enviar <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
              {!solicitudId && items.length > 0 && (
                <p className="text-[9px] text-center text-warning font-bold uppercase animate-pulse">Debes guardar como borrador antes de enviar</p>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* VISTA HISTORIAL */
        <div className="flex-1 bg-base-100 rounded-[2rem] border border-base-300 shadow-sm overflow-hidden flex flex-col">
          <div className="p-6 border-b border-base-200 bg-base-200/20 flex items-center gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 opacity-30" />
              <Input
                  placeholder="Buscar por número de documento..."
                  className="pl-10 h-10 rounded-xl"
                  value={historialSearch}
                  onChange={(e) => setHistorialSearch(e.target.value)}
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar">
            {isLoadingHistorial ? (
              <div className="p-10 text-center"><span className="loading loading-spinner loading-lg text-primary opacity-20"></span></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="table table-md table-zebra w-full">
                  <thead className="bg-base-200/50 sticky top-0 z-10">
                    <tr className="border-b border-base-300">
                      <th className="text-[10px] font-black uppercase tracking-widest opacity-40">Documento</th>
                      <th className="text-[10px] font-black uppercase tracking-widest opacity-40">Fecha</th>
                      <th className="text-[10px] font-black uppercase tracking-widest opacity-40">Usuario</th>
                      <th className="text-[10px] font-black uppercase tracking-widest opacity-40 text-center">Items</th>
                      <th className="text-[10px] font-black uppercase tracking-widest opacity-40">Estado</th>
                      <th className="text-[10px] font-black uppercase tracking-widest opacity-40 text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historial?.data.map(s => (
                      <tr key={s.id} className="hover:bg-primary/5 transition-colors cursor-pointer group" onClick={() => setSelectedSolicitudId(s.id)}>
                        <td className="font-bold text-sm">{s.numero_documento}</td>
                        <td className="text-xs opacity-60">{formatDate(s.fecha_creacion)}</td>
                        <td className="text-xs font-medium"><div className="flex items-center gap-2"><User className="h-3 w-3" /> {s.usuario_nombre}</div></td>
                        <td className="text-center font-mono text-sm">{s.items_count}</td>
                        <td>
                          <Badge variant="outline" className={cn(
                            "capitalize font-bold px-3 py-1",
                            s.estado === 'aprobada' ? 'bg-success/10 text-success border-success/30' :
                            s.estado === 'pendiente' ? 'bg-warning/10 text-warning border-warning/30' :
                            s.estado === 'rechazada' ? 'bg-error/10 text-error border-error/30' :
                            s.estado === 'enviada' ? 'bg-info/10 text-info border-info/30' :
                            'bg-base-200 text-base-content/50 border-base-300'
                          )}>
                            {s.estado}
                          </Badge>
                        </td>
                        <td className="text-right">
                          <button className="btn btn-ghost btn-sm btn-circle opacity-0 group-hover:opacity-100 transition-opacity">
                            <ArrowRight className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL DETALLE */}
      <Dialog 
        open={!!selectedSolicitudId} 
        onClose={() => setSelectedSolicitudId(null)} 
        title={`Detalle Solicitud ${detail?.numero_documento || ''}`}
        className="max-w-4xl"
      >
        {isLoadingDetail ? (
          <div className="py-20 text-center"><span className="loading loading-spinner loading-lg"></span></div>
        ) : detail && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-base-200/50 rounded-2xl">
              <div>
                <p className="text-[10px] font-black uppercase opacity-40">Estado</p>
                <p className="font-bold capitalize">{detail.estado}</p>
              </div>
              <div>
                <p className="text-[10px] font-black uppercase opacity-40">Solicitado por</p>
                <p className="font-bold">{detail.usuario_nombre}</p>
              </div>
              <div>
                <p className="text-[10px] font-black uppercase opacity-40">Fecha</p>
                <p className="font-bold">{formatDate(detail.fecha_creacion)}</p>
              </div>
              {detail.revisado_por_nombre && (
                <div>
                  <p className="text-[10px] font-black uppercase opacity-40">Revisado por</p>
                  <p className="font-bold">{detail.revisado_por_nombre}</p>
                </div>
              )}
            </div>

            <div className="overflow-hidden border border-base-300 rounded-2xl">
              <table className="table table-zebra table-sm">
                <thead className="bg-base-200">
                  <tr>
                    <th>Producto</th>
                    <th>Proveedor</th>
                    <th className="text-center">Cant.</th>
                    <th>Unidad</th>
                    <th className="text-right">Unitario</th>
                    <th className="text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.items.map((item, idx) => {
                    const cant = parseFloat(item.cantidad_sugerida)
                    const pu = item.precio_unitario ? parseFloat(item.precio_unitario) : 0
                    return (
                      <tr key={idx}>
                        <td className="font-bold text-xs">{item.producto_nombre}</td>
                        <td className="text-[10px] opacity-60">{item.proveedor_nombre}</td>
                        <td className="text-center font-bold">{cant}</td>
                        <td className="text-[10px] uppercase font-bold opacity-50">{item.presentacion_nombre || item.unidad}</td>
                        <td className="text-right font-mono text-[11px]">{fmt(pu)}</td>
                        <td className="text-right font-bold text-xs">{fmt(cant * pu)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {detail.nota && (
              <div className="p-4 bg-primary/5 rounded-2xl border border-primary/10">
                <p className="text-[10px] font-black uppercase opacity-40 mb-1">Nota de solicitud</p>
                <p className="text-sm italic">"{detail.nota}"</p>
              </div>
            )}

            {detail.nota_revision && (
              <div className="p-4 bg-warning/5 rounded-2xl border border-warning/10">
                <p className="text-[10px] font-black uppercase opacity-40 mb-1">Nota de revisión</p>
                <p className="text-sm italic">"{detail.nota_revision}"</p>
              </div>
            )}

            <div className="flex justify-between items-center pt-4 border-t">
              <div className="text-xl font-black flex items-center gap-2">
                <span className="text-xs opacity-40 font-bold uppercase mr-1">Total Estimado:</span>
                {fmt(detail.items.reduce((acc, i) => acc + (parseFloat(i.cantidad_sugerida) * (i.precio_unitario ? parseFloat(i.precio_unitario) : 0)), 0))}
                <span className="badge badge-ghost badge-xs font-mono">{monedaCodigo}</span>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="rounded-xl h-10 gap-2" onClick={() => {
                    const subtotal = detail.items.reduce((acc, i) =>
                        acc + parseFloat(i.cantidad_sugerida) * (i.precio_unitario ? parseFloat(i.precio_unitario) : 0), 0)
                    const iva = subtotal * 0.19
                    exportarSolicitudPDF({
                        numero_documento: detail.numero_documento,
                        fecha_creacion: detail.fecha_creacion,
                        usuario_nombre: detail.usuario_nombre,
                        nota: detail.nota,
                        subtotal_neto: subtotal,
                        iva,
                        total_con_iva: subtotal + iva,
                        nombreLaboratorio: configuracion?.nombre_laboratorio || 'Laboratorio Clínico',
                        logoBase64: configuracion?.logo_base64 || null,
                        monedaSimbolo: configuracion?.moneda_simbolo || '$',
                        items: detail.items.map(i => ({
                            producto_nombre: i.producto_nombre,
                            cantidad_sugerida: parseFloat(i.cantidad_sugerida),
                            unidad: i.unidad,
                            codigo_maestro: i.codigo_maestro,
                            codigo_proveedor: i.codigo_proveedor,
                            proveedor_nombre: i.proveedor_nombre,
                            presentacion_nombre: i.presentacion_nombre,
                            presentacion_nombre_plural: i.presentacion_nombre_plural,
                            factor_conversion: i.factor_conversion ? parseFloat(i.factor_conversion) : null,
                            cantidad_presentaciones: i.cantidad_presentaciones ? parseFloat(i.cantidad_presentaciones) : null,
                            precio_unitario: i.precio_unitario ? parseFloat(i.precio_unitario) : null,
                        }))
                    })
                }}>
                  <FileDown className="h-4 w-4" /> PDF
                </Button>
                <Button className="rounded-xl h-10" onClick={() => setSelectedSolicitudId(null)}>Cerrar</Button>
              </div>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  )
}
