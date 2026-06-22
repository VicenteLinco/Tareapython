import { useState, useRef, useEffect } from 'react'
import { ChevronLeft, ChevronRight, AlertTriangle, CheckCircle2, SkipForward, ScanLine, X } from 'lucide-react'
import type { ConteoItem, Presentacion } from '@/types'
import { cn, formatCantidad } from '@/lib/utils'
import { QrScanner } from '@/components/shared/qr-scanner'
import { resolverScanConteo } from '../scan-utils'
import { notify } from '@/lib/notify'

export interface MobileConteoViewProps {
  items: ConteoItem[]
  presentaciones: Presentacion[]
  stats: { contados: number; total: number }
  editable: boolean
  isSaving: boolean
  conteoCiego?: boolean
  actions: {
    updateCantidad(item: ConteoItem, valor: string): void
    toggleNoContado(item: ConteoItem): void
    save(): void
  }
}

/** Ítems con diferencia significativa (>=20% del stock_sistema o >=10 unidades) */
function esDifGrande(item: ConteoItem): boolean {
  if (item.estado_item !== 'contado' || item.cantidad_contada === null) return false
  const dif = Math.abs(Number(item.cantidad_contada) - Number(item.stock_sistema))
  return dif >= 10 || (Number(item.stock_sistema) > 0 && dif / Number(item.stock_sistema) >= 0.2)
}

