import { useState, useEffect, useRef } from 'react'
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
  ChevronLeft,
  Mail,
  Phone,
  Clock,
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
  Proveedor,
} from '@/types'
import { autoPlural, cn, formatDate, formatCantidad } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuthStore } from '@/hooks/use-auth-store'
import { exportarSolicitudPDF } from '@/lib/solicitud-pdf'
import { Dialog } from '@/components/ui/dialog'
import { ProductoImage } from '@/components/ui/producto-image'
import { SolicitudBuscador } from './components/solicitud-buscador'

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

// ─── Proveedor Gallery ───────────────────────────────────────────────────────

interface ProveedorCardProps {
  proveedor: Proveedor
  urgencias: number
  criticos: number
  onClick: () => void
}

function ProveedorCard({ proveedor, urgencias, criticos, onClick }: ProveedorCardProps) {
  const hasCriticos = criticos > 0
  const hasUrgencias = urgencias > 0

  return (
    <button
      onClick={onClick}
      className="group relative flex flex-col items-center gap-3 p-6 bg-base-100 border border-base-300 rounded-3xl hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5 transition-all duration-200 text-center"
    >
      {/* Urgency badge */}
      {hasCriticos ? (
        <span className="absolute top-3 right-3 badge badge-error badge-sm font-bold gap-1">
          <span className="text-[9px]">●</span> {criticos} crítico{criticos !== 1 ? 's' : ''}
        </span>
      ) : hasUrgencias ? (
        <span className="absolute top-3 right-3 badge badge-warning badge-sm font-bold gap-1">
          <span className="text-[9px]">▲</span> {urgencias}
        </span>
      ) : (
        <span className="absolute top-3 right-3 badge badge-success badge-sm font-bold text-[9px]">
          ✓ OK
        </span>
      )}

      <div className={cn(
        "w-14 h-14 rounded-2xl flex items-center justify-center text-2xl transition-transform group-hover:scale-110 overflow-hidden",
        hasCriticos ? 'bg-error/10' : hasUrgencias ? 'bg-warning/10' : 'bg-success/10'
      )}>
        {proveedor.icono
          ? <img src={proveedor.icono} alt={proveedor.nombre} className="h-full w-full object-contain" />
          : '🏭'}
      </div>

      <div className="flex-1 flex flex-col gap-1 w-full">
        <p className="font-bold text-sm leading-tight">{proveedor.nombre}</p>

        <p className="text-[10px] opacity-40 font-medium">
          {proveedor.total_productos} producto{proveedor.total_productos !== 1 ? 's' : ''}
        </p>

        {(proveedor.dias_despacho_tierra || proveedor.dias_despacho_aereo) && (
          <p className="text-[10px] opacity-50 flex items-center justify-center gap-1">
            <Clock className="h-2.5 w-2.5" />
            LT: {proveedor.dias_despacho_tierra ?? proveedor.dias_despacho_aereo} días
          </p>
        )}
      </div>

      {(proveedor.contacto || proveedor.email || proveedor.telefono) && (
        <div className="w-full pt-2.5 border-t border-base-200 space-y-1 text-left">
          {proveedor.contacto && (
            <p className="text-[10px] opacity-50 truncate flex items-center gap-1">
              <span className="opacity-60">👤</span> {proveedor.contacto}
            </p>
          )}
          {proveedor.telefono && (
            <p className="text-[10px] opacity-50 truncate flex items-center gap-1">
              <Phone className="h-2.5 w-2.5 shrink-0" /> {proveedor.telefono}
            </p>
          )}
          {proveedor.email && (
            <p className="text-[10px] opacity-50 truncate flex items-center gap-1">
              <Mail className="h-2.5 w-2.5 shrink-0" /> {proveedor.email}
            </p>
          )}
        </div>
      )}

      <div className={cn(
        "absolute inset-0 rounded-3xl border-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none",
        hasCriticos ? 'border-error/40' : hasUrgencias ? 'border-warning/40' : 'border-primary/30'
      )} />
    </button>
  )
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function SolicitudesCompraPage() {
  useAuthStore()
  const queryClient = useQueryClient()
  const location = useLocation()
  const [searchParams] = useSearchParams()

  // Views & steps
  const [view, setView] = useState<'crear' | 'historial'>('crear')
  const [selectedProveedor, setSelectedProveedor] = useState<Proveedor | null>(null)

  // Cart state
  const [items, setItems] = useState<SolicitudItem[]>([])
  const [solicitudId, setSolicitudId] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  // Historial
  const [historialSearch, setHistorialSearch] = useState('')
  const [selectedSolicitudId, setSelectedSolicitudId] = useState<string | null>(null)

  // PDF firma customization
  const [pdfFirmaLabel, setPdfFirmaLabel] = useState('')

  // Prevent borrador from reloading after it's been intentionally cleared
  const borradorCargado = useRef(false)

  // Sync view from navigation state
  useEffect(() => {
    if (location.state?.view) setView(location.state.view)
  }, [location.state])

  // ── Queries ─────────────────────────────────────────────────────────────────

  const { data: proveedores, isLoading: isLoadingProveedores } = useQuery({
    queryKey: ['proveedores-activos'],
    queryFn: () => api.get<Proveedor[]>('/proveedores').then(r => r.data),
    staleTime: 300_000,
  })

  const { data: recomendaciones, isLoading: isLoadingRecs } = useQuery({
    queryKey: ['solicitudes-recomendaciones'],
    queryFn: () => api.get<{ data: ItemRecomendado[] }>('/solicitudes-compra/recomendaciones').then(r => r.data.data),
    enabled: view === 'crear',
  })

  const { data: historial, isLoading: isLoadingHistorial } = useQuery({
    queryKey: ['solicitudes-historial', historialSearch],
    queryFn: () =>
      api.get<PaginatedResponse<SolicitudResumen>>('/solicitudes-compra', {
        params: { q: historialSearch || undefined },
      }).then(r => r.data),
    enabled: view === 'historial',
  })

  // Configuración
  const { data: configuracion } = useQuery({
    queryKey: ['configuracion'],
    queryFn: () =>
      api.get<{ nombre_laboratorio: string; logo_base64: string; moneda_simbolo: string; moneda_codigo: string }>('/configuracion').then(r => r.data),
    staleTime: 300_000,
  })

  const monedaCodigo = configuracion?.moneda_codigo ?? 'CLP'
  const fmt = (v: number | string | null) => formatPesos(v, monedaCodigo)

  // Load borrador once on mount (guarded to prevent reload after intentional clear)
  useEffect(() => {
    if (view !== 'crear' || borradorCargado.current) return
    borradorCargado.current = true
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
                unidad_base: 'u',
                unidad_base_plural: 'u',
                cantidad: 1,
                precio_unitario: p.precio_unidad ? parseFloat(String(p.precio_unidad)) : 0,
                imagen_url: (p as Producto & { imagen_url?: string | null }).imagen_url,
              }
              setItems([...borradorItems, newItem])
              setView('crear')
            })
            .catch(() => { setItems(borradorItems) })
        } else {
          setItems(borradorItems)
        }
      })
  }, [view, searchParams])

  // ── Mutations ────────────────────────────────────────────────────────────────

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
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      toast.error(msg ?? 'Error al guardar borrador')
    },
  })

  const guardarMutation = useMutation({
    mutationFn: async () => {
      const saveData: UpdateSolicitudRequest = {
        nota: null,
        items: items.map(i => ({
          producto_id: i.producto_id,
          cantidad_sugerida: i.cantidad.toString(),
          unidad: i.unidad_base,
          precio_unitario: i.precio_unitario.toString(),
          presentacion_id: i.presentacion_id,
          cantidad_presentaciones: i.cantidad.toString(),
        })),
      }
      let id = solicitudId
      if (id) {
        await api.put(`/solicitudes-compra/${id}`, saveData)
      } else {
        const res = await api.post('/solicitudes-compra', saveData)
        id = res.data.id
        setSolicitudId(id)
      }
      return api.post(`/solicitudes-compra/${id}/guardar`)
    },
    onSuccess: () => {
      toast.success('Solicitud guardada correctamente')
      setItems([])
      setSolicitudId(null)
      setSelectedProveedor(null)
      borradorCargado.current = false
      setView('historial')
      queryClient.invalidateQueries({ queryKey: ['solicitudes-historial'] })
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      toast.error(msg ?? 'Error al guardar solicitud')
    },
  })

  // ── Actions ──────────────────────────────────────────────────────────────────

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

  const handleAddFromSearch = (p: Producto) => {
    if (items.find(i => i.producto_id === p.id)) {
      toast.error('Producto ya está en la lista')
      return
    }
    // El endpoint /productos devuelve ProductoListItem con campos extra
    type ProductoExt = Producto & {
      imagen_url?: string | null
      unidad_base?: { id: number; nombre: string; nombre_plural: string }
      proveedor?: { id: number; nombre: string; icono?: string | null }
      pres_id?: number | null
      pres_nombre?: string | null
      pres_nombre_plural?: string | null
      pres_factor?: string | null
    }
    const px = p as ProductoExt
    const unidadNombre = px.unidad_base?.nombre ?? 'u'
    const unidadPlural = px.unidad_base?.nombre_plural ?? 'u'
    const presId = px.pres_id ?? null
    const presNombre = px.pres_nombre ?? null
    const presNombrePlural = px.pres_nombre_plural ?? null
    const presFactor = px.pres_factor ? px.pres_factor : null

    const fakeRec: ItemRecomendado = {
      producto_id: p.id,
      producto_nombre: p.nombre,
      codigo_proveedor: p.codigo_proveedor,
      codigo_maestro: p.codigo_maestro,
      proveedor_id: px.proveedor?.id ?? null,
      proveedor_nombre: selectedProveedor?.nombre ?? 'Manual',
      lead_time: p.lead_time_propio || 0,
      autonomia_dias: 0,
      nivel_urgencia: 'normal',
      stock_actual: '0',
      stock_minimo: p.stock_minimo,
      consumo_diario_30d: '0',
      cantidad_sugerida_base: presFactor ?? '1',
      presentacion_id: presId,
      presentacion_nombre: presNombre,
      presentacion_nombre_plural: presNombrePlural,
      factor_conversion: presFactor,
      cantidad_sugerida_presentacion: presId ? '1' : null,
      precio_ultima_recepcion: p.precio_unidad,
      unidad_base: unidadNombre,
      unidad_base_plural: unidadPlural,
      solicitudes_pendientes: 0,
      imagen_url: px.imagen_url ?? null,
    }
    handleAddFromRec(fakeRec)
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
        cantidad_presentaciones: i.cantidad.toString(),
      })),
    }, { onSettled: () => setIsSaving(false) })
  }

  const handleSelectProveedor = (p: Proveedor) => {
    if (items.length > 0) {
      setItems([])
      setSolicitudId(null)
      toast('Lista anterior limpiada', { icon: '↩' })
    }
    setSelectedProveedor(p)
  }

  const handleCambiarProveedor = () => {
    if (items.length > 0) {
      setItems([])
      setSolicitudId(null)
      toast('Lista limpiada al cambiar proveedor', { icon: '↩' })
    }
    setSelectedProveedor(null)
  }

  // ── Detail modal ─────────────────────────────────────────────────────────────

  const { data: detail, isLoading: isLoadingDetail } = useQuery({
    queryKey: ['solicitud-detail', selectedSolicitudId],
    queryFn: () =>
      api.get<SolicitudDetalle>(`/solicitudes-compra/${selectedSolicitudId}`).then(r => r.data),
    enabled: !!selectedSolicitudId,
  })

  // ── Derived data ─────────────────────────────────────────────────────────────

  const recsFiltered = selectedProveedor
    ? (recomendaciones ?? []).filter(r => r.proveedor_id === selectedProveedor.id)
    : []

  const urgenciasByProveedor = (recomendaciones ?? []).reduce<Record<number, { total: number; criticos: number }>>((acc, r) => {
    const pid = r.proveedor_id
    if (pid == null) return acc
    if (!acc[pid]) acc[pid] = { total: 0, criticos: 0 }
    acc[pid].total++
    if (r.nivel_urgencia === 'critica') acc[pid].criticos++
    return acc
  }, {})

  // ─────────────────────────────────────────────────────────────────────────────

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
            <Plus className="h-4 w-4" /> Nueva
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
        selectedProveedor === null ? (
          /* ── PASO 1: Selección de proveedor ─────────────────────────────── */
          <div className="flex-1 flex flex-col gap-6 min-h-0">
            <div className="flex items-center gap-4">
              {configuracion?.logo_base64 && (
                <img
                  src={configuracion.logo_base64}
                  alt="Logo laboratorio"
                  className="h-12 w-auto object-contain rounded-xl"
                />
              )}
              <div>
                <p className="text-base font-bold">¿A qué proveedor vas a pedir?</p>
                <p className="text-sm opacity-40">El pedido se generará exclusivamente con productos de ese proveedor.</p>
              </div>
            </div>

            {isLoadingProveedores ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                {Array(6).fill(0).map((_, i) => <Skeleton key={i} className="h-36 rounded-3xl" />)}
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 overflow-y-auto custom-scrollbar pb-2">
                {(proveedores ?? []).filter(p => p.activa).map(p => (
                  <ProveedorCard
                    key={p.id}
                    proveedor={p}
                    urgencias={urgenciasByProveedor[p.id]?.total ?? 0}
                    criticos={urgenciasByProveedor[p.id]?.criticos ?? 0}
                    onClick={() => handleSelectProveedor(p)}
                  />
                ))}
              </div>
            )}
          </div>
        ) : (
          /* ── PASO 2: Productos del proveedor ────────────────────────────── */
          <div className="flex-1 flex flex-col gap-4 min-h-0">

            {/* Banner proveedor */}
            <div className="flex items-center gap-4 px-5 py-3 bg-primary/5 border border-primary/15 rounded-2xl">
              <div className="w-10 h-10 rounded-xl overflow-hidden shrink-0 flex items-center justify-center bg-base-200 text-2xl">
                {selectedProveedor.icono
                  ? <img src={selectedProveedor.icono} alt={selectedProveedor.nombre} className="h-full w-full object-contain" />
                  : '🏭'}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm">{selectedProveedor.nombre}</p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5">
                  <span className="text-[10px] opacity-40 font-medium uppercase tracking-wide">
                    {recsFiltered.length > 0
                      ? `${recsFiltered.length} quiebre${recsFiltered.length !== 1 ? 's' : ''}`
                      : 'Sin quiebres'}
                  </span>
                  {(selectedProveedor.dias_despacho_tierra || selectedProveedor.dias_despacho_aereo) && (
                    <span className="text-[10px] opacity-40 flex items-center gap-0.5">
                      <Clock className="h-2.5 w-2.5" />
                      {selectedProveedor.dias_despacho_tierra ?? selectedProveedor.dias_despacho_aereo}d despacho
                    </span>
                  )}
                  {selectedProveedor.contacto && (
                    <span className="text-[10px] opacity-40 truncate">👤 {selectedProveedor.contacto}</span>
                  )}
                  {selectedProveedor.telefono && (
                    <span className="text-[10px] opacity-40 flex items-center gap-0.5">
                      <Phone className="h-2.5 w-2.5" /> {selectedProveedor.telefono}
                    </span>
                  )}
                  {selectedProveedor.email && (
                    <span className="text-[10px] opacity-40 flex items-center gap-0.5">
                      <Mail className="h-2.5 w-2.5" /> {selectedProveedor.email}
                    </span>
                  )}
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="rounded-xl h-8 gap-1.5 text-xs shrink-0"
                onClick={handleCambiarProveedor}
              >
                <ChevronLeft className="h-3.5 w-3.5" /> Cambiar
              </Button>
            </div>

            {/* Panel dual */}
            <div className="flex-1 flex flex-col lg:flex-row gap-6 min-h-0">

              {/* IZQUIERDO: Buscador + Recomendaciones */}
              <div className="w-full lg:w-[320px] flex flex-col gap-4 min-w-0 min-h-0 shrink-0">

                <SolicitudBuscador
                  proveedorId={selectedProveedor.id}
                  monedaCodigo={monedaCodigo}
                  excluidos={items.map(i => i.producto_id)}
                  onAdd={handleAddFromSearch}
                />

                {/* Recomendaciones — siempre visibles */}
                <div className="flex-1 flex flex-col bg-base-100 rounded-[2rem] border border-base-300 shadow-sm overflow-hidden min-h-[200px]">
                  <div className="px-5 py-4 border-b border-base-200 flex items-center gap-3 bg-base-200/20">
                    <ClipboardCheck className="h-4 w-4 text-primary" />
                    <h2 className="font-bold text-sm">Quiebres de Stock</h2>
                    {recsFiltered.length > 0 && (
                      <span className="badge badge-primary badge-sm font-bold">{recsFiltered.length}</span>
                    )}
                  </div>

                  <div className="flex-1 overflow-y-auto p-4 space-y-2.5 custom-scrollbar">
                    {isLoadingRecs ? (
                      Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-2xl" />)
                    ) : recsFiltered.length === 0 ? (
                      <div className="h-full flex flex-col items-center justify-center opacity-30 text-center p-8">
                        <CheckCircle2 className="h-10 w-10 mb-3 stroke-[1.5px]" />
                        <p className="font-bold text-sm">¡Todo al día!</p>
                        <p className="text-xs">No hay quiebres de stock para {selectedProveedor.nombre}.</p>
                      </div>
                    ) : (
                      recsFiltered.map(r => {
                        const alreadyAdded = items.some(i => i.producto_id === r.producto_id)
                        return (
                          <div
                            key={r.producto_id}
                            className={cn(
                              "group flex items-center gap-3 p-3.5 rounded-2xl border transition-all duration-200",
                              alreadyAdded
                                ? "bg-base-200/40 opacity-50 border-transparent"
                                : "bg-base-100 border-base-200 hover:border-primary/40 hover:shadow-sm"
                            )}
                          >
                            <div className={cn(
                              "w-1 h-10 rounded-full flex-shrink-0",
                              r.nivel_urgencia === 'critica' ? 'bg-error' : r.nivel_urgencia === 'alta' ? 'bg-warning' : 'bg-primary'
                            )} />

                            <div className="flex-1 min-w-0">
                              <h3 className="font-bold text-sm truncate">{r.producto_nombre}</h3>
                              <span className="text-[10px] opacity-40 font-bold uppercase tracking-wider">
                                Stock: {parseFloat(r.stock_actual)} / {parseFloat(r.stock_minimo)}
                              </span>
                            </div>

                            <div className="text-right flex-shrink-0">
                              <p className="text-[9px] font-bold opacity-40 uppercase leading-none mb-0.5">Sugerido</p>
                              <p className="font-black text-primary text-xs">
                                {r.cantidad_sugerida_presentacion
                                  ? `${Math.ceil(parseFloat(r.cantidad_sugerida_presentacion))} ${r.presentacion_nombre_plural || r.presentacion_nombre}`
                                  : `${Math.ceil(parseFloat(r.cantidad_sugerida_base))} ${r.unidad_base_plural || r.unidad_base}`}
                              </p>
                            </div>

                            <button
                              className="btn btn-primary btn-sm btn-circle rounded-xl shadow-sm shadow-primary/20 scale-90 active:scale-75 transition-all flex-shrink-0"
                              onClick={() => handleAddFromRec(r)}
                              disabled={alreadyAdded}
                            >
                              <Plus className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        )
                      })
                    )}
                  </div>
                </div>
              </div>

              {/* DERECHO: Pedido */}
              <div className="flex-1 flex flex-col bg-base-100 rounded-[2.5rem] border border-base-300 shadow-2xl overflow-hidden relative min-w-0">
                <div className="px-7 py-6 border-b border-base-200 flex items-center justify-between bg-primary/5">
                  <div className="flex items-center gap-4">
                    <div className="p-2.5 bg-primary text-primary-content rounded-2xl shadow-lg">
                      <ShoppingCart className="h-5 w-5" />
                    </div>
                    <div>
                      <h2 className="text-base font-bold leading-tight">
                        Pedido a {selectedProveedor.nombre}
                      </h2>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-primary/60">
                        {items.length} {items.length === 1 ? 'producto' : 'productos'}
                      </p>
                    </div>
                  </div>
                  {solicitudId && (
                    <Badge className="bg-success/10 text-success border-success/20 px-2.5 py-1 text-[10px]">
                      Guardado
                    </Badge>
                  )}
                </div>

                <div className="flex-1 overflow-y-auto p-5 space-y-3 custom-scrollbar">
                  {items.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center opacity-25 p-8">
                      <div className="w-16 h-16 bg-base-200 rounded-full flex items-center justify-center mb-4">
                        <Plus className="h-8 w-8" />
                      </div>
                      <p className="font-bold">Lista vacía</p>
                      <p className="text-xs mt-1">Agrega desde las sugerencias o el buscador.</p>
                    </div>
                  ) : (
                    items.map(item => (
                      <div key={item.producto_id} className="flex items-center gap-3 px-3 py-2.5 bg-base-200/40 hover:bg-base-200/60 border border-transparent hover:border-primary/15 transition-all rounded-2xl group">
                        {item.imagen_url && (
                          <ProductoImage src={item.imagen_url} size="sm" className="shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <h4 className="font-semibold text-xs leading-tight truncate">{item.producto_nombre}</h4>
                          <div className="flex items-center gap-1.5 mt-1">
                            <div className="flex items-center bg-base-100 rounded-lg border border-base-300 p-0.5 shadow-inner">
                              <button
                                className="btn btn-ghost btn-xs btn-circle h-5 w-5 min-h-0"
                                onClick={() => handleUpdateQty(item.producto_id, item.cantidad - 1)}
                              >
                                <Minus className="h-2.5 w-2.5" />
                              </button>
                              <input
                                type="number"
                                className="w-8 text-center text-xs font-black bg-transparent focus:outline-none"
                                value={item.cantidad}
                                onChange={e => handleUpdateQty(item.producto_id, parseInt(e.target.value) || 1)}
                              />
                              <button
                                className="btn btn-ghost btn-xs btn-circle h-5 w-5 min-h-0"
                                onClick={() => handleUpdateQty(item.producto_id, item.cantidad + 1)}
                              >
                                <Plus className="h-2.5 w-2.5" />
                              </button>
                            </div>
                            <span className="text-[10px] font-bold text-primary">{unidadLabel(item, item.cantidad)}</span>
                            {equivalenciaBase(item) && (
                              <span className="text-[9px] opacity-40">{equivalenciaBase(item)}</span>
                            )}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          {item.presentacion_id && item.factor_conversion ? (
                            <>
                              <p className="text-xs font-bold font-mono">
                                {fmt(item.precio_unitario * item.factor_conversion)} / {item.presentacion_nombre ?? 'pres.'}
                              </p>
                              <p className="text-[9px] opacity-35">
                                ({formatCantidad(item.factor_conversion, item.unidad_base, item.unidad_base_plural ?? undefined)})
                              </p>
                            </>
                          ) : (
                            <p className="text-xs font-bold font-mono">
                              {fmt(item.precio_unitario)} / {item.unidad_base}
                            </p>
                          )}
                        </div>
                        <button
                          className="btn btn-ghost btn-xs btn-circle text-error opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                          onClick={() => handleRemove(item.producto_id)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    ))
                  )}
                </div>

                <div className="p-6 bg-base-200/50 border-t border-base-300 space-y-3">
                  <div className="flex justify-between items-center px-1">
                    <span className="opacity-40 uppercase tracking-widest text-[9px] font-bold">Costo Estimado</span>
                    <span className="text-lg font-black flex items-center gap-1.5">
                      {fmt(items.reduce((acc, i) => acc + i.cantidad * (i.presentacion_id && i.factor_conversion ? i.precio_unitario * i.factor_conversion : i.precio_unitario), 0))}
                      <span className="badge badge-ghost badge-xs font-mono">{monedaCodigo}</span>
                    </span>
                  </div>

                  <div className="flex flex-col gap-2">
                    <Button
                      className="rounded-2xl h-11 font-bold gap-2 shadow-lg shadow-primary/20 w-full"
                      disabled={items.length === 0 || guardarMutation.isPending}
                      onClick={() => guardarMutation.mutate()}
                    >
                      {guardarMutation.isPending
                        ? <span className="loading loading-spinner loading-sm" />
                        : <><CheckCircle2 className="h-4 w-4" /> Guardar solicitud</>
                      }
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="rounded-xl h-8 text-xs font-medium w-full opacity-60 hover:opacity-100"
                      onClick={handleSaveBorrador}
                      disabled={items.length === 0 || isSaving}
                    >
                      {isSaving ? <span className="loading loading-spinner loading-xs" /> : 'Guardar borrador'}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )
      ) : (
        /* ── VISTA HISTORIAL ──────────────────────────────────────────────── */
        <div className="flex-1 bg-base-100 rounded-[2rem] border border-base-300 shadow-sm overflow-hidden flex flex-col">
          <div className="p-6 border-b border-base-200 bg-base-200/20 flex items-center gap-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 opacity-30" />
              <Input
                placeholder="Buscar por número de documento..."
                className="pl-10 h-10 rounded-xl"
                value={historialSearch}
                onChange={e => setHistorialSearch(e.target.value)}
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar">
            {isLoadingHistorial ? (
              <div className="p-10 text-center">
                <span className="loading loading-spinner loading-lg text-primary opacity-20" />
              </div>
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
                      <tr
                        key={s.id}
                        className="hover:bg-primary/5 transition-colors cursor-pointer group"
                        onClick={() => setSelectedSolicitudId(s.id)}
                      >
                        <td className="font-bold text-sm">{s.numero_documento}</td>
                        <td className="text-xs opacity-60">{formatDate(s.fecha_creacion)}</td>
                        <td className="text-xs font-medium">
                          <div className="flex items-center gap-2">
                            <User className="h-3 w-3" /> {s.usuario_nombre}
                          </div>
                        </td>
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

      {/* ── MODAL DETALLE ─────────────────────────────────────────────────── */}
      {!!selectedSolicitudId && <Dialog
        open={!!selectedSolicitudId}
        onClose={() => setSelectedSolicitudId(null)}
        title={`Detalle Solicitud ${detail?.numero_documento || ''}`}
        className="max-w-4xl"
      >
        {isLoadingDetail ? (
          <div className="py-20 text-center"><span className="loading loading-spinner loading-lg" /></div>
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
                    const fc = item.factor_conversion ? parseFloat(item.factor_conversion) : null
                    const hasPres = !!(item.presentacion_id && fc)
                    const puBase = item.precio_unitario ? parseFloat(item.precio_unitario) : 0
                    const precioUnit = hasPres ? puBase * fc! : puBase
                    return (
                      <tr key={idx}>
                        <td className="font-bold text-xs">{item.producto_nombre}</td>
                        <td className="text-[10px] opacity-60">{item.proveedor_nombre}</td>
                        <td className="text-center font-bold">{cant}</td>
                        <td className="text-[10px] uppercase font-bold opacity-50">{item.presentacion_nombre || item.unidad}</td>
                        <td className="text-right font-mono text-[11px]">{fmt(precioUnit)}</td>
                        <td className="text-right font-bold text-xs">{fmt(cant * precioUnit)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {detail.nota && (
              <div className="p-4 bg-primary/5 rounded-2xl border border-primary/10">
                <p className="text-[10px] font-black uppercase opacity-40 mb-1">Nota</p>
                <p className="text-sm italic">"{detail.nota}"</p>
              </div>
            )}

            {/* Configurador de firma */}
            <div className="p-4 bg-base-200/50 rounded-2xl border border-base-300 space-y-3">
              <p className="text-[10px] font-black uppercase tracking-widest opacity-40 flex items-center gap-1.5">
                <FileDown className="h-3 w-3" /> Configurar firma del PDF
              </p>
              <div className="space-y-1 max-w-xs">
                <label className="text-[10px] font-bold opacity-50">Nombre solicitante</label>
                <Input
                  placeholder={detail?.usuario_nombre ?? 'Auto-detectado'}
                  value={pdfFirmaLabel}
                  onChange={e => setPdfFirmaLabel(e.target.value)}
                  className="h-8 rounded-xl text-xs"
                />
              </div>
            </div>

            <div className="flex justify-between items-center pt-2 border-t">
              <div className="text-xl font-black flex items-center gap-2">
                <span className="text-xs opacity-40 font-bold uppercase mr-1">Total Estimado:</span>
                {fmt(detail.items.reduce((acc, i) => {
                  const qty = parseFloat(i.cantidad_sugerida)
                  const fc = i.factor_conversion ? parseFloat(i.factor_conversion) : null
                  const pu = i.precio_unitario ? parseFloat(i.precio_unitario) : 0
                  return acc + qty * (i.presentacion_id && fc ? pu * fc : pu)
                }, 0))}
                <span className="badge badge-ghost badge-xs font-mono">{monedaCodigo}</span>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="rounded-xl h-10 gap-2"
                  onClick={() => {
                    const subtotal = detail.items.reduce((acc, i) => {
                      const qty = parseFloat(i.cantidad_sugerida)
                      const fc = i.factor_conversion ? parseFloat(i.factor_conversion) : null
                      const pu = i.precio_unitario ? parseFloat(i.precio_unitario) : 0
                      return acc + qty * (i.presentacion_id && fc ? pu * fc : pu)
                    }, 0)
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
                      firma_solicitante_label: pdfFirmaLabel || null,
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
                      })),
                    })
                  }}
                >
                  <FileDown className="h-4 w-4" /> PDF
                </Button>
                <Button className="rounded-xl h-10" onClick={() => setSelectedSolicitudId(null)}>Cerrar</Button>
              </div>
            </div>
          </div>
        )}
      </Dialog>}
    </div>
  )
}
