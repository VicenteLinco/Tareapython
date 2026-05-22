import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Plus,
  Pencil,
  Trash2,
  User,
  History,
  ChevronDown,
  ChevronUp,
  Database,
  CalendarRange,
  X,
} from 'lucide-react'
import api from '@/lib/api'
import type { PaginatedResponse } from '@/types'
import { Badge } from '@/components/ui/badge'
import { Pagination } from '@/components/ui/pagination'
import { useFilterStorage } from '@/hooks/use-filter-storage'

interface AuditLogItem {
  id: number
  tabla: string
  registro_id: string
  accion: 'CREATE' | 'UPDATE' | 'DELETE'
  datos_anteriores: Record<string, unknown> | null
  datos_nuevos: Record<string, unknown> | null
  usuario_nombre: string
  created_at: string
}

const TABLA_LABELS: Record<string, string> = {
  productos: 'Producto',
  proveedores: 'Proveedor',
  categorias: 'Categoría',
  areas: 'Área',
  unidades_basicas: 'Unidad',
  usuarios: 'Usuario',
  presentaciones: 'Presentación',
}

const ACCION_LABELS: Record<string, string> = {
  CREATE: 'Creó',
  UPDATE: 'Modificó',
  DELETE: 'Eliminó',
}

const HIDDEN_FIELDS = new Set(['id', 'created_at', 'updated_at', 'deleted_at', 'version'])

function extractName(data: Record<string, unknown> | null): string | null {
  if (!data) return null
  for (const field of ['nombre', 'name', 'email', 'codigo', 'numero_documento']) {
    if (typeof data[field] === 'string' && data[field]) return data[field] as string
  }
  return null
}

interface DiffField {
  campo: string
  antes: unknown
  despues: unknown
}

function computeDiff(
  prev: Record<string, unknown> | null,
  next: Record<string, unknown> | null
): DiffField[] {
  const allKeys = new Set([...Object.keys(prev || {}), ...Object.keys(next || {})])
  const diffs: DiffField[] = []
  for (const key of allKeys) {
    if (HIDDEN_FIELDS.has(key)) continue
    const a = prev?.[key]
    const b = next?.[key]
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      diffs.push({ campo: key, antes: a, despues: b })
    }
  }
  return diffs
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'boolean') return v ? 'Sí' : 'No'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function groupByDay(logs: AuditLogItem[]): { label: string; items: AuditLogItem[] }[] {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)

  const groups = new Map<string, AuditLogItem[]>()
  for (const log of logs) {
    const d = new Date(log.created_at)
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(log)
  }

  return Array.from(groups.entries()).map(([, items]) => {
    const d = new Date(items[0].created_at)
    d.setHours(0, 0, 0, 0)
    let label: string
    if (d.getTime() === today.getTime()) {
      label = 'Hoy'
    } else if (d.getTime() === yesterday.getTime()) {
      label = 'Ayer'
    } else {
      label = new Intl.DateTimeFormat('es-CL', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }).format(d)
    }
    return { label, items }
  })
}

function actionColors(accion: string) {
  if (accion === 'CREATE') return 'bg-success/10 text-success'
  if (accion === 'DELETE') return 'bg-error/10 text-error'
  return 'bg-info/10 text-info'
}

function actionBadgeVariant(accion: string): 'success' | 'destructive' | 'info' {
  if (accion === 'CREATE') return 'success'
  if (accion === 'DELETE') return 'destructive'
  return 'info'
}

function ActionIcon({ accion }: { accion: string }) {
  const cls = 'w-4 h-4'
  if (accion === 'CREATE') return <Plus className={cls} />
  if (accion === 'DELETE') return <Trash2 className={cls} />
  return <Pencil className={cls} />
}

