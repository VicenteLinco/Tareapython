// frontend/src/pages/recepciones/hooks/useRecepcionItems.ts
import { useState, useCallback } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { v4 as uuidv4 } from 'uuid'
import api from '@/lib/api'
import { parseApiError } from '@/lib/api-error'
import { notify } from '@/lib/notify'
import { mulDecimal, toNum } from '@/domain/parse'
import { useDialogState } from '@/hooks/useDialogState'
import { type DetalleLineUI, type LoteLineUI } from '../components/item-card'
import { type LoteParaEtiqueta } from '@/lib/label-print'
import { decideGs1Scan } from '../recepcion-scan'
import type { Proveedor, Area, ControlLote } from '@/types'

// Re-export for consumers
export type { DetalleLineUI, LoteLineUI }

export interface PendingScan {
  productoId: string
  productoNombre: string
  codigoInterno: string
  presentacionId: number | null
  areaId: number | null
  areaNombre: string
  // When set, the lot is known from a GS1 scan and the sheet only needs the expiry.
  prefillNumeroLote?: string
}

interface LoteConfirmadoApi {
  lote_id: string
  numero_lote: string
  fecha_vencimiento: string
  producto_nombre: string
  presentacion_nombre: string | null
  area_nombre: string
  cantidad: number
}

interface ScannedPresentacionData {
  producto_id: string | number
  presentacion_id: number
  presentacion_nombre?: string | null
}

