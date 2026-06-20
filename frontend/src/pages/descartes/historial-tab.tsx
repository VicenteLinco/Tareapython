import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ChevronDown, ChevronRight, Download, FileDown, Calendar,
} from 'lucide-react'
import api from '@/lib/api'
import type { Area, DescarteSession } from '@/types'
import { formatCantidad, formatDate, APP_LOCALE } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useDescartesHistorial } from './use-descartes-historial'
import { exportarDescartePDF, exportarDescartesRangoPDF } from '@/lib/descarte-pdf'

export function HistorialTab() {
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [filterAreaId, setFilterAreaId] = useState<number | null>(null)
  const [page, setPage] = useState(1)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const { data: areas } = useQuery({
    queryKey: ['areas'],
    queryFn: () => api.get<Area[]>('/areas').then((r) => r.data),
  })

  const { data: config } = useQuery({
    queryKey: ['configuracion'],
    queryFn: () => api.get<Record<string, string>>('/configuracion').then((r) => r.data),
  })

  const { data, isLoading, isError } = useDescartesHistorial({
    desde: desde || null,
    hasta: hasta || null,
    areaId: filterAreaId,
    page,
    perPage: 20,
  })

  const nombreLab = config?.nombre_laboratorio ?? 'Laboratorio Clínico'
  const logoLab = config?.logo_base64 ?? null

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleExportarRango = () => {
    if (!data?.data?.length) return
    exportarDescartesRangoPDF(data.data, desde || null, hasta || null, nombreLab, logoLab)
  }

  const sessions = data?.data ?? []
  const total = data?.total ?? 0
  const totalPages = data?.total_pages ?? 0

  return (
    <div className="flex flex-col gap-4 flex-1 min-h-0">
      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-3 bg-base-100 p-4 rounded-2xl border border-base-200">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 opacity-40" />
          <input
            type="date"
            className="input input-bordered input-sm"
            value={desde}
            onChange={(e) => { setDesde(e.target.value); setPage(1) }}
          />
          <span className="opacity-40 text-sm">→</span>
          <input
            type="date"
            className="input input-bordered input-sm"
            value={hasta}
            onChange={(e) => { setHasta(e.target.value); setPage(1) }}
          />
        </div>

        <select
          className="select select-bordered select-sm"
          value={filterAreaId ?? ''}
          onChange={(e) => { setFilterAreaId(e.target.value ? Number(e.target.value) : null); setPage(1) }}
        >
          <option value="">Todas las áreas</option>
          {areas?.map((a) => (
            <option key={a.id} value={a.id}>{a.nombre}</option>
          ))}
        </select>

        <div className="ml-auto">
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            disabled={sessions.length === 0}
            onClick={handleExportarRango}
          >
            <FileDown className="w-4 h-4" />
            Exportar PDF
          </Button>
        </div>
      </div>

      {/* Lista de sesiones */}
      <div className="flex-1 overflow-y-auto space-y-3">
        {isLoading ? (
          [1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-base-200 animate-pulse rounded-2xl" />
          ))
        ) : isError ? (
          <div className="py-20 text-center text-error text-sm">
            Error al cargar el historial. Intenta recargar la página.
          </div>
        ) : sessions.length === 0 ? (
          <div className="py-20 text-center opacity-40 italic text-sm">
            No hay descartes registrados en este período
          </div>
        ) : (
          sessions.map((session: DescarteSession) => {
            const isOpen = expanded.has(session.grupo_movimiento)
            return (
              <div
                key={session.grupo_movimiento}
                className="bg-base-100 border border-base-200 rounded-2xl overflow-hidden"
              >
                {/* Cabecera de sesión */}
                <div
                  className="flex items-center gap-3 px-5 py-4 cursor-pointer hover:bg-base-200/30 transition-colors"
                  onClick={() => toggleExpand(session.grupo_movimiento)}
                >
                  {isOpen ? (
                    <ChevronDown className="w-4 h-4 opacity-40 shrink-0" />
                  ) : (
                    <ChevronRight className="w-4 h-4 opacity-40 shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-sm">{formatDate(session.fecha)}</span>
                      <span className="text-xs opacity-50">
                        {new Date(session.fecha).toLocaleTimeString(APP_LOCALE, { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <span className="text-xs opacity-50">·</span>
                      <span className="text-xs opacity-60">{session.usuario_nombre}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      {session.areas.map((area) => (
                        <Badge key={area} variant="outline" className="text-[10px] h-4 px-1.5">
                          {area}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-xs font-bold opacity-50">
                      {session.total_items} {session.total_items === 1 ? 'ítem' : 'ítems'}
                    </span>
                    <button
                      className="btn btn-ghost btn-xs gap-1"
                      title="Descargar PDF de esta sesión"
                      onClick={(e) => {
                        e.stopPropagation()
                        exportarDescartePDF(session, nombreLab, logoLab)
                      }}
                    >
                      <Download className="w-3.5 h-3.5" />
                      PDF
                    </button>
                  </div>
                </div>

                {/* Ítems expandidos */}
                {isOpen && (
                  <div className="border-t border-base-200">
                    <table className="table table-xs w-full">
                      <thead>
                        <tr className="bg-base-200/50 text-[10px] uppercase tracking-wider opacity-60">
                          <th>Producto</th>
                          <th>Lote</th>
                          <th>Área</th>
                          <th>Motivo</th>
                          <th className="text-right">Cantidad</th>
                          <th>Vencimiento</th>
                          <th>Nota</th>
                        </tr>
                      </thead>
                      <tbody>
                        {session.items.map((item, i) => (
                          <tr key={i} className="hover:bg-base-200/20">
                            <td className="font-medium text-xs">{item.producto_nombre}</td>
                            <td className="font-mono text-[10px] opacity-60">{item.codigo_lote}</td>
                            <td className="text-xs opacity-70">{item.area_nombre}</td>
                            <td>
                              <Badge
                                variant={item.tipo === 'DESCARTE_VENCIDO' ? 'destructive' : 'outline'}
                                className="text-[9px] h-4 px-1"
                              >
                                {item.tipo === 'DESCARTE_VENCIDO' ? 'Vencido' : 'Dañado'}
                              </Badge>
                            </td>
                            <td className="text-right font-mono font-bold text-xs">
                              {formatCantidad(
                                Number(item.cantidad),
                                item.unidad_base_nombre,
                                item.unidad_base_nombre_plural
                              )}
                            </td>
                            <td className="text-xs opacity-60">{formatDate(item.fecha_vencimiento)}</td>
                            <td className="text-[10px] opacity-50 max-w-[120px] truncate">
                              {item.nota ?? '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* Paginación */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm opacity-60">
          <span>{total} sesiones en total</span>
          <div className="flex items-center gap-2">
            <button
              className="btn btn-ghost btn-xs"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              ←
            </button>
            <span>
              {page} / {totalPages}
            </span>
            <button
              className="btn btn-ghost btn-xs"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