function DiffView({ log }: { log: AuditLogItem }) {
  if (log.accion === 'UPDATE') {
    const diffs = computeDiff(log.datos_anteriores, log.datos_nuevos)
    if (diffs.length === 0) {
      return (
        <p className="text-xs text-base-content/40 italic">
          Sin cambios detectados en campos visibles.
        </p>
      )
    }
    return (
      <div className="space-y-2">
        <p className="text-[10px] font-bold uppercase tracking-widest text-base-content/40">
          Campos modificados ({diffs.length})
        </p>
        <div className="rounded-xl overflow-hidden border border-base-300">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-base-200/60">
                <th className="text-left px-3 py-2 font-semibold text-base-content/50 w-1/4">
                  Campo
                </th>
                <th className="text-left px-3 py-2 font-semibold text-error/70 w-[37.5%]">
                  Antes
                </th>
                <th className="text-left px-3 py-2 font-semibold text-success/70 w-[37.5%]">
                  Después
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-base-200">
              {diffs.map(({ campo, antes, despues }) => (
                <tr key={campo} className="hover:bg-base-200/20">
                  <td className="px-3 py-2 font-mono text-base-content/60">{campo}</td>
                  <td className="px-3 py-2 font-mono text-error/80 bg-error/5 line-through decoration-error/30">
                    {formatValue(antes)}
                  </td>
                  <td className="px-3 py-2 font-mono text-success/80 bg-success/5">
                    {formatValue(despues)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  const data = log.accion === 'CREATE' ? log.datos_nuevos : log.datos_anteriores
  if (!data) return null
  const entries = Object.entries(data).filter(([k]) => !HIDDEN_FIELDS.has(k))
  if (entries.length === 0) return null

  return (
    <div className="space-y-2">
      <p className="text-[10px] font-bold uppercase tracking-widest text-base-content/40">
        {log.accion === 'CREATE' ? 'Datos del registro creado' : 'Datos del registro eliminado'}
      </p>
      <div className="rounded-xl overflow-hidden border border-base-300">
        <table className="w-full text-xs">
          <tbody className="divide-y divide-base-200">
            {entries.map(([campo, valor]) => (
              <tr key={campo} className="hover:bg-base-200/20">
                <td className="px-3 py-2 font-mono text-base-content/50 w-1/3">{campo}</td>
                <td className="px-3 py-2 font-mono">{formatValue(valor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const AL_DEFAULTS = { tabla: '', accion: '', desde: '', hasta: '' }

export default function AuditLogPage() {
  const [page, setPage] = useState(1)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const { filters: alf, setFilters: setAlf } = useFilterStorage('audit-log', AL_DEFAULTS)

  const hasFilters = alf.tabla || alf.accion || alf.desde || alf.hasta

  const { data, isLoading } = useQuery({
    queryKey: ['audit-log', { page, ...alf }],
    queryFn: () =>
      api
        .get<PaginatedResponse<AuditLogItem>>('/audit-log', {
          params: {
            page,
            per_page: 25,
            tabla: alf.tabla || undefined,
            accion: alf.accion || undefined,
            desde: alf.desde || undefined,
            hasta: alf.hasta || undefined,
          },
        })
        .then(r => r.data),
  })

  const logs = data?.data || []
  const groups = groupByDay(logs)

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <History className="w-6 h-6 text-primary" />
          Auditoría del Sistema
        </h1>
        <p className="text-sm text-base-content/50 mt-1">
          Seguimiento detallado de cambios en el catálogo y configuraciones
          {data?.total !== undefined && (
            <span className="ml-2 badge badge-sm badge-neutral font-mono">
              {data.total} registros
            </span>
          )}
        </p>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-4 bg-base-100 p-4 rounded-2xl border border-base-200 shadow-sm">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold uppercase tracking-widest text-base-content/40 flex items-center gap-1">
            <Database className="w-3 h-3" /> Tabla
          </label>
          <select
            className="select select-sm bg-base-100 border border-base-300 rounded-xl"
            value={alf.tabla}
            onChange={e => {
              setAlf(f => ({ ...f, tabla: e.target.value }))
              setPage(1)
            }}
          >
            <option value="">Todas</option>
            <option value="productos">Productos</option>
            <option value="proveedores">Proveedores</option>
            <option value="categorias">Categorías</option>
            <option value="areas">Áreas</option>
            <option value="unidades_basicas">Unidades</option>
            <option value="usuarios">Usuarios</option>
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold uppercase tracking-widest text-base-content/40">
            Acción
          </label>
          <select
            className="select select-sm bg-base-100 border border-base-300 rounded-xl"
            value={alf.accion}
            onChange={e => {
              setAlf(f => ({ ...f, accion: e.target.value }))
              setPage(1)
            }}
          >
            <option value="">Todas</option>
            <option value="CREATE">Creación</option>
            <option value="UPDATE">Modificación</option>
            <option value="DELETE">Eliminación</option>
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold uppercase tracking-widest text-base-content/40 flex items-center gap-1">
            <CalendarRange className="w-3 h-3" /> Desde
          </label>
          <input
            type="date"
            className="input input-sm bg-base-100 border border-base-300 rounded-xl"
            value={alf.desde}
            onChange={e => {
              setAlf(f => ({ ...f, desde: e.target.value }))
              setPage(1)
            }}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-[10px] font-bold uppercase tracking-widest text-base-content/40 flex items-center gap-1">
            <CalendarRange className="w-3 h-3" /> Hasta
          </label>
          <input
            type="date"
            className="input input-sm bg-base-100 border border-base-300 rounded-xl"
            value={alf.hasta}
            onChange={e => {
              setAlf(f => ({ ...f, hasta: e.target.value }))
              setPage(1)
            }}
          />
        </div>

        {hasFilters && (
          <button
            className="btn btn-ghost btn-sm text-error/70 flex items-center gap-1"
            onClick={() => {
              setAlf(AL_DEFAULTS)
              setPage(1)
            }}
          >
            <X className="w-3.5 h-3.5" /> Limpiar
          </button>
        )}
      </div>

      {/* Timeline agrupado por día */}
      {isLoading ? (
        <div className="flex flex-col gap-3">
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="h-14 bg-base-200 animate-pulse rounded-2xl" />
          ))}
        </div>
      ) : logs.length === 0 ? (
        <div className="py-20 text-center bg-base-100 rounded-3xl border border-dashed border-base-300 text-base-content/30">
          No se encontraron registros de auditoría
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map(({ label, items }) => (
            <div key={label} className="flex flex-col gap-2">
              {/* Cabecera de día */}
              <div className="flex items-center gap-3">
                <span className="text-xs font-bold uppercase tracking-widest text-base-content/40 capitalize whitespace-nowrap">
                  {label}
                </span>
                <div className="flex-1 h-px bg-base-200" />
                <span className="text-[10px] text-base-content/30 font-mono whitespace-nowrap">
                  {items.length} evento{items.length !== 1 ? 's' : ''}
                </span>
              </div>

              {/* Entradas */}
              <div className="flex flex-col gap-1.5">
                {items.map(log => {
                  const name =
                    extractName(log.datos_nuevos) ?? extractName(log.datos_anteriores)
                  const tablaLabel = TABLA_LABELS[log.tabla] ?? log.tabla
                  const accionLabel = ACCION_LABELS[log.accion] ?? log.accion
                  const isExpanded = expandedId === log.id

                  return (
                    <div
                      key={log.id}
                      className={`bg-base-100 border rounded-2xl shadow-sm overflow-hidden transition-all
                        ${isExpanded
                          ? 'ring-2 ring-primary/20 border-primary/30'
                          : 'border-base-200 hover:border-base-300'
                        }`}
                    >
                      <div
                        className="px-4 py-3 flex items-center gap-3 cursor-pointer"
                        onClick={() => setExpandedId(isExpanded ? null : log.id)}
                      >
                        <div className={`p-2 rounded-xl shrink-0 ${actionColors(log.accion)}`}>
                          <ActionIcon accion={log.accion} />
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <Badge
                              variant={actionBadgeVariant(log.accion)}
                              className="text-[10px] h-4 px-1.5 shrink-0"
                            >
                              {accionLabel}
                            </Badge>
                            <span className="text-sm font-semibold">{tablaLabel}</span>
                            {name && (
                              <span className="text-sm text-base-content/50 truncate">
                                — {name}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 mt-0.5">
                            <span className="text-[11px] text-base-content/40 flex items-center gap-1">
                              <User className="w-3 h-3" />
                              {log.usuario_nombre}
                            </span>
                            <span className="text-[11px] font-mono text-base-content/30">
                              {new Date(log.created_at).toLocaleTimeString('es-CL', {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                          </div>
                        </div>

                        {isExpanded ? (
                          <ChevronUp className="w-4 h-4 text-base-content/30 shrink-0" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-base-content/30 shrink-0" />
                        )}
                      </div>

                      {isExpanded && (
                        <div className="px-4 pb-4 pt-3 border-t border-base-200 bg-base-200/10">
                          <DiffView log={log} />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-2">
        <Pagination
          page={page}
          totalPages={data?.total_pages || 1}
          onPageChange={setPage}
        />
      </div>
    </div>
  )
}
