import { useRef, useState, useEffect } from "react";
import * as XLSX from "xlsx";
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
  Save,
  BookmarkCheck,
  FlaskConical,
  Plus,
  ChevronUp,
  ChevronDown,
  AlertTriangle,
  Wand2,
  FileSpreadsheet,
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
type PreviewGridMode = "COMPACT" | "EXPANDED";
type CategoryFilter =
  | "TODOS"
  | "Básicos"
  | "Comercial"
  | "Almacén"
  | "Clínicos"
  | "Trazabilidad"
  | "Fabricante"
  | "Campos del Laboratorio";

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

// ─── Plantillas Limpias (Sin Ruido) ─────────────────────────────────────────

const TEMPLATE_SHORT_COLUMNS = [
  "nombre",
  "descripcion",
  "codigo_interno",
  "unidad",
  "categoria",
  "stock_minimo",
  "precio_unitario",
  "cantidad_inicial",
];

const TEMPLATE_SHORT_EXAMPLE_ROW = [
  "Reactivo Hemoglobina A1c",
  "Kit reactivo para determinación de HbA1c",
  "REA-HBA1C-01",
  "kit",
  "Hematología",
  "5",
  "45000",
  "20",
];

const TEMPLATE_FULL_COLUMNS = [
  "nombre",
  "descripcion",
  "codigo_interno",
  "unidad",
  "unidad_plural",
  "stock_minimo",
  "precio_unitario",
  "contenido",
  "codigo_proveedor",
  "proveedor",
  "categoria",
  "promedio_uso_mensual_inicial",
  "cantidad_inicial",
  "control_lote",
  "ubicacion",
  "temperatura_almacenamiento",
  "requiere_cadena_frio",
  "dias_estabilidad_abierto",
  "clase_riesgo",
  "fabricante",
  "mpn",
  "alias_unidad_clinica",
  "es_kit",
  "codigo_loinc_cpt",
];

const TEMPLATE_FULL_EXAMPLE_ROW = [
  "Reactivo Hemoglobina A1c",
  "Kit reactivo para laboratorio",
  "SKU-HBA1C-01",
  "kit",
  "kits",
  "10",
  "45000",
  "1",
  "PROV-HBA1C",
  "BioRad Laboratories",
  "Hematología",
  "15",
  "20",
  "con_vto",
  "Refrigerador H-1",
  "2-8°C",
  "si",
  "30",
  "Clase IIa",
  "BioRad",
  "MPN-8841",
  "HbA1c Lab",
  "no",
  "17855-8",
];

// ─── Datasets Muestra para QA e IA (Escenarios con/sin errores) ──────────────

const MOCK_PERFECT_PRODUCTS_ROWS: string[][] = [
  [
    "nombre",
    "descripcion",
    "codigo_interno",
    "unidad",
    "categoria",
    "stock_minimo",
    "precio_unitario",
    "cantidad_inicial",
    "control_lote",
    "ubicacion",
    "temperatura_almacenamiento",
    "requiere_cadena_frio",
  ],
  [
    "Reactivo Hemoglobina A1c",
    "Kit para determinación cuantitativa de HbA1c",
    "REA-HBA1C-01",
    "kit",
    "Hematología",
    "5",
    "45000",
    "20",
    "con_vto",
    "Refrigerador H-1",
    "2-8°C",
    "true",
  ],
  [
    "Tubo Vacutainer EDTA 3mL",
    "Tubo con anticoagulante K2EDTA para hemograma",
    "TUB-EDTA-3ML",
    "caja",
    "Insumos Generales",
    "10",
    "12500",
    "50",
    "con_vto",
    "Estante B-3",
    "Ambiente",
    "false",
  ],
  [
    "Guantes de Nitrilo Talla M",
    "Caja por 100 unidades sin polvo",
    "GUA-NIT-M",
    "caja",
    "Protección",
    "15",
    "8900",
    "100",
    "sin_control",
    "Bodega Central - E1",
    "Ambiente",
    "false",
  ],
  [
    "Solución Salina 0.9% 500mL",
    "Frasco solución fisiológica estéril",
    "SOL-SAL-500",
    "frasco",
    "Soluciones",
    "8",
    "3200",
    "30",
    "con_vto",
    "Estante C-1",
    "Ambiente",
    "false",
  ],
  [
    "Reactivo Glucosa Oxidasa 100mL",
    "Monoreactivo para determinación de glucosa",
    "REA-GLU-100",
    "frasco",
    "Bioquímica",
    "3",
    "28000",
    "12",
    "con_vto",
    "Refrigerador B-2",
    "2-8°C",
    "true",
  ],
  [
    "Tips Pipeta 10-100ul Azules",
    "Bolsa de 1000 puntas amarillas estériles",
    "TIP-100-AZU",
    "bolsa",
    "Material Plástico",
    "20",
    "15400",
    "40",
    "sin_control",
    "Estante A-4",
    "Ambiente",
    "false",
  ],
  [
    "Control Calidad Multicontrol N1",
    "Suero control liofilizado multiparámetro",
    "CTL-MULTI-N1",
    "frasco",
    "Control Calidad",
    "2",
    "65000",
    "5",
    "con_vto",
    "Congelador -20°C",
    "-20°C",
    "true",
  ],
];

const MOCK_ERROR_PRODUCTS_ROWS: string[][] = [
  [
    "nombre",
    "descripcion",
    "codigo_interno",
    "unidad",
    "categoria",
    "stock_minimo",
    "precio_unitario",
    "cantidad_inicial",
    "control_lote",
    "requiere_cadena_frio",
  ],
  [
    "", // Error: Nombre requerido vacío
    "Producto de prueba con el nombre en blanco",
    "ERR-SKU-001",
    "unidad",
    "Sin Categoría",
    "5",
    "1000",
    "10",
    "con_vto",
    "false",
  ],
  [
    "Tubo Vacutainer EDTA 4mL",
    "Precio unitario no numérico",
    "ERR-SKU-002",
    "caja",
    "Toma Muestra",
    "10",
    "cuarenta_mil_pesos", // Error: INVALID_NUMBER
    "50",
    "con_vto",
    "false",
  ],
  [
    "Guantes Latex Talla L",
    "Control de lote inválido y stock mínimo con texto",
    "ERR-SKU-003",
    "caja",
    "Protección",
    "diez_unidades", // Error: INVALID_NUMBER
    "12000",
    "100",
    "metodo_desconocido", // Error: INVALID_CONTROL_LOTE
    "false",
  ],
  [
    "Solución Salina 0.9% 250mL",
    "Valor booleano no reconocido",
    "ERR-SKU-004",
    "frasco",
    "Soluciones",
    "5",
    "2500",
    "30",
    "sin_control",
    "tal_vez_frio", // Error: INVALID_BOOLEAN
  ],
  [
    "Reactivo Calibrador Bilirrubina",
    "Fila sin errores para comparar",
    "ERR-SKU-005",
    "frasco",
    "Bioquímica",
    "2",
    "35000",
    "5",
    "con_vto",
    "true",
  ],
];

const MOCK_CLINICAL_PRODUCTS_ROWS: string[][] = [
  [
    "nombre",
    "descripcion",
    "codigo_interno",
    "unidad",
    "categoria",
    "stock_minimo",
    "precio_unitario",
    "cantidad_inicial",
    "control_lote",
    "ubicacion",
    "temperatura_almacenamiento",
    "requiere_cadena_frio",
    "dias_estabilidad_abierto",
    "clase_riesgo",
    "fabricante",
    "mpn",
    "codigo_loinc_cpt",
    "es_kit",
  ],
  [
    "Kit Troponina I Alta Sensibilidad",
    "Prueba rápida diagnóstica de infarto miocárdico",
    "CLI-TROP-01",
    "kit",
    "Urgencias y Cardiología",
    "4",
    "98000",
    "10",
    "con_vto",
    "Refrigerador Urgencias R-2",
    "2-8°C",
    "true",
    "14",
    "Clase III",
    "Abbott Diagnostics",
    "MPN-TROP-900",
    "10839-9",
    "true",
  ],
  [
    "Tira Reactiva Gasometría Arterial",
    "Cartucho multiparámetro pH/pCO2/pO2",
    "CLI-GAS-02",
    "caja",
    "Cuidados Intensivos",
    "6",
    "120000",
    "15",
    "con_vto",
    "Gabinete UCI B-1",
    "Ambiente (15-25°C)",
    "false",
    "30",
    "Clase IIb",
    "Radiometer Medical",
    "MPN-ABL-800",
    "2019-8",
    "false",
  ],
];

