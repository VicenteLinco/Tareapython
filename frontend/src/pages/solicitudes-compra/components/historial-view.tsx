// frontend/src/pages/solicitudes-compra/components/historial-view.tsx
import { Search, ArrowRight, User } from 'lucide-react'
import { cn, formatDate } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { EmptyState, PageLoading } from '@/components/ui/page-state'
import type { SolicitudResumen } from '@/types'

interface HistorialViewProps {
  solicitudes: SolicitudResumen[] | undefined
  isLoading: boolean
  search: string
  onSearchChange: (v: string) => void
  onSelectSolicitud: (id: string) => void
  estado: string | null
  onEstadoChange: (v: string | null) => void
}

const ESTADO_FILTROS: { value: string | null; label: string }[] = [
  { value: null, label: 'Todas' },
  { value: 'guardada', label: 'Pendientes' },
  { value: 'parcialmente_enviada', label: 'Env. parcial' },
  { value: 'enviada', label: 'Enviadas' },
  { value: 'parcialmente_recibida', label: 'Rec. parcial' },
  { value: 'completada', label: 'Completadas' },
  { value: 'cancelada', label: 'Canceladas' },
]

const estadoBadgeClass = (estado: string) =>
  estado === 'completada' ? 'bg-success/10 text-success border-success/30' :
  estado === 'guardada'   ? 'bg-warning/10 text-warning border-warning/30' :
  estado === 'parcialmente_enviada' ? 'bg-info/10 text-info border-info/30' :
  estado === 'parcialmente_recibida' ? 'bg-warning/10 text-warning border-warning/30' :
  estado === 'cancelada'  ? 'bg-error/10 text-error border-error/30' :
  estado === 'enviada'    ? 'bg-info/10 text-info border-info/30' :
  estado === 'borrador'   ? 'bg-base-200 text-base-content/50 border-base-300' :
  'bg-base-200 text-base-content/50 border-base-300'

const estadoLabel = (estado: string) =>
  estado === 'guardada' ? 'pendiente' :
  estado === 'parcialmente_enviada' ? 'env. parcial' :
  estado === 'parcialmente_recibida' ? 'rec. parcial' :
  estado

export function HistorialView({
  solicitudes,
  isLoading,
  search,
  onSearchChange,
  onSelectSolicitud,
  estado,
  onEstadoChange,
}: HistorialViewProps) {
  return (
    <div className="flex-1 bg-base-100 rounded-[2rem] border border-base-300 shadow-sm overflow-hidden flex flex-col">
      <div className="p-6 border-b border-base-200 bg-base-200/20 flex flex-col gap-3">
        <div className="flex items-center gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 opacity-30" />
            <Input
              placeholder="Buscar por N° documento o usuario..."
              className="pl-10 h-10 rounded-xl"
              value={search}
              onChange={e => onSearchChange(e.target.value)}
            />
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {ESTADO_FILTROS.map(f => (
            <button
              key={f.label}
              onClick={() => onEstadoChange(f.value)}
              className={cn(
                'px-3 h-7 rounded-full text-xs font-bold transition-colors border',
                estado === f.value
                  ? 'bg-primary text-primary-content border-primary shadow-sm'
                  : 'bg-base-100 border-base-300 hover:bg-base-200 opacity-70 hover:opacity-100'
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {isLoading ? (
          <PageLoading label="Cargando historial..." />
        ) : (solicitudes?.length ?? 0) === 0 ? (
          <EmptyState
            title="No hay solicitudes"
            description="No se encontraron solicitudes para el filtro actual."
            className="m-6"
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="table table-md table-zebra w-full">
              <thead className="bg-base-200/50 sticky top-0 z-10">
                <tr className="border-b border-base-300">
                  <th className="text-[10px] font-black uppercase tracking-widest opacity-40">Documento</th>
                  <th className="text-[10px] font-black uppercase tracking-widest opacity-40">Fecha</th>
                  <th className="text-[10px] font-black uppercase tracking-widest opacity-40">Usuario</th>
                  <th className="text-[10px] font-black uppercase tracking-widest opacity-40">Proveedor</th>
                  <th className="text-[10px] font-black uppercase tracking-widest opacity-40 text-center">Items</th>
                  <th className="text-[10px] font-black uppercase tracking-widest opacity-40">Estado</th>
                  <th className="text-[10px] font-black uppercase tracking-widest opacity-40 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {solicitudes?.map(s => (
                  <tr
                    key={s.id}
                    className="hover:bg-primary/5 transition-colors cursor-pointer group"
                    onClick={() => onSelectSolicitud(s.id)}
                  >
                    <td className="font-bold text-sm">{s.numero_documento}</td>
                    <td className="text-xs opacity-60">{formatDate(s.fecha_creacion)}</td>
                    <td className="text-xs font-medium">
                      <div className="flex items-center gap-2">
                        <User className="h-3 w-3" /> {s.usuario_nombre}
                      </div>
                    </td>
                    <td className="text-xs font-medium max-w-[180px]">
                      <span className="truncate block" title={s.proveedores_nombres ?? undefined}>
                        {s.proveedores_count <= 0
                          ? 'Sin proveedor'
                          : s.proveedores_count === 1
                            ? s.proveedores_nombres
                            : `${s.proveedores_count} proveedores`}
                      </span>
                    </td>
                    <td className="text-center font-mono text-sm">{s.items_count}</td>
                    <td>
                      <Badge variant="outline" className={cn(
                        "capitalize font-bold px-3 py-1",
                        estadoBadgeClass(s.estado)
                      )}>
                        {estadoLabel(s.estado)}
                      </Badge>
                    </td>
                    <td className="text-right">
                      <button className="btn btn-ghost btn-sm btn-circle opacity-0 group-hover:opacity-100 transition-opacity">
                        <ArrowRight className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
