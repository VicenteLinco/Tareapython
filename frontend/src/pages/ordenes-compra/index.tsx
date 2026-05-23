import { useState } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, ShoppingBag } from 'lucide-react'
import api from '@/lib/api'
import type { OrdenCompraResumen, PaginatedResponse } from '@/types'
import { formatDate, cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ESTADO_LABEL, ESTADO_BADGE_CLASS } from './utils'

const PAGE_SIZE = 15

export default function OrdenesCompraPage() {
  const [page, setPage] = useState(1)
  const navigate = useNavigate()

  const { data, isLoading } = useQuery({
    queryKey: ['ordenes-compra', page],
    queryFn: () =>
      api.get<PaginatedResponse<OrdenCompraResumen>>('/ordenes-compra', {
        params: { page, per_page: PAGE_SIZE },
      }).then((r) => r.data),
    placeholderData: keepPreviousData,
  })

  const rows = data?.data ?? []
  const total = data?.total ?? 0
  const totalPages = data?.total_pages ?? 1

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 text-xs text-base-content/50 mb-1">
            <Link to="/solicitudes-compra" className="hover:text-primary transition-colors">
              Solicitudes de Compra
            </Link>
            <span>/</span>
            <span>Órdenes de Compra</span>
          </div>
          <h1 className="t-h1 flex items-center gap-2">
            <ShoppingBag className="w-6 h-6 text-primary" />
            Órdenes de Compra
          </h1>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-[2rem] border border-base-200 bg-base-100 overflow-hidden shadow-sm">
        <table className="table w-full">
          <thead>
            <tr className="bg-base-200/50 text-[11px] uppercase tracking-wider opacity-60">
              <th className="pl-8">N° OC</th>
              <th>Proveedor</th>
              <th className="hidden md:table-cell">Solicitud origen</th>
              <th className="hidden lg:table-cell">Entrega esperada</th>
              <th>Estado</th>
              <th className="text-center pr-8">Ítems</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-base-200">
            {isLoading ? (
              [1, 2, 3, 4, 5].map((i) => (
                <tr key={i}>
                  <td className="pl-8"><Skeleton className="h-5 w-28 rounded-lg" /></td>
                  <td><Skeleton className="h-5 w-36 rounded-lg" /></td>
                  <td className="hidden md:table-cell"><Skeleton className="h-5 w-24 rounded-lg" /></td>
                  <td className="hidden lg:table-cell"><Skeleton className="h-5 w-24 rounded-lg" /></td>
                  <td><Skeleton className="h-5 w-20 rounded-lg" /></td>
                  <td className="pr-8"><Skeleton className="h-5 w-8 mx-auto rounded-lg" /></td>
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-20 text-center">
                  <ShoppingBag className="w-10 h-10 mx-auto mb-3 opacity-10" />
                  <p className="text-sm opacity-40 italic">No hay órdenes de compra registradas</p>
                </td>
              </tr>
            ) : (
              rows.map((oc) => (
                <tr
                  key={oc.id}
                  className="hover:bg-base-200/30 transition-colors cursor-pointer"
                  onClick={() => navigate(`/ordenes-compra/${oc.id}`)}
                >
                  <td className="px-4 py-3 font-mono text-xs">
                    <Link to={`/ordenes-compra/${oc.id}`} className="hover:underline">
                      {oc.numero_documento}
                    </Link>
                  </td>
                  <td className="text-sm font-medium">{oc.proveedor_nombre}</td>
                  <td className="hidden md:table-cell">
                    {oc.solicitud_numero ? (
                      <span className="font-mono text-xs text-base-content/60">{oc.solicitud_numero}</span>
                    ) : (
                      <span className="text-xs opacity-30">—</span>
                    )}
                  </td>
                  <td className="hidden lg:table-cell text-xs text-base-content/60">
                    {oc.fecha_entrega_esperada ? formatDate(oc.fecha_entrega_esperada) : <span className="opacity-30">—</span>}
                  </td>
                  <td>
                    <Badge
                      className={cn(
                        'uppercase text-[9px] font-bold px-2 py-0.5 rounded-lg',
                        ESTADO_BADGE_CLASS[oc.estado]
                      )}
                    >
                      {ESTADO_LABEL[oc.estado]}
                    </Badge>
                  </td>
                  <td className="text-center pr-8">
                    <Badge variant="secondary" className="font-bold tabular-nums">
                      {oc.items_count}
                    </Badge>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {!isLoading && rows.length > 0 && (
        <div className="flex items-center justify-between text-sm">
          <span className="opacity-50 text-xs">
            {total} resultado{total !== 1 ? 's' : ''} · página {page} de {totalPages}
          </span>
          <div className="join">
            <button
              className="join-item btn btn-sm btn-ghost"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              <ChevronLeft className="h-4 w-4" />
              Anterior
            </button>
            <button
              className="join-item btn btn-sm btn-ghost"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
            >
              Siguiente
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
