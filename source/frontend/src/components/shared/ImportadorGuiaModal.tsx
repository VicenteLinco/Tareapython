import { useState, useEffect, useMemo } from "react";
import {
  X,
  Sparkles,
  AlertTriangle,
  Trash2,
  Loader2,
  FileText,
  Upload,
  Camera,
  Image as ImageIcon,
  Eye,
} from "lucide-react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { v4 as uuidv4 } from "uuid";
import api from "@/lib/api";
import { notify } from "@/lib/notify";
import { parseApiError } from "@/lib/api-error";
import {
  useAreas,
  useCategorias,
  useUnidadesBasicas,
  useCrearArea,
  useCrearCategoria,
  useCrearUnidad,
} from "@/hooks/dominio";
import { parseGuiaImagen, parseGuia } from "@/api/recepciones";
import { APP_LOCALE } from "@/lib/utils";
import { parseConfiguredAiModels } from "./ai-model-options";
import {
  validateImportedGuideItem,
  normalizeImportedDate,
  parseCurrencyInput,
} from "./importador-guia-validation";

export interface ParsedItem {
  nombre_producto: string;
  sku_ref: string;
  lote: string | null;
  fecha_vencimiento: string | null;
  cantidad: number;
  precio_unitario: number | null;
  control_lote?: "trazable" | "con_vto" | "simple";
  // Per-item overrides for new products (no global defaults)
  area_id?: number;
  categoria_id?: number;
  unidad_base_id?: number;
  // null = usar toggle general
  quarantine_override?: boolean | null;
}

interface ImportadorGuiaModalProps {
  open: boolean;
  onClose: () => void;
  proveedorId: number | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onImport: (itemsToAdd: any[], proveedorDetectado?: string, archivoUrl?: string | null) => void;
}

