import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Pencil,
  Trash2,
  Plus,
  Save,
  Database,
  X,
} from "lucide-react";
import { notify } from "@/lib/notify";
import api from "@/lib/api";
import { cn } from "@/lib/utils";

// --- Types ---

interface LabCampoDefinicion {
  id: string;
  nombre: string;
  tipo_dato: string;
  opciones_lista: string[] | null;
  requerido: boolean;
  considerar_filtro: boolean;
  orden: number;
  activo: boolean;
  alcance: "laboratorio" | "producto";
}

interface LabCampoDetalle {
  id: string;
  nombre: string;
  tipo_dato: string;
  opciones_lista: string[] | null;
  requerido: boolean;
  considerar_filtro: boolean;
  orden: number;
  activo: boolean;
  alcance: "laboratorio" | "producto";
  valor_entero: number | null;
  valor_booleano: boolean | null;
  valor_fecha: string | null;
  valor_texto: string | null;
}

interface UpsertLabCampoValor {
  definicion_id: string;
  valor_entero: number | null;
  valor_booleano: boolean | null;
  valor_fecha: string | null;
  valor_texto: string | null;
}

const TIPO_DATO_OPTIONS = [
  { value: "texto", label: "Texto" },
  { value: "entero", label: "Entero" },
  { value: "booleano", label: "Booleano" },
  { value: "fecha", label: "Fecha" },
  { value: "lista", label: "Lista" },
];

const TIPO_DATO_BADGE: Record<string, string> = {
  texto: "badge-info",
  entero: "badge-warning",
  booleano: "badge-success",
  fecha: "badge-primary",
  lista: "badge-secondary",
};

// --- Component ---

