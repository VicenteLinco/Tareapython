import { useSearchParams } from "react-router-dom";
import {
  Tag,
  Layers,
  Truck,
  LayoutList,
  Package,
  ShieldAlert,
} from "lucide-react";
import { useFullWidthPage } from "@/components/layout/page-width";
import { useProductosQuarantine } from "@/hooks/dominio";
import { cn } from "@/lib/utils";
import CategoriasTab from "./categorias-tab";
import UnidadesTab from "./unidades-tab";
import ProveedoresTab from "./proveedores-tab";
import ProductosTab from "./productos-tab";
import PresentacionesFormatosTab from "./presentaciones-formatos-tab";
import BandejaCatalogacionTab from "./BandejaCatalogacionTab";

type TabId =
  | "productos"
  | "categorias"
  | "unidades"
  | "proveedores"
  | "presentaciones"
  | "catalogacion";

const TABS: { id: TabId; label: string; icon: React.ElementType }[] = [
  { id: "productos", label: "Productos", icon: Package },
  { id: "catalogacion", label: "Catalogación", icon: ShieldAlert },
  { id: "proveedores", label: "Ofertas y Proveedores", icon: Truck },
  { id: "presentaciones", label: "Formatos de Empaque", icon: LayoutList },
  { id: "categorias", label: "Categorías", icon: Tag },
  { id: "unidades", label: "Unidades", icon: Layers },
];

export default function CreadorProductosPage() {
  useFullWidthPage();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: quarantinedProducts } = useProductosQuarantine();
  const quarantinedCount = quarantinedProducts?.length ?? 0;

  const tabParam = searchParams.get("tab") as TabId | null;
  const tabActivo: TabId = TABS.some((t) => t.id === tabParam)
    ? tabParam!
    : "productos";

  const setTab = (id: TabId) => {
    const p = new URLSearchParams(searchParams);
    if (id === "productos") p.delete("tab");
    else p.set("tab", id);
    setSearchParams(p, { replace: true });
  };

  return (
    <div className="space-y-0">
      <div className="mb-4 px-4 sm:px-6 lg:px-8 mt-2 lg:mt-4">
        <h1 className="t-h1 tracking-tight text-balance">Creador de Productos</h1>
        <p className="text-sm opacity-60 mt-1 max-w-3xl text-balance leading-relaxed">
          Administra los datos maestros del sistema, catálogos técnicos, ofertas comerciales y presentaciones.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-base-200 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden pb-0 px-4 sm:px-6 lg:px-8">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn(
              "flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-all whitespace-nowrap -mb-px",
              tabActivo === id
                ? "border-primary text-primary"
                : "border-transparent text-base-content/50 hover:text-base-content/80 hover:border-base-300",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
            {id === "catalogacion" && quarantinedCount > 0 && (
              <span className="ml-1 px-1.5 py-0.5 text-[10px] font-bold leading-none bg-warning text-warning-content rounded-full">
                {quarantinedCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Contenido del tab activo */}
      <div className="pt-5 px-4 sm:px-6 lg:px-8">
        {tabActivo === "productos" && <ProductosTab />}
        {tabActivo === "catalogacion" && <BandejaCatalogacionTab />}
        {tabActivo === "categorias" && <CategoriasTab />}
        {tabActivo === "unidades" && <UnidadesTab />}
        {tabActivo === "proveedores" && <ProveedoresTab />}
        {tabActivo === "presentaciones" && <PresentacionesFormatosTab />}
      </div>
    </div>
  );
}
