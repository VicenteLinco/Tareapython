import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, X, SlidersHorizontal } from "lucide-react";
import { Navigate } from "react-router-dom";
import { useAuthStore } from "@/hooks/use-auth-store";
import { DataTable } from "@/components/ui/data-table";
import { PageLoading } from "@/components/ui/page-state";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import api from "@/lib/api";
import { parseApiError } from "@/lib/api-error";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";
import type { Area, CreateArea, UpdateArea } from "@/types";

interface ProductoAreaConfig {
  id: string;
  codigo_interno: string;
  nombre: string;
  stock_maximo: string | null;
  punto_reorden: string | null;
}

function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const check = () => setIsDesktop(window.innerWidth >= 1024);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);
  return isDesktop;
}

export default function AreasPage() {
  const usuario = useAuthStore((s) => s.usuario);

  const queryClient = useQueryClient();
  const isDesktop = useIsDesktop();
  const [formMode, setFormMode] = useState<"idle" | "crear" | "editar">("idle");
  const [selectedItem, setSelectedItem] = useState<Area | null>(null);
  const [nombre, setNombre] = useState("");
  const [esBodega, setEsBodega] = useState(false);
  const [frecuenciaDias, setFrecuenciaDias] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState<Area | null>(null);
  const [configArea, setConfigArea] = useState<Area | null>(null);

  const { data: areas = [], isLoading } = useQuery({
    queryKey: ["areas"],
    queryFn: () => api.get<Area[]>("/areas").then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });

  const createMut = useMutation({
    mutationFn: (data: CreateArea) => api.post("/areas", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["areas"] });
      notify.success("Área creada");
      closeForm();
    },
    onError: (err) => notify.error(parseApiError(err)),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: UpdateArea }) =>
      api.put(`/areas/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["areas"] });
      notify.success("Área actualizada");
      closeForm();
    },
    onError: (err) => notify.error(parseApiError(err)),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => api.delete(`/areas/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["areas"] });
      notify.success("Área eliminada");
      setDeleteTarget(null);
    },
    onError: (err) => notify.error(parseApiError(err)),
  });

  const { data: productosArea, isLoading: loadingProductosArea } = useQuery({
    queryKey: ["area-productos-config", configArea?.id],
    queryFn: () =>
      api
        .get<ProductoAreaConfig[]>(`/areas/${configArea!.id}/productos`)
        .then((r) => r.data),
    enabled: !!configArea,
  });

  const [productosConfig, setProductosConfig] = useState<ProductoAreaConfig[]>(
    [],
  );

  // Guard the sync: a bare `= []` default produced a new array reference every
  // render, so this effect looped (setState → render → new [] → effect → …) and
  // froze the tab. React Query keeps `data` referentially stable, so syncing only
  // when it is defined is safe and breaks the loop.
  useEffect(() => {
    if (productosArea) setProductosConfig(productosArea);
  }, [productosArea]);

  const saveAreaConfigMut = useMutation({
    mutationFn: () =>
      api.put(`/areas/${configArea!.id}/productos`, {
        productos: productosConfig.map((p) => ({
          producto_id: p.id,
          stock_maximo: p.stock_maximo || null,
          punto_reorden: p.punto_reorden || null,
        })),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["area-productos-config", configArea?.id],
      });
      notify.success("Stock por área actualizado");
      setConfigArea(null);
    },
    onError: (err) => notify.error(parseApiError(err)),
  });

  if (usuario?.rol !== "admin") {
    return <Navigate to="/" replace />;
  }

  function openCreate() {
    setSelectedItem(null);
    setNombre("");
    setEsBodega(false);
    setFrecuenciaDias(0);
    setFormMode("crear");
  }

  function openEdit(area: Area) {
    setSelectedItem(area);
    setNombre(area.nombre);
    setEsBodega(area.es_bodega);
    setFrecuenciaDias(area.conteo_frecuencia_dias ?? 0);
    setFormMode("editar");
  }

  function closeForm() {
    setFormMode("idle");
    setSelectedItem(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!nombre.trim()) return;
    if (selectedItem) {
      updateMut.mutate({
        id: selectedItem.id,
        data: {
          nombre: nombre.trim(),
          es_bodega: esBodega,
          conteo_frecuencia_dias: frecuenciaDias,
          version: selectedItem.version,
        },
      });
    } else {
      createMut.mutate({ nombre: nombre.trim(), es_bodega: esBodega });
    }
  }

  const isSaving = createMut.isPending || updateMut.isPending;

  const formJsx = (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="form-control">
        <label className="label">
          <span className="label-text text-sm font-medium">Nombre *</span>
        </label>
        <input
          type="text"
          className="input input-bordered input-sm h-9"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Ej: Hematología"
          autoFocus
          required
        />
      </div>
      <div className="form-control">
        <label className="label cursor-pointer justify-start gap-3">
          <input
            type="checkbox"
            className="checkbox checkbox-sm checkbox-primary"
            checked={esBodega}
            onChange={(e) => setEsBodega(e.target.checked)}
          />
          <div>
            <span className="label-text text-sm font-medium">Es bodega</span>
            <p className="text-xs opacity-40">
              Las bodegas son áreas de almacenamiento central
            </p>
          </div>
        </label>
      </div>
      {formMode !== "idle" && (
        <div className="form-control">
          <label className="label">
            <span className="label-text text-sm font-medium">
              Frecuencia de conteo
            </span>
          </label>
          <select
            className="select select-bordered select-sm h-9"
            value={frecuenciaDias}
            onChange={(e) => setFrecuenciaDias(Number(e.target.value))}
          >
            <option value={0}>Sin programación</option>
            <option value={7}>Semanal (7 días)</option>
            <option value={14}>Quincenal (14 días)</option>
            <option value={30}>Mensual (30 días)</option>
            <option value={90}>Trimestral (90 días)</option>
          </select>
        </div>
      )}
      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={closeForm}
        >
          Cancelar
        </button>
        <button
          type="submit"
          className="btn btn-primary btn-sm"
          disabled={isSaving}
        >
          {isSaving ? (
            <span className="loading loading-spinner loading-xs" />
          ) : selectedItem ? (
            "Guardar"
          ) : (
            "Crear"
          )}
        </button>
      </div>
    </form>
  );

  const columns = [
    {
      key: "nombre",
      header: "Nombre",
      render: (item: Area) => (
        <span className="font-medium text-sm">{item.nombre}</span>
      ),
    },
    {
      key: "es_bodega",
      header: "Tipo",
      render: (item: Area) =>
        item.es_bodega ? (
          <Badge variant="info">Bodega</Badge>
        ) : (
          <Badge variant="secondary">Área</Badge>
        ),
    },
    {
      key: "activa",
      header: "Estado",
      render: (item: Area) =>
        item.activa ? (
          <Badge variant="success">Activa</Badge>
        ) : (
          <Badge variant="outline">Inactiva</Badge>
        ),
    },
    {
      key: "conteo_frecuencia_dias",
      header: "Conteo programado",
      className: "hidden md:table-cell",
      render: (item: Area) => {
        const f = item.conteo_frecuencia_dias ?? 0;
        const labels: Record<number, string> = {
          0: "—",
          7: "Semanal",
          14: "Quincenal",
          30: "Mensual",
          90: "Trimestral",
        };
        return (
          <span className="text-xs opacity-60">{labels[f] ?? `${f} días`}</span>
        );
      },
    },
    {
      key: "acciones",
      header: "",
      className: "w-20",
      render: (item: Area) => (
        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
          <button
            className="btn btn-ghost btn-xs btn-square"
            onClick={() => openEdit(item)}
          >
            <Pencil className="h-3.5 w-3.5 opacity-50" />
          </button>
          <button
            className="btn btn-ghost btn-xs btn-square"
            title="Stock por área"
            onClick={() => setConfigArea(item)}
          >
            <SlidersHorizontal className="h-3.5 w-3.5 opacity-50" />
          </button>
          <button
            className="btn btn-ghost btn-xs btn-square"
            onClick={() => setDeleteTarget(item)}
          >
            <Trash2 className="h-3.5 w-3.5 opacity-50 hover:text-error" />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="t-h1">Áreas</h1>
          <p className="text-sm text-base-content/60 mt-0.5">
            Gestión de áreas y parametrización de stock
          </p>
        </div>
        <button className="btn btn-primary btn-sm gap-1.5" onClick={openCreate}>
          <Plus className="h-4 w-4" />
          Nueva área
        </button>
      </div>

      <div className="flex gap-6 items-start">
        <div
          className={cn(
            "min-w-0",
            formMode !== "idle" ? "lg:flex-[3]" : "w-full",
          )}
        >
          {isLoading ? (
            <PageLoading label="Cargando áreas..." />
          ) : (
            <DataTable
              columns={columns}
              data={areas}
              emptyMessage="No hay áreas registradas"
              onRowClick={(item) => openEdit(item)}
              selectedId={formMode !== "idle" ? selectedItem?.id : undefined}
            />
          )}
        </div>

        {formMode !== "idle" && isDesktop && (
          <div className="hidden lg:flex flex-col min-w-0 lg:flex-[2] lg:sticky lg:top-24">
            <div className="rounded-xl border border-base-300 bg-base-100 p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-sm">
                  {formMode === "crear" ? "Nueva área" : "Editar área"}
                </h3>
                <button
                  type="button"
                  onClick={closeForm}
                  className="text-base-content/50 hover:text-base-content"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              {formJsx}
            </div>
          </div>
        )}
      </div>

      <Dialog
        open={formMode !== "idle" && !isDesktop}
        onClose={closeForm}
        title={formMode === "crear" ? "Nueva área" : "Editar área"}
      >
        {formJsx}
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Eliminar área"
        description={`¿Estás seguro de eliminar el área "${deleteTarget?.nombre}"? Esta acción desactivará el acceso pero mantendrá el historial de movimientos.`}
        confirmLabel="Eliminar"
        loading={deleteMut.isPending}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMut.mutate(deleteTarget.id)}
      />

      <Dialog
        open={!!configArea}
        onClose={() => setConfigArea(null)}
        title={`Stock por área: ${configArea?.nombre ?? ""}`}
        className="max-w-3xl"
      >
        {loadingProductosArea ? (
          <PageLoading label="Cargando productos..." size="md" />
        ) : (
          <div className="space-y-3">
            <div className="overflow-x-auto max-h-[60vh]">
              <table className="table table-sm">
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th className="w-28">Máx.</th>
                    <th className="w-32">Reorden</th>
                  </tr>
                </thead>
                <tbody>
                  {productosConfig.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <div className="font-medium text-sm">{p.nombre}</div>
                        <div className="text-[10px] font-mono opacity-40">
                          {p.codigo_interno}
                        </div>
                      </td>
                      {(["stock_maximo", "punto_reorden"] as const).map(
                        (key) => (
                          <td key={key}>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              className="input input-bordered input-xs w-full"
                              value={
                                productosConfig.find((x) => x.id === p.id)?.[
                                  key
                                ] ?? ""
                              }
                              onChange={(e) =>
                                setProductosConfig((prev) =>
                                  prev.map((row) =>
                                    row.id === p.id
                                      ? {
                                          ...row,
                                          [key]: e.target.value || null,
                                        }
                                      : row,
                                  ),
                                )
                              }
                            />
                          </td>
                        ),
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              {productosConfig.length === 0 && (
                <p className="text-sm opacity-50 text-center py-6">
                  No hay productos asignados a esta área.
                </p>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setConfigArea(null)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={saveAreaConfigMut.isPending}
                onClick={() => saveAreaConfigMut.mutate()}
              >
                {saveAreaConfigMut.isPending ? (
                  <span className="loading loading-spinner loading-xs" />
                ) : (
                  "Guardar"
                )}
              </button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