export function MobileConteoView({
  items,
  presentaciones,
  stats,
  editable,
  isSaving,
  conteoCiego = false,
  actions,
}: MobileConteoViewProps) {
  const [currentIdx, setCurrentIdx] = useState(0)
  const [localValor, setLocalValor] = useState('')
  const [saveCounter, setSaveCounter] = useState(0)
  const [scanMode, setScanMode] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleScan = (code: string) => {
    const res = resolverScanConteo(code, items, presentaciones)
    if (res.kind === 'no-match') {
      notify.warning(`El código "${code.trim()}" no corresponde a ningún lote de esta área`)
      return
    }
    // Wizard móvil: saltamos al ítem (al primero del grupo si el GTIN es ambiguo).
    const target = res.kind === 'lote' ? res.item : res.items[0]
    const idx = items.findIndex((i) => i.id === target.id)
    if (idx >= 0) setCurrentIdx(idx)
    setScanMode(false)
  }

  const safeIdx = Math.min(currentIdx, Math.max(0, items.length - 1))
  const item = items[safeIdx] ?? null

  // Sincronizar el valor local cuando cambia el item
  useEffect(() => {
    if (!item) return
    if (item.estado_item === 'contado' && item.cantidad_contada !== null) {
      setLocalValor(String(item.cantidad_contada))
    } else {
      setLocalValor('')
    }
    inputRef.current?.focus()
  }, [safeIdx]) // eslint-disable-line react-hooks/exhaustive-deps

  const avanzar = (skipSave = false) => {
    if (!skipSave && localValor !== '' && item) {
      actions.updateCantidad(item, localValor)
      // Autoguardado cada 2 ítems avanzados
      const next = saveCounter + 1
      setSaveCounter(next)
      if (next % 2 === 0) {
        actions.save()
      }
    }
    setCurrentIdx((prev) => Math.min(prev + 1, items.length - 1))
  }

  const retroceder = () => {
    setCurrentIdx((prev) => Math.max(prev - 1, 0))
  }

  const handleNoDisponible = () => {
    if (item) {
      actions.toggleNoContado(item)
      avanzar(true)
    }
  }

  const handleGuardarYAvanzar = () => {
    if (item && localValor !== '') {
      actions.updateCantidad(item, localValor)
    }
    avanzar(true)
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setLocalValor(val)
    if (item) actions.updateCantidad(item, val)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleGuardarYAvanzar()
    }
  }

  // Pantalla de resumen cuando todos los ítems han sido procesados
  const terminados = stats.contados + items.filter(i => i.estado_item === 'no_contado').length
  const todosProcesados = items.length > 0 && terminados >= stats.total

  if (todosProcesados && currentIdx >= items.length) {
    return <ResumenFinal items={items} stats={stats} />
  }

  if (!item) {
    return (
      <div className="flex items-center justify-center flex-1 text-base-content/40 text-sm">
        Sin ítems para contar
      </div>
    )
  }

  const esNoContado = item.estado_item === 'no_contado'
  const diferencia = item.estado_item === 'contado' && item.cantidad_contada !== null
    ? Number(item.cantidad_contada) - Number(item.stock_sistema)
    : null

  const unitLabel = formatCantidad(
    parseFloat(localValor) || 0,
    item.unidad_base_nombre,
    item.unidad_base_nombre_plural
  ).replace(/^[\d.,\s]+/, '').trim() || item.unidad_base_nombre

  return (
    <div className="flex flex-col min-h-0 flex-1 bg-base-200">
      {/* Barra de progreso */}
      <div className="px-4 pt-3 pb-2">
        <div className="flex justify-between text-xs opacity-60 mb-1.5">
          <span>{stats.contados} de {stats.total} contados</span>
          <span>{safeIdx + 1} / {items.length}</span>
        </div>
        <div className="w-full bg-base-300 rounded-full h-2.5">
          <div
            className="h-2.5 rounded-full bg-primary transition-all duration-300"
            style={{ width: `${stats.total > 0 ? Math.round((stats.contados / stats.total) * 100) : 0}%` }}
          />
        </div>
      </div>

      {/* Botón escanear (cámara) */}
      {editable && (
        <div className="px-4 pt-1">
          <button
            onClick={() => setScanMode(true)}
            className="btn btn-outline btn-primary btn-sm w-full gap-2"
          >
            <ScanLine className="h-4 w-4" /> Escanear lote con la cámara
          </button>
        </div>
      )}

      {/* Navegación superior */}
      <div className="flex items-center justify-between px-4 py-1">
        <button
          className="btn btn-ghost btn-sm btn-circle"
          onClick={retroceder}
          disabled={safeIdx === 0}
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <span className="text-xs font-mono opacity-40">
          {safeIdx + 1} / {items.length}
        </span>
        <button
          className="btn btn-ghost btn-sm btn-circle"
          onClick={() => avanzar(true)}
          disabled={safeIdx >= items.length - 1}
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      {/* Card del ítem actual */}
      <div className="flex-1 px-4 pb-4 flex flex-col">
        <div className={cn(
          'bg-base-100 rounded-3xl shadow-lg p-6 flex flex-col gap-4 flex-1',
          esNoContado && 'opacity-60 border-2 border-warning'
        )}>
          {/* Info del producto */}
          <div className="text-center">
            <p className="text-lg font-bold leading-tight">{item.producto_nombre}</p>
            <p className="text-xs font-mono opacity-50 mt-1">{item.numero_lote}</p>
            <p className="text-[10px] opacity-30 mt-0.5">{item.fecha_vencimiento.slice(0, 10)}</p>
          </div>

          {/* Stock sistema (si no es ciego) */}
          {!conteoCiego && (
            <div className="text-center">
              <span className="text-xs opacity-40 uppercase tracking-widest font-bold">Stock sistema</span>
              <p className="text-sm font-mono font-bold opacity-60">
                {formatCantidad(Number(item.stock_sistema), item.unidad_base_nombre, item.unidad_base_nombre_plural)}
              </p>
            </div>
          )}

          {/* Estado no disponible */}
          {esNoContado ? (
            <div className="flex flex-col items-center gap-2 flex-1 justify-center">
              <AlertTriangle className="h-10 w-10 text-warning" />
              <p className="text-sm font-bold text-warning">No disponible</p>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => { actions.toggleNoContado(item) }}
              >
                Reactivar
              </button>
            </div>
          ) : (
            /* Input de cantidad */
            <div className="flex flex-col items-center gap-2 flex-1 justify-center">
              <input
                ref={inputRef}
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                className="input input-lg border-0 bg-transparent text-4xl font-bold text-center w-full focus:outline-none"
                placeholder="0"
                value={localValor}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                disabled={!editable}
              />
              <span className="text-sm opacity-60 text-center">{unitLabel}</span>

              {/* Diferencia badge (si no es ciego y ya tiene valor) */}
              {!conteoCiego && diferencia !== null && Math.abs(diferencia) > 0.001 && (
                <span className={cn(
                  'badge badge-sm font-mono',
                  diferencia > 0 ? 'badge-info' : 'badge-error'
                )}>
                  {diferencia > 0 ? '+' : ''}{formatCantidad(diferencia, item.unidad_base_nombre, item.unidad_base_nombre_plural)}
                </span>
              )}
              {!conteoCiego && diferencia !== null && Math.abs(diferencia) <= 0.001 && (
                <span className="badge badge-success badge-sm">±0</span>
              )}
            </div>
          )}
        </div>

        {/* Botones de acción */}
        {editable && (
          <div className="mt-4 flex flex-col gap-2">
            {/* Botón principal: Guardar y avanzar */}
            <button
              className="btn btn-primary w-full"
              onClick={handleGuardarYAvanzar}
              disabled={isSaving || safeIdx >= items.length - 1}
            >
              {isSaving
                ? <span className="loading loading-spinner loading-sm" />
                : <>Siguiente <ChevronRight className="h-4 w-4" /></>
              }
            </button>

            <div className="flex gap-2">
              {/* Saltar */}
              <button
                className="btn btn-ghost flex-1"
                onClick={() => avanzar(true)}
                disabled={safeIdx >= items.length - 1}
              >
                <SkipForward className="h-4 w-4" />
                Saltar
              </button>

              {/* No disponible */}
              <button
                className={cn('btn btn-ghost flex-1', esNoContado ? 'text-primary' : 'text-error')}
                onClick={handleNoDisponible}
              >
                <AlertTriangle className="h-4 w-4" />
                {esNoContado ? 'Reactivar' : 'No disponible'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Overlay de escaneo por cámara */}
      {scanMode && (
        <div className="fixed inset-0 z-40 bg-base-300/95 backdrop-blur flex flex-col p-4">
          <div className="flex items-center justify-between mb-4">
            <span className="font-bold flex items-center gap-2 text-sm">
              <ScanLine className="h-4 w-4 text-primary" /> Escaneá un lote
            </span>
            <button onClick={() => setScanMode(false)} className="btn btn-ghost btn-sm btn-circle">
              <X className="h-5 w-5" />
            </button>
          </div>
          <QrScanner active={scanMode} onScan={handleScan} />
          <p className="text-center text-xs opacity-50 mt-4">
            Apuntá al código del lote o del producto. Se saltará a ese ítem para que cargues la cantidad.
          </p>
        </div>
      )}
    </div>
  )
}

