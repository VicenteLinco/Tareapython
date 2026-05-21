import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Upload, Download, CheckCircle2, AlertTriangle, XCircle,
  Package, Layers, BarChart3, Boxes, RefreshCw, Lock, FileUp
} from 'lucide-react'
import { notify } from '@/lib/notify'
import api from '@/lib/api'
import { parseApiError } from '@/lib/api-error'
import { SmartImporter } from './smart-importer'

// ─── Types ───────────────────────────────────────────────────────────────────

interface SetupEstado {
  carga_inicial_completada: boolean
  productos_cargados: number
  lotes_cargados: number
}

interface ImportResult {
  importados: number
  omitidos?: number
  errores: number
  detalle_errores: Array<{ fila: number; error: string }>
}

interface SetupResumen {
  productos: number
  presentaciones: number
  lotes: number
  stock_registros: number
  categorias_creadas: number
  areas_con_stock: number
}

type Paso = 'bienvenida' | 'productos' | 'resultado-productos' | 'stock' | 'resultado-stock' | 'resumen'

// ─── Plantillas CSV ───────────────────────────────────────────────────────────

const CSV_STOCK = `producto_nombre_o_codigo,numero_lote,fecha_vencimiento,area,cantidad,costo_unitario
Guante de látex talla S,LOT-2024-001,2026-12-31,Urgencias,200,4500
Tubo vacutainer EDTA 3mL,LOT-2024-002,2026-06-30,Hematología,500,350`

