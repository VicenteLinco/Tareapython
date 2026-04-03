import { useState, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Search,
  Plus,
  Trash2,
  FileDown,
  CheckCircle2,
  History,
  User,
  XCircle,
  ClipboardCheck,
  ShoppingCart
} from 'lucide-react'
import { toast } from 'sonner'
import api from '@/lib/api'
import type {
  PaginatedResponse,
  SolicitudCompra,
  SolicitudCompraDetalle,
  SolicitudItem,
  ItemRecomendado,
  CreateSolicitudRequest
} from '@/types'
import { autoPlural, cn, formatDate } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuthStore } from '@/hooks/use-auth-store'
import { exportarSolicitudPDF } from '@/lib/solicitud-pdf'
import { Dialog } from '@/components/ui/dialog'

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
  const base = Math.round(item.cantidad * item.factor_conversion)
  const u = base === 1
    ? item.unidad_base
    : (item.unidad_base_plural ?? autoPlural(item.unidad_base))
  return `= ${base.toLocaleString('es-CL')} ${u} (${item.factor_conversion}/${item.presentacion_nombre})`
}

function recomendadoToItem(r: ItemRecomendado): SolicitudItem {
  const qty = r.cantidad_sugerida_presentacion != null && r.factor_conversion
    ? Math.ceil(r.cantidad_sugerida_presentacion)
    : Math.ceil(r.cantidad_sugerida_base)

  return {
    producto_id: r.producto_id,
    producto_nombre: r.producto_nombre,
    codigo_proveedor: r.codigo_proveedor,
    codigo_maestro: r.codigo_maestro,
    proveedor_id: r.proveedor_id,
    proveedor_nombre: r.proveedor_nombre ?? 'Sin proveedor',
    lead_time: r.lead_time,
    presentacion_id: r.presentacion_id,
    presentacion_nombre: r.presentacion_nombre,
    presentacion_nombre_plural: r.presentacion_nombre_plural,
    factor_conversion: r.factor_conversion,
    unidad_base: r.unidad_base,
    unidad_base_plural: r.unidad_base_plural,
    cantidad: qty,
    precio_unitario: r.precio_ultima_recepcion ?? 0,
  }
}

function formatPesos(n: number): string {
  return '$' + Math.round(n).toLocaleString('es-CL')
}

// ─── ItemRecCard sub-component ────────────────────────────────────────────────

