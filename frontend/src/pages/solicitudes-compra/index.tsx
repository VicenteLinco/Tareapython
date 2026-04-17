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

function calcularCantidad(
  horizonte: number,
  consumoDiario: number,
  leadTime: number,
  stockMinimo: number,
  stockActual: number,
): number {
  return Math.max(1, Math.ceil(
    stockMinimo + consumoDiario * (leadTime + horizonte) - stockActual
  ))
}

async function fetchHorizonte(productoId: string, proveedorId: number | null) {
  if (!proveedorId) {
    return { horizonte_sugerido: 30, razon: 'sin proveedor — estimación por defecto', consumo_diario: 0, stock_actual: 0, stock_minimo: 0 }
  }
  const res = await api.get<{
    horizonte_sugerido: number
    razon: string
    consumo_diario: number
    stock_actual: number
    stock_minimo: number
  }>('/solicitudes-compra/horizonte', {
    params: { producto_id: productoId, proveedor_id: proveedorId }
  })
  return res.data
}

function unidadLabel(item: SolicitudItem, qty: number): string {
  if (item.presentacion_nombre) {
    return formatCantidad(qty, item.presentacion_nombre, item.presentacion_nombre_plural ?? undefined).replace(/^[\d.,\s]+/, '').trim()
  }
  return formatCantidad(qty, item.unidad_base, item.unidad_base_plural ?? undefined).replace(/^[\d.,\s]+/, '').trim()
}

function formatPesos(val: number | string | null, monedaCodigo = 'CLP'): string {
  if (val === null) return '$0'
  const n = typeof val === 'string' ? parseFloat(val) : val
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: monedaCodigo }).format(n)
}

// ─── Pill de cobertura ───────────────────────────────────────────────────────

const HORIZONTE_CHIPS = [7, 15, 30, 90, 180, 365] as const

function calcularDiasCubiertos(item: SolicitudItem): number | null {
  if (item.consumo_diario <= 0) return null
  const unidadesBase = item.factor_conversion
    ? item.cantidad * item.factor_conversion
    : item.cantidad
  return Math.round(unidadesBase / item.consumo_diario)
}

function pillClasses(dias: number | null, personalizado: boolean): string {
  if (personalizado) return 'bg-purple-500/10 text-purple-300 border-purple-500/30'
  if (dias === null) return 'bg-base-200 text-base-content/40 border-base-300'
  if (dias < 15)  return 'bg-error/10 text-error border-error/30'
  if (dias < 30)  return 'bg-warning/10 text-warning border-warning/30'
  if (dias < 90)  return 'bg-success/10 text-success border-success/30'
  return 'bg-info/10 text-info border-info/30'
}

