import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { DataTable } from "@/components/ui/data-table";
import { PageLoading } from "@/components/ui/page-state";
import { Dialog } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import api from "@/lib/api";
import { parseApiError } from "@/lib/api-error";
import { notify } from "@/lib/notify";
import type {
  UnidadBasica,
  CreateUnidadBasica,
  UpdateUnidadBasica,
} from "@/types";

export default function UnidadesTab() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<UnidadBasica | null>(null);
  const [nombre, setNombre] = useState("");
  const [nombrePlural, setNombrePlural] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<UnidadBasica | null>(null);

  const { data: unidades = [], isLoading } = useQuery({
    queryKey: ["unidades-basicas"],
    queryFn: () =>
      api.get<UnidadBasica[]>("/unidades-basicas").then((r) => r.data),
  });

  const createMut = useMutation({
    mutationFn: (data: CreateUnidadBasica) =>
      api.post("/unidades-basicas", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["unidades-basicas"] });
      notify.success("Unidad creada");
      closeDialog();
    },
    onError: (err) => notify.error(parseApiError(err)),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: UpdateUnidadBasica }) =>
      api.put(`/unidades-basicas/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["unidades-basicas"] });
      notify.success("Unidad actualizada");
      closeDialog();
    },
    onError: (err) => notify.error(parseApiError(err)),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => api.delete(`/unidades-basicas/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["unidades-basicas"] });
      notify.success("Unidad eliminada");
      setDeleteTarget(null);
    },
    onError: (err) => notify.error(parseApiError(err)),
  });

  function openCreate() {
    setEditing(null);
    setNombre("");
    setNombrePlural("");
    setDialogOpen(true);
  }

  function openEdit(u: UnidadBasica) {
    setEditing(u);
    setNombre(u.nombre);
    setNombrePlural(u.nombre_plural);
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setEditing(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!nombre.trim() || !nombrePlural.trim()) return;
    if (editing) {
      updateMut.mutate({
        id: editing.id,
        data: {
          nombre: nombre.trim(),
          nombre_plural: nombrePlural.trim(),
          version: editing.version,
        },
      });
    } else {
      createMut.mutate({
        nombre: nombre.trim(),
        nombre_plural: nombrePlural.trim(),
      });
    }
  }

  const isSaving = createMut.isPending || updateMut.isPending;

  const columns = [
    {
      key: "nombre",
      header: "Singular",
      render: (item: UnidadBasica) => (
        <span className="font-medium text-sm">{item.nombre}</span>
      ),
    },
    {
      key: "nombre_plural",
      header: "Plural",
      render: (item: UnidadBasica) => (
        <span className="text-sm opacity-70">{item.nombre_plural}</span>
      ),
    },
    {
      key: "acciones",
      header: "",
      className: "w-20",
      render: (item: UnidadBasica) => (
        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
          <button
            className="btn btn-ghost btn-xs btn-square"
            onClick={() => openEdit(item)}
          >
            <Pencil className="h-3.5 w-3.5 opacity-50" />
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
    <div className="space-y-4">
      <div className="flex justify-end">
        <button className="btn btn-primary btn-sm gap-1.5" onClick={openCreate}>
          <Plus className="h-4 w-4" />
          Nueva unidad
        </button>
      </div>

      {isLoading ? (
        <PageLoading label="Cargando unidades..." />
      ) : (
        <DataTable
          columns={columns}
          data={unidades}
          emptyMessage="No hay unidades registradas"
        />
      )}

      <Dialog
        open={dialogOpen}
        onClose={closeDialog}
        title={editing ? "Editar unidad" : "Nueva unidad básica"}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="form-control">
              <label className="label">
                <span className="label-text text-sm font-medium">
                  Singular *
                </span>
              </label>
              <input
                type="text"
                className="input input-bordered input-sm h-9"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                placeholder="Ej: placa"
                autoFocus
                required
              />
            </div>
            <div className="form-control">
              <label className="label">
                <span className="label-text text-sm font-medium">Plural *</span>
              </label>
              <input
                type="text"
                className="input input-bordered input-sm h-9"
                value={nombrePlural}
                onChange={(e) => setNombrePlural(e.target.value)}
                placeholder="Ej: placas"
                required
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={closeDialog}
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
              ) : editing ? (
                "Guardar"
              ) : (
                "Crear"
              )}
            </button>
          </div>
        </form>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Eliminar unidad básica"
        description={`¿Estás seguro de eliminar "${deleteTarget?.nombre}"? Esta acción no se puede deshacer si tiene productos asociados.`}
        confirmLabel="Eliminar"
        loading={deleteMut.isPending}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMut.mutate(deleteTarget.id)}
      />
    </div>
  );
}
