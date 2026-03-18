import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { DataTable } from '@/components/ui/data-table'
import { Pagination } from '@/components/ui/pagination'
import api from '@/lib/api'
import type { PaginatedResponse, Movimiento } from '@/types'
import { formatDateTime } from '@/lib/utils'

const tipoConfig: Record<string, { label: string; variant: 'success' | 'destructive' | 'info' | 'warning' | 'secondary' }> = {
  entrada: { label: 'Entrada', variant: 'success' },
  salida: { label: 'Salida', variant: 'destructive' },
  transferencia_entrada: { label: 'Transf. In', variant: 'info' },
  transferencia_salida: { label: 'Transf. Out', variant: 'warning' },
  descarte: { label: 'Descarte', variant: 'destructive' },
  ajuste: { label: 'Ajuste', variant: 'secondary' },
}

export default function MovimientosPage() {
  const [tipo, setTipo] = useState('')
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [page, setPage] = useState(1)

  const { data, isLoading } = useQuery({
    queryKey: ['movimientos', { tipo, desde, hasta, page }],
    queryFn: () =>
      api.get<PaginatedResponse<Movimiento>>('/movimientos', {
        params: { tipo: tipo || undefined, desde: desde || undefined, hasta: hasta || undefined, page, per_page: 30 },
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
        const neg = ['salida', 'transferencia_salida', 'descarte'].includes(item.tipo)
        return (
          <span className={`font-mono font-semibold text-sm ${neg ? 'text-error' : 'text-success'}`}>
            {neg ? '-' : '+'}{item.cantidad}
            <span className="text-[10px] opacity-40 ml-0.5">{item.unidad_base_nombre}</span>
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
          <DataTable columns={columns} data={(data?.data ?? []) as unknown as Record<string, unknown>[]} emptyMessage="No hay movimientos" />
          <Pagination page={data?.page ?? 1} totalPages={data?.total_pages ?? 1} onPageChange={setPage} />
        </>
      )}
    </div>
  )
}
