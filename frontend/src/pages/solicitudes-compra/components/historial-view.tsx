// frontend/src/pages/solicitudes-compra/components/historial-view.tsx
import { Search, ArrowRight, User } from 'lucide-react'
import { cn, formatDate } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import type { SolicitudResumen } from '@/types'

interface HistorialViewProps {
  solicitudes: SolicitudResumen[] | undefined
  isLoading: boolean
  search: string
  onSearchChange: (v: string) => void
  onSelectSolicitud: (id: string) => void
}

export function HistorialView({
  solicitudes,
  isLoading,
  search,
  onSearchChange,
  onSelectSolicitud,
}: HistorialViewProps) {
  return (
    <div className="flex-1 bg-base-100 rounded-[2rem] border border-base-300 shadow-sm overflow-hidden flex flex-col">
      <div className="p-6 border-b border-base-200 bg-base-200/20 flex items-center gap-4">
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

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {isLoading ? (
          <div className="p-10 text-center">
            <span className="loading loading-spinner loading-lg text-primary opacity-20" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table table-md table-zebra w-full">
              <thead className="bg-base-200/50 sticky top-0 z-10">
                <tr className="border-b border-base-300">
                  <th className="text-[10px] font-black uppercase tracking-widest opacity-40">Documento</th>
                  <th className="text-[10px] font-black uppercase tracking-widest opacity-40">Fecha</th>
                  <th className="text-[10px] font-black uppercase tracking-widest opacity-40">Usuario</th>
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
                    <td className="text-center font-mono text-sm">{s.items_count}</td>
                    <td>
                      <Badge variant="outline" className={cn(
                        "capitalize font-bold px-3 py-1",
                        s.estado === 'aprobada'  ? 'bg-success/10 text-success border-success/30' :
                        s.estado === 'pendiente' ? 'bg-warning/10 text-warning border-warning/30' :
                        s.estado === 'rechazada' ? 'bg-error/10 text-error border-error/30' :
                        s.estado === 'enviada'   ? 'bg-info/10 text-info border-info/30' :
                        'bg-base-200 text-base-content/50 border-base-300'
                      )}>
                        {s.estado}
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
