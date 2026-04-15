// frontend/src/pages/recepciones/components/labels-section.tsx
import { useState } from 'react'
import { Printer, ChevronDown, ChevronUp } from 'lucide-react'
import { formatCantidad } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { imprimirEtiquetas, type LoteParaEtiqueta } from '@/lib/label-print'
import { toast } from 'sonner'
import { isLoteComplete, type DetalleLineUI } from './item-card'

interface Props {
  // Fase 1: durante el llenado del formulario
  detalles?: DetalleLineUI[]
  onToggleEtiqueta?: (detalleId: string, loteId: string, incluir: boolean) => void
  onCantidadEtiqueta?: (detalleId: string, loteId: string, cant: number) => void
  // Fase 2: tras confirmar — imprime con los lotes reales del servidor
  lotesConfirmados?: LoteParaEtiqueta[]
}

export function LabelsSection({ detalles, onToggleEtiqueta, onCantidadEtiqueta, lotesConfirmados }: Props) {
  const [imprimiendo, setImprimiendo] = useState(false)
  const [collapsed, setCollapsed] = useState(false)

  // ── Fase post-confirmación ────────────────────────────────────────────────
  if (lotesConfirmados) {
    const total = lotesConfirmados.reduce((s, l) => s + l.cantidad_etiquetas, 0)

    const handlePrint = async () => {
      setImprimiendo(true)
      try {
        await imprimirEtiquetas(lotesConfirmados)
      } catch {
        toast.error('Error al generar etiquetas')
      } finally {
        setImprimiendo(false)
      }
    }

    return (
      <div className="card bg-base-100 border border-primary/30 p-4">
        <p className="font-semibold text-sm mb-3">🏷️ Etiquetas listas para imprimir</p>
        <div className="space-y-1 mb-3">
          {lotesConfirmados.map(l => (
            <div key={l.lote_id} className="flex justify-between text-xs text-base-content/70">
              <span className="truncate">{l.producto_nombre}</span>
              <span className="font-mono ml-2">{l.codigo_interno} · {l.cantidad_etiquetas} etiq.</span>
            </div>
          ))}
        </div>
        <Button className="w-full" onClick={handlePrint} disabled={imprimiendo}>
          <Printer className="h-4 w-4 mr-2" />
          {imprimiendo ? 'Generando…' : `Imprimir ${formatCantidad(total, 'etiqueta', 'etiquetas')}`}
        </Button>
      </div>
    )
  }

  // ── Fase pre-confirmación ─────────────────────────────────────────────────
  if (!detalles || detalles.length === 0) return null

  // Aplanar lotes de todos los detalles
  const lotesCompletos = detalles.flatMap(d =>
    d.lotes
      .filter(l => isLoteComplete(l) && d.area_destino_id)
      .map(l => ({ ...l, detalleId: d.id, producto_nombre: d.producto_nombre, area_destino_nombre: d.area_destino_nombre }))
  )

  const lotesIncompletos = detalles.flatMap(d =>
    d.lotes
      .filter(l => !isLoteComplete(l) || !d.area_destino_id)
      .map(l => ({ ...l, detalleId: d.id, producto_nombre: d.producto_nombre }))
  )

  if (lotesCompletos.length === 0) return null

  const totalEtiquetas = lotesCompletos
    .filter(l => l.incluir_etiqueta)
    .reduce((s, l) => s + l.cantidad_etiquetas, 0)

  return (
    <div className="card bg-base-100 border border-dashed p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="font-semibold text-sm">🏷️ Configurar etiquetas</p>
        <button
          className="btn btn-ghost btn-xs btn-circle"
          onClick={() => setCollapsed(c => !c)}
          aria-label={collapsed ? 'Expandir' : 'Colapsar'}
        >
          {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
        </button>
      </div>

      {!collapsed && (
        <div className="space-y-2">
          {lotesCompletos.map(l => (
            <div key={l.id} className="flex items-center gap-3 px-3 py-2 rounded-lg border border-base-200 text-sm">
              <input
                type="checkbox"
                className="checkbox checkbox-sm checkbox-primary"
                checked={l.incluir_etiqueta}
                onChange={e => onToggleEtiqueta?.(l.detalleId, l.id, e.target.checked)}
              />
              <span className="flex-1 truncate text-xs">{l.producto_nombre}</span>
              <span className="text-xs opacity-50 font-mono truncate">
                {l.codigo_lote}
                {l.fecha_vencimiento ? ` · ${l.fecha_vencimiento}` : ''}
                {l.area_destino_nombre ? ` · ${l.area_destino_nombre}` : ''}
              </span>
              {l.incluir_etiqueta && (
                <input
                  type="number"
                  min={1}
                  max={99}
                  className="input input-xs input-bordered w-14 text-center"
                  value={l.cantidad_etiquetas}
                  onChange={e => onCantidadEtiqueta?.(l.detalleId, l.id, Math.max(1, Number(e.target.value)))}
                />
              )}
            </div>
          ))}

          {lotesIncompletos.map(l => (
            <div
              key={l.id}
              className="opacity-40 cursor-not-allowed flex items-center gap-3 px-3 py-2 rounded-lg border border-base-200"
            >
              <input type="checkbox" className="checkbox checkbox-sm" disabled />
              <span className="flex-1 text-sm">{l.producto_nombre}</span>
              <span className="badge badge-xs badge-ghost">Datos incompletos</span>
            </div>
          ))}
        </div>
      )}

      {totalEtiquetas > 0 && (
        <p className="text-xs opacity-50 mt-2 text-right">
          {formatCantidad(totalEtiquetas, 'etiqueta', 'etiquetas')} se imprimirán al confirmar
        </p>
      )}
    </div>
  )
}
