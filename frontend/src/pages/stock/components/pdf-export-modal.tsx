import { useState, useEffect, useRef } from 'react'
import { FileDown } from 'lucide-react'
import api from '@/lib/api'
import type { Area } from '@/types'
import { cn } from '@/lib/utils'

type AreaStockStatus = 'loading' | 'con-stock' | 'sin-stock'

export function PdfExportModal({
  areas,
  onClose,
  onExport,
}: {
  areas: Area[]
  onClose: () => void
  onExport: (selectedAreas: Area[], incluirResumen: boolean) => Promise<void>
}) {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set(areas.map((a) => a.id)))
  const [incluirResumen, setIncluirResumen] = useState(true)
  const [loading, setLoading] = useState(false)
  const [areaStatus, setAreaStatus] = useState<Record<number, AreaStockStatus>>(() =>
    Object.fromEntries(areas.map((a) => [a.id, 'loading' as AreaStockStatus]))
  )
  const fetchedRef = useRef(false)

  // Usa /stock/area/:id (solo devuelve items con cantidad > 0) para detección real de stock
  useEffect(() => {
    if (fetchedRef.current || areas.length === 0) return
    fetchedRef.current = true
    Promise.all(
      areas.map((area) =>
        api
          .get<{ area: unknown; productos: unknown[] }>(`/stock/area/${area.id}`, { params: { per_page: 1 } })
          .then((r) => ({ id: area.id, hasStock: r.data.productos.length > 0 }))
          .catch(() => ({ id: area.id, hasStock: false }))
      )
    ).then((results) => {
      setAreaStatus(
        Object.fromEntries(results.map((r) => [r.id, r.hasStock ? 'con-stock' : 'sin-stock']))
      )
    })
  }, [areas])

  const isLoadingStatus = Object.values(areaStatus).some((s) => s === 'loading')
  const areasConStock = areas.filter((a) => areaStatus[a.id] === 'con-stock').sort((a, b) => a.nombre.localeCompare(b.nombre))
  const areasSinStock = areas.filter((a) => areaStatus[a.id] !== 'con-stock').sort((a, b) => a.nombre.localeCompare(b.nombre))
  const countConStock = areasConStock.length

  const toggleArea = (id: number) =>
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })

  const selectOnlyWithStock = () =>
    setSelectedIds(new Set(areasConStock.map((a) => a.id)))

  const toggleAll = () =>
    setSelectedIds(selectedIds.size === areas.length ? new Set() : new Set(areas.map((a) => a.id)))

  async function handleExport() {
    if (selectedIds.size === 0) return
    setLoading(true)
    const selected = areas.filter((a) => selectedIds.has(a.id))
    await onExport(selected, incluirResumen)
    setLoading(false)
  }

  const AreaChip = ({ area, status }: { area: Area; status: AreaStockStatus }) => {
    const checked = selectedIds.has(area.id)
    return (
      <button
        type="button"
        onClick={() => toggleArea(area.id)}
        className={cn(
          "relative flex items-center gap-2 px-3 py-2 rounded-xl border text-left transition-all w-full",
          checked
            ? status === 'con-stock'
              ? "bg-success/10 border-success/30 shadow-sm"
              : "bg-base-200 border-base-300 shadow-sm"
            : "border-transparent hover:bg-base-200/60 opacity-50"
        )}
      >
        <span className={cn(
          "w-2 h-2 rounded-full shrink-0 mt-0.5",
          status === 'loading' ? "bg-base-300 animate-pulse" :
          status === 'con-stock' ? "bg-success" : "bg-base-400"
        )} />
        <span className="text-sm font-medium leading-tight truncate flex-1">{area.nombre}</span>
        {area.es_bodega && (
          <span className="text-[9px] font-bold uppercase tracking-wider opacity-40 shrink-0">BD</span>
        )}
        {checked && (
          <span className={cn(
            "absolute top-1.5 right-1.5 w-3.5 h-3.5 rounded-full flex items-center justify-center text-white text-[8px] font-bold shrink-0",
            status === 'con-stock' ? "bg-success" : "bg-base-content/30"
          )}>✓</span>
        )}
      </button>
    )
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-base-100 rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden border border-base-200 flex flex-col max-h-[90vh]">

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 shrink-0">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-primary/10 rounded-xl text-primary">
                <FileDown className="h-4 w-4" />
              </div>
              <h2 className="font-bold text-base tracking-tight">Reporte de Inventario</h2>
            </div>
            <p className="text-[11px] opacity-40 mt-1 ml-10">PDF con stock por sección · carta horizontal</p>
          </div>
          <button className="btn btn-sm btn-ghost btn-circle" onClick={onClose}>✕</button>
        </div>

        {/* ── Body (scrollable) ── */}
        <div className="overflow-y-auto px-6 pb-2 flex-1 space-y-5">

          {/* Secciones */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-wider opacity-50">Secciones</p>
              <div className="flex items-center gap-3">
                {!isLoadingStatus && countConStock > 0 && (
                  <button
                    className="text-[11px] font-bold text-success hover:opacity-70 transition-opacity"
                    onClick={selectOnlyWithStock}
                  >
                    Solo con stock ({countConStock})
                  </button>
                )}
                <button
                  className="text-[11px] font-bold text-primary hover:opacity-70 transition-opacity"
                  onClick={toggleAll}
                >
                  {selectedIds.size === areas.length ? 'Limpiar' : 'Todas'}
                </button>
              </div>
            </div>

            {/* Contador seleccionados */}
            <div className="flex items-center gap-2 text-[11px] opacity-50">
              <span>{selectedIds.size} de {areas.length} seleccionadas</span>
              {!isLoadingStatus && (
                <span className="opacity-60">·
                  <span className="text-success ml-1">{countConStock} con stock</span>
                  {' · '}
                  <span className="ml-0.5">{areas.length - countConStock} sin stock</span>
                </span>
              )}
            </div>

            {isLoadingStatus ? (
              /* Skeleton mientras carga el estado */
              <div className="grid grid-cols-2 gap-1.5">
                {areas.map((area) => (
                  <div key={area.id} className="h-9 rounded-xl bg-base-200 animate-pulse" />
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                {/* Grupo: Con stock */}
                {areasConStock.length > 0 && (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-success" />
                      <span className="text-[9px] font-bold uppercase tracking-widest text-success opacity-70">Con stock</span>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      {areasConStock.map((area) => (
                        <AreaChip key={area.id} area={area} status="con-stock" />
                      ))}
                    </div>
                  </div>
                )}

                {/* Grupo: Sin stock */}
                {areasSinStock.length > 0 && (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-base-400" />
                      <span className="text-[9px] font-bold uppercase tracking-widest opacity-40">Sin stock registrado</span>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      {areasSinStock.map((area) => (
                        <AreaChip key={area.id} area={area} status="sin-stock" />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Opciones del reporte */}
          <div className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-wider opacity-50">Contenido del PDF</p>
            <button
              type="button"
              onClick={() => setIncluirResumen((v) => !v)}
              className={cn(
                "w-full flex items-center gap-4 px-4 py-3 rounded-2xl border transition-all text-left",
                incluirResumen ? "bg-primary/5 border-primary/20" : "border-base-200 hover:bg-base-200/50 opacity-60"
              )}
            >
              <div className={cn(
                "w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors",
                incluirResumen ? "bg-primary border-primary text-white" : "border-base-300"
              )}>
                {incluirResumen && <span className="text-[10px] font-bold">✓</span>}
              </div>
              <div>
                <p className="text-sm font-bold">Resumen Ejecutivo</p>
                <p className="text-[10px] opacity-50 mt-0.5">Página inicial con KPIs: total de insumos, alertas y áreas</p>
              </div>
            </button>
          </div>

        </div>

        {/* ── Footer ── */}
        <div className="px-6 py-4 border-t border-base-200 flex items-center justify-between shrink-0">
          <p className="text-[11px] opacity-40">
            {selectedIds.size === 0
              ? 'Selecciona al menos una sección'
              : `${selectedIds.size} ${selectedIds.size === 1 ? 'sección' : 'secciones'} · PDF carta horizontal`}
          </p>
          <div className="flex gap-2">
            <button className="btn btn-ghost btn-sm h-9 px-4 font-bold" onClick={onClose}>Cancelar</button>
            <button
              className="btn btn-primary btn-sm h-9 px-5 font-bold gap-2"
              disabled={selectedIds.size === 0 || loading}
              onClick={handleExport}
            >
              {loading ? (
                <span className="loading loading-spinner loading-xs" />
              ) : (
                <FileDown className="h-3.5 w-3.5" />
              )}
              {loading ? 'Generando...' : 'Generar PDF'}
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}
