import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Barcode, Zap, CheckCircle2, Circle, Pencil, Search } from 'lucide-react'
import { DataTable } from '@/components/ui/data-table'
import { PageLoading } from '@/components/ui/page-state'
import api from '@/lib/api'
import { notify } from '@/lib/notify'
import { AssignGtinDialog, type GtinTarget } from './assign-gtin-dialog'

type PresentacionConProducto = {
  id: number
  producto_id: string
  producto_nombre: string
  nombre: string
  nombre_plural: string
  gtin: string | null
  gs1_habilitado: boolean
  gtin_interno: boolean
  activa: boolean
}

export default function GtinsTab() {
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState<'all' | 'missing' | 'assigned'>('all')
  const [search, setSearch] = useState('')
  const [target, setTarget] = useState<GtinTarget | null>(null)

  const { data: presentaciones = [], isLoading } = useQuery({
    queryKey: ['presentaciones-todas'],
    queryFn: () => api.get<PresentacionConProducto[]>('/presentaciones').then((r) => r.data),
  })

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['presentaciones-todas'] })

  const bulkMut = useMutation({
    mutationFn: () => api.post('/presentaciones/bulk-assign-gtin', { generate_missing: true }),
    onSuccess: (res) => {
      invalidate()
      const updated = res.data.updated as number
      if (updated === 0) notify.info('Todas las presentaciones ya tienen GTIN asignado')
      else notify.success(`${updated} GTIN${updated !== 1 ? 's' : ''} asignado${updated !== 1 ? 's' : ''}`)
    },
    onError: () => notify.error('Error al asignar GTINs'),
  })

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return presentaciones.filter((p) => {
      if (filter === 'missing' && p.gtin !== null) return false
      if (filter === 'assigned' && p.gtin === null) return false
      if (!q) return true
      return (
        p.producto_nombre.toLowerCase().includes(q) ||
        p.nombre.toLowerCase().includes(q) ||
        (p.gtin?.includes(q) ?? false)
      )
    })
  }, [presentaciones, filter, search])

  const missing = presentaciones.filter((p) => p.gtin === null).length
  const assigned = presentaciones.length - missing

  const columns = [
    {
      key: 'producto',
      header: 'Producto',
      render: (item: PresentacionConProducto) => (
        <span className="text-sm font-medium">{item.producto_nombre}</span>
      ),
    },
    {
      key: 'presentacion',
      header: 'Presentación',
      render: (item: PresentacionConProducto) => (
        <span className="text-sm opacity-70">{item.nombre}</span>
      ),
    },
    {
      key: 'gtin',
      header: 'GTIN',
      render: (item: PresentacionConProducto) =>
        item.gtin ? (
          <span className="font-mono text-xs bg-base-200 px-2 py-0.5 rounded">{item.gtin}</span>
        ) : (
          <span className="text-xs opacity-30">—</span>
        ),
    },
    {
      key: 'origen',
      header: 'Origen',
      className: 'w-24',
      render: (item: PresentacionConProducto) =>
        item.gtin ? (
          item.gtin_interno ? (
            <span className="badge badge-sm badge-ghost gap-1">Interno</span>
          ) : (
            <span className="badge badge-sm badge-info badge-outline gap-1">Proveedor</span>
          )
        ) : (
          <span className="text-xs opacity-30">—</span>
        ),
    },
    {
      key: 'estado',
      header: 'Estado',
      className: 'w-28',
      render: (item: PresentacionConProducto) =>
        item.gtin ? (
          <span className="flex items-center gap-1 text-xs text-success">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Asignado
          </span>
        ) : (
          <span className="flex items-center gap-1 text-xs text-base-content/40">
            <Circle className="h-3.5 w-3.5" />
            Sin GTIN
          </span>
        ),
    },
    {
      key: 'accion',
      header: '',
      className: 'w-24',
      render: (item: PresentacionConProducto) =>
        item.gtin ? (
          <button
            className="btn btn-xs btn-ghost gap-1"
            onClick={(e) => {
              e.stopPropagation()
              setTarget(item)
            }}
          >
            <Pencil className="h-3 w-3" />
            Editar
          </button>
        ) : (
          <button
            className="btn btn-xs btn-outline btn-primary gap-1"
            onClick={(e) => {
              e.stopPropagation()
              setTarget(item)
            }}
          >
            <Barcode className="h-3 w-3" />
            Asignar
          </button>
        ),
    },
  ]

  if (isLoading) return <PageLoading label="Cargando presentaciones..." />

  return (
    <div className="space-y-4">
      {/* Stats + bulk action */}
      <div className="flex items-center justify-between gap-4 bg-base-200/50 border border-base-300 rounded-xl p-3">
        <div className="flex gap-6">
          <div className="text-center">
            <p className="text-2xl font-bold tabular-nums">{assigned}</p>
            <p className="text-[10px] uppercase font-semibold tracking-widest text-base-content/40">
              Con GTIN
            </p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold tabular-nums text-warning">{missing}</p>
            <p className="text-[10px] uppercase font-semibold tracking-widest text-base-content/40">
              Sin GTIN
            </p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold tabular-nums">{presentaciones.length}</p>
            <p className="text-[10px] uppercase font-semibold tracking-widest text-base-content/40">
              Total
            </p>
          </div>
        </div>

        <button
          className="btn btn-primary btn-sm gap-2"
          onClick={() => bulkMut.mutate()}
          disabled={bulkMut.isPending || missing === 0}
        >
          <Zap className="h-4 w-4" />
          {bulkMut.isPending ? 'Asignando...' : `Asignar ${missing} faltante${missing !== 1 ? 's' : ''}`}
        </button>
      </div>

      {/* Filtros: búsqueda + chips */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1">
          {(['all', 'missing', 'assigned'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`btn btn-xs rounded-full ${filter === f ? 'btn-primary' : 'btn-ghost'}`}
            >
              {f === 'all' ? 'Todos' : f === 'missing' ? 'Sin GTIN' : 'Con GTIN'}
            </button>
          ))}
        </div>

        <label className="input input-sm input-bordered flex items-center gap-2 bg-base-100 w-full max-w-xs">
          <Search className="h-3.5 w-3.5 opacity-40" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar producto o GTIN..."
            className="grow"
          />
        </label>
      </div>

      <DataTable
        columns={columns}
        data={filtered}
        onRowClick={(item) => setTarget(item)}
        emptyMessage="No hay presentaciones"
      />

      <AssignGtinDialog target={target} onClose={() => setTarget(null)} onAssigned={invalidate} />
    </div>
  )
}
