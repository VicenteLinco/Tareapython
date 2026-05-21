import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, ChevronDown, ChevronUp, AlertTriangle, PackageOpen, MoreHorizontal, FileText, Files, CheckCircle2, TrendingDown, TrendingUp, Minus } from 'lucide-react'
import { ProductoImage } from '@/components/ui/producto-image'
import { EmptyState, InlineError, PageLoading } from '@/components/ui/page-state'
import { useAuthStore } from '@/hooks/use-auth-store'
import { useConteoSession } from '@/features/conteo/hooks/use-conteo-session'
import { useQuery } from '@tanstack/react-query'
import api from '@/lib/api'
import type { ConteoItem, Presentacion } from '@/types'
import { cn, formatDate, formatCantidad, formatStockHumano } from '@/lib/utils'
import { exportarConteoGlobalDiaPDF, exportarConteoSesionPDF } from '@/lib/conteo-pdf'
import { notify } from '@/lib/notify'

interface Configuracion {
  nombre_laboratorio: string
  logo_base64: string
  pin_kiosko: string
  conteo_ciego: boolean
  dias_autonomia_objetivo: number
  lead_time_default: number
}

// Agrupa items por producto (mantenemos esta utilidad local o se podría mover a utils)
function agruparPorProducto(items: ConteoItem[]) {
  const grupos: Record<string, { producto_nombre: string; imagen_url?: string | null; items: ConteoItem[] }> = {}
  for (const item of items) {
    if (!grupos[item.producto_id]) {
      grupos[item.producto_id] = { producto_nombre: item.producto_nombre, imagen_url: item.imagen_url, items: [] }
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
  const usuario = useAuthStore((s) => s.usuario)
  const isAdmin = usuario?.rol === 'admin'

  const { data: config } = useQuery({
    queryKey: ['configuracion'],
    queryFn: () => api.get<Configuracion>('/configuracion').then(r => r.data),
    staleTime: 60000
  })

  const {
    sesion,
    items,
    presentaciones,
    isLoading,
    isError,
    stats,
    editable,
    actions,
    nota,
    isSaving,
    isConfirming,
    hasChanges
  } = useConteoSession(id)

  // Guardado automático cuando hay cambios y no se está guardando ya
  useEffect(() => {
    if (hasChanges && !isSaving && editable) {
      const timer = setTimeout(() => actions.save(), 2000)
      return () => clearTimeout(timer)
    }
  }, [hasChanges, isSaving, editable, actions])

  const [showConfirmar, setShowConfirmar] = useState(false)
  const [colapsados, setColapsados] = useState<Record<string, boolean>>({})
  const [pdfLoading, setPdfLoading] = useState<'area' | 'global' | null>(null)

  const toggleColapsar = (productoId: string) =>
    setColapsados((prev) => ({ ...prev, [productoId]: !prev[productoId] }))

  const horasDesde = sesion
    ? Math.floor((Date.now() - new Date(sesion.created_at).getTime()) / 3600000)
    : 0

  const ajustes = useMemo(() => items
    .filter((item) => item.estado_item === 'contado' && item.cantidad_contada !== null)
    .map((item) => ({
      item,
      diferencia: Number(item.cantidad_contada) - Number(item.stock_sistema),
    }))
    .filter(({ diferencia }) => Math.abs(diferencia) > 0.0001)
    .sort((a, b) => Math.abs(b.diferencia) - Math.abs(a.diferencia)), [items])

  const totalAjustePositivo = ajustes
    .filter(({ diferencia }) => diferencia > 0)
    .reduce((acc, { diferencia }) => acc + diferencia, 0)
  const totalAjusteNegativo = ajustes
    .filter(({ diferencia }) => diferencia < 0)
    .reduce((acc, { diferencia }) => acc + Math.abs(diferencia), 0)
  const ajustesGrandes = ajustes.filter(({ item, diferencia }) =>
    Math.abs(diferencia) >= Math.max(10, Number(item.stock_sistema) * 0.5)
  )

  const exportarPdfArea = async () => {
    if (!sesion) return
    setPdfLoading('area')
    try {
      await exportarConteoSesionPDF({
        detalle: { sesion, items, presentaciones, nota },
        nombreLaboratorio: config?.nombre_laboratorio || 'Laboratorio',
        logoBase64: config?.logo_base64,
        usuarioNombre: usuario?.nombre || 'Usuario',
      })
    } catch {
      notify.error('No se pudo generar el PDF del conteo')
    } finally {
      setPdfLoading(null)
    }
  }

  const exportarPdfGlobal = async () => {
    if (!sesion?.confirmed_at) return
    setPdfLoading('global')
    try {
      await exportarConteoGlobalDiaPDF({
        detalle: { sesion, items, presentaciones, nota },
        fecha: sesion.confirmed_at,
        nombreLaboratorio: config?.nombre_laboratorio || 'Laboratorio',
        logoBase64: config?.logo_base64,
        usuarioNombre: usuario?.nombre || 'Usuario',
      })
    } catch {
      notify.error('No se pudo generar el PDF global del dia')
    } finally {
      setPdfLoading(null)
    }
  }

  if (isLoading) return (
    <PageLoading label="Cargando sesión de conteo..." className="min-h-screen" />
  )

  if (isError) return (
    <div className="flex justify-center items-center min-h-screen">
      <InlineError message="Error al cargar la sesión de conteo." className="max-w-sm" />
    </div>
  )

  if (!sesion) return null

  const grupos = agruparPorProducto(items)

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
          {sesion.estado === 'confirmado' && (
            <div className="flex items-center gap-1.5">
              <button
                className="btn btn-ghost btn-sm"
                onClick={exportarPdfArea}
                disabled={pdfLoading !== null}
                title="PDF del conteo de esta area"
              >
                {pdfLoading === 'area' ? <span className="loading loading-spinner loading-xs" /> : <FileText className="h-4 w-4" />}
                <span className="hidden sm:inline">Area</span>
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={exportarPdfGlobal}
                disabled={pdfLoading !== null || !sesion.confirmed_at}
                title="PDF global de conteos confirmados ese dia"
              >
                {pdfLoading === 'global' ? <span className="loading loading-spinner loading-xs" /> : <Files className="h-4 w-4" />}
                <span className="hidden sm:inline">Global</span>
              </button>
            </div>
          )}
          {editable && hasChanges && (
            <button
              className="btn btn-primary btn-sm"
              onClick={actions.save}
              disabled={isSaving}
            >
              {isSaving ? <span className="loading loading-spinner loading-xs" /> : 'Guardar'}
            </button>
          )}
        </div>
        {/* Barra de progreso */}
        <div className="px-4 pb-3">
          <div className="flex justify-between text-xs opacity-60 mb-1">
            <span>{stats.contados} / {stats.total} ítems contados</span>
            <span>{stats.progreso}%</span>
          </div>
          <div className="w-full bg-base-200 rounded-full h-2">
            <div
              className="h-2 rounded-full bg-primary transition-all duration-300"
              style={{ width: `${stats.progreso}%` }}
            />
          </div>
        </div>
      </div>

      {/* Lista de ítems */}
      <div className="flex-1 px-3 py-3 space-y-2 pb-32">
        {grupos.length === 0 && (
          <EmptyState
            icon={<PackageOpen className="h-6 w-6" />}
            title="Área sin insumos en stock"
            description={`No hay lotes con cantidad mayor a cero registrados en esta área.${editable && isAdmin ? ' Puedes confirmar el conteo como área vacía.' : ''}`}
          />
        )}
        {grupos.map(([productoId, grupo]) => (
          <div key={productoId} className="bg-base-100 rounded-xl overflow-hidden border border-base-200">
            <button
              className="w-full flex items-center justify-between px-4 py-3 text-left"
              onClick={() => toggleColapsar(productoId)}
            >
              <div className="flex items-center gap-2">
                <ProductoImage src={grupo.imagen_url} size="sm" />
                <span className="font-semibold text-sm">{grupo.producto_nombre}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs opacity-40">{formatCantidad(grupo.items.length, 'lote')}</span>
                {colapsados[productoId] ? <ChevronDown className="h-4 w-4 opacity-40" /> : <ChevronUp className="h-4 w-4 opacity-40" />}
              </div>
            </button>

            {!colapsados[productoId] && (
              <div className="divide-y divide-base-200">
                {grupo.items.map((item) => (
                  <LoteRow
                    key={item.id}
                    item={item}
                    editable={editable}
                    conteoCiego={config?.conteo_ciego ?? false}
                    presentaciones={presentaciones.filter(p => p.producto_id === item.producto_id)}
                    onCantidadChange={(v: string) => actions.updateItem(item, v)}
                    onNoContado={() => actions.toggleNoContado(item)}
                  />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Confirmar Bar */}
      {isAdmin && editable && !hasChanges && (
        <div className="fixed bottom-0 left-0 right-0 p-4 bg-base-100 border-t border-base-200">
          <button className="btn btn-primary w-full" onClick={() => setShowConfirmar(true)}>
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
              <ResumenRow label="Sin diferencia" value={stats.sinDiff} className="text-success" icon={<CheckCircle2 className="size-4" />} />
              <ResumenRow label="Ajuste negativo" value={stats.negativo} className="text-error" icon={<TrendingDown className="size-4" />} />
              <ResumenRow label="Ajuste positivo" value={stats.positivo} className="text-info" icon={<TrendingUp className="size-4" />} />
              <ResumenRow label="No contados" value={stats.noContados} className="opacity-50" icon={<Minus className="size-4" />} />
            </div>

            {ajustes.length > 0 && (
              <div className="rounded-lg border border-base-300 bg-base-200/50 p-3 mb-4 space-y-2">
                <div className="flex items-center justify-between text-xs font-bold uppercase opacity-60">
                  <span>Total a ajustar</span>
                  <span>
                    +{formatCantidad(totalAjustePositivo, 'reaccion', 'reacciones')}
                    {' / '}
                    -{formatCantidad(totalAjusteNegativo, 'reaccion', 'reacciones')}
                  </span>
                </div>
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {ajustes.slice(0, 6).map(({ item, diferencia }) => (
                    <div key={item.id} className="flex items-center justify-between gap-3 text-xs">
                      <span className="truncate">
                        {item.producto_nombre} - {item.numero_lote}
                      </span>
                      <span className={cn('font-mono font-bold shrink-0', diferencia > 0 ? 'text-info' : 'text-error')}>
                        {diferencia > 0 ? '+' : ''}
                        {formatCantidad(diferencia, item.unidad_base_nombre, item.unidad_base_nombre_plural)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {ajustesGrandes.length > 0 && (
              <div className="alert alert-error mb-4 text-sm py-2">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>Hay ajustes grandes. Revisa cantidades y presentaciones antes de confirmar.</span>
              </div>
            )}

            {horasDesde >= 2 && (
              <div className="alert alert-warning mb-4 text-sm py-2">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>Han pasado {horasDesde}h desde el inicio. Los movimientos recientes pueden afectar las diferencias.</span>
              </div>
            )}

            <div className="form-control mb-4">
              <label className="label"><span className="label-text">Nota (opcional)</span></label>
              <textarea
                className="textarea textarea-bordered"
                rows={2}
                value={nota}
                onChange={(e) => actions.setNota(e.target.value)}
              />
            </div>

            <div className="modal-action">
              <button className="btn btn-ghost flex-1" onClick={() => setShowConfirmar(false)}>Cancelar</button>
              <button
                className="btn btn-primary flex-1"
                onClick={actions.confirm}
                disabled={isConfirming}
              >
                {isConfirming ? <span className="loading loading-spinner loading-sm" /> : 'Confirmar ajustes'}
              </button>
            </div>
          </div>
          <div className="modal-backdrop" onClick={() => setShowConfirmar(false)} />
        </div>
      )}
    </div>
  )
}

interface LoteRowProps {
  item: ConteoItem
  editable: boolean
  conteoCiego: boolean
  presentaciones: Presentacion[]
  onCantidadChange: (cantidad: string) => void
  onNoContado: () => void
}

function LoteRow({ item, editable, conteoCiego, presentaciones, onCantidadChange, onNoContado }: LoteRowProps) {
  const esNoContado = item.estado_item === 'no_contado'
  const contado = item.estado_item === 'contado'
  const diferencia = contado && item.cantidad_contada !== null
    ? Number(item.cantidad_contada) - Number(item.stock_sistema)
    : null

  // Estado local para los inputs
  const [presCounts, setPresCounts] = useState<Record<number, string>>({})
  const [unidadesSueltas, setUnidadesSueltas] = useState('')

  useEffect(() => {
    if (contado && item.cantidad_contada !== null && presentaciones.length > 0) {
      const total = Number(item.cantidad_contada)
      const newPres: Record<number, string> = {}
      const p = presentaciones[0]
      const factorConversion = Number(p.factor_conversion)
      const cantPres = Math.floor(total / factorConversion)
      const resto = total % factorConversion
      if (cantPres > 0) newPres[p.id] = String(cantPres)
      setPresCounts(newPres)
      setUnidadesSueltas(resto > 0 ? String(resto) : '')
    }
  }, [contado, item.cantidad_contada, presentaciones])

  const updateTotal = (newPresCounts: Record<number, string>, newSueltas: string) => {
    let total = parseFloat(newSueltas) || 0
    presentaciones.forEach((p) => {
      total += (parseFloat(newPresCounts[p.id]) || 0) * Number(p.factor_conversion)
    })
    onCantidadChange(String(total))
  }

  const handlePresChange = (presId: number, val: string) => {
    const next = { ...presCounts, [presId]: val }; setPresCounts(next); updateTotal(next, unidadesSueltas)
  }

  const handleSueltasChange = (val: string) => {
    setUnidadesSueltas(val); updateTotal(presCounts, val)
  }

  // Stock formateado humano (ej: 1 Caja + 10 Reacciones)
  const stockSisHumano = presentaciones.length > 0 
    ? formatStockHumano(
        Number(item.stock_sistema), 
        Number(presentaciones[0].factor_conversion),
        item.unidad_base_nombre, item.unidad_base_nombre_plural,
        presentaciones[0].nombre, presentaciones[0].nombre_plural
      )
    : formatCantidad(Number(item.stock_sistema), item.unidad_base_nombre, item.unidad_base_nombre_plural)

  return (
    <div className={cn(
      'px-3 py-2.5 transition-all duration-200 border-l-4', 
      esNoContado ? 'bg-warning/5 border-warning opacity-60' : 
      contado ? 'bg-success/5 border-success' : 'bg-base-100 border-transparent'
    )}>
      {/* Fila 1: Info Lote y Stock Sistema */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-mono font-black opacity-80 truncate">{item.numero_lote}</span>
          <span className="text-[10px] opacity-40 font-bold bg-base-200 px-1 rounded">{item.fecha_vencimiento.slice(2, 10)}</span>
          {!conteoCiego && (
            <span className="text-[10px] text-primary/60 font-black uppercase ml-1">
               Sistema: {stockSisHumano}
            </span>
          )}
        </div>
        
        <div className="flex items-center gap-1.5 shrink-0">
          {!conteoCiego && diferencia !== null && <DifBadge diferencia={diferencia} />}
          <div className="dropdown dropdown-end">
            <label tabIndex={0} className="btn btn-ghost btn-xs btn-circle opacity-20 hover:opacity-100"><MoreHorizontal className="h-3.5 w-3.5" /></label>
            <ul tabIndex={0} className="dropdown-content menu p-2 rounded-box w-48 text-xs">
              <li><button onClick={onNoContado} className={esNoContado ? 'text-primary' : 'text-warning'}>{esNoContado ? 'Reactivar' : 'No encontrado'}</button></li>
            </ul>
          </div>
        </div>
      </div>

      {/* Fila 2: Inputs Compactos */}
      {editable && !esNoContado && (
        <div className="flex items-center gap-2">
          {presentaciones.length > 0 ? (
            <div className="flex-1 flex items-center gap-2 bg-base-200/40 p-1.5 rounded-xl border border-base-200/50">
              {presentaciones.map((p) => (
                <div key={p.id} className="flex items-center gap-1.5">
                  <input
                    type="number" inputMode="numeric"
                    className="input input-xs input-bordered w-14 text-center font-bold h-8 rounded-lg"
                    placeholder="0" value={presCounts[p.id] || ''}
                    onChange={(e) => handlePresChange(p.id, e.target.value)}
                  />
                  <span className="text-[10px] font-bold opacity-40 uppercase truncate max-w-[40px]">{p.nombre_plural || p.nombre}</span>
                </div>
              ))}
              <div className="flex items-center gap-1.5 ml-1 border-l border-base-300/50 pl-2">
                <input
                  type="number" inputMode="numeric"
                  className="input input-xs input-bordered w-14 text-center font-bold h-8 rounded-lg"
                  placeholder="0" value={unidadesSueltas}
                  onChange={(e) => handleSueltasChange(e.target.value)}
                />
                <span className="text-[10px] font-bold opacity-40 uppercase">{item.unidad_base_nombre_plural}</span>
              </div>
            </div>
          ) : (
            <div className="flex-1">
              <input
                type="number" inputMode="decimal"
                className="input input-sm input-bordered w-28 text-center font-bold rounded-xl h-9"
                placeholder="0" value={item.cantidad_contada ?? ''}
                onChange={(e) => onCantidadChange(e.target.value)}
              />
              <span className="text-[10px] font-bold opacity-40 uppercase ml-2">{item.unidad_base_nombre_plural}</span>
            </div>
          )}

          {/* Mini Indicador de Total e Impacto */}
          <div className="flex flex-col items-end min-w-[60px] leading-tight">
            {presentaciones.length > 0 && (
              <>
                <span className="text-[9px] font-black opacity-30 uppercase tracking-tighter">Total</span>
                <span className="text-xs font-bold font-mono">
                  {Number(item.cantidad_contada || 0).toString()}
                </span>
              </>
            )}
            {contado && <span className="text-[8px] font-black text-success uppercase mt-0.5">OK</span>}
          </div>
        </div>
      )}

      {/* Vista solo lectura compacta */}
      {!editable && !esNoContado && (
        <div className="flex items-center gap-2 text-xs font-bold opacity-70">
          <span>Contado:</span>
          <span>{item.cantidad_contada !== null ? formatCantidad(Number(item.cantidad_contada), item.unidad_base_nombre, item.unidad_base_nombre_plural) : '—'}</span>
        </div>
      )}

      {esNoContado && (
        <div className="flex items-center gap-1.5 text-warning text-[9px] font-black uppercase">
          <AlertTriangle className="h-3 w-3" /> No encontrado
        </div>
      )}
    </div>
  )
}

// (DifBadge, ResumenRow se mantienen igual para asegurar funcionamiento visual)

function DifBadge({ diferencia }: { diferencia: number }) {
  if (Math.abs(diferencia) < 0.001) return <span className="badge badge-success badge-sm">±0</span>
  const label = Math.abs(diferencia - Math.round(diferencia)) < 0.0001 ? Math.round(diferencia).toString() : diferencia.toFixed(2)
  if (diferencia > 0) return <span className="badge badge-info badge-sm">+{label}</span>
  return <span className="badge badge-error badge-sm">{label}</span>
}

function ResumenRow({ label, value, className, icon }: { label: string; value: number; className?: string; icon: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-2 text-sm">
        <span className={className}>{icon}</span>
        <span className={className}>{label}</span>
      </span>
      <span className="font-semibold">{value} ítems</span>
    </div>
  )
}
