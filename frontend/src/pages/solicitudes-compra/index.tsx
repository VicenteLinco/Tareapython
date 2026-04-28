// frontend/src/pages/solicitudes-compra/index.tsx
import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useLocation, useSearchParams } from 'react-router-dom'
import { ShoppingCart, Plus, History, Clock, Mail, Phone, ChevronLeft } from 'lucide-react'
import { toast } from 'sonner'
import api from '@/lib/api'
import { autoPlural, cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useAuthStore } from '@/hooks/use-auth-store'
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

import { calcularCantidad, fetchHorizonte } from './solicitud-utils'
import { ProveedorGallery } from './components/proveedor-gallery'
import { QuiebresPanelIzquierdo } from './components/quiebres-panel'
import { PedidoPanel } from './components/pedido-panel'
import { HistorialView } from './components/historial-view'
import { DetalleModal } from './components/detalle-modal'

export default function SolicitudesCompraPage() {
  useAuthStore()
  const queryClient = useQueryClient()
  const location = useLocation()
  const [searchParams] = useSearchParams()

  const [view, setView] = useState<'crear' | 'historial'>('crear')
  const [selectedProveedor, setSelectedProveedor] = useState<Proveedor | null>(null)
  const [items, setItems] = useState<SolicitudItem[]>([])
  const [solicitudId, setSolicitudId] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [historialSearch, setHistorialSearch] = useState('')
  const [selectedSolicitudId, setSelectedSolicitudId] = useState<string | null>(null)
  const [pdfFirmaLabel, setPdfFirmaLabel] = useState('')
  const [horizonteGlobal, setHorizonteGlobal] = useState<number>(30)
  const [tabIzquierdo, setTabIzquierdo] = useState<'quiebres' | 'buscar'>('buscar')
  const [popoverOpenId, setPopoverOpenId] = useState<string | null>(null)
  const [restaurando, setRestaurando] = useState(true)
  const borradorCargado = useRef(false)

  useEffect(() => {
    if (location.state?.view) setView(location.state.view)
  }, [location.state])

  useEffect(() => {
    if (!popoverOpenId) return
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('[data-popover-item]')) setPopoverOpenId(null)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [popoverOpenId])

  // ── Queries ──────────────────────────────────────────────────────────────────

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

  const { data: configuracion } = useQuery({
    queryKey: ['configuracion'],
    queryFn: () =>
      api.get<{ nombre_laboratorio: string; logo_base64: string; moneda_simbolo: string; moneda_codigo: string }>('/configuracion')
        .then(r => r.data),
    staleTime: 300_000,
  })

  const monedaCodigo = configuracion?.moneda_codigo ?? 'CLP'

  // ── Restauración del borrador ────────────────────────────────────────────────

  useEffect(() => {
    if (view !== 'crear' || borradorCargado.current) return
    borradorCargado.current = true
    const productoId = searchParams.get('select')

    async function restaurar() {
      setRestaurando(true)
      try {
        const [borradorRes, proveedoresRes] = await Promise.all([
          api.get<{ borrador: SolicitudDetalle | null }>('/solicitudes-compra/borrador'),
          api.get<Proveedor[]>('/proveedores'),
        ])
        const b = borradorRes.data.borrador
        const provs = proveedoresRes.data

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

        if (borradorItems.length > 0) {
          const savedId = localStorage.getItem('solicitud_proveedor_id')
          if (savedId) {
            const prov = provs.find(p => p.id === parseInt(savedId))
            if (prov) setSelectedProveedor(prov)
          }
        }

        if (productoId && !borradorItems.some(i => i.producto_id === productoId)) {
          try {
            const res2 = await api.get<Producto>(`/productos/${productoId}`)
            const p = res2.data
            if (p) {
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
            } else {
              setItems(borradorItems)
            }
          } catch {
            setItems(borradorItems)
          }
        } else {
          setItems(borradorItems)
        }
      } catch (err) { console.warn('[solicitudes] Error restaurando borrador:', err) }
      setRestaurando(false)
    }

    restaurar()
  }, [view, searchParams])

  // ── Mutations ────────────────────────────────────────────────────────────────

  const saveMutation = useMutation({
    mutationFn: (data: UpdateSolicitudRequest) =>
      solicitudId
        ? api.put(`/solicitudes-compra/${solicitudId}`, data)
        : api.post('/solicitudes-compra', data),
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
          horizonte_dias: i.horizonte_dias ?? null,
          horizonte_sugerido: i.horizonte_sugerido ?? null,
          horizonte_razon: i.horizonte_razon ?? null,
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
    const consumoDiario = parseFloat(r.consumo_diario.toString())
    const stockActual = parseFloat(r.stock_actual.toString())
    const stockMinimo = parseFloat(r.stock_seguridad.toString())
    const factorConv = r.factor_conversion ? parseFloat(r.factor_conversion.toString()) : null
    const cantidadCalc = calcularCantidad(horizonteGlobal, consumoDiario, r.lead_time, stockMinimo, stockActual, factorConv)
    const cantidad = r.confianza === 'baja' ? 0 : cantidadCalc

    setItems(prev => [...prev, {
      producto_id: r.producto_id,
      producto_nombre: r.producto_nombre,
      codigo_proveedor: r.codigo_proveedor,
      codigo_maestro: r.codigo_maestro,
      proveedor_id: proveedorId,
      proveedor_nombre: r.proveedor_nombre || 'S/P',
      lead_time: r.lead_time,
      presentacion_id: r.presentacion_id,
      presentacion_nombre: r.presentacion_nombre,
      presentacion_nombre_plural: r.presentacion_nombre_plural,
      factor_conversion: factorConv,
      unidad_base: r.unidad_base,
      unidad_base_plural: r.unidad_base_plural || autoPlural(r.unidad_base),
      cantidad,
      precio_unitario: r.precio_ultima_recepcion ? parseFloat(r.precio_ultima_recepcion.toString()) : 0,
      imagen_url: r.imagen_url,
      consumo_diario: consumoDiario,
      stock_actual: stockActual,
      stock_minimo: stockMinimo,
      horizonte_dias: horizonteGlobal,
      horizonte_sugerido: horizData.horizonte_sugerido,
      horizonte_razon: horizData.razon,
      horizonte_personalizado: false,
    }])
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
    const proveedorId = px.proveedor?.id ?? selectedProveedor?.id ?? null
    const horizData = await fetchHorizonte(p.id, proveedorId)
    const factorConvSearch = px.pres_factor ? parseFloat(px.pres_factor) : null
    const cantidad = calcularCantidad(
      horizonteGlobal, horizData.consumo_diario, p.lead_time_propio || 0,
      horizData.stock_minimo, horizData.stock_actual, factorConvSearch
    )
    setItems(prev => [...prev, {
      producto_id: p.id,
      producto_nombre: p.nombre,
      codigo_proveedor: p.codigo_proveedor,
      codigo_maestro: p.codigo_maestro,
      proveedor_id: proveedorId,
      proveedor_nombre: selectedProveedor?.nombre ?? 'Manual',
      lead_time: p.lead_time_propio || 0,
      presentacion_id: px.pres_id ?? null,
      presentacion_nombre: px.pres_nombre ?? null,
      presentacion_nombre_plural: px.pres_nombre_plural ?? null,
      factor_conversion: factorConvSearch,
      unidad_base: px.unidad_base?.nombre ?? 'u',
      unidad_base_plural: px.unidad_base?.nombre_plural ?? 'u',
      cantidad,
      precio_unitario: p.precio_unidad ? parseFloat(String(p.precio_unidad)) : 0,
      imagen_url: px.imagen_url ?? null,
      consumo_diario: horizData.consumo_diario,
      stock_actual: horizData.stock_actual,
      stock_minimo: horizData.stock_minimo,
      horizonte_dias: horizonteGlobal,
      horizonte_sugerido: horizData.horizonte_sugerido,
      horizonte_razon: horizData.razon,
      horizonte_personalizado: false,
    }])
  }

  const handleUpdateQty = (pid: string, val: number) =>
    setItems(prev => prev.map(i => i.producto_id === pid ? { ...i, cantidad: Math.max(1, val) } : i))

  const handleRemove = (pid: string) =>
    setItems(prev => prev.filter(i => i.producto_id !== pid))

  const handleGlobalHorizonteChange = (dias: number) => {
    const conservados = items.filter(i => i.horizonte_personalizado).length
    const recalculados = items.length - conservados
    setHorizonteGlobal(dias)
    setItems(prev => prev.map(i => {
      if (i.horizonte_personalizado) return i
      const nueva = calcularCantidad(dias, i.consumo_diario, i.lead_time, i.stock_minimo, i.stock_actual, i.factor_conversion)
      return { ...i, horizonte_dias: dias, cantidad: nueva }
    }))
    if (items.length === 0) return
    const label = dias >= 365 ? '1 año' : dias >= 180 ? '6 meses' : dias >= 90 ? '3 meses' : `${dias} días`
    if (conservados === items.length) {
      toast.info('Todos los items tienen horizonte personalizado 📌')
    } else if (conservados > 0) {
      toast.success(`Horizonte actualizado a ${label}. ${recalculados} recalculados, ${conservados} con horizonte personalizado 📌.`)
    } else {
      toast.success(`Horizonte actualizado a ${label}. ${recalculados} ${recalculados === 1 ? 'item recalculado' : 'items recalculados'}.`)
    }
  }

  const handleHorizonteChip = (pid: string, dias: number) => {
    setItems(prev => prev.map(i => {
      if (i.producto_id !== pid) return i
      const nueva = calcularCantidad(dias, i.consumo_diario, i.lead_time, i.stock_minimo, i.stock_actual, i.factor_conversion)
      return { ...i, horizonte_dias: dias, cantidad: nueva, horizonte_personalizado: dias !== horizonteGlobal }
    }))
    setPopoverOpenId(null)
  }

  const handleResetHorizonteToGlobal = (pid: string) => {
    setItems(prev => prev.map(i => {
      if (i.producto_id !== pid) return i
      const nueva = calcularCantidad(horizonteGlobal, i.consumo_diario, i.lead_time, i.stock_minimo, i.stock_actual, i.factor_conversion)
      return { ...i, horizonte_dias: horizonteGlobal, cantidad: nueva, horizonte_personalizado: false }
    }))
    setPopoverOpenId(null)
  }

  const handleSaveBorrador = () => {
    if (items.length === 0) return
    setIsSaving(true)
    saveMutation.mutate(
      {
        nota: null,
        items: items.map(i => ({
          producto_id: i.producto_id,
          cantidad_sugerida: i.cantidad.toString(),
          unidad: i.unidad_base,
          precio_unitario: i.precio_unitario.toString(),
          presentacion_id: i.presentacion_id,
          cantidad_presentaciones: i.cantidad.toString(),
          horizonte_dias: i.horizonte_dias ?? null,
          horizonte_sugerido: i.horizonte_sugerido ?? null,
          horizonte_razon: i.horizonte_razon ?? null,
        })),
      },
      { onSettled: () => setIsSaving(false) }
    )
  }

  const handleSelectProveedor = async (p: Proveedor) => {
    if (items.length > 0) {
      setItems([])
      setSolicitudId(null)
      toast('Lista anterior limpiada', { icon: '↩' })
    }
    localStorage.setItem('solicitud_proveedor_id', String(p.id))
    setSelectedProveedor(p)

    const prefillIds = searchParams.get('prefill')?.split(',').filter(Boolean) ?? []
    if (prefillIds.length === 0) return

    type ProductoExt = Producto & { imagen_url?: string | null; unidad_base?: { nombre: string; nombre_plural: string } }
    const prefillItems: SolicitudItem[] = []
    await Promise.allSettled(prefillIds.map(async (pid) => {
      try {
        const [horizData, prodRes] = await Promise.all([
          fetchHorizonte(pid, p.id),
          api.get<ProductoExt[]>('/productos', { params: { ids: pid, per_page: 1 } })
            .then(r => r.data[0])
            .catch(() => api.get<ProductoExt>(`/productos/${pid}`).then(r => r.data)),
        ])
        const prod = prodRes
        if (!prod) return
        const consumoDiario = horizData.consumo_diario ?? 0
        const leadTime = prod.lead_time_propio ?? 0
        const cantidad = calcularCantidad(horizonteGlobal, consumoDiario, leadTime, horizData.stock_minimo ?? 0, horizData.stock_actual ?? 0)
        prefillItems.push({
          producto_id: prod.id,
          producto_nombre: prod.nombre,
          codigo_proveedor: prod.codigo_proveedor,
          codigo_maestro: prod.codigo_maestro,
          proveedor_id: p.id,
          proveedor_nombre: p.nombre,
          lead_time: leadTime,
          presentacion_id: null,
          presentacion_nombre: null,
          presentacion_nombre_plural: null,
          factor_conversion: null,
          unidad_base: prod.unidad_base?.nombre ?? 'u',
          unidad_base_plural: prod.unidad_base?.nombre_plural ?? 'u',
          cantidad,
          precio_unitario: prod.precio_unidad ? parseFloat(String(prod.precio_unidad)) : 0,
          imagen_url: prod.imagen_url ?? null,
          consumo_diario: consumoDiario,
          stock_actual: horizData.stock_actual ?? 0,
          stock_minimo: horizData.stock_minimo ?? 0,
          horizonte_dias: horizonteGlobal,
          horizonte_sugerido: horizData.horizonte_sugerido ?? null,
          horizonte_razon: horizData.razon ?? null,
          horizonte_personalizado: false,
        })
      } catch { /* ignorar items que fallen */ }
    }))

    if (prefillItems.length > 0) {
      setItems(prefillItems)
      toast.success(`${prefillItems.length} ${prefillItems.length === 1 ? 'producto precargado' : 'productos precargados'} desde Stock`)
    }
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

  // ── Detail query ─────────────────────────────────────────────────────────────

  const { data: detail, isLoading: isLoadingDetail } = useQuery({
    queryKey: ['solicitud-detail', selectedSolicitudId],
    queryFn: () =>
      api.get<SolicitudDetalle>(`/solicitudes-compra/${selectedSolicitudId}`).then(r => r.data),
    enabled: !!selectedSolicitudId,
  })

  // ── Derived ──────────────────────────────────────────────────────────────────

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

      {/* Header */}
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
        <div className="flex-1 grid grid-cols-[30%_1fr] gap-4 min-h-0 animate-pulse">
          <div className="bg-base-200/60 rounded-[2rem]" />
          <div className="flex flex-col gap-3">
            <div className="h-16 bg-base-200/60 rounded-2xl" />
            <div className="flex-1 bg-base-200/60 rounded-[2.5rem]" />
          </div>
        </div>
      ) : view === 'crear' ? (
        selectedProveedor === null ? (
          <ProveedorGallery
            proveedores={proveedores}
            isLoading={isLoadingProveedores}
            urgenciasByProveedor={urgenciasByProveedor}
            logoBase64={configuracion?.logo_base64}
            onSelect={handleSelectProveedor}
          />
        ) : (
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
                    {recsFiltered.length > 0 ? `${recsFiltered.length} quiebre${recsFiltered.length !== 1 ? 's' : ''}` : 'Sin quiebres'}
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
            <div className="flex-1 grid grid-cols-[30%_1fr] gap-4 min-h-0">
              <QuiebresPanelIzquierdo
                proveedor={selectedProveedor}
                recomendaciones={recsFiltered}
                isLoadingRecs={isLoadingRecs}
                itemsEnPedido={items}
                tab={tabIzquierdo}
                monedaCodigo={monedaCodigo}
                onTabChange={setTabIzquierdo}
                onAddFromRec={handleAddFromRec}
                onAddFromSearch={handleAddFromSearch}
              />
              <PedidoPanel
                proveedor={selectedProveedor}
                items={items}
                solicitudId={solicitudId}
                isSaving={isSaving}
                isGuardando={guardarMutation.isPending}
                horizonteGlobal={horizonteGlobal}
                popoverOpenId={popoverOpenId}
                monedaCodigo={monedaCodigo}
                onUpdateQty={handleUpdateQty}
                onRemove={handleRemove}
                onGlobalHorizonteChange={handleGlobalHorizonteChange}
                onHorizonteChip={handleHorizonteChip}
                onResetHorizonteToGlobal={handleResetHorizonteToGlobal}
                onPopoverToggle={setPopoverOpenId}
                onSaveBorrador={handleSaveBorrador}
                onGuardar={() => guardarMutation.mutate()}
              />
            </div>
          </div>
        )
      ) : (
        <HistorialView
          solicitudes={historial?.data}
          isLoading={isLoadingHistorial}
          search={historialSearch}
          onSearchChange={setHistorialSearch}
          onSelectSolicitud={setSelectedSolicitudId}
        />
      )}

      <DetalleModal
        solicitudId={selectedSolicitudId}
        detail={detail}
        isLoading={isLoadingDetail}
        pdfFirmaLabel={pdfFirmaLabel}
        monedaCodigo={monedaCodigo}
        monedaSimbolo={configuracion?.moneda_simbolo ?? '$'}
        nombreLaboratorio={configuracion?.nombre_laboratorio ?? 'Laboratorio Clínico'}
        logoBase64={configuracion?.logo_base64}
        onClose={() => { setSelectedSolicitudId(null); setPdfFirmaLabel('') }}
        onPdfFirmaChange={setPdfFirmaLabel}
      />
    </div>
  )
}
