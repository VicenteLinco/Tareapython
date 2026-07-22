// frontend/src/pages/solicitudes-compra/components/proveedor-gallery.tsx
import { useState } from "react";
import { CheckCircle2, Clock, Mail, Phone } from "lucide-react";
import { cn } from "@/lib/utils";
import { PageLoading } from "@/components/ui/page-state";
import type { Proveedor } from "@/types";

function getProveedorInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

function getProveedorHue(name: string): number {
  return (
    name
      .split("")
      .reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) & 0xffff, 7) % 360
  );
}

function ProveedorAvatar({
  nombre,
  icono,
}: {
  nombre: string;
  icono: string | null;
}) {
  const [imgError, setImgError] = useState(false);
  const hue = getProveedorHue(nombre);
  const initials = getProveedorInitials(nombre);

  const showImg = icono && !imgError;

  return (
    <div
      className="w-14 h-14 rounded-2xl flex items-center justify-center overflow-hidden transition-transform group-hover:scale-110 shrink-0"
      style={!showImg ? { background: `hsl(${hue}, 58%, 46%)` } : undefined}
    >
      {showImg ? (
        <img
          src={icono}
          alt={nombre}
          className="h-full w-full object-contain"
          onError={() => setImgError(true)}
        />
      ) : (
        <span className="text-white font-black text-lg tracking-tight select-none">
          {initials}
        </span>
      )}
    </div>
  );
}

const DIAS_OPTIONS = [7, 15, 30, 60, 90] as const;

interface UrgenciaCount {
  total: number;
  criticos: number;
}

interface ProveedorCardProps {
  proveedor: Proveedor;
  urgencias: number;
  criticos: number;
  lotesVenciendo: number;
  diasVencimiento: number;
  selected: boolean;
  onClick: () => void;
}