export default function LabCamposTab() {
  const queryClient = useQueryClient();

  // --- Form state ---
  const [formNombre, setFormNombre] = useState("");
  const [formTipoDato, setFormTipoDato] = useState("texto");
  const [formOpciones, setFormOpciones] = useState("");
  const [formRequerido, setFormRequerido] = useState(false);
  const [formConsiderarFiltro, setFormConsiderarFiltro] = useState(false);
  const [formOrden, setFormOrden] = useState(0);
  const [formAlcance, setFormAlcance] = useState<"laboratorio" | "producto">("laboratorio");
  const [editId, setEditId] = useState<string | null>(null);

  // --- Value form state ---
  const [valores, setValores] = useState<Record<string, UpsertLabCampoValor>>({});

  // --- Queries ---
  const { data: definiciones = [], isLoading: loadingDefs } = useQuery({
    queryKey: ["lab-campos"],
    queryFn: () =>
      api.get<LabCampoDefinicion[]>("/admin/lab-campos").then((r) => r.data),
  });

  const { data: detalles = [] } = useQuery<LabCampoDetalle[]>({
    queryKey: ["lab-campos-valores"],
    queryFn: () =>
      api.get<LabCampoDetalle[]>("/admin/lab-campos/valores").then((r) => r.data),
  });

  useEffect(() => {
    if (detalles.length > 0) {
      const map: Record<string, UpsertLabCampoValor> = {};
      detalles.forEach((d) => {
        map[d.id] = {
          definicion_id: d.id,
          valor_entero: d.valor_entero ?? null,
          valor_booleano: d.valor_booleano ?? null,
          valor_fecha: d.valor_fecha ?? null,
          valor_texto: d.valor_texto ?? null,
        };
      });
      setValores(map);
    }
  }, [detalles]);

  // --- Mutations ---
  const createMutation = useMutation({
    mutationFn: (payload: {
      nombre: string;
      tipo_dato: string;
      opciones_lista: string[] | null;
      requerido: boolean;
      considerar_filtro: boolean;
      orden: number;
      alcance: "laboratorio" | "producto";
    }) => api.post("/admin/lab-campos", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lab-campos"] });
      queryClient.invalidateQueries({ queryKey: ["lab-campos-valores"] });
      resetForm();
      notify.success("Campo creado");
    },
    onError: () => notify.error("Error al crear campo"),
  });

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      ...payload
    }: {
      id: string;
      nombre?: string;
      tipo_dato?: string;
      opciones_lista?: string[] | null;
      requerido?: boolean;
      considerar_filtro?: boolean;
      orden?: number;
      activo?: boolean;
      alcance?: "laboratorio" | "producto";
    }) => api.put(`/admin/lab-campos/${id}`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lab-campos"] });
      queryClient.invalidateQueries({ queryKey: ["lab-campos-valores"] });
      resetForm();
      notify.success("Campo actualizado");
    },
    onError: () => notify.error("Error al actualizar campo"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/lab-campos/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lab-campos"] });
      queryClient.invalidateQueries({ queryKey: ["lab-campos-valores"] });
      notify.success("Campo eliminado");
    },
    onError: () => notify.error("Error al eliminar campo"),
  });

  const saveValoresMutation = useMutation({
    mutationFn: (payload: UpsertLabCampoValor[]) =>
      api.put("/admin/lab-campos/valores", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lab-campos-valores"] });
      notify.success("Valores guardados");
    },
    onError: () => notify.error("Error al guardar valores"),
  });

  // --- Handlers ---
  function resetForm() {
    setFormNombre("");
    setFormTipoDato("texto");
    setFormOpciones("");
    setFormRequerido(false);
    setFormConsiderarFiltro(false);
    setFormOrden(0);
    setFormAlcance("laboratorio");
    setEditId(null);
  }

  function handleEdit(def: LabCampoDefinicion) {
    setEditId(def.id);
    setFormNombre(def.nombre);
    setFormTipoDato(def.tipo_dato);
    setFormOpciones(
      Array.isArray(def.opciones_lista) ? def.opciones_lista.join(", ") : ""
    );
    setFormRequerido(def.requerido);
    setFormConsiderarFiltro(def.considerar_filtro);
    setFormOrden(def.orden);
    setFormAlcance(def.alcance);
  }

  function handleDelete(id: string) {
    if (!window.confirm("Eliminar este campo? Los valores asociados tambien se eliminaran.")) return;
    deleteMutation.mutate(id);
  }

  function handleSubmitDef(e: React.FormEvent) {
    e.preventDefault();
    if (!formNombre.trim()) {
      notify.error("El nombre es requerido");
      return;
    }

    const opcionesParsed =
      formTipoDato === "lista" && formOpciones.trim()
        ? formOpciones
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : null;

    const base = {
      nombre: formNombre.trim(),
      tipo_dato: formTipoDato,
      opciones_lista: opcionesParsed,
      requerido: formRequerido,
      considerar_filtro: formConsiderarFiltro,
      orden: formOrden,
      alcance: formAlcance,
    };

    if (editId) {
      updateMutation.mutate({ id: editId, ...base });
    } else {
      createMutation.mutate(base);
    }
  }

  function handleValorChange(defId: string, field: keyof UpsertLabCampoValor, value: unknown) {
    setValores((prev) => ({
      ...prev,
      [defId]: {
        ...prev[defId],
        definicion_id: defId,
        [field]: value,
      },
    }));
  }

  function handleSaveValores() {
    const payload = Object.values(valores);
    saveValoresMutation.mutate(payload);
  }

  // --- Render helpers ---
  function renderValorInput(det: LabCampoDetalle) {
    const v = valores[det.id];
    if (!v) return null;

    switch (det.tipo_dato) {
      case "texto":
        return (
          <input
            type="text"
            className="input input-bordered input-sm w-full"
            value={v.valor_texto ?? ""}
            onChange={(e) => handleValorChange(det.id, "valor_texto", e.target.value || null)}
          />
        );
      case "entero":
        return (
          <input
            type="number"
            className="input input-bordered input-sm w-full"
            value={v.valor_entero ?? ""}
            onChange={(e) =>
              handleValorChange(
                det.id,
                "valor_entero",
                e.target.value ? parseInt(e.target.value, 10) : null
              )
            }
          />
        );
      case "booleano":
        return (
          <input
            type="checkbox"
            className="toggle toggle-primary toggle-sm"
            checked={v.valor_booleano ?? false}
            onChange={(e) => handleValorChange(det.id, "valor_booleano", e.target.checked)}
          />
        );
      case "fecha":
        return (
          <input
            type="date"
            className="input input-bordered input-sm w-full"
            value={v.valor_fecha ?? ""}
            onChange={(e) => handleValorChange(det.id, "valor_fecha", e.target.value || null)}
          />
        );
      case "lista": {
        const opts = Array.isArray(det.opciones_lista) ? det.opciones_lista : [];
        return (
          <select
            className="select select-bordered select-sm w-full"
            value={v.valor_texto ?? ""}
            onChange={(e) => handleValorChange(det.id, "valor_texto", e.target.value || null)}
          >
            <option value="">-- Seleccionar --</option>
            {opts.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        );
      }
      default:
        return null;
    }
  }

  if (loadingDefs) {
    return (
      <div className="flex justify-center py-12">
        <span className="loading loading-spinner loading-md" />
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-fade-in">
      {/* ── SECTION A: DEFINITIONS ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Form card */}
        <div className="lg:col-span-1">
          <div className="card bg-base-200/50 border border-base-200 p-4 rounded-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold uppercase tracking-wider text-base-content/60">
                {editId ? "Editar Campo" : "Nuevo Campo"}
              </h3>
              {editId && (
                <button
                  type="button"
                  className="btn btn-ghost btn-xs"
                  onClick={resetForm}
                >
                  <X className="h-3 w-3" />
                  Cancelar
                </button>
              )}
            </div>

            <form onSubmit={handleSubmitDef} className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-medium">Nombre</label>
                <input
                  type="text"
                  className="input input-bordered input-sm w-full"
                  placeholder="Ej: Numero de Lote"
                  value={formNombre}
                  onChange={(e) => setFormNombre(e.target.value)}
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium">Tipo de Dato</label>
                <select
                  className="select select-bordered select-sm w-full"
                  value={formTipoDato}
                  onChange={(e) => setFormTipoDato(e.target.value)}
                >
                  {TIPO_DATO_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium">Alcance</label>
                <select
                  className="select select-bordered select-sm w-full"
                  value={formAlcance}
                  onChange={(e) => setFormAlcance(e.target.value as "laboratorio" | "producto")}
                >
                  <option value="laboratorio">Valor global del laboratorio</option>
                  <option value="producto">Atributo por producto (importable)</option>
                </select>
              </div>

              {formTipoDato === "lista" && (
                <div className="space-y-1">
                  <label className="text-xs font-medium">
                    Opciones (separadas por coma)
                  </label>
                  <input
                    type="text"
                    className="input input-bordered input-sm w-full"
                    placeholder="Opcion A, Opcion B, Opcion C"
                    value={formOpciones}
                    onChange={(e) => setFormOpciones(e.target.value)}
                  />
                </div>
              )}

              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    className="checkbox checkbox-primary checkbox-sm"
                    checked={formRequerido}
                    onChange={(e) => setFormRequerido(e.target.checked)}
                  />
                  <span className="text-xs font-medium">Requerido</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    className="checkbox checkbox-primary checkbox-sm"
                    checked={formConsiderarFiltro}
                    onChange={(e) => setFormConsiderarFiltro(e.target.checked)}
                  />
                  <span className="text-xs font-medium">Considerar en filtro</span>
                </label>

                <div className="space-y-1 flex-1">
                  <label className="text-xs font-medium">Orden</label>
                  <input
                    type="number"
                    className="input input-bordered input-sm w-full"
                    value={formOrden}
                    onChange={(e) => setFormOrden(parseInt(e.target.value, 10) || 0)}
                  />
                </div>
              </div>

              <button
                type="submit"
                className={cn(
                  "btn btn-primary btn-sm w-full mt-2",
                  (createMutation.isPending || updateMutation.isPending) && "loading"
                )}
                disabled={createMutation.isPending || updateMutation.isPending}
              >
                {!createMutation.isPending && !updateMutation.isPending && (
                  editId ? <Pencil className="h-3 w-3 mr-1" /> : <Plus className="h-3 w-3 mr-1" />
                )}
                {editId ? "Actualizar" : "Crear Campo"}
              </button>
            </form>
          </div>
        </div>

        {/* Definitions list */}
        <div className="lg:col-span-2">
          {definiciones.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-base-content/40">
              <Database className="h-10 w-10 mb-3" />
              <p className="text-sm font-medium">No hay campos definidos</p>
              <p className="text-xs">Crea uno usando el formulario a la izquierda</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table table-sm">
                <thead>
                  <tr className="text-xs text-base-content/60">
                    <th>Orden</th>
                    <th>Nombre</th>
                    <th>Tipo</th>
                    <th>Alcance</th>
                    <th>Req.</th>
                    <th>Filtro</th>
                    <th>Activo</th>
                    <th className="text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {definiciones
                    .slice()
                    .sort((a, b) => a.orden - b.orden)
                    .map((def) => (
                      <tr key={def.id} className="hover">
                        <td className="text-xs font-mono">{def.orden}</td>
                        <td className="text-sm font-medium">{def.nombre}</td>
                        <td>
                          <span
                            className={cn(
                              "badge badge-sm",
                              TIPO_DATO_BADGE[def.tipo_dato] ?? "badge-ghost"
                            )}
                          >
                            {def.tipo_dato}
                          </span>
                        </td>
                        <td>
                          <span className="badge badge-sm badge-outline">
                            {def.alcance === "producto" ? "Producto" : "Laboratorio"}
                          </span>
                        </td>
                        <td>
                          {def.requerido && (
                            <span className="badge badge-xs badge-warning">Req.</span>
                          )}
                        </td>
                        <td>
                          <span
                            className={cn(
                              "badge badge-xs",
                              def.considerar_filtro ? "badge-info" : "badge-ghost"
                            )}
                          >
                            {def.considerar_filtro ? "Si" : "No"}
                          </span>
                        </td>
                        <td>
                          <span
                            className={cn(
                              "badge badge-xs",
                              def.activo ? "badge-success" : "badge-ghost"
                            )}
                          >
                            {def.activo ? "Si" : "No"}
                          </span>
                        </td>
                        <td className="text-right">
                          <div className="flex justify-end gap-1">
                            <button
                              type="button"
                              className="btn btn-ghost btn-xs text-primary"
                              onClick={() => handleEdit(def)}
                              title="Editar"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost btn-xs text-error"
                              onClick={() => handleDelete(def.id)}
                              title="Eliminar"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ── SECTION B: VALUES ── */}
      {detalles.length > 0 && (
        <div>
          <h3 className="text-sm font-bold uppercase tracking-wider text-base-content/60 mb-4">
            Valores del Laboratorio
          </h3>
          <div className="card bg-base-100 border border-base-200 shadow-sm p-6 rounded-2xl">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {detalles.map((det) => (
                <div key={det.id} className="space-y-1">
                  <label className="text-xs font-medium text-base-content/70 flex items-center gap-1">
                    {det.nombre}
                    {det.requerido && (
                      <span className="text-error text-[10px]">*</span>
                    )}
                    <span
                      className={cn(
                        "badge badge-[10px]",
                        TIPO_DATO_BADGE[det.tipo_dato] ?? "badge-ghost"
                      )}
                    >
                      {det.tipo_dato}
                    </span>
                  </label>
                  {renderValorInput(det)}
                </div>
              ))}
            </div>
            <div className="mt-6 flex justify-end">
              <button
                type="button"
                className={cn(
                  "btn btn-primary btn-sm",
                  saveValoresMutation.isPending && "loading"
                )}
                disabled={saveValoresMutation.isPending}
                onClick={handleSaveValores}
              >
                {!saveValoresMutation.isPending && <Save className="h-3.5 w-3.5 mr-1" />}
                Guardar valores
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
