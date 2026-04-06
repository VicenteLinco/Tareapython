// frontend/src/pages/recepciones/components/labels-section.tsx
import { useState } from 'react'
import { Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { imprimirEtiquetas, type LoteParaEtiqueta } from '@/lib/label-print'
import { toast } from 'sonner'
import type { DetalleLineUI } from './item-card'

interface Props {
  // Fase 1: durante el llenado del formulario — muestra preview y permite configurar
  detalles?: DetalleLineUI[]
  onToggleEtiqueta?: (id: string, incluir: boolean) => void
  onCantidadEtiqueta?: (id: string, cant: number) => void
  // Fase 2: tras confirmar — imprime con los lotes reales del servidor
  lotesConfirmados?: LoteParaEtiqueta[]
}

export function LabelsSection({ detalles, onToggleEtiqueta, onCantidadEtiqueta, lotesConfirmados }: Props) {
  const [imprimiendo, setImprimiendo] = useState(false)

  // Fase post-confirmación: imprime directamente con lotes del servidor
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
          {imprimiendo ? 'Generando…' : `Imprimir ${total} etiqueta${total !== 1 ? 's' : ''}`}
        </Button>
      </div>
    )
  }

  // Fase pre-confirmación: configuración de etiquetas por ítem
  if (!detalles) return null
  const completos = detalles.filter(d => d.codigo_lote && d.fecha_vencimiento && d.area_destino_id)
  if (completos.length === 0) return null

  const seleccionados = completos.filter(d => d.incluir_etiqueta)
  const totalEtiquetas = seleccionados.reduce((s, d) => s + d.cantidad_etiquetas, 0)

  return (
    <div className="card bg-base-100 border border-dashed p-4">
      <p className="font-semibold text-sm mb-3">🏷️ Configurar etiquetas</p>
      <div className="space-y-2">
        {completos.map(d => (
          <div key={d.id} className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              className="checkbox checkbox-sm checkbox-primary"
              checked={d.incluir_etiqueta}
              onChange={e => onToggleEtiqueta?.(d.id, e.target.checked)}
            />
            <span className="flex-1 truncate text-xs">{d.producto_nombre}</span>
            <span className="text-xs opacity-50 font-mono">{d.codigo_lote}</span>
            {d.incluir_etiqueta && (
              <input
                type="number"
                min={1}
                max={99}
                className="input input-xs input-bordered w-14 text-center"
                value={d.cantidad_etiquetas}
                onChange={e => onCantidadEtiqueta?.(d.id, Math.max(1, Number(e.target.value)))}
              />
            )}
          </div>
        ))}
      </div>
      {totalEtiquetas > 0 && (
        <p className="text-xs opacity-50 mt-2 text-right">
          {totalEtiquetas} etiqueta{totalEtiquetas !== 1 ? 's' : ''} se imprimirán al confirmar
        </p>
      )}
    </div>
  )
}