function ProveedorCard({
  proveedor,
  urgencias,
  criticos,
  lotesVenciendo,
  diasVencimiento,
  selected,
  onClick,
}: ProveedorCardProps) {
  const hasCriticos = criticos > 0;
  const hasUrgencias = urgencias > 0;

  return (
    <button
      onClick={onClick}
      className={cn(
        "group relative flex flex-col items-center gap-3 p-6 bg-base-100 border rounded-3xl hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5 transition-all duration-200 text-center",
        selected
          ? "border-primary ring-2 ring-primary/20 shadow-lg shadow-primary/10"
          : "border-base-300",
      )}
    >
      {selected && (
        <span className="absolute top-3 left-3 z-10 badge badge-primary badge-sm gap-1 font-bold">
          <CheckCircle2 className="h-3 w-3" /> Seleccionado
        </span>
      )}

      {hasCriticos ? (
        <span className="absolute top-3 right-3 z-10 badge badge-error badge-sm font-bold gap-1">
          <span className="text-[9px]">●</span> {criticos} crítico
          {criticos !== 1 ? "s" : ""}
        </span>
      ) : hasUrgencias ? (
        <span className="absolute top-3 right-3 z-10 badge badge-warning badge-sm font-bold gap-1">
          <span className="text-[9px]">▲</span> {urgencias}
        </span>
      ) : (
        <span className="absolute top-3 right-3 z-10 badge badge-success badge-sm font-bold text-[9px]">
          ✓ OK
        </span>
      )}

      <ProveedorAvatar nombre={proveedor.nombre} icono={proveedor.icono} />

      <div className="flex-1 flex flex-col gap-1 w-full">
        <p className="font-bold text-sm leading-tight">{proveedor.nombre}</p>
        <p className="text-[10px] opacity-40 font-medium">
          {proveedor.total_productos} producto
          {proveedor.total_productos !== 1 ? "s" : ""}
        </p>
        {(proveedor.dias_despacho_tierra || proveedor.dias_despacho_aereo) && (
          <p className="text-[10px] opacity-50 flex items-center justify-center gap-1">
            <Clock className="h-2.5 w-2.5" />
            LT:{" "}
            {proveedor.dias_despacho_tierra ??
              proveedor.dias_despacho_aereo}{" "}
            días
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

      {lotesVenciendo > 0 && (
        <div className="w-full pt-2 border-t border-warning/30">
          <span className="text-[10px] text-warning font-semibold flex items-center justify-center gap-1">
            <span>⏳</span>
            {lotesVenciendo} lote{lotesVenciendo !== 1 ? "s" : ""} vence
            {lotesVenciendo === 1 ? "" : "n"} en ≤{diasVencimiento}d
          </span>
        </div>
      )}

      <div
        className={cn(
          "absolute inset-0 rounded-3xl border-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none",
          selected && "opacity-100",
          hasCriticos
            ? "border-error/40"
            : hasUrgencias
              ? "border-warning/40"
              : "border-primary/30",
        )}
      />
    </button>
  );
}

interface ProveedorGalleryProps {
  proveedores: Proveedor[] | undefined;
  isLoading: boolean;
  urgenciasByProveedor: Record<number, UrgenciaCount>;
  vencimientoByProveedor: Record<number, { lotes: number; productos: number }>;
  diasVencimiento: number;
  onDiasVencimientoChange: (dias: number) => void;
  logoBase64?: string | null;
  selectedIds?: number[];
  onContinue?: () => void;
  onSelect: (p: Proveedor) => void;
}

export function ProveedorGallery({
  proveedores,
  isLoading,
  urgenciasByProveedor,
  vencimientoByProveedor,
  diasVencimiento,
  onDiasVencimientoChange,
  logoBase64,
  selectedIds = [],
  onContinue,
  onSelect,
}: ProveedorGalleryProps) {
  return (
    <div className="flex-1 flex flex-col gap-6 min-h-0">
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="flex items-center gap-4 flex-1">
          {logoBase64 && (
            <img
              src={logoBase64}
              alt="Logo laboratorio"
              className="h-12 w-auto object-contain rounded-xl"
            />
          )}
          <div>
            <p className="text-base font-bold">¿A qué proveedor vas a pedir?</p>
            <p className="text-sm opacity-40">
              Puedes acumular proveedores; quitar un filtro no borra el pedido.
            </p>
          </div>
        </div>
        <div className="flex flex-col sm:items-end gap-2 shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-xs opacity-50 whitespace-nowrap">
              Alerta venc.:
            </span>
            {DIAS_OPTIONS.map((d) => (
              <button
                key={d}
                onClick={() => onDiasVencimientoChange(d)}
                className={cn(
                  "px-2.5 py-1 rounded-lg text-xs font-semibold transition-all",
                  diasVencimiento === d
                    ? "bg-warning text-warning-content shadow-sm"
                    : "bg-base-200 opacity-60 hover:opacity-100",
                )}
              >
                {d}d
              </button>
            ))}
          </div>
          {onContinue && (
            <button
              className="btn btn-primary btn-sm rounded-xl min-w-44"
              disabled={selectedIds.length === 0}
              onClick={onContinue}
            >
              Continuar con {selectedIds.length} proveedor
              {selectedIds.length !== 1 ? "es" : ""}
            </button>
          )}
        </div>
      </div>

      {isLoading ? (
        <PageLoading label="Cargando proveedores..." />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 overflow-y-auto custom-scrollbar pb-2">
          {(proveedores ?? [])
            .filter((p) => p.activa)
            .map((p) => (
              <ProveedorCard
                key={p.id}
                proveedor={p}
                urgencias={urgenciasByProveedor[p.id]?.total ?? 0}
                criticos={urgenciasByProveedor[p.id]?.criticos ?? 0}
                lotesVenciendo={vencimientoByProveedor[p.id]?.lotes ?? 0}
                diasVencimiento={diasVencimiento}
                selected={selectedIds.includes(p.id)}
                onClick={() => onSelect(p)}
              />
            ))}
        </div>
      )}
    </div>
  );
}