function pillText(dias: number | null, personalizado: boolean): string {
  if (dias === null) return '📅 Sin historial'
  return personalizado ? `📌 ~${dias} días` : `📅 ~${dias} días`
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

  // Horizonte global + UI izquierda
  const [horizonteGlobal, setHorizonteGlobal] = useState<number>(30)
  const [tabIzquierdo, setTabIzquierdo] = useState<'quiebres' | 'buscar'>('buscar')
  const [popoverOpenId, setPopoverOpenId] = useState<string | null>(null)
  const [restaurando, setRestaurando] = useState(true)

  // Prevent borrador from reloading after it's been intentionally cleared
  const borradorCargado = useRef(false)

  // Restauración diferida del proveedor cuando borrador carga antes que la lista de proveedores
  const [pendingProveedorId, setPendingProveedorId] = useState<number | null>(null)

  // Sync view from navigation state
  useEffect(() => {
    if (location.state?.view) setView(location.state.view)
  }, [location.state])

  // Cerrar popover al hacer click fuera
  useEffect(() => {
    if (!popoverOpenId) return
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('[data-popover-item]')) setPopoverOpenId(null)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [popoverOpenId])

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

  // Restaurar proveedor guardado cuando la lista de proveedores cargue
  // (debe ir después de la query de proveedores para evitar temporal dead zone)
  useEffect(() => {
    if (!pendingProveedorId || !proveedores || selectedProveedor) return
    const prov = proveedores.find(p => p.id === pendingProveedorId)
    if (prov) {
      setSelectedProveedor(prov)
      setPendingProveedorId(null)
    }
  }, [pendingProveedorId, proveedores, selectedProveedor])

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
          unidad_base_plural: item.unidad_plural ?? autoPlural(item.unidad),
          cantidad: parseFloat(item.cantidad_sugerida),
          precio_unitario: item.precio_unitario ? parseFloat(item.precio_unitario) : 0,
          imagen_url: item.imagen_url,
          consumo_diario: 0,
          stock_actual: 0,
          stock_minimo: 0,
          horizonte_dias: item.horizonte_dias ?? null,
          horizonte_sugerido: item.horizonte_sugerido ?? null,
          horizonte_razon: item.horizonte_razon ?? null,
        })) : []

        if (b) setSolicitudId(b.id)

        // Restaurar proveedor guardado para continuar editando el borrador
        if (borradorItems.length > 0) {
          const savedId = localStorage.getItem('solicitud_proveedor_id')
          if (savedId) setPendingProveedorId(parseInt(savedId))
        }

        if (productoId && !borradorItems.some(i => i.producto_id === productoId)) {
          api.get<Producto>(`/productos/${productoId}`)
            .then(res2 => {
              const p = res2.data
              if (!p) { setItems(borradorItems); setRestaurando(false); return }
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
                consumo_diario: 0,
                stock_actual: 0,
                stock_minimo: 0,
                horizonte_dias: null,
                horizonte_sugerido: null,
                horizonte_razon: null,
              }
              setItems([...borradorItems, newItem])
              setView('crear')
              setRestaurando(false)
            })
            .catch(() => { setItems(borradorItems); setRestaurando(false) })
        } else {
          setItems(borradorItems)
          setRestaurando(false)
        }
      })
      .catch(() => setRestaurando(false))
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
          horizonte_dias: i.horizonte_dias ?? undefined,
          horizonte_sugerido: i.horizonte_sugerido ?? undefined,
          horizonte_razon: i.horizonte_razon ?? undefined,
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
      localStorage.removeItem('solicitud_proveedor_id')
      setView('historial')
      queryClient.invalidateQueries({ queryKey: ['solicitudes-historial'] })
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      toast.error(msg ?? 'Error al guardar solicitud')
    },
  })

  // ── Actions ──────────────────────────────────────────────────────────────────

  const handleAddFromRec = async (r: ItemRecomendado) => {
    if (items.find(i => i.producto_id === r.producto_id)) {
      toast.error('Producto ya está en la lista')
      return
    }
    const proveedorId = r.proveedor_id ?? selectedProveedor?.id ?? null
    const horizData = await fetchHorizonte(r.producto_id, proveedorId)
    const horizonte = horizData.horizonte_sugerido
    const consumoDiario = parseFloat(r.consumo_diario.toString())
    const stockActual = parseFloat(r.stock_actual.toString())
    const stockMinimo = parseFloat(r.stock_seguridad.toString())
    const leadTime = r.lead_time

    const cantidad = calcularCantidad(horizonteGlobal, consumoDiario, leadTime, stockMinimo, stockActual)

    const newItem: SolicitudItem = {
      producto_id: r.producto_id,
      producto_nombre: r.producto_nombre,
      codigo_proveedor: r.codigo_proveedor,
      codigo_maestro: r.codigo_maestro,
      proveedor_id: proveedorId,
      proveedor_nombre: r.proveedor_nombre || 'S/P',
      lead_time: leadTime,
      presentacion_id: r.presentacion_id,
      presentacion_nombre: r.presentacion_nombre,
      presentacion_nombre_plural: r.presentacion_nombre_plural,
      factor_conversion: r.factor_conversion ? parseFloat(r.factor_conversion.toString()) : null,
      unidad_base: r.unidad_base,
      unidad_base_plural: r.unidad_base_plural || autoPlural(r.unidad_base),
      cantidad,
      precio_unitario: r.precio_ultima_recepcion ? parseFloat(r.precio_ultima_recepcion.toString()) : 0,
      imagen_url: r.imagen_url,
      consumo_diario: consumoDiario,
      stock_actual: stockActual,
      stock_minimo: stockMinimo,
      horizonte_dias: horizonteGlobal,
      horizonte_sugerido: horizonte,
      horizonte_razon: horizData.razon,
      horizonte_personalizado: false,
    }
    setItems(prev => [...prev, newItem])
  }

  const handleAddFromSearch = async (p: Producto) => {
    if (items.find(i => i.producto_id === p.id)) {
      toast.error('Producto ya está en la lista')
      return
    }
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
    const proveedorId = px.proveedor?.id ?? selectedProveedor?.id ?? null

    const horizData = await fetchHorizonte(p.id, proveedorId)
    const horizonte = horizData.horizonte_sugerido
    const consumoDiario = horizData.consumo_diario
    const stockActual = horizData.stock_actual
    const stockMinimo = horizData.stock_minimo
    const leadTime = p.lead_time_propio || 0

    const cantidad = calcularCantidad(horizonteGlobal, consumoDiario, leadTime, stockMinimo, stockActual)

    const newItem: SolicitudItem = {
      producto_id: p.id,
      producto_nombre: p.nombre,
      codigo_proveedor: p.codigo_proveedor,
      codigo_maestro: p.codigo_maestro,
      proveedor_id: proveedorId,
      proveedor_nombre: selectedProveedor?.nombre ?? 'Manual',
      lead_time: leadTime,
      presentacion_id: presId,
      presentacion_nombre: presNombre,
      presentacion_nombre_plural: presNombrePlural,
      factor_conversion: presFactor ? parseFloat(presFactor) : null,
      unidad_base: unidadNombre,
      unidad_base_plural: unidadPlural,
      cantidad,
      precio_unitario: p.precio_unidad ? parseFloat(String(p.precio_unidad)) : 0,
      imagen_url: px.imagen_url ?? null,
      consumo_diario: consumoDiario,
      stock_actual: stockActual,
      stock_minimo: stockMinimo,
      horizonte_dias: horizonteGlobal,
      horizonte_sugerido: horizonte,
      horizonte_razon: horizData.razon,
      horizonte_personalizado: false,
    }
    setItems(prev => [...prev, newItem])
  }

  const handleUpdateQty = (pid: string, val: number) => {
    setItems(prev => prev.map(i =>
      i.producto_id === pid
        ? { ...i, cantidad: Math.max(1, val) }
        : i
    ))
  }

  const handleGlobalHorizonteChange = (dias: number) => {
    const conservados = items.filter(i => i.horizonte_personalizado).length
    const recalculados = items.length - conservados

    setHorizonteGlobal(dias)
    setItems(prev => prev.map(i => {
      if (i.horizonte_personalizado) return i
      const nueva = calcularCantidad(dias, i.consumo_diario, i.lead_time, i.stock_minimo, i.stock_actual)
      return { ...i, horizonte_dias: dias, cantidad: nueva }
    }))

    if (items.length === 0) return
    const label = dias >= 365 ? '1 año' : dias >= 180 ? '6 meses' : dias >= 90 ? '3 meses' : `${dias} días`
    if (conservados === items.length) {
      toast.info('Todos los items tienen horizonte personalizado 📌. Ajusta por item para cambiarlos.')
    } else if (conservados > 0) {
      toast.success(`Horizonte actualizado a ${label}. ${recalculados} recalculados, ${conservados} con horizonte personalizado 📌.`)
    } else {
      toast.success(`Horizonte actualizado a ${label}. ${recalculados} ${recalculados === 1 ? 'item recalculado' : 'items recalculados'}.`)
    }
  }

  const handleHorizonteChip = (pid: string, dias: number) => {
    setItems(prev => prev.map(i => {
      if (i.producto_id !== pid) return i
      const nueva = calcularCantidad(dias, i.consumo_diario, i.lead_time, i.stock_minimo, i.stock_actual)
      return { ...i, horizonte_dias: dias, cantidad: nueva, horizonte_personalizado: dias !== horizonteGlobal }
    }))
    setPopoverOpenId(null)
  }

  const handleResetHorizonteToGlobal = (pid: string) => {
    setItems(prev => prev.map(i => {
      if (i.producto_id !== pid) return i
      const nueva = calcularCantidad(horizonteGlobal, i.consumo_diario, i.lead_time, i.stock_minimo, i.stock_actual)
      return { ...i, horizonte_dias: horizonteGlobal, cantidad: nueva, horizonte_personalizado: false }
    }))
    setPopoverOpenId(null)
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
        horizonte_dias: i.horizonte_dias ?? undefined,
        horizonte_sugerido: i.horizonte_sugerido ?? undefined,
        horizonte_razon: i.horizonte_razon ?? undefined,
      })),
    }, { onSettled: () => setIsSaving(false) })
  }

  const handleSelectProveedor = (p: Proveedor) => {
    if (items.length > 0) {
      setItems([])
      setSolicitudId(null)
      toast('Lista anterior limpiada', { icon: '↩' })
    }
    localStorage.setItem('solicitud_proveedor_id', String(p.id))
    setSelectedProveedor(p)
  }

  const handleCambiarProveedor = () => {
    if (items.length > 0) {
      setItems([])
      setSolicitudId(null)
      toast('Lista limpiada al cambiar proveedor', { icon: '↩' })
    }
    localStorage.removeItem('solicitud_proveedor_id')
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

      {view === 'crear' && restaurando ? (
        /* ── Skeleton de restauración de borrador ─────────────────────────── */
        <div className="flex-1 grid grid-cols-[30%_1fr] gap-4 min-h-0 animate-pulse">
          <div className="bg-base-200/60 rounded-[2rem]" />
          <div className="flex flex-col gap-3">
            <div className="h-16 bg-base-200/60 rounded-2xl" />
            <div className="flex-1 bg-base-200/60 rounded-[2.5rem]" />
          </div>
        </div>
      ) : view === 'crear' ? (
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
            <div className="flex items-center gap-4 px-5 py-3 bg-primary/5 border border-primary/15 rounded-2xl shrink-0">
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

            {/* Panel dual 30/70 */}
            <div className="flex-1 grid grid-cols-[30%_1fr] gap-4 min-h-0">

              {/* IZQUIERDO 30%: Tabs Quiebres / Buscar */}
              <div className="flex flex-col bg-base-100 rounded-[2rem] border border-base-300 shadow-sm overflow-hidden min-h-0">

                {/* Segmented tab control */}
                <div className="shrink-0 p-2.5 border-b border-base-200">
                  <div className="flex bg-base-200/70 rounded-xl p-0.5 gap-0.5">

                    {/* Tab Buscar — primero y predeterminado */}
                    <button
                      onClick={() => setTabIzquierdo('buscar')}
                      className={cn(
                        "flex-1 py-2 text-[11px] font-bold rounded-[10px] transition-all flex items-center justify-center gap-1.5",
                        tabIzquierdo === 'buscar'
                          ? "bg-base-100 text-base-content shadow-sm"
                          : "text-base-content/40 hover:text-base-content/60"
                      )}
                    >
                      <Search className="h-3 w-3" />
                      Buscar
                    </button>

                    {/* Tab Quiebres — deshabilitado si no hay */}
                    {recsFiltered.length === 0 ? (
                      <div className="flex-1 py-2 text-[11px] font-bold rounded-[10px] flex items-center justify-center gap-1.5 text-base-content/20 cursor-not-allowed select-none">
                        <span>⚠</span>
                        Sin quiebres
                      </div>
                    ) : (
                      <button
                        onClick={() => setTabIzquierdo('quiebres')}
                        className={cn(
                          "relative flex-1 py-2 text-[11px] font-bold rounded-[10px] transition-all flex items-center justify-center gap-1.5",
                          tabIzquierdo === 'quiebres'
                            ? "bg-warning/15 text-warning shadow-sm"
                            : "bg-warning/8 text-warning hover:bg-warning/20"
                        )}
                      >
                        {/* Pulso de atención */}
                        {tabIzquierdo !== 'quiebres' && (
                          <span className="absolute inset-0 rounded-[10px] animate-ping bg-warning/20 pointer-events-none" />
                        )}
                        <span>⚠</span>
                        Quiebres
                        <span className={cn(
                          "text-[9px] font-black min-w-[16px] h-4 flex items-center justify-center rounded-full px-1.5",
                          tabIzquierdo === 'quiebres'
                            ? "bg-warning text-warning-content"
                            : "bg-warning text-warning-content animate-pulse"
                        )}>
                          {recsFiltered.length}
                        </span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Contenido según tab */}
                {tabIzquierdo === 'buscar' ? (
                  <div className="p-3 overflow-visible">
                    <SolicitudBuscador
                      proveedorId={selectedProveedor.id}
                      monedaCodigo={monedaCodigo}
                      excluidos={items.map(i => i.producto_id)}
                      onAdd={handleAddFromSearch}
                    />
                  </div>
                ) : (
                  <div className="flex-1 overflow-y-auto p-2.5 space-y-2 custom-scrollbar min-h-0">
                    {isLoadingRecs ? (
                      Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-20 rounded-2xl" />)
                    ) : recsFiltered.length === 0 ? (
                      <div className="h-full flex flex-col items-center justify-center opacity-30 text-center p-6 gap-3">
                        <div className="w-10 h-10 rounded-2xl bg-base-200 flex items-center justify-center">
                          <CheckCircle2 className="h-5 w-5 stroke-[1.5px]" />
                        </div>
                        <div>
                          <p className="font-bold text-xs">¡Todo al día!</p>
                          <p className="text-[10px] mt-0.5">Sin quiebres para {selectedProveedor.nombre}.</p>
                        </div>
                      </div>
                    ) : (
                      recsFiltered.map(r => {
                        const alreadyAdded = items.some(i => i.producto_id === r.producto_id)
                        const isCritica = r.nivel_urgencia === 'critica'
                        const isAlta = r.nivel_urgencia === 'alta'
                        return (
                          <div
                            key={r.producto_id}
                            className={cn(
                              "relative flex flex-col gap-2 p-3 pl-4 rounded-2xl border transition-all overflow-hidden",
                              alreadyAdded
                                ? "opacity-40 bg-base-200/30 border-transparent"
                                : isCritica
                                  ? "bg-error/5 border-error/20 hover:border-error/40"
                                  : isAlta
                                    ? "bg-warning/5 border-warning/20 hover:border-warning/40"
                                    : "bg-base-100 border-base-200 hover:border-primary/30"
                            )}
                          >
                            {/* Accent bar */}
                            <div className={cn(
                              "absolute left-0 inset-y-0 w-[3px]",
                              isCritica ? 'bg-error' : isAlta ? 'bg-warning' : 'bg-primary/40'
                            )} />

                            {/* Nombre + badge urgencia */}
                            <div className="flex items-start justify-between gap-1">
                              <p className="font-bold text-[11px] leading-snug line-clamp-2 flex-1 min-w-0">
                                {r.producto_nombre}
                              </p>
                              {!alreadyAdded && (isCritica || isAlta) && (
                                <span className={cn(
                                  "shrink-0 text-[8px] font-black uppercase px-1.5 py-0.5 rounded-full leading-tight",
                                  isCritica ? "bg-error/15 text-error" : "bg-warning/15 text-warning"
                                )}>
                                  {isCritica ? "crítico" : "alta"}
                                </span>
                              )}
                            </div>

                            {/* Stats */}
                            {(() => {
                              const yaPedido = parseFloat(r.ya_pedido_unidades)
                              const sugBase = parseFloat(r.cantidad_sugerida_base)
                              const sugLabel = r.cantidad_sugerida_presentacion
                                ? `${Math.ceil(parseFloat(r.cantidad_sugerida_presentacion))} ${r.presentacion_nombre_plural || r.presentacion_nombre}`
                                : `${Math.ceil(sugBase)} ${r.unidad_base_plural || r.unidad_base}`
                              const unidadEnCamino = r.unidad_base_plural || r.unidad_base
                              const cubierto = yaPedido > 0 && sugBase === 0
                              return (
                                <>
                                  <div className="flex items-center justify-between">
                                    <p className={cn(
                                      "text-[9px] font-medium tabular-nums",
                                      parseFloat(r.stock_actual) === 0 ? "text-error font-bold" : "text-base-content/40"
                                    )}>
                                      Stock: {parseFloat(r.stock_actual)} / {parseFloat(r.stock_seguridad)}
                                    </p>
                                    {yaPedido === 0 && (
                                      <p className="text-[9px] text-base-content/35 font-medium">
                                        Sug: {sugLabel}
                                      </p>
                                    )}
                                  </div>

                                  {/* En camino */}
                                  {yaPedido > 0 && (
                                    <div className={cn(
                                      "flex items-center gap-1.5 text-[9px] font-bold rounded-lg px-2 py-1",
                                      cubierto
                                        ? "bg-success/10 text-success border border-success/20"
                                        : "bg-info/10 text-info border border-info/20"
                                    )}>
                                      <span>📦</span>
                                      <span className="tabular-nums">{Math.round(yaPedido)} {unidadEnCamino} en camino</span>
                                      <span className="ml-auto font-medium opacity-70 shrink-0">
                                        {cubierto ? '✓ cubierto' : `+ ${sugLabel} sug.`}
                                      </span>
                                    </div>
                                  )}
                                </>
                              )
                            })()}

                            {/* Botón agregar */}
                            <button
                              className={cn(
                                "btn btn-xs w-full rounded-xl gap-1 text-[10px] font-bold transition-all",
                                alreadyAdded
                                  ? "btn-ghost cursor-default text-success pointer-events-none"
                                  : isCritica
                                    ? "bg-error/10 text-error border border-error/30 hover:bg-error hover:text-white hover:border-error"
                                    : "btn-primary shadow-sm shadow-primary/20"
                              )}
                              onClick={() => !alreadyAdded && handleAddFromRec(r)}
                              disabled={alreadyAdded}
                            >
                              {alreadyAdded
                                ? <><CheckCircle2 className="h-3 w-3" /> Agregado</>
                                : <><Plus className="h-3 w-3" /> Agregar</>
                              }
                            </button>
                          </div>
                        )
                      })
                    )}
                  </div>
                )}
              </div>

              {/* DERECHO 70%: Pedido */}
              <div className="flex flex-col bg-base-100 rounded-[2.5rem] border border-base-300 shadow-2xl overflow-hidden relative min-w-0 min-h-0">
                <div className="px-4 py-3 border-b border-base-200 bg-primary/5 space-y-2 shrink-0">
                  {/* Título + horizonte en la misma fila */}
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="p-1.5 bg-primary text-primary-content rounded-xl shadow-md shrink-0">
                        <ShoppingCart className="h-3.5 w-3.5" />
                      </div>
                      <div className="min-w-0">
                        <h2 className="text-xs font-bold leading-tight truncate">
                          Pedido · {selectedProveedor.nombre}
                        </h2>
                        <p className="text-[9px] font-bold uppercase tracking-widest text-primary/50">
                          {items.length} {items.length === 1 ? 'producto' : 'productos'}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {solicitudId && (
                        <Badge className="bg-success/10 text-success border-success/20 px-2 py-0.5 text-[9px]">
                          Guardado
                        </Badge>
                      )}
                    </div>
                  </div>
                  {/* Selector de horizonte global */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[9px] font-bold opacity-35 uppercase tracking-wider shrink-0">Cubrir:</span>
                    {HORIZONTE_CHIPS.map(d => (
                      <button
                        key={d}
                        onClick={() => handleGlobalHorizonteChange(d)}
                        className={cn(
                          "px-2 py-0.5 rounded-full text-[9px] font-bold border transition-all",
                          horizonteGlobal === d
                            ? "bg-primary text-primary-content border-primary shadow-sm"
                            : "bg-base-100 text-base-content/50 border-base-300 hover:border-primary/40 hover:text-primary"
                        )}
                      >
                        {d >= 365 ? '1 año' : d >= 180 ? '6m' : d >= 90 ? '3m' : `${d}d`}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-3 space-y-1 custom-scrollbar min-h-0">
                  {items.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center opacity-25 p-8 gap-3">
                      <div className="w-12 h-12 bg-base-200 rounded-full flex items-center justify-center">
                        <Plus className="h-6 w-6" />
                      </div>
                      <div>
                        <p className="font-bold text-sm">Lista vacía</p>
                        <p className="text-xs mt-0.5">Agrega desde las sugerencias o el buscador.</p>
                      </div>
                    </div>
                  ) : (
                    items.map(item => {
                      const diasCubiertos = calcularDiasCubiertos(item)
                      const esPersonalizado = item.horizonte_personalizado === true
                      const popoverAbierto = popoverOpenId === item.producto_id
                      return (
                        <div key={item.producto_id} className="flex items-center gap-2 px-3 py-1.5 hover:bg-base-200/50 border border-transparent hover:border-primary/10 transition-all rounded-xl group">
                          {/* Imagen opcional */}
                          {item.imagen_url && (
                            <ProductoImage src={item.imagen_url} size="sm" className="shrink-0" />
                          )}

                          {/* Nombre — ocupa el espacio disponible y trunca */}
                          <span className="flex-1 min-w-0 font-medium text-xs truncate">
                            {item.producto_nombre}
                          </span>

                          {/* Pill de cobertura con popover */}
                          <div className="relative shrink-0" data-popover-item>
                            <button
                              onClick={() => setPopoverOpenId(popoverAbierto ? null : item.producto_id)}
                              className={cn(
                                "text-[10px] font-bold border rounded-full px-2.5 py-1 whitespace-nowrap transition-all hover:opacity-80",
                                pillClasses(diasCubiertos, esPersonalizado)
                              )}
                            >
                              {pillText(diasCubiertos, esPersonalizado)}
                            </button>
                            {popoverAbierto && (
                              <div className="absolute top-full right-0 mt-1.5 z-50 bg-base-100 border border-base-300 rounded-2xl shadow-2xl p-3 min-w-[220px]">
                                <p className="text-[10px] font-bold opacity-60 uppercase tracking-wider mb-2">
                                  Ajustar horizonte
                                </p>
                                <div className="flex flex-wrap gap-1.5 mb-2">
                                  {HORIZONTE_CHIPS.map(d => (
                                    <button
                                      key={d}
                                      onClick={() => handleHorizonteChip(item.producto_id, d)}
                                      className={cn(
                                        "px-2.5 py-1 rounded-full text-[10px] font-bold border transition-all",
                                        item.horizonte_dias === d
                                          ? "bg-primary text-primary-content border-primary"
                                          : "bg-base-100 text-base-content/50 border-base-300 hover:border-primary/40"
                                      )}
                                    >
                                      {d >= 365 ? '1 año' : d >= 180 ? '6m' : d >= 90 ? '3m' : `${d}d`}
                                      {d === horizonteGlobal && item.horizonte_dias !== d && (
                                        <span className="ml-1 opacity-50 text-[8px]">global</span>
                                      )}
                                    </button>
                                  ))}
                                </div>
                                {esPersonalizado && (
                                  <button
                                    onClick={() => handleResetHorizonteToGlobal(item.producto_id)}
                                    className="text-[10px] text-primary hover:underline w-full text-left opacity-70"
                                  >
                                    ↩ Usar global ({horizonteGlobal}d)
                                  </button>
                                )}
                              </div>
                            )}
                          </div>

                          {/* Control de cantidad */}
                          <div className="flex items-center bg-base-100 rounded-lg border border-base-300 p-0.5 shadow-inner shrink-0">
                            <button
                              className="btn btn-ghost btn-xs btn-circle h-5 w-5 min-h-0"
                              onClick={() => handleUpdateQty(item.producto_id, item.cantidad - 1)}
                            >
                              <Minus className="h-2.5 w-2.5" />
                            </button>
                            <input
                              type="number"
                              className="w-9 text-center text-xs font-black bg-transparent focus:outline-none no-spinners"
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

                          {/* Unidad */}
                          <span className="text-[10px] font-bold text-primary w-14 truncate shrink-0">
                            {unidadLabel(item, item.cantidad)}
                          </span>

                          {/* Precio por unidad */}
                          <div className="text-right w-24 shrink-0">
                            {item.presentacion_id && item.factor_conversion ? (
                              <>
                                <p className="text-[10px] font-bold font-mono truncate">
                                  {item.precio_unitario > 0
                                    ? `${fmt(item.precio_unitario * item.factor_conversion)} / ${item.presentacion_nombre ?? 'pres.'}`
                                    : <span className="opacity-30">—</span>
                                  }
                                </p>
                                <p className="text-[9px] opacity-35 truncate">
                                  {formatCantidad(item.factor_conversion, item.unidad_base, item.unidad_base_plural ?? undefined)}
                                </p>
                              </>
                            ) : (
                              <p className="text-[10px] font-bold font-mono truncate">
                                {item.precio_unitario > 0
                                  ? `${fmt(item.precio_unitario)} / ${item.unidad_base}`
                                  : <span className="opacity-30">—</span>
                                }
                              </p>
                            )}
                          </div>

                          {/* Eliminar */}
                          <button
                            className="btn btn-ghost btn-xs btn-circle text-error opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                            onClick={() => handleRemove(item.producto_id)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      )
                    })
                  )}
                </div>

                <div className="px-4 py-3 bg-base-200/50 border-t border-base-300 space-y-2.5 shrink-0">
                  <div className="flex justify-between items-center">
                    <span className="opacity-40 uppercase tracking-widest text-[9px] font-bold">Costo Estimado</span>
                    <span className="text-base font-black flex items-center gap-1.5">
                      {fmt(items.reduce((acc, i) => acc + i.cantidad * (i.presentacion_id && i.factor_conversion ? i.precio_unitario * i.factor_conversion : i.precio_unitario), 0))}
                      <span className="badge badge-ghost badge-xs font-mono">{monedaCodigo}</span>
                    </span>
                  </div>

                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="rounded-xl h-9 text-xs font-medium px-3 opacity-50 hover:opacity-100 shrink-0"
                      onClick={handleSaveBorrador}
                      disabled={items.length === 0 || isSaving}
                      title="Guarda el progreso para continuar más tarde"
                    >
                      {isSaving ? <span className="loading loading-spinner loading-xs" /> : 'Pausar'}
                    </Button>
                    <Button
                      className="rounded-xl h-9 font-bold gap-2 shadow-md shadow-primary/20 flex-1"
                      disabled={items.length === 0 || guardarMutation.isPending}
                      onClick={() => guardarMutation.mutate()}
                    >
                      {guardarMutation.isPending
                        ? <span className="loading loading-spinner loading-sm" />
                        : <><CheckCircle2 className="h-4 w-4" /> Finalizar solicitud</>
                      }
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
                    <th className="text-right">Precio c/u</th>
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
                        <td className="text-right">
                          <p className="font-mono text-[11px] font-bold">
                            {precioUnit > 0 ? fmt(precioUnit) : <span className="opacity-30">—</span>}
                          </p>
                          {precioUnit > 0 && (
                            <p className="text-[9px] opacity-35 font-medium">
                              / {hasPres ? (item.presentacion_nombre ?? 'pres.') : item.unidad}
                            </p>
                          )}
                        </td>
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
                        unidad_plural: i.unidad_plural,
                        codigo_maestro: i.codigo_maestro,
                        codigo_proveedor: i.codigo_proveedor,
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
