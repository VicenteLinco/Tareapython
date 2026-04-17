import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { DataTable } from '@/components/ui/data-table'
import { Pagination } from '@/components/ui/pagination'
import api from '@/lib/api'
import type { PaginatedResponse, Movimiento, Area } from '@/types'
import { formatDateTime } from '@/lib/utils'
import { useAreaStore } from '@/hooks/use-area-store'

const tipoConfig: Record<string, { label: string; variant: 'success' | 'destructive' | 'info' | 'warning' | 'secondary' }> = {
  entrada: { label: 'Entrada', variant: 'success' },
  salida: { label: 'Salida', variant: 'destructive' },
  descarte: { label: 'Descarte', variant: 'destructive' },
  ajuste_pos: { label: 'Ajuste (+)', variant: 'success' },
  ajuste_neg: { label: 'Ajuste (-)', variant: 'destructive' },
}

export default function MovimientosPage() {
  const selectedAreaId = useAreaStore((s) => s.selectedAreaId)
  const setSelectedArea = useAreaStore((s) => s.setSelectedArea)
  const [tipo, setTipo] = useState('')
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [areaId, setAreaId] = useState(selectedAreaId ? String(selectedAreaId) : '')
  const [page, setPage] = useState(1)

  useEffect(() => {
    setAreaId(selectedAreaId ? String(selectedAreaId) : '')
    setPage(1)
  }, [selectedAreaId])

  const { data: areas } = useQuery({
    queryKey: ['areas'],
    queryFn: () => api.get<Area[]>('/areas').then((r) => r.data),
  })

  const { data, isLoading } = useQuery({
    queryKey: ['movimientos', { tipo, desde, hasta, areaId, page }],
    queryFn: () =>
      api.get<PaginatedResponse<Movimiento>>('/movimientos', {
        params: { tipo: tipo || undefined, desde: desde || undefined, hasta: hasta || undefined, area_id: areaId || undefined, page, per_page: 30 },
      }).then((r) => r.data),
  })

  const columns = [
    {
      key: 'created_at', header: 'Fecha',
      render: (item: Movimiento) => <span className="text-xs opacity-60 font-mono">{formatDateTime(item.created_at)}</span>,
    },
    {
      key: 'tipo', header: 'Tipo',
      render: (item: Movimiento) => {
        const t = tipoConfig[item.tipo] ?? { label: item.tipo, variant: 'secondary' as const }
        return <Badge variant={t.variant}>{t.label}</Badge>
      },
    },
    {
      key: 'producto_nombre', header: 'Producto',
      render: (item: Movimiento) => <span className="text-sm font-medium">{item.producto_nombre}</span>,
    },
    {
      key: 'codigo_lote', header: 'Lote', className: 'hidden md:table-cell',
      render: (item: Movimiento) => <span className="font-mono text-xs opacity-50">{item.codigo_lote}</span>,
    },
    {
      key: 'cantidad', header: 'Cantidad',
      render: (item: Movimiento) => {
        // cantidad en movimientos siempre es positiva (el trigger aplica el signo).
        // Tipos que restan: salida (CONSUMO), descarte (DESCARTE_VENCIDO/DAÑADO),
        // ajuste_neg (AJUSTE_NEGATIVO), transferencia_salida (TRANSFERENCIA_SALIDA).
        const neg = ['salida', 'descarte', 'ajuste_neg', 'transferencia_salida'].includes(item.tipo)
        const cantidadEntera = Math.round(item.cantidad)
        return (
          <span className={`font-mono font-semibold text-sm ${neg ? 'text-error' : 'text-success'}`}>
            {neg ? '-' : '+'}{cantidadEntera}
            <span className="text-[10px] opacity-40 ml-0.5">
              {cantidadEntera === 1 ? item.unidad_base_nombre : item.unidad_base_nombre_plural}
            </span>
          </span>
        )
      },
    },
    {
      key: 'area_nombre', header: 'Área', className: 'hidden lg:table-cell',
      render: (item: Movimiento) => <span className="text-sm opacity-50">{item.area_nombre}</span>,
    },
    {
      key: 'usuario_nombre', header: 'Usuario', className: 'hidden lg:table-cell',
      render: (item: Movimiento) => <span className="text-xs opacity-40">{item.usuario_nombre}</span>,
    },
  ]

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Movimientos</h1>
        <p className="text-sm opacity-50 mt-0.5">Historial inmutable de todas las operaciones</p>
      </div>

      <div className="flex flex-wrap gap-2.5">
        <select
          className="select select-bordered select-sm h-9 w-40"
          value={areaId}
          onChange={(e) => {
            const val = e.target.value;
            setAreaId(val);
            setSelectedArea(val ? Number(val) : null);
            setPage(1);
          }}
        >
          <option value="">Todas las áreas</option>
          {(areas ?? []).map((a) => (
            <option key={a.id} value={a.id}>{a.nombre}</option>
          ))}
        </select>
        <select className="select select-bordered select-sm h-9 w-40" value={tipo}
          onChange={(e) => { setTipo(e.target.value); setPage(1) }}>
          <option value="">Todos los tipos</option>
          {Object.entries(tipoConfig).map(([value, { label }]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <div className="flex items-center gap-1.5">
          <input type="date" className="input input-bordered input-sm h-9 w-36" value={desde}
            onChange={(e) => { setDesde(e.target.value); setPage(1) }} />
          <span className="text-xs opacity-30 font-medium">a</span>
          <input type="date" className="input input-bordered input-sm h-9 w-36" value={hasta}
            onChange={(e) => { setHasta(e.target.value); setPage(1) }} />
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-1.5">
          {[1, 2, 3, 4, 5].map((i) => <div key={i} className="skeleton h-12 w-full rounded-lg" />)}
        </div>
      ) : (
        <>
          <DataTable columns={columns} data={data?.data ?? []} emptyMessage="No hay movimientos" />
          <Pagination page={data?.page ?? 1} totalPages={data?.total_pages ?? 1} onPageChange={setPage} />
        </>
      )}
    </div>
  )
}
