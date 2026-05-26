import { useMemo, useState } from 'react'
import { useQueries, useQuery } from '@tanstack/react-query'
import { BarChart3, CalendarDays, Download, PackageSearch, Trash2 } from 'lucide-react'
import api from '@/lib/api'
import {
  reportesApi,
  type ConsumoCalendarioRow,
  type ConsumoProductoRow,
  type TopDescartadoRow,
} from '@/api/reportes'
import { exportToExcel } from '@/lib/export-excel'
import { formatCantidad, formatDate } from '@/lib/utils'
import type { Area, PaginatedResponse } from '@/types'

type Tab = 'calendario' | 'productos' | 'descartes'

interface ProductoOption {
  id: string
  nombre: string
  codigo_interno?: string
}

function hoy() {
  return new Date().toISOString().slice(0, 10)
}

function hace30Dias() {
  const d = new Date()
  d.setDate(d.getDate() - 30)
  return d.toISOString().slice(0, 10)
}

function plural(n: number, singular: string, pluralText: string) {
  return n === 1 ? singular : pluralText
}

export default function ReportesPage() {
  const [tab, setTab] = useState<Tab>('calendario')
  const [desde, setDesde] = useState(hace30Dias)
  const [hasta, setHasta] = useState(hoy)
  const [areaId, setAreaId] = useState('')
  const [productoId, setProductoId] = useState('')
  const [productoSearch, setProductoSearch] = useState('')

  const params = {
    desde,
    hasta,
    area_id: areaId ? Number(areaId) : undefined,
    producto_id: productoId || undefined,
  }

  const { data: areas } = useQuery({
    queryKey: ['areas'],
    queryFn: () => api.get<Area[]>('/areas').then((r) => r.data),
  })

  const { data: productos } = useQuery({
    queryKey: ['reportes-productos', productoSearch],
    queryFn: () =>
      api
        .get<PaginatedResponse<ProductoOption>>('/productos', {
          params: { q: productoSearch || undefined, per_page: 25 },
        })
        .then((r) => r.data.data),
  })

  const [calendarioQ, productosQ, descartesQ] = useQueries({
    queries: [
      {
        queryKey: ['reportes', 'consumo-calendario', params],
        queryFn: () => reportesApi.consumoCalendario({ ...params, limit: 500 }),
      },
      {
        queryKey: ['reportes', 'consumo-productos', params],
        queryFn: () => reportesApi.consumoProductos({ ...params, limit: 100 }),
      },
      {
        queryKey: ['reportes', 'top-descartados', params],
        queryFn: () => reportesApi.topDescartados({ ...params, limit: 50 }),
      },
    ],
  })

  const loading = calendarioQ.isLoading || productosQ.isLoading || descartesQ.isLoading

  const dias = useMemo(() => {
    const grupos = new Map<string, ConsumoCalendarioRow[]>()
    ;(calendarioQ.data ?? []).forEach((row) => {
      grupos.set(row.fecha, [...(grupos.get(row.fecha) ?? []), row])
    })
    return Array.from(grupos.entries()).map(([fecha, rows]) => ({
      fecha,
      rows,
      movimientos: rows.reduce((acc, row) => acc + row.movimientos_count, 0),
      productos: new Set(rows.map((row) => row.producto_id)).size,
    }))
  }, [calendarioQ.data])

  function exportarExcel() {
    const calendario = calendarioQ.data ?? []
    const consumoProductos = productosQ.data ?? []
    const descartos = descartesQ.data ?? []
    exportToExcel(`reportes_${desde}_${hasta}`, [
      {
        name: 'Consumo diario',
        headers: ['Fecha', 'Area', 'Producto', 'Cantidad', 'Unidad', 'Movimientos', 'Ultimo uso'],
        rows: calendario.map((r: ConsumoCalendarioRow) => [
          r.fecha,
          r.area_nombre,
          r.producto_nombre,
          r.total_consumido,
          r.total_consumido === 1 ? r.unidad : r.unidad_plural,
          r.movimientos_count,
          r.ultimo_consumo,
        ]),
      },
      {
        name: 'Consumo por producto',
        headers: ['Producto', 'Total consumido', 'Unidad', 'Dias con uso', 'Areas', 'Movimientos', 'Ultimo consumo'],
        rows: consumoProductos.map((r: ConsumoProductoRow) => [
          r.producto_nombre,
          r.total_consumido,
          r.total_consumido === 1 ? r.unidad : r.unidad_plural,
          r.dias_uso,
          r.areas_distintas,
          r.movimientos_count,
          r.ultimo_consumo,
        ]),
      },
      {
        name: 'Top descartados',
        headers: ['Producto', 'Total descartado', 'Unidad', 'Movimientos'],
        rows: descartos.map((r: TopDescartadoRow) => [
          r.producto_nombre,
          r.total_descartado,
          r.total_descartado === 1 ? r.unidad : r.unidad_plural,
          r.movimientos_count,
        ]),
      },
    ])
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between border-b border-base-300 pb-4">
        <div>
          <h1 className="t-h1">Reportes</h1>
          <p className="text-sm text-base-content/60 mt-1">Consumo por dia, producto y descartes del periodo.</p>
        </div>
        <button className="btn btn-primary btn-sm gap-2" onClick={exportarExcel} disabled={loading}>
          <Download className="w-4 h-4" />
          Exportar Excel
        </button>
      </div>

      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold uppercase tracking-widest text-base-content/40">Desde</label>
          <input
            type="date"
            className="input input-sm input-bordered bg-base-100 border border-base-300 rounded-lg"
            value={desde}
            max={hasta}
            onChange={(e) => setDesde(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold uppercase tracking-widest text-base-content/40">Hasta</label>
          <input
            type="date"
            className="input input-sm input-bordered bg-base-100 border border-base-300 rounded-lg"
            value={hasta}
            min={desde}
            max={hoy()}
            onChange={(e) => setHasta(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1 min-w-[180px]">
          <label className="text-[10px] font-bold uppercase tracking-widest text-base-content/40">Area</label>
          <select
            className="select select-sm select-bordered bg-base-100 border border-base-300 rounded-lg"
            value={areaId}
            onChange={(e) => setAreaId(e.target.value)}
          >
            <option value="">Todas</option>
            {(areas ?? []).map((area) => (
              <option key={area.id} value={area.id}>{area.nombre}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1 min-w-[220px]">
          <label className="text-[10px] font-bold uppercase tracking-widest text-base-content/40">Producto</label>
          <input
            className="input input-sm input-bordered bg-base-100 border border-base-300 rounded-lg"
            list="reportes-productos"
            placeholder="Buscar producto"
            value={productoSearch}
            onChange={(e) => {
              setProductoSearch(e.target.value)
              const found = (productos ?? []).find((p) => p.nombre === e.target.value)
              setProductoId(found?.id ?? '')
            }}
          />
          <datalist id="reportes-productos">
            {(productos ?? []).map((p) => (
              <option key={p.id} value={p.nombre} />
            ))}
          </datalist>
        </div>
        {(areaId || productoId || productoSearch) && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setAreaId('')
              setProductoId('')
              setProductoSearch('')
            }}
          >
            Limpiar
          </button>
        )}
      </div>

      <div className="tabs tabs-boxed w-fit">
        <button className={`tab gap-2 ${tab === 'calendario' ? 'tab-active' : ''}`} onClick={() => setTab('calendario')}>
          <CalendarDays className="w-4 h-4" />
          Calendario
        </button>
        <button className={`tab gap-2 ${tab === 'productos' ? 'tab-active' : ''}`} onClick={() => setTab('productos')}>
          <PackageSearch className="w-4 h-4" />
          Productos
        </button>
        <button className={`tab gap-2 ${tab === 'descartes' ? 'tab-active' : ''}`} onClick={() => setTab('descartes')}>
          <Trash2 className="w-4 h-4" />
          Descartes
        </button>
      </div>

      {tab === 'calendario' && (
        <section className="card bg-base-100 border border-base-200 shadow-sm">
          <div className="card-body gap-3 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <CalendarDays className="w-4 h-4 text-primary" />
                <h2 className="font-semibold text-sm">Uso diario</h2>
              </div>
              <span className="text-xs text-base-content/50">{dias.length} {plural(dias.length, 'dia', 'dias')} con consumo</span>
            </div>
            {calendarioQ.isLoading ? (
              <div className="flex justify-center py-6"><span className="loading loading-spinner loading-md" /></div>
            ) : dias.length === 0 ? (
              <div className="text-center text-base-content/40 py-8 text-sm">Sin consumos en el periodo</div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {dias.map((dia) => (
                  <article key={dia.fecha} className="rounded-lg border border-base-200 bg-base-50 p-3">
                    <div className="flex items-start justify-between gap-3 border-b border-base-200 pb-2 mb-2">
                      <div>
                        <div className="font-semibold text-sm">{formatDate(`${dia.fecha}T00:00:00`)}</div>
                        <div className="text-[11px] text-base-content/45">
                          {dia.productos} {plural(dia.productos, 'producto', 'productos')} · {dia.movimientos} {plural(dia.movimientos, 'movimiento', 'movimientos')}
                        </div>
                      </div>
                    </div>
                    <div className="space-y-2">
                      {dia.rows.map((row) => (
                        <div key={`${row.fecha}-${row.area_id}-${row.producto_id}`} className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">{row.producto_nombre}</p>
                            <p className="text-[11px] text-base-content/45 truncate">{row.area_nombre} · ultimo {row.ultimo_consumo}</p>
                          </div>
                          <span className="font-mono text-sm font-semibold whitespace-nowrap">
                            {formatCantidad(row.total_consumido, row.unidad, row.unidad_plural)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {tab === 'productos' && (
        <section className="card bg-base-100 border border-base-200 shadow-sm">
          <div className="card-body gap-3 p-4">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-primary" />
              <h2 className="font-semibold text-sm">Consumo por producto</h2>
            </div>
            {productosQ.isLoading ? (
              <div className="flex justify-center py-6"><span className="loading loading-spinner loading-md" /></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="table table-sm table-zebra w-full">
                  <thead>
                    <tr>
                      <th>Producto</th>
                      <th className="text-right">Cantidad usada</th>
                      <th className="text-right">Dias</th>
                      <th className="text-right">Areas</th>
                      <th className="text-right">Movimientos</th>
                      <th>Ultimo consumo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(productosQ.data ?? []).length === 0 ? (
                      <tr><td colSpan={6} className="text-center text-base-content/40 py-6 text-sm">Sin consumos en el periodo</td></tr>
                    ) : (
                      (productosQ.data ?? []).map((row: ConsumoProductoRow) => (
                        <tr key={row.producto_id}>
                          <td className="font-medium">{row.producto_nombre}</td>
                          <td className="text-right tabular-nums font-medium">{formatCantidad(row.total_consumido, row.unidad, row.unidad_plural)}</td>
                          <td className="text-right tabular-nums">{row.dias_uso}</td>
                          <td className="text-right tabular-nums">{row.areas_distintas}</td>
                          <td className="text-right tabular-nums">{row.movimientos_count}</td>
                          <td className="text-base-content/60 text-xs">{row.ultimo_consumo}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      )}

      {tab === 'descartes' && (
        <section className="card bg-base-100 border border-base-200 shadow-sm">
          <div className="card-body gap-3 p-4">
            <div className="flex items-center gap-2">
              <Trash2 className="w-4 h-4 text-error" />
              <h2 className="font-semibold text-sm">Top productos descartados</h2>
            </div>
            {descartesQ.isLoading ? (
              <div className="flex justify-center py-6"><span className="loading loading-spinner loading-md" /></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="table table-sm table-zebra w-full">
                  <thead>
                    <tr>
                      <th>Producto</th>
                      <th className="text-right">Total descartado</th>
                      <th className="text-right">Movimientos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(descartesQ.data ?? []).length === 0 ? (
                      <tr><td colSpan={3} className="text-center text-base-content/40 py-6 text-sm">Sin descartes en el periodo</td></tr>
                    ) : (
                      (descartesQ.data ?? []).map((row: TopDescartadoRow) => (
                        <tr key={row.producto_id}>
                          <td className="font-medium">{row.producto_nombre}</td>
                          <td className="text-right tabular-nums">{formatCantidad(row.total_descartado, row.unidad, row.unidad_plural)}</td>
                          <td className="text-right tabular-nums">{row.movimientos_count}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  )
}
