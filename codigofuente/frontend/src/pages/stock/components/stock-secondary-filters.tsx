import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";
import type { Categoria, Proveedor } from "@/types";
import type { EstadoFiltro } from "../hooks/useStockFilters";

interface LabCampoDetalle {
  id: string;
  nombre: string;
  tipo_dato: string;
  opciones_lista: string[] | null;
  requerido: boolean;
  considerar_filtro: boolean;
  activo: boolean;
  valor_entero: number | null;
  valor_booleano: boolean | null;
  valor_fecha: string | null;
  valor_texto: string | null;
}

interface StockSecondaryFiltersProps {
  categorias: Categoria[] | undefined;
  proveedores: Proveedor[] | undefined;
  categoriaId: number | null;
  proveedorId: number | null;
  estado: EstadoFiltro;
  customFilters: Record<string, string>;
  setCategoriaId: (v: number | null) => void;
  setProveedorId: (v: number | null) => void;
  setEstado: (v: EstadoFiltro) => void;
  setCustomFilter: (key: string, value: string | null) => void;
}

export function StockSecondaryFilters({
  categorias,
  proveedores,
  categoriaId,
  proveedorId,
  estado,
  customFilters,
  setCategoriaId,
  setProveedorId,
  setEstado,
  setCustomFilter,
}: StockSecondaryFiltersProps) {
  const { data: customFields = [] } = useQuery<LabCampoDetalle[]>({
    queryKey: ["lab-campos-valores"],
    queryFn: () =>
      api.get<LabCampoDetalle[]>("/admin/lab-campos/valores").then((r) => r.data),
  });

  const filtrables = customFields.filter((cf) => cf.activo && cf.considerar_filtro);

  return (
    <>
      <div className="flex flex-col gap-1">
        <label className="text-[10px] font-bold uppercase tracking-widest text-base-content/40 px-1">
          Categoría
        </label>
        <select
          className="select select-sm h-10 w-full bg-base-100 border border-base-300 rounded-xl text-xs font-medium"
          value={categoriaId ?? ""}
          onChange={(e) =>
            setCategoriaId(e.target.value ? Number(e.target.value) : null)
          }
        >
          <option value="">Todas las categorías</option>
          {categorias?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-[10px] font-bold uppercase tracking-widest text-base-content/40 px-1">
          Proveedor
        </label>
        <select
          className="select select-sm h-10 w-full bg-base-100 border border-base-300 rounded-xl text-xs font-medium"
          value={proveedorId ?? ""}
          onChange={(e) =>
            setProveedorId(e.target.value ? Number(e.target.value) : null)
          }
        >
          <option value="">Todos los proveedores</option>
          {proveedores?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nombre}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-[10px] font-bold uppercase tracking-widest text-base-content/40 px-1">
          Estado
        </label>
        <select
          className="select select-sm h-10 w-full bg-base-100 border border-base-300 rounded-xl text-xs font-medium"
          value={estado}
          onChange={(e) => setEstado(e.target.value as EstadoFiltro)}
        >
          <option value="todos">Todos los estados</option>
          <option value="normal">Normal</option>
          <option value="bajo">Stock bajo</option>
          <option value="agotado">Agotado</option>
          <option value="vencido">Vencido</option>
          <option value="vence_pronto">Por vencer</option>
          <option value="sin_datos">Sin datos</option>
        </select>
      </div>

      {filtrables.map((cf) => {
        const val = customFilters[cf.id] ?? "";
        return (
          <div key={cf.id} className="flex flex-col gap-1">
            <label className="text-[10px] font-bold uppercase tracking-widest text-base-content/40 px-1">
              {cf.nombre}
            </label>
            {cf.tipo_dato === "booleano" ? (
              <select
                className="select select-sm h-10 w-full bg-base-100 border border-base-300 rounded-xl text-xs font-medium"
                value={val}
                onChange={(e) => setCustomFilter(cf.id, e.target.value || null)}
              >
                <option value="">Todos</option>
                <option value="true">Sí</option>
                <option value="false">No</option>
              </select>
            ) : cf.tipo_dato === "lista" ? (
              <select
                className="select select-sm h-10 w-full bg-base-100 border border-base-300 rounded-xl text-xs font-medium"
                value={val}
                onChange={(e) => setCustomFilter(cf.id, e.target.value || null)}
              >
                <option value="">Todos</option>
                {(Array.isArray(cf.opciones_lista) ? cf.opciones_lista : []).map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            ) : cf.tipo_dato === "entero" ? (
              <input
                type="number"
                className="input input-sm h-10 w-full bg-base-100 border border-base-300 rounded-xl text-xs font-medium"
                placeholder={`Filtrar ${cf.nombre.toLowerCase()}...`}
                value={val}
                onChange={(e) => setCustomFilter(cf.id, e.target.value || null)}
              />
            ) : cf.tipo_dato === "fecha" ? (
              <input
                type="date"
                className="input input-sm h-10 w-full bg-base-100 border border-base-300 rounded-xl text-xs font-medium"
                value={val}
                onChange={(e) => setCustomFilter(cf.id, e.target.value || null)}
              />
            ) : (
              <input
                type="text"
                className="input input-sm h-10 w-full bg-base-100 border border-base-300 rounded-xl text-xs font-medium"
                placeholder={`Filtrar ${cf.nombre.toLowerCase()}...`}
                value={val}
                onChange={(e) => setCustomFilter(cf.id, e.target.value || null)}
              />
            )}
          </div>
        );
      })}
    </>
  );
}