function ItemRecCard({
  item,
  yaEnPedido,
  onAgregar,
}: {
  item: ItemRecomendado
  yaEnPedido: boolean
  onAgregar: (item: ItemRecomendado) => void
}) {
  const qty = item.cantidad_sugerida_presentacion != null
    ? Math.ceil(item.cantidad_sugerida_presentacion)
    : Math.ceil(item.cantidad_sugerida_base)
  const unidad = item.presentacion_nombre_plural ?? item.presentacion_nombre
    ?? (qty === 1 ? item.unidad_base : (item.unidad_base_plural ?? autoPlural(item.unidad_base)))

  return (
    <div className={cn(
      "border rounded-xl p-3 mb-2 bg-white flex items-center gap-3",
      item.nivel_urgencia === 'critico'    && "border-l-[3px] border-l-error",
      item.nivel_urgencia === 'urgente'    && "border-l-[3px] border-l-warning",
      item.nivel_urgencia === 'planificar' && "border-l-[3px] border-l-success",
    )}>
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-xs truncate">{item.producto_nombre}</div>
        <div className="text-[9px] font-mono text-base-content/40 mt-0.5">
          {item.codigo_proveedor && `Prov: ${item.codigo_proveedor}`}
          {item.codigo_proveedor && item.codigo_maestro && ' · '}
          {item.codigo_maestro && `Bodega: ${item.codigo_maestro}`}
        </div>
        <div className="flex gap-1 mt-1.5 flex-wrap">
          <Badge className={cn(
            "text-[9px] py-0 h-4",
            item.nivel_urgencia === 'critico'    && "bg-error/10 text-error border-error/20",
            item.nivel_urgencia === 'urgente'    && "bg-warning/10 text-warning border-warning/20",
            item.nivel_urgencia === 'planificar' && "bg-success/10 text-success border-success/20",
          )}>
            {item.autonomia_dias != null ? `${Math.round(item.autonomia_dias)}d autonomía` : 'Sin consumo · bajo mínimo'}
          </Badge>
          <Badge variant="outline" className="text-[9px] py-0 h-4 font-normal">
            {item.proveedor_nombre ?? 'Sin proveedor'} · {item.lead_time}d
          </Badge>
          {item.precio_ultima_recepcion && (
            <Badge className="bg-info/10 text-info border-info/20 text-[9px] py-0 h-4">
              {formatPesos(item.precio_ultima_recepcion)}/u
            </Badge>
          )}
        </div>
      </div>
      <div className="text-right flex-shrink-0">
        <div className="text-[10px] text-primary font-bold mb-1">
          Sugerir: {qty} {unidad}
        </div>
        <button
          className={cn(
            "text-[10px] font-bold px-2 py-1 rounded-lg",
            yaEnPedido
              ? "bg-success/10 text-success cursor-default"
              : "bg-primary text-white hover:bg-primary/90"
          )}
          onClick={() => !yaEnPedido && onAgregar(item)}
        >
          {yaEnPedido ? '✓ En pedido' : '+ Agregar'}
        </button>
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function SolicitudesCompraPage() {
  const queryClient = useQueryClient()
  const usuario = useAuthStore(s => s.usuario)
  const isAdmin = usuario?.rol === 'admin'

  // View state
  const [view, setView] = useState<'nuevo' | 'historial'>('nuevo')

  // Draft state
  const [items, setItems] = useState<SolicitudItem[]>([])
  const [borradorId, setBorradorId] = useState<string | null>(null)
  const [nota, setNota] = useState('')

  // Search
  const [productSearch, setProductSearch] = useState('')

  // Review modal (admin)
  const [revisando, setRevisando] = useState<SolicitudCompra | null>(null)
  const [notaRevision, setNotaRevision] = useState('')

  // IVA calculations
  const subtotalNeto = items.reduce((s, i) => s + i.cantidad * i.precio_unitario, 0)
  const iva = Math.round(subtotalNeto * 0.19)
  const totalConIva = subtotalNeto + iva

  // Queries
  const { data: recomendacionesData, isLoading: loadingRecs } = useQuery({
    queryKey: ['solicitudes-recomendaciones'],
    queryFn: () =>
      api.get<{ data: ItemRecomendado[] }>('/solicitudes-compra/recomendaciones')
        .then(r => r.data.data),
    refetchOnWindowFocus: false,
  })

  const { data: searchResults } = useQuery({
    queryKey: ['productos-search', productSearch],
    queryFn: () => api.get<PaginatedResponse<any>>('/productos', { params: { q: productSearch, per_page: 5 } }).then(r => r.data),
    enabled: productSearch.length > 2,
  })

  const { data: historialResponse, isLoading: loadingHistorial } = useQuery({
    queryKey: ['solicitudes-historial'],
    queryFn: () => api.get<PaginatedResponse<SolicitudCompra>>('/solicitudes-compra').then(r => r.data),
    enabled: view === 'historial',
  })

  const { data: borradorData } = useQuery({
    queryKey: ['solicitud-borrador'],
    queryFn: () =>
      api.get<{ borrador: SolicitudCompraDetalle | null }>('/solicitudes-compra/borrador')
        .then(r => r.data),
  })

  // Load existing borrador on mount
  useEffect(() => {
    if (!borradorData?.borrador) return
    const b = borradorData.borrador
    setBorradorId(b.id)
    setNota(b.nota ?? '')
    setItems(b.items.map(item => ({
      producto_id: item.producto_id,
      producto_nombre: item.producto_nombre,
      codigo_proveedor: item.codigo_proveedor ?? null,
      codigo_maestro: item.codigo_maestro ?? null,
      proveedor_id: null,
      proveedor_nombre: item.proveedor_nombre ?? 'Sin proveedor',
      lead_time: 7,
      presentacion_id: item.presentacion_id ?? null,
      presentacion_nombre: item.presentacion_nombre ?? null,
      presentacion_nombre_plural: item.presentacion_nombre_plural ?? null,
      factor_conversion: item.factor_conversion ? Number(item.factor_conversion) : null,
      unidad_base: item.unidad,
      unidad_base_plural: null,
      cantidad: item.cantidad_presentaciones
        ? Number(item.cantidad_presentaciones)
        : Number(item.cantidad_sugerida),
      precio_unitario: item.precio_unitario ? Number(item.precio_unitario) : 0,
    })))
  }, [borradorData])

  // Groups
  const grupos = useMemo(() => {
    const recs = recomendacionesData ?? []
    return {
      critico:    recs.filter(r => r.nivel_urgencia === 'critico'),
      urgente:    recs.filter(r => r.nivel_urgencia === 'urgente'),
      planificar: recs.filter(r => r.nivel_urgencia === 'planificar'),
    }
  }, [recomendacionesData])

  const itemsPorProveedor = useMemo(() => {
    const grupos: Record<string, SolicitudItem[]> = {}
    items.forEach(item => {
      const key = item.proveedor_nombre
      if (!grupos[key]) grupos[key] = []
      grupos[key].push(item)
    })
    return grupos
  }, [items])

  // Mutations
  const guardarMutation = useMutation({
    mutationFn: async () => {
      const payload: CreateSolicitudRequest = {
        nota: nota || undefined,
        items: items.map(i => ({
          producto_id: i.producto_id,
          cantidad_sugerida: i.factor_conversion
            ? i.cantidad * i.factor_conversion
            : i.cantidad,
          unidad: i.unidad_base,
          precio_unitario: i.precio_unitario || undefined,
          presentacion_id: i.presentacion_id ?? undefined,
          cantidad_presentaciones: i.presentacion_id ? i.cantidad : undefined,
        }))
      }
      if (borradorId) {
        return api.put(`/solicitudes-compra/${borradorId}`, payload)
      } else {
        const res = await api.post('/solicitudes-compra', payload)
        setBorradorId(res.data.id)
        return res
      }
    },
    onSuccess: () => toast.success('Borrador guardado'),
    onError: () => toast.error('Error al guardar el borrador'),
  })

  const enviarMutation = useMutation({
    mutationFn: async () => {
      if (!borradorId) {
        const saved = await guardarMutation.mutateAsync()
        return api.post(`/solicitudes-compra/${(saved as any).data.id}/enviar`)
      }
      return api.post(`/solicitudes-compra/${borradorId}/enviar`)
    },
    onSuccess: async () => {
      toast.success('Solicitud enviada a aprobación')
      try {
        const detail = await api.get<SolicitudCompraDetalle>(`/solicitudes-compra/${borradorId}`).then(r => r.data)
        const config = await api.get<{ nombre_laboratorio: string }>('/configuracion').then(r => r.data)
        await exportarSolicitudPDF({
          numero_documento: detail.numero_documento,
          fecha_creacion: detail.fecha_creacion,
          usuario_nombre: detail.usuario_nombre,
          nota: detail.nota,
          items: detail.items,
          // @ts-ignore — extra fields added in Task 11
          subtotal_neto: subtotalNeto,
          iva: iva,
          total_con_iva: totalConIva,
          nombreLaboratorio: config.nombre_laboratorio || 'Laboratorio'
        })
      } catch {
        toast.error('Error al generar PDF, pero la solicitud fue enviada')
      }
      queryClient.invalidateQueries({ queryKey: ['solicitudes-historial'] })
      setBorradorId(null)
      setItems([])
      setNota('')
      setView('historial')
    },
    onError: () => toast.error('Error al enviar la solicitud'),
  })

  const reviewMutation = useMutation({
    mutationFn: ({ id, estado, nota }: { id: string, estado: 'aprobada' | 'rechazada', nota?: string }) =>
      api.post(`/solicitudes-compra/${id}/revisar`, { estado, nota_revision: nota }),
    onSuccess: (_, variables) => {
      toast.success(`Solicitud ${variables.estado === 'aprobada' ? 'aprobada' : 'rechazada'}`)
      queryClient.invalidateQueries({ queryKey: ['solicitudes-historial'] })
      setRevisando(null)
      setNotaRevision('')
    },
    onError: () => toast.error('Error al procesar la revisión'),
  })

  // Handlers
  function agregarDesdeRecomendacion(rec: ItemRecomendado) {
    if (items.some(i => i.producto_id === rec.producto_id)) {
      toast.error('Este producto ya está en el pedido')
      return
    }
    setItems(prev => [recomendadoToItem(rec), ...prev])
    toast.success(`${rec.producto_nombre} agregado`)
  }

  function agregarManual(p: any) {
    if (items.some(i => i.producto_id === p.id)) {
      toast.error('Este producto ya está en el pedido')
      return
    }
    const pres = p.presentaciones?.find((pr: any) => pr.activa) ?? null
    const newItem: SolicitudItem = {
      producto_id: p.id,
      producto_nombre: p.nombre,
      codigo_proveedor: p.codigo_proveedor ?? null,
      codigo_maestro: p.codigo_maestro ?? null,
      proveedor_id: p.proveedor?.id ?? null,
      proveedor_nombre: p.proveedor?.nombre ?? 'Sin proveedor',
      lead_time: p.proveedor?.dias_despacho_tierra ?? p.proveedor?.dias_despacho_aereo ?? 7,
      presentacion_id: pres?.id ?? null,
      presentacion_nombre: pres?.nombre ?? null,
      presentacion_nombre_plural: pres?.nombre_plural ?? null,
      factor_conversion: pres?.factor_conversion ?? null,
      unidad_base: p.unidad_base?.nombre ?? '',
      unidad_base_plural: p.unidad_base?.nombre_plural ?? null,
      cantidad: 1,
      precio_unitario: 0,
    }
    setItems(prev => [newItem, ...prev])
    setProductSearch('')
    toast.success(`${p.nombre} agregado`)
  }

  function updateCantidad(producto_id: string, qty: number) {
    setItems(prev => prev.map(i =>
      i.producto_id === producto_id ? { ...i, cantidad: Math.max(0.01, qty) } : i
    ))
  }

  function updatePrecio(producto_id: string, precio: number) {
    setItems(prev => prev.map(i =>
      i.producto_id === producto_id ? { ...i, precio_unitario: Math.max(0, precio) } : i
    ))
  }

  function removeItem(producto_id: string) {
    setItems(prev => prev.filter(i => i.producto_id !== producto_id))
  }

  async function handleDownloadExisting(id: string) {
    try {
      const detail = await api.get<SolicitudCompraDetalle>(`/solicitudes-compra/${id}`).then(r => r.data)
      const config = await api.get<{ nombre_laboratorio: string }>('/configuracion').then(r => r.data)
      const subtotal = detail.items.reduce((s, i) => {
        const qty = i.cantidad_presentaciones ? Number(i.cantidad_presentaciones) : Number(i.cantidad_sugerida)
        return s + qty * (i.precio_unitario ? Number(i.precio_unitario) : 0)
      }, 0)
      await exportarSolicitudPDF({
        numero_documento: detail.numero_documento,
        fecha_creacion: detail.fecha_creacion,
        usuario_nombre: detail.usuario_nombre,
        nota: detail.nota,
        items: detail.items,
        // @ts-ignore — extra fields added in Task 11
        subtotal_neto: subtotal,
        iva: Math.round(subtotal * 0.19),
        total_con_iva: subtotal + Math.round(subtotal * 0.19),
        nombreLaboratorio: config.nombre_laboratorio || 'Laboratorio'
      })
    } catch {
      toast.error('Error al generar el PDF')
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 bg-white border-b border-base-200 flex-shrink-0">
        <div>
          <h1 className="text-lg font-bold">Solicitudes de Compra</h1>
          <p className="text-[10px] opacity-40">Reposición inteligente · Precios netos + IVA 19%</p>
        </div>
        <div className="flex items-center gap-2 bg-base-200 p-1 rounded-xl">
          <Button variant={view === 'nuevo' ? 'default' : 'ghost'} size="sm" className="rounded-lg" onClick={() => setView('nuevo')}>
            💡 Recomendaciones
          </Button>
          <Button variant={view === 'historial' ? 'default' : 'ghost'} size="sm" className="rounded-lg" onClick={() => setView('historial')}>
            <History className="w-4 h-4 mr-1" /> Historial
          </Button>
        </div>
      </div>

      {view === 'nuevo' ? (
        <div className="flex flex-1 overflow-hidden">
          {/* ===== LEFT PANEL: Suggestions ===== */}
          <div className="w-[380px] flex-shrink-0 bg-white border-r border-base-200 flex flex-col overflow-hidden">
            <div className="p-3 border-b border-base-200">
              <h2 className="font-bold text-sm">💡 Sistema recomienda</h2>
              <p className="text-[10px] text-base-content/40 mt-0.5">
                Urgencia relativa al lead time de cada proveedor
              </p>
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              {loadingRecs ? (
                [1,2,3].map(i => <Skeleton key={i} className="h-16 w-full rounded-xl mb-2" />)
              ) : (
                <>
                  {grupos.critico.length > 0 && (
                    <div className="mb-3">
                      <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wide text-error bg-error/5 rounded-md px-2 py-1 mb-2">
                        🔴 Crítico — llega a cero antes del pedido ({grupos.critico.length})
                      </div>
                      {grupos.critico.map(r => (
                        <ItemRecCard
                          key={r.producto_id}
                          item={r}
                          yaEnPedido={items.some(i => i.producto_id === r.producto_id)}
                          onAgregar={agregarDesdeRecomendacion}
                        />
                      ))}
                    </div>
                  )}
                  {grupos.urgente.length > 0 && (
                    <div className="mb-3">
                      <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wide text-warning bg-warning/5 rounded-md px-2 py-1 mb-2">
                        🟡 Urgente — menos de 1.5× lead time ({grupos.urgente.length})
                      </div>
                      {grupos.urgente.map(r => (
                        <ItemRecCard
                          key={r.producto_id}
                          item={r}
                          yaEnPedido={items.some(i => i.producto_id === r.producto_id)}
                          onAgregar={agregarDesdeRecomendacion}
                        />
                      ))}
                    </div>
                  )}
                  {grupos.planificar.length > 0 && (
                    <div className="mb-3">
                      <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wide text-success bg-success/5 rounded-md px-2 py-1 mb-2">
                        🟢 Planificar — pedir en este ciclo ({grupos.planificar.length})
                      </div>
                      {grupos.planificar.map(r => (
                        <ItemRecCard
                          key={r.producto_id}
                          item={r}
                          yaEnPedido={items.some(i => i.producto_id === r.producto_id)}
                          onAgregar={agregarDesdeRecomendacion}
                        />
                      ))}
                    </div>
                  )}
                  {(recomendacionesData?.length ?? 0) === 0 && !loadingRecs && (
                    <div className="py-16 text-center opacity-30">
                      <p className="text-xs">Sin alertas activas — inventario en orden</p>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* ===== RIGHT PANEL: Mi Pedido ===== */}
          <div className="flex-1 flex flex-col bg-base-50 overflow-hidden">
            {/* Header */}
            <div className="p-3 bg-white border-b border-base-200 flex items-center justify-between">
              <h2 className="font-bold text-sm">🛒 Mi Pedido</h2>
              {borradorId && (
                <span className="text-[10px] bg-warning/10 text-warning px-2 py-1 rounded-full font-bold">
                  ● Borrador guardado
                </span>
              )}
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto p-3">
              {/* Manual search */}
              <div className="relative mb-3">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 opacity-30" />
                <Input
                  placeholder="Añadir producto manualmente..."
                  className="pl-9 h-9 rounded-xl text-xs"
                  value={productSearch}
                  onChange={e => setProductSearch(e.target.value)}
                />
                {searchResults?.data && productSearch.length > 2 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-base-200 rounded-xl shadow-xl z-50 overflow-hidden">
                    {searchResults.data.length === 0 ? (
                      <div className="p-3 text-xs text-center opacity-40">Sin resultados</div>
                    ) : (
                      <div className="divide-y divide-base-100">
                        {searchResults.data.map((p: any) => (
                          <button
                            key={p.id}
                            className="w-full flex items-center justify-between p-2.5 hover:bg-primary/5 text-left"
                            onClick={() => agregarManual(p)}
                          >
                            <div>
                              <div className="text-xs font-semibold">{p.nombre}</div>
                              <div className="text-[9px] opacity-40">{p.proveedor?.nombre ?? 'Sin proveedor'}</div>
                            </div>
                            <Plus className="w-4 h-4 text-primary" />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Vendor-grouped tables */}
              {items.length === 0 ? (
                <div className="py-20 text-center opacity-20">
                  <ShoppingCart className="w-10 h-10 mx-auto mb-3" />
                  <p className="text-xs">Agrega productos desde el panel izquierdo</p>
                </div>
              ) : (
                Object.entries(itemsPorProveedor).map(([proveedor, provItems]) => {
                  const subtotalProv = provItems.reduce((s, i) => s + i.cantidad * i.precio_unitario, 0)
                  return (
                    <div key={proveedor} className="bg-white border border-base-200 rounded-2xl overflow-hidden mb-3">
                      <div className="px-3 py-2 bg-base-50 border-b border-base-200 flex items-center justify-between">
                        <div>
                          <div className="font-bold text-xs">{proveedor}</div>
                          <div className="text-[9px] opacity-40">
                            {provItems[0].lead_time}d despacho · {provItems.length} producto{provItems.length > 1 ? 's' : ''}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs font-bold text-primary">{formatPesos(subtotalProv)} neto</div>
                          <div className="text-[9px] opacity-40">{formatPesos(subtotalProv * 1.19)} c/IVA</div>
                        </div>
                      </div>
                      <table className="w-full text-[11px]">
                        <thead>
                          <tr className="bg-base-50/50">
                            <th className="text-left px-3 py-1.5 text-[9px] font-bold uppercase opacity-40 w-[30%]">Producto</th>
                            <th className="text-left px-2 py-1.5 text-[9px] font-bold uppercase opacity-40">Cód. Prov.</th>
                            <th className="text-left px-2 py-1.5 text-[9px] font-bold uppercase opacity-40">Cód. Bodega</th>
                            <th className="text-center px-2 py-1.5 text-[9px] font-bold uppercase opacity-40">Cantidad</th>
                            <th className="text-right px-2 py-1.5 text-[9px] font-bold uppercase opacity-40">P. Neto</th>
                            <th className="text-right px-2 py-1.5 text-[9px] font-bold uppercase opacity-40">Total</th>
                            <th className="w-6"></th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-base-100">
                          {provItems.map(item => {
                            const equiv = equivalenciaBase(item)
                            const totalLinea = item.cantidad * item.precio_unitario
                            return (
                              <tr key={item.producto_id}>
                                <td className="px-3 py-2">
                                  <div className="font-medium leading-tight">{item.producto_nombre}</div>
                                  {item.presentacion_nombre && (
                                    <div className="text-[9px] opacity-40">📦 {item.presentacion_nombre}</div>
                                  )}
                                </td>
                                <td className="px-2 py-2">
                                  {item.codigo_proveedor
                                    ? <span className="font-mono text-[9px] bg-info/10 text-info px-1.5 py-0.5 rounded">{item.codigo_proveedor}</span>
                                    : <span className="opacity-20">—</span>}
                                </td>
                                <td className="px-2 py-2">
                                  {item.codigo_maestro
                                    ? <span className="font-mono text-[9px] bg-secondary/10 text-secondary px-1.5 py-0.5 rounded">{item.codigo_maestro}</span>
                                    : <span className="opacity-20">—</span>}
                                </td>
                                <td className="px-2 py-2 text-center">
                                  <div className="flex items-center justify-center gap-1">
                                    <input
                                      type="number"
                                      className="w-12 bg-base-100 rounded-lg text-center font-bold text-xs border border-base-200 py-1 focus:outline-none focus:border-primary"
                                      value={item.cantidad}
                                      min={0.01}
                                      step={1}
                                      onChange={e => updateCantidad(item.producto_id, Number(e.target.value))}
                                    />
                                    <span className="text-[9px] opacity-50">{unidadLabel(item, item.cantidad)}</span>
                                  </div>
                                  {equiv && <div className="text-[9px] text-info mt-0.5">{equiv}</div>}
                                </td>
                                <td className="px-2 py-2 text-right">
                                  <div className="flex items-center justify-end gap-0.5">
                                    <span className="text-[9px] opacity-40">$</span>
                                    <input
                                      type="number"
                                      className="w-20 bg-base-100 rounded-lg text-right font-semibold text-xs border border-base-200 py-1 px-1.5 focus:outline-none focus:border-primary"
                                      value={item.precio_unitario}
                                      min={0}
                                      onChange={e => updatePrecio(item.producto_id, Number(e.target.value))}
                                    />
                                  </div>
                                  <div className="text-[8px] opacity-30 text-right">
                                    por {unidadLabel(item, 1)}
                                  </div>
                                </td>
                                <td className="px-2 py-2 text-right font-bold">{formatPesos(totalLinea)}</td>
                                <td className="pr-2">
                                  <button
                                    className="text-error/30 hover:text-error transition-colors"
                                    onClick={() => removeItem(item.producto_id)}
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )
                })
              )}
            </div>

            {/* Footer: IVA + actions */}
            <div className="bg-white border-t border-base-200">
              <div className="px-4 pt-3 pb-0 space-y-1">
                <div className="flex justify-between text-xs text-base-content/60">
                  <span>Subtotal neto</span>
                  <span>{formatPesos(subtotalNeto)}</span>
                </div>
                <div className="flex justify-between text-xs font-semibold text-info">
                  <span>IVA 19%</span>
                  <span>{formatPesos(iva)}</span>
                </div>
                <div className="flex justify-between font-bold text-sm border-t border-base-200 pt-2 mt-2">
                  <span>Total con IVA</span>
                  <span>{formatPesos(totalConIva)}</span>
                </div>
              </div>
              <div className="px-4 py-2">
                <textarea
                  className="textarea textarea-bordered w-full text-xs h-10 rounded-xl resize-none bg-base-100"
                  placeholder="Observaciones para el área de compras..."
                  value={nota}
                  onChange={e => setNota(e.target.value)}
                />
              </div>
              <div className="flex gap-2 px-4 pb-3">
                <Button
                  variant="outline"
                  className="flex-1 h-11 rounded-xl text-xs font-bold"
                  disabled={items.length === 0 || guardarMutation.isPending}
                  onClick={() => guardarMutation.mutate()}
                >
                  {guardarMutation.isPending
                    ? <span className="loading loading-spinner loading-xs" />
                    : '💾 Guardar borrador'}
                </Button>
                <Button
                  className="flex-1 h-11 rounded-xl text-xs font-bold gap-1"
                  disabled={items.length === 0 || enviarMutation.isPending}
                  onClick={() => enviarMutation.mutate()}
                >
                  {enviarMutation.isPending
                    ? <span className="loading loading-spinner loading-xs" />
                    : '✉️ Enviar a aprobación'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* ===== HISTORIAL VIEW ===== */
        <div className="flex-1 overflow-auto">
          <div className="p-6 space-y-4">
            <div className="rounded-[2rem] border border-base-200 bg-base-100 overflow-hidden shadow-sm">
              <table className="table w-full">
                <thead>
                  <tr className="bg-base-200/50 text-[11px] uppercase tracking-wider opacity-60">
                    <th className="pl-8">Documento</th>
                    <th>Fecha</th>
                    <th>Usuario</th>
                    <th className="text-center">Ítems</th>
                    <th>Estado</th>
                    <th className="w-10 pr-8"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-base-200">
                  {loadingHistorial ? (
                    [1,2,3].map(i => (
                      <tr key={i}><td colSpan={6} className="px-8"><Skeleton className="h-12 w-full rounded-xl" /></td></tr>
                    ))
                  ) : !historialResponse?.data || historialResponse.data.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-20 text-center opacity-40 text-sm italic">
                        No se han registrado solicitudes de compra aún
                      </td>
                    </tr>
                  ) : (
                    historialResponse.data.map(sol => (
                      <tr key={sol.id} className="hover:bg-base-200/30 transition-colors">
                        <td className="pl-8">
                          <div className="flex flex-col">
                            <span className="font-mono font-bold text-primary text-sm">{sol.numero_documento}</span>
                            {sol.nota && <span className="text-[10px] opacity-40 truncate max-w-[150px]">{sol.nota}</span>}
                          </div>
                        </td>
                        <td className="text-xs font-medium">{formatDate(sol.fecha_creacion)}</td>
                        <td className="text-xs">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full bg-base-200 flex items-center justify-center">
                              <User className="w-3 h-3 opacity-40" />
                            </div>
                            <span className="font-medium opacity-70">{sol.usuario_nombre}</span>
                          </div>
                        </td>
                        <td className="text-center">
                          <Badge variant="secondary" className="font-bold tabular-nums">{sol.items_count}</Badge>
                        </td>
                        <td>
                          <Badge className={cn(
                            "uppercase text-[9px] font-bold px-2 py-0.5 rounded-lg",
                            sol.estado === 'borrador'   && "bg-base-content/10 text-base-content/60 border-base-content/10",
                            sol.estado === 'pendiente'  && "bg-warning/10 text-warning border-warning/20",
                            sol.estado === 'aprobada'   && "bg-success/10 text-success border-success/20",
                            sol.estado === 'rechazada'  && "bg-error/10 text-error border-error/20",
                            sol.estado === 'enviada'    && "bg-info/10 text-info border-info/20",
                            sol.estado === 'completada' && "bg-success text-success-content",
                            sol.estado === 'cancelada'  && "bg-error/10 text-error border-error/20",
                          )}>
                            {sol.estado}
                          </Badge>
                        </td>
                        <td className="pr-8">
                          <div className="flex items-center gap-1 justify-end">
                            {isAdmin && sol.estado === 'pendiente' && (
                              <Button
                                variant="ghost" size="sm" className="h-8 w-8 p-0 text-warning hover:bg-warning/10"
                                onClick={() => setRevisando(sol)}
                              >
                                <ClipboardCheck className="w-4 h-4" />
                              </Button>
                            )}
                            <Button
                              variant="ghost" size="sm" className="h-8 w-8 p-0 text-primary hover:bg-primary/10"
                              onClick={() => handleDownloadExisting(sol.id)}
                            >
                              <FileDown className="w-4 h-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Review Modal (admin) */}
      <Dialog
        open={!!revisando}
        onClose={() => setRevisando(null)}
        title={`Revisar Solicitud ${revisando?.numero_documento}`}
      >
        <div className="space-y-6 py-2">
          <div className="p-4 bg-warning/5 border border-warning/20 rounded-2xl">
            <p className="text-xs font-medium text-warning-content leading-relaxed">
              Como administrador, revisa los ítems solicitados y sus cantidades sugeridas antes de autorizar el proceso de compra.
            </p>
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-bold uppercase tracking-widest opacity-40 ml-1">Dictamen / Nota de revisión</label>
            <textarea
              className="textarea textarea-bordered w-full h-32 text-sm rounded-2xl bg-base-200/20 border-base-200 focus:ring-2 ring-primary/10 transition-all resize-none"
              placeholder="Escribe el motivo de la decisión..."
              value={notaRevision}
              onChange={e => setNotaRevision(e.target.value)}
            />
          </div>
          <div className="flex gap-3 pt-2">
            <Button
              variant="outline" className="flex-1 h-12 rounded-xl border-error text-error hover:bg-error hover:text-white"
              onClick={() => reviewMutation.mutate({ id: revisando!.id, estado: 'rechazada', nota: notaRevision })}
              disabled={reviewMutation.isPending}
            >
              <XCircle className="w-4 h-4 mr-2" />Rechazar
            </Button>
            <Button
              className="flex-1 h-12 rounded-xl bg-success hover:bg-success/90 text-success-content"
              onClick={() => reviewMutation.mutate({ id: revisando!.id, estado: 'aprobada', nota: notaRevision })}
              disabled={reviewMutation.isPending}
            >
              <CheckCircle2 className="w-4 h-4 mr-2" />Aprobar
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  )
}
