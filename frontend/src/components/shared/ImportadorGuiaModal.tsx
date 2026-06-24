import { useState, useEffect, useMemo } from 'react'
import { X, Sparkles, AlertTriangle, Trash2, Loader2 } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { v4 as uuidv4 } from 'uuid'
import api from '@/lib/api'
import { notify } from '@/lib/notify'
import { parseApiError } from '@/lib/api-error'
import { useAreas, useCategorias, useUnidadesBasicas } from '@/hooks/dominio'
import type { Producto } from '@/types'

export interface ParsedItem {
  nombre_producto: string
  sku_ref: string
  lote: string | null
  fecha_vencimiento: string | null
  cantidad: number
  precio_unitario: number | null
}

interface ImportadorGuiaModalProps {
  open: boolean
  onClose: () => void
  proveedorId: number | null
  onImport: (itemsToAdd: any[]) => void
}

export default function ImportadorGuiaModal({
  open,
  onClose,
  proveedorId,
  onImport,
}: ImportadorGuiaModalProps) {
  const queryClient = useQueryClient()
  const { data: areas } = useAreas()
  const { data: categorias } = useCategorias()
  const { data: unidades } = useUnidadesBasicas()

  const [rawText, setRawText] = useState('')
  const [isParsing, setIsParsing] = useState(false)
  const [proveedorDetectado, setProveedorDetectado] = useState('')
  const [items, setItems] = useState<ParsedItem[]>([])

  // Defaults for new product creation
  const [defaultAreaId, setDefaultAreaId] = useState<string>('')
  const [defaultCategoriaId, setDefaultCategoriaId] = useState<string>('')
  const [defaultUnidadId, setDefaultUnidadId] = useState<string>('')

  // Load existing products to check for catalog matches
  const [existingSkus, setExistingSkus] = useState<Set<string>>(new Set())
  const [skuToProductMap, setSkuToProductMap] = useState<Map<string, Producto>>(new Map())

  useEffect(() => {
    if (open) {
      // Fetch products to build the SKU match set
      api.get<{ data: Producto[] }>('/productos', { params: { per_page: 1000 } })
        .then((res) => {
          const skus = new Set<string>()
          const map = new Map<string, Producto>()
          res.data.data.forEach((p) => {
            if (p.sku) {
              const cleaned = p.sku.trim().toLowerCase()
              skus.add(cleaned)
              map.set(cleaned, p)
            }
          })
          setExistingSkus(skus)
          setSkuToProductMap(map)
        })
        .catch((err) => {
          console.error('Error fetching products catalog for validation:', err)
        })
    }
  }, [open])

  // Select defaults when catalog lists load
  useEffect(() => {
    if (areas && areas.length > 0 && !defaultAreaId) {
      setDefaultAreaId(String(areas[0].id))
    }
    if (categorias && categorias.length > 0 && !defaultCategoriaId) {
      setDefaultCategoriaId(String(categorias[0].id))
    }
    if (unidades && unidades.length > 0 && !defaultUnidadId) {
      setDefaultUnidadId(String(unidades[0].id))
    }
  }, [areas, categorias, unidades, defaultAreaId, defaultCategoriaId, defaultUnidadId])

  if (!open) return null

  const handleParse = async () => {
    if (!rawText.trim()) {
      notify.error('Por favor, pega el texto de la guía de despacho')
      return
    }
    setIsParsing(true)
    try {
      const res = await api.post('/recepciones/parse-guia', { raw_text: rawText })
      setProveedorDetectado(res.data.proveedor)
      setItems(res.data.items || [])
      notify.success('Guía parseada con éxito')
    } catch (err) {
      notify.error(parseApiError(err))
    } finally {
      setIsParsing(false)
    }
  }

  // Check if a parsed item's SKU exists in the local catalog
  const doesSkuExist = (sku: string) => {
    if (!sku) return false
    return existingSkus.has(sku.trim().toLowerCase())
  }

  // Row validation rules
  const validateItem = (item: ParsedItem) => {
    const errors: Record<string, boolean> = {}
    if (!item.lote || !item.lote.trim()) {
      errors.lote = true
    }
    if (!item.fecha_vencimiento || !/^\d{4}-\d{2}-\d{2}$/.test(item.fecha_vencimiento)) {
      errors.fecha_vencimiento = true
    }
    return errors
  }

  // Check if any item in the grid has errors
  const hasErrors = useMemo(() => {
    return items.some((item) => {
      const errs = validateItem(item)
      return Object.keys(errs).length > 0
    })
  }, [items])

  const handleUpdateItem = (index: number, field: keyof ParsedItem, value: any) => {
    const updated = [...items]
    updated[index] = { ...updated[index], [field]: value }
    setItems(updated)
  }

  const handleRemoveItem = (index: number) => {
    const updated = [...items]
    updated.splice(index, 1)
    setItems(updated)
  }

  const handleConfirmImport = async () => {
    if (hasErrors) {
      notify.error('Corrige los campos en rojo antes de importar')
      return
    }
    if (items.length === 0) {
      notify.error('No hay ítems para importar')
      return
    }
    if (!defaultAreaId || !defaultUnidadId) {
      notify.error('Selecciona un área y unidad base por defecto para nuevos productos')
      return
    }

    setIsParsing(true) // show loading state on import
    try {
      const finalItemsList: any[] = []

      for (const item of items) {
        const cleanedSku = item.sku_ref.trim().toLowerCase()
        let product: Producto

        if (doesSkuExist(item.sku_ref)) {
          product = skuToProductMap.get(cleanedSku)!
        } else {
          // ─── Pre-crear producto en cuarentena ───
          // Call API to create a new quarantined product
          const createPayload = {
            nombre: item.nombre_producto.trim(),
            sku: item.sku_ref.trim(),
            unidad_base_id: Number(defaultUnidadId),
            categoria_id: defaultCategoriaId ? Number(defaultCategoriaId) : undefined,
            proveedor_id: proveedorId ? Number(proveedorId) : undefined,
            area_ids: [Number(defaultAreaId)],
            control_lote: 'con_vto', // Always con_vto for clinical guides
            estado_catalogo: 'pendiente_aprobacion', // QUARANTINE STATE
            origen_registro: 'guia_pdf',
            pres_nombre: 'Unidad',
            pres_nombre_plural: 'Unidades',
            pres_factor: 1,
          }

          const res = await api.post('/productos', createPayload)
          product = res.data
          // Update local sets to avoid duplicate creations
          existingSkus.add(cleanedSku)
          skuToProductMap.set(cleanedSku, product)
        }

        // Map to reception line format
        // Fetch full product detail if presentaciones are missing
        const fullProductRes = await api.get(`/productos/${product.id}`)
        const fullProduct = fullProductRes.data
        const activePresentaciones = fullProduct.presentaciones || []
        const pres = activePresentaciones[0] || null

        const line = {
          id: uuidv4(),
          producto_id: String(product.id),
          producto_nombre: product.nombre,
          codigo_interno: product.codigo_interno || '',
          presentacion_id: pres?.id || null,
          presentacion_nombre: pres?.nombre || 'Unidad',
          presentacion_nombre_plural: pres?.nombre_plural || 'Unidades',
          cantidad_solicitada: null,
          factor_conversion: pres ? Number(pres.factor_conversion) : 1,
          unidad_base_nombre: fullProduct.unidad_base?.nombre || 'Unidad',
          unidad_base_nombre_plural: fullProduct.unidad_base?.nombre_plural || 'Unidades',
          area_destino_id: Number(defaultAreaId),
          area_destino_nombre: areas?.find(a => a.id === Number(defaultAreaId))?.nombre || '',
          presentaciones: activePresentaciones,
          precio_unitario: String(item.precio_unitario || product.precio_unidad || ''),
          precio_anterior: String(product.precio_unidad || ''),
          precio_base: String(product.precio_unidad || ''),
          imagen_url: product.imagen_url,
          lotes: [{
            id: uuidv4(),
            codigo_lote: item.lote || '',
            fecha_vencimiento: item.fecha_vencimiento || '',
            cantidad_presentacion: item.cantidad,
            incluir_etiqueta: false,
            cantidad_etiquetas: item.cantidad,
          }],
          collapsed: false,
          control_lote: product.control_lote || 'con_vto',
        }

        finalItemsList.push(line)
      }

      onImport(finalItemsList)
      queryClient.invalidateQueries({ queryKey: ['productos'] })
      notify.success('Ítems cargados en la recepción')
      onClose()
    } catch (err) {
      notify.error('Error al importar guía: ' + parseApiError(err))
    } finally {
      setIsParsing(false)
    }
  }

  return (
    <div className="modal modal-open">
      <div className="modal-box w-11/12 max-w-7xl h-[85vh] flex flex-col p-0 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-6 py-4 shrink-0 bg-base-100">
          <div>
            <h3 className="font-bold text-lg flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              Importar Guía de Despacho (Zero-Friction)
            </h3>
            <p className="text-xs opacity-60">
              Pega el texto del PDF de la guía para extraer automáticamente productos, lotes y vencimientos.
            </p>
          </div>
          <button className="btn btn-sm btn-circle btn-ghost" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content Container (Double Panel) */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left Panel: Paste Text */}
          <div className="w-1/3 border-r p-4 flex flex-col gap-4 overflow-y-auto">
            <div className="form-control flex-1">
              <label className="label">
                <span className="label-text font-semibold">Pegar texto de la Guía:</span>
              </label>
              <textarea
                className="textarea textarea-bordered font-mono text-xs flex-1 min-h-[300px] resize-none"
                placeholder="VALTEK S.A.&#10;Factura: 123456&#10;REF: V-1234  Reactivo PCR  10 unidades  Lote: L88291  Vence: 2027-12-31  Precio: 25000"
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
              />
            </div>

            <button
              onClick={handleParse}
              disabled={isParsing || !rawText.trim()}
              className="btn btn-primary w-full"
            >
              {isParsing ? (
                <>
                  <Loader2 className="animate-spin h-4 w-4" />
                  Procesando con IA...
                </>
              ) : (
                'Parsear Guía'
              )}
            </button>
          </div>

          {/* Right Panel: Parsed Grid */}
          <div className="w-2/3 p-4 flex flex-col overflow-hidden">
            {items.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-base-content/40 gap-3">
                <FileText className="h-16 w-16 opacity-30" />
                <p className="text-sm font-semibold">
                  Aún no se ha cargado información de guía.
                </p>
                <p className="text-xs max-w-sm text-center">
                  Copia el texto del PDF y haz clic en "Parsear Guía" para ver los resultados aquí.
                </p>
              </div>
            ) : (
              <div className="flex-1 flex flex-col overflow-hidden gap-4">
                <div className="flex items-center justify-between shrink-0 bg-base-200/50 p-3 rounded-lg border">
                  <div>
                    <span className="text-xs opacity-50">Proveedor detectado:</span>
                    <h4 className="font-bold text-sm text-primary">{proveedorDetectado}</h4>
                  </div>
                  <span className="badge badge-outline">{items.length} ítems encontrados</span>
                </div>

                {/* Grid defaults for new products */}
                <div className="bg-base-200/20 p-3 rounded-lg border grid grid-cols-3 gap-3 shrink-0">
                  <div className="form-control">
                    <label className="label py-1">
                      <span className="label-text text-[10px] uppercase font-semibold">Área por defecto</span>
                    </label>
                    <select
                      className="select select-bordered select-xs w-full"
                      value={defaultAreaId}
                      onChange={(e) => setDefaultAreaId(e.target.value)}
                    >
                      {areas?.map((a) => (
                        <option key={a.id} value={a.id}>{a.nombre}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-control">
                    <label className="label py-1">
                      <span className="label-text text-[10px] uppercase font-semibold">Categoría por defecto</span>
                    </label>
                    <select
                      className="select select-bordered select-xs w-full"
                      value={defaultCategoriaId}
                      onChange={(e) => setDefaultCategoriaId(e.target.value)}
                    >
                      {categorias?.map((c) => (
                        <option key={c.id} value={c.id}>{c.nombre}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-control">
                    <label className="label py-1">
                      <span className="label-text text-[10px] uppercase font-semibold">Unidad base por defecto</span>
                    </label>
                    <select
                      className="select select-bordered select-xs w-full"
                      value={defaultUnidadId}
                      onChange={(e) => setDefaultUnidadId(e.target.value)}
                    >
                      {unidades?.map((u) => (
                        <option key={u.id} value={u.id}>{u.nombre}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Table */}
                <div className="flex-1 overflow-y-auto border rounded-lg">
                  <table className="table table-compact table-zebra w-full text-xs">
                    <thead>
                      <tr>
                        <th>Producto</th>
                        <th className="w-24">REF/SKU</th>
                        <th className="w-24">Lote</th>
                        <th className="w-32">Vencimiento (YYYY-MM-DD)</th>
                        <th className="w-16">Cant.</th>
                        <th className="w-20">P. Unitario</th>
                        <th className="w-10"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item, index) => {
                        const itemErrors = validateItem(item)
                        const isNewProduct = !doesSkuExist(item.sku_ref)
                        return (
                          <tr key={index}>
                            <td>
                              <div className="flex flex-col gap-1">
                                <input
                                  type="text"
                                  className="input input-bordered input-xs font-semibold w-full"
                                  value={item.nombre_producto}
                                  onChange={(e) => handleUpdateItem(index, 'nombre_producto', e.target.value)}
                                />
                                {isNewProduct && (
                                  <span className="badge badge-warning badge-xs self-start gap-1">
                                    <AlertTriangle className="h-2.5 w-2.5" />
                                    Creará en cuarentena
                                  </span>
                                )}
                              </div>
                            </td>
                            <td>
                              <input
                                type="text"
                                className="input input-bordered input-xs w-full"
                                value={item.sku_ref}
                                onChange={(e) => handleUpdateItem(index, 'sku_ref', e.target.value)}
                              />
                            </td>
                            <td>
                              <input
                                type="text"
                                className={`input input-bordered input-xs w-full ${itemErrors.lote ? 'input-error border-error border-2' : ''}`}
                                value={item.lote || ''}
                                onChange={(e) => handleUpdateItem(index, 'lote', e.target.value)}
                                placeholder="Requerido"
                              />
                            </td>
                            <td>
                              <input
                                type="text"
                                className={`input input-bordered input-xs w-full font-mono ${itemErrors.fecha_vencimiento ? 'input-error border-error border-2' : ''}`}
                                value={item.fecha_vencimiento || ''}
                                onChange={(e) => handleUpdateItem(index, 'fecha_vencimiento', e.target.value)}
                                placeholder="YYYY-MM-DD"
                              />
                            </td>
                            <td>
                              <input
                                type="number"
                                className="input input-bordered input-xs w-full text-right"
                                value={item.cantidad}
                                onChange={(e) => handleUpdateItem(index, 'cantidad', Number(e.target.value))}
                              />
                            </td>
                            <td>
                              <input
                                type="number"
                                className="input input-bordered input-xs w-full text-right"
                                value={item.precio_unitario || ''}
                                onChange={(e) => handleUpdateItem(index, 'precio_unitario', e.target.value ? Number(e.target.value) : null)}
                              />
                            </td>
                            <td>
                              <button
                                className="btn btn-ghost btn-xs text-error btn-circle"
                                onClick={() => handleRemoveItem(index)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t px-6 py-4 bg-base-100 shrink-0">
          <div className="text-xs text-error font-semibold">
            {hasErrors && '⚠ Corrige los campos vacíos o malformados en la grilla.'}
          </div>
          <div className="flex gap-2">
            <button className="btn btn-ghost btn-sm" onClick={onClose} disabled={isParsing}>
              Cancelar
            </button>
            <button
              onClick={handleConfirmImport}
              disabled={isParsing || items.length === 0 || hasErrors}
              className="btn btn-primary btn-sm px-6"
            >
              {isParsing ? (
                <>
                  <Loader2 className="animate-spin h-3.5 w-3.5" />
                  Importando...
                </>
              ) : (
                'Confirmar Importación'
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