// Documentos reales de prueba del proyecto (47 y 81 ítems)
const MOCK_REAL_LICITACION_XLS_ROWS: string[][] = [
  ["nombre del producto", "presentacion", "plural presentacion", "unidades por presentacion", "FV MINIMA", "DESPACHO ", "ADQUISICIÓN", "UNIDADES BASICAS a recibir", "Fabricante", "unidad base singular", "unidad base plural"],
  ["Aceite de inmersión 100ml", "UNIDAD", "UNIDADES", "1", "2 AÑOS", "TOTAL ", "LICITACIÓN", "1", "DIPROLAB ", "Unidad ", "Unidades"],
  ["Aguja vacutainer con cámara transparente de visualización 21G x 1", "CAJA", "CAJAS", "100", "1 AÑO", "PARCIALIZADO ", "LICITACIÓN", "9400", "VACUTAINER", "Unidad ", "Unidades"],
  ["Aguja vacutainer con cámara transparente de visualización de 22G x 1", "CAJA", "CAJAS", "100", "1 AÑO", "PARCIALIZADO ", "LICITACIÓN", "1300", "VACUTAINER / AXIOM", "Unidad ", "Unidades"],
  ["Alcohol isopropílico (litro)", "UNIDAD", "UNIDADES", "1", "18 MESES", "TOTAL ", "LICITACIÓN", "3", "CHEMIX", "Unidad ", "Unidades"],
  ["Cloruro de sodio en polvo (kilo)", "UNIDAD", "UNIDADES", "1", "18 MESES", "TOTAL ", "LICITACIÓN", "1", "CHEMIX", "Unidad ", "Unidades"],
  ["Contenedor de muestras de orina de 60 a 80 ml, con tapa rosca, de polipropileno", "CAJA", "CAJAS", "500", "1 AÑO", "PARCIALIZADO ", "CENABAST", "2600", "FLEXLAB", "Unidad ", "Unidades"],
  ["Contenedor de orina para sistema al vacío 120ml", "CAJA ", "CAJAS", "250", "1 AÑO", "PARCIALIZADO ", "LICITACIÓN", "650", "BD VACUTAINER", "Unidad ", "Unidades"],
  ["Cubreobjetos 18 x 18 mm", "CAJA", "CAJAS", "100", "N/A", "PARCIALIZADO ", "LICITACIÓN", "15000", "AXIOM", "Unidad ", "Unidades"],
  ["Eter etílico anhidrido para análisis (litro)", "UNIDAD", "UNIDADES", "1", "18 MESES", "TOTAL ", "LICITACIÓN", "4", "WINKLER", "Unidad ", "Unidades"],
  ["Formaldehido reactivo 37% (litro) ", "UNIDAD", "UNIDADES", "1", "18 MESES", "TOTAL ", "LICITACIÓN", "1", "CHEMIX", "Unidad ", "Unidades"],
  ["Frascos de biopsias con formaldehido (solución formalina) de 30ml", "UNIDAD", "UNIDADES", "1", "1 AÑO", "TOTAL ", "LICITACIÓN", "0", "BIOPSAFE", "Unidad ", "Unidades"],
  ["Frascos de biopsias con formaldehido (solución formalina) de 60ml", "UNIDAD", "UNIDADES", "1", "1 AÑO", "TOTAL ", "LICITACIÓN", "95", "SIMPORT", "Unidad ", "Unidades"],
  ["Frascos de parasitológico, polipropileno, con tapa rosca, 30 a 50 ml", "UNIDAD", "UNIDADES", "1", "N/A", "PARCIALIZADO ", "LICITACIÓN", "800", "GENÉRICO", "Unidad ", "Unidades"],
  ["Glucosa (dextrosa) líquida, para uso en PTGO, 75grs", "UNIDAD", "UNIDADES", "1", "1 AÑO", "PARCIALIZADO ", "", "600", "GLUCOFRESH", "Unidad ", "Unidades"],
  ["Kit determinación de glucosa (cinta más lanceta)", "CAJA", "CAJAS", "100", "1 AÑO", "PARCIALIZADO ", "LICITACIÓN", "0", "-", "Unidad ", "Unidades"],
  ["Kit RPR 500 determinaciones", "CAJA ", "CAJAS", "500", "1 AÑO", "PARCIALIZADO ", "LICITACIÓN", "1", "RAPID LABS ", "Unidad ", "Unidades"],
  ["Lugol para tinción de parasitología 100 ml ", "UNIDAD", "UNIDADES", "1", "1 AÑO", "TOTAL ", "LICITACIÓN", "1", "REACHEM", "Unidad ", "Unidades"],
  ["Mariposa 23G para sistema al vacío", "CAJA ", "CAJAS", "100", "1 AÑO", "PARCIALIZADO ", "LICITACIÓN", "300", "AXIOM", "Unidad ", "Unidades"],
  ["Mariposa 25G para sistema al vacío", "CAJA", "CAJAS", "50", "1 AÑO", "PARCIALIZADO ", "LICITACIÓN", "300", "BD VACUTAINER", "Unidad ", "Unidades"],
  ["Pipetas pasteur plásticas de 3 ml, graduadas", "PAQUETE", "PAQUETES", "500", "1 AÑO", "PARCIALIZADO ", "LICITACIÓN", "12000", "GENÉRICO", "Unidad ", "Unidades"],
  ["Porta objetos, de canto pulido, interlaminados 76 x 26 mm", "CAJA", "CAJAS", "50", "N/A", "PARCIALIZADO ", "LICITACIÓN", "7650", "GLOBAL ROLL", "Unidad ", "Unidades"],
  ["Porta objetos, de canto pulido, interlaminados, superficie esmerilada 76 x 26 mm", "CAJA", "CAJAS", "50", "N/A", "PARCIALIZADO ", "LICITACIÓN", "4000", "GLOBAL ROLL", "Unidad ", "Unidades"],
  ["Puntas de pipeta amarilla con corona", "PAQUETE", "PAQUETES", "1000", "N/A", "PARCIALIZADO ", "LICITACIÓN", "6000", "GENÉRICO", "Unidad ", "Unidades"],
  ["Puntas de pipeta azul sin corona", "PAQUETE", "PAQUETES", "500", "N/A", "PARCIALIZADO ", "LICITACIÓN", "3000", "GENÉRICO", "Unidad ", "Unidades"],
  ["Rollo papel Parafilm (10cm x 38 metros)", "UNIDAD", "UNIDADES", "1", "N/A", "PARCIALIZADO ", "LICITACIÓN", "6", "AMCOR", "Unidad ", "Unidades"],
  ["Suero hemoclasificador monoclonal Anti-A", "UNIDAD", "UNIDADES", "1", "1 AÑO", "TOTAL ", "LICITACIÓN", "0", "COMERCIAL AB", "Unidad ", "Unidades"],
  ["Suero hemoclasificador monoclonal Anti-AB", "UNIDAD", "UNIDADES", "1", "1 AÑO", "TOTAL ", "LICITACIÓN", "3", "COMERCIAL AB", "Unidad ", "Unidades"],
  ["Suero hemoclasificador monoclonal Anti-B", "UNIDAD", "UNIDADES", "1", "1 AÑO", "TOTAL ", "LICITACIÓN", "1", "COMERCIAL AB", "Unidad ", "Unidades"],
  ["Suero hemoclasificador monoclonal Anti-D", "UNIDAD", "UNIDADES", "1", "1 AÑO", "TOTAL ", "LICITACIÓN", "2", "COMERCIAL AB", "Unidad ", "Unidades"],
  ["Test de hemorragias ocultas, inmunológico, cromatográfico, sin dieta (25 determinaciones)", "CAJA", "CAJAS", "25", "1 AÑO", "PARCIALIZADO ", "LICITACIÓN", "200", "ALL TEST", "Unidad ", "Unidades"],
  ["Test rápido Hanta 10 determinaciones", "CAJA", "CAJAS", "10", "18 MESES", "TOTAL ", "LICITACIÓN", "2", "BOSON BIOTECH", "Unidad ", "Unidades"],
  ["Tinción Giemsa (litro)", "UNIDAD", "UNIDADES", "1", "2 AÑOS", "TOTAL ", "LICITACIÓN", "3", "CHEMIX", "Unidad ", "Unidades"],
  ["Tinción May Grünwald (litro)", "UNIDAD", "UNIDADES", "1", "1 AÑO", "TOTAL ", "LICITACIÓN", "3", "CHEMIX / SIGMA ALDRICH", "Unidad ", "Unidades"],
  ["Toallitas con alcohol isopropílico", "CAJA", "CAJAS", "100", "1 AÑO", "TOTAL ", "LICITACIÓN", "0", "CRANBERRY", "Unidad ", "Unidades"],
  ["Tórulas transporte CARY BLAIR, tapa roja", "CAJA", "CAJAS", "100", "18 MESES", "TOTAL ", "LICITACIÓN", "100", "AXIOM", "Unidad ", "Unidades"],
  ["Tórulas transporte STUART, tapa azul", "CAJA", "CAJAS", "100", "18 MESES", "TOTAL ", "LICITACIÓN", "150", "AXIOM ", "Unidad ", "Unidades"],
  ["Tubo al vacío sin anticoagulante con gel separador y activador de coagulación de 3.5ml", "CAJA", "CAJAS", "100", "1 AÑO", "PARCIALIZADO ", "LICITACIÓN", "9600", "AXIOM/BD VACUTAINER", "Unidad ", "Unidades"],
  ["Tubo sin conservador si aditivo al vacío,plástico polipropileno, para recolección y transporte de orina 8ml. 16 x 100ml con tapa", "CAJA", "CAJAS", "100", "N/A", "PARCIALIZADO ", "LICITACIÓN", "600", "GLOBAL VAC / VACULAB", "Unidad ", "Unidades"],
  ["Tubos al vacío con anticoagulante Citrato Na al 3.2% tapa celeste 2ml a 3ml", "RACK", "RACKS", "100", "1 AÑO", "TOTAL ", "LICITACIÓN", "900", "AXIOM", "Unidad ", "Unidades"],
  ["Tubos al vacío con anticoagulante EDTA tapa lila 0 a 1 ml", "RACK ", "RACKS", "100", "1 AÑO", "PARCIALIZADO ", "LICITACIÓN", "400", "JFV MEDICAL", "Unidad ", "Unidades"],
  ["Tubos al vacío con anticoagulante EDTA, 6ml tapa lila con gel", "CAJA", "CAJAS", "100", "1 AÑO", "TOTAL ", "LICITACIÓN", "1900", "AXIOM", "Unidad ", "Unidades"],
  ["Tubo plástico al vació sin aditivo, plástico polipropileno estéril  3 ml a 4 ml.", "CAJA", "CAJAS", "100", "", "", "", "1900", "BD VACUTAINER", "Unidad ", "Unidades"],
  ["Tubos al vacío de urocultivo con preservante 4ml, 13 x 75mm x 100ml", "CAJA", "CAJAS", "100", "1 AÑO", "PARCIALIZADO ", "LICITACIÓN", "800", "VACULAB", "Unidad ", "Unidades"],
  ["Tubos al vacio sin anticoagulante con gel separador y activador de coagulacion 0 a 1 ml", "RACK ", "RACKS", "100", "1 AÑO", "PARCIALIZADO ", "LICITACIÓN", "400", "AXIOM / GONG DONG", "Unidad ", "Unidades"],
  ["Tubos cónicos de polipropileno de 12 ml sin tapa (tubos para centrifuga, orina)", "UNIDAD", "UNIDADES", "1", "N/A", "PARCIALIZADO ", "LICITACIÓN", "7500", "GENÉRICO", "Unidad ", "Unidades"],
  ["Tubos Eppendorf de 1,5 ml, con tapa de polipropileno", "BOLSA ", "BOLSAS", "500", "N/A", "TOTAL ", "LICITACIÓN", "2800", "GENÉRICO", "Unidad ", "Unidades"],
  ["Tubos Falcon estéril de 15ml, individuales", "CAJA ", "CAJAS", "100", "2A", "TOTAL ", "LICITACIÓN", "50", "FALCON", "Unidad ", "Unidades"]
];

const UNIDADES_ESTANDAR = [
  "unidad",
  "frasco",
  "caja",
  "mililitro",
  "gramo",
  "kit",
  "ampolla",
  "tubo",
  "bolsa",
  "rollos",
  "litro",
  "paquete",
  "rack",
];

const escapeCsvCell = (value: string) =>
  /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

const cleanNumberStr = (val: string): string => {
  const trimmed = val.trim();
  if (!trimmed) return "0";
  if (!isNaN(Number(trimmed))) return trimmed;
  // Extraer dígitos en textos mixtos como "12000 APROX" -> "12000"
  const digitsMatch = trimmed.match(/(\d+(?:\.\d+)?)/);
  if (digitsMatch) return digitsMatch[1];
  return "0";
};

export function buildProductImportTemplate(
  customFields: LabCampoDefinicion[],
  mode: "SHORT" | "FULL" = "SHORT",
): string {
  const baseCols =
    mode === "SHORT" ? TEMPLATE_SHORT_COLUMNS : TEMPLATE_FULL_COLUMNS;
  const baseEx =
    mode === "SHORT"
      ? TEMPLATE_SHORT_EXAMPLE_ROW
      : TEMPLATE_FULL_EXAMPLE_ROW;

  const customColumns = customFields
    .filter((field) => field.activo && field.alcance === "producto")
    .map((field) => `lab_${field.id}`);

  const customExampleValues = customFields
    .filter((field) => field.activo && field.alcance === "producto")
    .map((field) => {
      if (field.tipo_dato === "entero") return "42";
      if (field.tipo_dato === "decimal") return "100.50";
      if (field.tipo_dato === "booleano") return "no";
      if (field.tipo_dato === "fecha") return "2026-12-31";
      if (field.tipo_dato === "lista" && field.opciones_lista?.length)
        return field.opciones_lista[0];
      return "Ejemplo";
    });

  const headerLine = [...baseCols, ...customColumns]
    .map(escapeCsvCell)
    .join(",");
  const exampleLine = [...baseEx, ...customExampleValues]
    .map(escapeCsvCell)
    .join(",");

  return `${headerLine}\n${exampleLine}`;
}

