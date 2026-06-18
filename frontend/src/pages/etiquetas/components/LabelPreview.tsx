import { useQuery } from '@tanstack/react-query'
import api from '@/lib/api'
import { BarcodeRenderer } from './BarcodeRenderer'

interface Props {
  type: 'presentacion' | 'lote'
  id: string
}

function formatGS1Date(isoDate: string): string {
  const d = new Date(isoDate)
  const yy = String(d.getFullYear()).slice(-2)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yy}${mm}${dd}`
}

export function LabelPreview({ type, id }: Props) {
  const endpoint =
    type === 'presentacion'
      ? `/api/v1/etiquetas/presentacion/${id}`
      : `/api/v1/etiquetas/lote/${id}`

  const { data, isLoading } = useQuery({
    queryKey: ['etiqueta', type, id],
    queryFn: () => api.get(endpoint).then((r) => r.data),
    enabled: !!id,
  })

  if (isLoading) return <span className="loading loading-spinner" />
  if (!data) return null

  if (type === 'presentacion') {
    return (
      <div className="border border-base-300 rounded-xl p-4 w-fit space-y-2">
        {!data.gtin && (
          <div className="alert alert-warning text-sm py-2">
            Sin GTIN asignado. No se puede generar código de barras GS1.
          </div>
        )}
        <p className="font-bold text-sm">{data.producto_nombre}</p>
        <p className="text-xs text-base-content/60">{data.nombre}</p>
        {data.sku && <p className="text-xs font-mono">SKU: {data.sku}</p>}
        {data.gtin && (
          <BarcodeRenderer type="ean13" value={data.gtin.slice(-13)} />
        )}
      </div>
    )
  }

  // Lote label — GS1-128
  const gs1Value = data.gtin
    ? `(01)${data.gtin.padStart(14, '0')}(10)${data.numero_lote}(17)${formatGS1Date(data.fecha_vencimiento)}`
    : data.numero_lote

  return (
    <div className="border border-base-300 rounded-xl p-4 w-fit space-y-2">
      <p className="font-bold text-sm">{data.producto_nombre}</p>
      {data.presentacion_nombre && <p className="text-xs">{data.presentacion_nombre}</p>}
      <p className="text-xs">
        Lote: <span className="font-mono">{data.numero_lote}</span>
      </p>
      <p className="text-xs">
        Vence: {new Date(data.fecha_vencimiento).toLocaleDateString('es-AR')}
      </p>
      {data.proveedor_nombre && (
        <p className="text-xs text-base-content/60">{data.proveedor_nombre}</p>
      )}
      {data.gtin ? (
        <BarcodeRenderer type="gs1-128" value={gs1Value} width={300} height={60} />
      ) : (
        <div className="alert alert-warning text-xs py-1">Sin GTIN — barcode básico</div>
      )}
    </div>
  )
}