export interface SolicitudItemSimple {
  producto_id: string
  producto_nombre: string
  cantidad_base: number
  unidad: string
  unidad_plural?: string | null
  presentacion_id?: number | null
  presentacion_nombre?: string | null
  presentacion_nombre_plural?: string | null
  factor_conversion?: number | null
  cantidad_presentaciones?: number | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildScannedPresentacion(data: ScannedPresentacionData) {
  return {
    id: data.presentacion_id,
    producto_id: String(data.producto_id),
    nombre: data.presentacion_nombre ?? '',
    nombre_plural: data.presentacion_nombre ? `${data.presentacion_nombre}s` : '',
    factor_conversion: '1',
    codigo_barras: null,
    gtin: null,
    gs1_habilitado: false,
    gtin_interno: false,
    sku: null,
    activa: true,
    version: 1,
    created_at: '',
  }
}

/** Fields the scan response carries to build a reception line directly (no extra fetch). */
interface ScanProductData {
  producto_id: string | number
  producto_nombre: string
  codigo_interno_lote?: string | null
  presentacion_id?: number | null
  presentacion_nombre?: string | null
  factor_conversion?: number | string | null
  unidad_base_nombre?: string | null
  unidad_base_nombre_plural?: string | null
  area_id?: number | null
  area_nombre?: string | null
  precio_unidad?: number | string | null
  imagen_url?: string | null
  control_lote?: ControlLote
}

/**
 * Builds a fully prefilled reception line from a scan result that already
 * carries product + presentation data. Used by both the registered-lot path
 * and the GS1 auto-add path so the line shape stays identical.
 */
function buildDetalleLineFromScan(
  data: ScanProductData,
  numeroLote: string,
  fechaVencimiento: string,
): DetalleLineUI {
  const pres = data.presentacion_id
    ? [buildScannedPresentacion({
        producto_id: data.producto_id,
        presentacion_id: data.presentacion_id,
        presentacion_nombre: data.presentacion_nombre,
      })]
    : []
  const precio = data.precio_unidad
    ? mulDecimal(data.precio_unidad, data.factor_conversion || 1).toDecimalPlaces(0).toString()
    : ''
  return {
    id: uuidv4(),
    producto_id: String(data.producto_id),
    producto_nombre: data.producto_nombre,
    codigo_interno: data.codigo_interno_lote || '',
    presentacion_id: data.presentacion_id || null,
    presentacion_nombre: data.presentacion_nombre || '',
    presentacion_nombre_plural: data.presentacion_nombre ? data.presentacion_nombre + 's' : '',
    cantidad_solicitada: null,
    factor_conversion: data.factor_conversion ? toNum(data.factor_conversion) : 1,
    unidad_base_nombre: data.unidad_base_nombre || '',
    unidad_base_nombre_plural: data.unidad_base_nombre_plural || '',
    area_destino_id: data.area_id || null,
    area_destino_nombre: data.area_nombre || '',
    presentaciones: pres,
    precio_unitario: precio,
    precio_anterior: precio,
    precio_base: data.precio_unidad ? String(data.precio_unidad) : '',
    imagen_url: data.imagen_url || null,
    lotes: [{
      id: uuidv4(),
      codigo_lote: numeroLote,
      fecha_vencimiento: fechaVencimiento,
      cantidad_presentacion: 1,
      incluir_etiqueta: false,
      cantidad_etiquetas: 1,
    }],
    collapsed: false,
    control_lote: data.control_lote || 'con_vto',
  }
}

// ─── Parámetros del hook ──────────────────────────────────────────────────────

export interface UseRecepcionItemsParams {
  proveedorId: number | null
  proveedores: Proveedor[] | undefined
  productos: { id: string | number; codigo_interno: string; nombre: string; proveedor_id?: number | null; [key: string]: unknown }[] | undefined
  areas: Area[] | undefined
  monedaSimbolo: string
  solicitudId: string | null
  setSolicitudId: (id: string | null) => void
  solicitudNumero: string | null
  guiaDespacho: string
  guiaProvisoria: boolean
  fechaRecepcion: string
  decision: string
  motivosSeleccionados: string[]
  motivoOtro: string
  nota: string
  fotoGuia: string | null
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

const MOTIVOS_RECHAZO = [
  { id: 'temperatura', label: 'Cadena de frío rota' },
  { id: 'embalaje', label: 'Embalaje dañado' },
  { id: 'documentos', label: 'Documentos incorrectos' },
  { id: 'cantidad', label: 'Cantidad no coincide' },
  { id: 'no_solicitado', label: 'Producto no solicitado' },
]

export function useRecepcionItems({
  proveedorId,
  proveedores,
  productos,
  solicitudId,
  guiaDespacho,
  guiaProvisoria,
  fechaRecepcion,
  decision,
  motivosSeleccionados,
  motivoOtro,
  nota,
  fotoGuia,
}: UseRecepcionItemsParams) {
  const navigate = useNavigate()

  // ─── State ─────────────────────────────────────────────────────────────────

  const [detalles, setDetalles] = useState<DetalleLineUI[]>([])
  const [scannerPaused, setScannerPaused] = useState(false)
  const [scanCount, setScanCount] = useState(0)
  const [pendingScan, setPendingScan] = useState<PendingScan | null>(null)
  const [pendingUnknownCode, setPendingUnknownCode] = useState<string | null>(null)

  // Post-confirmación (imprimir etiquetas)
  const [lotesConfirmados, setLotesConfirmados] = useState<LoteParaEtiqueta[] | null>(null)
  const printModal = useDialogState()

  // Reconciliación post-recepción
  const [solicitudItemsRef, setSolicitudItemsRef] = useState<SolicitudItemSimple[]>([])
  const reconciliacionModal = useDialogState()
  const [pendingConfirmarPayload, setPendingConfirmarPayload] = useState<Record<string, unknown> | null>(null)

  // ─── Validación proveedor ───────────────────────────────────────────────────

  const validarProveedorEscaneado = useCallback((productoNombre: string, productoProveedorId: number | null | undefined) => {
    if (!proveedorId || productoProveedorId === proveedorId) return true
    if (productoProveedorId) {
      const nombreProv = proveedores?.find(p => p.id === productoProveedorId)?.nombre ?? 'otro proveedor'
      notify.error(`"${productoNombre}" pertenece a ${nombreProv}`)
    } else {
      notify.error(`"${productoNombre}" no tiene proveedor asignado`)
    }
    return false
  }, [proveedorId, proveedores])

  // ─── Agregar ítem ───────────────────────────────────────────────────────────

  // Fetch supplier-specific presentations for a producto_proveedor link.
  // Returns the supplier presentations (with es_default flagged) if any are configured,
  // or null if the endpoint is unavailable or returns empty.
  const fetchSupplierPresentaciones = useCallback(async (
    ppId: number
  ): Promise<Array<{ id: number; nombre: string; nombre_plural: string; factor_conversion: string; es_default: boolean }> | null> => {
    try {
      const res = await api.get(`/producto-proveedor/${ppId}/presentaciones`)
      const rows = res.data as Array<{
        presentacion_id: number
        presentacion_nombre: string
        presentacion_nombre_plural: string
        factor_conversion: string
        es_default: boolean
        activo: boolean
      }>
      if (!rows || rows.length === 0) return null
      return rows.map(r => ({
        id: r.presentacion_id,
        nombre: r.presentacion_nombre,
        nombre_plural: r.presentacion_nombre_plural,
        factor_conversion: r.factor_conversion,
        es_default: r.es_default,
      }))
    } catch {
      // Endpoint unavailable or no supplier presentations configured — fall back silently
      return null
    }
  }, [])

  const addProducto = useCallback(async (
    prod: { id: string | number; nombre: string; codigo_interno?: string | null; proveedor_id?: number | null },
    overridePresentacionId?: number,
    overrideQuantity?: number,
  ) => {
    if (proveedorId && prod.proveedor_id !== proveedorId) {
      if (prod.proveedor_id) {
        const nombreProv = proveedores?.find(p => p.id === prod.proveedor_id)?.nombre ?? 'otro proveedor'
        notify.error(`"${prod.nombre}" pertenece a ${nombreProv}`)
      } else {
        notify.error(`"${prod.nombre}" no tiene proveedor asignado`)
      }
      return
    }
    try {
      const res = await api.get(`/productos/${prod.id}`)
      const full = res.data
      const allPresentaciones = full.presentaciones || []

      // Attempt to fetch supplier-specific presentations when a supplier is selected.
      // The producto_proveedor.id is available in the product detail's proveedores array.
      let activePresentaciones = allPresentaciones
      let defaultPresId: number | null = overridePresentacionId ?? null

      if (proveedorId) {
        const ppRecord = (full.proveedores as Array<{ id: number; proveedor_id: number }> | null)
          ?.find(pp => pp.proveedor_id === proveedorId)
        if (ppRecord?.id) {
          const supplierPres = await fetchSupplierPresentaciones(ppRecord.id)
          if (supplierPres && supplierPres.length > 0) {
            // Use supplier-specific presentations; map them to Presentacion shape
            activePresentaciones = supplierPres.map(sp => ({
              id: sp.id,
              producto_id: String(prod.id),
              nombre: sp.nombre,
              nombre_plural: sp.nombre_plural,
              factor_conversion: sp.factor_conversion,
              codigo_barras: null,
              gtin: null,
              gs1_habilitado: false,
              gtin_interno: false,
              sku: null,
              activa: true,
              version: 1,
              created_at: '',
            }))
            // Pre-select the default unless overridden
            if (!overridePresentacionId) {
              const defaultEntry = supplierPres.find(sp => sp.es_default)
              if (defaultEntry) defaultPresId = defaultEntry.id
            }
          }
        }
      }

      const pres = (defaultPresId
        ? activePresentaciones.find((p: { id: number }) => p.id === defaultPresId)
        : null) ?? activePresentaciones[0] ?? null

      const catalogoArea = full.areas?.[0]
      const initialCantidad = overrideQuantity ?? 1
      const line: DetalleLineUI = {
        id: uuidv4(),
        producto_id: String(prod.id),
        producto_nombre: prod.nombre,
        codigo_interno: prod.codigo_interno ?? '',
        presentacion_id: pres?.id || null,
        presentacion_nombre: pres?.nombre || '',
        presentacion_nombre_plural: pres?.nombre_plural || '',
        cantidad_solicitada: overrideQuantity ?? null,
        factor_conversion: toNum(pres?.factor_conversion || 1),
        unidad_base_nombre: full.unidad_base?.nombre || '',
        unidad_base_nombre_plural: full.unidad_base?.nombre_plural || '',
        area_destino_id: catalogoArea?.id ?? null,
        area_destino_nombre: catalogoArea?.nombre ?? '',
        presentaciones: activePresentaciones,
        precio_unitario: full.precio_unidad
          ? mulDecimal(full.precio_unidad, pres?.factor_conversion || 1).toDecimalPlaces(0).toString()
          : '',
        precio_anterior: full.precio_unidad
          ? mulDecimal(full.precio_unidad, pres?.factor_conversion || 1).toDecimalPlaces(0).toString()
          : '',
        precio_base: full.precio_unidad ? String(full.precio_unidad) : '',
        imagen_url: full.imagen_url,
        lotes: [{
          id: uuidv4(),
          codigo_lote: '',
          fecha_vencimiento: '',
          cantidad_presentacion: initialCantidad,
          incluir_etiqueta: false,
          cantidad_etiquetas: initialCantidad,
        }],
        collapsed: false,
        control_lote: full.control_lote as ControlLote,
      }
      setDetalles(prev => [line, ...prev])
      notify.success(`${prod.nombre} añadido`)
    } catch {
      notify.error('Error al cargar producto')
    }
  }, [proveedorId, proveedores, fetchSupplierPresentaciones])

  const addProductoConLote = useCallback(async (
    prodId: string | number,
    loteParams: { codigo_lote: string; fecha_vencimiento: string; cantidad: number }
  ) => {
    try {
      const res = await api.get(`/productos/${prodId}`)
      const full = res.data
      const allPresentaciones = full.presentaciones || []
      const pres = allPresentaciones[0] || null
      const catalogoArea = full.areas?.[0]
      const line: DetalleLineUI = {
        id: uuidv4(),
        producto_id: String(prodId),
        producto_nombre: full.nombre,
        codigo_interno: full.codigo_interno ?? '',
        presentacion_id: pres?.id || null,
        presentacion_nombre: pres?.nombre || '',
        presentacion_nombre_plural: pres?.nombre_plural || '',
        cantidad_solicitada: null,
        factor_conversion: toNum(pres?.factor_conversion || 1),
        unidad_base_nombre: full.unidad_base?.nombre || '',
        unidad_base_nombre_plural: full.unidad_base?.nombre_plural || '',
        area_destino_id: catalogoArea?.id ?? null,
        area_destino_nombre: catalogoArea?.nombre ?? '',
        presentaciones: allPresentaciones,
        precio_unitario: full.precio_unidad
          ? mulDecimal(full.precio_unidad, pres?.factor_conversion || 1).toDecimalPlaces(0).toString()
          : '',
        precio_anterior: full.precio_unidad
          ? mulDecimal(full.precio_unidad, pres?.factor_conversion || 1).toDecimalPlaces(0).toString()
          : '',
        precio_base: full.precio_unidad ? String(full.precio_unidad) : '',
        imagen_url: full.imagen_url,
        lotes: [{
          id: uuidv4(),
          codigo_lote: loteParams.codigo_lote,
          fecha_vencimiento: loteParams.fecha_vencimiento,
          cantidad_presentacion: loteParams.cantidad,
          incluir_etiqueta: false,
          cantidad_etiquetas: loteParams.cantidad,
        }],
        collapsed: false,
        control_lote: full.control_lote as ControlLote,
      }
      setDetalles(prev => [line, ...prev])
      setScanCount(prev => prev + 1)
      notify.success(`${full.nombre} añadido`)
    } catch {
      notify.error('Error al cargar producto')
    }
  }, [])


  // ─── Búsqueda manual ────────────────────────────────────────────────────────

  const handleSearch = useCallback(async (valor: string) => {
    const q = valor.trim()
    if (q.length < 2) return

    try {
      const res = await api.get('/productos/scan', { params: { codigo: q } })
      const data = res.data

      if (!data.encontrado) {
        const found = productos?.find(p =>
          p.nombre.toLowerCase().includes(q.toLowerCase()) ||
          p.codigo_interno.toLowerCase() === q.toLowerCase()
        )
        if (found) { await addProducto(found); return }
        setPendingUnknownCode(data.codigo || q)
        return
      }

      if (!validarProveedorEscaneado(data.producto_nombre, data.proveedor_id)) return

      if (data.tipo === 'lote') {
        const nuevoLote: LoteLineUI = {
          id: uuidv4(),
          codigo_lote: data.numero_lote,
          fecha_vencimiento: data.fecha_vencimiento || '',
          cantidad_presentacion: 1,
          incluir_etiqueta: false,
          cantidad_etiquetas: 1,
        }

        const existingDetalle = detalles.find(d => String(d.producto_id) === String(data.producto_id))
        if (existingDetalle) {
          setDetalles(prev => prev.map(d =>
            d.id === existingDetalle.id
              ? { ...d, collapsed: false, lotes: [...d.lotes, nuevoLote] }
              : d
          ))
          notify.success(`Lote ${data.numero_lote} añadido a ${data.producto_nombre}`)
          return
        }

        const pres = data.presentacion_id
          ? [buildScannedPresentacion(data)]
          : []

        const line: DetalleLineUI = {
          id: uuidv4(),
          producto_id: String(data.producto_id),
          producto_nombre: data.producto_nombre,
          codigo_interno: data.codigo_interno_lote || '',
          presentacion_id: data.presentacion_id || null,
          presentacion_nombre: data.presentacion_nombre || '',
          presentacion_nombre_plural: data.presentacion_nombre ? data.presentacion_nombre + 's' : '',
          factor_conversion: data.factor_conversion ? toNum(data.factor_conversion) : 1,
          unidad_base_nombre: data.unidad_base_nombre || '',
          unidad_base_nombre_plural: data.unidad_base_nombre_plural || '',
          area_destino_id: data.area_id || null,
          area_destino_nombre: data.area_nombre || '',
          presentaciones: pres,
          precio_unitario: data.precio_unidad
            ? mulDecimal(data.precio_unidad, data.factor_conversion || 1).toDecimalPlaces(0).toString()
            : '',
          precio_anterior: data.precio_unidad
            ? mulDecimal(data.precio_unidad, data.factor_conversion || 1).toDecimalPlaces(0).toString()
            : '',
          precio_base: data.precio_unidad ? String(data.precio_unidad) : '',
          imagen_url: data.imagen_url || null,
          lotes: [nuevoLote],
          collapsed: false,
          control_lote: data.control_lote || 'con_vto',
        }
        setDetalles(prev => [line, ...prev])
        notify.success(`Lote ${data.numero_lote} añadido`)
      } else if (data.tipo === 'presentacion') {
        const prod = productos?.find(p => p.id === data.producto_id || String(p.id) === String(data.producto_id))
        if (prod) await addProducto(prod, data.presentacion_id)
      } else {
        const prod = productos?.find(p => p.id === data.producto_id || String(p.id) === String(data.producto_id))
        if (prod) await addProducto(prod)
      }
    } catch {
      notify.error('Error en la búsqueda')
    }
  }, [detalles, productos, validarProveedorEscaneado, addProducto])

  // ─── Scanner inline ──────────────────────────────────────────────────────────

  const handleScanDetected = useCallback(async (code: string) => {
    const q = code.trim()
    if (!q) return

    try {
      const res = await api.get('/productos/scan', { params: { codigo: q } })
      const data = res.data

      if (!data.encontrado) {
        navigator.vibrate?.([80, 40, 80])
        setScannerPaused(true)
        setPendingUnknownCode(data.codigo || q)
        return
      }

      const productoId = String(data.producto_id)
      if (!validarProveedorEscaneado(data.producto_nombre, data.proveedor_id)) return

      // ── GS1 DataMatrix: the code carries lot + expiry → respect the scanned lot ──
      if (data.tipo === 'gs1') {
        const outcome = decideGs1Scan(detalles, data)
        if (outcome.kind === 'increment') {
          setDetalles(prev => prev.map(d =>
            d.id !== outcome.detalleId ? d : {
              ...d,
              lotes: d.lotes.map(l => l.id !== outcome.loteId ? l : {
                ...l,
                cantidad_presentacion: l.cantidad_presentacion + 1,
                cantidad_etiquetas: l.cantidad_presentacion + 1,
              }),
            }
          ))
          setScanCount(prev => prev + 1)
          navigator.vibrate?.(50)
          notify.success(`+1 ${data.producto_nombre} (lote ${data.gs1?.numero_lote ?? ''})`)
          return
        }
        if (outcome.kind === 'append-lote') {
          setDetalles(prev => prev.map(d =>
            d.id !== outcome.detalleId ? d : {
              ...d,
              collapsed: false,
              lotes: [...d.lotes, {
                id: uuidv4(),
                codigo_lote: outcome.numeroLote,
                fecha_vencimiento: outcome.fechaVencimiento,
                cantidad_presentacion: 1,
                incluir_etiqueta: false,
                cantidad_etiquetas: 1,
              }],
            }
          ))
          setScanCount(prev => prev + 1)
          navigator.vibrate?.(50)
          notify.success(`Lote ${outcome.numeroLote} añadido a ${data.producto_nombre}`)
          return
        }
        if (outcome.kind === 'new-line') {
          const line = buildDetalleLineFromScan(data, outcome.numeroLote, outcome.fechaVencimiento)
          setDetalles(prev => [line, ...prev])
          setScanCount(prev => prev + 1)
          navigator.vibrate?.(50)
          notify.success(`${data.producto_nombre} agregado`)
          return
        }
        if (outcome.kind === 'prompt-venc') {
          setScannerPaused(true)
          setPendingScan({
            productoId,
            productoNombre: data.producto_nombre,
            codigoInterno: data.codigo_interno_lote || '',
            presentacionId: data.presentacion_id || null,
            areaId: data.area_id || null,
            areaNombre: data.area_nombre || '',
            prefillNumeroLote: outcome.numeroLote,
          })
          return
        }
        // outcome.kind === 'manual' (GTIN only, no lot) → fall through to generic flow.
      }

      const existingDetalle = detalles.find(d => d.producto_id === productoId)
      if (existingDetalle) {
        setDetalles(prev => prev.map(d => {
          if (d.producto_id !== productoId) return d
          const lotes = d.lotes.map((l, i) =>
            i === d.lotes.length - 1
              ? { ...l, cantidad_presentacion: l.cantidad_presentacion + 1, cantidad_etiquetas: l.cantidad_presentacion + 1 }
              : l
          )
          return { ...d, lotes }
        }))
        setScanCount(prev => prev + 1)
        navigator.vibrate?.(50)
        notify.success(`+1 ${existingDetalle.producto_nombre}`)
        return
      }

      if (data.control_lote === 'simple') {
        const line = buildDetalleLineFromScan(data, '', '')
        setDetalles(prev => [line, ...prev])
        setScanCount(prev => prev + 1)
        navigator.vibrate?.(50)
        notify.success(`${data.producto_nombre} agregado`)
        return
      }

      if (data.tipo === 'lote' && data.numero_lote && data.fecha_vencimiento) {
        const line = buildDetalleLineFromScan(data, data.numero_lote, data.fecha_vencimiento)
        setDetalles(prev => [line, ...prev])
        setScanCount(prev => prev + 1)
        navigator.vibrate?.(50)
        notify.success(`${data.producto_nombre} agregado`)
        return
      }

      setScannerPaused(true)
      setPendingScan({
        productoId,
        productoNombre: data.producto_nombre,
        codigoInterno: data.codigo_interno_lote || '',
        presentacionId: data.presentacion_id || null,
        areaId: data.area_id || null,
        areaNombre: data.area_nombre || '',
      })
    } catch {
      notify.error('Error al buscar producto')
    }
  }, [detalles, validarProveedorEscaneado])

  // ─── Confirmar lote desde bottom sheet ──────────────────────────────────────

  const handleConfirmLote = useCallback(async (loteData: { numero_lote: string; fecha_vencimiento: string; cantidad: number }) => {
    if (!pendingScan) return
    try {
      const res = await api.get(`/productos/${pendingScan.productoId}`)
      const full = res.data
      const presentaciones = full.presentaciones || []
      const pres = (pendingScan.presentacionId
        ? presentaciones.find((p: { id: number }) => p.id === pendingScan.presentacionId)
        : null) ?? presentaciones[0] ?? null

      const catalogoArea = full.areas?.[0]

      const line: DetalleLineUI = {
        id: uuidv4(),
        producto_id: pendingScan.productoId,
        producto_nombre: pendingScan.productoNombre,
        codigo_interno: pendingScan.codigoInterno,
        presentacion_id: pres?.id || null,
        presentacion_nombre: pres?.nombre || '',
        presentacion_nombre_plural: pres?.nombre_plural || '',
        cantidad_solicitada: null,
        factor_conversion: toNum(pres?.factor_conversion || 1),
        unidad_base_nombre: full.unidad_base?.nombre || '',
        unidad_base_nombre_plural: full.unidad_base?.nombre_plural || '',
        area_destino_id: catalogoArea?.id ?? pendingScan.areaId ?? null,
        area_destino_nombre: catalogoArea?.nombre ?? pendingScan.areaNombre ?? '',
        presentaciones,
        precio_unitario: full.precio_unidad
          ? mulDecimal(full.precio_unidad, pres?.factor_conversion || 1).toDecimalPlaces(0).toString()
          : '',
        precio_anterior: full.precio_unidad
          ? mulDecimal(full.precio_unidad, pres?.factor_conversion || 1).toDecimalPlaces(0).toString()
          : '',
        precio_base: full.precio_unidad ? String(full.precio_unidad) : '',
        imagen_url: full.imagen_url,
        lotes: [{
          id: uuidv4(),
          codigo_lote: loteData.numero_lote,
          fecha_vencimiento: loteData.fecha_vencimiento,
          cantidad_presentacion: loteData.cantidad,
          incluir_etiqueta: false,
          cantidad_etiquetas: loteData.cantidad,
        }],
        collapsed: false,
        control_lote: full.control_lote as ControlLote,
      }
      setDetalles(prev => [line, ...prev])
      setScanCount(prev => prev + 1)
      navigator.vibrate?.(50)
    } catch {
      notify.error('Error al cargar producto')
    } finally {
      setPendingScan(null)
      setScannerPaused(false)
    }
  }, [pendingScan])

  const handleCancelLote = useCallback(() => {
    setPendingScan(null)
    setScannerPaused(false)
  }, [])

  // ─── Cambiar ítem ────────────────────────────────────────────────────────────

  const handleChange = useCallback((id: string, patch: Partial<Omit<DetalleLineUI, 'lotes'>>) => {
    setDetalles(prev => prev.map(d => {
      if (d.id !== id) return d
      let extraPatch: Partial<DetalleLineUI> = {}
      if (patch.factor_conversion !== undefined && d.precio_base) {
        const newFactor = patch.factor_conversion
        const newPrice = mulDecimal(d.precio_base, newFactor).toDecimalPlaces(0).toString()
        extraPatch = {
          precio_unitario: newPrice,
          precio_anterior: newPrice,
        }
      }
      // Collapse is controlled manually via the chevron (patch.collapsed); never auto-collapse.
      return { ...d, ...patch, ...extraPatch }
    }))
  }, [])

  const handleChangeLote = useCallback((detalleId: string, loteId: string, patch: Partial<LoteLineUI>) => {
    setDetalles(prev => prev.map(d => {
      if (d.id !== detalleId) return d
      const lotes = d.lotes.map(l => l.id === loteId ? { ...l, ...patch } : l)
      // Collapse is controlled manually via the chevron; never auto-collapse.
      return { ...d, lotes }
    }))
  }, [])

  const handleAddLote = useCallback((detalleId: string) => {
    setDetalles(prev => prev.map(d =>
      d.id !== detalleId ? d : {
        ...d,
        collapsed: false,
        lotes: [...d.lotes, {
          id: uuidv4(),
          codigo_lote: '',
          fecha_vencimiento: '',
          cantidad_presentacion: 1,
          incluir_etiqueta: false,
          cantidad_etiquetas: 1,
        }],
      }
    ))
  }, [])

  const handleRemoveLote = useCallback((detalleId: string, loteId: string) => {
    setDetalles(prev => prev.map(d => {
      if (d.id !== detalleId) return d
      if (d.lotes.length <= 1) return d
      const lotes = d.lotes.filter(l => l.id !== loteId)
      return { ...d, lotes }
    }))
  }, [])

  const handleRemove = useCallback((id: string) => {
    setDetalles(prev => prev.filter(d => d.id !== id))
  }, [])

  // ─── Mutación confirmar ──────────────────────────────────────────────────────

  const confirmarMutation = useMutation({
    mutationFn: async (payload: object) => {
      const res = await api.post('/recepciones', payload, {
        headers: { 'x-idempotency-key': uuidv4() }
      })
      if (fotoGuia) {
        await api.put(`/recepciones/${res.data.id}/foto`, { data_url: fotoGuia })
      }
      return res.data
    },
    onSuccess: (data) => {
      const lotes: LoteConfirmadoApi[] = data.lotes ?? []
      const paraImprimir: LoteParaEtiqueta[] = lotes
        .map<LoteParaEtiqueta | null>(l => {
          for (const d of detalles) {
            const lote = d.lotes.find(lo =>
              lo.codigo_lote === l.numero_lote && d.producto_nombre === l.producto_nombre
            )
            if (lote?.incluir_etiqueta) {
              return {
                lote_id: l.lote_id,
                numero_lote: l.numero_lote,
                fecha_vencimiento: l.fecha_vencimiento,
                producto_nombre: l.producto_nombre,
                presentacion_nombre: l.presentacion_nombre,
                area_nombre: l.area_nombre,
                cantidad_etiquetas: lote.cantidad_etiquetas,
              } satisfies LoteParaEtiqueta
            }
          }
          return null
        })
        .filter((x): x is LoteParaEtiqueta => x !== null)

      if (paraImprimir.length > 0) {
        setLotesConfirmados(paraImprimir)
        printModal.onOpen()
      } else {
        notify.success('Recepción confirmada')
        navigate('/recepciones')
      }
    },
    onError: (err: unknown) => {
      notify.error(parseApiError(err))
    },
  })

  // ─── handleConfirmar ─────────────────────────────────────────────────────────



  const handleConfirmar = useCallback(() => {
    if (!proveedorId) { notify.error('Selecciona un proveedor'); return }
    if (!guiaDespacho.trim() && !guiaProvisoria) { notify.error('Ingresa el número de guía de despacho o marca como provisoria'); return }

    if (decision === 'rechazada') {
      if (motivosSeleccionados.length === 0 && !motivoOtro.trim()) {
        notify.error('Indica al menos un motivo de rechazo')
        return
      }
      const motivos = [
        ...motivosSeleccionados.map(id => MOTIVOS_RECHAZO.find(m => m.id === id)?.label ?? id),
        ...(motivoOtro.trim() ? [`Otro: ${motivoOtro.trim()}`] : []),
      ].join(' | ')

      const guiaFinal = guiaProvisoria ? `PROV-${Date.now()}` : guiaDespacho
      confirmarMutation.mutate({
        proveedor_id: proveedorId,
        guia_despacho: guiaFinal || undefined,
        fecha_recepcion: new Date(fechaRecepcion).toISOString(),
        estado: 'rechazada',
        motivo_rechazo: motivos,
        solicitud_id: solicitudId || undefined,
        detalle: [],
      })
      return
    }

    const validos = detalles.filter(d =>
      d.area_destino_id && d.lotes.some(l => d.control_lote === 'simple' || (l.codigo_lote && l.fecha_vencimiento))
    )
    if (validos.length === 0) { notify.error('Completa los datos requeridos (área destino, y lote/vencimiento si corresponde) en al menos un producto'); return }

    if (decision === 'parcial' && !nota.trim()) {
      notify.error('Indica en la nota qué faltó por recibir')
      return
    }

    const guiaFinal = guiaProvisoria ? `PROV-${Date.now()}` : guiaDespacho
    const payload = {
      proveedor_id: proveedorId,
      guia_despacho: guiaFinal || undefined,
      fecha_recepcion: new Date(fechaRecepcion).toISOString(),
      estado: decision,
      nota: nota || undefined,
      solicitud_id: solicitudId || undefined,
      detalle: validos.flatMap(d =>
        d.lotes
          .filter(l => d.control_lote === 'simple' || (l.codigo_lote && l.fecha_vencimiento))
          .map(l => ({
            producto_id: d.producto_id,
            numero_lote: d.control_lote === 'simple' ? undefined : l.codigo_lote || undefined,
            fecha_vencimiento: d.control_lote === 'simple' ? undefined : l.fecha_vencimiento || undefined,
            presentacion_id: d.presentacion_id,
            cantidad_presentaciones: l.cantidad_presentacion,
            area_destino_id: d.area_destino_id!,
            precio_unitario: d.precio_unitario ? toNum(d.precio_unitario) : undefined,
          }))
      ),
    } as const

    if (solicitudId && solicitudItemsRef.length > 0) {
      setPendingConfirmarPayload(payload as unknown as Record<string, unknown>)
      reconciliacionModal.onOpen()
      return
    }

    confirmarMutation.mutate({ ...payload })
  }, [
    proveedorId, guiaDespacho, guiaProvisoria, decision, motivosSeleccionados, motivoOtro,
    detalles, nota, solicitudId, solicitudItemsRef.length, fechaRecepcion,
    confirmarMutation, reconciliacionModal,
  ])

  // ─── setSolicitudItemsRef (para vincular solicitud desde nueva.tsx) ──────────

  return {
    // state
    detalles,
    setDetalles,
    scannerPaused,
    setScannerPaused,
    scanCount,
    setScanCount,
    pendingScan,
    setPendingScan,
    pendingUnknownCode,
    clearPendingUnknownCode: () => { setPendingUnknownCode(null); setScannerPaused(false) },
    lotesConfirmados,
    solicitudItemsRef,
    setSolicitudItemsRef,
    pendingConfirmarPayload,
    setPendingConfirmarPayload,

    // modals
    printModal,
    reconciliacionModal,

    // handlers - items
    addProducto,
    addProductoConLote,
    handleSearch,
    handleScanDetected,
    handleConfirmLote,
    handleCancelLote,
    handleChange,
    handleChangeLote,
    handleAddLote,
    handleRemoveLote,
    handleRemove,

    // confirmation
    handleConfirmar,
    confirmarMutation,
  }
}

export type RecepcionItemsReturn = ReturnType<typeof useRecepcionItems>
