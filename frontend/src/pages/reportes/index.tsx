import { useState } from 'react'
import { useQueries } from '@tanstack/react-query'
import { Download, BarChart3, Trash2 } from 'lucide-react'
import { reportesApi, type ConsumoAreaRow, type TopDescartadoRow } from '@/api/reportes'
import { exportToExcel } from '@/lib/export-excel'
import { formatCantidad } from '@/lib/utils'

function hoy() {
  return new Date().toISOString().slice(0, 10)
}

function hace90Dias() {
  const d = new Date()
  d.setDate(d.getDate() - 90)
  return d.toISOString().slice(0, 10)
}

export default function ReportesPage() {
  const [desde, setDesde] = useState(hace90Dias)
  const [hasta, setHasta] = useState(hoy)
  const params = { desde, hasta }

  const [consumoQ, descartosQ] = useQueries({
    queries: [
      {
        queryKey: ['reportes', 'consumo-area', params],
        queryFn: () => reportesApi.consumoArea(params),
      },
      {
        queryKey: ['reportes', 'top-descartados', params],
        queryFn: () => reportesApi.topDescartados(params),
      },
    ],
  })

  const loading = consumoQ.isLoading || descartosQ.isLoading

  function exportarExcel() {
    const consumo = consumoQ.data ?? []
    const descartos = descartosQ.data ?? []
    exportToExcel(`reportes_${desde}_${hasta}`, [
      {
        name: 'Consumo por área',
        headers: ['Área', 'Mes', 'Total consumido', 'Productos distintos', 'Movimientos'],
        rows: consumo.map((r: ConsumoAreaRow) => [r.area_nombre, r.mes, r.total_consumido, r.unidades_distintas, r.movimientos_count]),
      },
      {
        name: 'Top descartados',
        headers: ['Producto', 'Total descartado', 'Unidad', 'Movimientos'],
        rows: descartos.map((r: TopDescartadoRow) => [r.producto_nombre, r.total_descartado, r.unidad, r.movimientos_count]),
      },
    ])
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between border-b border-base-300 pb-4">
        <div>
          <h1 className="t-h1">Reportes</h1>
          <p className="text-sm text-base-content/60 mt-1">Consumo y descartes por período.</p>
        </div>
        <button
          className="btn btn-primary btn-sm gap-2"
          onClick={exportarExcel}
          disabled={loading}
        >
          <Download className="w-4 h-4" />
          Exportar Excel
        </button>
      </div>

      {/* Filtros de fecha */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold uppercase tracking-widest text-base-content/40">Desde</label>
          <input
            type="date"
            className="input input-sm input-bordered bg-base-100 border border-base-300 rounded-xl"
            value={desde}
            max={hasta}
            onChange={(e) => setDesde(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold uppercase tracking-widest text-base-content/40">Hasta</label>
          <input
            type="date"
            className="input input-sm input-bordered bg-base-100 border border-base-300 rounded-xl"
            value={hasta}
            min={desde}
            max={hoy()}
            onChange={(e) => setHasta(e.target.value)}
          />
        </div>
      </div>

      {/* Tabla: Consumo por área y mes */}
      <section className="card bg-base-100 border border-base-200 shadow-sm">
        <div className="card-body gap-3 p-4">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-primary" />
            <h2 className="font-semibold text-sm">Consumo por área y mes</h2>
          </div>
          {consumoQ.isLoading ? (
            <div className="flex justify-center py-6"><span className="loading loading-spinner loading-md" /></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table table-sm table-zebra w-full">
                <thead>
                  <tr>
                    <th>Área</th>
                    <th>Mes</th>
                    <th className="text-right">Total consumido</th>
                    <th className="text-right">Productos</th>
                    <th className="text-right">Movimientos</th>
                  </tr>
                </thead>
                <tbody>
                  {(consumoQ.data ?? []).length === 0 ? (
                    <tr><td colSpan={5} className="text-center text-base-content/40 py-6 text-sm">Sin datos en el período</td></tr>
                  ) : (
                    (consumoQ.data ?? []).map((row: ConsumoAreaRow, i: number) => (
                      <tr key={i}>
                        <td className="font-medium">{row.area_nombre}</td>
                        <td className="text-base-content/60">{row.mes}</td>
                        <td className="text-right tabular-nums">{row.total_consumido.toFixed(1)}</td>
                        <td className="text-right tabular-nums">{row.unidades_distintas}</td>
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

      {/* Tabla: Top descartados */}
      <section className="card bg-base-100 border border-base-200 shadow-sm">
        <div className="card-body gap-3 p-4">
          <div className="flex items-center gap-2">
            <Trash2 className="w-4 h-4 text-error" />
            <h2 className="font-semibold text-sm">Top productos descartados</h2>
          </div>
          {descartosQ.isLoading ? (
            <div className="flex justify-center py-6"><span className="loading loading-spinner loading-md" /></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table table-sm table-zebra w-full">
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th className="text-right">Total descartado</th>
                    <th>Unidad</th>
                    <th className="text-right">Movimientos</th>
                  </tr>
                </thead>
                <tbody>
                  {(descartosQ.data ?? []).length === 0 ? (
                    <tr><td colSpan={4} className="text-center text-base-content/40 py-6 text-sm">Sin descartes en el período</td></tr>
                  ) : (
                    (descartosQ.data ?? []).map((row: TopDescartadoRow, i: number) => (
                      <tr key={i}>
                        <td className="font-medium">{row.producto_nombre}</td>
                        <td className="text-right tabular-nums">{formatCantidad(row.total_descartado, row.unidad)}</td>
                        <td className="text-base-content/60 text-xs">{row.unidad}</td>
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
    </div>
  )
}