function descargarCsv(contenido: string, nombre: string) {
  const blob = new Blob([contenido], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nombre
  a.click()
  URL.revokeObjectURL(url)
}

// ─── Sub-componentes ──────────────────────────────────────────────────────────

function TablaErrores({ resultado }: { resultado: ImportResult }) {
  if (resultado.errores === 0 && resultado.detalle_errores.length === 0) {
    return (
      <div className="flex items-center gap-2 text-success text-sm">
        <CheckCircle2 className="w-4 h-4" />
        Sin errores
      </div>
    )
  }
  return (
    <div className="overflow-x-auto mt-3">
      <table className="table table-sm table-zebra">
        <thead>
          <tr>
            <th className="w-16">Fila</th>
            <th>Error</th>
          </tr>
        </thead>
        <tbody>
          {resultado.detalle_errores.map((e, i) => (
            <tr key={i} className="bg-error/5">
              <td className="font-mono text-xs text-base-content/50">{e.fila}</td>
              <td className="text-sm text-error">{e.error}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ResultadoBadges({ resultado, label }: { resultado: ImportResult; label: string }) {
  return (
    <div className="flex flex-wrap gap-2 items-center">
      <span className="text-sm font-medium text-base-content/70">{label}:</span>
      <span className="badge badge-success gap-1">
        <CheckCircle2 className="w-3 h-3" />
        {resultado.importados} importados
      </span>
      {(resultado.omitidos ?? 0) > 0 && (
        <span className="badge badge-warning gap-1">
          <AlertTriangle className="w-3 h-3" />
          {resultado.omitidos} omitidos
        </span>
      )}
      {resultado.errores > 0 && (
        <span className="badge badge-error gap-1">
          <XCircle className="w-3 h-3" />
          {resultado.errores} con error
        </span>
      )}
    </div>
  )
}

function UploadZone({
  label,
  hint,
  onFile,
  loading,
  accept = '.csv',
}: {
  label: string
  hint: string
  onFile: (file: File) => void
  loading: boolean
  accept?: string
}) {
  const ref = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)

  function handleFile(f: File) {
    setSelectedFile(f)
    onFile(f)
  }

  return (
    <div
      className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer
        ${dragging ? 'border-primary bg-primary/5' : 'border-base-300 hover:border-primary/50'}`}
      onClick={() => ref.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        const f = e.dataTransfer.files[0]
        if (f) handleFile(f)
      }}
    >
      <input
        ref={ref}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
      />
      {loading ? (
        <div className="flex flex-col items-center gap-2">
          <span className="loading loading-spinner loading-md text-primary" />
          <span className="text-sm text-base-content/60">Procesando {selectedFile?.name}…</span>
        </div>
      ) : selectedFile ? (
        <div className="flex flex-col items-center gap-2">
          <CheckCircle2 className="w-8 h-8 text-success" />
          <span className="text-sm font-medium">{selectedFile.name}</span>
          <span className="text-xs text-base-content/40">Haz clic para cambiar el archivo</span>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2">
          <Upload className="w-8 h-8 text-base-content/30" />
          <span className="text-sm font-medium">{label}</span>
          <span className="text-xs text-base-content/40">{hint}</span>
        </div>
      )}
    </div>
  )
}

// ─── Página principal ─────────────────────────────────────────────────────────

const PASOS: { id: Paso; label: string }[] = [
  { id: 'productos', label: 'Productos' },
  { id: 'stock', label: 'Stock' },
  { id: 'resumen', label: 'Finalizar' },
]

function pasoIndex(paso: Paso): number {
  if (paso === 'bienvenida') return 0
  if (paso === 'productos' || paso === 'resultado-productos') return 1
  if (paso === 'stock' || paso === 'resultado-stock') return 2
  return 3
}

export default function SetupPage() {
  const qc = useQueryClient()
  const [paso, setPaso] = useState<Paso>('bienvenida')
  const [showSmartImporter, setShowSmartImporter] = useState(false)
  const [resultadoStock, setResultadoStock] = useState<ImportResult | null>(null)

  const { data: estado, isLoading: cargandoEstado } = useQuery<SetupEstado>({
    queryKey: ['setup', 'estado'],
    queryFn: () => api.get('/setup/estado').then((r) => r.data),
  })

  const { data: resumen } = useQuery<SetupResumen>({
    queryKey: ['setup', 'resumen'],
    queryFn: () => api.get('/setup/resumen').then((r) => r.data),
    enabled: paso === 'resumen',
  })

  const importarStockMut = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData()
      fd.append('file', file)
      return api.post('/setup/importar-stock', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
    },
    onSuccess: (res) => {
      setResultadoStock(res.data)
      setPaso('resultado-stock')
      qc.invalidateQueries({ queryKey: ['setup', 'estado'] })
    },
    onError: (err) => notify.error(parseApiError(err)),
  })

  const finalizarMut = useMutation({
    mutationFn: () => api.post('/setup/finalizar'),
    onSuccess: () => {
      notify.success('¡Carga inicial completada! El sistema está listo.')
      qc.invalidateQueries({ queryKey: ['setup', 'estado'] })
    },
    onError: (err) => notify.error(parseApiError(err)),
  })

  // ── Pantalla de carga ──
  if (cargandoEstado) {
    return (
      <div className="flex items-center justify-center h-64">
        <span className="loading loading-spinner loading-lg text-primary" />
      </div>
    )
  }

  // ── Setup ya finalizado ──
  if (estado?.carga_inicial_completada) {
    return (
      <div className="max-w-lg mx-auto mt-16 text-center">
        <div className="p-4 bg-success/10 rounded-full w-fit mx-auto mb-4">
          <Lock className="w-8 h-8 text-success" />
        </div>
        <h2 className="text-xl font-semibold mb-2">Setup completado</h2>
        <p className="text-base-content/60 text-sm mb-6">
          La carga inicial fue finalizada. El sistema tiene{' '}
          <strong>{estado.productos_cargados}</strong> productos y{' '}
          <strong>{estado.lotes_cargados}</strong> lotes registrados.
        </p>
        <div className="stats stats-vertical shadow-sm w-full bg-base-100 border border-base-200 text-left">
          <div className="stat">
            <div className="stat-figure text-primary"><Package className="w-6 h-6" /></div>
            <div className="stat-title">Productos</div>
            <div className="stat-value text-primary text-2xl">{estado.productos_cargados}</div>
          </div>
          <div className="stat">
            <div className="stat-figure text-secondary"><Boxes className="w-6 h-6" /></div>
            <div className="stat-title">Lotes</div>
            <div className="stat-value text-secondary text-2xl">{estado.lotes_cargados}</div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl mx-auto relative">
      {/* Smart Importer Overlay */}
      {showSmartImporter && (
        <SmartImporter 
          onCancel={() => setShowSmartImporter(false)}
          onComplete={() => {
            setShowSmartImporter(false)
            qc.invalidateQueries({ queryKey: ['setup', 'estado'] })
            setPaso('stock')
          }}
        />
      )}

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Carga inicial</h1>
        <p className="text-base-content/60 text-sm mt-1">
          Importa el catálogo de productos y el stock inicial desde archivos CSV.
        </p>
      </div>

      {/* Steps */}
      {paso !== 'bienvenida' && (
        <ul className="steps steps-horizontal w-full mb-8">
          {PASOS.map((p) => (
            <li key={p.id} className={`step ${pasoIndex(paso) >= pasoIndex(p.id) ? 'step-primary' : ''}`}>
              {p.label}
            </li>
          ))}
        </ul>
      )}

      {/* ── Bienvenida ── */}
      {paso === 'bienvenida' && (
        <div className="card bg-base-100 border border-base-200 shadow-sm">
          <div className="card-body gap-5">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-primary/10 rounded-xl">
                <BarChart3 className="w-7 h-7 text-primary" />
              </div>
              <div>
                <h2 className="font-semibold text-lg">Asistente de carga inicial</h2>
                <p className="text-sm text-base-content/60 mt-1">
                  Este proceso importará todos los insumos del laboratorio en dos pasos:
                </p>
                <ol className="list-decimal list-inside text-sm text-base-content/70 mt-3 space-y-1">
                  <li>Catálogo de productos (nombre, categoría, unidad, presentaciones)</li>
                  <li>Stock inicial (lotes, fechas de vencimiento, cantidades por área)</li>
                </ol>
              </div>
            </div>

            {estado && estado.productos_cargados > 0 && (
              <div className="alert alert-warning py-2">
                <AlertTriangle className="w-4 h-4" />
                <span className="text-sm">
                  Ya hay <strong>{estado.productos_cargados}</strong> productos cargados.
                  Puedes continuar importando o ir directo al paso de stock.
                </span>
              </div>
            )}

            <div className="card-actions justify-end pt-2">
              <button className="btn btn-primary gap-2" onClick={() => setPaso('productos')}>
                Comenzar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Paso 1: Importar productos (REDISEÑADO) ── */}
      {paso === 'productos' && (
        <div className="card bg-base-100 border border-base-200 shadow-sm overflow-hidden">
          <div className="card-body gap-5 p-0">
             <div className="p-8">
                <div className="flex items-center gap-4 mb-6">
                  <div className="p-3 bg-primary/10 rounded-2xl text-primary">
                    <FileUp className="w-6 h-6" />
                  </div>
                  <div>
                    <h2 className="font-bold text-lg">Importar Productos</h2>
                    <p className="text-sm opacity-50">Usa el nuevo asistente interactivo 2026</p>
                  </div>
                </div>

                <div className="p-6 bg-base-200/50 rounded-3xl border border-base-300 border-dashed text-center">
                  <p className="text-sm font-medium mb-6 opacity-60">
                    Sube cualquier archivo CSV y el sistema te ayudará a mapear tus columnas automáticamente.
                  </p>
                  <button 
                    className="btn btn-primary btn-block h-14 rounded-2xl shadow-lg shadow-primary/20 gap-3"
                    onClick={() => setShowSmartImporter(true)}
                  >
                    <FileUp className="w-5 h-5" />
                    Abrir Importador Inteligente
                  </button>
                </div>
             </div>

            <div className="bg-base-200 p-8 flex justify-between items-center">
              <button className="btn btn-ghost btn-sm" onClick={() => setPaso('bienvenida')}>
                Atrás
              </button>
              <button
                className="btn btn-ghost btn-sm font-bold opacity-40 hover:opacity-100"
                onClick={() => setPaso('stock')}
              >
                Saltar este paso →
              </button>
            </div>
          </div>
        </div>
      )}


      {/* ── Paso 2: Importar stock ── */}
      {paso === 'stock' && (
        <div className="card bg-base-100 border border-base-200 shadow-sm">
          <div className="card-body gap-5">
            <div>
              <h2 className="font-semibold text-base">Paso 2 — Stock inicial</h2>
              <p className="text-sm text-base-content/60 mt-1">
                Usa el nombre o código interno del producto. La fecha acepta YYYY-MM-DD o DD/MM/YYYY.
              </p>
            </div>

            <div className="bg-base-200 rounded-lg p-3 text-xs font-mono text-base-content/70 overflow-x-auto">
              producto_nombre_o_codigo, numero_lote, fecha_vencimiento,
              area, cantidad, costo_unitario
            </div>

            <button
              className="btn btn-ghost btn-sm gap-2 w-fit"
              onClick={() => descargarCsv(CSV_STOCK, 'plantilla-stock.csv')}
            >
              <Download className="w-4 h-4" />
              Descargar plantilla
            </button>

            <UploadZone
              label="Arrastra o haz clic para seleccionar el CSV"
              hint="Máximo 5 MB · Solo archivos .csv"
              onFile={(f) => importarStockMut.mutate(f)}
              loading={importarStockMut.isPending}
            />

            <div className="card-actions justify-between">
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setPaso('productos')}
              >
                Atrás
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setPaso('resumen')}>
                Saltar este paso →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Resultado stock ── */}
      {paso === 'resultado-stock' && resultadoStock && (
        <div className="card bg-base-100 border border-base-200 shadow-sm">
          <div className="card-body gap-4">
            <h2 className="font-semibold text-base">Resultado — Stock</h2>

            <ResultadoBadges resultado={resultadoStock} label="Registros" />

            {resultadoStock.errores > 0 && (
              <TablaErrores resultado={resultadoStock} />
            )}

            {resultadoStock.errores > 0 && (
              <div className="alert alert-info py-2 text-sm">
                <AlertTriangle className="w-4 h-4" />
                Puedes corregir los errores y volver a subir. El stock existente no se duplica.
              </div>
            )}

            <div className="card-actions justify-between">
              <button
                className="btn btn-ghost btn-sm gap-1"
                onClick={() => { importarStockMut.reset(); setPaso('stock') }}
              >
                <RefreshCw className="w-3 h-3" />
                Volver a subir
              </button>
              <button className="btn btn-primary btn-sm" onClick={() => setPaso('resumen')}>
                Ver resumen →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Resumen + Finalizar ── */}
      {paso === 'resumen' && (
        <div className="card bg-base-100 border border-base-200 shadow-sm">
          <div className="card-body gap-5">
            <h2 className="font-semibold text-base">Paso 3 — Resumen y finalización</h2>

            {resumen ? (
              <div className="stats stats-vertical shadow-none border border-base-200 rounded-xl w-full">
                <div className="stat py-3">
                  <div className="stat-figure text-primary"><Package className="w-6 h-6" /></div>
                  <div className="stat-title text-xs">Productos</div>
                  <div className="stat-value text-xl">{resumen.productos}</div>
                  <div className="stat-desc">{resumen.presentaciones} presentaciones</div>
                </div>
                <div className="stat py-3">
                  <div className="stat-figure text-secondary"><Layers className="w-6 h-6" /></div>
                  <div className="stat-title text-xs">Lotes</div>
                  <div className="stat-value text-xl">{resumen.lotes}</div>
                  <div className="stat-desc">{resumen.stock_registros} registros con stock</div>
                </div>
                <div className="stat py-3">
                  <div className="stat-figure text-accent"><BarChart3 className="w-6 h-6" /></div>
                  <div className="stat-title text-xs">Áreas con stock</div>
                  <div className="stat-value text-xl">{resumen.areas_con_stock}</div>
                  <div className="stat-desc">{resumen.categorias_creadas} categorías</div>
                </div>
              </div>
            ) : (
              <div className="flex justify-center py-4">
                <span className="loading loading-spinner loading-md" />
              </div>
            )}

            <div className="alert alert-warning py-3">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <div className="text-sm">
                <p className="font-medium">¿Listo para finalizar?</p>
                <p className="text-base-content/70 mt-0.5">
                  Una vez finalizado, no podrás usar este asistente de carga masiva.
                  Las modificaciones deberán hacerse una a una desde el catálogo.
                </p>
              </div>
            </div>

            <div className="card-actions justify-between">
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setPaso(resultadoStock ? 'resultado-stock' : 'stock')}
              >
                Atrás
              </button>
              <button
                className="btn btn-success gap-2"
                disabled={finalizarMut.isPending || finalizarMut.isSuccess}
                onClick={() => finalizarMut.mutate()}
              >
                {finalizarMut.isPending ? (
                  <span className="loading loading-spinner loading-sm" />
                ) : (
                  <CheckCircle2 className="w-4 h-4" />
                )}
                {finalizarMut.isSuccess ? 'Completado' : 'Finalizar carga inicial'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
