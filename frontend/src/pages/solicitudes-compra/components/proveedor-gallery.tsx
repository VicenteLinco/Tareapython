// frontend/src/pages/solicitudes-compra/components/proveedor-gallery.tsx
import { Clock, Mail, Phone } from 'lucide-react'
import { cn } from '@/lib/utils'
import { PageLoading } from '@/components/ui/page-state'
import type { Proveedor } from '@/types'

interface UrgenciaCount { total: number; criticos: number }

interface ProveedorCardProps {
  proveedor: Proveedor
  urgencias: number
  criticos: number
  onClick: () => void
}

function ProveedorCard({ proveedor, urgencias, criticos, onClick }: ProveedorCardProps) {
  const hasCriticos = criticos > 0
  const hasUrgencias = urgencias > 0

  return (
    <button
      onClick={onClick}
      className="group relative flex flex-col items-center gap-3 p-6 bg-base-100 border border-base-300 rounded-3xl hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5 transition-all duration-200 text-center"
    >
      {hasCriticos ? (
        <span className="absolute top-3 right-3 badge badge-error badge-sm font-bold gap-1">
          <span className="text-[9px]">●</span> {criticos} crítico{criticos !== 1 ? 's' : ''}
        </span>
      ) : hasUrgencias ? (
        <span className="absolute top-3 right-3 badge badge-warning badge-sm font-bold gap-1">
          <span className="text-[9px]">▲</span> {urgencias}
        </span>
      ) : (
        <span className="absolute top-3 right-3 badge badge-success badge-sm font-bold text-[9px]">✓ OK</span>
      )}

      <div className={cn(
        "w-14 h-14 rounded-2xl flex items-center justify-center text-2xl transition-transform group-hover:scale-110 overflow-hidden",
        hasCriticos ? 'bg-error/10' : hasUrgencias ? 'bg-warning/10' : 'bg-success/10'
      )}>
        {proveedor.icono
          ? <img src={proveedor.icono} alt={proveedor.nombre} className="h-full w-full object-contain" />
          : '🏭'}
      </div>

      <div className="flex-1 flex flex-col gap-1 w-full">
        <p className="font-bold text-sm leading-tight">{proveedor.nombre}</p>
        <p className="text-[10px] opacity-40 font-medium">
          {proveedor.total_productos} producto{proveedor.total_productos !== 1 ? 's' : ''}
        </p>
        {(proveedor.dias_despacho_tierra || proveedor.dias_despacho_aereo) && (
          <p className="text-[10px] opacity-50 flex items-center justify-center gap-1">
            <Clock className="h-2.5 w-2.5" />
            LT: {proveedor.dias_despacho_tierra ?? proveedor.dias_despacho_aereo} días
          </p>
        )}
      </div>

      {(proveedor.contacto || proveedor.email || proveedor.telefono) && (
        <div className="w-full pt-2.5 border-t border-base-200 space-y-1 text-left">
          {proveedor.contacto && (
            <p className="text-[10px] opacity-50 truncate flex items-center gap-1">
              <span className="opacity-60">👤</span> {proveedor.contacto}
            </p>
          )}
          {proveedor.telefono && (
            <p className="text-[10px] opacity-50 truncate flex items-center gap-1">
              <Phone className="h-2.5 w-2.5 shrink-0" /> {proveedor.telefono}
            </p>
          )}
          {proveedor.email && (
            <p className="text-[10px] opacity-50 truncate flex items-center gap-1">
              <Mail className="h-2.5 w-2.5 shrink-0" /> {proveedor.email}
            </p>
          )}
        </div>
      )}

      <div className={cn(
        "absolute inset-0 rounded-3xl border-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none",
        hasCriticos ? 'border-error/40' : hasUrgencias ? 'border-warning/40' : 'border-primary/30'
      )} />
    </button>
  )
}

interface ProveedorGalleryProps {
  proveedores: Proveedor[] | undefined
  isLoading: boolean
  urgenciasByProveedor: Record<number, UrgenciaCount>
  logoBase64?: string | null
  onSelect: (p: Proveedor) => void
}

export function ProveedorGallery({
  proveedores,
  isLoading,
  urgenciasByProveedor,
  logoBase64,
  onSelect,
}: ProveedorGalleryProps) {
  return (
    <div className="flex-1 flex flex-col gap-6 min-h-0">
      <div className="flex items-center gap-4">
        {logoBase64 && (
          <img src={logoBase64} alt="Logo laboratorio" className="h-12 w-auto object-contain rounded-xl" />
        )}
        <div>
          <p className="text-base font-bold">¿A qué proveedor vas a pedir?</p>
          <p className="text-sm opacity-40">El pedido se generará exclusivamente con productos de ese proveedor.</p>
        </div>
      </div>

      {isLoading ? (
        <PageLoading label="Cargando proveedores..." />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 overflow-y-auto custom-scrollbar pb-2">
          {(proveedores ?? []).filter(p => p.activa).map(p => (
            <ProveedorCard
              key={p.id}
              proveedor={p}
              urgencias={urgenciasByProveedor[p.id]?.total ?? 0}
              criticos={urgenciasByProveedor[p.id]?.criticos ?? 0}
              onClick={() => onSelect(p)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
