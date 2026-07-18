import type { ReactNode } from "react";
import {
  Package,
  ShoppingCart,
  ClipboardList,
  BarChart2,
  Truck,
  Users,
  Archive,
  Search,
  Inbox,
} from "lucide-react";
import { cn } from "@/lib/utils";

/* Re-exportamos la base de page-state para que todos importen desde aquí */
export { EmptyState as EmptyStateBase } from "./page-state";

type Contexto =
  | "sin_stock"
  | "sin_solicitudes"
  | "sin_recepciones"
  | "sin_proveedores"
  | "sin_usuarios"
  | "sin_productos"
  | "sin_resultados"
  | "sin_conteos"
  | "sin_movimientos";

const CONTEXTOS: Record<
  Contexto,
  { icon: React.ElementType; titulo: string; descripcion: string }
> = {
  sin_stock: {
    icon: Package,
    titulo: "Sin stock en esta área",
    descripcion: "Registra una recepción para agregar productos a esta área.",
  },
  sin_solicitudes: {
    icon: ShoppingCart,
    titulo: "Sin solicitudes de compra",
    descripcion: "Crea una solicitud para pedir reposición de insumos.",
  },
  sin_recepciones: {
    icon: Truck,
    titulo: "Sin recepciones registradas",
    descripcion: "Registra la primera recepción de insumos.",
  },
  sin_proveedores: {
    icon: Archive,
    titulo: "Sin proveedores",
    descripcion: "Agrega un proveedor en el Creador de productos.",
  },
  sin_usuarios: {
    icon: Users,
    titulo: "Sin usuarios",
    descripcion: "Crea el primer usuario desde esta pantalla.",
  },
  sin_productos: {
    icon: Package,
    titulo: "Sin productos",
    descripcion: "Agrega productos en el Creador de productos.",
  },
  sin_resultados: {
    icon: Search,
    titulo: "Sin resultados",
    descripcion: "Intenta con otro término de búsqueda o limpia los filtros.",
  },
  sin_conteos: {
    icon: ClipboardList,
    titulo: "Sin sesiones de conteo",
    descripcion: "Inicia un conteo ciego para verificar el stock del área.",
  },
  sin_movimientos: {
    icon: BarChart2,
    titulo: "Sin movimientos",
    descripcion:
      "Los movimientos se registran automáticamente al consumir, recibir o descartar.",
  },
};

interface EmptyStateProps {
  contexto?: Contexto;
  titulo?: string;
  descripcion?: string;
  accion?: ReactNode;
  icon?: ReactNode;
  className?: string;
}

export function EmptyState({
  contexto,
  titulo,
  descripcion,
  accion,
  icon,
  className,
}: EmptyStateProps) {
  const cfg = contexto ? CONTEXTOS[contexto] : null;
  const Icon = cfg?.icon ?? Inbox;
  const resolvedTitle = titulo ?? cfg?.titulo ?? "Sin datos";
  const resolvedDesc = descripcion ?? cfg?.descripcion;

  return (
    <div
      className={cn(
        "rounded-3xl border border-dashed border-base-300 bg-base-100 p-8 text-center",
        className,
      )}
    >
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-base-200 text-base-content/40">
        {icon ?? <Icon className="h-6 w-6" />}
      </div>
      <h3 className="font-bold text-base-content">{resolvedTitle}</h3>
      {resolvedDesc && (
        <p className="mx-auto mt-1 max-w-md text-sm text-base-content/50">
          {resolvedDesc}
        </p>
      )}
      {accion && <div className="mt-4 flex justify-center">{accion}</div>}
    </div>
  );
}