export function SmartImporter({ onComplete, onCancel }: SmartImporterProps) {
  const [step, setStep] = useState<Step>("UPLOAD");
  const [uploadMode, setUploadMode] = useState<UploadMode>("FILE");
  const [mappingViewMode, setMappingViewMode] =
    useState<MappingViewMode>("CARDS");
  const [previewGridMode, setPreviewGridMode] =
    useState<PreviewGridMode>("COMPACT");
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
  const [categoryFilter, setCategoryFilter] =
    useState<CategoryFilter>("TODOS");
  const [searchQuery, setSearchQuery] = useState("");
  const [previewFilter, setPreviewFilter] = useState<"ALL" | "ERRORS_ONLY">(
    "ALL",
  );

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
    const lines = [
      nextHeaders,
      ...rawCsvRows.slice(1).map((row) => {
        const next = [...row];
        while (next.length < nextHeaders.length) next.push("");
        for (const fill of activeFills) {
          const targetHeader = mapping[fill.field] || fill.field;
          const targetIndex = nextHeaders.indexOf(targetHeader);
          if (fill.mode === "overwrite_all" || !next[targetIndex]?.trim()) {
            next[targetIndex] = fill.value.trim();
          }
        }
        return next;
      }),
    ].map((row) => row.map(escapeCsvCell).join(","));
    return new File([lines.join("\n")], file.name, {
      type: "text/csv;charset=utf-8",
    });
  };

  const downloadTemplate = (mode: "SHORT" | "FULL" = "SHORT") => {
    const content = buildProductImportTemplate(customFields, mode);
    const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(blob);
    anchor.download =
      mode === "SHORT"
        ? "plantilla-productos-basica.csv"
        : "plantilla-productos-completa.csv";
    anchor.click();
    URL.revokeObjectURL(anchor.href);
    notify.success(
      `Plantilla ${mode === "SHORT" ? "Básica" : "Completa"} descargada.`,
    );
  };

  // Cargar Escenarios de Prueba (Válidos, Con Errores QA, Clínico Completo o Archivos Reales del Proyecto)
  const handleLoadMockScenario = (
    scenario: "PERFECT" | "ERRORS" | "CLINICAL" | "REAL_LICITACION_XLS",
  ) => {
    if (scenario === "PERFECT") {
      processParsedRows(MOCK_PERFECT_PRODUCTS_ROWS);
      notify.success("🧪 Escenario 1: Datos 100% Válidos cargados (7 insumos).");
    } else if (scenario === "ERRORS") {
      processParsedRows(MOCK_ERROR_PRODUCTS_ROWS);
      notify.warning(
        "⚠️ Escenario 2: Datos con Errores cargados para probar edición e IA Data Doctor.",
      );
    } else if (scenario === "CLINICAL") {
      processParsedRows(MOCK_CLINICAL_PRODUCTS_ROWS);
      notify.success("⚡ Escenario 3: Catálogo Clínico Completo cargado (18 col).");
    } else if (scenario === "REAL_LICITACION_XLS") {
      processParsedRows(MOCK_REAL_LICITACION_XLS_ROWS);
      notify.success("📊 Documento Real: Cargado 'LICITACIÓN 2026.xls' (47 insumos de laboratorio reales).");
    }
  };

  // Guardar y Cargar Mapeo Preset
  const saveMappingPreset = () => {
    try {
      localStorage.setItem(
        "smart_importer_mapping_preset",
        JSON.stringify(mapping),
      );
      notify.success(
        "Configuración de mapeo guardada como plantilla por defecto.",
      );
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
  const applyQuickClean = (
    action: "TRIM" | "BOOLEANS" | "DATES" | "TITLECASE" | "AUTO_DOCTOR",
  ) => {
    if (rawCsvRows.length <= 1) return;
    const cantCol = headers.indexOf(mapping.cantidad_inicial || "cantidad_inicial");
    const precioCol = headers.indexOf(mapping.precio_unitario || "precio_unitario");

    const nextRows = rawCsvRows.map((row, rIdx) => {
      if (rIdx === 0) return row;
      return row.map((cell, cIdx) => {
        let val = cell;
        if (action === "TRIM" || action === "AUTO_DOCTOR") {
          val = val.trim();
        }
        if (action === "BOOLEANS" || action === "AUTO_DOCTOR") {
          const lower = val.trim().toLowerCase();
          if (["si", "sí", "yes", "s", "1", "true"].includes(lower))
            val = "true";
          else if (["no", "n", "0", "false"].includes(lower)) val = "false";
        }
        if (action === "DATES" || action === "AUTO_DOCTOR") {
          const match = val
            .trim()
            .match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
          if (match) {
            const [, d, m, y] = match;
            val = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
          }
        }
        if (action === "TITLECASE") {
          if (val.trim()) {
            val = val
              .trim()
              .replace(
                /\w\S*/g,
                (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(),
              );
          }
        }
        if (action === "AUTO_DOCTOR" && (cIdx === cantCol || cIdx === precioCol)) {
          val = cleanNumberStr(val);
        }
        return val;
      });
    });

    setRawCsvRows(nextRows);
    const updatedFile = new File(
      [nextRows.map((r) => r.map(escapeCsvCell).join(",")).join("\n")],
      file?.name || "importacion.csv",
      { type: "text/csv;charset=utf-8" },
    );
    setFile(updatedFile);
    notify.success(
      action === "AUTO_DOCTOR"
        ? "⚡ AI Data Doctor: Limpieza y normalización inteligente en lote completada."
        : `Asistente "${action}" aplicado.`,
    );
    if (step === "PREVIEW") {
      setTimeout(() => validateMapping(), 100);
    }
  };

  // Corrección Integral de Todos los Errores (Fix All Errors)
  const handleFixAllErrors = () => {
    if (rawCsvRows.length <= 1) return;
    let fixedCount = 0;
    const nombreCol = headers.indexOf(mapping.nombre || "nombre");
    const unidadCol = headers.indexOf(mapping.unidad || "unidad");
    const controlCol = headers.indexOf(mapping.control_lote || "control_lote");
    const cantCol = headers.indexOf(
      mapping.cantidad_inicial || "cantidad_inicial",
    );
    const precioCol = headers.indexOf(mapping.precio_unitario || "precio_unitario");
    const stockMinCol = headers.indexOf(mapping.stock_minimo || "stock_minimo");
    const frioCol = headers.indexOf(mapping.requiere_cadena_frio || "requiere_cadena_frio");

    const nextRows = rawCsvRows.map((row, rIdx) => {
      if (rIdx === 0) return row;
      const copy = [...row];

      // 1. Nombre obligatorio
      if (nombreCol !== -1 && !copy[nombreCol]?.trim()) {
        copy[nombreCol] = `Insumo de Laboratorio ${rIdx}`;
        fixedCount++;
      }
      // 2. Unidad de medida
      if (unidadCol !== -1 && (!copy[unidadCol]?.trim() || !UNIDADES_ESTANDAR.includes(copy[unidadCol].toLowerCase()))) {
        copy[unidadCol] = "unidad";
        fixedCount++;
      }
      // 3. Control de lote
      if (controlCol !== -1) {
        const val = (copy[controlCol] || "").toLowerCase().trim();
        if (!["con_vto", "solo_lote", "sin_control"].includes(val)) {
          copy[controlCol] = "con_vto";
          fixedCount++;
        }
      }
      // 4. Precios / Números no válidos (extracción inteligente de dígitos ej: "12000 APROX" -> "12000")
      if (precioCol !== -1) {
        const clean = cleanNumberStr(copy[precioCol]);
        if (clean !== copy[precioCol]) {
          copy[precioCol] = clean;
          fixedCount++;
        }
      }
      if (stockMinCol !== -1) {
        const clean = cleanNumberStr(copy[stockMinCol]);
        if (clean !== copy[stockMinCol]) {
          copy[stockMinCol] = clean;
          fixedCount++;
        }
      }
      if (cantCol !== -1) {
        const clean = cleanNumberStr(copy[cantCol]);
        if (clean !== copy[cantCol]) {
          copy[cantCol] = clean;
          fixedCount++;
        }
      }
      // 5. Booleano no válido
      if (frioCol !== -1) {
        const val = (copy[frioCol] || "").toLowerCase().trim();
        if (!["true", "false"].includes(val)) {
          copy[frioCol] = ["si", "sí", "yes", "1"].includes(val) ? "true" : "false";
          fixedCount++;
        }
      }
      return copy;
    });

    setRawCsvRows(nextRows);
    const updatedFile = new File(
      [nextRows.map((r) => r.map(escapeCsvCell).join(",")).join("\n")],
      file?.name || "importacion.csv",
      { type: "text/csv;charset=utf-8" },
    );
    setFile(updatedFile);
    notify.success(
      `✨ Se subsanaron ${fixedCount} campos erróneos automáticamente.`,
    );
    setTimeout(() => validateMapping(), 100);
  };

  // Eliminar todas las filas con error en 1 Clic
  const handleRemoveAllErrorRows = () => {
    if (errors.length === 0 || rawCsvRows.length <= 1) return;
    const errorFilaSet = new Set(errors.map((e) => Number(e.fila)));
    const nextRows = rawCsvRows.filter(
      (_, idx) => idx === 0 || !errorFilaSet.has(idx),
    );
    setRawCsvRows(nextRows);
    const updatedFile = new File(
      [nextRows.map((r) => r.map(escapeCsvCell).join(",")).join("\n")],
      file?.name || "importacion.csv",
      { type: "text/csv;charset=utf-8" },
    );
    setFile(updatedFile);
    notify.info(
      `🗑️ Se eliminaron ${errorFilaSet.size} filas con observaciones de la tabla.`,
    );
    setTimeout(() => validateMapping(), 100);
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
    const errorRows = rawCsvRows.filter(
      (_, idx) => idx === 0 || errorFilaSet.has(idx),
    );
    const csvContent = errorRows
      .map((r) => r.map(escapeCsvCell).join(","))
      .join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8" });
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(blob);
    anchor.download = "filas-con-error-productos.csv";
    anchor.click();
    URL.revokeObjectURL(anchor.href);
    notify.info(
      "Descargadas filas con observaciones para corregir externamente.",
    );
  };

  // Campos que requiere el sistema
  const systemFields = [
    {
      key: "nombre",
      label: "Nombre del Producto",
      required: true,
      category: "Básicos" as const,
      desc: "Identificador principal del insumo",
      typeLabel: "Texto",
      allowedHint: "Texto libre (ej: Reactivo A 100ml)",
    },
    {
      key: "unidad",
      label: "Unidad de Medida",
      required: false,
      category: "Básicos" as const,
      desc: "Debe coincidir con las creadas (ej: unidad, mililitro)",
      typeLabel: "Lista",
      allowedHint: "Texto (ej: unidad, mililitro, caja, frasco)",
    },
    {
      key: "descripcion",
      label: "Descripción",
      required: false,
      category: "Básicos" as const,
      desc: "Detalles adicionales del producto",
      typeLabel: "Texto",
      allowedHint: "Texto libre",
    },
    {
      key: "codigo_interno",
      label: "Código Interno (SKU)",
      required: false,
      category: "Básicos" as const,
      desc: "Código de inventario único",
      typeLabel: "Texto/SKU",
      allowedHint: "Texto / SKU sin espacios (ej: REACT-001)",
    },
    {
      key: "categoria",
      label: "Categoría",
      required: false,
      category: "Básicos" as const,
      desc: "Categoría para agrupar en el catálogo",
      typeLabel: "Texto",
      allowedHint: "Nombre de categoría (ej: Hematología, Bioquímica)",
    },
    {
      key: "control_lote",
      label: "Control de Lotes",
      required: false,
      category: "Trazabilidad" as const,
      desc: "Método de trazabilidad",
      typeLabel: "Lista / Opción",
      allowedHint: "'con_vto', 'solo_lote' o 'sin_control'",
    },
    {
      key: "stock_minimo",
      label: "Stock Mínimo",
      required: false,
      category: "Almacén" as const,
      desc: "Nivel de alerta crítica global",
      typeLabel: "Decimal",
      allowedHint: "Número mayor o igual a 0 (ej: 10)",
    },
    {
      key: "promedio_uso_mensual_inicial",
      label: "Promedio Uso Mensual",
      required: false,
      category: "Almacén" as const,
      desc: "Consumo mensual estimado inicial",
      typeLabel: "Decimal",
      allowedHint: "Número mayor o igual a 0 (ej: 25)",
    },
    {
      key: "cantidad_inicial",
      label: "Cantidad Inicial de Stock",
      required: false,
      category: "Almacén" as const,
      desc: "Stock físico inicial a ingresar a la bodega principal",
      typeLabel: "Decimal",
      allowedHint: "Número mayor o igual a 0 (ej: 100)",
    },
    {
      key: "precio_unitario",
      label: "Precio Unitario",
      required: false,
      category: "Comercial" as const,
      desc: "Costo de adquisición de la unidad",
      typeLabel: "Decimal",
      allowedHint: "Número mayor a 0 (ej: 12500)",
    },
    {
      key: "contenido",
      label: "Contenido por Presentación",
      required: false,
      category: "Comercial" as const,
      desc: "Cantidad de unidades base en la presentación",
      typeLabel: "Decimal",
      allowedHint: "Número mayor a 0 (ej: 100)",
    },
    {
      key: "proveedor",
      label: "Proveedor",
      required: false,
      category: "Comercial" as const,
      desc: "Nombre del proveedor principal",
      typeLabel: "Texto",
      allowedHint: "Texto (ej: Roche, Merck, Proveedor General)",
    },
    {
      key: "codigo_proveedor",
      label: "Código Proveedor",
      required: false,
      category: "Comercial" as const,
      desc: "Código del ítem para el proveedor",
      typeLabel: "Texto",
      allowedHint: "Texto / Código de catálogo",
    },
    {
      key: "alias_unidad_clinica",
      label: "Alias Unidad Clínica",
      required: false,
      category: "Clínicos" as const,
      desc: "Nombre clínico o alias del insumo",
      typeLabel: "Texto",
      allowedHint: "Texto libre",
    },
    {
      key: "codigo_loinc_cpt",
      label: "Código LOINC/CPT",
      required: false,
      category: "Clínicos" as const,
      desc: "Estándar clínico LOINC o CPT",
      typeLabel: "Texto",
      allowedHint: "Código estándar (ej: 2345-7)",
    },
    {
      key: "ubicacion",
      label: "Ubicación",
      required: false,
      category: "Almacén" as const,
      desc: "Estantería o lugar físico en bodega",
      typeLabel: "Texto",
      allowedHint: "Texto (ej: Estante A-2, Refrigerador 1)",
    },
    {
      key: "temperatura_almacenamiento",
      label: "Temperatura Almacenamiento",
      required: false,
      category: "Almacén" as const,
      desc: "Ej: 2-8°C, Temperatura ambiente",
      typeLabel: "Texto",
      allowedHint: "Texto (ej: 2-8°C, Ambiente, -20°C)",
    },
    {
      key: "requiere_cadena_frio",
      label: "Cadena de Frío",
      required: false,
      category: "Almacén" as const,
      desc: "Indica refrigeración obligatoria",
      typeLabel: "Booleano",
      allowedHint: "Booleano: 'si' / 'no', 'true' / 'false', '1' / '0'",
    },
    {
      key: "dias_estabilidad_abierto",
      label: "Días Estabilidad Abierto",
      required: false,
      category: "Almacén" as const,
      desc: "Días útil tras apertura",
      typeLabel: "Entero",
      allowedHint: "Número entero de días (ej: 30)",
    },
    {
      key: "clase_riesgo",
      label: "Clase de Riesgo",
      required: false,
      category: "Fabricante" as const,
      desc: "Clase de riesgo dispositivo médico",
      typeLabel: "Texto",
      allowedHint: "Texto (ej: Clase I, Clase IIa, Clase III)",
    },
    {
      key: "fabricante",
      label: "Fabricante",
      required: false,
      category: "Fabricante" as const,
      desc: "Nombre del fabricante",
      typeLabel: "Texto",
      allowedHint: "Texto (ej: BioRad, BD, Axiom)",
    },
    {
      key: "mpn",
      label: "MPN (Código fabricante)",
      required: false,
      category: "Fabricante" as const,
      desc: "Manufacturer Part Number",
      typeLabel: "Texto",
      allowedHint: "Texto / Número de parte",
    },
    {
      key: "es_kit",
      label: "¿Es Kit?",
      required: false,
      category: "Básicos" as const,
      desc: "Indica si es un kit de varios insumos",
      typeLabel: "Booleano",
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
          (field: LabCampoDefinicion) =>
            field.activo && field.alcance === "producto",
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
      notify.error(
        err.response?.data?.mensaje || "Error al crear campo personalizado",
      );
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
    setFile(
      sourceFile ||
        new File(
          [parsedRows.map((r) => r.map(escapeCsvCell).join(",")).join("\n")],
          "importacion.csv",
          { type: "text/csv;charset=utf-8" },
        ),
    );
    setRawCsvRows(parsedRows);
    setRejectionReason("");

    // Auto-mapeo Inteligente con soporte para Excel de Hospitales y Licitaciones
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
      if (
        canonicalKey &&
        Object.prototype.hasOwnProperty.call(newMap, canonicalKey)
      ) {
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

      // 1. Nombre del Producto
      if (
        lower === "nombre del producto" ||
        lower === "producto" ||
        lower.includes("nombre") ||
        lower.includes("descripcion del insumo")
      ) {
        tryBind("nombre", col);
      }
      // 2. Unidad (singular)
      else if (
        lower === "presentacion" ||
        lower === "unidad base singular" ||
        lower === "u" ||
        lower.includes("unidad_base") ||
        (lower.includes("unidad") &&
          !lower.includes("plural") &&
          !lower.includes("por") &&
          !lower.includes("basica"))
      ) {
        tryBind("unidad", col);
      }
      // 3. Unidad Plural
      else if (
        lower === "plural presentacion" ||
        lower === "unidad base plural" ||
        lower.includes("plural")
      ) {
        tryBind("unidad_plural", col);
      }
      // 4. Contenido por Presentación
      else if (
        lower === "unidades por presentacion" ||
        lower.includes("contenido") ||
        lower.includes("factor_conversion")
      ) {
        tryBind("contenido", col);
      }
      // 5. Cantidad Inicial
      else if (
        lower === "unidades basicas a recibir" ||
        lower.startsWith("cantidad") ||
        lower.includes("cantidad_inicial") ||
        lower.includes("stock_inicial")
      ) {
        tryBind("cantidad_inicial", col);
      }
      // 6. Fabricante / Marca
      else if (
        lower === "marca aprobada" ||
        lower === "fabricante" ||
        lower.includes("marca") ||
        lower.includes("fabr")
      ) {
        tryBind("fabricante", col);
      }
      // 7. Ubicación / Lugar Físico
      else if (
        lower === "lugar fisico" ||
        lower === "lugar físico" ||
        lower.includes("ubica") ||
        lower.includes("estant") ||
        lower.includes("bodeg")
      ) {
        tryBind("ubicacion", col);
      }
      // 8. Código Interno (SKU)
      else if (
        lower === "código" ||
        lower === "codigo" ||
        lower.includes("sku") ||
        lower.includes("codigo_interno")
      ) {
        tryBind("codigo_interno", col);
      }
      // 9. Descripción / Comentarios
      else if (
        lower === "comentarios" ||
        lower.includes("descrip") ||
        lower.includes("detall")
      ) {
        tryBind("descripcion", col);
      }
      // 10. Código Proveedor
      else if (
        lower.includes("cod_prov") ||
        lower.includes("codigo_proveedor") ||
        lower.includes("sku_proveedor")
      ) {
        tryBind("codigo_proveedor", col);
      }
      // 11. Proveedor
      else if (lower.includes("prov") || lower.includes("proveedor")) {
        tryBind("proveedor", col);
      }
      // 12. Categoría / Tipo Compra / Adquisición
      else if (
        lower.includes("cat") ||
        lower.includes("grupo") ||
        lower.includes("adquisicion") ||
        lower.includes("adquisición") ||
        lower.includes("tipo de compra")
      ) {
        tryBind("categoria", col);
      }
      // 13. Precio Unitario
      else if (
        lower.includes("prec") ||
        lower.includes("cost")
      ) {
        tryBind("precio_unitario", col);
      }
      // 14. Control de Lote / FV Mínima
      else if (
        lower.includes("fv minima") ||
        lower.includes("vencimiento") ||
        lower.includes("ctrl") ||
        lower.includes("control")
      ) {
        tryBind("control_lote", col);
      }
    });

    setMapping(newMap);
    setStep("MAP");
  };

  // Parser Universal con SheetJS (Soporta .xlsx, .xls, .csv, .tsv con 100% de precisión)
  const parseFileWithSheetJS = async (selectedFile: File) => {
    try {
      const buffer = await selectedFile.arrayBuffer();
      const wb = XLSX.read(buffer, { type: "array", codepage: 65001 });
      const sheetName = wb.SheetNames[0];
      const sheet = wb.Sheets[sheetName];
      const parsedRows = XLSX.utils.sheet_to_json<string[]>(sheet, {
        header: 1,
        defval: "",
        raw: false,
      });

      const cleanRows = parsedRows
        .map((r) => r.map((c) => String(c ?? "").trim()))
        .filter((r) => r.some((c) => c !== ""));

      if (cleanRows.length === 0) {
        throw new Error("El archivo no contiene filas o datos legibles.");
      }

      processParsedRows(cleanRows, selectedFile);
      notify.success(`Cargadas ${cleanRows.length - 1} filas desde "${selectedFile.name}".`);
    } catch (err: any) {
      const message = err.message || "Error al procesar el archivo Excel/CSV";
      setRejectionReason(message);
      notify.error(message);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    const name = selectedFile.name.toLowerCase();
    if (
      !name.endsWith(".csv") &&
      !name.endsWith(".xlsx") &&
      !name.endsWith(".xls") &&
      !name.endsWith(".tsv")
    ) {
      const message =
        "Por favor, sube un archivo CSV o Excel (.xlsx, .xls) válido";
      setRejectionReason(message);
      notify.error(message);
      return;
    }

    parseFileWithSheetJS(selectedFile);
  };

  const handlePasteSubmit = () => {
    if (!pastedText.trim()) {
      notify.error("Por favor, pega contenido de celdas antes de continuar");
      return;
    }
    try {
      const wb = XLSX.read(pastedText.trim(), { type: "string" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const parsedRows = XLSX.utils.sheet_to_json<string[]>(sheet, {
        header: 1,
        defval: "",
        raw: false,
      });

      const cleanRows = parsedRows
        .map((r) => r.map((c) => String(c ?? "").trim()))
        .filter((r) => r.some((c) => c !== ""));

      processParsedRows(cleanRows);
      notify.success(
        `Procesadas ${cleanRows.length - 1} filas desde el portapapeles.`,
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Error al procesar el texto pegado";
      setRejectionReason(message);
      notify.error(message);
    }
  };

  const getMappingConfidence = (targetKey: string, mappedHeader: string) => {
    if (!mappedHeader)
      return {
        score: 0,
        label: "Sin Asignar",
        badgeClass: "badge-warning opacity-60",
      };
    const lower = mappedHeader.toLowerCase().trim();
    if (lower === targetKey || lower.startsWith(`${targetKey} [`)) {
      return {
        score: 100,
        label: "100% Match",
        badgeClass: "badge-success text-success-content",
      };
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
        notify.success("Importación de catálogo completada con éxito");
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

  // Edición Directa de Celdas (Funciona para campos mapeados y no mapeados)
  const handleCellUpdate = (
    rowFila: number,
    systemKey: string,
    newValue: string,
  ) => {
    if (rawCsvRows.length <= 1) return;
    const nextRows = [...rawCsvRows];
    let headerName = mapping[systemKey];

    if (!headerName || !headers.includes(headerName)) {
      // Si la columna no estaba en el archivo, la agregamos dinámicamente
      headerName = systemKey;
      const newHeaders = [...headers, headerName];
      setHeaders(newHeaders);
      setMapping((prev) => ({ ...prev, [systemKey]: headerName }));

      nextRows[0] = newHeaders;
      for (let i = 1; i < nextRows.length; i++) {
        nextRows[i] = [...nextRows[i], i === rowFila ? newValue : ""];
      }
    } else {
      const colIdx = headers.indexOf(headerName);
      if (colIdx !== -1 && rowFila < nextRows.length) {
        const nextRow = [...nextRows[rowFila]];
        nextRow[colIdx] = newValue;
        nextRows[rowFila] = nextRow;
      }
    }

    setRawCsvRows(nextRows);
    const updatedFile = new File(
      [nextRows.map((r) => r.map(escapeCsvCell).join(",")).join("\n")],
      file?.name || "importacion.csv",
      { type: "text/csv;charset=utf-8" },
    );
    setFile(updatedFile);
    setTimeout(() => validateMapping(), 100);
  };

  // Añadir Fila
  const handleAddRow = () => {
    const newRow = headers.map((h) => {
      const lower = h.toLowerCase();
      if (lower.includes("nombre")) return "Nuevo Insumo Laboratorio";
      if (lower.includes("unidad")) return "unidad";
      if (lower.includes("control")) return "con_vto";
      if (lower.includes("cant") || lower.includes("stock")) return "10";
      if (lower.includes("precio") || lower.includes("costo")) return "1000";
      return "";
    });
    const nextRows = [...rawCsvRows, newRow];
    setRawCsvRows(nextRows);
    const updatedFile = new File(
      [nextRows.map((r) => r.map(escapeCsvCell).join(",")).join("\n")],
      file?.name || "importacion.csv",
      { type: "text/csv;charset=utf-8" },
    );
    setFile(updatedFile);
    notify.success("Nueva fila agregada al catálogo.");
    setTimeout(() => validateMapping(), 100);
  };

  // Eliminar Fila
  const handleDeleteRow = (rowFila: number) => {
    if (rowFila <= 0 || rowFila >= rawCsvRows.length) return;
    const nextRows = rawCsvRows.filter((_, idx) => idx !== rowFila);
    setRawCsvRows(nextRows);
    const updatedFile = new File(
      [nextRows.map((r) => r.map(escapeCsvCell).join(",")).join("\n")],
      file?.name || "importacion.csv",
      { type: "text/csv;charset=utf-8" },
    );
    setFile(updatedFile);
    notify.info(`Fila ${rowFila} eliminada.`);
    setTimeout(() => validateMapping(), 100);
  };

  const customMappingFields = customFields.map((field) => {
    let allowedHint = "Texto libre";
    let typeLabel = "Texto";
    if (field.tipo_dato === "booleano") {
      allowedHint = "si / no, true / false, 1 / 0";
      typeLabel = "Booleano";
    } else if (field.tipo_dato === "entero") {
      allowedHint = "Número entero (ej: 42)";
      typeLabel = "Entero";
    } else if (field.tipo_dato === "fecha") {
      allowedHint = "Fecha AAAA-MM-DD (ej: 2026-12-31)";
      typeLabel = "Fecha";
    } else if (field.tipo_dato === "lista" && field.opciones_lista?.length) {
      allowedHint = `Opciones: ${field.opciones_lista.join(", ")}`;
      typeLabel = "Lista";
    }
    return {
      key: `lab_${field.id}`,
      label: field.nombre,
      required: field.requerido,
      category: "Campos del Laboratorio" as const,
      desc: `Campo personalizado (${field.tipo_dato})`,
      typeLabel,
      allowedHint,
    };
  });
  const allFields = [...systemFields, ...customMappingFields];
  const filteredFields = allFields.filter((f) => {
    const matchesSearch =
      f.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
      f.desc.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCat =
      categoryFilter === "TODOS" || f.category === categoryFilter;
    return matchesSearch && matchesCat;
  });

  const errorFilaSet = new Set(errors.map((e) => Number(e.fila)));
  const visiblePreviewRows = previewData.filter((row) => {
    if (previewFilter === "ERRORS_ONLY")
      return errorFilaSet.has(Number(row.fila));
    return true;
  });

  // Mapeo de errores a nivel de celda para resaltar inputs en rojo
  const cellErrorMap = new Map<string, string>();
  errors.forEach((err) => {
    if (err.campo) {
      cellErrorMap.set(`${err.fila}_${err.campo}`, String(err.mensaje || ""));
    }
  });

  const readinessPercent =
    previewData.length > 0
      ? Math.max(
          0,
          Math.round(
            ((previewData.length - errors.length) / previewData.length) * 100,
          ),
        )
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
              Importador Inteligente Pro (Excel & CSV)
            </h1>
            <p className="text-xs opacity-50 font-bold uppercase tracking-widest truncate">
              Soporte Nativo .XLSX / .XLS / .CSV + Asistente IA
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {step === "UPLOAD" && (
            <div className="dropdown dropdown-end">
              <label
                tabIndex={0}
                className="btn btn-sm btn-outline btn-primary rounded-xl gap-2 font-bold"
              >
                <FlaskConical className="w-4 h-4 text-primary" />
                🧪 Probar Escenarios Muestra
              </label>
              <ul
                tabIndex={0}
                className="dropdown-content z-[100] menu p-2 shadow-2xl bg-base-100 rounded-2xl w-80 border border-base-200 mt-2 space-y-1"
              >
                <li>
                  <button
                    onClick={() => handleLoadMockScenario("REAL_LICITACION_XLS")}
                    className="font-bold text-xs py-2 text-primary"
                  >
                    <FileSpreadsheet className="w-4 h-4 text-primary" /> 📊 Documento Real: LICITACIÓN 2026.xls (47 items)
                  </button>
                </li>
                <li>
                  <button
                    onClick={() => handleLoadMockScenario("PERFECT")}
                    className="font-bold text-xs py-2 text-success"
                  >
                    <CheckCircle2 className="w-4 h-4" /> 1. Datos 100% Válidos (7 items)
                  </button>
                </li>
                <li>
                  <button
                    onClick={() => handleLoadMockScenario("ERRORS")}
                    className="font-bold text-xs py-2 text-warning"
                  >
                    <AlertTriangle className="w-4 h-4" /> 2. Datos con Errores (Prueba QA/IA)
                  </button>
                </li>
                <li>
                  <button
                    onClick={() => handleLoadMockScenario("CLINICAL")}
                    className="font-bold text-xs py-2 text-info"
                  >
                    <Sparkles className="w-4 h-4" /> 3. Catálogo Clínico Completo (18 col)
                  </button>
                </li>
              </ul>
            </div>
          )}
          {file && (
            <button
              onClick={() => setShowExplorer(true)}
              className="btn btn-sm btn-outline rounded-xl gap-2 font-bold"
            >
              <Eye className="w-4 h-4" />
              Explorar Archivo
            </button>
          )}
          <button
            onClick={onCancel}
            className="btn btn-circle btn-ghost btn-sm"
          >
            <X className="h-6 w-6" />
          </button>
        </div>
      </header>

      {/* Progress Stepper */}
      <div className="bg-base-200/50 px-8 py-4 flex justify-center border-b border-base-200 overflow-x-auto">
        <div className="flex items-center gap-8 max-w-2xl w-full min-w-max">
          {[
            { id: "UPLOAD", label: "1. Cargar Archivo (Excel/CSV)" },
            { id: "MAP", label: "2. Mapear Columnas" },
            { id: "PREVIEW", label: "3. Previsualización y Edición" },
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
        <div className="max-w-6xl w-full space-y-6">
          {rejectionReason && (
            <div role="alert" className="alert alert-error mb-6">
              <AlertCircle className="h-5 w-5 shrink-0" />
              <span className="break-words">
                <strong>Archivo rechazado:</strong> {rejectionReason}
              </span>
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
                      uploadMode === "FILE" ? "btn-primary" : "btn-ghost",
                    )}
                  >
                    <FileUp className="w-4 h-4" />
                    Subir Archivo (.XLSX / .XLS / .CSV)
                  </button>
                  <button
                    type="button"
                    onClick={() => setUploadMode("PASTE")}
                    className={cn(
                      "btn btn-sm join-item rounded-xl gap-2 font-bold",
                      uploadMode === "PASTE" ? "btn-primary" : "btn-ghost",
                    )}
                  >
                    <Clipboard className="w-4 h-4" />
                    Pegar desde Excel / Sheets
                  </button>
                </div>
              </div>

              {uploadMode === "FILE" ? (
                <div className="min-h-[50vh] flex flex-col items-center justify-center border-2 border-dashed border-base-300 rounded-[3rem] bg-base-200/30 hover:bg-base-200/50 transition-all group relative p-6 text-center">
                  <input
                    ref={fileInputRef}
                    id="smart-importer-csv-file"
                    type="file"
                    accept=".csv,.xlsx,.xls,.tsv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                    onChange={handleFileChange}
                    className="sr-only"
                    aria-label="Seleccionar archivo Excel o CSV"
                  />
                  <div className="p-8 bg-primary/10 rounded-full mb-6 group-hover:scale-110 transition-transform shrink-0">
                    <FileSpreadsheet className="h-16 w-16 text-primary" />
                  </div>
                  <div className="badge badge-primary gap-1 mb-4 font-bold text-xs">
                    Catálogo de Productos y Licitaciones de Laboratorio
                  </div>
                  <h3 className="text-2xl font-black mb-2">
                    Suelte su archivo Excel (.xlsx, .xls) o CSV aquí
                  </h3>
                  <p className="text-sm opacity-60 max-w-md font-medium mb-6">
                    Soporta formatos nativos de planillas de hospitales y licitaciones sin necesidad de convertir a CSV previamente.
                  </p>

                  <div className="flex flex-wrap justify-center gap-3 mb-6">
                    <label
                      htmlFor="smart-importer-csv-file"
                      className="btn btn-primary rounded-2xl gap-2 cursor-pointer font-bold px-6"
                    >
                      <FileUp className="w-4 h-4" />
                      Explorar Excel / CSV
                    </label>

                    <button
                      type="button"
                      onClick={() => handleLoadMockScenario("REAL_LICITACION_XLS")}
                      className="btn btn-outline btn-primary rounded-2xl gap-2 font-bold px-5"
                    >
                      <FileSpreadsheet className="w-4 h-4 text-primary" />
                      Cargar LICITACIÓN 2026.xls (47 items)
                    </button>

                    <button
                      type="button"
                      onClick={() => handleLoadMockScenario("PERFECT")}
                      className="btn btn-outline btn-success rounded-2xl gap-2 font-bold px-5"
                    >
                      <CheckCircle2 className="w-4 h-4 text-success" />
                      Probar Válidos (100%)
                    </button>
                  </div>

                  <div className="flex flex-wrap justify-center gap-2 pt-2 border-t border-base-200 w-full max-w-md">
                    <span className="text-xs opacity-50 font-bold self-center mr-2">
                      Descargar Plantillas Limpias:
                    </span>
                    <button
                      type="button"
                      onClick={() => downloadTemplate("SHORT")}
                      className="btn btn-ghost btn-xs gap-1 font-bold text-primary"
                    >
                      <Download className="w-3.5 h-3.5" /> Plantilla Básica (8
                      col)
                    </button>
                    <button
                      type="button"
                      onClick={() => downloadTemplate("FULL")}
                      className="btn btn-ghost btn-xs gap-1 font-bold opacity-70"
                    >
                      <Download className="w-3.5 h-3.5" /> Completa (20 col)
                    </button>
                  </div>

                  {customFieldsLoaded && customFields.length > 0 && (
                    <div className="mt-3 text-[11px] opacity-70 font-semibold text-success">
                      ✓ {customFields.length} campos de lab integrados a las plantillas
                    </div>
                  )}
                  {customFieldsLoadFailed && (
                    <div className="mt-3 text-[11px] text-error font-semibold">
                      ⚠️ No se pudieron cargar los campos de lab personalizados.
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-6 sm:p-8 border-2 border-primary/20 rounded-[3rem] bg-base-100 shadow-xl space-y-6">
                  <div className="flex items-center gap-3">
                    <div className="p-3 bg-primary/10 rounded-2xl text-primary shrink-0">
                      <Clipboard className="w-6 h-6" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-lg font-black truncate">
                        Pegar celdas directamente desde Excel o Google Sheets
                      </h3>
                      <p className="text-xs opacity-60 font-medium">
                        Copia tus filas en Excel (Ctrl+C) y pégalas aquí.
                      </p>
                    </div>
                  </div>
                  <textarea
                    rows={10}
                    value={pastedText}
                    onChange={(e) => setPastedText(e.target.value)}
                    placeholder={`nombre\tunidad\tstock_minimo\nGlucosa Oxidasa\tunidad\t50\nHemoglobina A1c\tkit\t20`}
                    className="textarea textarea-bordered w-full font-mono text-xs p-4 rounded-2xl bg-base-200/50"
                  />
                  <div className="flex justify-between items-center">
                    <span className="text-xs opacity-50 font-bold">
                      {pastedText
                        ? `${pastedText.split("\n").filter((l) => l.trim()).length} líneas pegadas`
                        : "Esperando contenido..."}
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
                    Relaciona las columnas de tu archivo Excel/CSV con los campos del sistema. El auto-mapeo ha detectado automáticamente las columnas de licitaciones y catálogo.
                  </p>
                </div>
                <div className="flex gap-2 w-full md:w-auto shrink-0">
                  <button
                    onClick={() => setShowExplorer(true)}
                    className="btn btn-outline rounded-2xl gap-2 h-14"
                  >
                    <Eye className="w-4 h-4" /> Explorar Archivo
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
                        <span>Validar e Ir a Edición</span>
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
                      className={cn(
                        "btn btn-xs join-item font-bold gap-1",
                        mappingViewMode === "CARDS"
                          ? "btn-primary"
                          : "btn-ghost",
                      )}
                    >
                      <LayoutGrid className="w-3.5 h-3.5" /> Tarjetas
                    </button>
                    <button
                      onClick={() => setMappingViewMode("MATRIX")}
                      className={cn(
                        "btn btn-xs join-item font-bold gap-1",
                        mappingViewMode === "MATRIX"
                          ? "btn-primary"
                          : "btn-ghost",
                      )}
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
                    <Save className="w-3.5 h-3.5 text-primary" /> Guardar Mapeo
                  </button>
                  <button
                    onClick={loadMappingPreset}
                    className="btn btn-xs btn-outline rounded-xl font-bold gap-1"
                    title="Cargar plantilla de mapeo previamente guardada"
                  >
                    <BookmarkCheck className="w-3.5 h-3.5 text-success" />{" "}
                    Cargar Mapeo
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
                  {(
                    [
                      "TODOS",
                      "Básicos",
                      "Comercial",
                      "Almacén",
                      "Clínicos",
                      "Campos del Laboratorio",
                    ] as CategoryFilter[]
                  ).map((cat) => (
                    <button
                      key={cat}
                      onClick={() => setCategoryFilter(cat)}
                      className={cn(
                        "btn btn-xs rounded-lg font-bold",
                        categoryFilter === cat
                          ? "btn-primary"
                          : "btn-ghost opacity-60",
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
                  <span className="badge badge-primary badge-sm font-bold opacity-80">
                    Asistente IA
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => applyQuickClean("TRIM")}
                    className="btn btn-xs btn-outline rounded-xl font-bold gap-1"
                  >
                    <Sparkles className="w-3 h-3 text-primary" /> Trim Espacios
                  </button>
                  <button
                    type="button"
                    onClick={() => applyQuickClean("BOOLEANS")}
                    className="btn btn-xs btn-outline rounded-xl font-bold gap-1"
                  >
                    <Check className="w-3 h-3 text-success" /> Normalizar
                    Booleans
                  </button>
                  <button
                    type="button"
                    onClick={() => applyQuickClean("DATES")}
                    className="btn btn-xs btn-outline rounded-xl font-bold gap-1"
                  >
                    <RefreshCw className="w-3 h-3 text-info" /> Fechas a ISO
                  </button>
                  <button
                    type="button"
                    onClick={() => applyQuickClean("TITLECASE")}
                    className="btn btn-xs btn-outline rounded-xl font-bold gap-1"
                  >
                    <FileText className="w-3 h-3 text-warning" /> Capitalizar
                  </button>
                </div>
              </section>

              {/* Relleno Global */}
              <section className="p-5 rounded-3xl border border-base-200 bg-base-200/30 space-y-4">
                <div className="flex items-center gap-2 font-black text-sm">
                  <PlusCircle className="w-4 h-4 text-primary" />
                  Rellenar un campo para todas las filas
                </div>
                <p className="text-xs opacity-60">
                  Aplica un valor predeterminado a un campo antes de validar.
                </p>
                <div className="space-y-3">
                  {bulkFills.map((fill) => (
                    <div key={fill.id} className="grid md:grid-cols-[1fr_1fr_auto_auto] gap-3">
                      <select
                        aria-label="Campo de relleno global"
                        className="select select-bordered select-xs w-full rounded-xl font-bold"
                        value={fill.field}
                        onChange={(e) =>
                          setBulkFills((rows) =>
                            rows.map((row) =>
                              row.id === fill.id ? { ...row, field: e.target.value } : row,
                            ),
                          )
                        }
                      >
                        {allFields.map((field) => (
                          <option key={field.key} value={field.key}>
                            {field.label}
                          </option>
                        ))}
                      </select>
                      <input
                        aria-label="Valor de relleno global"
                        className="input input-bordered input-xs w-full rounded-xl font-bold"
                        value={fill.value}
                        onChange={(e) =>
                          setBulkFills((rows) =>
                            rows.map((row) =>
                              row.id === fill.id ? { ...row, value: e.target.value } : row,
                            ),
                          )
                        }
                        placeholder="Valor para aplicar"
                      />
                      <select
                        aria-label="Modo de relleno global"
                        className="select select-bordered select-xs w-full rounded-xl font-bold"
                        value={fill.mode}
                        onChange={(e) =>
                          setBulkFills((rows) =>
                            rows.map((row) =>
                              row.id === fill.id
                                ? { ...row, mode: e.target.value as BulkFill["mode"] }
                                : row,
                            ),
                          )
                        }
                      >
                        <option value="blank_only">Solo vacíos</option>
                        <option value="overwrite_all">Reemplazar todos</option>
                      </select>
                      <button
                        type="button"
                        aria-label="Eliminar relleno global"
                        className="btn btn-ghost btn-xs btn-square rounded-xl"
                        disabled={bulkFills.length === 1}
                        onClick={() =>
                          setBulkFills((rows) => rows.filter((row) => row.id !== fill.id))
                        }
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="btn btn-outline btn-xs gap-1 rounded-xl font-bold"
                    onClick={() => {
                      const id = nextBulkFillId.current++;
                      setBulkFills((rows) => [
                        ...rows,
                        { id, field: "unidad", value: "", mode: "blank_only" },
                      ]);
                    }}
                  >
                    <PlusCircle className="w-3.5 h-3.5" />
                    Agregar campo de relleno
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
                    const sampleVal =
                      mappedColIdx !== -1 && rawCsvRows.length > 1
                        ? rawCsvRows[1][mappedColIdx]
                        : null;

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
                            <div className="flex items-center gap-2 min-w-0 flex-wrap">
                              <span className="font-black text-sm truncate">
                                {field.label}
                              </span>
                              <span className="badge badge-ghost badge-xs font-mono text-[9px]">
                                {field.typeLabel}
                              </span>
                              {field.required && (
                                <span className="badge badge-error badge-xs font-black uppercase tracking-widest text-[8px] shrink-0">
                                  Obligatorio
                                </span>
                              )}
                            </div>
                            <p
                              className="text-xs opacity-60 font-medium truncate mt-0.5"
                              title={field.desc}
                            >
                              {field.desc}
                            </p>
                          </div>

                          <span
                            className={cn(
                              "badge badge-sm font-mono font-bold whitespace-nowrap shrink-0",
                              conf.badgeClass,
                            )}
                          >
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
                            <span className="font-sans font-bold">
                              Muestra Fila 1:
                            </span>
                            <span className="truncate max-w-[160px] font-bold text-primary">
                              {sampleVal || "(Vacío)"}
                            </span>
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
                          <th>Tipo</th>
                          <th>Categoría</th>
                          <th>Match %</th>
                          <th>Columna Asignada</th>
                          <th>Muestra Fila 1</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredFields.map((field) => {
                          const mappedCol = mapping[field.key] || "";
                          const conf = getMappingConfidence(
                            field.key,
                            mappedCol,
                          );
                          const mappedColIdx = headers.indexOf(mappedCol);
                          const sampleVal =
                            mappedColIdx !== -1 && rawCsvRows.length > 1
                              ? rawCsvRows[1][mappedColIdx]
                              : "-";
                          return (
                            <tr key={field.key}>
                              <td className="pl-6 font-bold text-xs">
                                <div className="flex items-center gap-2">
                                  <span>{field.label}</span>
                                  {field.required && (
                                    <span className="badge badge-error badge-xs font-bold text-[8px]">
                                      REQ
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="font-mono text-[10px]">
                                {field.typeLabel}
                              </td>
                              <td>
                                <span className="badge badge-ghost text-[10px] font-bold">
                                  {field.category}
                                </span>
                              </td>
                              <td>
                                <span
                                  className={cn(
                                    "badge badge-xs font-mono font-bold",
                                    conf.badgeClass,
                                  )}
                                >
                                  {conf.label}
                                </span>
                              </td>
                              <td>
                                <select
                                  aria-label={`Columna para ${field.label}`}
                                  className="select select-bordered select-xs w-full max-w-xs font-bold"
                                  value={mappedCol}
                                  onChange={(e) =>
                                    setMapping((prev) => ({
                                      ...prev,
                                      [field.key]: e.target.value,
                                    }))
                                  }
                                >
                                  <option value="">-- No Importar --</option>
                                  {headers.map((h) => (
                                    <option key={h} value={h}>
                                      {h}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td className="font-mono text-xs opacity-60 truncate max-w-[150px]">
                                {sampleVal}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* STEP 3: PREVIEW & INTERACTIVE DIRECT CELL EDITING */}
          {step === "PREVIEW" && (
            <div className="space-y-6 animate-in slide-in-from-right duration-500">
              {/* Dashboard Pre-Flight Indicator con AI Doctor */}
              <div className="p-6 bg-base-100 border border-base-200 rounded-[2.5rem] flex flex-col md:flex-row items-center justify-between gap-6 shadow-sm">
                <div className="flex items-center gap-6">
                  <div className="relative flex items-center justify-center">
                    <div className="w-20 h-20 rounded-full border-4 border-primary/20 border-t-primary flex items-center justify-center">
                      <span className="text-2xl font-black text-primary">
                        {readinessPercent}%
                      </span>
                    </div>
                  </div>
                  <div>
                    <h3 className="text-lg font-black">
                      Diagnóstico de Validación de Datos
                    </h3>
                    <p className="text-xs opacity-60 font-medium">
                      {errors.length === 0
                        ? "¡Los datos están validados y listos para importar!"
                        : `Se detectaron ${errors.length} observaciones que puedes editar en vivo en las celdas abajo o corregir en lote.`}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={handleFixAllErrors}
                    className="btn btn-outline btn-success rounded-2xl gap-2 font-black shadow-sm btn-sm"
                  >
                    <Wand2 className="w-4 h-4 text-success" />
                    <span>✨ Corregir Todo en Lote</span>
                  </button>
                  <button
                    onClick={() => applyQuickClean("AUTO_DOCTOR")}
                    className="btn btn-outline btn-primary rounded-2xl gap-2 font-black shadow-sm btn-sm"
                  >
                    <Stethoscope className="w-4 h-4 text-primary" />
                    <span>⚡ AI Data Doctor</span>
                  </button>
                  {errors.length > 0 && (
                    <button
                      onClick={handleRemoveAllErrorRows}
                      className="btn btn-ghost text-error rounded-2xl gap-1 font-bold btn-sm"
                    >
                      <Trash2 className="w-4 h-4" /> Descartar Errores
                    </button>
                  )}
                </div>
              </div>

              {/* Indicadores en Métricas */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-6 bg-base-100 border border-base-200 rounded-[2.5rem] flex flex-col items-center justify-center text-center shadow-sm">
                  <span className="text-3xl font-black text-primary mb-1">
                    {readinessPercent}%
                  </span>
                  <span className="text-xs opacity-50 font-bold uppercase tracking-wider">
                    Validez
                  </span>
                </div>
                <div className="p-6 bg-base-100 border border-base-200 rounded-[2.5rem] flex flex-col items-center justify-center text-center shadow-sm">
                  <span className="text-3xl font-black text-success mb-1">
                    {previewData.length}
                  </span>
                  <span className="text-xs opacity-50 font-bold uppercase tracking-wider">
                    Filas Aceptadas
                  </span>
                </div>
                <div className="p-6 bg-base-100 border border-base-200 rounded-[2.5rem] flex flex-col items-center justify-center text-center shadow-sm">
                  <span className="text-3xl font-black text-error mb-1">
                    {errors.length}
                  </span>
                  <span className="text-xs opacity-50 font-bold uppercase tracking-wider">
                    Observaciones
                  </span>
                </div>
                <div className="p-6 bg-base-100 border border-base-200 rounded-[2.5rem] flex flex-col items-center justify-center text-center shadow-sm">
                  <span className="text-3xl font-black text-warning mb-1">
                    {warnings.length}
                  </span>
                  <span className="text-xs opacity-50 font-bold uppercase tracking-wider">
                    Advertencias
                  </span>
                </div>
              </div>

              {/* Detalle de Errores con Botón de Solución Inmediata */}
              {errors.length > 0 && (
                <div className="p-6 bg-error/5 border border-error/20 rounded-[2.5rem] space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-error">
                      <AlertCircle className="h-5 w-5 shrink-0" />
                      <h4 className="font-black uppercase tracking-tight">
                        Observaciones Detectadas ({errors.length})
                      </h4>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={handleFixAllErrors}
                        className="btn btn-success btn-xs rounded-xl gap-1 font-bold"
                      >
                        <Wand2 className="w-3.5 h-3.5" /> Corregir Todo
                      </button>
                      <button
                        onClick={validateMapping}
                        disabled={isValidating}
                        className="btn btn-outline btn-error btn-xs rounded-xl gap-1 font-bold"
                      >
                        {isValidating ? (
                          <span className="loading loading-spinner loading-xs" />
                        ) : (
                          <TableIcon className="w-3.5 h-3.5" />
                        )}
                        Re-Validar
                      </button>
                    </div>
                  </div>
                  <div className="max-h-48 overflow-y-auto space-y-2 pr-2">
                    {errors.map((err, i) => (
                      <div
                        key={i}
                        className="flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs font-bold p-3 bg-base-100 rounded-xl border border-base-200 min-w-0"
                      >
                        <div className="flex gap-3 items-center min-w-0">
                          <span className="badge badge-error badge-sm font-mono font-bold shrink-0">
                            Fila {err.fila}
                          </span>
                          <span className="opacity-80 break-words min-w-0">
                            {err.mensaje}
                          </span>
                        </div>
                        {err.campo && (
                          <span className="badge badge-outline badge-sm text-error font-mono shrink-0">
                            Campo: {String(err.campo)}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Botones de Filtro y Confirmación */}
              <div className="flex flex-col md:flex-row justify-between items-center gap-4 bg-base-200/50 p-4 rounded-3xl border border-base-200">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="join">
                    <button
                      onClick={() => setPreviewFilter("ALL")}
                      className={cn(
                        "btn btn-sm join-item font-bold",
                        previewFilter === "ALL" ? "btn-primary" : "btn-ghost",
                      )}
                    >
                      Todas ({previewData.length})
                    </button>
                    <button
                      onClick={() => setPreviewFilter("ERRORS_ONLY")}
                      className={cn(
                        "btn btn-sm join-item font-bold gap-1",
                        previewFilter === "ERRORS_ONLY"
                          ? "btn-error"
                          : "btn-ghost",
                      )}
                    >
                      <Filter className="w-3.5 h-3.5" /> Solo Errores (
                      {errors.length})
                    </button>
                  </div>

                  <div className="join bg-base-100 p-0.5 rounded-xl border border-base-200">
                    <button
                      onClick={() => setPreviewGridMode("COMPACT")}
                      className={cn(
                        "btn btn-xs join-item font-bold",
                        previewGridMode === "COMPACT" ? "btn-primary" : "btn-ghost",
                      )}
                    >
                      Vista Esencial (9 col)
                    </button>
                    <button
                      onClick={() => setPreviewGridMode("EXPANDED")}
                      className={cn(
                        "btn btn-xs join-item font-bold",
                        previewGridMode === "EXPANDED" ? "btn-primary" : "btn-ghost",
                      )}
                    >
                      Vista Completa (Todas)
                    </button>
                  </div>

                  <button
                    onClick={handleAddRow}
                    className="btn btn-sm btn-outline rounded-xl font-bold gap-1"
                  >
                    <Plus className="w-4 h-4 text-primary" /> Agregar Fila
                  </button>
                </div>

                <div className="flex gap-2">
                  {errors.length > 0 && (
                    <button
                      onClick={downloadErrorRows}
                      className="btn btn-outline btn-error btn-sm rounded-xl gap-2 font-bold"
                    >
                      <Download className="w-4 h-4" /> Exportar Errores (.csv)
                    </button>
                  )}
                  <button
                    onClick={runImport}
                    disabled={isImporting || errors.length > 0}
                    className="btn btn-primary rounded-xl gap-2 px-6 font-black"
                  >
                    {isImporting ? (
                      <span className="loading loading-spinner loading-sm" />
                    ) : (
                      <CheckCircle2 className="w-4 h-4" />
                    )}
                    Confirmar Importación Catálogo
                  </button>
                </div>
              </div>

              {/* GRID DE EDICIÓN DIRECTA EN CALIENTE */}
              <div className="rounded-[2.5rem] border border-base-200 overflow-hidden bg-base-100 shadow-sm">
                <div className="px-8 py-4 bg-base-200/50 border-b border-base-200 flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <h4 className="font-black text-sm uppercase tracking-tight truncate">
                      Tabla Interactiva ({visiblePreviewRows.length} filas)
                    </h4>
                  </div>
                  <span className="badge badge-success badge-sm font-bold gap-1 shrink-0">
                    <Edit3 className="w-3 h-3" /> Edición Directa Activada
                  </span>
                </div>
                <div className="overflow-x-auto max-h-[60vh]">
                  <table className="table table-zebra table-sm">
                    <thead>
                      <tr className="text-[10px] uppercase tracking-widest opacity-60 bg-base-200/30">
                        <th className="pl-6">Fila</th>
                        <th>
                          Nombre <span className="text-error">*</span> [Texto]
                        </th>
                        <th>Unidad [Lista]</th>
                        <th>Categoría [Texto]</th>
                        <th>SKU [Texto]</th>
                        <th>Stock Inicial [Nº]</th>
                        <th>Precio [Nº]</th>
                        <th>Control Lote [Opción]</th>
                        <th>Ubicación [Texto]</th>
                        <th>Frío [Booleano]</th>
                        {previewGridMode === "EXPANDED" && (
                          <>
                            <th>Proveedor</th>
                            <th>Código Prov.</th>
                            <th>Estabilidad (Días)</th>
                            <th>Clase Riesgo</th>
                            <th>LOINC/CPT</th>
                            <th>Es Kit</th>
                          </>
                        )}
                        <th className="text-right pr-6">Acción</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visiblePreviewRows.map((row) => {
                        const filaNum = Number(row.fila);
                        const hasErr = errorFilaSet.has(filaNum);

                        const currentNombre = String(row.nombre || "");
                        const currentUnidad = String(
                          row.unidad_base || row.unidad || "",
                        );
                        const currentCategoria = String(row.categoria || "");
                        const currentSku = String(row.codigo_interno || "");
                        const currentCantidad = String(
                          row.cantidad_inicial ||
                            row.stock_inicial ||
                            row.cantidad ||
                            "",
                        );
                        const currentPrecio = String(
                          row.precio_unitario || row.precio || "",
                        );
                        const currentControlLote = String(
                          row.control_lote || "con_vto",
                        );
                        const currentUbicacion = String(row.ubicacion || "");
                        const currentFrio = String(
                          row.requiere_cadena_frio ?? "false",
                        );
                        const currentProveedor = String(row.proveedor || "");
                        const currentCodProv = String(row.codigo_proveedor || "");
                        const currentEstabilidad = String(row.dias_estabilidad_abierto || "");
                        const currentRiesgo = String(row.clase_riesgo || "");
                        const currentLoinc = String(row.codigo_loinc_cpt || "");
                        const currentKit = String(row.es_kit ?? "false");

                        // Errores específicos de celda
                        const errNombre = cellErrorMap.get(`${filaNum}_nombre`);
                        const errPrecio = cellErrorMap.get(`${filaNum}_precio_unitario`);
                        const errControl = cellErrorMap.get(`${filaNum}_control_lote`);

                        return (
                          <tr
                            key={filaNum}
                            className={cn(
                              hasErr && "bg-error/10 hover:bg-error/20",
                            )}
                          >
                            <td className="pl-6 font-mono text-[10px] opacity-40">
                              {row.fila}
                            </td>

                            {/* Nombre Direct Input */}
                            <td className="p-1">
                              <div className="relative">
                                <input
                                  className={cn(
                                    "input input-xs input-bordered w-full font-bold text-xs rounded-lg",
                                    (errNombre || !currentNombre) &&
                                      "input-error bg-error/10 text-error border-error",
                                  )}
                                  value={currentNombre}
                                  onChange={(e) =>
                                    handleCellUpdate(
                                      filaNum,
                                      "nombre",
                                      e.target.value,
                                    )
                                  }
                                  placeholder="Nombre obligatorio..."
                                  title={errNombre || ""}
                                />
                              </div>
                            </td>

                            {/* Unidad Direct Dropdown */}
                            <td className="p-1">
                              <select
                                className="select select-xs select-bordered w-full font-bold text-[11px] rounded-lg"
                                value={currentUnidad.toLowerCase()}
                                onChange={(e) =>
                                  handleCellUpdate(
                                    filaNum,
                                    "unidad",
                                    e.target.value,
                                  )
                                }
                              >
                                <option value="">-- Seleccionar --</option>
                                {UNIDADES_ESTANDAR.map((u) => (
                                  <option key={u} value={u}>
                                    {u}
                                  </option>
                                ))}
                              </select>
                            </td>

                            {/* Categoría Direct Input */}
                            <td className="p-1">
                              <input
                                className="input input-xs input-bordered w-full font-semibold text-xs rounded-lg"
                                value={currentCategoria}
                                onChange={(e) =>
                                  handleCellUpdate(
                                    filaNum,
                                    "categoria",
                                    e.target.value,
                                  )
                                }
                                placeholder="Categoría..."
                              />
                            </td>

                            {/* SKU / Código Interno */}
                            <td className="p-1 w-28">
                              <input
                                className="input input-xs input-bordered w-full font-mono text-xs rounded-lg"
                                value={currentSku}
                                onChange={(e) =>
                                  handleCellUpdate(
                                    filaNum,
                                    "codigo_interno",
                                    e.target.value,
                                  )
                                }
                                placeholder="SKU..."
                              />
                            </td>

                            {/* Cantidad Inicial Input */}
                            <td className="p-1 w-24">
                              <input
                                type="number"
                                className="input input-xs input-bordered w-full font-mono text-xs rounded-lg"
                                value={currentCantidad}
                                onChange={(e) =>
                                  handleCellUpdate(
                                    filaNum,
                                    "cantidad_inicial",
                                    e.target.value,
                                  )
                                }
                                placeholder="0"
                              />
                            </td>

                            {/* Precio Unitario Input */}
                            <td className="p-1 w-28">
                              <input
                                type="text"
                                className={cn(
                                  "input input-xs input-bordered w-full font-mono text-xs rounded-lg",
                                  errPrecio && "input-error bg-error/10 text-error",
                                )}
                                value={currentPrecio}
                                onChange={(e) =>
                                  handleCellUpdate(
                                    filaNum,
                                    "precio_unitario",
                                    e.target.value,
                                  )
                                }
                                placeholder="0"
                                title={errPrecio || ""}
                              />
                            </td>

                            {/* Control Lote Direct Select */}
                            <td className="p-1">
                              <select
                                className={cn(
                                  "select select-xs select-bordered w-full font-semibold text-[11px] rounded-lg",
                                  errControl && "select-error bg-error/10 text-error",
                                )}
                                value={currentControlLote}
                                onChange={(e) =>
                                  handleCellUpdate(
                                    filaNum,
                                    "control_lote",
                                    e.target.value,
                                  )
                                }
                                title={errControl || ""}
                              >
                                <option value="con_vto">
                                  Con Vencimiento
                                </option>
                                <option value="solo_lote">Solo Lote</option>
                                <option value="sin_control">
                                  Sin Control (Simple)
                                </option>
                              </select>
                            </td>

                            {/* Ubicación Direct Input */}
                            <td className="p-1">
                              <input
                                className="input input-xs input-bordered w-full text-xs rounded-lg"
                                value={currentUbicacion}
                                onChange={(e) =>
                                  handleCellUpdate(
                                    filaNum,
                                    "ubicacion",
                                    e.target.value,
                                  )
                                }
                                placeholder="Bodega/Estante..."
                              />
                            </td>

                            {/* Cadena Frío Select */}
                            <td className="p-1 w-20">
                              <select
                                className="select select-xs select-bordered w-full font-semibold text-[11px] rounded-lg"
                                value={currentFrio === "true" ? "true" : "false"}
                                onChange={(e) =>
                                  handleCellUpdate(
                                    filaNum,
                                    "requiere_cadena_frio",
                                    e.target.value,
                                  )
                                }
                              >
                                <option value="false">No</option>
                                <option value="true">Sí</option>
                              </select>
                            </td>

                            {/* Columnas Adicionales de la Vista Expandida */}
                            {previewGridMode === "EXPANDED" && (
                              <>
                                <td className="p-1">
                                  <input
                                    className="input input-xs input-bordered w-full text-xs rounded-lg"
                                    value={currentProveedor}
                                    onChange={(e) =>
                                      handleCellUpdate(filaNum, "proveedor", e.target.value)
                                    }
                                    placeholder="Proveedor..."
                                  />
                                </td>
                                <td className="p-1">
                                  <input
                                    className="input input-xs input-bordered w-full text-xs rounded-lg"
                                    value={currentCodProv}
                                    onChange={(e) =>
                                      handleCellUpdate(filaNum, "codigo_proveedor", e.target.value)
                                    }
                                    placeholder="Cód Prov..."
                                  />
                                </td>
                                <td className="p-1 w-20">
                                  <input
                                    type="number"
                                    className="input input-xs input-bordered w-full text-xs rounded-lg"
                                    value={currentEstabilidad}
                                    onChange={(e) =>
                                      handleCellUpdate(filaNum, "dias_estabilidad_abierto", e.target.value)
                                    }
                                    placeholder="Días..."
                                  />
                                </td>
                                <td className="p-1">
                                  <input
                                    className="input input-xs input-bordered w-full text-xs rounded-lg"
                                    value={currentRiesgo}
                                    onChange={(e) =>
                                      handleCellUpdate(filaNum, "clase_riesgo", e.target.value)
                                    }
                                    placeholder="Clase I/II/III..."
                                  />
                                </td>
                                <td className="p-1">
                                  <input
                                    className="input input-xs input-bordered w-full text-xs rounded-lg"
                                    value={currentLoinc}
                                    onChange={(e) =>
                                      handleCellUpdate(filaNum, "codigo_loinc_cpt", e.target.value)
                                    }
                                    placeholder="LOINC..."
                                  />
                                </td>
                                <td className="p-1 w-20">
                                  <select
                                    className="select select-xs select-bordered w-full text-[11px] rounded-lg"
                                    value={currentKit === "true" ? "true" : "false"}
                                    onChange={(e) =>
                                      handleCellUpdate(filaNum, "es_kit", e.target.value)
                                    }
                                  >
                                    <option value="false">No</option>
                                    <option value="true">Sí</option>
                                  </select>
                                </td>
                              </>
                            )}

                            <td className="text-right pr-6 p-1">
                              <button
                                onClick={() => handleDeleteRow(filaNum)}
                                className="btn btn-ghost btn-xs text-error btn-circle"
                                title="Eliminar esta fila"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Drawer Colapsable de Inspección de Filas Crudas del CSV */}
              <div className="border border-base-200 rounded-3xl bg-base-100 overflow-hidden shadow-sm">
                <button
                  onClick={() => setShowRawDrawer(!showRawDrawer)}
                  className="w-full px-6 py-4 flex items-center justify-between bg-base-200/30 hover:bg-base-200/50 transition-colors font-bold text-xs uppercase tracking-wider"
                >
                  <span className="flex items-center gap-2">
                    <TableIcon className="w-4 h-4 text-primary" />
                    Inspección de Filas Crudas del Archivo ({rawCsvRows.length > 0 ? rawCsvRows.length - 1 : 0} filas)
                  </span>
                  {showRawDrawer ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>
                {showRawDrawer && (
                  <div className="p-4 border-t border-base-200 max-h-60 overflow-auto">
                    <table className="table table-zebra table-sm">
                      <thead>
                        <tr>
                          {headers.map((h, i) => (
                            <th key={i} className="text-[10px] font-bold bg-base-200">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rawCsvRows.slice(1, 20).map((r, i) => (
                          <tr key={i}>
                            {r.map((c, j) => (
                              <td key={j} className="text-xs font-mono">{c}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Modal de Creación Inline de Campo Personalizado del Lab */}
      {showCustomFieldsCreator && (
        <div className="fixed inset-0 bg-black/50 z-[80] flex items-center justify-center p-4">
          <div className="bg-base-100 p-6 rounded-3xl max-w-md w-full space-y-4 shadow-2xl animate-in zoom-in-95 duration-200">
            <h3 className="font-black text-lg">
              Crear Nuevo Campo del Laboratorio
            </h3>
            <p className="text-xs opacity-60">
              Crea una definición de campo para asociar a los productos de tu
              catálogo.
            </p>
            <div className="space-y-3">
              <div>
                <label className="label text-xs font-bold">
                  Nombre del Campo
                </label>
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
              <button
                onClick={() => setShowCustomFieldsCreator(false)}
                className="btn btn-ghost btn-sm"
              >
                Cancelar
              </button>
              <button
                onClick={handleCreateCustomField}
                disabled={isCreatingField || !newFieldName.trim()}
                className="btn btn-primary btn-sm font-bold gap-1"
              >
                {isCreatingField ? (
                  <span className="loading loading-spinner loading-xs" />
                ) : (
                  <PlusCircle className="w-4 h-4" />
                )}
                Crear e Integrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Explorador CSV */}
      {showExplorer && (
        <div className="fixed inset-0 bg-black/50 z-[70] flex items-center justify-center p-8">
          <div className="bg-base-100 p-8 rounded-[3rem] max-w-4xl w-full max-h-[80vh] flex flex-col space-y-4 shadow-2xl">
            <div className="flex justify-between items-center">
              <h3 className="font-black text-lg">
                Explorador de Archivo Original
              </h3>
              <button
                onClick={() => setShowExplorer(false)}
                className="btn btn-circle btn-ghost btn-sm"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 overflow-auto rounded-2xl border border-base-200">
              <table className="table table-zebra table-sm">
                <thead>
                  <tr>
                    {headers.map((h, i) => (
                      <th
                        key={i}
                        className="font-bold text-xs uppercase bg-base-200"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rawCsvRows.slice(1, 30).map((row, rIdx) => (
                    <tr key={rIdx}>
                      {row.map((cell, cIdx) => (
                        <td key={cIdx} className="text-xs font-mono">
                          {cell}
                        </td>
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
