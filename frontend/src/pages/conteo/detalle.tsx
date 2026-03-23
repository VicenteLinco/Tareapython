import { useState, useMemo, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import api from '@/lib/api'
import { useAuthStore } from '@/hooks/use-auth-store'
import type { ConteoDetalle, ConteoItem } from '@/types'
import { cn, formatDate, formatCantidad } from '@/lib/utils'
import { v4 as uuidv4 } from 'uuid'

// Agrupa items por producto
function agruparPorProducto(items: ConteoItem[]) {
  const grupos: Record<string, { producto_nombre: string; items: ConteoItem[] }> = {}
  for (const item of items) {
    if (!grupos[item.producto_id]) {
      grupos[item.producto_id] = { producto_nombre: item.producto_nombre, items: [] }
    }
    grupos[item.producto_id].items.push(item)
  }
  return Object.entries(grupos).sort(([, a], [, b]) =>
    a.producto_nombre.localeCompare(b.producto_nombre)
  )
}

export default function ConteoDetallePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const usuario = useAuthStore((s) => s.usuario)
  const isAdmin = usuario?.rol === 'admin'

  const [localItems, setLocalItems] = useState<Record<string, { cantidad: string; estado: string; version: number }>>({})
  const [showConfirmar, setShowConfirmar] = useState(false)
  const [nota, setNota] = useState('')
  const [colapsados, setColapsados] = useState<Record<string, boolean>>({})

  const { data, isLoading, isError } = useQuery({
    queryKey: ['conteo-detalle', id],
    queryFn: () =>
      api.get<ConteoDetalle>(`/conteo/${id}`).then((r) => r.data),
    enabled: !!id,
    refetchInterval: false,
  })

  const sesion = data?.sesion
  const items = data?.items ?? []
  const editable = sesion?.estado === 'borrador' || sesion?.estado === 'en_progreso'

  const itemsConEdicion = useMemo(() =>
    items.map((item) => {
      const local = localItems[item.id]
      if (!local) return item
      return {
        ...item,
        cantidad_contada: local.estado === 'contado' && local.cantidad !== ''
          ? parseFloat(local.cantidad)
          : item.cantidad_contada,
        estado_item: local.estado as ConteoItem['estado_item'],
      }
    }),
    [items, localItems]
  )

  const { contados, total } = useMemo(() => ({
    contados: itemsConEdicion.filter((i) => i.estado_item === 'contado').length,
    total: itemsConEdicion.length,
  }), [itemsConEdicion])

  const progreso = total > 0 ? Math.round((contados / total) * 100) : 0

  const guardarMutation = useMutation({
    mutationFn: (items: Array<{ item_id: string; cantidad_contada: number | null; estado_item: string; version: number }>) =>
      api.patch(`/conteo/${id}/items`, { items }).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['conteo-detalle', id] })
      setLocalItems({})
      toast.success('Guardado')
    },
    onError: (err: any) => {
      const code = err?.response?.data?.code
      if (code === 'VERSION_CONFLICT') {
        toast.error('Otro usuario modificó algunos ítems. Recargando...')
        queryClient.invalidateQueries({ queryKey: ['conteo-detalle', id] })
        setLocalItems({})
      } else {
        toast.error('Error al guardar')
      }
    },
  })

  const confirmarMutation = useMutation({
    mutationFn: () =>
      api.post(
        `/conteo/${id}/confirmar`,
        { nota: nota || undefined },
        { headers: { 'x-idempotency-key': uuidv4() } }
      ).then((r) => r.data),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['conteo-detalle', id] })
      queryClient.invalidateQueries({ queryKey: ['conteo'] })
      setShowConfirmar(false)
      toast.success(`Conteo confirmado. ${data.ajustes_generados} ajustes generados.`)
      navigate('/conteo')
    },
    onError: () => toast.error('Error al confirmar'),
  })

  const handleGuardar = useCallback(() => {
    const payload = Object.entries(localItems).map(([item_id, local]) => ({
      item_id,
      cantidad_contada: local.estado === 'contado' && local.cantidad !== ''
        ? parseFloat(local.cantidad)
        : null,
      estado_item: local.estado,
      version: local.version,
    }))
    if (payload.length > 0) guardarMutation.mutate(payload)
  }, [localItems, guardarMutation])

  const handleCantidadChange = (item: ConteoItem, valor: string) => {
    setLocalItems((prev) => ({
      ...prev,
      [item.id]: {
        cantidad: valor,
        estado: 'contado',
        version: prev[item.id]?.version ?? item.version,
      },
    }))
  }

  const handleNoContado = (item: ConteoItem) => {
    const estaNoContado = (localItems[item.id]?.estado ?? item.estado_item) === 'no_contado'
    setLocalItems((prev) => ({
      ...prev,
      [item.id]: {
        cantidad: '',
        estado: estaNoContado ? 'pendiente' : 'no_contado',
        version: prev[item.id]?.version ?? item.version,
      },
    }))
  }

  const toggleColapsar = (productoId: string) =>
    setColapsados((prev) => ({ ...prev, [productoId]: !prev[productoId] }))

  const hayCambiosPendientes = Object.keys(localItems).length > 0

  const resumen = useMemo(() => {
    const sinDiff = itemsConEdicion.filter((i) => i.estado_item === 'contado' && i.cantidad_contada === i.stock_sistema).length
    const negativo = itemsConEdicion.filter((i) => i.estado_item === 'contado' && i.cantidad_contada !== null && i.cantidad_contada < i.stock_sistema).length
    const positivo = itemsConEdicion.filter((i) => i.estado_item === 'contado' && i.cantidad_contada !== null && i.cantidad_contada > i.stock_sistema).length
    const noContados = itemsConEdicion.filter((i) => i.estado_item === 'no_contado').length
    return { sinDiff, negativo, positivo, noContados }
  }, [itemsConEdicion])

  const horasDesde = sesion
    ? Math.floor((Date.now() - new Date(sesion.created_at).getTime()) / 3600000)
    : 0

  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <span className="loading loading-spinner loading-lg" />
      </div>
    )
  }

  if (isError) return (
    <div className="flex justify-center items-center min-h-screen">
      <div className="alert alert-error max-w-sm">Error al cargar la sesión</div>
    </div>
  )

  if (!sesion) return null

  const grupos = agruparPorProducto(itemsConEdicion)

  return (
    <div className="flex flex-col min-h-screen bg-base-200">
      {/* Header sticky */}
      <div className="sticky top-0 z-30 bg-base-100 border-b border-base-200 shadow-sm">
        <div className="flex items-center gap-3 px-4 py-3">
          <button onClick={() => navigate('/conteo')} className="btn btn-ghost btn-sm btn-circle">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex-1 min-w-0">
            <p className="font-semibold truncate">{sesion.area_nombre}</p>
            <p className="text-xs opacity-50">Conteo · {formatDate(sesion.created_at)}</p>
          </div>
          {editable && hayCambiosPendientes && (
            <button
              className="btn btn-primary btn-sm"
              onClick={handleGuardar}
              disabled={guardarMutation.isPending}
            >
              {guardarMutation.isPending
                ? <span className="loading loading-spinner loading-xs" />
                : 'Guardar'}
            </button>
          )}
        </div>
        {/* Barra de progreso */}
        <div className="px-4 pb-3">
          <div className="flex justify-between text-xs opacity-60 mb-1">
            <span>{contados} / {total} ítems contados</span>
            <span>{progreso}%</span>
          </div>
          <div className="w-full bg-base-200 rounded-full h-2">
            <div
              className="h-2 rounded-full bg-primary transition-all duration-300"
              style={{ width: `${progreso}%` }}
            />
          </div>
        </div>
      </div>

      {/* Lista de ítems */}
      <div className="flex-1 px-3 py-3 space-y-2 pb-32">
        {grupos.map(([productoId, grupo]) => (
          <div key={productoId} className="bg-base-100 rounded-xl overflow-hidden border border-base-200">
            {/* Header de producto */}
            <button
              className="w-full flex items-center justify-between px-4 py-3 text-left"
              onClick={() => toggleColapsar(productoId)}
            >
              <span className="font-semibold text-sm">{grupo.producto_nombre}</span>
              <div className="flex items-center gap-2">
                <span className="text-xs opacity-40">{formatCantidad(grupo.items.length, 'lote')}</span>
                {colapsados[productoId]
                  ? <ChevronDown className="h-4 w-4 opacity-40" />
                  : <ChevronUp className="h-4 w-4 opacity-40" />
                }
              </div>
            </button>

            {/* Items del producto */}
            {!colapsados[productoId] && (
              <div className="divide-y divide-base-200">
                {grupo.items.map((item) => (
                  <LoteRow
                    key={item.id}
                    item={item}
                    localEdit={localItems[item.id]}
                    editable={editable}
                    onCantidadChange={(v) => handleCantidadChange(item, v)}
                    onNoContado={() => handleNoContado(item)}
                  />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Bottom bar — Confirmar (solo admin) */}
      {isAdmin && editable && !hayCambiosPendientes && (
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-base-100 border-t border-base-200">
          <button
            className="btn btn-primary w-full"
            onClick={() => setShowConfirmar(true)}
          >
            Revisar y confirmar
          </button>
        </div>
      )}

      {/* Bottom sheet confirmar */}
      {showConfirmar && (
        <div className="modal modal-open modal-bottom">
          <div className="modal-box rounded-t-2xl rounded-b-none">
            <h3 className="font-bold text-lg mb-4">Resumen de ajustes</h3>

            <div className="space-y-2 mb-4">
              <ResumenRow label="Sin diferencia" value={resumen.sinDiff} className="text-success" icon="✅" />
              <ResumenRow label="Ajuste negativo" value={resumen.negativo} className="text-error" icon="🔴" />
              <ResumenRow label="Ajuste positivo" value={resumen.positivo} className="text-info" icon="🔵" />
              <ResumenRow label="No contados" value={resumen.noContados} className="opacity-50" icon="⬜" />
            </div>

            {horasDesde >= 2 && (
              <div className="alert alert-warning mb-4 text-sm py-2">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>Han pasado {horasDesde}h desde que se inició esta sesión. Movimientos registrados durante el conteo pueden afectar las diferencias.</span>
              </div>
            )}

            <div className="form-control mb-4">
              <label className="label">
                <span className="label-text">Nota (opcional)</span>
              </label>
              <textarea
                className="textarea textarea-bordered"
                rows={2}
                placeholder="Ej: Conteo sábado 22/03, responsable: Ana M."
                value={nota}
                onChange={(e) => setNota(e.target.value)}
              />
            </div>

            <div className="modal-action">
              <button className="btn btn-ghost flex-1" onClick={() => setShowConfirmar(false)}>
                Cancelar
              </button>
              <button
                className="btn btn-primary flex-1"
                onClick={() => confirmarMutation.mutate()}
                disabled={confirmarMutation.isPending}
              >
                {confirmarMutation.isPending
                  ? <span className="loading loading-spinner loading-sm" />
                  : 'Confirmar ajustes'}
              </button>
            </div>
          </div>
          <div className="modal-backdrop" onClick={() => setShowConfirmar(false)} />
        </div>
      )}
    </div>
  )
}

// ---- Subcomponentes ----

function LoteRow({
  item,
  localEdit,
  editable,
  onCantidadChange,
  onNoContado,
}: {
  item: ConteoItem
  localEdit?: { cantidad: string; estado: string }
  editable: boolean
  onCantidadChange: (v: string) => void
  onNoContado: () => void
}) {
  const estadoActual = localEdit?.estado ?? item.estado_item
  const cantidadActual = localEdit?.estado === 'contado'
    ? localEdit.cantidad
    : item.cantidad_contada !== null
      ? String(item.cantidad_contada)
      : ''

  const diferencia = estadoActual === 'contado' && cantidadActual !== ''
    ? parseFloat(cantidadActual) - item.stock_sistema
    : null

  const esNoContado = estadoActual === 'no_contado'

  return (
    <div className={cn('px-4 py-3', esNoContado && 'opacity-40')}>
      <div className="flex items-center justify-between mb-2">
        <div>
          <p className="text-xs font-mono opacity-60">{item.numero_lote}</p>
          <p className="text-xs opacity-50">
            Vence: {item.fecha_vencimiento.slice(0, 7)} · Sistema: {formatCantidad(Number(item.stock_sistema), item.unidad_base_nombre, item.unidad_base_nombre_plural)}
          </p>
        </div>
        {diferencia !== null && (
          <DifBadge diferencia={diferencia} />
        )}
      </div>

      {editable && (
        <div className="flex items-center gap-3">
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="1"
            className="input input-bordered w-28 text-xl font-bold text-center h-14 text-base-content disabled:opacity-30"
            placeholder="—"
            value={cantidadActual}
            onChange={(e) => onCantidadChange(e.target.value)}
            disabled={esNoContado}
          />
          <div className="flex-1">
            <p className="text-xs opacity-50 mb-1">{item.unidad_base_nombre}</p>
            <button
              className={cn(
                'btn btn-xs',
                esNoContado ? 'btn-warning' : 'btn-ghost opacity-50'
              )}
              onClick={onNoContado}
            >
              {esNoContado ? 'Desmarcar' : 'No contado'}
            </button>
          </div>
        </div>
      )}

      {!editable && (
        <div className="flex items-center gap-2">
          <span className="text-xl font-bold">
            {item.cantidad_contada !== null
              ? (Number(item.cantidad_contada) % 1 === 0 ? Math.floor(Number(item.cantidad_contada)) : Number(item.cantidad_contada))
              : '—'}
          </span>
          <span className="text-sm opacity-50">
            {item.cantidad_contada !== null
              ? (Number(item.cantidad_contada) === 1 ? item.unidad_base_nombre : item.unidad_base_nombre_plural)
              : item.unidad_base_nombre}
          </span>
        </div>
      )}
    </div>
  )
}

function DifBadge({ diferencia }: { diferencia: number }) {
  if (Math.abs(diferencia) < 0.001) return <span className="badge badge-success badge-sm">±0</span>
  if (diferencia > 0) return <span className="badge badge-info badge-sm">+{diferencia.toFixed(2)}</span>
  return <span className="badge badge-error badge-sm">{diferencia.toFixed(2)}</span>
}

function ResumenRow({ label, value, className, icon }: { label: string; value: number; className?: string; icon: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-2 text-sm">
        <span>{icon}</span>
        <span className={className}>{label}</span>
      </span>
      <span className="font-semibold">{value} ítems</span>
    </div>
  )
}
