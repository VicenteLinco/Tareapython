import { useState, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { 
  Search, 
  Plus, 
  Trash2, 
  FileDown,
  CheckCircle2,
  AlertCircle,
  History,
  User,
  XCircle,
  ClipboardCheck,
  Truck,
  ChevronDown,
  ChevronRight,
  PackageSearch,
  ShoppingCart
} from 'lucide-react'
import { toast } from 'sonner'
import api from '@/lib/api'
import type { Alerta, PaginatedResponse, SolicitudCompra, CreateSolicitudRequest, SolicitudCompraDetalle } from '@/types'
import { autoPlural, cn, formatDate } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { useAuthStore } from '@/hooks/use-auth-store'
import { exportarSolicitudPDF } from '@/lib/solicitud-pdf'
import { Dialog } from '@/components/ui/dialog'

interface SolicitudItem {
  producto_id: string
  producto_nombre: string
  unidad: string
  unidad_plural?: string | null
  stock_total: number
  stock_minimo: number
  cantidad_sugerida: number
  seleccionado: boolean
  proveedor_id: number | null
  proveedor_nombre: string
  total_en_camino: number
  dias_autonomia?: number
}

export default function SolicitudesCompraPage() {
  const queryClient = useQueryClient()
  const usuario = useAuthStore(s => s.usuario)
  const isAdmin = usuario?.rol === 'admin'
  const [search, setSearch] = useState('')
  const [items, setItems] = useState<SolicitudItem[]>([])
  const [view, setView] = useState<'nuevo' | 'historial'>('nuevo')
  const [nota, setNota] = useState('')
  const [revisando, setRevisando] = useState<SolicitudCompra | null>(null)
  const [notaRevision, setNotaRevision] = useState('')
  const [expandedVendors, setExpandedVendors] = useState<Record<string, boolean>>({})
  
  const { data: alertasResponse, isLoading } = useQuery({
    queryKey: ['alertas', 'reposicion'],
    queryFn: () => api.get<PaginatedResponse<Alerta>>('/stock/alertas', { 
      params: { per_page: 100 } 
    }).then((r) => r.data),
  })

  const { data: historialResponse, isLoading: loadingHistorial } = useQuery({
    queryKey: ['solicitudes-historial'],
    queryFn: () => api.get<PaginatedResponse<SolicitudCompra>>('/solicitudes-compra').then(r => r.data),
    enabled: view === 'historial'
  })

  useEffect(() => {
    if (alertasResponse?.data && items.length === 0) {
      const initialItems = alertasResponse.data
        .filter(a => 
          a.tipo_alerta === 'bajo_minimo' || 
          a.tipo_alerta === 'agotamiento_proximo' || 
          a.tipo_alerta === 'vencido' ||
          (a.stock_minimo && (a.total ?? 0) < a.stock_minimo)
        )
        .map(a => {
          const stockActual = Number(a.total ?? 0)
          const stockMin = Number(a.stock_minimo ?? 0)
          const enCamino = Number(a.total_en_camino ?? 0)
          const consumoDiario = Number(a.consumo_diario_30d ?? 0)
          const leadTime = Number(a.dias_despacho ?? 7)

          // Sugerencia Pro: (Mínimo x 2) + (Consumo durante el tiempo de espera) - Stock - En camino
          const sugerencia = Math.max(0, 
            Math.ceil((stockMin * 2) + (consumoDiario * leadTime) - stockActual - enCamino)
          )

          return {
            producto_id: a.producto_id,
            producto_nombre: a.nombre,
            unidad: a.unidad || '',
            unidad_plural: a.unidad_plural,
            stock_total: stockActual,
            stock_minimo: stockMin,
            cantidad_sugerida: sugerencia || Math.ceil(stockMin * 1.5),
            seleccionado: true,
            proveedor_id: a.proveedor_id || null,
            proveedor_nombre: a.proveedor_nombre || 'Sin Proveedor Asignado',
            total_en_camino: enCamino,
            dias_autonomia: a.dias_autonomia
          }
        })
      
      setItems(initialItems)
      
      // Auto-expand all vendors initially
      const vendors = [...new Set(initialItems.map(i => i.proveedor_nombre))]
      const expansion: Record<string, boolean> = {}
      vendors.forEach(v => expansion[v] = true)
      setExpandedVendors(expansion)
    }
  }, [alertasResponse])

  const mutation = useMutation({
    mutationFn: (data: CreateSolicitudRequest) => api.post('/solicitudes-compra', data),
    onSuccess: async (response) => {
      const { id, numero_documento } = response.data
      toast.success(`Solicitud ${numero_documento} generada correctamente`)
      
      try {
        const detail = await api.get<SolicitudCompraDetalle>(`/solicitudes-compra/${id}`).then(r => r.data)
        const config = await api.get<{ nombre_laboratorio: string }>('/configuracion').then(r => r.data)
        
        await exportarSolicitudPDF({
          numero_documento: detail.numero_documento,
          fecha_creacion: detail.fecha_creacion,
          usuario_nombre: detail.usuario_nombre,
          nota: detail.nota,
          items: detail.items,
          nombreLaboratorio: config.nombre_laboratorio || 'Laboratorio'
        })
      } catch (err) {
        toast.error('Error al generar el PDF, pero la solicitud fue guardada')
      }

      queryClient.invalidateQueries({ queryKey: ['solicitudes-historial'] })
      setView('historial')
      setItems([])
      setNota('')
    },
    onError: () => toast.error('Error al guardar la solicitud de compra')
  })

  const reviewMutation = useMutation({
    mutationFn: ({ id, estado, nota }: { id: string, estado: 'aprobada' | 'rechazada', nota?: string }) => 
      api.post(`/solicitudes-compra/${id}/revisar`, { estado, nota_revision: nota }),
    onSuccess: (_, variables) => {
      toast.success(`Solicitud ${variables.estado === 'aprobada' ? 'aprobada' : 'rechazada'} correctamente`)
      queryClient.invalidateQueries({ queryKey: ['solicitudes-historial'] })
      setRevisando(null)
      setNotaRevision('')
    },
    onError: () => toast.error('Error al procesar la revisión')
  })

  // Group items by vendor
  const groupedItems = useMemo(() => {
    const filtered = items.filter(i => 
      i.producto_nombre.toLowerCase().includes(search.toLowerCase()) ||
      i.proveedor_nombre.toLowerCase().includes(search.toLowerCase())
    )
    
    const groups: Record<string, SolicitudItem[]> = {}
    filtered.forEach(item => {
      if (!groups[item.proveedor_nombre]) groups[item.proveedor_nombre] = []
      groups[item.proveedor_nombre].push(item)
    })
    return groups
  }, [items, search])

  const toggleSelect = (id: string) => {
    setItems(prev => prev.map(item => 
      item.producto_id === id ? { ...item, seleccionado: !item.seleccionado } : item
    ))
  }

  const toggleVendor = (vendor: string) => {
    setExpandedVendors(prev => ({ ...prev, [vendor]: !prev[vendor] }))
  }

  const toggleVendorSelection = (vendor: string, selected: boolean) => {
    setItems(prev => prev.map(item => 
      item.proveedor_nombre === vendor ? { ...item, seleccionado: selected } : item
    ))
  }

  const updateCantidad = (id: string, qty: number) => {
    setItems(prev => prev.map(item => 
      item.producto_id === id ? { ...item, cantidad_sugerida: Math.max(0, qty) } : item
    ))
  }

  const removeItem = (id: string) => {
    setItems(prev => prev.filter(item => item.producto_id !== id))
  }

  const totalSeleccionados = items.filter(i => i.seleccionado).length

  const handleGenerar = () => {
    if (totalSeleccionados === 0) {
      toast.error('Selecciona al menos un producto')
      return
    }

    const payload: CreateSolicitudRequest = {
      nota: nota || undefined,
      items: items.filter(i => i.seleccionado).map(i => ({
        producto_id: i.producto_id,
        cantidad_sugerida: i.cantidad_sugerida,
        unidad: i.unidad
      }))
    }

    mutation.mutate(payload)
  }

  const handleDownloadExisting = async (id: string) => {
    try {
      const detail = await api.get<SolicitudCompraDetalle>(`/solicitudes-compra/${id}`).then(r => r.data)
      const config = await api.get<{ nombre_laboratorio: string }>('/configuracion').then(r => r.data)
      
      await exportarSolicitudPDF({
        numero_documento: detail.numero_documento,
        fecha_creacion: detail.fecha_creacion,
        usuario_nombre: detail.usuario_nombre,
        nota: detail.nota,
        items: detail.items,
        nombreLaboratorio: config.nombre_laboratorio || 'Laboratorio'
      })
    } catch (err) {
      toast.error('Error al generar el PDF')
    }
  }

  return (
    <div className="space-y-8 pb-20">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Reposición Inteligente</h1>
          <p className="text-sm opacity-50 mt-0.5">Propuesta de abastecimiento basada en demanda y tiempos de entrega</p>
        </div>
        <div className="flex items-center gap-2 bg-base-200 p-1 rounded-xl shadow-inner">
           <Button 
             variant={view === 'nuevo' ? 'default' : 'ghost'} 
             size="sm" 
             className="rounded-lg font-bold"
             onClick={() => setView('nuevo')}
            >
             <Plus className="w-4 h-4 mr-2" />
             Propuesta
           </Button>
           <Button 
             variant={view === 'historial' ? 'default' : 'ghost'} 
             size="sm" 
             className="rounded-lg font-bold"
             onClick={() => setView('historial')}
            >
             <History className="w-4 h-4 mr-2" />
             Historial
           </Button>
        </div>
      </div>

      {view === 'nuevo' ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            <div className="relative group">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 opacity-20 group-focus-within:opacity-100 transition-opacity" />
              <Input 
                placeholder="Filtrar por producto o proveedor..." 
                className="pl-12 bg-base-100 h-12 rounded-2xl shadow-sm border-base-200"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <div className="space-y-4">
              {isLoading ? (
                [1, 2, 3].map(i => <Skeleton key={i} className="h-24 w-full rounded-2xl" />)
              ) : Object.keys(groupedItems).length === 0 ? (
                <div className="py-20 text-center bg-base-100 rounded-[2rem] border border-dashed border-base-300">
                  <PackageSearch className="w-12 h-12 mx-auto mb-4 opacity-10" />
                  <p className="opacity-40 font-medium">{search ? 'No hay coincidencias' : 'Inventario óptimo: No se requieren pedidos actualmente'}</p>
                </div>
              ) : (
                Object.entries(groupedItems).map(([vendor, vendorItems]) => {
                  const isExpanded = expandedVendors[vendor]
                  const allSelected = vendorItems.every(i => i.seleccionado)
                  const selectedCount = vendorItems.filter(i => i.seleccionado).length

                  return (
                    <div key={vendor} className="bg-base-100 border border-base-200 rounded-3xl overflow-hidden shadow-sm transition-all">
                      {/* Vendor Header */}
                      <div className="flex items-center justify-between p-4 bg-base-200/30 border-b border-base-200">
                        <div className="flex items-center gap-3">
                          <button 
                            onClick={() => toggleVendor(vendor)}
                            className="btn btn-ghost btn-xs btn-square"
                          >
                            {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                          </button>
                          <input 
                            type="checkbox" 
                            className="checkbox checkbox-sm checkbox-primary rounded-lg" 
                            checked={allSelected}
                            onChange={(e) => toggleVendorSelection(vendor, e.target.checked)}
                          />
                          <div className="flex flex-col">
                            <h3 className="font-bold text-sm">{vendor}</h3>
                            <span className="text-[10px] opacity-40 font-bold uppercase tracking-wider">{vendorItems.length} productos detectados</span>
                          </div>
                        </div>
                        <Badge variant="secondary" className="font-bold text-[10px]">
                          {selectedCount} seleccionados
                        </Badge>
                      </div>

                      {/* Items List */}
                      {isExpanded && (
                        <div className="divide-y divide-base-200">
                          {vendorItems.map(item => (
                            <div key={item.producto_id} className={cn(
                              "p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-colors",
                              !item.seleccionado && "opacity-40 bg-base-200/10"
                            )}>
                              <div className="flex items-start gap-4 flex-1">
                                <input 
                                  type="checkbox" 
                                  className="checkbox checkbox-sm mt-1 checkbox-primary rounded-lg" 
                                  checked={item.seleccionado}
                                  onChange={() => toggleSelect(item.producto_id)}
                                />
                                <div className="flex flex-col gap-1">
                                  <span className="font-bold text-sm leading-tight">{item.producto_nombre}</span>
                                  <div className="flex flex-wrap gap-2 items-center">
                                    <Badge variant="outline" className="text-[9px] font-mono py-0 h-4">
                                      Stock: {item.stock_total} / Mín: {item.stock_minimo}
                                    </Badge>
                                    {item.total_en_camino > 0 && (
                                      <Badge className="bg-info/10 text-info border-info/20 text-[9px] py-0 h-4 gap-1">
                                        <Truck className="w-2.5 h-2.5" />
                                        {item.total_en_camino} en camino
                                      </Badge>
                                    )}
                                    {item.dias_autonomia !== undefined && (
                                      <Badge className={cn(
                                        "text-[9px] py-0 h-4",
                                        item.dias_autonomia <= 7 ? "bg-error/10 text-error border-error/20" : "bg-warning/10 text-warning border-warning/20"
                                      )}>
                                        Autonomía: ~{item.dias_autonomia}d
                                      </Badge>
                                    )}
                                  </div>
                                </div>
                              </div>

                              <div className="flex items-center gap-3 sm:justify-end">
                                <div className="flex flex-col items-end gap-1">
                                  <div className="flex items-center bg-base-200 rounded-xl p-1 px-2 border border-base-300">
                                    <span className="text-[10px] font-bold opacity-40 mr-2 uppercase">Pedir:</span>
                                    <input 
                                      type="number"
                                      className="w-16 bg-transparent text-center font-bold text-sm focus:outline-none"
                                      value={item.cantidad_sugerida}
                                      onChange={(e) => updateCantidad(item.producto_id, Number(e.target.value))}
                                    />
                                    <span className="text-[9px] font-bold opacity-40 ml-1 uppercase">{item.unidad_plural ?? autoPlural(item.unidad)}</span>
                                  </div>
                                </div>
                                <button 
                                  className="btn btn-ghost btn-sm btn-circle text-error opacity-20 hover:opacity-100 transition-opacity"
                                  onClick={() => removeItem(item.producto_id)}
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </div>

          <div className="space-y-6">
            <div className="card bg-base-100 border border-base-200 shadow-xl rounded-[2rem] overflow-hidden sticky top-24">
              <div className="p-6 bg-primary/5 border-b border-base-200 flex items-center gap-3">
                <div className="p-2 bg-primary/10 rounded-xl">
                  <ShoppingCart className="w-5 h-5 text-primary" />
                </div>
                <h3 className="font-bold">Resumen de Reposición</h3>
              </div>
              <div className="card-body p-6">
                <div className="space-y-4">
                  <div className="flex justify-between items-center text-sm">
                    <span className="opacity-60 font-medium">Total Productos</span>
                    <span className="font-bold tabular-nums text-lg">{totalSeleccionados}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="opacity-60 font-medium">Proveedores únicos</span>
                    <span className="font-bold">
                      {new Set(items.filter(i => i.seleccionado).map(i => i.proveedor_id)).size}
                    </span>
                  </div>
                </div>

                <div className="divider my-4"></div>

                <div className="space-y-3">
                  <label className="text-[10px] font-bold opacity-40 uppercase tracking-widest ml-1">Observaciones</label>
                  <textarea 
                    className="textarea textarea-bordered w-full text-sm h-32 rounded-2xl bg-base-200/20 border-base-200 focus:ring-2 ring-primary/10 transition-all resize-none"
                    placeholder="Instrucciones para el área de compras o almacén central..."
                    value={nota}
                    onChange={e => setNota(e.target.value)}
                  />
                </div>

                <Button 
                  className="w-full mt-8 h-14 rounded-2xl shadow-lg shadow-primary/20 gap-3 text-base font-bold transition-all active:scale-[0.98]" 
                  disabled={totalSeleccionados === 0 || mutation.isPending}
                  onClick={handleGenerar}
                >
                  {mutation.isPending ? <span className="loading loading-spinner loading-md" /> : <CheckCircle2 className="w-5 h-5" />}
                  Confirmar Reposición
                </Button>
              </div>
            </div>

            <div className="p-5 bg-blue-50 border border-blue-100 rounded-3xl flex gap-4 items-start">
              <div className="bg-blue-100 p-2 rounded-xl text-blue-600">
                <AlertCircle className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-xs font-bold text-blue-900 mb-1 leading-tight">Asistente de Abastecimiento</h4>
                <p className="text-[10px] text-blue-700 leading-normal opacity-80">
                  Las cantidades sugeridas se ajustan automáticamente según tu ritmo de uso real y el tiempo que tarda el proveedor en entregar.
                </p>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
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
                  [1, 2, 3].map(i => (
                    <tr key={i}>
                      <td colSpan={6} className="px-8"><Skeleton className="h-12 w-full rounded-xl" /></td>
                    </tr>
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
                          sol.estado === 'pendiente' && "bg-warning/10 text-warning border-warning/20",
                          sol.estado === 'aprobada' && "bg-success/10 text-success border-success/20",
                          sol.estado === 'rechazada' && "bg-error/10 text-error border-error/20",
                          sol.estado === 'enviada' && "bg-info/10 text-info border-info/20",
                          sol.estado === 'completada' && "bg-success text-success-content",
                          sol.estado === 'cancelada' && "bg-error/10 text-error border-error/20"
                        )}>
                          {sol.estado}
                        </Badge>
                      </td>
                      <td className="pr-8">
                        <div className="flex items-center gap-1 justify-end">
                          {isAdmin && sol.estado === 'pendiente' && (
                            <Button 
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0 text-warning hover:bg-warning/10"
                              onClick={() => setRevisando(sol)}
                            >
                              <ClipboardCheck className="w-4 h-4" />
                            </Button>
                          )}
                          <Button 
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 text-primary hover:bg-primary/10"
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
      )}

      {/* Modal de Revisión */}
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
              variant="outline" 
              className="flex-1 h-12 rounded-xl border-error text-error hover:bg-error hover:text-white"
              onClick={() => reviewMutation.mutate({ id: revisando!.id, estado: 'rechazada', nota: notaRevision })}
              disabled={reviewMutation.isPending}
            >
              <XCircle className="w-4 h-4 mr-2" />
              Rechazar
            </Button>
            <Button 
              className="flex-1 h-12 rounded-xl bg-success hover:bg-success/90 text-success-content"
              onClick={() => reviewMutation.mutate({ id: revisando!.id, estado: 'aprobada', nota: notaRevision })}
              disabled={reviewMutation.isPending}
            >
              <CheckCircle2 className="w-4 h-4 mr-2" />
              Aprobar
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  )
}