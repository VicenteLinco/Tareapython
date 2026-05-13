// frontend/src/pages/solicitudes-compra/components/proveedor-banner.tsx
import { ChevronLeft, Clock, Phone, Mail } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Proveedor } from '@/types'

interface Props {
  proveedor: Proveedor
  quiebresCount: number
  onCambiar: () => void
}

export function ProveedorBanner({ proveedor, quiebresCount, onCambiar }: Props) {
  return (
    <div className="flex items-center gap-4 px-5 py-3 bg-primary/5 border border-primary/15 rounded-2xl shrink-0">
      <div className="w-10 h-10 rounded-xl overflow-hidden shrink-0 flex items-center justify-center bg-base-200 text-2xl">
        {proveedor.icono
          ? <img src={proveedor.icono} alt={proveedor.nombre} className="h-full w-full object-contain" />
          : '🏭'}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-bold text-sm">{proveedor.nombre}</p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5">
          <span className="text-[10px] opacity-40 font-medium uppercase tracking-wide">
            {quiebresCount > 0 ? `${quiebresCount} quiebre${quiebresCount !== 1 ? 's' : ''}` : 'Sin quiebres'}
          </span>
          {(proveedor.dias_despacho_tierra || proveedor.dias_despacho_aereo) && (
            <span className="text-[10px] opacity-40 flex items-center gap-0.5">
              <Clock className="h-2.5 w-2.5" />
              {proveedor.dias_despacho_tierra ?? proveedor.dias_despacho_aereo}d despacho
            </span>
          )}
          {proveedor.contacto && (
            <span className="text-[10px] opacity-40 truncate">👤 {proveedor.contacto}</span>
          )}
          {proveedor.telefono && (
            <span className="text-[10px] opacity-40 flex items-center gap-0.5">
              <Phone className="h-2.5 w-2.5" /> {proveedor.telefono}
            </span>
          )}
          {proveedor.email && (
            <span className="text-[10px] opacity-40 flex items-center gap-0.5">
              <Mail className="h-2.5 w-2.5" /> {proveedor.email}
            </span>
          )}
        </div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="rounded-xl h-8 gap-1.5 text-xs shrink-0"
        onClick={onCambiar}
        aria-label="Cambiar proveedor"
      >
        <ChevronLeft className="h-3.5 w-3.5" /> Cambiar
      </Button>
    </div>
  )
}
