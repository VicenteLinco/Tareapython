// frontend/src/pages/recepciones/steps/ItemsStep.tsx
import { Package } from 'lucide-react'
import { ReceptionItemCard } from '../components/item-card'
import { ProductoAutocomplete } from '../components/producto-autocomplete'
import { LabelsSection } from '../components/labels-section'
import { ScannerPanel } from '../components/scanner-panel'
import { isCardComplete } from '../components/item-card-utils'
import { AsignarCodigoModal } from '@/components/shared/AsignarCodigoModal'
import type { RecepcionWizardReturn } from '../hooks/useRecepcionWizard'
import type { RecepcionItemsReturn } from '../hooks/useRecepcionItems'
import type { Area, Producto } from '@/types'

interface Props {
  wizard: RecepcionWizardReturn
  items: RecepcionItemsReturn
  productos: Producto[] | undefined
  areas: Area[] | undefined
  monedaSimbolo: string
}

export function ItemsStep({ wizard, items, productos, areas, monedaSimbolo }: Props) {
  const { proveedorId, decision } = wizard
  const {
    detalles,
    scannerPaused,
    scanCount,
    pendingUnknownCode,
    clearPendingUnknownCode,
    addProducto,
    handleSearch,
    handleScanDetected,
    handleChange,
    handleChangeLote,
    handleAddLote,
    handleRemoveLote,
    handleRemove,
  } = items

  const itemsCompletos = detalles.filter(isCardComplete).length

  return (
    <div className="space-y-4">
      {/* Búsqueda / scan */}
      <ProductoAutocomplete
        productos={productos ?? []}
        excluidos={detalles.map(d => d.producto_id)}
        proveedorId={proveedorId}
        onSelect={prod => { addProducto(prod) }}
        onScan={handleSearch}
      />

      <ScannerPanel
        onScan={handleScanDetected}
        scanCount={scanCount}
        paused={scannerPaused}
      />

      {pendingUnknownCode && (
        <AsignarCodigoModal
          codigo={pendingUnknownCode}
          productos={productos?.map(p => ({ id: String(p.id), nombre: p.nombre, codigo_interno: p.codigo_interno ?? null })) ?? []}
          onClose={clearPendingUnknownCode}
          onAsignado={() => {
            const code = pendingUnknownCode
            clearPendingUnknownCode()
            handleSearch(code)
          }}
        />
      )}

      {/* Lista de ítems */}
      {detalles.length === 0 ? (
        <div className="card bg-base-100 border border-dashed p-12 text-center">
          <Package className="mx-auto mb-3 size-10 text-base-content/30" />
          <p className="opacity-50 text-sm">Escanea o busca productos para agregar ítems a la recepción</p>
        </div>
      ) : (
        <div className="space-y-3">
          {detalles.map(d => (
            <ReceptionItemCard
              key={d.id}
              detalle={d}
              areas={areas ?? []}
              onChange={handleChange}
              onChangeLote={handleChangeLote}
              onAddLote={handleAddLote}
              onRemoveLote={handleRemoveLote}
              onRemove={handleRemove}
              monedaSimbolo={monedaSimbolo}
            />
          ))}
        </div>
      )}

      {/* Aviso de ítems incompletos */}
      {detalles.length > 0 && itemsCompletos < detalles.length && (
        <p className="text-xs text-warning text-center">
          {detalles.length - itemsCompletos} ítem(s) incompleto(s) — completa lote, vencimiento y área para confirmar
        </p>
      )}

      {/* Sección etiquetas */}
      {decision !== 'rechazada' && (
        <LabelsSection
          detalles={detalles}
          onToggleEtiqueta={(detalleId, loteId, val) => handleChangeLote(detalleId, loteId, { incluir_etiqueta: val })}
          onCantidadEtiqueta={(detalleId, loteId, val) => handleChangeLote(detalleId, loteId, { cantidad_etiquetas: val })}
        />
      )}
    </div>
  )
}
