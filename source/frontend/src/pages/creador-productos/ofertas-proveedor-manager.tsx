import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Edit, DollarSign, Store, Tag, Package } from "lucide-react";
import { DataTable } from "@/components/ui/data-table";
import { PageLoading } from "@/components/ui/page-state";
import { ProveedorSelect } from "@/components/ui/proveedor-select";
import { useProveedores } from "@/hooks/dominio";
import { Dialog } from "@/components/ui/dialog";
import { notify } from "@/lib/notify";
import api from "@/lib/api";
import type { Presentacion } from "./presentaciones-manager";

export interface OfertaProveedor {
  id: number;
  presentacion_id: number;
  proveedor_id: number;
  precio_adquisicion: string;
  sku: string | null;
  activo: boolean;
  // Included from backend joins ideally:
  presentacion_nombre?: string;
  proveedor_nombre?: string;
}

export function OfertasProveedorManager({ productoId }: { productoId: string }) {
  const queryClient = useQueryClient();
  const { data: proveedores = [] } = useProveedores();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<Partial<OfertaProveedor>>({
    presentacion_id: undefined,
    proveedor_id: undefined,
    precio_adquisicion: "",
    sku: "",
  });

  const { data: presentaciones = [], isLoading: loadingPres } = useQuery({
    queryKey: ["presentaciones", productoId],
    queryFn: () =>
      api.get<Presentacion[]>(`/productos/${productoId}/presentaciones`).then((r) => r.data),
  });

  const { data: ofertas = [], isLoading: loadingOf } = useQuery({
    queryKey: ["ofertas-proveedor", productoId],
    queryFn: () =>
      api.get<OfertaProveedor[]>(`/productos/${productoId}/ofertas`).then((r) => r.data),
  });

  const createMut = useMutation({
    mutationFn: (payload: any) => api.post(`/productos/${productoId}/ofertas`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ofertas-proveedor", productoId] });
      setModalOpen(false);
      notify.success("Oferta registrada exitosamente");
    },
  });

  const updateMut = useMutation({
    mutationFn: (payload: any) => api.put(`/ofertas/${editingId}`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ofertas-proveedor", productoId] });
      setModalOpen(false);
      notify.success("Oferta actualizada exitosamente");
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => api.delete(`/ofertas/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ofertas-proveedor", productoId] });
      notify.success("Oferta eliminada");
    },
  });

  function openAdd() {
    setEditingId(null);
    setForm({
      presentacion_id: presentaciones.length === 1 ? presentaciones[0].id : undefined,
      proveedor_id: undefined,
      precio_adquisicion: "",
      sku: "",
    });
    setModalOpen(true);
  }

  function openEdit(item: OfertaProveedor) {
    setEditingId(item.id);
    setForm({
      presentacion_id: item.presentacion_id,
      proveedor_id: item.proveedor_id,
      precio_adquisicion: item.precio_adquisicion || "",
      sku: item.sku || "",
    });
    setModalOpen(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.presentacion_id) return notify.error("Seleccione una presentación");
    if (!form.proveedor_id) return notify.error("Seleccione un proveedor");
    if (!form.precio_adquisicion) return notify.error("Ingrese el precio de adquisición");

    const payload = {
      presentacion_id: form.presentacion_id,
      proveedor_id: form.proveedor_id,
      precio_adquisicion: form.precio_adquisicion,
      sku: form.sku || null,
    };

    if (editingId) {
      updateMut.mutate(payload);
    } else {
      createMut.mutate(payload);
    }
  }

  function handleDelete(item: OfertaProveedor) {
    if (confirm("¿Eliminar esta oferta del proveedor?")) {
      deleteMut.mutate(item.id);
    }
  }

  const columns = [
    {
      key: "presentacion",
      header: "Presentación",
      render: (item: OfertaProveedor) => {
        const p = presentaciones.find((x) => x.id === item.presentacion_id);
        return (
          <div className="flex items-center gap-2">
            <Package className="w-4 h-4 text-base-content/40" />
            <span className="font-medium text-sm">
              {p?.nombre || item.presentacion_nombre || "Desconocida"}
            </span>
          </div>
        );
      },
    },
    {
      key: "proveedor",
      header: "Proveedor",
      render: (item: OfertaProveedor) => {
        const prov = proveedores.find((x) => x.id === item.proveedor_id);
        return (
          <div className="flex items-center gap-2">
            <Store className="w-4 h-4 text-base-content/40" />
            <span className="font-medium text-sm">
              {prov?.nombre || item.proveedor_nombre || "Desconocido"}
            </span>
          </div>
        );
      },
    },
    {
      key: "sku",
      header: "SKU / Cód. Comercial",
      render: (item: OfertaProveedor) => (
        <div className="flex items-center gap-1.5 opacity-80">
          {item.sku ? (
            <>
              <Tag className="w-3.5 h-3.5" />
              <span className="font-mono text-xs">{item.sku}</span>
            </>
          ) : (
            <span className="text-xs opacity-50">N/A</span>
          )}
        </div>
      ),
    },
    {
      key: "precio",
      header: "Precio Adq.",
      render: (item: OfertaProveedor) => (
        <div className="text-sm font-bold text-success flex items-center">
          <DollarSign className="w-3.5 h-3.5" />
          {item.precio_adquisicion}
        </div>
      ),
    },
    {
      key: "acciones",
      header: "",
      className: "text-right",
      render: (item: OfertaProveedor) => (
        <div className="flex justify-end gap-1">
          <button
            onClick={() => openEdit(item)}
            className="btn btn-ghost btn-xs btn-square"
            title="Editar oferta"
          >
            <Edit className="w-4 h-4 opacity-70" />
          </button>
          <button
            onClick={() => handleDelete(item)}
            className="btn btn-ghost btn-xs btn-square text-error hover:bg-error/10"
            title="Eliminar oferta"
          >
            <Trash2 className="w-4 h-4 opacity-70" />
          </button>
        </div>
      ),
    },
  ];

  if (loadingPres || loadingOf) return <PageLoading label="Cargando ofertas..." />;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center bg-base-200/40 p-4 rounded-xl border border-base-300">
        <div>
          <h3 className="font-bold flex items-center gap-2">
            <Store className="w-5 h-5 text-primary" />
            Ofertas de Proveedores
          </h3>
          <p className="text-sm opacity-70 mt-1">
            Mapea las presentaciones con los proveedores, precios y códigos comerciales (SKU).
          </p>
        </div>
        <button
          onClick={openAdd}
          className="btn btn-primary btn-sm gap-2"
          disabled={presentaciones.length === 0}
        >
          <Plus className="w-4 h-4" />
          Nueva Oferta
        </button>
      </div>

      {presentaciones.length > 0 && ofertas.length > 0 && (
        <div className="stats stats-vertical bg-base-200/30 border border-base-300 w-full shadow-sm rounded-xl">
          <div className="stat py-2.5 px-4">
            <div className="stat-title text-[10px] font-bold uppercase tracking-wider opacity-60">Ofertas Activas</div>
            <div className="stat-value text-lg text-primary font-bold">{ofertas.length}</div>
            <div className="stat-desc text-[10px] opacity-50">Tarifas vigentes</div>
          </div>
          
          <div className="stat py-2.5 px-4">
            <div className="stat-title text-[10px] font-bold uppercase tracking-wider opacity-60">Rango de Precios</div>
            <div className="stat-value text-lg text-success font-black">
              ${Math.min(...ofertas.map(o => parseFloat(o.precio_adquisicion || "0"))).toFixed(2)} - ${Math.max(...ofertas.map(o => parseFloat(o.precio_adquisicion || "0"))).toFixed(2)}
            </div>
            <div className="stat-desc text-[10px] opacity-50">Mínimo vs Máximo</div>
          </div>
        </div>
      )}

      {presentaciones.length === 0 ? (
        <div className="text-center p-6 bg-base-100 border border-base-200 rounded-xl">
          <p className="text-sm opacity-60">
            Primero debes crear al menos una <strong>Presentación Logística</strong> para poder asociarle ofertas de proveedores.
          </p>
        </div>
      ) : (
        <DataTable
          data={ofertas}
          columns={columns}
          emptyMessage="No hay ofertas de proveedores registradas."
        />
      )}

      <Dialog
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingId ? "Editar Oferta" : "Nueva Oferta"}
        className="max-w-xl"
      >
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="form-control col-span-2">
              <label className="label">
                <span className="label-text font-medium">Presentación Logística</span>
              </label>
              <select
                className="select select-bordered w-full"
                value={form.presentacion_id || ""}
                onChange={(e) => setForm({ ...form, presentacion_id: parseInt(e.target.value) })}
                required
              >
                <option value="" disabled>
                  Seleccione una presentación...
                </option>
                {presentaciones.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre} (x{p.factor_conversion})
                  </option>
                ))}
              </select>
            </div>

            <div className="form-control col-span-2">
              <label className="label">
                <span className="label-text font-medium">Proveedor</span>
              </label>
              <ProveedorSelect
                proveedores={proveedores}
                value={form.proveedor_id ? form.proveedor_id.toString() : ""}
                onChange={(v) => setForm({ ...form, proveedor_id: v ? parseInt(v) : undefined })}
              />
            </div>

            <div className="form-control">
              <label className="label">
                <span className="label-text font-medium">Precio de Adquisición</span>
              </label>
              <div className="relative">
                <DollarSign className="w-4 h-4 absolute left-3 top-3.5 opacity-50" />
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="input input-bordered w-full pl-9 font-mono font-bold"
                  placeholder="0.00"
                  value={form.precio_adquisicion}
                  onChange={(e) => setForm({ ...form, precio_adquisicion: e.target.value })}
                  required
                />
              </div>
            </div>

            <div className="form-control">
              <label className="label">
                <span className="label-text font-medium">SKU (Código Proveedor)</span>
                <span className="label-text-alt opacity-50">Opcional</span>
              </label>
              <div className="relative">
                <Tag className="w-4 h-4 absolute left-3 top-3.5 opacity-50" />
                <input
                  type="text"
                  className="input input-bordered w-full pl-9 font-mono"
                  placeholder="Ej: REF-12345"
                  value={form.sku || ""}
                  onChange={(e) => setForm({ ...form, sku: e.target.value })}
                />
              </div>
            </div>
          </div>

          <div className="modal-action">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setModalOpen(false)}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={createMut.isPending || updateMut.isPending}
            >
              {createMut.isPending || updateMut.isPending
                ? "Guardando..."
                : "Guardar Oferta"}
            </button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