// --- Pantalla de resumen final ---

interface ResumenFinalProps {
  items: ConteoItem[]
  stats: { contados: number; total: number }
}

function ResumenFinal({ items, stats }: ResumenFinalProps) {
  const itemsConDifGrande = items.filter(esDifGrande)
  const noDisponibles = items.filter(i => i.estado_item === 'no_contado')

  return (
    <div className="flex flex-col flex-1 bg-base-200 px-4 py-6 gap-4 overflow-y-auto">
      {/* Encabezado */}
      <div className="text-center">
        <CheckCircle2 className="h-12 w-12 text-success mx-auto mb-2" />
        <p className="text-lg font-bold">Conteo completado</p>
        <p className="text-sm opacity-50">{stats.contados} de {stats.total} ítems contados</p>
      </div>

      {/* Diferencias grandes */}
      {itemsConDifGrande.length > 0 && (
        <div className="bg-base-100 rounded-2xl p-4">
          <p className="text-xs font-bold uppercase tracking-widest opacity-40 mb-3">
            Diferencias destacadas
          </p>
          <div className="space-y-2">
            {itemsConDifGrande.map((item) => {
              const dif = Number(item.cantidad_contada) - Number(item.stock_sistema)
              return (
                <div key={item.id} className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">{item.producto_nombre}</p>
                    <p className="text-xs font-mono opacity-40">{item.numero_lote}</p>
                  </div>
                  <span className={cn(
                    'badge badge-sm font-mono shrink-0',
                    dif > 0 ? 'badge-info' : 'badge-error'
                  )}>
                    {dif > 0 ? '+' : ''}{formatCantidad(dif, item.unidad_base_nombre, item.unidad_base_nombre_plural)}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* No disponibles */}
      {noDisponibles.length > 0 && (
        <div className="bg-base-100 rounded-2xl p-4">
          <p className="text-xs font-bold uppercase tracking-widest opacity-40 mb-3">
            No disponibles ({noDisponibles.length})
          </p>
          <div className="space-y-2">
            {noDisponibles.map((item) => (
              <div key={item.id} className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-warning shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate">{item.producto_nombre}</p>
                  <p className="text-xs font-mono opacity-40">{item.numero_lote}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-center text-xs opacity-40">
        Pulsa "Revisar y confirmar" en la pantalla anterior para finalizar el conteo.
      </p>
    </div>
  )
}
