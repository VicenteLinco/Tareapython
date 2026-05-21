import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Send, XCircle, PackageCheck } from 'lucide-react'
import { toast } from 'sonner'
import api from '@/lib/api'
import type { OrdenCompraDetalle } from '@/types'
import { formatDate, cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Progress } from '@/components/ui/progress'
import { useAuthStore } from '@/hooks/use-auth-store'
import { ESTADO_LABEL, ESTADO_BADGE_CLASS } from './utils'

function recepcionEstadoBadgeClass(estado: string): string {
  if (estado === 'confirmada' || estado === 'completa') return 'bg-success/10 text-success border-success/20'
  return 'bg-base-200 text-base-content border-base-300'
}

export default function OrdenCompraDetallePage() {
  const { id } = useParams<{ id: string }>()
  const queryClient = useQueryClient()
  const usuario = useAuthStore((s) => s.usuario)
  const isAdmin = usuario?.rol === 'admin'

  const { data, isLoading } = useQuery({
    queryKey: ['ordenes-compra', id],
    queryFn: () =>
      api.get<OrdenCompraDetalle>(`/ordenes-compra/${id}`).then((r) => r.data),
    enabled: !!id,
  })

  const enviarMutation = useMutation({
    mutationFn: () => api.post(`/ordenes-compra/${id}/enviar`),
    onSuccess: () => {
      toast.success('Orden marcada como enviada')
      queryClient.invalidateQueries({ queryKey: ['ordenes-compra'] })
    },
    onError: () => toast.error('Error al marcar como enviada'),
  })

  const cancelarMutation = useMutation({
    mutationFn: () => api.post(`/ordenes-compra/${id}/cancelar`),
    onSuccess: () => {
      toast.success('Orden cancelada')
      queryClient.invalidateQueries({ queryKey: ['ordenes-compra'] })
    },
    onError: () => toast.error('Error al cancelar la orden'),
  })

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48 rounded-xl" />
        <Skeleton className="h-32 w-full rounded-2xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    )
  }

  if (!data) {
    return (
      <div className="py-20 text-center opacity-40">
        <p className="text-sm">Orden no encontrada</p>
        <Link to="/ordenes-compra" className="text-primary text-sm underline mt-2 inline-block">
          Volver al listado
        </Link>
      </div>
    )
  }

  const { orden_compra: oc, items, recepciones } = data

  // Progress global
  const totalSolicitado = items.reduce((acc, i) => acc + i.cantidad_solicitada, 0)
  const totalRecibido = items.reduce((acc, i) => acc + i.cantidad_recibida, 0)
  const progresoPct = totalSolicitado > 0 ? Math.round((totalRecibido / totalSolicitado) * 100) : 0

  const canEnviar = isAdmin && oc.estado === 'borrador'
  const canCancelar = isAdmin && (oc.estado === 'borrador' || oc.estado === 'enviada')

  return (
    <div className="space-y-6 pb-20">
      {/* Back + Header */}
      <div className="flex items-start gap-4">
        <Link
          to="/ordenes-compra"
          className="btn btn-ghost btn-sm btn-square mt-1"
          aria-label="Volver"
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-mono text-2xl font-bold tracking-tight">{oc.numero_documento}</h1>
            <Badge
              className={cn(
                'uppercase text-[9px] font-bold px-2 py-0.5 rounded-lg',
                ESTADO_BADGE_CLASS[oc.estado]
              )}
            >
              {ESTADO_LABEL[oc.estado]}
            </Badge>
          </div>
          <p className="text-sm opacity-50 mt-0.5">
            {oc.proveedor_nombre} &bull; {oc.usuario_nombre} &bull; {formatDate(oc.fecha_emision)}
          </p>
        </div>

        {/* Action buttons */}
        {(canEnviar || canCancelar) && (
          <div className="flex items-center gap-2 shrink-0">
            {canEnviar && (
              <Button
                size="sm"
                className="gap-2"
                onClick={() => enviarMutation.mutate()}
                disabled={enviarMutation.isPending}
              >
                <Send className="w-4 h-4" />
                Marcar como enviada
              </Button>
            )}
            {canCancelar && (
              <Button
                size="sm"
                variant="outline"
                className="gap-2 border-error text-error hover:bg-error hover:text-white"
                onClick={() => cancelarMutation.mutate()}
                disabled={cancelarMutation.isPending}
              >
                <XCircle className="w-4 h-4" />
                Cancelar OC
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Info panel */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-base-100 border border-base-200 rounded-2xl p-4">
          <p className="text-[10px] uppercase font-bold opacity-40 tracking-widest mb-1">Solicitud origen</p>
          {oc.solicitud_numero ? (
            <span className="font-mono text-sm font-bold text-primary">{oc.solicitud_numero}</span>
          ) : (
            <span className="text-sm opacity-30">—</span>
          )}
        </div>
        <div className="bg-base-100 border border-base-200 rounded-2xl p-4">
          <p className="text-[10px] uppercase font-bold opacity-40 tracking-widest mb-1">Entrega esperada</p>
          <span className="text-sm font-medium">
            {oc.fecha_entrega_esperada ? formatDate(oc.fecha_entrega_esperada) : <span className="opacity-30">—</span>}
          </span>
        </div>
        <div className="bg-base-100 border border-base-200 rounded-2xl p-4 col-span-2 md:col-span-1">
          <p className="text-[10px] uppercase font-bold opacity-40 tracking-widest mb-2">Progreso global</p>
          <div className="flex items-center gap-2">
            <Progress value={progresoPct} className="flex-1" />
            <span className="text-xs font-bold tabular-nums">{progresoPct}%</span>
          </div>
          <p className="text-[10px] opacity-40 mt-1">{totalRecibido} / {totalSolicitado} unidades</p>
        </div>
        <div className="bg-base-100 border border-base-200 rounded-2xl p-4">
          <p className="text-[10px] uppercase font-bold opacity-40 tracking-widest mb-1">Recepciones</p>
          <div className="flex items-center gap-2">
            <PackageCheck className="w-4 h-4 text-primary opacity-60" />
            <span className="text-sm font-bold tabular-nums">{recepciones.length}</span>
          </div>
        </div>
      </div>

      {/* Nota */}
      {oc.nota && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-800">
          <span className="font-bold text-[10px] uppercase tracking-widest block mb-1 opacity-60">Nota</span>
          {oc.nota}
        </div>
      )}

      {/* Items table */}
      <div className="bg-base-100 border border-base-200 rounded-[2rem] overflow-hidden shadow-sm">
        <div className="px-6 py-4 border-b border-base-200 bg-base-200/30">
          <h2 className="font-bold text-sm">Ítems ({items.length})</h2>
        </div>
        <table className="table w-full">
          <thead>
            <tr className="bg-base-200/50 text-[11px] uppercase tracking-wider opacity-60">
              <th className="pl-6">Producto</th>
              <th className="hidden md:table-cell">Presentación</th>
              <th className="text-right">Solicitado</th>
              <th className="text-right">Recibido</th>
              <th className="hidden lg:table-cell">Área</th>
              <th className="text-right hidden md:table-cell pr-6">Precio unit.</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-base-200">
            {items.map((item) => {
              const itemPct = item.cantidad_solicitada > 0
                ? Math.round((item.cantidad_recibida / item.cantidad_solicitada) * 100)
                : 0
              const isComplete = item.cantidad_recibida >= item.cantidad_solicitada
              const isPartial = item.cantidad_recibida > 0 && !isComplete

              return (
                <tr key={item.id} className="hover:bg-base-200/20 transition-colors">
                  <td className="pl-6">
                    <span className="font-medium text-sm">{item.producto_nombre}</span>
                  </td>
                  <td className="hidden md:table-cell text-xs text-base-content/60">
                    {item.presentacion_nombre ?? <span className="opacity-30">—</span>}
                  </td>
                  <td className="text-right text-sm tabular-nums font-medium">
                    {item.cantidad_solicitada} <span className="text-[10px] opacity-40">{item.unidad}</span>
                  </td>
                  <td className="text-right">
                    <div className="flex flex-col items-end gap-1 min-w-[80px]">
                      <span className={cn(
                        'text-sm tabular-nums font-bold',
                        isComplete && 'text-success',
                        isPartial && 'text-amber-600',
                        !isComplete && !isPartial && 'opacity-40'
                      )}>
                        {item.cantidad_recibida} <span className="text-[10px] font-normal opacity-60">{item.unidad}</span>
                      </span>
                      <Progress
                        value={itemPct}
                        className={cn(
                          'w-20 h-1.5',
                          isComplete && '[&>div]:bg-success',
                          isPartial && '[&>div]:bg-amber-500'
                        )}
                      />
                    </div>
                  </td>
                  <td className="hidden lg:table-cell text-xs text-base-content/60">
                    {item.area_destino_nombre ?? <span className="opacity-30">—</span>}
                  </td>
                  <td className="text-right hidden md:table-cell pr-6 text-xs text-base-content/60">
                    {item.precio_unitario != null
                      ? new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP' }).format(item.precio_unitario)
                      : <span className="opacity-30">—</span>
                    }
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Recepciones asociadas */}
      {recepciones.length > 0 && (
        <div className="bg-base-100 border border-base-200 rounded-[2rem] overflow-hidden shadow-sm">
          <div className="px-6 py-4 border-b border-base-200 bg-base-200/30">
            <h2 className="font-bold text-sm">Recepciones asociadas ({recepciones.length})</h2>
          </div>
          <ul className="divide-y divide-base-200">
            {recepciones.map((rec) => (
              <li key={rec.id} className="px-6 py-3 flex items-center justify-between hover:bg-base-200/20 transition-colors">
                <div className="flex items-center gap-4">
                  <Link
                    to={`/recepciones/${rec.id}`}
                    className="font-mono font-bold text-primary text-sm hover:underline"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {rec.numero_documento}
                  </Link>
                  <span className="text-xs text-base-content/50">{rec.usuario_nombre}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-base-content/50 hidden sm:block">{formatDate(rec.fecha_recepcion)}</span>
                  <Badge
                    className={cn(
                      'uppercase text-[9px] font-bold px-2 py-0.5 rounded-lg',
                      recepcionEstadoBadgeClass(rec.estado)
                    )}
                  >
                    {rec.estado === 'confirmada' || rec.estado === 'completa' ? 'Confirmada' : rec.estado}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