export default function ImportadorGuiaModal({
  open,
  onClose,
  onImport,
}: ImportadorGuiaModalProps) {
  const queryClient = useQueryClient();
  const { data: areas } = useAreas();
  const { data: categorias } = useCategorias();
  const { data: unidades } = useUnidadesBasicas();

  const crearAreaMutation = useCrearArea();
  const crearCategoriaMutation = useCrearCategoria();
  const crearUnidadMutation = useCrearUnidad();

  const handleAddNuevaArea = async (index: number) => {
    const nombre = prompt("Ingrese el nombre de la nueva área:");
    if (!nombre || !nombre.trim()) return;

    try {
      const newArea = await crearAreaMutation.mutateAsync({
        nombre: nombre.trim(),
        es_bodega: false,
      });
      if (newArea && newArea.id) {
        handleUpdateItem(index, "area_id", newArea.id);
      }
    } catch (error) {
      // Error handled by mutation
    }
  };

  const handleAddNuevaCategoria = async (index: number) => {
    const nombre = prompt("Ingrese el nombre de la nueva categoría:");
    if (!nombre || !nombre.trim()) return;

    try {
      const newCat = await crearCategoriaMutation.mutateAsync({
        nombre: nombre.trim(),
        descripcion: null,
      });
      if (newCat && newCat.id) {
        handleUpdateItem(index, "categoria_id", newCat.id);
      }
    } catch (error) {
      // Error handled
    }
  };

  const handleAddNuevaUnidad = async (index: number) => {
    const nombre = prompt("Ingrese el nombre (singular) de la nueva unidad básica (ej: Reacción):");
    if (!nombre || !nombre.trim()) return;
    const nombrePlural = prompt("Ingrese el nombre (plural) de la nueva unidad básica (ej: Reacciones):") || `${nombre}s`;

    try {
      const newUnidad = await crearUnidadMutation.mutateAsync({
        nombre: nombre.trim(),
        nombre_plural: nombrePlural.trim(),
      });
      if (newUnidad && newUnidad.id) {
        handleUpdateItem(index, "unidad_base_id", newUnidad.id);
      }
    } catch (error) {
      // Error handled
    }
  };

  const [rawText, setRawText] = useState("");
  const [isParsing, setIsParsing] = useState(false);
  const [proveedorDetectado, setProveedorDetectado] = useState("");
  const [items, setItems] = useState<ParsedItem[]>([]);
  const [instruccionesAdicionales, setInstruccionesAdicionales] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);

  // Tab y upload de imagen
  const [activeTab, setActiveTab] = useState<"text" | "image">("text");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreviewUrl, setFilePreviewUrl] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [archivoUrl, setArchivoUrl] = useState<string | null>(null);
  const [selectedModelId, setSelectedModelId] = useState<string>("");
  const [lastParseError, setLastParseError] = useState<string>("");
  const [quarantineEnabled, setQuarantineEnabled] = useState(true);
  const [focusedPriceIndex, setFocusedPriceIndex] = useState<number | null>(null);

  const { data: configData } = useQuery<any>({
    queryKey: ["configuracion"],
    queryFn: () => api.get("/configuracion").then((res) => res.data),
    staleTime: 60000,
  });

  const configuredModelOptions = useMemo(
    () => parseConfiguredAiModels(configData?.ia_modelos_configurados),
    [configData?.ia_modelos_configurados],
  );

  useEffect(() => {
    if (selectedModelId && !configuredModelOptions.some((option) => option.id === selectedModelId)) {
      setSelectedModelId("");
    }
  }, [configuredModelOptions, selectedModelId]);

  // Load existing products to check for catalog matches
  const [existingSkus, setExistingSkus] = useState<Set<string>>(new Set());
  const [skuToPresentationMap, setSkuToPresentationMap] = useState<Map<string, any>>(
    new Map(),
  );

  useEffect(() => {
    if (open) {
      // Fetch presentations to build the SKU match set
      api
        .get<any[]>("/presentaciones")
        .then((res) => {
          const skus = new Set<string>();
          const map = new Map<string, any>();
          res.data.forEach((pres) => {
            if (pres.sku) {
              const cleaned = pres.sku.trim().toLowerCase();
              skus.add(cleaned);
              map.set(cleaned, pres);
            }
          });
          setExistingSkus(skus);
          setSkuToPresentationMap(map);
        })
        .catch((err) => {
          console.error("Error fetching presentations catalog for validation:", err);
        });
    }
  }, [open]);

  // Sync quarantine toggle from server config when modal opens
  useEffect(() => {
    if (open && configData?.quarantine_default !== undefined) {
      setQuarantineEnabled(configData.quarantine_default);
    }
  }, [open, configData?.quarantine_default]);

  useEffect(() => {
    return () => {
      if (filePreviewUrl) URL.revokeObjectURL(filePreviewUrl);
    };
  }, [filePreviewUrl]);

  const initializeParsedItems = (parsedItems: ParsedItem[]): ParsedItem[] => {
    return parsedItems.map((item) => {
      const normalizedVto = normalizeImportedDate(item.fecha_vencimiento);
      let control_lote: "trazable" | "con_vto" | "simple" = "con_vto";

      if (normalizedVto) {
        control_lote = "con_vto";
      } else if (item.lote && item.lote.trim()) {
        control_lote = "trazable";
      } else {
        control_lote = "simple";
      }

      let lote = item.lote ? item.lote.trim() : null;
      let fecha_vencimiento = normalizedVto;
      if (control_lote === "simple") {
        lote = null;
        fecha_vencimiento = null;
      }

      return {
        ...item,
        control_lote,
        lote,
        fecha_vencimiento,
      };
    });
  };

  const handleParse = async () => {
    if (!rawText.trim()) {
      notify.error("Por favor, pega el texto de la guía de despacho");
      return;
    }
    setIsParsing(true);
    setLastParseError("");
    try {
      const res = await parseGuia(
        rawText,
        selectedModelId || undefined,
        instruccionesAdicionales || undefined,
      );
      setProveedorDetectado(res.proveedor);
      setItems(initializeParsedItems(res.items || []));
      notify.success("Guía parseada con éxito");
    } catch (err) {
      const errMsg = parseApiError(err) || String(err);
      setLastParseError(errMsg);
      notify.error(errMsg);
    } finally {
      setIsParsing(false);
    }
  };

  const handleFileSelect = (file: File) => {
    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      notify.error("El archivo no puede superar 10 MB");
      return;
    }
    const allowedTypes = [
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/webp",
      "application/pdf",
    ];
    if (!allowedTypes.includes(file.type)) {
      notify.error("Solo se aceptan archivos JPG, PNG, WEBP o PDF");
      return;
    }
    setSelectedFile(file);
    if (file.type.startsWith("image/")) {
      setFilePreviewUrl(URL.createObjectURL(file));
    } else {
      setFilePreviewUrl(null);
    }
    setItems([]);
    setArchivoUrl(null);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFileSelect(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleParseImage = async () => {
    if (!selectedFile) {
      notify.error("Por favor, selecciona un archivo");
      return;
    }
    setIsParsing(true);
    setUploadProgress(0);
    setLastParseError("");
    try {
      const res = await parseGuiaImagen(
        selectedFile,
        (progress) => {
          setUploadProgress(progress);
        },
        selectedModelId || undefined,
        instruccionesAdicionales || undefined,
      );
      setProveedorDetectado(res.proveedor);
      setItems(initializeParsedItems(res.items || []));
      setArchivoUrl(res.archivo_url);
      notify.success(`Guía analizada con IA (${res.source})`);
    } catch (err) {
      const errMsg = parseApiError(err) || String(err);
      setLastParseError(errMsg);
      notify.error(errMsg);
    } finally {
      setIsParsing(false);
    }
  };

  // Check if a parsed item's SKU exists in the local catalog
  const doesSkuExist = (sku: string) => {
    if (!sku) return false;
    return existingSkus.has(sku.trim().toLowerCase());
  };

  // Row validation rules
  const validateItem = validateImportedGuideItem;

  // Check if any item in the grid has errors
  const hasErrors = useMemo(() => {
    return items.some((item) => {
      const errs = validateItem(item);
      if (Object.keys(errs).length > 0) return true;
      const skuExists = existingSkus.has(item.sku_ref?.trim().toLowerCase() || "");
      if (!skuExists && (!item.area_id || !item.unidad_base_id)) return true;
      return false;
    });
  }, [items, existingSkus]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleUpdateItem = (
    index: number,
    field: keyof ParsedItem,
    value: any,
  ) => {
    const updated = [...items];
    const updatedItem = {
      ...updated[index],
      [field]: value,
    };

    // Clear lote and vencimiento if control_lote is set to simple
    if (field === "control_lote" && value === "simple") {
      updatedItem.lote = null;
      updatedItem.fecha_vencimiento = null;
    }

    updated[index] = updatedItem;
    setItems(updated);
  };

  const handleRemoveItem = (index: number) => {
    const updated = [...items];
    updated.splice(index, 1);
    setItems(updated);
  };

  const handleConfirmImport = async () => {
    if (hasErrors) {
      notify.error("Corrige los campos en rojo antes de importar");
      return;
    }
    if (items.length === 0) {
      notify.error("No hay ítems para importar");
      return;
    }
    // Pre-validate all new products have required fields
    const missingFields = items.filter(
      (item) => !doesSkuExist(item.sku_ref) && (!item.area_id || !item.unidad_base_id),
    );
    if (missingFields.length > 0) {
      notify.error(
        `Los siguientes productos nuevos requieren Área y Unidad base: ${missingFields.map((i) => i.nombre_producto).join(", ")}`,
      );
      setIsParsing(false);
      return;
    }

    setIsParsing(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const finalItemsList: any[] = [];

      for (const item of items) {
        const cleanedSku = item.sku_ref.trim().toLowerCase();
        let product: any;
        let selectedPres: any = null;

        if (doesSkuExist(item.sku_ref)) {
          const presMatch = skuToPresentationMap.get(cleanedSku)!;
          const fullProductRes = await api.get(`/productos/${presMatch.producto_id}`);
          product = fullProductRes.data;

          const activePresentaciones = product.presentaciones || [];
          selectedPres = activePresentaciones.find((p: any) => p.id === presMatch.id) || activePresentaciones[0] || null;
        } else {
          const effectiveQuarantine =
            item.quarantine_override !== null && item.quarantine_override !== undefined
              ? item.quarantine_override
              : quarantineEnabled;

          // ─── Pre-crear producto ───
          const createPayload = {
            nombre: item.nombre_producto.trim(),
            unidad_base_id: Number(item.unidad_base_id),
            categoria_id: item.categoria_id
              ? Number(item.categoria_id)
              : undefined,
            area_ids: [Number(item.area_id)],
            control_lote: item.control_lote || "con_vto",
            estado_catalogo: effectiveQuarantine ? "pendiente_aprobacion" : "aprobado",
            origen_registro: "guia_pdf",
            presentaciones: [
              {
                nombre: "Unidad",
                nombre_plural: "Unidades",
                factor_conversion: 1,
                sku: item.sku_ref.trim(),
              }
            ],
          };

          const res = await api.post("/productos", createPayload);
          const rawProduct = res.data;

          const fullProductRes = await api.get(`/productos/${rawProduct.id}`);
          product = fullProductRes.data;

          const activePresentaciones = product.presentaciones || [];
          selectedPres = activePresentaciones[0] || null;

          existingSkus.add(cleanedSku);
          skuToPresentationMap.set(cleanedSku, {
            id: selectedPres?.id,
            producto_id: product.id,
            producto_nombre: product.nombre,
          });
        }

        const activePresentaciones = product.presentaciones || [];
        const pres = selectedPres || activePresentaciones[0] || null;
        const resolvedPrice = String(
          item.precio_unitario || pres?.precio_adquisicion || "",
        );

        // Use per-item area for new products, otherwise product's first area
        const itemAreaId = item.area_id || product.area_ids?.[0] || 1;

        const line = {
          id: uuidv4(),
          producto_id: String(product.id),
          producto_nombre: product.nombre,
          codigo_interno: product.codigo_interno || "",
          presentacion_id: pres?.id || null,
          presentacion_nombre: pres?.nombre || "Unidad",
          presentacion_nombre_plural: pres?.nombre_plural || "Unidades",
          cantidad_solicitada: null,
          factor_conversion: pres ? Number(pres.factor_conversion) : 1,
          unidad_base_nombre: product.unidad_base?.nombre || "Unidad",
          unidad_base_nombre_plural:
            product.unidad_base?.nombre_plural || "Unidades",
          area_destino_id: Number(itemAreaId),
          area_destino_nombre:
            areas?.find((a) => a.id === Number(itemAreaId))?.nombre || "",
          presentaciones: activePresentaciones,
          precio_unitario: resolvedPrice,
          precio_anterior: String(pres?.precio_adquisicion || ""),
          precio_base: String(pres?.precio_adquisicion || ""),
          imagen_url: product.imagen_url,
          lotes: [
            {
              id: uuidv4(),
              codigo_lote: item.lote || "",
              fecha_vencimiento: item.fecha_vencimiento || "",
              cantidad_presentacion: item.cantidad,
              incluir_etiqueta: false,
              cantidad_etiquetas: item.cantidad,
            },
          ],
          collapsed: false,
          control_lote: product.control_lote || "con_vto",
        };

        finalItemsList.push(line);
      }

      onImport(finalItemsList, proveedorDetectado, archivoUrl);
      queryClient.invalidateQueries({ queryKey: ["productos"] });
      notify.success("Ítems cargados en la recepción");
      onClose();
    } catch (err) {
      notify.error("Error al importar guía: " + parseApiError(err));
    } finally {
      setIsParsing(false);
    }
  };

  if (!open) return null;

  return (
    <div className="modal modal-open">
      <div className="modal-box w-[96vw] max-w-[98%] h-[90vh] flex flex-col p-0 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-6 py-4 shrink-0 bg-base-100">
          <div>
            <h3 className="font-bold text-lg flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              Importar Guía de Despacho
            </h3>
            <p className="text-xs opacity-60">
              Pega el texto o sube una imagen/PDF de la guía para extraer
              automáticamente productos, lotes y vencimientos.
            </p>
          </div>
          <button className="btn btn-sm btn-circle btn-ghost" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tab Bar */}
        <div className="flex border-b px-6 bg-base-100 shrink-0">
          <button
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${activeTab === "text" ? "border-primary text-primary" : "border-transparent text-base-content/50 hover:text-base-content/80"}`}
            onClick={() => setActiveTab("text")}
          >
            <FileText className="h-4 w-4 inline-block mr-1.5 -mt-0.5" />
            Pegar Texto
          </button>
          <button
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${activeTab === "image" ? "border-primary text-primary" : "border-transparent text-base-content/50 hover:text-base-content/80"}`}
            onClick={() => setActiveTab("image")}
          >
            <ImageIcon className="h-4 w-4 inline-block mr-1.5 -mt-0.5" />
            Subir Imagen / PDF
          </button>
        </div>

        {/* Content Container (Double Panel) */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left Panel */}
          <div className="w-1/4 min-w-[280px] max-w-[340px] border-r p-4 flex flex-col gap-4 overflow-y-auto">
            {activeTab === "text" ? (
              /* ── TEXT TAB ── */
              <>
                <div className="form-control flex-1">
                  <label className="label">
                    <span className="label-text font-semibold">
                      Pegar texto de la Guía:
                    </span>
                  </label>
                  <textarea
                    className="textarea textarea-bordered font-mono text-xs flex-1 min-h-[300px] resize-none"
                    placeholder="VALTEK S.A.&#10;Factura: 123456&#10;REF: V-1234  Reactivo PCR  10 unidades  Lote: L88291  Vence: 2027-12-31  Precio: 25000"
                    value={rawText}
                    onChange={(e) => setRawText(e.target.value)}
                  />
                </div>

                <div className="bg-base-200/50 p-2.5 rounded-lg border border-base-300 space-y-2 mb-3 text-xs">
                  <div className="flex justify-between items-center">
                    <span className="font-semibold text-base-content/85 text-[10px]">Modelo de IA (Opcional)</span>
                    {selectedModelId && (
                      <button
                        type="button"
                        className="text-[10px] text-error font-medium hover:underline"
                        onClick={() => {
                          setSelectedModelId("");
                        }}
                      >
                        Limpiar
                      </button>
                    )}
                  </div>
                  <div>
                    <select
                      className="select select-xs select-bordered w-full text-[11px]"
                      value={selectedModelId}
                      onChange={(e) => {
                        const id = e.target.value;
                        setSelectedModelId(id);
                      }}
                    >
                      <option value="">Por defecto (Guardado)</option>
                      {configuredModelOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="pt-1 border-t border-base-300/60">
                    <span className="font-semibold text-base-content/85 text-[10px] block mb-1">
                      Instrucciones para IA (Opcional):
                    </span>
                    <input
                      type="text"
                      className="input input-xs input-bordered w-full text-[11px]"
                      placeholder="Ej: La col 3 es precio, SKUs con REF-"
                      value={instruccionesAdicionales}
                      onChange={(e) => setInstruccionesAdicionales(e.target.value)}
                    />
                  </div>
                </div>

                <button
                  onClick={handleParse}
                  disabled={isParsing || !rawText.trim()}
                  className="btn btn-primary w-full"
                >
                  {isParsing ? (
                    <>
                      <Loader2 className="animate-spin h-4 w-4" />
                      Procesando con IA...
                    </>
                  ) : (
                    "Parsear Guía"
                  )}
                </button>
              </>
            ) : (
              /* ── IMAGE TAB ── */
              <>
                {!selectedFile ? (
                  <div
                    className={`flex-1 flex flex-col items-center justify-center border-2 border-dashed rounded-xl p-6 transition-colors cursor-pointer ${
                      isDragging
                        ? "border-primary bg-primary/5"
                        : "border-base-content/20 hover:border-primary/50"
                    }`}
                    onDrop={handleDrop}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onClick={() =>
                      document.getElementById("guia-file-input")?.click()
                    }
                  >
                    <Upload className="h-12 w-12 text-base-content/30 mb-3" />
                    <p className="text-sm font-semibold text-base-content/60 mb-1">
                      Arrastra y suelta aquí
                    </p>
                    <p className="text-xs text-base-content/40 mb-4">
                      JPG, PNG, WEBP o PDF — máx. 10 MB
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="btn btn-outline btn-sm gap-1.5"
                        onClick={(e) => {
                          e.stopPropagation();
                          document.getElementById("guia-file-input")?.click();
                        }}
                      >
                        <Upload className="h-3.5 w-3.5" />
                        Seleccionar archivo
                      </button>
                      <label
                        className="btn btn-outline btn-sm gap-1.5 cursor-pointer"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Camera className="h-3.5 w-3.5" />
                        Cámara
                        <input
                          type="file"
                          accept="image/*"
                          capture="environment"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handleFileSelect(file);
                          }}
                        />
                      </label>
                    </div>
                    <input
                      id="guia-file-input"
                      type="file"
                      accept="image/jpeg,image/png,image/webp,application/pdf"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleFileSelect(file);
                      }}
                    />
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col gap-3">
                    {/* Preview */}
                    <div className="flex-1 flex items-center justify-center bg-base-200/50 rounded-lg border overflow-hidden min-h-0">
                      {filePreviewUrl ? (
                        <img
                          src={filePreviewUrl}
                          alt="Preview de la guía"
                          className="max-w-full max-h-full object-contain"
                        />
                      ) : (
                        <div className="flex flex-col items-center gap-2 text-base-content/40">
                          <FileText className="h-16 w-16" />
                          <p className="text-sm font-semibold">
                            {selectedFile.name}
                          </p>
                          <p className="text-xs">
                            PDF — {(selectedFile.size / 1024 / 1024).toFixed(2)}{" "}
                            MB
                          </p>
                        </div>
                      )}
                    </div>

                    {/* File info & actions */}
                    <div className="flex items-center justify-between bg-base-200/30 rounded-lg p-2 border">
                      <div className="flex items-center gap-2 min-w-0">
                        <ImageIcon className="h-4 w-4 text-primary shrink-0" />
                        <span className="text-xs font-medium truncate">
                          {selectedFile.name}
                        </span>
                        <span className="text-[10px] text-base-content/40">
                          {(selectedFile.size / 1024).toFixed(0)} KB
                        </span>
                      </div>
                      <button
                        className="btn btn-ghost btn-xs text-error"
                        onClick={() => {
                          setSelectedFile(null);
                          setFilePreviewUrl(null);
                          setItems([]);
                          setArchivoUrl(null);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                )}


                <div className="bg-base-200/50 p-2.5 rounded-lg border border-base-300 space-y-2 mb-3 text-xs">
                  <div className="flex justify-between items-center">
                    <span className="font-semibold text-base-content/85 text-[10px]">Proveedor de IA (Opcional)</span>
                    {selectedModelId && (
                      <button
                        type="button"
                        className="text-[10px] text-error font-medium hover:underline"
                        onClick={() => {
                          setSelectedModelId("");
                        }}
                      >
                        Limpiar
                      </button>
                    )}
                  </div>
                  <div>
                      <select
                        className="select select-xs select-bordered w-full text-[11px]"
                        value={selectedModelId}
                        onChange={(e) => {
                          const id = e.target.value;
                          setSelectedModelId(id);
                        }}
                      >
                        <option value="">Por defecto (Guardado)</option>
                        {configuredModelOptions.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                  </div>
                  <div className="pt-1 border-t border-base-300/60">
                    <span className="font-semibold text-base-content/85 text-[10px] block mb-1">
                      Instrucciones para IA (Opcional):
                    </span>
                    <input
                      type="text"
                      className="input input-xs input-bordered w-full text-[11px]"
                      placeholder="Ej: La col 3 es precio, SKUs con REF-"
                      value={instruccionesAdicionales}
                      onChange={(e) => setInstruccionesAdicionales(e.target.value)}
                    />
                  </div>
                </div>

                <button
                  onClick={handleParseImage}
                  disabled={isParsing || !selectedFile}
                  className="btn btn-primary w-full"
                >
                  {isParsing ? (
                    <>
                      <Loader2 className="animate-spin h-4 w-4" />
                      Analizando con IA...
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4" />
                      Analizar con IA
                    </>
                  )}
                </button>
                {isParsing && (
                  <div className="w-full space-y-1 mt-3">
                    <div className="flex justify-between text-xs font-semibold px-1">
                      <span className="text-primary">
                        {uploadProgress < 100 ? "Subiendo archivo..." : "Analizando y extrayendo datos con IA..."}
                      </span>
                      <span className="text-primary">{uploadProgress}%</span>
                    </div>
                    <progress
                      className="progress progress-primary w-full h-2"
                      value={uploadProgress}
                      max="100"
                    ></progress>
                  </div>
                )}
                {lastParseError && (
                  <div className="mt-3 p-2 bg-base-200 border border-base-300 rounded text-xs text-base-content/85 flex items-start gap-2 justify-between">
                    <div className="flex-1 min-w-0">
                      <span className="font-semibold block text-error mb-0.5 text-[10px]">Error de Extracción:</span>
                      <p className="font-mono break-all line-clamp-3 select-all text-[10px]" title={lastParseError}>
                        {lastParseError}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="btn btn-xs btn-ghost text-primary text-[10px] h-auto min-h-0 py-1 px-1.5"
                      onClick={() => {
                        navigator.clipboard.writeText(lastParseError);
                        notify.success("Error copiado al portapapeles");
                      }}
                      title="Copiar error al portapapeles"
                    >
                      Copiar
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Right Panel: Parsed Grid */}
          <div className="flex-1 p-4 flex flex-col overflow-hidden">
            {items.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-base-content/40 gap-3">
                {activeTab === "text" ? (
                  <>
                    <FileText className="h-16 w-16 opacity-30" />
                    <p className="text-sm font-semibold">
                      Aún no se ha cargado información de guía.
                    </p>
                    <p className="text-xs max-w-sm text-center">
                      Copia el texto del PDF y haz clic en "Parsear Guía" para
                      ver los resultados aquí.
                    </p>
                  </>
                ) : (
                  <>
                    <ImageIcon className="h-16 w-16 opacity-30" />
                    <p className="text-sm font-semibold">
                      Aún no se ha analizado ninguna imagen.
                    </p>
                    <p className="text-xs max-w-sm text-center">
                      Sube una foto o PDF de la guía de despacho y haz clic en
                      "Analizar con IA" para ver los resultados aquí.
                    </p>
                  </>
                )}
              </div>
            ) : (
              <div className="flex-1 flex flex-col overflow-hidden gap-4">
                <div className="flex items-center justify-between shrink-0 bg-base-200/50 p-3 rounded-lg border">
                  <div className="flex items-center gap-3">
                    <div>
                      <span className="text-xs opacity-50">
                        Proveedor detectado:
                      </span>
                      <h4 className="font-bold text-sm text-primary">
                        {proveedorDetectado}
                      </h4>
                    </div>
                    {archivoUrl && (
                      <a
                        href={`${import.meta.env.VITE_API_URL || "/api/v1"}/uploads/${archivoUrl}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-ghost btn-xs gap-1"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        Ver original
                      </a>
                    )}
                  </div>
                  <span className="badge badge-outline">
                    {items.length} ítems encontrados
                  </span>
                </div>

                {/* General quarantine toggle */}
                <div className="flex items-center justify-between shrink-0 bg-base-200/20 px-3 py-2 rounded-lg border">
                  <span className="text-xs font-semibold flex items-center gap-2">
                    <AlertTriangle className="h-3.5 w-3.5 text-warning" />
                    Enviar productos nuevos a cuarentena
                  </span>
                  <input
                    type="checkbox"
                    className="toggle toggle-sm toggle-warning"
                    checked={quarantineEnabled}
                    onChange={(e) => setQuarantineEnabled(e.target.checked)}
                  />
                </div>

                {/* Batch default actions bar */}
                <div className="flex flex-wrap items-center justify-between shrink-0 bg-base-200/40 px-3 py-2 rounded-lg border text-xs gap-2">
                  <span className="font-semibold text-base-content/75">
                    Asignar por lote a ítems sin definir:
                  </span>
                  <div className="flex items-center gap-2 flex-wrap">
                    <select
                      className="select select-xs select-bordered text-[11px]"
                      defaultValue=""
                      onChange={(e) => {
                        if (e.target.value) {
                          const id = Number(e.target.value);
                          setItems((prev) => prev.map((item) => ({ ...item, area_id: item.area_id || id })));
                          notify.success("Área aplicada a ítems sin área");
                          e.target.value = "";
                        }
                      }}
                    >
                      <option value="" disabled>Aplicar Área a todos</option>
                      {areas?.map((a) => (
                        <option key={a.id} value={a.id}>{a.nombre}</option>
                      ))}
                    </select>

                    <select
                      className="select select-xs select-bordered text-[11px]"
                      defaultValue=""
                      onChange={(e) => {
                        if (e.target.value) {
                          const id = Number(e.target.value);
                          setItems((prev) => prev.map((item) => ({ ...item, categoria_id: item.categoria_id || id })));
                          notify.success("Categoría aplicada a ítems sin categoría");
                          e.target.value = "";
                        }
                      }}
                    >
                      <option value="" disabled>Aplicar Categoría a todos</option>
                      {categorias?.map((c) => (
                        <option key={c.id} value={c.id}>{c.nombre}</option>
                      ))}
                    </select>

                    <select
                      className="select select-xs select-bordered text-[11px]"
                      defaultValue=""
                      onChange={(e) => {
                        if (e.target.value) {
                          const id = Number(e.target.value);
                          setItems((prev) => prev.map((item) => ({ ...item, unidad_base_id: item.unidad_base_id || id })));
                          notify.success("Unidad aplicada a ítems sin unidad");
                          e.target.value = "";
                        }
                      }}
                    >
                      <option value="" disabled>Aplicar Unidad a todos</option>
                      {unidades?.map((u) => (
                        <option key={u.id} value={u.id}>{u.nombre}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Scrollable list of items */}
                <div className="flex-1 overflow-y-auto flex flex-col gap-3 pr-1">
                  {items.map((item, index) => {
                    const itemErrors = validateItem(item);
                    const isNewProduct = !doesSkuExist(item.sku_ref);
                    const cleanedSku = item.sku_ref?.trim().toLowerCase();
                    const product = skuToPresentationMap.get(cleanedSku);
                    const isSimple = item.control_lote === "simple";
                    const itemQuarantine =
                      item.quarantine_override !== null && item.quarantine_override !== undefined
                        ? item.quarantine_override
                        : quarantineEnabled;
                    return (
                      <div
                        key={index}
                        className="bg-base-200/30 border border-base-300 rounded-lg p-3 flex flex-col gap-3 relative hover:border-primary/40 transition-colors"
                      >
                        {/* Row 1: Index, Nombre Producto, Warning Badge, Delete Button */}
                        <div className="flex items-center gap-2">
                          <span className="badge badge-sm badge-neutral font-mono shrink-0">
                            #{index + 1}
                          </span>
                          <div className="flex-1">
                            <input
                              type="text"
                              className={`input input-bordered input-sm font-semibold w-full text-xs px-2 ${itemErrors.nombre_producto ? "input-error" : ""}`}
                              value={item.nombre_producto}
                              onChange={(e) =>
                                handleUpdateItem(
                                  index,
                                  "nombre_producto",
                                  e.target.value,
                                )
                              }
                              placeholder="Nombre del producto"
                            />
                            {itemErrors.nombre_producto && (
                              <p className="text-error text-[10px] mt-1">
                                El nombre del producto es obligatorio
                              </p>
                            )}
                          </div>
                          {isNewProduct && (
                            <span className={`badge badge-xs gap-1 py-2 px-2 shrink-0 select-none ${itemQuarantine ? "badge-warning" : "badge-success"}`}>
                              <AlertTriangle className="h-3 w-3" />
                              {itemQuarantine ? "Nuevo (Cuarentena)" : "Nuevo (Activo)"}
                            </span>
                          )}
                          <button
                            className="btn btn-ghost btn-xs text-error btn-circle shrink-0"
                            onClick={() => handleRemoveItem(index)}
                            title="Eliminar ítem"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>

                        {/* Row 2: Grid for inputs */}
                        <div className="grid grid-cols-2 md:grid-cols-6 gap-3 items-end">
                          {/* SKU */}
                          <div className="form-control w-full">
                            <label className="label py-0.5">
                              <span className="label-text text-[10px] uppercase font-bold opacity-60">
                                REF/SKU
                              </span>
                            </label>
                            <input
                              type="text"
                              className="input input-bordered input-sm text-xs px-2 w-full font-mono"
                              value={item.sku_ref}
                              onChange={(e) =>
                                handleUpdateItem(
                                  index,
                                  "sku_ref",
                                  e.target.value,
                                )
                              }
                              placeholder="REF/SKU"
                            />
                          </div>

                          {/* Control Lote */}
                          <div className="form-control w-full">
                            <label className="label py-0.5">
                              <span className="label-text text-[10px] uppercase font-bold opacity-60">
                                Control Lote
                              </span>
                            </label>
                            {isNewProduct ? (
                              <select
                                className="select select-bordered select-sm text-xs px-1.5 w-full bg-base-100 border-base-300 font-semibold"
                                value={item.control_lote || "con_vto"}
                                onChange={(e) =>
                                  handleUpdateItem(
                                    index,
                                    "control_lote",
                                    e.target.value,
                                  )
                                }
                              >
                                <option value="con_vto">Con Vto</option>
                                <option value="trazable">Trazable</option>
                                <option value="simple">Simple</option>
                              </select>
                            ) : (
                              <div className="h-8 flex items-center bg-base-200 border border-base-300 rounded px-2 text-xs font-semibold text-base-content/60 capitalize select-none">
                                {product?.control_lote === "con_vto"
                                  ? "Con Vto"
                                  : product?.control_lote === "trazable"
                                    ? "Trazable"
                                    : product?.control_lote === "simple"
                                      ? "Simple"
                                      : "Con Vto"}
                              </div>
                            )}
                          </div>

                          {/* Lote */}
                          <div className="form-control w-full">
                            <label className="label py-0.5">
                              <span className="label-text text-[10px] uppercase font-bold opacity-60">
                                Lote
                              </span>
                            </label>
                            <input
                              type="text"
                              className={`input input-bordered input-sm text-xs px-2 w-full ${itemErrors.lote ? "input-error border-error border-2" : ""}`}
                              value={isSimple ? "" : item.lote || ""}
                              onChange={(e) =>
                                handleUpdateItem(index, "lote", e.target.value)
                              }
                              placeholder={isSimple ? "No req." : "Requerido"}
                              disabled={isSimple}
                            />
                          </div>

                          {/* Vencimiento */}
                          <div className="form-control w-full">
                            <label className="label py-0.5">
                              <span className="label-text text-[10px] uppercase font-bold opacity-60">
                                Vencimiento
                              </span>
                            </label>
                            <input
                              type="text"
                              className={`input input-bordered input-sm text-xs px-2 w-full font-mono ${itemErrors.fecha_vencimiento ? "input-error border-error border-2" : ""}`}
                              value={
                                isSimple ? "" : item.fecha_vencimiento || ""
                              }
                              onChange={(e) =>
                                handleUpdateItem(
                                  index,
                                  "fecha_vencimiento",
                                  e.target.value,
                                )
                              }
                              placeholder={isSimple ? "No req." : "YYYY-MM-DD"}
                              disabled={isSimple}
                            />
                          </div>

                          {/* Cantidad */}
                          <div className="form-control w-full">
                            <label className="label py-0.5">
                              <span className="label-text text-[10px] uppercase font-bold opacity-60">
                                Cant.
                              </span>
                            </label>
                            <input
                              type="number"
                              className="input input-bordered input-sm text-xs px-2 w-full text-right font-semibold"
                              value={item.cantidad}
                              onChange={(e) =>
                                handleUpdateItem(
                                  index,
                                  "cantidad",
                                  Number(e.target.value),
                                )
                              }
                              placeholder="0"
                            />
                          </div>

                          {/* P. Unitario */}
                          <div className="form-control w-full">
                            <label className="label py-0.5">
                              <span className="label-text text-[10px] uppercase font-bold opacity-60">
                                P. Unitario
                              </span>
                            </label>
                            <input
                              type="text"
                              inputMode="numeric"
                              className="input input-bordered input-sm text-xs px-2 w-full text-right font-mono"
                              value={
                                focusedPriceIndex === index
                                  ? (item.precio_unitario || "")
                                  : item.precio_unitario != null
                                    ? item.precio_unitario.toLocaleString(APP_LOCALE)
                                    : ""
                              }
                              onFocus={() => setFocusedPriceIndex(index)}
                              onBlur={() => setFocusedPriceIndex(null)}
                              onChange={(e) => {
                                const parsedVal = parseCurrencyInput(e.target.value);
                                handleUpdateItem(
                                  index,
                                  "precio_unitario",
                                  parsedVal,
                                );
                              }}
                              placeholder="0"
                            />
                          </div>
                        </div>

                        {/* Row 3: Per-item area/categoria/unidad/cuarentena for new products */}
                        {isNewProduct && (
                          <div className="border-t border-base-300 pt-3 mt-1 grid grid-cols-1 sm:grid-cols-4 gap-2">
                            <div className="form-control">
                              <label className="label py-0.5">
                                <span className="label-text text-[10px] uppercase font-bold opacity-60">
                                  Área
                                </span>
                              </label>
                              <div className="flex gap-1">
                                <select
                                  className="select select-bordered select-xs flex-1"
                                  value={item.area_id || ""}
                                  onChange={(e) =>
                                    handleUpdateItem(
                                      index,
                                      "area_id",
                                      e.target.value ? Number(e.target.value) : undefined,
                                    )
                                  }
                                >
                                  <option value="">Seleccionar área...</option>
                                  {areas?.map((a) => (
                                    <option key={a.id} value={a.id}>
                                      {a.nombre}
                                    </option>
                                  ))}
                                </select>
                                <button
                                  type="button"
                                  className="btn btn-xs btn-outline shrink-0 font-bold px-1.5"
                                  onClick={() => handleAddNuevaArea(index)}
                                  title="Añadir nueva área"
                                >
                                  +
                                </button>
                              </div>
                            </div>
                            <div className="form-control">
                              <label className="label py-0.5">
                                <span className="label-text text-[10px] uppercase font-bold opacity-60">
                                  Categoría
                                </span>
                              </label>
                              <div className="flex gap-1">
                                <select
                                  className="select select-bordered select-xs flex-1"
                                  value={item.categoria_id || ""}
                                  onChange={(e) =>
                                    handleUpdateItem(
                                      index,
                                      "categoria_id",
                                      e.target.value ? Number(e.target.value) : undefined,
                                    )
                                  }
                                >
                                  <option value="">Sin categoría</option>
                                  {categorias?.map((c) => (
                                    <option key={c.id} value={c.id}>
                                      {c.nombre}
                                    </option>
                                  ))}
                                </select>
                                <button
                                  type="button"
                                  className="btn btn-xs btn-outline shrink-0 font-bold px-1.5"
                                  onClick={() => handleAddNuevaCategoria(index)}
                                  title="Añadir nueva categoría"
                                >
                                  +
                                </button>
                              </div>
                            </div>
                            <div className="form-control">
                              <label className="label py-0.5">
                                <span className="label-text text-[10px] uppercase font-bold opacity-60">
                                  Unidad base
                                </span>
                              </label>
                              <div className="flex gap-1">
                                <select
                                  className="select select-bordered select-xs flex-1"
                                  value={item.unidad_base_id || ""}
                                  onChange={(e) =>
                                    handleUpdateItem(
                                      index,
                                      "unidad_base_id",
                                      e.target.value ? Number(e.target.value) : undefined,
                                    )
                                  }
                                >
                                  <option value="">Seleccionar unidad...</option>
                                  {unidades?.map((u) => (
                                    <option key={u.id} value={u.id}>
                                      {u.nombre}
                                    </option>
                                  ))}
                                </select>
                                <button
                                  type="button"
                                  className="btn btn-xs btn-outline shrink-0 font-bold px-1.5"
                                  onClick={() => handleAddNuevaUnidad(index)}
                                  title="Añadir nueva unidad"
                                >
                                  +
                                </button>
                              </div>
                            </div>
                            <div className="form-control flex justify-end">
                              <label className="label py-0.5">
                                <span className="label-text text-[10px] uppercase font-bold opacity-60">
                                  Cuarentena
                                </span>
                              </label>
                              <div className="flex items-center gap-2 h-8">
                                <input
                                  type="checkbox"
                                  className="toggle toggle-xs toggle-warning"
                                  checked={itemQuarantine}
                                  onChange={(e) =>
                                    handleUpdateItem(
                                      index,
                                      "quarantine_override",
                                      e.target.checked,
                                    )
                                  }
                                />
                                <span className="text-[10px] font-semibold opacity-70">
                                  {itemQuarantine ? "Sí" : "No"}
                                </span>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t px-6 py-4 bg-base-100 shrink-0">
          <div className="text-xs text-error font-semibold">
            {hasErrors &&
              "⚠ Corrige los campos vacíos o malformados en la grilla."}
          </div>
          <div className="flex gap-2">
            <button
              className="btn btn-ghost btn-sm"
              onClick={onClose}
              disabled={isParsing}
            >
              Cancelar
            </button>
            <button
              onClick={handleConfirmImport}
              disabled={isParsing || items.length === 0 || hasErrors}
              className="btn btn-primary btn-sm px-6"
            >
              {isParsing ? (
                <>
                  <Loader2 className="animate-spin h-3.5 w-3.5" />
                  Importando...
                </>
              ) : (
                "Confirmar Importación"
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
