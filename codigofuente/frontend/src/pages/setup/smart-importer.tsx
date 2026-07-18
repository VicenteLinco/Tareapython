import { useState, useEffect } from "react";
import {
  FileUp,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  Table as TableIcon,
  ChevronLeft,
  X,
  Database,
  Info,
  Eye,
  PlusCircle,
  Search,
  Sliders,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { notify } from "@/lib/notify";
import api from "@/lib/api";

interface SmartImporterProps {
  onComplete: () => void;
  onCancel: () => void;
}

type Step = "UPLOAD" | "MAP" | "PREVIEW";
type ImportCellValue = string | number | boolean | null | undefined;
type ImportPreviewRow = Record<string, ImportCellValue>;
type ImportErrorRow = Record<string, ImportCellValue>;

interface LabCampoDefinicion {
  id: string;
  nombre: string;
  tipo_dato: string;
  requerido: boolean;
  considerar_filtro: boolean;
}

export function SmartImporter({ onComplete, onCancel }: SmartImporterProps) {
  const [step, setStep] = useState<Step>("UPLOAD");
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawCsvRows, setRawCsvRows] = useState<string[][]>([]);
  const [showExplorer, setShowExplorer] = useState(false);

  const [mapping, setMapping] = useState<Record<string, string>>({
    nombre: "",
    descripcion: "",
    unidad: "",
    codigo_interno: "",
    unidad_plural: "",
    stock_minimo: "",
    precio_unitario: "",
    codigo_proveedor: "",
    proveedor: "",
    categoria: "",
    es_cenabas: "",
    promedio_uso_mensual_inicial: "",
    control_lote: "",
    ubicacion: "",
    temperatura_almacenamiento: "",
    requiere_cadena_frio: "",
    dias_estabilidad_abierto: "",
    clase_riesgo: "",
    fabricante: "",
    mpn: "",
    alias_unidad_clinica: "",
    es_kit: "",
    codigo_loinc_cpt: "",
  });

  const [previewData, setPreviewData] = useState<ImportPreviewRow[]>([]);
  const [errors, setErrors] = useState<ImportErrorRow[]>([]);
  const [isValidating, setIsValidating] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  // Custom Fields States
  const [showCustomFieldsCreator, setShowCustomFieldsCreator] = useState(false);
  const [newFieldName, setNewFieldName] = useState("");
  const [newFieldType, setNewFieldType] = useState("texto");
  const [customFields, setCustomFields] = useState<LabCampoDefinicion[]>([]);
  const [isCreatingField, setIsCreatingField] = useState(false);

  // Search input to filter mapping fields
  const [searchQuery, setSearchQuery] = useState("");

  // Campos que requiere el sistema
  const systemFields = [
    {
      key: "nombre",
      label: "Nombre del Producto",
      required: true,
      category: "Básicos",
      desc: "Identificador principal del insumo",
    },
    {
      key: "unidad",
      label: "Unidad de Medida",
      required: false,
      category: "Básicos",
      desc: "Debe coincidir con las creadas (ej: unidad, mililitro). Opcional, por defecto 'unidad'",
    },
    {
      key: "descripcion",
      label: "Descripción",
      required: false,
      category: "Básicos",
      desc: "Detalles adicionales del producto",
    },
    {
      key: "codigo_interno",
      label: "Código Interno (SKU)",
      required: false,
      category: "Básicos",
      desc: "Código de inventario único",
    },
    {
      key: "categoria",
      label: "Categoría",
      required: false,
      category: "Básicos",
      desc: "Categoría para agrupar en el catálogo",
    },
    {
      key: "control_lote",
      label: "Control de Lotes",
      required: false,
      category: "Trazabilidad",
      desc: "Método de trazabilidad (lote / simple)",
    },
    {
      key: "stock_minimo",
      label: "Stock Mínimo",
      required: false,
      category: "Inventario",
      desc: "Nivel de alerta crítica global",
    },
    {
      key: "promedio_uso_mensual_inicial",
      label: "Promedio Uso Mensual",
      required: false,
      category: "Inventario",
      desc: "Consumo mensual estimado inicial",
    },
    {
      key: "precio_unitario",
      label: "Precio Unitario",
      required: false,
      category: "Comercial",
      desc: "Costo de adquisición de la unidad",
    },
    {
      key: "proveedor",
      label: "Proveedor",
      required: false,
      category: "Comercial",
      desc: "Nombre del proveedor principal",
    },
    {
      key: "codigo_proveedor",
      label: "Código Proveedor",
      required: false,
      category: "Comercial",
      desc: "Código del ítem para el proveedor",
    },
    {
      key: "es_cenabas",
      label: "¿Es Cenabas?",
      required: false,
      category: "Clínicos",
      desc: "Indica convenio Cenabas (si/no/true/false)",
    },
    {
      key: "alias_unidad_clinica",
      label: "Alias Unidad Clínica",
      required: false,
      category: "Clínicos",
      desc: "Nombre clínico o alias del insumo",
    },
    {
      key: "codigo_loinc_cpt",
      label: "Código LOINC/CPT",
      required: false,
      category: "Clínicos",
      desc: "Estándar clínico LOINC o CPT",
    },
    {
      key: "ubicacion",
      label: "Ubicación",
      required: false,
      category: "Almacén",
      desc: "Estantería o lugar físico en bodega",
    },
    {
      key: "temperatura_almacenamiento",
      label: "Temperatura de Almacenamiento",
      required: false,
      category: "Almacén",
      desc: "Ej: 2-8°C, Temperatura ambiente",
    },
    {
      key: "requiere_cadena_frio",
      label: "Requiere Cadena de Frío",
      required: false,
      category: "Almacén",
      desc: "Indica refrigeración obligatoria (si/no)",
    },
    {
      key: "dias_estabilidad_abierto",
      label: "Días de Estabilidad Abierto",
      required: false,
      category: "Almacén",
      desc: "Días útil tras apertura",
    },
    {
      key: "clase_riesgo",
      label: "Clase de Riesgo",
      required: false,
      category: "Fabricante",
      desc: "Clase de riesgo del dispositivo médico",
    },
    {
      key: "fabricante",
      label: "Fabricante",
      required: false,
      category: "Fabricante",
      desc: "Nombre del fabricante",
    },
    {
      key: "mpn",
      label: "MPN (Código fabricante)",
      required: false,
      category: "Fabricante",
      desc: "Manufacturer Part Number",
    },
    {
      key: "es_kit",
      label: "¿Es Kit?",
      required: false,
      category: "Básicos",
      desc: "Indica si es un kit de varios insumos (si/no)",
    },
  ];

  const fetchCustomFields = async () => {
    try {
      const res = await api.get("/admin/lab-campos");
      setCustomFields(res.data || []);
    } catch {
      notify.error("Error al obtener campos personalizados");
    }
  };

  useEffect(() => {
    if (step === "MAP") {
      fetchCustomFields();
    }
  }, [step]);

  const handleCreateCustomField = async () => {
    if (!newFieldName.trim()) return;
    setIsCreatingField(true);
    try {
      await api.post("/admin/lab-campos", {
        nombre: newFieldName.trim(),
        tipo_dato: newFieldType,
        requerido: false,
        considerar_filtro: true,
        orden: 10,
      });
      notify.success(`Campo "${newFieldName.trim()}" creado exitosamente.`);
      setNewFieldName("");
      setShowCustomFieldsCreator(false);
      fetchCustomFields();
    } catch (err: any) {
      notify.error(err.response?.data?.mensaje || "Error al crear campo personalizado");
    } finally {
      setIsCreatingField(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    if (!selectedFile.name.endsWith(".csv")) {
      notify.error("Por favor, sube un archivo CSV válido");
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

      if (lines.length === 0) {
        notify.error("El archivo CSV está vacío");
        return;
      }

      // Parse headers
      const cols = lines[0]
        .split(",")
        .map((c) => c.trim().replace(/^"|"$/g, ""));
      setHeaders(cols);
      setFile(selectedFile);

      // Parse raw rows for explorer view
      const parsedRows = lines.map((line) => {
        const result = [];
        let current = "";
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
          const char = line[i];
          if (char === '"') {
            inQuotes = !inQuotes;
          } else if (char === ',' && !inQuotes) {
            result.push(current.trim().replace(/^"|"$/g, ""));
            current = "";
          } else {
            current += char;
          }
        }
        result.push(current.trim().replace(/^"|"$/g, ""));
        return result;
      });
      setRawCsvRows(parsedRows);

      // Auto-mapeo inteligente por nombre con tolerancia extendida
      const newMap = { ...mapping };
      cols.forEach((col) => {
        const lower = col.toLowerCase();
        if (lower.includes("nom") || lower.includes("prd") || lower === "item") newMap.nombre = col;
        if (lower.includes("uni") || lower.includes("med") || lower === "u") newMap.unidad = col;
        if (lower.includes("desc") || lower.includes("detall")) newMap.descripcion = col;
        if (lower.includes("cod_int") || lower.includes("sku") || lower.includes("codigo_interno")) newMap.codigo_interno = col;
        if (lower.includes("plural")) newMap.unidad_plural = col;
        if (lower.includes("min") || lower.includes("seg") || lower.includes("seguridad")) newMap.stock_minimo = col;
        if (lower.includes("prec") || lower.includes("cost") || lower.includes("adquisicion")) newMap.precio_unitario = col;
        if (lower.includes("prov")) newMap.proveedor = col;
        if (lower.includes("cod_prov")) newMap.codigo_proveedor = col;
        if (lower.includes("cat") || lower.includes("grupo")) newMap.categoria = col;
        if (
          lower.includes("cena") ||
          lower.includes("cenab") ||
          lower.includes("cenabast") ||
          lower.includes("cenabas") ||
          lower.includes("cenb") ||
          lower.includes("cnabas")
        ) {
          newMap.es_cenabas = col;
        }
        if (lower.includes("uso") || lower.includes("prom") || lower.includes("demanda")) newMap.promedio_uso_mensual_inicial = col;
        if (lower.includes("ctrl") || lower.includes("traz") || lower.includes("control")) newMap.control_lote = col;
        if (lower.includes("ubica") || lower.includes("estant") || lower.includes("bodeg")) newMap.ubicacion = col;
        if (lower.includes("temp") || lower.includes("almacen")) newMap.temperatura_almacenamiento = col;
        if (lower.includes("frio") || lower.includes("refrig") || lower.includes("cadena")) newMap.requiere_cadena_frio = col;
        if (lower.includes("estabil") || lower.includes("abiert")) newMap.dias_estabilidad_abierto = col;
        if (lower.includes("riesg")) newMap.clase_riesgo = col;
        if (lower.includes("fabr") || lower.includes("marca")) newMap.fabricante = col;
        if (lower.includes("mpn") || lower.includes("part")) newMap.mpn = col;
        if (lower.includes("alias") || lower.includes("clin")) newMap.alias_unidad_clinica = col;
        if (lower.includes("kit")) newMap.es_kit = col;
        if (lower.includes("loinc") || lower.includes("cpt")) newMap.codigo_loinc_cpt = col;
      });
      setMapping(newMap);
      setStep("MAP");
    };
    reader.readAsText(selectedFile);
  };

  const validateMapping = async () => {
    if (!mapping.nombre) {
      notify.error("Debes mapear al menos el campo Nombre del Producto");
      return;
    }

    setIsValidating(true);
    const formData = new FormData();
    formData.append("file", file!);
    formData.append(
      "config",
      JSON.stringify({
        mapping,
        dry_run: true,
      }),
    );

    try {
      const res = await api.post("/setup/importar-productos", formData);
      setPreviewData(res.data.preview || []);
      setErrors(res.data.errores || []);
      setStep("PREVIEW");
    } catch {
      notify.error("Error al validar el archivo");
    } finally {
      setIsValidating(false);
    }
  };

  const runImport = async () => {
    setIsImporting(true);
    const formData = new FormData();
    formData.append("file", file!);
    formData.append(
      "config",
      JSON.stringify({
        mapping,
        dry_run: false,
      }),
    );

    try {
      const res = await api.post("/setup/importar-productos", formData);
      if (res.data.valido) {
        notify.success("Importación completada con éxito");
        onComplete();
      } else {
        notify.error("Hubo errores durante la importación real");
        setErrors(res.data.errores);
      }
    } catch {
      notify.error("Error crítico en el servidor");
    } finally {
      setIsImporting(false);
    }
  };

  // Filter fields based on search query
  const filteredFields = systemFields.filter(
    (f) =>
      f.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
      f.desc.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="fixed inset-0 bg-base-100 z-[60] flex flex-col animate-in fade-in duration-300">
      {/* Header Wizard */}
      <header className="px-8 py-6 border-b border-base-200 flex items-center justify-between bg-base-100/80 backdrop-blur-md sticky top-0 z-10">
        <div className="flex items-center gap-4">
          <div className="p-2 bg-primary/10 rounded-2xl">
            <Database className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-black tracking-tight">
              Importador Inteligente
            </h1>
            <p className="text-xs opacity-50 font-bold uppercase tracking-widest">
              Carga de Productos v2.1 (Diseño Completo)
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {file && (
            <button
              onClick={() => setShowExplorer(true)}
              className="btn btn-sm btn-outline rounded-xl gap-2 font-bold"
            >
              <Eye className="w-4 h-4" />
              Explorar CSV
            </button>
          )}
          <button onClick={onCancel} className="btn btn-circle btn-ghost btn-sm">
            <X className="h-6 w-6" />
          </button>
        </div>
      </header>

      {/* Progress Stepper */}
      <div className="bg-base-200/50 px-8 py-4 flex justify-center border-b border-base-200">
        <div className="flex items-center gap-8 max-w-2xl w-full">
          {[
            { id: "UPLOAD", label: "Cargar Archivo" },
            { id: "MAP", label: "Mapear Columnas" },
            { id: "PREVIEW", label: "Previsualizar" },
          ].map((s, i) => (
            <div key={s.id} className="flex items-center gap-3">
              <div
                className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center font-black text-xs transition-all",
                  step === s.id
                    ? "bg-primary text-primary-content scale-110 shadow-lg shadow-primary/20"
                    : i < ["UPLOAD", "MAP", "PREVIEW"].indexOf(step)
                      ? "bg-success text-success-content"
                      : "bg-base-300 opacity-50",
                )}
              >
                {i < ["UPLOAD", "MAP", "PREVIEW"].indexOf(step) ? (
                  <CheckCircle2 className="h-4 w-4" />
                ) : (
                  i + 1
                )}
              </div>
              <span
                className={cn(
                  "text-xs font-bold uppercase tracking-widest",
                  step === s.id ? "opacity-100" : "opacity-30",
                )}
              >
                {s.label}
              </span>
              {i < 2 && <ArrowRight className="h-4 w-4 opacity-10" />}
            </div>
          ))}
        </div>
      </div>

      <main className="flex-1 overflow-y-auto p-8 flex justify-center">
        <div className="max-w-4xl w-full">
          {/* STEP 1: UPLOAD */}
          {step === "UPLOAD" && (
            <div className="h-[60vh] flex flex-col items-center justify-center border-2 border-dashed border-base-300 rounded-[3rem] bg-base-200/30 hover:bg-base-200/50 transition-all group relative">
              <input
                type="file"
                accept=".csv"
                onChange={handleFileChange}
                className="absolute inset-0 opacity-0 cursor-pointer"
              />
              <div className="p-8 bg-primary/10 rounded-full mb-6 group-hover:scale-110 transition-transform">
                <FileUp className="h-16 w-16 text-primary" />
              </div>
              <h3 className="text-2xl font-black mb-2">
                Suelte su archivo aquí
              </h3>
              <p className="text-sm opacity-40 font-medium mb-8">
                O haga clic para buscar en su ordenador (CSV)
              </p>
              <div className="flex gap-4">
                <div className="badge badge-outline h-8 px-4 opacity-40 font-bold">
                  Máximo 5MB
                </div>
                <div className="badge badge-outline h-8 px-4 opacity-40 font-bold">
                  Codificación UTF-8
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: MAPPING */}
          {step === "MAP" && (
            <div className="space-y-8 animate-in slide-in-from-bottom duration-500">
              <div className="flex flex-col md:flex-row gap-4 justify-between items-start md:items-center">
                <div className="flex items-center gap-3 p-4 bg-info/10 text-info rounded-3xl border border-info/20 flex-1 w-full">
                  <Info className="h-5 w-5 flex-shrink-0" />
                  <p className="text-sm font-medium">
                    Relaciona las columnas de tu archivo con los campos de diseño de producto y almacén.
                  </p>
                </div>
                <div className="flex gap-2 w-full md:w-auto">
                  <button
                    onClick={() => setShowExplorer(true)}
                    className="btn btn-outline rounded-2xl gap-2 h-14"
                  >
                    <Eye className="w-4 h-4" /> Explorar CSV
                  </button>
                  <button
                    onClick={() => setShowCustomFieldsCreator(true)}
                    className="btn btn-secondary rounded-2xl gap-2 h-14"
                  >
                    <PlusCircle className="w-4 h-4" /> Crear Campo Personalizado
                  </button>
                </div>
              </div>

              {/* Custom Fields Registry Info */}
              {customFields.length > 0 && (
                <div className="p-4 bg-base-200 rounded-3xl border border-base-300">
                  <span className="text-[10px] font-black opacity-40 uppercase tracking-widest block mb-2">
                    Campos Personalizados Registrados en el Lab:
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {customFields.map((cf) => (
                      <span key={cf.id} className="badge badge-ghost gap-1 font-bold py-3 px-3">
                        <Sliders className="w-3 h-3 opacity-60" /> {cf.nombre} ({cf.tipo_dato})
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Filter controls */}
              <div className="relative w-full">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 opacity-40" />
                <input
                  type="text"
                  placeholder="Buscar campos de producto por nombre o descripción..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="input input-bordered w-full pl-11 rounded-2xl font-bold bg-base-200/50 focus:bg-base-100"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="absolute right-4 top-1/2 -translate-y-1/2 btn btn-xs btn-circle btn-ghost"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>

              {/* Mapping grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {filteredFields.map((field) => (
                  <div
                    key={field.key}
                    className="p-6 bg-base-200/50 rounded-3xl border border-base-200 flex flex-col gap-4"
                  >
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-black text-sm uppercase tracking-tight">
                          {field.label}
                        </span>
                        {field.required && (
                          <span className="badge badge-error badge-xs">
                            Obligatorio
                          </span>
                        )}
                        <span className="badge badge-ghost badge-xs uppercase font-bold text-[9px]">
                          {field.category}
                        </span>
                      </div>
                      <p className="text-[10px] opacity-40 font-bold uppercase tracking-widest">
                        {field.desc}
                      </p>
                    </div>

                    <select
                      className={cn(
                        "select select-bordered w-full rounded-2xl bg-base-100 font-bold",
                        !mapping[field.key] && field.required
                          ? "select-error"
                          : "",
                      )}
                      value={mapping[field.key]}
                      onChange={(e) =>
                        setMapping({ ...mapping, [field.key]: e.target.value })
                      }
                    >
                      <option value="">-- Ignorar este campo --</option>
                      {headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>

              {filteredFields.length === 0 && (
                <div className="text-center py-12 border border-base-200 border-dashed rounded-3xl bg-base-200/20">
                  <Sliders className="w-12 h-12 opacity-20 mx-auto mb-3" />
                  <p className="font-bold opacity-45">No se encontraron campos para "{searchQuery}"</p>
                </div>
              )}

              <div className="flex justify-between items-center mt-12 pt-8 border-t border-base-200">
                <button
                  onClick={() => setStep("UPLOAD")}
                  className="btn btn-ghost rounded-2xl px-8 gap-2"
                >
                  <ChevronLeft className="h-5 w-5" /> Cambiar Archivo
                </button>
                <button
                  onClick={validateMapping}
                  disabled={!mapping.nombre || isValidating}
                  className="btn btn-primary rounded-2xl px-12 gap-2 h-14 shadow-lg shadow-primary/20"
                >
                  {isValidating ? (
                    <span className="loading loading-spinner" />
                  ) : (
                    <>
                      <TableIcon className="h-5 w-5" /> Validar Datos
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* STEP 3: PREVIEW & ERRORS */}
          {step === "PREVIEW" && (
            <div className="space-y-8 animate-in slide-in-from-bottom duration-500 pb-20">
              {/* Resumen de Salud */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-6 bg-base-200 rounded-[2rem] border border-base-300">
                  <span className="text-[10px] font-black opacity-40 uppercase tracking-widest">
                    Filas Totales
                  </span>
                  <div className="text-3xl font-black">
                    {previewData.length + errors.length}
                  </div>
                </div>
                <div
                  className={cn(
                    "p-6 rounded-[2rem] border",
                    errors.length > 0
                      ? "bg-error/10 border-error/20"
                      : "bg-success/10 border-success/20",
                  )}
                >
                  <span className="text-[10px] font-black opacity-40 uppercase tracking-widest">
                    Errores Detectados
                  </span>
                  <div
                    className={cn(
                      "text-3xl font-black",
                      errors.length > 0 ? "text-error" : "text-success",
                    )}
                  >
                    {errors.length}
                  </div>
                </div>
                <div className="p-6 bg-primary/10 rounded-[2rem] border border-primary/20">
                  <span className="text-[10px] font-black opacity-40 uppercase tracking-widest">
                    Estado
                  </span>
                  <div className="text-xl font-black text-primary mt-1">
                    {errors.length > 0
                      ? "Requiere Corrección"
                      : "Listo para Importar"}
                  </div>
                </div>
              </div>

              {/* Lista de Errores (Si los hay) */}
              {errors.length > 0 && (
                <div className="p-6 bg-error/5 border border-error/20 rounded-[2.5rem] space-y-4">
                  <div className="flex items-center gap-2 text-error mb-2">
                    <AlertCircle className="h-5 w-5" />
                    <h4 className="font-black uppercase tracking-tight">
                      Detalle de Errores
                    </h4>
                  </div>
                  <div className="max-h-60 overflow-y-auto space-y-2 pr-2">
                    {errors.map((err, i) => (
                      <div
                        key={i}
                        className="flex gap-4 text-xs font-bold p-3 bg-base-100 rounded-xl"
                      >
                        <span className="text-error w-16">Fila {err.fila}</span>
                        <span className="opacity-60">{err.mensaje}</span>
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] opacity-40 font-bold text-center mt-4">
                    Corrige los errores en tu archivo CSV y vuelve al paso de
                    carga.
                  </p>
                </div>
              )}

              {/* Vista Previa de Datos */}
              <div className="rounded-[2.5rem] border border-base-200 overflow-hidden bg-base-100 shadow-sm">
                <div className="px-8 py-4 bg-base-200/50 border-b border-base-200">
                  <h4 className="font-black text-sm uppercase tracking-tight">
                    Vista Previa (Primeras 50 filas)
                  </h4>
                </div>
                <div className="overflow-x-auto">
                  <table className="table table-zebra">
                    <thead>
                      <tr className="text-[10px] uppercase tracking-widest opacity-40">
                        <th className="pl-8">Fila</th>
                        <th>Nombre</th>
                        <th>Unidad</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewData.map((row, i) => (
                        <tr key={i}>
                          <td className="pl-8 font-mono text-[10px] opacity-30">
                            {row.fila}
                          </td>
                          <td className="font-bold text-sm">{row.nombre}</td>
                          <td>
                            <span className="badge badge-ghost font-bold text-[10px] uppercase tracking-tighter">
                              {row.unidad || "unidad"}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Footer Acciones */}
              <div className="flex justify-between items-center mt-12">
                <button
                  onClick={() => setStep("MAP")}
                  className="btn btn-ghost rounded-2xl px-8"
                >
                  <ChevronLeft className="h-5 w-5" /> Volver al Mapeo
                </button>
                <button
                  onClick={runImport}
                  disabled={errors.length > 0 || isImporting}
                  className="btn btn-primary rounded-2xl px-12 gap-2 h-16 shadow-xl shadow-primary/30"
                >
                  {isImporting ? (
                    <span className="loading loading-spinner" />
                  ) : (
                    <>
                      <CheckCircle2 className="h-6 w-6" /> Confirmar e Importar
                      Ahora
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* CSV EXPLORER MODAL */}
      {showExplorer && (
        <div className="modal modal-open z-[70]">
          <div className="modal-box max-w-5xl rounded-[2.5rem] p-8 border border-base-300">
            <div className="flex justify-between items-center mb-6">
              <div>
                <h3 className="font-black text-xl flex items-center gap-2">
                  <Eye className="text-primary w-6 h-6" /> Explorador de Archivo CSV
                </h3>
                <p className="text-xs opacity-50">Vista de las primeras 50 filas del archivo cargado.</p>
              </div>
              <button
                onClick={() => setShowExplorer(false)}
                className="btn btn-circle btn-ghost btn-sm"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="overflow-x-auto border border-base-200 rounded-3xl max-h-[60vh]">
              <table className="table table-zebra table-sm">
                <thead>
                  <tr className="bg-base-200">
                    {headers.map((h, i) => (
                      <th key={i} className="font-black uppercase tracking-tight text-xs py-3">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rawCsvRows.slice(1, 51).map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {row.map((cell, colIndex) => (
                        <td key={colIndex} className="text-xs font-medium max-w-[200px] truncate">
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="modal-action mt-6">
              <button onClick={() => setShowExplorer(false)} className="btn btn-primary rounded-2xl px-8">
                Cerrar Explorador
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CUSTOM FIELDS CREATOR MODAL */}
      {showCustomFieldsCreator && (
        <div className="modal modal-open z-[70]">
          <div className="modal-box max-w-md rounded-[2.5rem] p-8 border border-base-300">
            <div className="flex justify-between items-center mb-6">
              <div>
                <h3 className="font-black text-xl flex items-center gap-2">
                  <PlusCircle className="text-secondary w-6 h-6" /> Nuevo Campo Lab
                </h3>
                <p className="text-xs opacity-50">Crea campos personalizados a nivel global.</p>
              </div>
              <button
                onClick={() => setShowCustomFieldsCreator(false)}
                className="btn btn-circle btn-ghost btn-sm"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="form-control">
                <label className="label">
                  <span className="label-text font-bold">Nombre del Campo</span>
                </label>
                <input
                  type="text"
                  placeholder="Ej: Lote Interno, Temperatura, etc."
                  value={newFieldName}
                  onChange={(e) => setNewFieldName(e.target.value)}
                  className="input input-bordered rounded-2xl font-bold"
                />
              </div>

              <div className="form-control">
                <label className="label">
                  <span className="label-text font-bold">Tipo de Dato</span>
                </label>
                <select
                  value={newFieldType}
                  onChange={(e) => setNewFieldType(e.target.value)}
                  className="select select-bordered rounded-2xl font-bold"
                >
                  <option value="texto">Texto</option>
                  <option value="entero">Entero</option>
                  <option value="booleano">Booleano (Sí/No)</option>
                  <option value="fecha">Fecha</option>
                  <option value="lista">Lista de Opciones</option>
                </select>
              </div>
            </div>

            <div className="modal-action gap-2 mt-8">
              <button
                onClick={() => setShowCustomFieldsCreator(false)}
                className="btn btn-ghost rounded-2xl"
              >
                Cancelar
              </button>
              <button
                onClick={handleCreateCustomField}
                disabled={!newFieldName || isCreatingField}
                className="btn btn-primary rounded-2xl px-6"
              >
                {isCreatingField ? (
                  <span className="loading loading-spinner" />
                ) : (
                  "Crear e Integrar"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
