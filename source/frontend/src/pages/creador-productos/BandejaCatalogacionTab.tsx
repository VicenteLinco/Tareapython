import { useState } from "react";
import {
  Check,
  X,
  ShieldAlert,
  Sparkles,
  Tag,
  Layers,
  RefreshCw,
  AlertCircle,
  FileText,
} from "lucide-react";
import {
  useProductosQuarantine,
  useAprobarProductoQuarantine,
  useRechazarProductoQuarantine,
  useCategorias,
  useUnidadesBasicas,
  usePresentaciones,
} from "@/hooks/dominio";
import { notify } from "@/lib/notify";
import api from "@/lib/api";
import type { Producto } from "@/types";

function ProductSku({ productoId }: { productoId: string }) {
  const { data: presentaciones = [], isLoading } = usePresentaciones(productoId);
  if (isLoading) {
    return <span className="loading loading-spinner loading-xs opacity-30" />;
  }
  const activePres = presentaciones.find((p) => p.activa);
  const sku = activePres?.sku ?? "—";
  return <span className="font-mono">{sku}</span>;
}

export default function BandejaCatalogacionTab() {
  const {
    data: quarantinedProducts,
    isLoading,
    refetch,
    isFetching,
  } = useProductosQuarantine();
  const { data: categorias } = useCategorias();
  const { data: unidades } = useUnidadesBasicas();

  const aprobarMutation = useAprobarProductoQuarantine();
  const rechazarMutation = useRechazarProductoQuarantine();

  // Selected product for approval configuration
  const [selectedProduct, setSelectedProduct] = useState<Producto | null>(null);
  const [selectedCategoriaId, setSelectedCategoriaId] = useState<string>("");
  const [selectedControlLote, setSelectedControlLote] = useState<
    "simple" | "con_vto" | "trazable"
  >("con_vto");

  // New editable metadata fields
  const [nombre, setNombre] = useState<string>("");
  const [descripcion, setDescripcion] = useState<string>("");
  const [fabricante, setFabricante] = useState<string>("");
  const [unidadBaseId, setUnidadBaseId] = useState<string>("");
  const [presNombre, setPresNombre] = useState<string>("");
  const [presNombrePlural, setPresNombrePlural] = useState<string>("");
  const [presFactor, setPresFactor] = useState<string>("");
  const [ubicacion, setUbicacion] = useState<string>("");

  const [sku, setSku] = useState<string>("");

  const handleOpenApproveModal = async (product: Producto) => {
    setSelectedProduct(product);
    setSelectedCategoriaId(
      product.categoria_id ? String(product.categoria_id) : "",
    );
    setSelectedControlLote(
      (product.control_lote as "simple" | "con_vto" | "trazable") || "con_vto",
    );
    setNombre(product.nombre || "");
    setDescripcion(product.descripcion || "");
    setFabricante(product.fabricante || "");
    setUnidadBaseId(
      product.unidad_base_id ? String(product.unidad_base_id) : "",
    );
    setUbicacion(product.ubicacion || "");
    setSku("");
    setPresNombre("");
    setPresNombrePlural("");
    setPresFactor("");

    try {
      const res = await api.get<any[]>(`/productos/${product.id}/presentaciones`);
      const activePres = res.data.find((p) => p.activa) || res.data[0] || null;
      if (activePres) {
        setSku(activePres.sku || "");
        setPresNombre(activePres.nombre || "");
        setPresNombrePlural(activePres.nombre_plural || "");
        setPresFactor(activePres.factor_conversion ? String(activePres.factor_conversion) : "");
      }
    } catch (err) {
      console.error("Error loading presentations for approval config:", err);
    }
  };

  const handleConfirmApprove = () => {
    if (!selectedProduct) return;
    if (!nombre.trim()) {
      notify.error("El nombre del producto no puede estar vacío");
      return;
    }
    if (!selectedCategoriaId) {
      notify.error("Selecciona una categoría antes de aprobar");
      return;
    }
    if (!unidadBaseId) {
      notify.error("Selecciona una unidad de medida básica");
      return;
    }

    const payload: any = {
      nombre: nombre.trim(),
      descripcion: descripcion.trim() || null,
      categoria_id: Number(selectedCategoriaId),
      unidad_base_id: Number(unidadBaseId),
      control_lote: selectedControlLote,
      fabricante: fabricante.trim() || null,
      ubicacion: ubicacion.trim() || null,
    };

    // Presentation logic
    if (presNombre.trim() || presNombrePlural.trim() || presFactor.trim()) {
      payload.pres_nombre = presNombre.trim() || null;
      payload.pres_nombre_plural = presNombrePlural.trim() || null;
      if (presFactor.trim()) {
        const factor = Number(presFactor);
        if (isNaN(factor) || factor <= 0) {
          notify.error("El factor de conversión debe ser un número mayor a 0");
          return;
        }
        payload.pres_factor = factor;
      } else {
        notify.error(
          "Debes indicar el factor de conversión si defines una presentación",
        );
        return;
      }
    } else {
      payload.pres_nombre = null;
      payload.pres_nombre_plural = null;
      payload.pres_factor = null;
    }

    aprobarMutation.mutate(
      {
        id: selectedProduct.id,
        payload,
      },
      {
        onSuccess: () => {
          setSelectedProduct(null);
          refetch();
        },
      },
    );
  };

  // Rejection modal state
  const [productToReject, setProductToReject] = useState<Producto | null>(null);
  const [rejectReason, setRejectReason] = useState<string>("");

  const handleOpenRejectModal = (product: Producto) => {
    setProductToReject(product);
    setRejectReason("");
  };

  const handleConfirmReject = () => {
    if (!productToReject) return;
    rechazarMutation.mutate(productToReject.id, {
      onSuccess: () => {
        setProductToReject(null);
        setRejectReason("");
        refetch();
      },
    });
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <span className="loading loading-spinner loading-lg text-primary" />
        <p className="text-sm opacity-50">
          Cargando bandeja de catalogación...
        </p>
      </div>
    );
  }

  const getOrigenBadge = (origen: string) => {
    switch (origen) {
      case "api_regulatoria":
        return (
          <span className="badge badge-primary badge-sm gap-1">
            <Sparkles className="h-3 w-3" /> API Salud
          </span>
        );
      case "guia_pdf":
        return (
          <span className="badge badge-secondary badge-sm gap-1">
            <Tag className="h-3 w-3" /> Guía PDF
          </span>
        );
      default:
        return <span className="badge badge-ghost badge-sm">Manual</span>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Overview stats header */}
      <div className="flex items-center justify-between border-b pb-4">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2 text-warning">
            <ShieldAlert className="h-5 w-5" />
            Bandeja de Catalogación (Cuarentena)
          </h2>
          <p className="text-xs opacity-60">
            Productos creados por canales automatizados que requieren revisión
            clínica y aprobación.
          </p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="btn btn-sm btn-ghost gap-1"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`}
          />
          Refrescar
        </button>
      </div>

      {quarantinedProducts?.length === 0 ? (
        <div className="card border bg-base-100 flex flex-col items-center justify-center p-12 text-center gap-3">
          <Check className="h-12 w-12 text-success opacity-80" />
          <h3 className="font-bold text-base">¡Bandeja vacía!</h3>
          <p className="text-xs opacity-60 max-w-sm">
            No hay productos pendientes de catalogación. Todos los registros
            automáticos están aprobados y sus existencias liberadas.
          </p>
        </div>
      ) : (
        <div className="border rounded-lg bg-base-100 overflow-x-auto">
          <table className="table w-full text-xs">
            <thead>
              <tr>
                <th>Producto</th>
                <th>SKU/REF</th>
                <th>Código Interno</th>
                <th>Origen</th>
                <th>Creado en</th>
                <th className="text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {quarantinedProducts?.map((product) => (
                <tr key={product.id} className="hover">
                  <td className="font-semibold">{product.nombre}</td>
                  <td>
                    <ProductSku productoId={product.id} />
                  </td>
                  <td>
                    <span className="font-mono">
                      {product.codigo_interno || "—"}
                    </span>
                  </td>
                  <td>{getOrigenBadge(product.origen_registro)}</td>
                  <td>{new Date(product.created_at).toLocaleString()}</td>
                  <td className="text-right">
                    <div className="flex justify-end gap-1">
                      <button
                        onClick={() => handleOpenApproveModal(product)}
                        className="btn btn-xs btn-success gap-1 font-semibold"
                      >
                        <Check className="h-3 w-3" />
                        Configurar y Aprobar
                      </button>
                      <button
                        onClick={() => handleOpenRejectModal(product)}
                        disabled={rechazarMutation.isPending}
                        className="btn btn-xs btn-error btn-outline btn-circle"
                        title="Rechazar y Eliminar"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Rejection Dialog Modal */}
      {productToReject && (
        <div className="modal modal-open">
          <div className="modal-box max-w-md bg-base-100 border border-base-300">
            <h3 className="font-bold text-base flex items-center gap-2 text-error">
              <X className="h-5 w-5" />
              Rechazar Producto en Cuarentena
            </h3>
            <p className="text-xs opacity-70 mt-1">
              ¿Estás seguro de que deseas rechazar el producto "
              <strong>{productToReject.nombre}</strong>"?
            </p>

            <div className="form-control mt-4">
              <label className="label py-1">
                <span className="label-text text-xs font-semibold">
                  Motivo de rechazo (opcional)
                </span>
              </label>
              <textarea
                className="textarea textarea-bordered textarea-sm w-full bg-base-100 border-base-300 focus:border-error text-xs"
                rows={3}
                placeholder="Ejemplo: Insumo duplicado, especificación no cumple estándar de laboratorio..."
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
              />
            </div>

            <div className="modal-action mt-6">
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setProductToReject(null)}
                disabled={rechazarMutation.isPending}
              >
                Cancelar
              </button>
              <button
                className="btn btn-error btn-sm px-5 gap-1"
                onClick={handleConfirmReject}
                disabled={rechazarMutation.isPending}
              >
                {rechazarMutation.isPending ? (
                  <span className="loading loading-spinner loading-xs" />
                ) : (
                  <>
                    <X className="h-4 w-4" />
                    Confirmar Rechazo
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Approve and Configure Dialog Modal */}
      {selectedProduct && (
        <div className="modal modal-open">
          <div className="modal-box max-w-4xl bg-base-100 border border-base-300">
            <h3 className="font-bold text-base flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-success" />
              Aprobar Producto en Catalogación
            </h3>
            <p className="text-xs opacity-60 mt-1">
              Asigna los metadatos necesarios para incorporar "
              {selectedProduct.nombre}" al catálogo aprobado.
            </p>

            <div className="space-y-4 py-4">
              {/* Product summary info */}
              <div className="bg-base-200 p-3 rounded-lg border border-base-300 text-xs space-y-1.5">
                <div>
                  <span className="opacity-50">SKU/REF:</span>{" "}
                  <strong className="font-mono">
                    {sku || "—"}
                  </strong>
                </div>
                <div>
                  <span className="opacity-50">Origen de registro:</span>{" "}
                  {getOrigenBadge(selectedProduct.origen_registro)}
                </div>
              </div>

              {/* Editable Fields Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Left Column */}
                <div className="space-y-4">
                  <h4 className="font-bold text-xs opacity-70 uppercase tracking-wider">
                    Información del Producto
                  </h4>

                  {/* Nombre */}
                  <div className="form-control">
                    <label className="label py-1">
                      <span className="label-text font-semibold">Nombre</span>
                    </label>
                    <input
                      type="text"
                      className="input input-bordered input-sm w-full bg-base-100 border-base-300 focus:border-primary"
                      value={nombre}
                      onChange={(e) => setNombre(e.target.value)}
                    />
                  </div>

                  {/* Fabricante */}
                  <div className="form-control">
                    <label className="label py-1">
                      <span className="label-text font-semibold">
                        Fabricante
                      </span>
                    </label>
                    <input
                      type="text"
                      className="input input-bordered input-sm w-full bg-base-100 border-base-300 focus:border-primary"
                      placeholder="e.g. Roche, Siemens"
                      value={fabricante}
                      onChange={(e) => setFabricante(e.target.value)}
                    />
                  </div>

                  {/* Categoría */}
                  <div className="form-control">
                    <label className="label py-1">
                      <span className="label-text font-semibold flex items-center gap-1">
                        <Tag className="h-3.5 w-3.5" />
                        Categoría
                      </span>
                    </label>
                    <select
                      className="select select-bordered select-sm w-full bg-base-100 border-base-300 focus:border-primary"
                      value={selectedCategoriaId}
                      onChange={(e) => setSelectedCategoriaId(e.target.value)}
                    >
                      <option value="" disabled>
                        Selecciona una categoría...
                      </option>
                      {categorias?.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.nombre}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Ubicación */}
                  <div className="form-control">
                    <label className="label py-1">
                      <span className="label-text font-semibold">
                        Ubicación
                      </span>
                    </label>
                    <input
                      type="text"
                      className="input input-bordered input-sm w-full bg-base-100 border-base-300 focus:border-primary"
                      placeholder="e.g. Estante B3"
                      value={ubicacion}
                      onChange={(e) => setUbicacion(e.target.value)}
                    />
                  </div>
                </div>

                {/* Right Column */}
                <div className="space-y-4">
                  <h4 className="font-bold text-xs opacity-70 uppercase tracking-wider">
                    Control y Presentación
                  </h4>

                  {/* Unidad Base */}
                  <div className="form-control">
                    <label className="label py-1">
                      <span className="label-text font-semibold">
                        Unidad Base
                      </span>
                    </label>
                    <select
                      className="select select-bordered select-sm w-full bg-base-100 border-base-300 focus:border-primary"
                      value={unidadBaseId}
                      onChange={(e) => setUnidadBaseId(e.target.value)}
                    >
                      <option value="" disabled>
                        Selecciona una unidad...
                      </option>
                      {unidades?.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.nombre} ({u.nombre_plural})
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Control Lote */}
                  <div className="form-control">
                    <label className="label py-1">
                      <span className="label-text font-semibold flex items-center gap-1">
                        <Layers className="h-3.5 w-3.5" />
                        Control de Lotes
                      </span>
                    </label>
                    <select
                      className="select select-bordered select-sm w-full bg-base-100 border-base-300 focus:border-primary"
                      value={selectedControlLote}
                      onChange={(e) =>
                        setSelectedControlLote(
                          e.target.value as "simple" | "con_vto" | "trazable",
                        )
                      }
                    >
                      <option value="con_vto">
                        Con Vencimiento (Recomendado reactivos)
                      </option>
                      <option value="simple">
                        Simple (Cantidad sin lotes detallados)
                      </option>
                      <option value="trazable">
                        Trazable completo (Serie y lotes estrictos)
                      </option>
                    </select>
                  </div>

                  {/* Presentation Subform */}
                  <div className="p-3 bg-base-200 border border-base-300 rounded-lg space-y-3">
                    <h5 className="font-bold text-[11px] opacity-70 flex items-center gap-1">
                      <Layers className="h-3.5 w-3.5 text-primary" />
                      Presentación de Compra (Opcional)
                    </h5>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                      <div className="form-control col-span-2">
                        <label className="label py-0.5">
                          <span className="text-[10px] font-semibold">
                            Nombre Presentación
                          </span>
                        </label>
                        <input
                          type="text"
                          className="input input-bordered input-xs w-full bg-base-100 border-base-300"
                          placeholder="e.g. Caja, Kit, Frasco"
                          value={presNombre}
                          onChange={(e) => setPresNombre(e.target.value)}
                        />
                      </div>

                      <div className="form-control">
                        <label className="label py-0.5">
                          <span className="text-[10px] font-semibold">
                            Plural
                          </span>
                        </label>
                        <input
                          type="text"
                          className="input input-bordered input-xs w-full bg-base-100 border-base-300"
                          placeholder="e.g. Cajas"
                          value={presNombrePlural}
                          onChange={(e) => setPresNombrePlural(e.target.value)}
                        />
                      </div>

                      <div className="form-control">
                        <label className="label py-0.5">
                          <span className="text-[10px] font-semibold">
                            Factor
                          </span>
                        </label>
                        <input
                          type="number"
                          step="any"
                          className="input input-bordered input-xs w-full bg-base-100 border-base-300"
                          placeholder="e.g. 10"
                          value={presFactor}
                          onChange={(e) => setPresFactor(e.target.value)}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Descripción */}
              <div className="form-control">
                <label className="label py-1">
                  <span className="label-text font-semibold flex items-center gap-1">
                    <FileText className="h-3.5 w-3.5" />
                    Descripción del Producto
                  </span>
                </label>
                <textarea
                  className="textarea textarea-bordered textarea-sm w-full bg-base-100 border-base-300 focus:border-primary"
                  rows={2}
                  placeholder="Descripción o detalles del insumo"
                  value={descripcion}
                  onChange={(e) => setDescripcion(e.target.value)}
                />
              </div>

              <div className="alert alert-warning text-xs mt-3 flex items-start gap-2 bg-warning/10 border-warning">
                <AlertCircle className="h-4 w-4 shrink-0 text-warning" />
                <span>
                  Al aprobar este producto, todo el stock cargado en cuarentena
                  se liberará inmediatamente para consumo. Si modifica el factor
                  de conversión, las existencias cargadas se escalarán
                  proporcionalmente.
                </span>
              </div>
            </div>

            <div className="modal-action">
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setSelectedProduct(null)}
                disabled={aprobarMutation.isPending}
              >
                Cancelar
              </button>
              <button
                className="btn btn-success btn-sm px-6 gap-1"
                onClick={handleConfirmApprove}
                disabled={aprobarMutation.isPending}
              >
                {aprobarMutation.isPending ? (
                  <span className="loading loading-spinner loading-xs" />
                ) : (
                  <>
                    <Check className="h-4 w-4" />
                    Aprobar y Liberar
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
