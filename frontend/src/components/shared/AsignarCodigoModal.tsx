import { useState, useRef, useEffect, useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Link, Check, Sparkles, Info } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import api from "@/lib/api";
import { parseApiError } from "@/lib/api-error";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";
import { parseGs1Client } from "@/pages/recepciones/recepcion-scan";
import type { Categoria, UnidadBasica, Area, Proveedor } from "@/types";

interface AsignarCodigoModalProps {
  codigo: string;
  productos: {
    id: string;
    nombre: string;
    codigo_interno: string | null;
    sku: string | null;
  }[];
  onClose: () => void;
  onAsignado: () => void;
  onCreadoYAsignado?: (
    prodId: string,
    lote: string,
    vencimiento: string,
  ) => void;
  proveedorId?: number | null;
}

export function AsignarCodigoModal({
  codigo,
  productos,
  onClose,
  onAsignado,
  onCreadoYAsignado,
  proveedorId,
}: AsignarCodigoModalProps) {
  const queryClient = useQueryClient();

  // Tabs: 'create' for Quick Product Creation, 'link' for linking to an existing product
  const [activeTab, setActiveTab] = useState<"create" | "link">("create");

  // Link to existing product states
  const [search, setSearch] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [selectedProducto, setSelectedProducto] = useState<{
    id: string;
    nombre: string;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  // Quick Create product states
  const [nombre, setNombre] = useState("");
  const [categoriaId, setCategoriaId] = useState("");
  const [unidadBaseId, setUnidadBaseId] = useState("");
  const [areaId, setAreaId] = useState("");
  const [localProveedorId, setLocalProveedorId] = useState(
    proveedorId ? String(proveedorId) : "",
  );
  const [fabricante, setFabricante] = useState("");

  const [refValue, setRefValue] = useState("");
  const [gtinValue, setGtinValue] = useState("");
  const [loteValue, setLoteValue] = useState("");
  const [vencimientoValue, setVencimientoValue] = useState("");

  // Parse code on mount/change
  const parsedCode = parseGs1Client(codigo);
  const isGs1 = !!parsedCode;
  const refValueFromScan = parsedCode?.ref;

  // Check if a product with this REF already exists in our supplier's catalog list
  const existingProductWithRef = refValueFromScan
    ? productos.find(
        (p) =>
          p.sku &&
          p.sku.toLowerCase().trim() === refValueFromScan.toLowerCase().trim(),
      )
    : null;

  const fetchFabricante = useCallback(async (code: string) => {
    try {
      const { data: res } = await api.get<any>("/productos/scan/lookup", {
        params: { codigo: code },
      });
      if (res.found && res.data) {
        if (res.data.fabricante) {
          setFabricante(res.data.fabricante);
        }
        if (res.data.nombre) {
          setNombre((prev) => prev || res.data.nombre);
        }
        if (res.data.sku_ref) {
          setRefValue((prev) => prev || res.data.sku_ref || "");
        }
      }
    } catch (err) {
      console.error("Error fetching manufacturer for code:", err);
    }
  }, []);

  useEffect(() => {
    if (parsedCode) {
      setGtinValue(parsedCode.gtin || "");
      setRefValue(parsedCode.ref || "");
      setLoteValue(parsedCode.lote || "");
      setVencimientoValue(parsedCode.vencimiento || "");
      if (parsedCode.gtin) {
        fetchFabricante(parsedCode.gtin);
      }
    } else {
      setGtinValue(codigo);
      setRefValue("");
      setLoteValue("");
      setVencimientoValue("");
      fetchFabricante(codigo);
    }
  }, [codigo, fetchFabricante]);

  // Queries for selectors
  const { data: categorias } = useQuery<Categoria[]>({
    queryKey: ["categorias"],
    queryFn: () => api.get("/categorias").then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });

  const { data: unidades } = useQuery<UnidadBasica[]>({
    queryKey: ["unidades-basicas"],
    queryFn: () => api.get("/unidades-basicas").then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });

  const { data: areas } = useQuery<Area[]>({
    queryKey: ["areas"],
    queryFn: () => api.get("/areas").then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });

  const { data: proveedores } = useQuery<Proveedor[]>({
    queryKey: ["proveedores"],
    queryFn: () => api.get("/proveedores").then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });

  // Sync provider ID if prop changes
  useEffect(() => {
    if (proveedorId) setLocalProveedorId(String(proveedorId));
  }, [proveedorId]);

  // Auto-select defaults
  useEffect(() => {
    if (unidades && unidades.length > 0 && !unidadBaseId) {
      // Pre-select "Unidad" or first unit
      const u =
        unidades.find(
          (x) =>
            x.nombre.toLowerCase().includes("unidad") ||
            x.nombre.toLowerCase().includes("u."),
        ) || unidades[0];
      setUnidadBaseId(String(u.id));
    }
  }, [unidades]);

  useEffect(() => {
    if (areas && areas.length > 0 && !areaId) {
      setAreaId(String(areas[0].id));
    }
  }, [areas]);

  // Filtering for linking
  const filtered = productos
    .filter(
      (p) =>
        p.nombre.toLowerCase().includes(search.toLowerCase()) ||
        (p.codigo_interno ?? "").toLowerCase().includes(search.toLowerCase()),
    )
    .slice(0, 10);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    if (activeIndex >= 0) {
      itemRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex]);

  useEffect(() => {
    setActiveIndex(-1);
  }, [search]);

  const handleSelect = useCallback((p: { id: string; nombre: string }) => {
    setSelectedProducto(p);
    setSearch(p.nombre);
    setDropdownOpen(false);
    setActiveIndex(-1);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!dropdownOpen) setDropdownOpen(true);
      setActiveIndex((i) => (i < filtered.length - 1 ? i + 1 : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i > 0 ? i - 1 : filtered.length - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIndex >= 0 && filtered[activeIndex]) {
        handleSelect(filtered[activeIndex]);
      }
    } else if (e.key === "Escape") {
      setDropdownOpen(false);
      setActiveIndex(-1);
    }
  };

  // Mutation to link to an existing product
  const asignarMut = useMutation({
    mutationFn: () =>
      api.post("/productos/scan/asignar", {
        codigo,
        producto_id: selectedProducto!.id,
      }),
    onSuccess: () => {
      notify.success(`Código asignado a ${selectedProducto!.nombre}`);
      onAsignado();
      onClose();
    },
    onError: (err) => notify.error(parseApiError(err)),
  });

  // Mutation to link to the detected product and immediately add it to reception
  const vincularYAgregarMut = useMutation({
    mutationFn: () =>
      api.post("/productos/scan/asignar", {
        codigo,
        producto_id: existingProductWithRef!.id,
      }),
    onSuccess: () => {
      notify.success("Código vinculado y producto añadido a la recepción");
      onCreadoYAsignado?.(
        existingProductWithRef!.id,
        loteValue.trim(),
        vencimientoValue,
      );
      onClose();
    },
    onError: (err) => notify.error(parseApiError(err)),
  });

  // Mutation to create a new product and presentation
  const crearProductoMut = useMutation({
    mutationFn: (data: any) => api.post("/productos", data),
    onSuccess: (res) => {
      notify.success("Producto creado y añadido a la recepción");
      queryClient.invalidateQueries({ queryKey: ["productos"] });

      const newProduct = res.data;
      onCreadoYAsignado?.(
        String(newProduct.id),
        loteValue.trim(),
        vencimientoValue,
      );
      onClose();
    },
    onError: (err) => notify.error(parseApiError(err)),
  });

  const handleSubmitLink = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProducto) {
      notify.error("Selecciona un producto de la lista");
      inputRef.current?.focus();
      return;
    }
    asignarMut.mutate();
  };

  const handleSubmitCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nombre.trim()) {
      notify.error("El nombre del producto es requerido");
      return;
    }
    if (!unidadBaseId) {
      notify.error("Selecciona una unidad base");
      return;
    }
    if (!areaId) {
      notify.error("Selecciona un área de destino");
      return;
    }

    const payload = {
      nombre: nombre.trim(),
      categoria_id: categoriaId ? Number(categoriaId) : undefined,
      unidad_base_id: Number(unidadBaseId),
      proveedor_id: localProveedorId ? Number(localProveedorId) : undefined,
      sku: refValue.trim() || undefined, // Store REF in SKU field
      area_ids: [Number(areaId)],
      control_lote: "con_vto", // Always require lot/vto for clinical lab scans
      fabricante: fabricante.trim() || undefined,
      pres_nombre: "Unidad",
      pres_nombre_plural: "Unidades",
      pres_factor: 1,
      pres_gtin: gtinValue.trim() || undefined,
      pres_codigo_barras: !isGs1 ? codigo.trim() : undefined,
      pres_gs1_habilitado: isGs1,
    };

    crearProductoMut.mutate(payload);
  };

  const handleLinkAndAdd = () => {
    vincularYAgregarMut.mutate();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="Código desconocido escaneado"
      className="max-w-2xl"
    >
      <div className="space-y-4">
        {/* Info panel of scanned barcode */}
        <div className="flex flex-col gap-1.5 p-3.5 bg-base-200 border border-base-300 rounded-2xl">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-widest text-base-content/40">
              Código escaneado
            </span>
            {isGs1 ? (
              <span className="badge badge-primary gap-1 py-1 text-[10px] font-semibold">
                <Sparkles className="h-3 w-3" /> GS1 DataMatrix
              </span>
            ) : (
              <span className="badge badge-ghost py-1 text-[10px] font-semibold border-base-300">
                Código simple
              </span>
            )}
          </div>
          <span className="font-mono text-sm font-bold text-primary break-all">
            {codigo}
          </span>

          {isGs1 && parsedCode && (
            <div className="mt-2.5 pt-2.5 border-t border-base-300 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
              <div>
                <span className="opacity-50 font-medium">GTIN:</span>{" "}
                <span className="font-mono font-semibold">
                  {parsedCode.gtin}
                </span>
              </div>
              {parsedCode.ref && (
                <div>
                  <span className="opacity-50 font-medium">REF:</span>{" "}
                  <span className="font-mono font-semibold">
                    {parsedCode.ref}
                  </span>
                </div>
              )}
              {parsedCode.lote && (
                <div>
                  <span className="opacity-50 font-medium">
                    Lote detectado:
                  </span>{" "}
                  <span className="font-mono font-semibold badge badge-warning badge-outline text-[10px] h-4 py-0 px-1">
                    {parsedCode.lote}
                  </span>
                </div>
              )}
              {parsedCode.vencimiento && (
                <div>
                  <span className="opacity-50 font-medium">Vencimiento:</span>{" "}
                  <span className="font-mono font-semibold text-warning">
                    {parsedCode.vencimiento}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* PROMINENT DETECTED MATCH PATH (IF PRODUCT EXISTS BY REF) */}
        {existingProductWithRef ? (
          <div className="p-4 bg-primary/10 border border-primary/25 rounded-2xl space-y-3">
            <div className="flex items-start gap-2.5">
              <Sparkles className="h-5 w-5 text-primary shrink-0 mt-0.5" />
              <div>
                <h4 className="font-bold text-sm text-primary">
                  ¡Insumo existente detectado por REF!
                </h4>
                <p className="text-xs text-base-content/70 mt-0.5">
                  El código de catálogo{" "}
                  <strong className="font-mono">{refValueFromScan}</strong> ya
                  pertenece a un producto en tu sistema. Puedes vincular esta
                  presentación (nuevo código de barras) y agregarlo
                  directamente:
                </p>
                <p className="text-sm font-bold mt-2 text-base-content">
                  {existingProductWithRef.nombre}
                </p>
                {existingProductWithRef.codigo_interno && (
                  <span className="text-[10px] font-mono opacity-50">
                    Código interno: #{existingProductWithRef.codigo_interno}
                  </span>
                )}
              </div>
            </div>

            <div className="p-3 bg-base-100 rounded-xl border border-base-200 grid grid-cols-2 gap-3">
              <div className="form-control">
                <label className="label py-0">
                  <span className="label-text text-[10px] font-bold text-base-content/50 uppercase">
                    Lote
                  </span>
                </label>
                <input
                  type="text"
                  className="input input-bordered input-sm h-8 w-full bg-base-100 font-mono text-xs"
                  value={loteValue}
                  onChange={(e) => setLoteValue(e.target.value)}
                />
              </div>
              <div className="form-control">
                <label className="label py-0">
                  <span className="label-text text-[10px] font-bold text-base-content/50 uppercase">
                    Vencimiento
                  </span>
                </label>
                <input
                  type="date"
                  className="input input-bordered input-sm h-8 w-full bg-base-100 font-mono text-xs"
                  value={vencimientoValue}
                  onChange={(e) => setVencimientoValue(e.target.value)}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-1.5">
              <button
                type="button"
                className="btn btn-ghost btn-sm text-xs opacity-50 hover:opacity-100"
                onClick={() => {
                  // Allow user to manually ignore match and go to creation/linking forms
                  // Clear REF search matching so they can see the default tabs
                  refValueFromScan &&
                    notify.info("Ignorando coincidencia automática de REF.");
                  parsedCode && (parsedCode.ref = undefined);
                }}
              >
                Ignorar coincidencia y crear/vincular otro
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm flex-1"
                onClick={handleLinkAndAdd}
                disabled={vincularYAgregarMut.isPending}
              >
                {vincularYAgregarMut.isPending ? (
                  <span className="loading loading-spinner loading-xs" />
                ) : (
                  <>
                    <Check className="h-3.5 w-3.5" />
                    Vincular y agregar a recepción
                  </>
                )}
              </button>
            </div>
          </div>
        ) : null}

        {/* DEFAULT TABBED VIEWS */}
        {!existingProductWithRef && (
          <>
            {/* Tab triggers */}
            <div className="tabs tabs-boxed bg-base-200 p-1 rounded-xl">
              <button
                type="button"
                className={cn(
                  "tab gap-2 rounded-lg transition-all flex-1 py-1.5 h-8 font-semibold text-xs",
                  activeTab === "create"
                    ? "tab-active bg-primary text-primary-content shadow-sm"
                    : "hover:bg-base-300",
                )}
                onClick={() => setActiveTab("create")}
              >
                <Plus className="w-3.5 h-3.5" />
                Crear Producto Rápido
              </button>
              <button
                type="button"
                className={cn(
                  "tab gap-2 rounded-lg transition-all flex-1 py-1.5 h-8 font-semibold text-xs",
                  activeTab === "link"
                    ? "tab-active bg-primary text-primary-content shadow-sm"
                    : "hover:bg-base-300",
                )}
                onClick={() => setActiveTab("link")}
              >
                <Link className="w-3.5 h-3.5" />
                Vincular a Existente
              </button>
            </div>

            {activeTab === "create" ? (
              /* QUICK PRODUCT CREATION FORM */
              <form onSubmit={handleSubmitCreate} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  {/* Product Name */}
                  <div className="form-control col-span-2">
                    <label className="label py-0.5">
                      <span className="label-text text-xs font-semibold">
                        Nombre del Producto
                      </span>
                      <span className="label-text-alt text-error text-[10px]">
                        requerido
                      </span>
                    </label>
                    <input
                      type="text"
                      className="input input-bordered input-sm h-9 w-full bg-base-100"
                      placeholder="Ej: Glucosa Liquicolor 2x250 ml"
                      value={nombre}
                      onChange={(e) => setNombre(e.target.value)}
                      autoFocus
                      required
                    />
                  </div>

                  {/* Fabricante */}
                  <div className="form-control">
                    <label className="label py-0.5">
                      <span className="label-text text-xs font-semibold">
                        Fabricante
                      </span>
                      <span className="label-text-alt text-base-content/40 text-[10px]">
                        opcional
                      </span>
                    </label>
                    <input
                      type="text"
                      className="input input-bordered input-sm h-9 w-full bg-base-100"
                      placeholder="Ej: Roche, Siemens"
                      value={fabricante}
                      onChange={(e) => setFabricante(e.target.value)}
                    />
                  </div>

                  {/* Categoría */}
                  <div className="form-control">
                    <label className="label py-0.5">
                      <span className="label-text text-xs font-semibold">
                        Categoría
                      </span>
                      <span className="label-text-alt text-base-content/40 text-[10px]">
                        opcional
                      </span>
                    </label>
                    <select
                      className="select select-bordered select-sm h-9 bg-base-100 w-full"
                      value={categoriaId}
                      onChange={(e) => setCategoriaId(e.target.value)}
                    >
                      <option value="">Sin categoría</option>
                      {categorias?.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.nombre}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Unidad Base */}
                  <div className="form-control">
                    <label className="label py-0.5">
                      <span className="label-text text-xs font-semibold">
                        Unidad Base
                      </span>
                      <span className="label-text-alt text-error text-[10px]">
                        requerido
                      </span>
                    </label>
                    <select
                      className="select select-bordered select-sm h-9 bg-base-100 w-full"
                      value={unidadBaseId}
                      onChange={(e) => setUnidadBaseId(e.target.value)}
                      required
                    >
                      <option value="">Seleccionar unidad...</option>
                      {unidades?.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.nombre}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Área de Destino */}
                  <div className="form-control">
                    <label className="label py-0.5">
                      <span className="label-text text-xs font-semibold">
                        Área de Destino
                      </span>
                      <span className="label-text-alt text-error text-[10px]">
                        requerido
                      </span>
                    </label>
                    <select
                      className="select select-bordered select-sm h-9 bg-base-100 w-full"
                      value={areaId}
                      onChange={(e) => setAreaId(e.target.value)}
                      required
                    >
                      <option value="">Seleccionar área...</option>
                      {areas?.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.nombre}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Proveedor */}
                  <div className="form-control col-span-2">
                    <label className="label py-0.5">
                      <span className="label-text text-xs font-semibold">
                        Proveedor
                      </span>
                      {proveedorId && (
                        <span className="label-text-alt text-primary text-[10px]">
                          asociado de la recepción
                        </span>
                      )}
                    </label>
                    <select
                      className="select select-bordered select-sm h-9 bg-base-100 w-full"
                      value={localProveedorId}
                      onChange={(e) => setLocalProveedorId(e.target.value)}
                      disabled={!!proveedorId}
                    >
                      <option value="">Sin proveedor</option>
                      {proveedores?.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.nombre}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* REF & GTIN */}
                  <div className="form-control">
                    <label className="label py-0.5">
                      <span className="label-text text-xs font-semibold">
                        Código REF (Catálogo)
                      </span>
                      <span className="label-text-alt text-base-content/40 text-[10px]">
                        {isGs1 ? "autodetectado" : "opcional"}
                      </span>
                    </label>
                    <input
                      type="text"
                      className="input input-bordered input-sm h-9 w-full bg-base-100 disabled:opacity-75 font-mono"
                      placeholder="REF del fabricante"
                      value={refValue}
                      onChange={(e) => setRefValue(e.target.value)}
                      disabled={isGs1 && !!parsedCode?.ref}
                    />
                  </div>

                  <div className="form-control">
                    <label className="label py-0.5">
                      <span className="label-text text-xs font-semibold">
                        GTIN / Código
                      </span>
                      <span className="label-text-alt text-base-content/40 text-[10px]">
                        {isGs1 ? "autodetectado" : "autocompletado"}
                      </span>
                    </label>
                    <input
                      type="text"
                      className="input input-bordered input-sm h-9 w-full bg-base-100 disabled:opacity-75 font-mono"
                      value={gtinValue}
                      onChange={(e) => setGtinValue(e.target.value)}
                      disabled={isGs1 && !!parsedCode?.gtin}
                    />
                  </div>

                  {/* Lote & Expiry Info for the Reception */}
                  <div className="col-span-2 mt-2 p-3 bg-primary/5 rounded-xl border border-primary/10 space-y-2">
                    <h4 className="text-xs font-bold text-primary flex items-center gap-1.5">
                      <Info className="h-3.5 w-3.5" /> Datos de recepción del
                      lote escaneado
                    </h4>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="form-control">
                        <label className="label py-0">
                          <span className="label-text text-[10px] font-bold text-base-content/50 uppercase">
                            Lote
                          </span>
                        </label>
                        <input
                          type="text"
                          className="input input-bordered input-sm h-8 w-full bg-base-100 font-mono text-xs"
                          placeholder="Lote"
                          value={loteValue}
                          onChange={(e) => setLoteValue(e.target.value)}
                        />
                      </div>
                      <div className="form-control">
                        <label className="label py-0">
                          <span className="label-text text-[10px] font-bold text-base-content/50 uppercase">
                            Vencimiento
                          </span>
                        </label>
                        <input
                          type="date"
                          className="input input-bordered input-sm h-8 w-full bg-base-100 font-mono text-xs"
                          value={vencimientoValue}
                          onChange={(e) => setVencimientoValue(e.target.value)}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t border-base-200">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={onClose}
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary btn-sm"
                    disabled={crearProductoMut.isPending}
                  >
                    {crearProductoMut.isPending ? (
                      <span className="loading loading-spinner loading-xs" />
                    ) : (
                      <>
                        <Plus className="h-3.5 w-3.5" />
                        Crear y añadir
                      </>
                    )}
                  </button>
                </div>
              </form>
            ) : (
              /* LINK TO EXISTING PRODUCT */
              <form onSubmit={handleSubmitLink} className="space-y-4">
                <div className="form-control">
                  <label className="label py-0.5">
                    <span className="label-text text-sm font-medium">
                      Producto
                    </span>
                    <span className="label-text-alt text-error text-[10px]">
                      requerido
                    </span>
                  </label>
                  <div ref={containerRef} className="relative">
                    <input
                      ref={inputRef}
                      type="text"
                      className="input input-bordered input-sm h-9 w-full"
                      placeholder="Buscar producto existente por nombre o código..."
                      value={search}
                      autoFocus
                      onChange={(e) => {
                        setSearch(e.target.value);
                        setSelectedProducto(null);
                        setDropdownOpen(true);
                      }}
                      onFocus={() => {
                        if (search) setDropdownOpen(true);
                      }}
                      onKeyDown={handleKeyDown}
                      aria-autocomplete="list"
                      aria-expanded={dropdownOpen && filtered.length > 0}
                    />
                    {dropdownOpen && filtered.length > 0 && (
                      <div
                        className="absolute top-full left-0 right-0 mt-1 z-50 bg-base-100 border border-base-200 rounded-xl shadow-lg overflow-y-auto max-h-60"
                        role="listbox"
                      >
                        {filtered.map((p, idx) => (
                          <div
                            key={p.id}
                            ref={(el) => {
                              itemRefs.current[idx] = el;
                            }}
                            role="option"
                            aria-selected={idx === activeIndex}
                            className={cn(
                              "flex items-center justify-between px-3 py-2 cursor-pointer text-sm transition-colors",
                              idx === activeIndex
                                ? "bg-primary/10 text-primary"
                                : "hover:bg-base-200/60",
                            )}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              handleSelect(p);
                            }}
                          >
                            <span className="font-medium truncate">
                              {p.nombre}
                            </span>
                            {p.codigo_interno && (
                              <span className="text-[10px] font-mono opacity-40 shrink-0 ml-2">
                                #{p.codigo_interno}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <p className="text-[10px] text-base-content/40 mt-1">
                    Al vincular, el código quedará registrado en este producto y
                    podrás escanearlo directamente en el futuro.
                  </p>
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t border-base-200">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={onClose}
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary btn-sm"
                    disabled={!selectedProducto || asignarMut.isPending}
                  >
                    {asignarMut.isPending ? (
                      <span className="loading loading-spinner loading-xs" />
                    ) : (
                      <>
                        <Link className="h-3.5 w-3.5" />
                        Vincular código
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
