import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Trash2,
  Edit,
  Package,
  DollarSign,
  Tag,
  ScanBarcode,
} from "lucide-react";
import { DataTable } from "@/components/ui/data-table";
import { PageLoading } from "@/components/ui/page-state";
import {
  ProveedorSelect,
  ProveedorIcon,
} from "@/components/ui/proveedor-select";
import { Dialog } from "@/components/ui/dialog";
import { notify } from "@/lib/notify";
import api from "@/lib/api";
import type { Proveedor } from "@/types";

export interface Presentacion {
  id: number;
  producto_id: string;
  nombre: string;
  nombre_plural: string;
  factor_conversion: string;
  codigo_barras: string | null;
  gtin: string | null;
  gs1_habilitado: boolean;
  gtin_interno: boolean;
  activa: boolean;
  proveedor_id: number | null;
  precio_adquisicion: string | null;
  sku: string | null;
}

export function PresentacionesManager({ productoId }: { productoId: string }) {
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<Partial<Presentacion>>({
    nombre: "",
    nombre_plural: "",
    factor_conversion: "1",
    codigo_barras: "",
    gtin: "",
    sku: "",
    precio_adquisicion: "",
    proveedor_id: null,
  });

  const { data: presentaciones = [], isLoading } = useQuery({
    queryKey: ["presentaciones", productoId],
    queryFn: () =>
      api
        .get<Presentacion[]>(`/productos/${productoId}/presentaciones`)
        .then((r) => r.data),
  });

  const createMut = useMutation({
    mutationFn: (payload: any) =>
      api.post(`/productos/${productoId}/presentaciones`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["presentaciones", productoId],
      });
      setModalOpen(false);
      notify.success("Presentación creada exitosamente");
    },
  });

  const updateMut = useMutation({
    mutationFn: (payload: any) =>
      api.put(`/presentaciones/${editingId}`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["presentaciones", productoId],
      });
      setModalOpen(false);
      notify.success("Presentación actualizada exitosamente");
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => api.delete(`/presentaciones/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["presentaciones", productoId],
      });
      notify.success("Presentación eliminada");
    },
  });

  function openAdd() {
    setEditingId(null);
    setForm({
      nombre: "",
      nombre_plural: "",
      factor_conversion: "1",
      codigo_barras: "",
      gtin: "",
      sku: "",
      precio_adquisicion: "",
      proveedor_id: null,
    });
    setModalOpen(true);
  }

  function openEdit(item: Presentacion) {
    setEditingId(item.id);
    setForm({
      ...item,
      proveedor_id: item.proveedor_id || null,
      precio_adquisicion: item.precio_adquisicion || "",
      sku: item.sku || "",
      gtin: item.gtin || "",
      codigo_barras: item.codigo_barras || "",
    });
    setModalOpen(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload = {
      ...form,
      precio_adquisicion: form.precio_adquisicion || null,
      sku: form.sku || null,
      gtin: form.gtin || null,
      codigo_barras: form.codigo_barras || null,
    };

    if (editingId) {
      // Necesitamos la versión original para actualizar (asumiendo que version viene del backend)
      const original = presentaciones.find((p) => p.id === editingId);
      updateMut.mutate({
        ...payload,
        version: (original as any)?.version || 1,
      });
    } else {
      createMut.mutate(payload);
    }
  }

  function handleDelete(item: Presentacion) {
    if (confirm(`¿Eliminar la presentación ${item.nombre}?`)) {
      deleteMut.mutate(item.id);
    }
  }

  const columns = [
    {
      key: "nombre",
      header: "Presentación",
      render: (item: Presentacion) => (
        <div>
          <div className="font-semibold text-sm">{item.nombre}</div>
          <div className="text-xs opacity-60">
            Factor: {item.factor_conversion}
          </div>
        </div>
      ),
    },
    {
      key: "logistica",
      header: "Logística",
      render: (item: Presentacion) => (
        <div className="flex flex-col gap-1">
          {item.sku && (
            <div className="text-xs flex items-center gap-1 opacity-70">
              <Tag className="w-3 h-3" /> SKU: {item.sku}
            </div>
          )}
          {item.gtin && (
            <div className="text-xs flex items-center gap-1 opacity-70 text-primary">
              <ScanBarcode className="w-3 h-3" /> {item.gtin}
            </div>
          )}
        </div>
      ),
    },
    {
      key: "finanzas",
      header: "Compras",
      render: (item: Presentacion) => (
        <div className="flex flex-col gap-1">
          {item.precio_adquisicion ? (
            <div className="text-sm font-semibold text-success flex items-center gap-1">
              <DollarSign className="w-3 h-3" />
              {item.precio_adquisicion}
            </div>
          ) : (
            <div className="text-xs opacity-50">Sin precio</div>
          )}
        </div>
      ),
    },
    {
      key: "acciones",
      header: "",
      className: "text-right",
      render: (item: Presentacion) => (
        <div className="flex justify-end gap-2">
          <button
            onClick={() => openEdit(item)}
            className="btn btn-ghost btn-xs btn-square"
          >
            <Edit className="w-4 h-4 opacity-70" />
          </button>
          <button
            onClick={() => handleDelete(item)}
            className="btn btn-ghost btn-xs btn-square text-error"
          >
            <Trash2 className="w-4 h-4 opacity-70" />
          </button>
        </div>
      ),
    },
  ];

  if (isLoading) return <PageLoading label="Cargando presentaciones..." />;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center bg-base-200/40 p-4 rounded-xl border border-base-300">
        <div>
          <h3 className="font-bold flex items-center gap-2">
            <Package className="w-5 h-5 text-primary" />
            Empaques y Logística
          </h3>
          <p className="text-sm opacity-70 mt-1">
            Define las cajas, kits y botellas como le compras a tus proveedores.
          </p>
        </div>
        <button onClick={openAdd} className="btn btn-primary btn-sm gap-2">
          <Plus className="w-4 h-4" />
          Nueva Presentación
        </button>
      </div>

      <DataTable
        data={presentaciones}
        columns={columns}
        emptyMessage="Este producto aún no tiene presentaciones logísticas registradas."
      />

      <Dialog open={modalOpen} onOpenChange={setModalOpen} className="max-w-xl">
        <div className="p-6">
          <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
            <Package className="w-6 h-6 text-primary" />
            {editingId ? "Editar Presentación" : "Nueva Presentación"}
          </h2>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="form-control">
                <label className="label">
                  <span className="label-text font-medium">
                    Nombre (Singular)
                  </span>
                </label>
                <input
                  className="input input-bordered w-full"
                  placeholder="Ej: Caja de 500 Test"
                  value={form.nombre}
                  onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                  required
                />
              </div>
              <div className="form-control">
                <label className="label">
                  <span className="label-text font-medium">
                    Nombre (Plural)
                  </span>
                </label>
                <input
                  className="input input-bordered w-full"
                  placeholder="Ej: Cajas de 500 Test"
                  value={form.nombre_plural}
                  onChange={(e) =>
                    setForm({ ...form, nombre_plural: e.target.value })
                  }
                  required
                />
              </div>

              <div className="form-control">
                <label className="label">
                  <span className="label-text font-medium">
                    Factor de Conversión
                  </span>
                  <span className="label-text-alt opacity-50">
                    Cant. en unidad clínica
                  </span>
                </label>
                <input
                  type="number"
                  step="0.01"
                  className="input input-bordered w-full font-mono"
                  value={form.factor_conversion}
                  onChange={(e) =>
                    setForm({ ...form, factor_conversion: e.target.value })
                  }
                  required
                />
              </div>

              <div className="form-control">
                <label className="label">
                  <span className="label-text font-medium">
                    Código de Barras 1D
                  </span>
                </label>
                <input
                  className="input input-bordered w-full font-mono"
                  value={form.codigo_barras || ""}
                  onChange={(e) =>
                    setForm({ ...form, codigo_barras: e.target.value })
                  }
                />
              </div>
            </div>

            <div className="divider text-xs opacity-50 font-bold uppercase tracking-wider">
              Logística de Compra
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="form-control col-span-2 sm:col-span-1">
                <label className="label">
                  <span className="label-text font-medium">
                    Proveedor Oficial
                  </span>
                </label>
                <ProveedorSelect
                  value={form.proveedor_id ? form.proveedor_id.toString() : ""}
                  onChange={(v) =>
                    setForm({ ...form, proveedor_id: v ? parseInt(v) : null })
                  }
                />
              </div>

              <div className="form-control">
                <label className="label">
                  <span className="label-text font-medium">
                    Precio de Adquisición
                  </span>
                </label>
                <div className="relative">
                  <DollarSign className="w-4 h-4 absolute left-3 top-3.5 opacity-50" />
                  <input
                    type="number"
                    step="0.01"
                    className="input input-bordered w-full pl-9 font-mono"
                    placeholder="0.00"
                    value={form.precio_adquisicion || ""}
                    onChange={(e) =>
                      setForm({ ...form, precio_adquisicion: e.target.value })
                    }
                  />
                </div>
              </div>

              <div className="form-control">
                <label className="label">
                  <span className="label-text font-medium">GTIN</span>
                  <span className="label-text-alt text-primary font-bold">
                    Scanner
                  </span>
                </label>
                <input
                  className="input input-bordered w-full font-mono"
                  placeholder="00000000000000"
                  value={form.gtin || ""}
                  onChange={(e) => setForm({ ...form, gtin: e.target.value })}
                />
              </div>

              <div className="form-control">
                <label className="label">
                  <span className="label-text font-medium">
                    SKU (Código Proveedor)
                  </span>
                </label>
                <input
                  className="input input-bordered w-full font-mono"
                  value={form.sku || ""}
                  onChange={(e) => setForm({ ...form, sku: e.target.value })}
                />
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
                  : "Guardar Presentación"}
              </button>
            </div>
          </form>
        </div>
      </Dialog>
    </div>
  );
}
