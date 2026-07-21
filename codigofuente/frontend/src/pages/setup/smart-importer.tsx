import { useRef, useState, useEffect } from "react";
import {
  FileUp,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  Table as TableIcon,
  X,
  Database,
  Info,
  Eye,
  PlusCircle,
  Download,
  WandSparkles,
  Clipboard,
  FileText,
  Edit3,
  Filter,
  Check,
  RefreshCw,
  Sparkles,
  Search,
  LayoutGrid,
  List,
  Stethoscope,
  Trash2,
  ChevronDown,
  ChevronUp,
  Save,
  BookmarkCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { notify } from "@/lib/notify";
import api from "@/lib/api";

interface SmartImporterProps {
  onComplete: () => void;
  onCancel: () => void;
}

type Step = "UPLOAD" | "MAP" | "PREVIEW";
type UploadMode = "FILE" | "PASTE";
type MappingViewMode = "CARDS" | "MATRIX";
type CategoryFilter = "TODOS" | "Básicos" | "Comercial" | "Almacén" | "Clínicos" | "Trazabilidad" | "Fabricante" | "Campos del Laboratorio";
type ImportCellValue = string | number | boolean | null | undefined;
type ImportPreviewRow = Record<string, ImportCellValue>;
type ImportErrorRow = Record<string, ImportCellValue>;

interface LabCampoDefinicion {
  id: string;
  nombre: string;
  tipo_dato: string;
  requerido: boolean;
  considerar_filtro: boolean;
  activo: boolean;
  alcance: "laboratorio" | "producto";
  opciones_lista?: string[] | null;
}

interface BulkFill {
  id: number;
  field: string;
  value: string;
  mode: "blank_only" | "overwrite_all";
}

const TEMPLATE_BASE_COLUMNS = [
  "nombre [tipo=texto; requerido=si]",
  "descripcion [tipo=texto; requerido=no]",
  "codigo_interno [tipo=texto; requerido=no]",
  "unidad [tipo=texto; requerido=no]",
  "unidad_plural [tipo=texto; requerido=no]",
  "stock_minimo [tipo=decimal; requerido=no]",
  "precio_unitario [tipo=decimal; requerido=no]",
  "contenido [tipo=decimal; requerido=no]",
  "codigo_proveedor [tipo=texto; requerido=no]",
  "proveedor [tipo=texto; requerido=no]",
  "categoria [tipo=texto; requerido=no]",
  "promedio_uso_mensual_inicial [tipo=decimal; requerido=no]",
  "cantidad_inicial [tipo=decimal; requerido=no]",
  "control_lote [tipo=texto; requerido=no]",
  "ubicacion [tipo=texto; requerido=no]",
  "temperatura_almacenamiento [tipo=texto; requerido=no]",
  "requiere_cadena_frio [tipo=booleano; requerido=no]",
  "dias_estabilidad_abierto [tipo=entero; requerido=no]",
  "clase_riesgo [tipo=texto; requerido=no]",
  "fabricante [tipo=texto; requerido=no]",
  "mpn [tipo=texto; requerido=no]",
  "alias_unidad_clinica [tipo=texto; requerido=no]",
  "es_kit [tipo=booleano; requerido=no]",
  "codigo_loinc_cpt [tipo=texto; requerido=no]",
];

const TEMPLATE_BASE_EXAMPLE_ROW = [
  "Reactivo de ejemplo",
  "Descripción de ejemplo",
  "SKU-EJ-001",
  "unidad",
  "unidades",
  "10",
  "1250",
  "1",
  "PROV-EJ-001",
  "Proveedor de ejemplo",
  "Reactivos",
  "5",
  "10",
  "simple",
  "Estante A",
  "Ambiente",
  "no",
  "30",
  "Clase I",
  "Fabricante de ejemplo",
  "MPN-EJ-001",
  "Alias clínico",
  "no",
  "COD-EJ-001",
];

const escapeCsvCell = (value: string) =>
  /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

function parseCsv(text: string): string[][] {
  const cleanText = text.replace(/^\uFEFF/, "");
  const firstLine = cleanText.split(/\r?\n/)[0] || "";
  const lineForDetection = firstLine.replace(/\[[^\]]*\]/g, "");
  const tabCount = (lineForDetection.match(/\t/g) || []).length;
  const semicolonCount = (lineForDetection.match(/;/g) || []).length;
  const commaCount = (lineForDetection.match(/,/g) || []).length;

  let delimiter = ",";
  if (tabCount > semicolonCount && tabCount > commaCount) {
    delimiter = "\t";
  } else if (semicolonCount > commaCount) {
    delimiter = ";";
  }

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  const finishRow = () => {
    row.push(cell);
    if (row.some((value) => value.trim() !== "")) rows.push(row);
    row = [];
    cell = "";
  };

  for (let index = 0; index < cleanText.length; index += 1) {
    const char = cleanText[index];
    if (char === '"') {
      if (inQuotes && cleanText[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && cleanText[index + 1] === "\n") index += 1;
      finishRow();
    } else {
      cell += char;
    }
  }

  if (inQuotes) throw new Error("El archivo CSV contiene comillas sin cerrar");
  if (cell.length > 0 || row.length > 0) finishRow();
  return rows;
}

export function buildProductImportTemplate(
  customFields: LabCampoDefinicion[],
): string {
  const customColumns = customFields
    .filter((field) => field.activo && field.alcance === "producto")
    .map((field) => {
      const options =
        field.tipo_dato === "lista" && field.opciones_lista?.length
          ? `; opciones=${field.opciones_lista.join("|")}`
          : "";
      return `lab_${field.id} [nombre=${field.nombre}; tipo=${field.tipo_dato}; requerido=${field.requerido ? "si" : "no"}${options}]`;
    });

  const customExampleValues = customFields
    .filter((field) => field.activo && field.alcance === "producto")
    .map((field) => {
      if (field.tipo_dato === "entero") return "42";
      if (field.tipo_dato === "decimal") return "100.50";
      if (field.tipo_dato === "booleano") return "no";
      if (field.tipo_dato === "fecha") return "2026-12-31";
      if (field.tipo_dato === "lista" && field.opciones_lista?.length)
        return field.opciones_lista[0];
      return "Valor de ejemplo";
    });

  const headerLine = [...TEMPLATE_BASE_COLUMNS, ...customColumns]
    .map(escapeCsvCell)
    .join(",");
  const exampleLine = [...TEMPLATE_BASE_EXAMPLE_ROW, ...customExampleValues]
    .map(escapeCsvCell)
    .join(",");

  return `${headerLine}\n${exampleLine}`;
}

export function SmartImporter({ onComplete, onCancel }: SmartImporterProps) {
  const [step, setStep] = useState<Step>("UPLOAD");
  const [uploadMode, setUploadMode] = useState<UploadMode>("FILE");
  const [mappingViewMode, setMappingViewMode] = useState<MappingViewMode>("CARDS");
  const [pastedText, setPastedText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawCsvRows, setRawCsvRows] = useState<string[][]>([]);
  const [showExplorer, setShowExplorer] = useState(false);
  const [showRawDrawer, setShowRawDrawer] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [mapping, setMapping] = useState<Record<string, string>>({
    nombre: "",
    descripcion: "",
    unidad: "",
    codigo_interno: "",
    unidad_plural: "",
    stock_minimo: "",
    precio_unitario: "",
    contenido: "",
    codigo_proveedor: "",
    proveedor: "",
    categoria: "",
    promedio_uso_mensual_inicial: "",
    cantidad_inicial: "",
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
  const [warnings, setWarnings] = useState<ImportErrorRow[]>([]);
  const [rejectionReason, setRejectionReason] = useState("");
  const [isValidating, setIsValidating] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  // Filters & State
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("TODOS");
  const [searchQuery, setSearchQuery] = useState("");
  const [previewFilter, setPreviewFilter] = useState<"ALL" | "ERRORS_ONLY">("ALL");
  const [editingCell, setEditingCell] = useState<{ rowFila: number; field: string; val: string } | null>(null);

  // Custom Fields States
  const [showCustomFieldsCreator, setShowCustomFieldsCreator] = useState(false);
  const [newFieldName, setNewFieldName] = useState("");
  const [newFieldType, setNewFieldType] = useState("texto");
  const [customFields, setCustomFields] = useState<LabCampoDefinicion[]>([]);
  const [customFieldsLoaded, setCustomFieldsLoaded] = useState(false);
  const [customFieldsLoadFailed, setCustomFieldsLoadFailed] = useState(false);
  const [isCreatingField, setIsCreatingField] = useState(false);

  const [bulkFills, setBulkFills] = useState<BulkFill[]>([
    { id: 1, field: "unidad", value: "", mode: "blank_only" },
  ]);
  const nextBulkFillId = useRef(2);

  const effectiveMapping = () => {
    const next: Record<string, string> = {};
    for (const [key, val] of Object.entries(mapping)) {
      if (val && val.trim() !== "") {
        next[key] = val;
      }
    }
    for (const fill of bulkFills) {
      if (fill.value.trim() && !next[fill.field]) {
        next[fill.field] = fill.field;
      }
    }
    return next;
  };

  const effectiveFile = () => {
    if (!file) return file;
    const activeFills = bulkFills.filter((fill) => fill.value.trim());
    if (activeFills.length === 0) return file;
    const nextHeaders = [...headers];
    for (const fill of activeFills) {
      const targetHeader = mapping[fill.field] || fill.field;
      if (!nextHeaders.includes(targetHeader)) nextHeaders.push(targetHeader);
    }
    const lines = [nextHeaders, ...rawCsvRows.slice(1).map((row) => {
      const next = [...row]; while (next.length < nextHeaders.length) next.push("");
      for (const fill of activeFills) {
        const targetHeader = mapping[fill.field] || fill.field;
        const targetIndex = nextHeaders.indexOf(targetHeader);
        if (fill.mode === "overwrite_all" || !next[targetIndex]?.trim()) {
          next[targetIndex] = fill.value.trim();
        }
      }
      return next;
    })].map((row) => row.map(escapeCsvCell).join(","));
    return new File([lines.join("\n")], file.name, { type: "text/csv;charset=utf-8" });
  };

  const downloadTemplate = () => {
    const blob = new Blob([buildProductImportTemplate(customFields)], { type: "text/csv;charset=utf-8" });
    const anchor = document.createElement("a"); anchor.href = URL.createObjectURL(blob); anchor.download = "plantilla-productos.csv"; anchor.click(); URL.revokeObjectURL(anchor.href);
  };

  // Guardar y Cargar Mapeo Preset
  const saveMappingPreset = () => {
    try {
      localStorage.setItem("smart_importer_mapping_preset", JSON.stringify(mapping));
      notify.success("Configuración de mapeo guardada como plantilla por defecto.");
    } catch {
      notify.error("No se pudo guardar la plantilla de mapeo.");
    }
  };

  const loadMappingPreset = () => {
    try {
      const saved = localStorage.getItem("smart_importer_mapping_preset");
      if (saved) {
        setMapping(JSON.parse(saved));
        notify.success("Plantilla de mapeo cargada exitosamente.");
      } else {
        notify.info("No hay plantillas de mapeo guardadas.");
      }
    } catch {
      notify.error("Error al cargar la plantilla de mapeo.");
    }
  };

  // Asistentes de Auto-Limpieza 1-Click & AI Doctor
  const applyQuickClean = (action: "TRIM" | "BOOLEANS" | "DATES" | "TITLECASE" | "AUTO_DOCTOR") => {
    if (rawCsvRows.length <= 1) return;
    const nextRows = rawCsvRows.map((row, rIdx) => {
      if (rIdx === 0) return row;
      return row.map((cell) => {
        let val = cell;
        if (action === "TRIM" || action === "AUTO_DOCTOR") {
          val = val.trim();
        }
        if (action === "BOOLEANS" || action === "AUTO_DOCTOR") {
          const lower = val.trim().toLowerCase();
          if (["si", "sí", "yes", "s", "1", "true"].includes(lower)) val = "true";
          else if (["no", "n", "0", "false"].includes(lower)) val = "false";
        }
        if (action === "DATES" || action === "AUTO_DOCTOR") {
          const match = val.trim().match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
          if (match) {
            const [, d, m, y] = match;
            val = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
          }
        }
        if (action === "TITLECASE") {
          if (val.trim()) {
            val = val.trim().replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
          }
        }
        return val;
      });
    });

    setRawCsvRows(nextRows);
    const updatedFile = new File([nextRows.map((r) => r.map(escapeCsvCell).join(",")).join("\n")], file?.name || "importacion.csv", { type: "text/csv;charset=utf-8" });
    setFile(updatedFile);
    notify.success(action === "AUTO_DOCTOR" ? "⚡ AI Data Doctor: Limpieza y normalización en lote completada." : `Asistente "${action}" aplicado.`);
    if (step === "PREVIEW") {
      setTimeout(() => validateMapping(), 100);
    }
  };

  // Des-mapear campos opcionales
  const clearOptionalMappings = () => {
    setMapping((prev) => {
      const next = { ...prev };
      for (const field of systemFields) {
        if (!field.required) {
          next[field.key] = "";
        }
      }
      return next;
    });
    notify.info("Se des-mapearon todos los campos opcionales.");
  };

  // Descargar filas con error en CSV independiente
  const downloadErrorRows = () => {
    if (errors.length === 0 || rawCsvRows.length <= 1) return;
    const errorFilaSet = new Set(errors.map((e) => Number(e.fila)));
    const errorRows = rawCsvRows.filter((_, idx) => idx === 0 || errorFilaSet.has(idx + 1));
    const csvContent = errorRows.map((r) => r.map(escapeCsvCell).join(",")).join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8" });
    const anchor = document.createElement("a"); anchor.href = URL.createObjectURL(blob); anchor.download = "filas-con-error-productos.csv"; anchor.click(); URL.revokeObjectURL(anchor.href);
    notify.info("Descargadas filas con observaciones para corregir externamente.");
  };

  // Campos que requiere el sistema
  const systemFields = [
    {
      key: "nombre",
      label: "Nombre del Producto",
      required: true,
      category: "Básicos" as const,
      desc: "Identificador principal del insumo",
      allowedHint: "Texto libre (ej: Reactivo A 100ml)",
    },
    {
      key: "unidad",
      label: "Unidad de Medida",
      required: false,
      category: "Básicos" as const,
      desc: "Debe coincidir con las creadas (ej: unidad, mililitro)",
      allowedHint: "Texto (ej: unidad, mililitro, caja, frasco)",
    },
    {
      key: "descripcion",
      label: "Descripción",
      required: false,
      category: "Básicos" as const,
      desc: "Detalles adicionales del producto",
      allowedHint: "Texto libre",
    },
    {
      key: "codigo_interno",
      label: "Código Interno (SKU)",
      required: false,
      category: "Básicos" as const,
      desc: "Código de inventario único",
      allowedHint: "Texto / SKU sin espacios (ej: REACT-001)",
    },
    {
      key: "categoria",
      label: "Categoría",
      required: false,
      category: "Básicos" as const,
      desc: "Categoría para agrupar en el catálogo",
      allowedHint: "Nombre de categoría (ej: Hematología, Bioquímica)",
    },
    {
      key: "control_lote",
      label: "Control de Lotes",
      required: false,
      category: "Trazabilidad" as const,
      desc: "Método de trazabilidad",
      allowedHint: "'lote' o 'simple'",
    },
    {
      key: "stock_minimo",
      label: "Stock Mínimo",
      required: false,
      category: "Almacén" as const,
      desc: "Nivel de alerta crítica global",
      allowedHint: "Número mayor o igual a 0 (ej: 10)",
    },
    {
      key: "promedio_uso_mensual_inicial",
      label: "Promedio Uso Mensual",
      required: false,
      category: "Almacén" as const,
      desc: "Consumo mensual estimado inicial",
      allowedHint: "Número mayor o igual a 0 (ej: 25)",
    },
    {
      key: "cantidad_inicial",
      label: "Cantidad Inicial de Stock",
      required: false,
      category: "Almacén" as const,
      desc: "Stock físico inicial a ingresar a la bodega principal",
      allowedHint: "Número mayor o igual a 0 (ej: 100)",
    },
    {
      key: "precio_unitario",
      label: "Precio Unitario",
      required: false,
      category: "Comercial" as const,
      desc: "Costo de adquisición de la unidad",
      allowedHint: "Número mayor a 0 (ej: 12500)",
    },
    {
      key: "contenido",
      label: "Contenido por Presentación",
      required: false,
      category: "Comercial" as const,
      desc: "Cantidad de unidades base en la presentación",
      allowedHint: "Número mayor a 0 (ej: 100)",
    },
    {
      key: "proveedor",
      label: "Proveedor",
      required: false,
      category: "Comercial" as const,
      desc: "Nombre del proveedor principal",
      allowedHint: "Texto (ej: Roche, Merck, Proveedor General)",
    },
    {
      key: "codigo_proveedor",
      label: "Código Proveedor",
      required: false,
      category: "Comercial" as const,
      desc: "Código del ítem para el proveedor",
      allowedHint: "Texto / Código de catálogo",
    },
    {
      key: "alias_unidad_clinica",
      label: "Alias Unidad Clínica",
      required: false,
      category: "Clínicos" as const,
      desc: "Nombre clínico o alias del insumo",
      allowedHint: "Texto libre",
    },
    {
      key: "codigo_loinc_cpt",
      label: "Código LOINC/CPT",
      required: false,
      category: "Clínicos" as const,
      desc: "Estándar clínico LOINC o CPT",
      allowedHint: "Código estándar (ej: 2345-7)",
    },
    {
      key: "ubicacion",
      label: "Ubicación",
      required: false,
      category: "Almacén" as const,
      desc: "Estantería o lugar físico en bodega",
      allowedHint: "Texto (ej: Estante A-2, Refrigerador 1)",
    },
    {
      key: "temperatura_almacenamiento",
      label: "Temperatura Almacenamiento",
      required: false,
      category: "Almacén" as const,
      desc: "Ej: 2-8°C, Temperatura ambiente",
      allowedHint: "Texto (ej: 2-8°C, Ambiente, -20°C)",
    },
    {
      key: "requiere_cadena_frio",
      label: "Cadena de Frío",
      required: false,
      category: "Almacén" as const,
      desc: "Indica refrigeración obligatoria",
      allowedHint: "Booleano: 'si' / 'no', 'true' / 'false', '1' / '0'",
    },
    {
      key: "dias_estabilidad_abierto",
      label: "Días Estabilidad Abierto",
      required: false,
      category: "Almacén" as const,
      desc: "Días útil tras apertura",
      allowedHint: "Número entero de días (ej: 30)",
    },
    {
      key: "clase_riesgo",
      label: "Clase de Riesgo",
      required: false,
      category: "Fabricante" as const,
      desc: "Clase de riesgo dispositivo médico",
      allowedHint: "Texto (ej: Clase I, Clase IIa, Clase III)",
    },
    {
      key: "fabricante",
      label: "Fabricante",
      required: false,
      category: "Fabricante" as const,
      desc: "Nombre del fabricante",
      allowedHint: "Texto (ej: BioRad, BD, Axiom)",
    },
    {
      key: "mpn",
      label: "MPN (Código fabricante)",
      required: false,
      category: "Fabricante" as const,
      desc: "Manufacturer Part Number",
      allowedHint: "Texto / Número de parte",
    },
    {
      key: "es_kit",
      label: "¿Es Kit?",
      required: false,
      category: "Básicos" as const,
      desc: "Indica si es un kit de varios insumos",
      allowedHint: "Booleano: 'si' / 'no', 'true' / 'false', '1' / '0'",
    },
  ];

  const fetchCustomFields = async () => {
    setCustomFieldsLoaded(false);
    setCustomFieldsLoadFailed(false);
    try {
      const res = await api.get("/admin/lab-campos");
      setCustomFields(
        (res.data || []).filter(
          (field: LabCampoDefinicion) => field.activo && field.alcance === "producto",
        ),
      );
      setCustomFieldsLoaded(true);
    } catch {
      setCustomFields([]);
      setCustomFieldsLoaded(true);
      setCustomFieldsLoadFailed(true);
      notify.error("Error al obtener campos personalizados");
    }
  };

  useEffect(() => {
    fetchCustomFields();
  }, []);

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
        alcance: "producto",
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

  const processParsedRows = (parsedRows: string[][], sourceFile?: File) => {
    if (parsedRows.length === 0) {
      const message = "El contenido no tiene filas válidas";
      setRejectionReason(message);
      notify.error(message);
      return;
    }

    const cols = parsedRows[0];
    setHeaders(cols);
    setFile(sourceFile || new File([parsedRows.map((r) => r.map(escapeCsvCell).join(",")).join("\n")], "importacion.csv", { type: "text/csv;charset=utf-8" }));
    setRawCsvRows(parsedRows);
    setRejectionReason("");

    // Auto-mapeo con confidencia %
    const newMap = { ...mapping };
    const usedCols = new Set<string>();

    const tryBind = (targetKey: string, colHeader: string) => {
      if (!newMap[targetKey] && !usedCols.has(colHeader)) {
        newMap[targetKey] = colHeader;
        usedCols.add(colHeader);
      }
    };

    cols.forEach((col) => {
      const lower = col.toLowerCase().trim();
      const customKey = lower.match(/^(lab_[a-f0-9-]{36})/)?.[1];
      if (customKey) {
        newMap[customKey] = col;
        usedCols.add(col);
        return;
      }
      const canonicalKey = lower.match(/^([a-z_]+)\s*\[/)?.[1];
      if (canonicalKey && Object.prototype.hasOwnProperty.call(newMap, canonicalKey)) {
        tryBind(canonicalKey, col);
        return;
      }
      if (Object.prototype.hasOwnProperty.call(newMap, lower)) {
        tryBind(lower, col);
      }
    });

    cols.forEach((col) => {
      if (usedCols.has(col)) return;
      const lower = col.toLowerCase().trim();
      if (lower.includes("cod_prov") || lower.includes("codigo_proveedor") || lower.includes("sku_proveedor")) tryBind("codigo_proveedor", col);
      else if (lower.includes("prov") || lower.includes("proveedor")) tryBind("proveedor", col);
      else if (lower.includes("plural") || lower.includes("unidad_plural")) tryBind("unidad_plural", col);
      else if (lower.includes("alias") || lower.includes("clin") || lower.includes("alias_unidad_clinica")) tryBind("alias_unidad_clinica", col);
      else if (lower === "u" || lower.includes("unidad") || lower.includes("medida") || lower.includes("unidad_base")) tryBind("unidad", col);
      else if (lower.includes("cod_int") || lower.includes("sku") || lower.includes("codigo_interno")) tryBind("codigo_interno", col);
      else if (lower.includes("min") || lower.includes("seg") || lower.includes("seguridad") || lower.includes("stock_minimo")) tryBind("stock_minimo", col);
      else if (lower.includes("prec") || lower.includes("cost") || lower.includes("adquisicion") || lower.includes("precio")) tryBind("precio_unitario", col);
      else if (lower.includes("contenido") || lower.includes("factor_conversion") || lower.includes("unidades por")) tryBind("contenido", col);
      else if (lower.includes("cat") || lower.includes("grupo") || lower.includes("categoria")) tryBind("categoria", col);
      else if (lower.includes("uso") || lower.includes("prom") || lower.includes("demanda") || lower.includes("cantidad")) tryBind("promedio_uso_mensual_inicial", col);
      else if (lower.includes("ctrl") || lower.includes("traz") || lower.includes("control")) tryBind("control_lote", col);
      else if (lower.includes("ubica") || lower.includes("estant") || lower.includes("bodeg") || lower.includes("lugar")) tryBind("ubicacion", col);
      else if (lower.includes("temp") || lower.includes("almacen")) tryBind("temperatura_almacenamiento", col);
      else if (lower.includes("frio") || lower.includes("refrig") || lower.includes("cadena")) tryBind("requiere_cadena_frio", col);
      else if (lower.includes("estabil") || lower.includes("abiert")) tryBind("dias_estabilidad_abierto", col);
      else if (lower.includes("riesg")) tryBind("clase_riesgo", col);
      else if (lower.includes("fabr") || lower.includes("marca")) tryBind("fabricante", col);
      else if (lower.includes("mpn") || lower.includes("part")) tryBind("mpn", col);
      else if (lower.includes("kit")) tryBind("es_kit", col);
      else if (lower.includes("loinc") || lower.includes("cpt")) tryBind("codigo_loinc_cpt", col);
      else if (lower.includes("nom") || lower.includes("prd") || lower === "item") tryBind("nombre", col);
      else if (lower.includes("desc") || lower.includes("detall")) tryBind("descripcion", col);
    });

    setMapping(newMap);
    setStep("MAP");
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    if (!selectedFile.name.toLowerCase().endsWith(".csv")) {
      const message = "Por favor, sube un archivo CSV válido";
      setRejectionReason(message);
      notify.error(message);
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      try {
        const parsedRows = parseCsv(text);
        processParsedRows(parsedRows, selectedFile);
      } catch (error) {
        const message = error instanceof Error ? error.message : "El archivo CSV no es válido";
        setRejectionReason(message);
        notify.error(message);
      }
    };
    reader.readAsText(selectedFile);
  };

  const handlePasteSubmit = () => {
    if (!pastedText.trim()) {
      notify.error("Por favor, pega contenido de celdas antes de continuar");
      return;
    }
    try {
      const parsedRows = parseCsv(pastedText.trim());
      processParsedRows(parsedRows);
      notify.success(`Procesadas ${parsedRows.length - 1} filas desde el portapapeles.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error al procesar el texto pegado";
      setRejectionReason(message);
      notify.error(message);
    }
  };

  const getMappingConfidence = (targetKey: string, mappedHeader: string) => {
    if (!mappedHeader) return { score: 0, label: "Sin Asignar", badgeClass: "badge-warning opacity-60" };
    const lower = mappedHeader.toLowerCase().trim();
    if (lower === targetKey || lower.startsWith(`${targetKey} [`)) {
      return { score: 100, label: "100% Match", badgeClass: "badge-success text-success-content" };
    }
    if (lower.match(/\[tipo=[^\]]+\]/)) {
      return { score: 95, label: "95% Tag", badgeClass: "badge-success" };
    }
    return { score: 85, label: "85% Match", badgeClass: "badge-info" };
  };

  const validateMapping = async () => {
    if (!mapping.nombre) {
      notify.error("Debes mapear al menos el campo Nombre del Producto");
      return;
    }

    setIsValidating(true);
    const formData = new FormData();
    formData.append("file", effectiveFile()!);
    formData.append(
      "config",
      JSON.stringify({
        mapping: effectiveMapping(),
        required_fields: [],
        dry_run: true,
      }),
    );

    try {
      const res = await api.post("/setup/importar-productos", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setPreviewData(res.data.preview || []);
      setErrors(res.data.errores || []);
      setWarnings(res.data.advertencias || []);
      setRejectionReason("");
      setStep("PREVIEW");
    } catch (error: any) {
      const message =
        error.response?.data?.mensaje ||
        error.response?.data?.message ||
        error.message ||
        "Error al validar el archivo";
      setRejectionReason(message);
      notify.error(message);
    } finally {
      setIsValidating(false);
    }
  };

  const runImport = async () => {
    setIsImporting(true);
    const formData = new FormData();
    formData.append("file", effectiveFile()!);
    formData.append(
      "config",
      JSON.stringify({
        mapping: effectiveMapping(),
        required_fields: [],
        dry_run: false,
      }),
    );

    try {
      const res = await api.post("/setup/importar-productos", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setWarnings(res.data.advertencias || []);
      if (res.data.valido) {
        setRejectionReason("");
        notify.success("Importación completada con éxito");
        onComplete();
      } else {
        notify.error("Hubo errores durante la importación real");
        setErrors(res.data.errores);
      }
    } catch (error: any) {
      const message =
        error.response?.data?.mensaje ||
        error.response?.data?.message ||
        error.message ||
        "Error crítico en el servidor";
      setRejectionReason(message);
      notify.error(message);
    } finally {
      setIsImporting(false);
    }
  };

  const handleCellEditSave = (rowFila: number, headerKey: string, newValue: string) => {
    const headerIndex = headers.indexOf(headerKey);
    if (headerIndex === -1 || rawCsvRows.length <= 1) return;
    const nextRows = [...rawCsvRows];
    const targetRowIdx = rowFila;
    if (targetRowIdx < nextRows.length) {
      const nextRow = [...nextRows[targetRowIdx]];
      nextRow[headerIndex] = newValue;
      nextRows[targetRowIdx] = nextRow;
      setRawCsvRows(nextRows);
      setFile(new File([nextRows.map((r) => r.map(escapeCsvCell).join(",")).join("\n")], file?.name || "importacion.csv", { type: "text/csv;charset=utf-8" }));
      notify.info(`Celda actualizada en fila ${rowFila}. Re-validando datos...`);
      setEditingCell(null);
      setTimeout(() => validateMapping(), 100);
    }
  };

  const customMappingFields = customFields.map((field) => {
    let allowedHint = "Texto libre";
    if (field.tipo_dato === "booleano") allowedHint = "si / no, true / false, 1 / 0";
    else if (field.tipo_dato === "entero") allowedHint = "Número entero (ej: 42)";
    else if (field.tipo_dato === "fecha") allowedHint = "Fecha AAAA-MM-DD (ej: 2026-12-31)";
    else if (field.tipo_dato === "lista" && field.opciones_lista?.length) allowedHint = `Opciones: ${field.opciones_lista.join(", ")}`;
    return {
      key: `lab_${field.id}`,
      label: field.nombre,
      required: field.requerido,
      category: "Campos del Laboratorio" as const,
      desc: `Campo personalizado (${field.tipo_dato})`,
      allowedHint,
    };
  });
  const allFields = [...systemFields, ...customMappingFields];
  const filteredFields = allFields.filter((f) => {
    const matchesSearch =
      f.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
      f.desc.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCat = categoryFilter === "TODOS" || f.category === categoryFilter;
    return matchesSearch && matchesCat;
  });

  const errorFilaSet = new Set(errors.map((e) => Number(e.fila)));
  const visiblePreviewRows = previewData.filter((row) => {
    if (previewFilter === "ERRORS_ONLY") return errorFilaSet.has(Number(row.fila));
    return true;
  });

  const readinessPercent = previewData.length > 0
    ? Math.max(0, Math.round(((previewData.length - errors.length) / previewData.length) * 100))
    : 100;

  return (
    <div className="fixed inset-0 bg-base-100 z-[60] flex flex-col animate-in fade-in duration-300">
      {/* Header Wizard */}
      <header className="px-8 py-6 border-b border-base-200 flex items-center justify-between bg-base-100/80 backdrop-blur-md sticky top-0 z-10">
        <div className="flex items-center gap-4 min-w-0">
          <div className="p-2 bg-primary/10 rounded-2xl shrink-0">
            <Database className="h-6 w-6 text-primary" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-black tracking-tight truncate">
              Importador Inteligente v3.0 Pro
            </h1>
            <p className="text-xs opacity-50 font-bold uppercase tracking-widest truncate">
              Linear / Retool Standard (Auto-Doctor + Samples + Presets)
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
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
      <div className="bg-base-200/50 px-8 py-4 flex justify-center border-b border-base-200 overflow-x-auto">
        <div className="flex items-center gap-8 max-w-2xl w-full min-w-max">
          {[
            { id: "UPLOAD", label: "Cargar Archivo" },
            { id: "MAP", label: "Mapear Columnas" },
            { id: "PREVIEW", label: "Previsualizar" },
          ].map((s, i) => (
            <div key={s.id} className="flex items-center gap-3">
              <div
                className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center font-black text-xs transition-all shrink-0",
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
                  "text-xs font-bold uppercase tracking-widest whitespace-nowrap",
                  step === s.id ? "opacity-100" : "opacity-30",
                )}
              >
                {s.label}
              </span>
              {i < 2 && <ArrowRight className="h-4 w-4 opacity-10 shrink-0" />}
            </div>
          ))}
        </div>
      </div>

      <main className="flex-1 overflow-y-auto p-4 sm:p-8 flex justify-center">
        <div className="max-w-4xl w-full space-y-6">
          {rejectionReason && (
            <div role="alert" className="alert alert-error mb-6">
              <AlertCircle className="h-5 w-5 shrink-0" />
              <span className="break-words"><strong>Archivo rechazado:</strong> {rejectionReason}</span>
            </div>
          )}

          {/* STEP 1: UPLOAD & PASTE */}
          {step === "UPLOAD" && (
            <div className="space-y-6">
              <div className="flex justify-center">
                <div className="join bg-base-200 p-1 rounded-2xl">
                  <button
                    type="button"
                    onClick={() => setUploadMode("FILE")}
                    className={cn(
                      "btn btn-sm join-item rounded-xl gap-2 font-bold",
                      uploadMode === "FILE" ? "btn-primary" : "btn-ghost"
                    )}
                  >
                    <FileUp className="w-4 h-4" />
                    Subir Archivo (.CSV)
                  </button>
                  <button
                    type="button"
                    onClick={() => setUploadMode("PASTE")}
                    className={cn(
                      "btn btn-sm join-item rounded-xl gap-2 font-bold",
                      uploadMode === "PASTE" ? "btn-primary" : "btn-ghost"
                    )}
                  >
                    <Clipboard className="w-4 h-4" />
                    Pegar desde Excel / Sheets
                  </button>
                </div>
              </div>

              {uploadMode === "FILE" ? (
                <div className="h-[55vh] flex flex-col items-center justify-center border-2 border-dashed border-base-300 rounded-[3rem] bg-base-200/30 hover:bg-base-200/50 transition-all group relative p-6 text-center">
                  <input
                    ref={fileInputRef}
                    id="smart-importer-csv-file"
                    type="file"
                    accept=".csv,text/csv"
                    onChange={handleFileChange}
                    className="sr-only"
                    aria-label="Seleccionar archivo CSV"
                  />
                  <div className="p-8 bg-primary/10 rounded-full mb-6 group-hover:scale-110 transition-transform shrink-0">
                    <FileUp className="h-16 w-16 text-primary" />
                  </div>
                  <div className="badge badge-primary gap-1 mb-4 font-bold text-xs">
                    Importación de Catálogo (Paso 1 de 2)
                  </div>
                  <h3 className="text-2xl font-black mb-2">
                    Suelte su archivo de productos (CSV) aquí
                  </h3>
                  <p className="text-sm opacity-60 max-w-md font-medium mb-4">
                    El catálogo define los productos y sus atributos. Para cargar stock físico, primero debes importar tu catálogo.
                  </p>
                  <label
                    htmlFor="smart-importer-csv-file"
                    className="btn btn-primary rounded-2xl gap-2 mb-8 z-10 cursor-pointer"
                  >
                    <FileUp className="w-4 h-4" />
                    Explorar CSV
                  </label>
                  <div className="flex gap-4">
                    <div className="badge badge-outline h-8 px-4 opacity-40 font-bold">
                      Máximo 5MB
                    </div>
                    <div className="badge badge-outline h-8 px-4 opacity-40 font-bold">
                      Codificación UTF-8
                    </div>
                  </div>
                  <button type="button" disabled={!customFieldsLoaded} onClick={(event) => { event.stopPropagation(); downloadTemplate(); }} className="btn btn-outline mt-6 z-10 gap-2"><Download className="w-4 h-4"/>{!customFieldsLoaded ? "Preparando plantilla..." : customFieldsLoadFailed ? "Descargar plantilla base" : "Descargar plantilla"}</button>
                  {customFieldsLoadFailed && (
                    <button type="button" onClick={(event) => { event.stopPropagation(); fetchCustomFields(); }} className="btn btn-ghost btn-sm mt-2 z-10">
                      Reintentar campos personalizados
                    </button>
                  )}
                </div>
              ) : (
                <div className="p-6 sm:p-8 border-2 border-primary/20 rounded-[3rem] bg-base-100 shadow-xl space-y-6">
                  <div className="flex items-center gap-3">
                    <div className="p-3 bg-primary/10 rounded-2xl text-primary shrink-0">
                      <Clipboard className="w-6 h-6" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-lg font-black truncate">Pegar celdas directamente desde Excel o Google Sheets</h3>
                      <p className="text-xs opacity-60 font-medium">
                        Copia tus filas en Excel (Ctrl+C) y pégalas en esta caja de texto (Ctrl+V).
                      </p>
                    </div>
                  </div>
                  <textarea
                    rows={10}
                    value={pastedText}
                    onChange={(e) => setPastedText(e.target.value)}
                    placeholder={`nombre\tunidad\tstock_minimo\nGlucosa Oxidasa\tunidad\t50\nHemoglobina A1c\tunidad\t20`}
                    className="textarea textarea-bordered w-full font-mono text-xs p-4 rounded-2xl bg-base-200/50"
                  />
                  <div className="flex justify-between items-center">
                    <span className="text-xs opacity-50 font-bold">
                      {pastedText ? `${pastedText.split("\n").filter((l) => l.trim()).length} líneas pegadas` : "Esperando contenido..."}
                    </span>
                    <button
                      type="button"
                      disabled={!pastedText.trim()}
                      onClick={handlePasteSubmit}
                      className="btn btn-primary rounded-2xl gap-2 font-bold px-8"
                    >
                      <Sparkles className="w-4 h-4" />
                      Procesar Texto Pegado
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* STEP 2: MAPPING */}
          {step === "MAP" && (
            <div className="space-y-6 animate-in slide-in-from-bottom duration-500">
              <div className="flex flex-col md:flex-row gap-4 justify-between items-start md:items-center">
                <div className="flex items-center gap-3 p-4 bg-info/10 text-info rounded-3xl border border-info/20 flex-1 w-full min-w-0">
                  <Info className="h-5 w-5 shrink-0" />
                  <p className="text-sm font-medium">
                    Relaciona las columnas de tu archivo con los campos de diseño de producto y almacén.
                  </p>
                </div>
                <div className="flex gap-2 w-full md:w-auto shrink-0">
                  <button
                    onClick={() => setShowExplorer(true)}
                    className="btn btn-outline rounded-2xl gap-2 h-14"
                  >
                    <Eye className="w-4 h-4" /> Explorar CSV
                  </button>
                  <button
                    onClick={validateMapping}
                    disabled={isValidating}
                    className="btn btn-primary rounded-2xl gap-2 px-8 h-14 font-black"
                  >
                    {isValidating ? (
                      <span className="loading loading-spinner loading-sm" />
                    ) : (
                      <>
                        <span>Validar Datos</span>
                        <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Barra de Acciones Rápidas, Presets & Conmutador de Vista */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-base-200/50 p-4 rounded-3xl border border-base-200">
                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <div className="join bg-base-100 p-1 rounded-xl border border-base-200">
                    <button
                      onClick={() => setMappingViewMode("CARDS")}
                      className={cn("btn btn-xs join-item font-bold gap-1", mappingViewMode === "CARDS" ? "btn-primary" : "btn-ghost")}
                    >
                      <LayoutGrid className="w-3.5 h-3.5" /> Tarjetas
                    </button>
                    <button
                      onClick={() => setMappingViewMode("MATRIX")}
                      className={cn("btn btn-xs join-item font-bold gap-1", mappingViewMode === "MATRIX" ? "btn-primary" : "btn-ghost")}
                    >
                      <List className="w-3.5 h-3.5" /> Matriz Compacta
                    </button>
                  </div>
                  <button
                    onClick={clearOptionalMappings}
                    className="btn btn-xs btn-ghost text-error font-bold gap-1"
                    title="Desmapear todos los campos opcionales"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Limpiar Opcionales
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={saveMappingPreset}
                    className="btn btn-xs btn-outline rounded-xl font-bold gap-1"
                    title="Guardar mapeo actual en el navegador para uso futuro"
                  >
                    <Save className="w-3.5 h-3.5 text-primary" /> Guardar Plantilla Mapeo
                  </button>
                  <button
                    onClick={loadMappingPreset}
                    className="btn btn-xs btn-outline rounded-xl font-bold gap-1"
                    title="Cargar plantilla de mapeo previamente guardada"
                  >
                    <BookmarkCheck className="w-3.5 h-3.5 text-success" /> Cargar Plantilla
                  </button>
                  <button
                    onClick={() => setShowCustomFieldsCreator(true)}
                    className="btn btn-xs btn-primary rounded-xl font-bold gap-1"
                  >
                    <PlusCircle className="w-3.5 h-3.5" /> + Crear Campo Lab
                  </button>
                </div>
              </div>

              {/* Controles de Búsqueda y Filtro de Categorías */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-base-100 p-4 rounded-3xl border border-base-200">
                <div className="relative w-full sm:w-72">
                  <Search className="w-4 h-4 absolute left-3 top-3.5 opacity-40" />
                  <input
                    className="input input-sm input-bordered pl-9 w-full rounded-xl"
                    placeholder="Buscar campo (ej: stock, precio)..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
                <div className="flex flex-wrap gap-1 w-full sm:w-auto">
                  {(["TODOS", "Básicos", "Comercial", "Almacén", "Clínicos", "Campos del Laboratorio"] as CategoryFilter[]).map((cat) => (
                    <button
                      key={cat}
                      onClick={() => setCategoryFilter(cat)}
                      className={cn(
                        "btn btn-xs rounded-lg font-bold",
                        categoryFilter === cat ? "btn-primary" : "btn-ghost opacity-60"
                      )}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              {/* Toolbox de Auto-Limpieza 1-Click */}
              <section className="p-5 rounded-3xl border border-primary/20 bg-primary/5 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-black text-sm">
                    <WandSparkles className="w-5 h-5 text-primary" />
                    Barra de Limpieza Rápida (1-Click Toolbox)
                  </div>
                  <span className="badge badge-primary badge-sm font-bold opacity-80">Asistente Inteligente</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => applyQuickClean("TRIM")}
                    className="btn btn-xs btn-outline rounded-xl font-bold gap-1"
                  >
                    <Sparkles className="w-3 h-3 text-primary" /> Trim Espacios Vacíos
                  </button>
                  <button
                    type="button"
                    onClick={() => applyQuickClean("BOOLEANS")}
                    className="btn btn-xs btn-outline rounded-xl font-bold gap-1"
                  >
                    <Check className="w-3 h-3 text-success" /> Normalizar Si/No a Booleans
                  </button>
                  <button
                    type="button"
                    onClick={() => applyQuickClean("DATES")}
                    className="btn btn-xs btn-outline rounded-xl font-bold gap-1"
                  >
                    <RefreshCw className="w-3 h-3 text-info" /> Formatear Fechas a ISO
                  </button>
                  <button
                    type="button"
                    onClick={() => applyQuickClean("TITLECASE")}
                    className="btn btn-xs btn-outline rounded-xl font-bold gap-1"
                  >
                    <FileText className="w-3 h-3 text-warning" /> Capitalizar Nombres
                  </button>
                </div>
              </section>

              {/* Relleno Global */}
              <section className="p-5 rounded-3xl border border-base-200 bg-base-200/30 space-y-4">
                <div className="flex items-center gap-2 font-black">
                  <PlusCircle className="w-5 h-5 text-primary" />
                  Rellenar un campo para todas las filas
                </div>
                <p className="text-xs opacity-60">
                  El valor se aplica antes de validar. Puedes completar solo vacíos o reemplazar todos los valores.
                </p>
                <div className="space-y-3">
                  {bulkFills.map((fill) => (
                    <div key={fill.id} className="grid md:grid-cols-[1fr_1fr_auto_auto] gap-3">
                      <select
                        aria-label="Campo de relleno global"
                        className="select select-bordered w-full rounded-xl"
                        value={fill.field}
                        onChange={(e) => setBulkFills((rows) => rows.map((row) => row.id === fill.id ? { ...row, field: e.target.value } : row))}
                      >
                        {allFields.map((field) => (
                          <option key={field.key} value={field.key}>
                            {field.label}
                          </option>
                        ))}
                      </select>
                      <input
                        aria-label="Valor de relleno global"
                        className="input input-bordered w-full rounded-xl"
                        value={fill.value}
                        onChange={(e) => setBulkFills((rows) => rows.map((row) => row.id === fill.id ? { ...row, value: e.target.value } : row))}
                        placeholder="Valor para aplicar"
                      />
                      <select
                        aria-label="Modo de relleno global"
                        className="select select-bordered w-full rounded-xl"
                        value={fill.mode}
                        onChange={(e) => setBulkFills((rows) => rows.map((row) => row.id === fill.id ? { ...row, mode: e.target.value as BulkFill["mode"] } : row))}
                      >
                        <option value="blank_only">Solo vacíos</option>
                        <option value="overwrite_all">Reemplazar todos</option>
                      </select>
                      <button
                        type="button"
                        aria-label="Eliminar relleno global"
                        className="btn btn-ghost btn-square rounded-xl"
                        disabled={bulkFills.length === 1}
                        onClick={() => setBulkFills((rows) => rows.filter((row) => row.id !== fill.id))}
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    aria-label="Agregar relleno global"
                    className="btn btn-outline btn-sm gap-2 rounded-xl font-bold"
                    onClick={() => {
                      const id = nextBulkFillId.current++;
                      setBulkFills((rows) => [...rows, { id, field: "unidad", value: "", mode: "blank_only" }]);
                    }}
                  >
                    <PlusCircle className="w-4 h-4" />
                    Agregar campo
                  </button>
                </div>
              </section>

              {/* VISTA 1: CARDS */}
              {mappingViewMode === "CARDS" ? (
                <div className="grid md:grid-cols-2 gap-4">
                  {filteredFields.map((field) => {
                    const mappedCol = mapping[field.key] || "";
                    const conf = getMappingConfidence(field.key, mappedCol);
                    const mappedColIdx = headers.indexOf(mappedCol);
                    const sampleVal = mappedColIdx !== -1 && rawCsvRows.length > 1 ? rawCsvRows[1][mappedColIdx] : null;

                    return (
                      <div
                        key={field.key}
                        className={cn(
                          "p-5 rounded-[2rem] border transition-all space-y-3 min-w-0 overflow-hidden shadow-sm",
                          mappedCol
                            ? "border-success/30 bg-success/5"
                            : field.required
                              ? "border-error/30 bg-error/5"
                              : "border-base-200 bg-base-100",
                        )}
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 min-w-0">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="font-black text-sm truncate">{field.label}</span>
                              {field.required && (
                                <span className="badge badge-error badge-xs font-black uppercase tracking-widest text-[8px] shrink-0">
                                  Obligatorio
                                </span>
                              )}
                            </div>
                            <p className="text-xs opacity-60 font-medium truncate mt-0.5" title={field.desc}>
                              {field.desc}
                            </p>
                          </div>

                          <span className={cn("badge badge-sm font-mono font-bold whitespace-nowrap shrink-0", conf.badgeClass)}>
                            {conf.label}
                          </span>
                        </div>

                        <select
                          aria-label={`Columna CSV para ${field.label}`}
                          className={cn(
                            "select select-bordered w-full rounded-2xl bg-base-100 font-bold text-xs truncate max-w-full min-w-0",
                            !mappedCol && field.required && "select-error",
                          )}
                          value={mappedCol}
                          onChange={(e) =>
                            setMapping((prev) => ({
                              ...prev,
                              [field.key]: e.target.value,
                            }))
                          }
                        >
                          <option value="">-- No Importar / Seleccionar --</option>
                          {headers.map((h) => (
                            <option key={h} value={h}>
                              {h}
                            </option>
                          ))}
                        </select>

                        {/* Muestra Fila 1 */}
                        {sampleVal !== null && (
                          <div className="text-[11px] opacity-60 font-mono flex items-center justify-between bg-base-200/50 px-3 py-1.5 rounded-xl">
                            <span className="font-sans font-bold">Muestra Fila 1:</span>
                            <span className="truncate max-w-[160px] font-bold text-primary">{sampleVal || "(Vacío)"}</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                /* VISTA 2: MATRIX CONDENSADA */
                <div className="rounded-[2.5rem] border border-base-200 bg-base-100 shadow-sm overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="table table-zebra table-sm">
                      <thead>
                        <tr className="bg-base-200/50 text-[10px] uppercase tracking-widest opacity-60">
                          <th className="pl-6">Campo del Sistema</th>
                          <th>Categoría</th>
                          <th>Match %</th>
                          <th>Columna CSV Asignada</th>
                          <th>Muestra Fila 1</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredFields.map((field) => {
                          const mappedCol = mapping[field.key] || "";
                          const conf = getMappingConfidence(field.key, mappedCol);
                          const mappedColIdx = headers.indexOf(mappedCol);
                          const sampleVal = mappedColIdx !== -1 && rawCsvRows.length > 1 ? rawCsvRows[1][mappedColIdx] : "-";
                          return (
                            <tr key={field.key}>
                              <td className="pl-6 font-bold text-xs">
                                <div className="flex items-center gap-2">
                                  <span>{field.label}</span>
                                  {field.required && <span className="badge badge-error badge-xs font-bold text-[8px]">REQ</span>}
                                </div>
                              </td>
                              <td><span className="badge badge-ghost text-[10px] font-bold">{field.category}</span></td>
                              <td><span className={cn("badge badge-xs font-mono font-bold", conf.badgeClass)}>{conf.label}</span></td>
                              <td>
                                <select
                                  aria-label={`Columna CSV para ${field.label}`}
                                  className="select select-bordered select-xs w-full max-w-xs font-bold"
                                  value={mappedCol}
                                  onChange={(e) => setMapping((prev) => ({ ...prev, [field.key]: e.target.value }))}
                                >
                                  <option value="">-- No Importar --</option>
                                  {headers.map((h) => (<option key={h} value={h}>{h}</option>))}
                                </select>
                              </td>
                              <td className="font-mono text-xs opacity-60 truncate max-w-[150px]">{sampleVal}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Drawer Colapsable de Inspección de Datos Crudos */}
              <div className="border border-base-200 rounded-3xl bg-base-100 overflow-hidden shadow-sm">
                <button
                  onClick={() => setShowRawDrawer(!showRawDrawer)}
                  className="w-full px-6 py-4 flex items-center justify-between bg-base-200/30 hover:bg-base-200/50 transition-colors font-bold text-xs uppercase tracking-wider"
                >
                  <span className="flex items-center gap-2">
                    <TableIcon className="w-4 h-4 text-primary" />
                    Inspección de Filas Crudas del CSV ({rawCsvRows.length > 0 ? rawCsvRows.length - 1 : 0} filas totales)
                  </span>
                  {showRawDrawer ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>
                {showRawDrawer && (
                  <div className="p-4 border-t border-base-200 max-h-60 overflow-auto">
                    <table className="table table-zebra table-sm">
                      <thead>
                        <tr>
                          {headers.map((h, i) => (<th key={i} className="text-[10px] font-bold bg-base-200">{h}</th>))}
                        </tr>
                      </thead>
                      <tbody>
                        {rawCsvRows.slice(1, 10).map((r, i) => (
                          <tr key={i}>
                            {r.map((c, j) => (<td key={j} className="text-xs font-mono">{c}</td>))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* STEP 3: PREVIEW & INTERACTIVE EDITING */}
          {step === "PREVIEW" && (
            <div className="space-y-6 animate-in slide-in-from-right duration-500">
              {/* Dashboard Pre-Flight Indicator con AI Doctor */}
              <div className="p-6 bg-base-100 border border-base-200 rounded-[2.5rem] flex flex-col md:flex-row items-center justify-between gap-6 shadow-sm">
                <div className="flex items-center gap-6">
                  <div className="relative flex items-center justify-center">
                    <div className="w-20 h-20 rounded-full border-4 border-primary/20 border-t-primary flex items-center justify-center">
                      <span className="text-2xl font-black text-primary">{readinessPercent}%</span>
                    </div>
                  </div>
                  <div>
                    <h3 className="text-lg font-black">Diagnóstico de Salud de Datos (Pre-flight)</h3>
                    <p className="text-xs opacity-60 font-medium">
                      {errors.length === 0 ? "¡Todo listo para importar sin conflictos!" : `Se detectaron ${errors.length} observaciones que requieren atención.`}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    onClick={() => applyQuickClean("AUTO_DOCTOR")}
                    className="btn btn-outline btn-primary rounded-2xl gap-2 font-black shadow-sm"
                  >
                    <Stethoscope className="w-4 h-4 text-primary" />
                    <span>⚡ AI Data Doctor (Auto-Fix 1-Click)</span>
                  </button>
                </div>
              </div>

              {/* Indicadores en Métricas */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-6 bg-base-100 border border-base-200 rounded-[2.5rem] flex flex-col items-center justify-center text-center shadow-sm">
                  <span className="text-3xl font-black text-primary mb-1">{readinessPercent}%</span>
                  <span className="text-xs opacity-50 font-bold uppercase tracking-wider">Pre-flight</span>
                </div>
                <div className="p-6 bg-base-100 border border-base-200 rounded-[2.5rem] flex flex-col items-center justify-center text-center shadow-sm">
                  <span className="text-3xl font-black text-success mb-1">{previewData.length}</span>
                  <span className="text-xs opacity-50 font-bold uppercase tracking-wider">Filas Listas</span>
                </div>
                <div className="p-6 bg-base-100 border border-base-200 rounded-[2.5rem] flex flex-col items-center justify-center text-center shadow-sm">
                  <span className="text-3xl font-black text-error mb-1">{errors.length}</span>
                  <span className="text-xs opacity-50 font-bold uppercase tracking-wider">Observaciones</span>
                </div>
                <div className="p-6 bg-base-100 border border-base-200 rounded-[2.5rem] flex flex-col items-center justify-center text-center shadow-sm">
                  <span className="text-3xl font-black text-warning mb-1">{warnings.length}</span>
                  <span className="text-xs opacity-50 font-bold uppercase tracking-wider">Advertencias</span>
                </div>
              </div>

              {/* Detalle de Errores */}
              {errors.length > 0 && (
                <div className="p-6 bg-error/5 border border-error/20 rounded-[2.5rem] space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-error">
                      <AlertCircle className="h-5 w-5 shrink-0" />
                      <h4 className="font-black uppercase tracking-tight">
                        Detalle de Errores ({errors.length})
                      </h4>
                    </div>
                    <button
                      onClick={validateMapping}
                      disabled={isValidating}
                      className="btn btn-outline btn-error btn-sm rounded-xl gap-2 font-bold"
                    >
                      {isValidating ? <span className="loading loading-spinner loading-xs" /> : <TableIcon className="w-4 h-4" />}
                      Re-validar Datos Ahora
                    </button>
                  </div>
                  <div className="max-h-60 overflow-y-auto space-y-2 pr-2">
                    {errors.map((err, i) => (
                      <div
                        key={i}
                        className="flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs font-bold p-3 bg-base-100 rounded-xl border border-base-200 min-w-0"
                      >
                        <div className="flex gap-3 items-center min-w-0">
                          <span className="badge badge-error badge-sm font-mono font-bold shrink-0">Fila {err.fila}</span>
                          <span className="opacity-80 break-words min-w-0">{err.mensaje}</span>
                        </div>
                        {err.campo && (
                          <button
                            onClick={() => {
                              const targetKey = String(err.campo);
                              const id = nextBulkFillId.current++;
                              setBulkFills((rows) => [...rows, { id, field: targetKey, value: "", mode: "blank_only" }]);
                              setStep("MAP");
                              notify.info(`Añadida regla de relleno para "${targetKey}". Ajusta su valor y re-valida.`);
                            }}
                            className="btn btn-ghost btn-xs text-primary font-bold gap-1 self-start md:self-auto shrink-0"
                          >
                            <WandSparkles className="w-3 h-3" /> Corregir este campo
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Botones de Filtro y Exportación */}
              <div className="flex flex-col md:flex-row justify-between items-center gap-4 bg-base-200/50 p-4 rounded-3xl border border-base-200">
                <div className="join">
                  <button
                    onClick={() => setPreviewFilter("ALL")}
                    className={cn("btn btn-sm join-item font-bold", previewFilter === "ALL" ? "btn-primary" : "btn-ghost")}
                  >
                    Todas las Filas ({previewData.length})
                  </button>
                  <button
                    onClick={() => setPreviewFilter("ERRORS_ONLY")}
                    className={cn("btn btn-sm join-item font-bold gap-1", previewFilter === "ERRORS_ONLY" ? "btn-error" : "btn-ghost")}
                  >
                    <Filter className="w-3.5 h-3.5" /> Solo Errores ({errors.length})
                  </button>
                </div>

                <div className="flex gap-2">
                  {errors.length > 0 && (
                    <button
                      onClick={downloadErrorRows}
                      className="btn btn-outline btn-error btn-sm rounded-xl gap-2 font-bold"
                    >
                      <Download className="w-4 h-4" /> Descargar Filas con Error (.csv)
                    </button>
                  )}
                  <button
                    onClick={runImport}
                    disabled={isImporting || errors.length > 0}
                    className="btn btn-primary rounded-xl gap-2 px-6 font-black"
                  >
                    {isImporting ? <span className="loading loading-spinner loading-sm" /> : <CheckCircle2 className="w-4 h-4" />}
                    Confirmar Importación Definitiva
                  </button>
                </div>
              </div>

              {/* Vista Previa Editable en Caliente */}
              <div className="rounded-[2.5rem] border border-base-200 overflow-hidden bg-base-100 shadow-sm">
                <div className="px-8 py-4 bg-base-200/50 border-b border-base-200 flex justify-between items-center">
                  <h4 className="font-black text-sm uppercase tracking-tight truncate">
                    Grid Interactivo ({visiblePreviewRows.length} filas) - Clic en una celda para editar
                  </h4>
                  <span className="badge badge-info badge-sm font-bold gap-1 shrink-0">
                    <Edit3 className="w-3 h-3" /> Edición en Caliente Habilitada
                  </span>
                </div>
                <div className="overflow-x-auto max-h-[50vh]">
                  <table className="table table-zebra table-sm">
                    <thead>
                      <tr className="text-[10px] uppercase tracking-widest opacity-40 bg-base-200/30">
                        <th className="pl-8">Fila</th>
                        <th>Nombre</th>
                        <th>Unidad</th>
                        <th>Cant. Inicial</th>
                        <th>Ubicación</th>
                        <th>Acción</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visiblePreviewRows.map((row) => {
                        const filaNum = Number(row.fila);
                        const hasErr = errorFilaSet.has(filaNum);
                        return (
                          <tr key={filaNum} className={cn(hasErr && "bg-error/10 hover:bg-error/20")}>
                            <td className="pl-8 font-mono text-[10px] opacity-40">
                              {row.fila}
                            </td>

                            {/* Nombre Cell */}
                            <td className="font-bold text-xs cursor-pointer hover:bg-primary/10 p-2 rounded-lg" onClick={() => setEditingCell({ rowFila: filaNum, field: mapping.nombre || "nombre", val: String(row.nombre || "") })}>
                              <div className="flex items-center justify-between gap-2">
                                <span className="truncate max-w-[200px]">{row.nombre}</span>
                                <Edit3 className="w-3 h-3 opacity-30 hover:opacity-100 shrink-0" />
                              </div>
                            </td>

                            {/* Unidad Cell */}
                            <td className="cursor-pointer hover:bg-primary/10 p-2 rounded-lg" onClick={() => setEditingCell({ rowFila: filaNum, field: mapping.unidad || "unidad", val: String(row.unidad_base || "") })}>
                              <span className="badge badge-ghost font-bold text-[10px] uppercase truncate">
                                {row.unidad_base || "Sin unidad"}
                              </span>
                            </td>

                            {/* Cantidad Initial Cell */}
                            <td className="font-mono text-xs font-bold">
                              {row.cantidad_inicial || row.stock_inicial || row.cantidad || "-"}
                            </td>

                            {/* Ubicacion Cell */}
                            <td className="text-xs opacity-60 truncate max-w-[150px]">
                              {row.ubicacion || "-"}
                            </td>

                            <td>
                              <button
                                onClick={() => setEditingCell({ rowFila: filaNum, field: mapping.nombre || "nombre", val: String(row.nombre || "") })}
                                className="btn btn-ghost btn-xs text-primary font-bold gap-1"
                              >
                                <Edit3 className="w-3 h-3" /> Editar
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Modal de Creación Inline de Campo Personalizado del Lab */}
      {showCustomFieldsCreator && (
        <div className="fixed inset-0 bg-black/50 z-[80] flex items-center justify-center p-4">
          <div className="bg-base-100 p-6 rounded-3xl max-w-md w-full space-y-4 shadow-2xl animate-in zoom-in-95 duration-200">
            <h3 className="font-black text-lg">Crear Nuevo Campo del Laboratorio</h3>
            <p className="text-xs opacity-60">Crea una definición de campo para asociar a los productos de tu catálogo.</p>
            <div className="space-y-3">
              <div>
                <label className="label text-xs font-bold">Nombre del Campo</label>
                <input
                  className="input input-bordered w-full font-bold"
                  placeholder="ej: Registro Sanitario ISP"
                  value={newFieldName}
                  onChange={(e) => setNewFieldName(e.target.value)}
                />
              </div>
              <div>
                <label className="label text-xs font-bold">Tipo de Dato</label>
                <select
                  className="select select-bordered w-full font-bold"
                  value={newFieldType}
                  onChange={(e) => setNewFieldType(e.target.value)}
                >
                  <option value="texto">Texto Libre</option>
                  <option value="entero">Número Entero</option>
                  <option value="decimal">Número Decimal</option>
                  <option value="booleano">Booleano (Sí/No)</option>
                  <option value="fecha">Fecha (AAAA-MM-DD)</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setShowCustomFieldsCreator(false)} className="btn btn-ghost btn-sm">Cancelar</button>
              <button
                onClick={handleCreateCustomField}
                disabled={isCreatingField || !newFieldName.trim()}
                className="btn btn-primary btn-sm font-bold gap-1"
              >
                {isCreatingField ? <span className="loading loading-spinner loading-xs" /> : <PlusCircle className="w-4 h-4" />}
                Crear e Integrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Edición de Celda en Caliente */}
      {editingCell && (
        <div className="fixed inset-0 bg-black/50 z-[80] flex items-center justify-center p-4">
          <div className="bg-base-100 p-6 rounded-3xl max-w-md w-full space-y-4 shadow-2xl animate-in zoom-in-95 duration-200">
            <h3 className="font-black text-lg">Editar Celda Fila {editingCell.rowFila}</h3>
            <p className="text-xs opacity-60">Modifica el valor original del archivo directamente en tu navegador.</p>
            <input
              className="input input-bordered w-full font-bold"
              value={editingCell.val}
              onChange={(e) => setEditingCell({ ...editingCell, val: e.target.value })}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setEditingCell(null)} className="btn btn-ghost btn-sm">Cancelar</button>
              <button onClick={() => handleCellEditSave(editingCell.rowFila, editingCell.field, editingCell.val)} className="btn btn-primary btn-sm font-bold">Guardar y Re-validar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Explorador CSV */}
      {showExplorer && (
        <div className="fixed inset-0 bg-black/50 z-[70] flex items-center justify-center p-8">
          <div className="bg-base-100 p-8 rounded-[3rem] max-w-4xl w-full max-h-[80vh] flex flex-col space-y-4 shadow-2xl">
            <div className="flex justify-between items-center">
              <h3 className="font-black text-lg">Explorador de Archivo CSV Original</h3>
              <button onClick={() => setShowExplorer(false)} className="btn btn-circle btn-ghost btn-sm">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-auto rounded-2xl border border-base-200">
              <table className="table table-zebra table-sm">
                <thead>
                  <tr>
                    {headers.map((h, i) => (
                      <th key={i} className="font-bold text-xs uppercase bg-base-200">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rawCsvRows.slice(1, 30).map((row, rIdx) => (
                    <tr key={rIdx}>
                      {row.map((cell, cIdx) => (
                        <td key={cIdx} className="text-xs font-mono">{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
