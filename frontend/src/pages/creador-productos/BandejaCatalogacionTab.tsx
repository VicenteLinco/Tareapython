import { useState } from 'react'
import { Check, X, ShieldAlert, Sparkles, Tag, Layers, RefreshCw, AlertCircle } from 'lucide-react'
import {
  useProductosQuarantine,
  useAprobarProductoQuarantine,
  useRechazarProductoQuarantine,
  useCategorias,
} from '@/hooks/dominio'
import { notify } from '@/lib/notify'
import type { Producto } from '@/types'

export default function BandejaCatalogacionTab() {
  const { data: quarantinedProducts, isLoading, refetch, isFetching } = useProductosQuarantine()
  const { data: categorias } = useCategorias()

  const aprobarMutation = useAprobarProductoQuarantine()
  const rechazarMutation = useRechazarProductoQuarantine()

  // Selected product for approval configuration
  const [selectedProduct, setSelectedProduct] = useState<Producto | null>(null)
  const [selectedCategoriaId, setSelectedCategoriaId] = useState<string>('')
  const [selectedControlLote, setSelectedControlLote] = useState<'simple' | 'con_vto' | 'trazable'>('con_vto')

  const handleOpenApproveModal = (product: Producto) => {
    setSelectedProduct(product)
    setSelectedCategoriaId(product.categoria_id ? String(product.categoria_id) : '')
    setSelectedControlLote((product.control_lote as 'simple' | 'con_vto' | 'trazable') || 'con_vto')
  }

  const handleConfirmApprove = () => {
    if (!selectedProduct) return
    if (!selectedCategoriaId) {
      notify.error('Selecciona una categoría antes de aprobar')
      return
    }

    aprobarMutation.mutate(
      {
        id: selectedProduct.id,
        payload: {
          categoria_id: Number(selectedCategoriaId),
          control_lote: selectedControlLote,
        },
      },
      {
        onSuccess: () => {
          setSelectedProduct(null)
        },
      }
    )
  }

  const handleReject = (product: Producto) => {
    if (window.confirm(`¿Estás seguro de rechazar y eliminar "${product.nombre}"?`)) {
      rechazarMutation.mutate(product.id)
    }
  }

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <span className="loading loading-spinner loading-lg text-primary" />
        <p className="text-sm opacity-50">Cargando bandeja de catalogación...</p>
      </div>
    )
  }

  const getOrigenBadge = (origen: string) => {
    switch (origen) {
      case 'api_regulatoria':
        return <span className="badge badge-primary badge-sm gap-1"><Sparkles className="h-3 w-3" /> API Salud</span>
      case 'guia_pdf':
        return <span className="badge badge-secondary badge-sm gap-1"><Tag className="h-3 w-3" /> Guía PDF</span>
      default:
        return <span className="badge badge-ghost badge-sm">Manual</span>
    }
  }

  return (
    <div className="space-y-6">
      {/* Overview stats header */}
      <div className="flex items-center justify-between border-b pb-4">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2 text-warning">
            <ShieldAlert className="h-5 w-5" />
            Bandeja de Catalogación (Cuarentena)
          </h2>
          <p className="text-xs opacity-60">
            Productos creados por canales automatizados que requieren revisión clínica y aprobación.
          </p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="btn btn-sm btn-ghost gap-1"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
          Refrescar
        </button>
      </div>

      {quarantinedProducts?.length === 0 ? (
        <div className="card border bg-base-100 flex flex-col items-center justify-center p-12 text-center gap-3">
          <Check className="h-12 w-12 text-success opacity-80" />
          <h3 className="font-bold text-base">¡Bandeja vacía!</h3>
          <p className="text-xs opacity-60 max-w-sm">
            No hay productos pendientes de catalogación. Todos los registros automáticos están aprobados y sus existencias liberadas.
          </p>
        </div>
      ) : (
        <div className="border rounded-lg bg-base-100 overflow-x-auto">
          <table className="table w-full text-xs">
            <thead>
              <tr>
                <th>Producto</th>
                <th>SKU/REF</th>
                <th>Código Interno</th>
                <th>Origen</th>
                <th>Creado en</th>
                <th className="text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {quarantinedProducts?.map((product) => (
                <tr key={product.id} className="hover">
                  <td className="font-semibold">{product.nombre}</td>
                  <td><span className="font-mono">{product.sku || '—'}</span></td>
                  <td><span className="font-mono">{product.codigo_interno || '—'}</span></td>
                  <td>{getOrigenBadge(product.origen_registro)}</td>
                  <td>{new Date(product.created_at).toLocaleString()}</td>
                  <td className="text-right">
                    <div className="flex justify-end gap-1">
                      <button
                        onClick={() => handleOpenApproveModal(product)}
                        className="btn btn-xs btn-success gap-1 font-semibold"
                      >
                        <Check className="h-3 w-3" />
                        Configurar y Aprobar
                      </button>
                      <button
                        onClick={() => handleReject(product)}
                        disabled={rechazarMutation.isPending}
                        className="btn btn-xs btn-error btn-outline btn-circle"
                        title="Rechazar y Eliminar"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Approve and Configure Dialog Modal */}
      {selectedProduct && (
        <div className="modal modal-open">
          <div className="modal-box max-w-md">
            <h3 className="font-bold text-base flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-success" />
              Aprobar Producto en Catalogación
            </h3>
            <p className="text-xs opacity-60 mt-1">
              Asigna los metadatos necesarios para incorporar "{selectedProduct.nombre}" al catálogo aprobado.
            </p>

            <div className="space-y-4 py-4">
              {/* Product summary info */}
              <div className="bg-base-200/50 p-3 rounded-lg border text-xs space-y-1.5">
                <div>
                  <span className="opacity-50">SKU/REF:</span>{' '}
                  <strong className="font-mono">{selectedProduct.sku || '—'}</strong>
                </div>
                <div>
                  <span className="opacity-50">Origen de registro:</span>{' '}
                  {getOrigenBadge(selectedProduct.origen_registro)}
                </div>
              </div>

              {/* Category Select */}
              <div className="form-control">
                <label className="label">
                  <span className="label-text font-semibold flex items-center gap-1">
                    <Tag className="h-3.5 w-3.5" />
                    Categoría
                  </span>
                </label>
                <select
                  className="select select-bordered select-sm w-full"
                  value={selectedCategoriaId}
                  onChange={(e) => setSelectedCategoriaId(e.target.value)}
                >
                  <option value="" disabled>Selecciona una categoría...</option>
                  {categorias?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nombre}
                    </option>
                  ))}
                </select>
              </div>

              {/* Control Lote Select */}
              <div className="form-control">
                <label className="label">
                  <span className="label-text font-semibold flex items-center gap-1">
                    <Layers className="h-3.5 w-3.5" />
                    Política de Control de Lotes
                  </span>
                </label>
                <select
                  className="select select-bordered select-sm w-full"
                  value={selectedControlLote}
                  onChange={(e) => setSelectedControlLote(e.target.value as 'simple' | 'con_vto' | 'trazable')}
                >
                  <option value="con_vto">Con Vencimiento (Recomendado reactivos)</option>
                  <option value="simple">Simple (Cantidad sin lotes detallados)</option>
                  <option value="trazable">Trazable completo (Serie y lotes estrictos)</option>
                </select>
                <p className="text-[10px] opacity-50 mt-1">
                  Define cómo se registrará el stock y consumos de este insumo.
                </p>
              </div>

              <div className="alert alert-warning text-xs mt-3 flex items-start gap-2 bg-warning/10 border-warning">
                <AlertCircle className="h-4 w-4 shrink-0 text-warning" />
                <span>
                  Al aprobar este producto, todo el stock cargado en cuarentena se liberará inmediatamente para consumo.
                </span>
              </div>
            </div>

            <div className="modal-action">
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setSelectedProduct(null)}
                disabled={aprobarMutation.isPending}
              >
                Cancelar
              </button>
              <button
                className="btn btn-success btn-sm px-6 gap-1"
                onClick={handleConfirmApprove}
                disabled={aprobarMutation.isPending}
              >
                {aprobarMutation.isPending ? (
                  <span className="loading loading-spinner loading-xs" />
                ) : (
                  <>
                    <Check className="h-4 w-4" />
                    Aprobar y Liberar
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
