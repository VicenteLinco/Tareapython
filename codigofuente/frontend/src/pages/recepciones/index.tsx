import { useState, useEffect, useRef } from "react";
import {
  useQuery,
  useMutation,
  useQueryClient,
  keepPreviousData,
} from "@tanstack/react-query";
import {
  Plus,
  Search,
  FileText,
  FileX,
  ChevronLeft,
  ChevronRight,
  Trash2,
  CheckCircle2,
  X,
  Package,
  Upload,
  Printer,
  Image as ImageIcon,
  Download,
} from "lucide-react";
import { useNavigate, Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { PageLoading } from "@/components/ui/page-state";
import { EmptyState } from "@/components/ui/empty-state";
import { EstadoBadge } from "@/components/ui/estado-badge";
import {
  ProveedorSelect,
  ProveedorIcon,
} from "@/components/ui/proveedor-select";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { KeyboardLegend } from "@/components/ui/keyboard-legend";
import { useKeyboardShortcut } from "@/hooks/use-keyboard-shortcut";
import { useCanOperate } from "@/hooks/use-auth-store";
import { Dialog } from "@/components/ui/dialog";
import { LabelsSection } from "./components/labels-section";
import api from "@/lib/api";
import type { Proveedor, RecepcionListItem } from "@/types";
import { formatDate, daysUntil, cn } from "@/lib/utils";
import { CantidadConUnidad } from "@/components/ui/cantidad";
import { notify } from "@/lib/notify";
import { useFilterStorage } from "@/hooks/use-filter-storage";
import { toDecimal, toNum } from "@/domain/parse";
import { AuthenticatedUploadImage } from "@/components/ui/authenticated-image";
import { downloadUpload } from "@/lib/uploads";
import { Skeleton } from "@/components/ui/skeleton";

const PAGE_SIZE = 15;
const PAGE_SIZE_GUIAS = 8;

interface PaginatedRecepciones {
  data: RecepcionListItem[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

type TabActivo = "borradores" | "confirmadas" | "todas" | "guias";

// ── Tipos del detalle ──────────────────────────────────────────────────────

interface RecepcionHeader {
  id: string;
  numero_documento: string;
  proveedor_id: number;
  proveedor_nombre: string;
  proveedor_icono: string | null;
  guia_despacho: string | null;
  estado: string;
  fecha_recepcion: string;
  usuario_nombre: string;
  created_at: string;
}

interface DetalleItem {
  id: number;
  producto_nombre: string;
  numero_lote: string;
  fecha_vencimiento: string;
  presentacion_nombre: string;
  cantidad_presentaciones: string;
  factor_conversion_usado: string;
  cantidad_unidades_base: string;
  unidad_base_nombre: string;
  unidad_base_nombre_plural: string;
  area_destino: string;
  lote_id: string;
  codigo_interno: string;
}

interface RecepcionDetalleResponse {
  recepcion: RecepcionHeader;
  nota: string | null;
  foto_documento: string | null;
  detalle: DetalleItem[];
}

// ── Panel de detalle ───────────────────────────────────────────────────────

interface RecepcionDetailPanelProps {
  recepcionData: RecepcionDetalleResponse | undefined;
  isLoading: boolean;
  onClose: () => void;
  onConfirmar: (id: string) => void;
  onEliminar: (id: string) => void;
  confirmarPending: boolean;
  eliminarPending: boolean;
  onVerFoto: () => void;
  onAdjuntarFoto: () => void;
  onReemplazarFoto: () => void;
  uploadFotoPending: boolean;
  onImprimirEtiquetas?: () => void;
}

function RecepcionDetailPanel({
  recepcionData,
  isLoading,
  onClose,
  onConfirmar,
  onEliminar,
  confirmarPending,
  eliminarPending,
  onVerFoto,
  onAdjuntarFoto,
  onReemplazarFoto,
  uploadFotoPending,
  onImprimirEtiquetas,
}: RecepcionDetailPanelProps) {
  if (isLoading || !recepcionData) {
    return (
      <div className="rounded-xl border border-base-200 bg-base-100 flex items-center justify-center h-64 text-base-content/40">
        <div className="text-center space-y-2">
          <Package className="h-8 w-8 mx-auto opacity-30" />
          <p className="text-sm">
            {isLoading ? "Cargando…" : "Selecciona una recepción"}
          </p>
        </div>
      </div>
    );
  }

  const { recepcion, nota, detalle, foto_documento } = recepcionData;
  const esConfirmada = recepcion.estado !== "borrador";

  return (
    <div className="rounded-xl border border-base-200 bg-base-100 overflow-hidden flex flex-col max-h-[calc(100vh-120px)] shadow-sm">
      {/* Header */}
      <div className="px-4 py-3 border-b border-base-200 flex items-center justify-between gap-2 shrink-0 bg-base-200/20">
        <div className="min-w-0">
          <p className="font-mono font-semibold text-sm leading-tight">
            {recepcion.numero_documento}
          </p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <ProveedorIcon
              proveedor={{
                nombre: recepcion.proveedor_nombre,
                icono: recepcion.proveedor_icono,
              }}
              className="h-3.5 w-3.5 shrink-0 opacity-60"
            />
            <p className="text-xs text-base-content/50 truncate">
              {recepcion.proveedor_nombre}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <EstadoBadge
            estado={
              recepcion.estado === "completa" ? "confirmada" : recepcion.estado
            }
            size="sm"
          />
          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost btn-xs btn-circle"
            aria-label="Cerrar panel"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Body scrolleable */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
        {/* Meta */}
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider opacity-40 mb-0.5">
              Fecha
            </p>
            <p className="font-medium">
              {formatDate(recepcion.fecha_recepcion)}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider opacity-40 mb-0.5">
              Registrado por
            </p>
            <p className="font-medium">{recepcion.usuario_nombre}</p>
          </div>
          {recepcion.guia_despacho && (
            <div className="col-span-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider opacity-40 mb-0.5">
                Guía de despacho
              </p>
              <p className="font-mono font-medium">{recepcion.guia_despacho}</p>
            </div>
          )}
        </div>

        {/* Guía física de respaldo */}
        <div className="border-t border-base-200 pt-3 space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider opacity-45 flex items-center gap-1">
            <FileText className="h-3.5 w-3.5" />
            Guía de despacho (Física)
          </p>

          {foto_documento ? (
            <div className="flex flex-col gap-2">
              <button
                type="button"
                className="btn btn-xs btn-primary font-bold shadow-sm w-full gap-1.5 hover:scale-[1.01] transition-all"
                onClick={onVerFoto}
              >
                <FileText className="h-3.5 w-3.5" />
                Ver Guía de despacho
              </button>
              <button
                type="button"
                className="btn btn-xs btn-outline w-full gap-1.5 hover:scale-[1.01] transition-all"
                onClick={onReemplazarFoto}
                disabled={uploadFotoPending}
              >
                {uploadFotoPending ? (
                  <span className="loading loading-spinner loading-xs" />
                ) : (
                  <Upload className="h-3.5 w-3.5" />
                )}
                Reemplazar foto de la guía
              </button>
            </div>
          ) : (
            <button
              type="button"
              className={cn(
                "btn btn-xs btn-primary font-bold shadow-md w-full gap-1.5 animate-pulse hover:scale-[1.01] transition-all",
                uploadFotoPending && "loading",
              )}
              onClick={onAdjuntarFoto}
              disabled={uploadFotoPending}
            >
              {!uploadFotoPending && <Upload className="h-3.5 w-3.5" />}
              Adjuntar foto de la guía
            </button>
          )}
        </div>

        {/* Etiquetas */}
        <div className="border-t border-base-200 pt-3 space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider opacity-45 flex items-center gap-1">
            <Printer className="h-3.5 w-3.5" />
            Etiquetas de Insumos
          </p>
          <button
            type="button"
            className="btn btn-xs btn-outline w-full gap-1.5 hover:scale-[1.01] transition-all font-semibold"
            onClick={onImprimirEtiquetas}
          >
            <Printer className="h-3.5 w-3.5" />
            Imprimir etiquetas
          </button>
        </div>

        {nota && (
          <div className="rounded-lg bg-warning/10 border border-warning/30 px-3 py-2 text-xs text-warning-content">
            <p className="font-semibold mb-0.5 opacity-60 uppercase text-[10px] tracking-wider">
              Nota
            </p>
            <p>{nota}</p>
          </div>
        )}

        {/* Ítems */}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider opacity-40 mb-2 flex items-center gap-1.5">
            <Package className="h-3 w-3" />
            Ítems recibidos ({detalle.length})
          </p>
          {detalle.length === 0 ? (
            <p className="text-xs opacity-40 text-center py-4">Sin ítems</p>
          ) : (
            <div className="space-y-0 rounded-lg border border-base-200 overflow-hidden">
              {detalle.map((item) => {
                const days = daysUntil(item.fecha_vencimiento);
                const isExpired = days !== null && days <= 0;
                const isSoon = days !== null && days > 0 && days <= 30;
                const qty = toNum(item.cantidad_unidades_base);
                const qtyPres = toDecimal(item.cantidad_presentaciones);
                const factor = toDecimal(item.factor_conversion_usado);
                const qtyPresStr = qtyPres.toDecimalPlaces(2).toString();
                const tienePresent = !factor.eq(1);

                return (
                  <div
                    key={item.id}
                    className="px-3 py-2 border-b border-base-200 last:border-0 flex items-start justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-medium leading-tight truncate">
                        {item.producto_nombre}
                      </p>
                      <p className="text-[10px] font-mono text-base-content/40 mt-0.5">
                        {item.numero_lote}
                      </p>
                      <div className="flex items-center gap-1 mt-0.5">
                        <span
                          className={cn(
                            "text-[10px]",
                            isExpired
                              ? "text-error font-semibold"
                              : isSoon
                                ? "text-warning font-semibold"
                                : "text-base-content/40",
                          )}
                        >
                          {formatDate(item.fecha_vencimiento)}
                        </span>
                        {isExpired && (
                          <Badge
                            variant="destructive"
                            className="text-[10px] py-0 px-1"
                          >
                            Venc.
                          </Badge>
                        )}
                        {isSoon && !isExpired && (
                          <Badge
                            variant="warning"
                            className="text-[10px] py-0 px-1"
                          >
                            {days}d
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      {tienePresent ? (
                        <div className="flex flex-col items-end gap-0.5">
                          <span className="text-xs font-mono font-semibold">
                            {qtyPresStr} {item.presentacion_nombre}
                          </span>
                          <span className="text-[10px] text-base-content/40 font-mono">
                            ={" "}
                            <CantidadConUnidad
                              qty={qty}
                              unidad={item.unidad_base_nombre}
                              pluralUnidad={item.unidad_base_nombre_plural}
                            />
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs font-mono font-semibold">
                          <CantidadConUnidad
                            qty={qty}
                            unidad={item.unidad_base_nombre}
                            pluralUnidad={item.unidad_base_nombre_plural}
                          />
                        </span>
                      )}
                      <p className="text-[10px] text-base-content/40 mt-0.5">
                        {item.area_destino}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Acciones para borradores */}
      {!esConfirmada && (
        <div className="border-t border-base-200 p-3 flex gap-2 shrink-0">
          <button
            className="btn btn-sm btn-success flex-1 gap-1"
            disabled={confirmarPending}
            onClick={() => onConfirmar(recepcion.id)}
          >
            {confirmarPending ? (
              <span className="loading loading-spinner loading-xs" />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5" />
            )}
            Confirmar
          </button>
          <button
            className="btn btn-sm btn-error btn-outline gap-1"
            disabled={eliminarPending}
            onClick={() => onEliminar(recepcion.id)}
          >
            {eliminarPending ? (
              <span className="loading loading-spinner loading-xs" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Página principal ───────────────────────────────────────────────────────

export default function RecepcionesPage() {
  const REC_FILTER_DEFAULTS = {
    tabActivo: "todas" as TabActivo,
    proveedorFiltro: null as number | null,
  };
  const {
    filters: rf,
    setFilters: setRf,
    clearFilters: clearRf,
    hasActiveFilters: hasRfActive,
  } = useFilterStorage("recepciones", REC_FILTER_DEFAULTS);
  const tabActivo = rf.tabActivo;
  const proveedorFiltro = rf.proveedorFiltro;
  const setTabActivo = (v: TabActivo) => setRf((f) => ({ ...f, tabActivo: v }));
  const setProveedorFiltro = (v: number | null) =>
    setRf((f) => ({ ...f, proveedorFiltro: v }));

  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [borradorAEliminar, setBorradorAEliminar] = useState<string | null>(
    null,
  );
  const [borradorItemAEliminar, setBorradorItemAEliminar] =
    useState<RecepcionListItem | null>(null);
  const [fotoOpen, setFotoOpen] = useState(false);
  const [printModalOpen, setPrintModalOpen] = useState(false);

  // --- Estados para Guías Respaldadas ---
  const [guiaSearchInput, setGuiaSearchInput] = useState("");
  const [guiaSearch, setGuiaSearch] = useState("");
  const [pageGuias, setPageGuias] = useState(1);
  const [selectedFotoPath, setSelectedFotoPath] = useState<string | null>(null);
  const [selectedFotoTitle, setSelectedFotoTitle] = useState<string | null>(
    null,
  );

  const navigate = useNavigate();
  const canOperate = useCanOperate();
  const queryClient = useQueryClient();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileInputFirstRef = useRef<HTMLInputElement>(null);

  // Atajos de teclado
  useKeyboardShortcut({
    key: "n",
    onKeyDown: () => navigate("/recepciones/nueva"),
  });
  useKeyboardShortcut({
    key: "Escape",
    ignoreInputs: false,
    onKeyDown: () => {
      if (hasRfActive || search || searchInput) {
        clearRf();
        setSearchInput("");
        setSearch("");
        setPage(1);
      }
    },
  });

  // Debounce search input
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchInput]);

  // Debounce para búsqueda de guías
  useEffect(() => {
    const timer = setTimeout(() => {
      setGuiaSearch(guiaSearchInput);
      setPageGuias(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [guiaSearchInput]);

  // Reset page on tab/filter change
  useEffect(() => {
    setPage(1);
    setSelectedId(null);
  }, [tabActivo, proveedorFiltro]);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: [
      "recepciones",
      { tab: tabActivo, search, proveedorFiltro, page },
    ],
    queryFn: () =>
      api
        .get<PaginatedRecepciones>("/recepciones", {
          params: {
            estado:
              tabActivo === "borradores"
                ? "borrador"
                : tabActivo === "confirmadas"
                  ? "confirmada"
                  : undefined,
            busqueda: search || undefined,
            proveedor_id: proveedorFiltro || undefined,
            per_page: PAGE_SIZE,
            page,
          },
        })
        .then((r) => r.data),
    placeholderData: keepPreviousData,
    enabled: tabActivo !== "guias",
  });

  // --- Query Guías Respaldadas (Recepciones con foto) ---
  const { data: dataGuias, isLoading: isLoadingGuias } = useQuery({
    queryKey: ["guias-respaldadas", { search: guiaSearch, page: pageGuias }],
    queryFn: () =>
      api
        .get<PaginatedRecepciones>("/recepciones", {
          params: {
            solo_con_foto: true,
            busqueda: guiaSearch || undefined,
            page: pageGuias,
            per_page: PAGE_SIZE_GUIAS,
          },
        })
        .then((r) => r.data),
    placeholderData: keepPreviousData,
    enabled: tabActivo === "guias",
  });

  const { data: proveedores } = useQuery({
    queryKey: ["proveedores"],
    queryFn: () => api.get<Proveedor[]>("/proveedores").then((r) => r.data),
  });

  // Query de detalle inline (solo desktop)
  const { data: selectedRecepcion, isLoading: loadingDetalle } = useQuery({
    queryKey: ["recepcion-detalle-inline", selectedId],
    queryFn: () =>
      api
        .get<RecepcionDetalleResponse>(`/recepciones/${selectedId}`)
        .then((r) => r.data),
    enabled: !!selectedId,
  });

  const confirmarMutation = useMutation({
    mutationFn: (id: string) => api.post(`/recepciones/${id}/confirmar`),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ["recepciones"] });
      queryClient.invalidateQueries({
        queryKey: ["recepcion-detalle-inline", id],
      });
      notify.success("Recepción confirmada");
    },
    onError: () => notify.error("Error al confirmar recepción"),
  });

  const eliminarMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/recepciones/${id}`),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ["recepciones"] });
      queryClient.invalidateQueries({
        queryKey: ["recepcion-detalle-inline", id],
      });
      setSelectedId(null);
      notify.success("Borrador eliminado");
    },
    onError: () => notify.error("Error al eliminar borrador"),
  });

  const uploadFotoMut = useMutation({
    mutationFn: (dataUrl: string) =>
      api.put(`/recepciones/${selectedId}/foto`, { data_url: dataUrl }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["recepcion-detalle-inline", selectedId],
      });
      queryClient.invalidateQueries({ queryKey: ["recepciones"] });
      notify.success("Guía de despacho actualizada");
    },
    onError: () => notify.error("No se pudo guardar la foto"),
  });

  function handleFotoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      uploadFotoMut.mutate(ev.target?.result as string);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  const handleRowClick = (id: string) => {
    if (window.innerWidth >= 1024) {
      setSelectedId((prev) => (prev === id ? null : id));
    } else {
      navigate(`/recepciones/${id}`);
    }
  };

  const pageRows = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.total_pages ?? 1;

  const rowsGuias = dataGuias?.data ?? [];
  const totalGuias = dataGuias?.total ?? 0;
  const totalPagesGuias = dataGuias?.total_pages ?? 1;

  const tabs: { key: TabActivo; label: string }[] = [
    { key: "borradores", label: "Borradores" },
    { key: "confirmadas", label: "Confirmadas" },
    { key: "todas", label: "Todas" },
    { key: "guias", label: "Guías Respaldadas" },
  ];

  return (
    <div
      className={cn("flex gap-6 items-start", (selectedId && tabActivo !== "guias") && "lg:items-stretch")}
    >
      {/* ── Columna izquierda: lista ── */}
      <div
        className={cn(
          "min-w-0 transition-all duration-200 space-y-4",
          (selectedId && tabActivo !== "guias") ? "lg:flex-[3]" : "w-full",
        )}
      >
        <div className="flex items-center justify-between">
          <h1 className="t-h1">Recepciones</h1>
          <div className="flex items-center gap-2">
            <KeyboardLegend
              shortcuts={[
                { keys: ["n"], description: "Nueva recepción" },
                { keys: ["Esc"], description: "Limpiar búsqueda" },
              ]}
            />
            {canOperate && (
              <button
                className="btn btn-primary"
                onClick={() => navigate("/recepciones/nueva")}
              >
                <Plus className="h-4 w-4" />
                Nueva Recepción
              </button>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div role="tablist" className="tabs tabs-boxed w-fit">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              role="tab"
              className={`tab ${tabActivo === tab.key ? "tab-active" : ""}`}
              onClick={() => setTabActivo(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Filtros */}
        {tabActivo !== "guias" && (
          <div className="rounded-xl border border-base-200 bg-base-100 p-3 flex flex-wrap gap-2 items-end">
            {/* Buscador */}
            <fieldset className="fieldset p-0 gap-1 min-w-[200px] flex-1">
              <legend className="fieldset-legend text-[10px]">Buscar</legend>
              <label className="input input-bordered flex items-center gap-2 h-9">
                <Search className="h-3.5 w-3.5 opacity-40 shrink-0" />
                <input
                  type="text"
                  className="grow text-sm min-w-0"
                  placeholder="N° doc, proveedor, guía…"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                />
                {isFetching && (
                  <span className="loading loading-spinner loading-xs opacity-40" />
                )}
              </label>
            </fieldset>

            {/* Proveedor */}
            <fieldset className="fieldset p-0 gap-1">
              <legend className="fieldset-legend text-[10px]">Proveedor</legend>
              <ProveedorSelect
                value={proveedorFiltro ? String(proveedorFiltro) : ""}
                onChange={(v) => setProveedorFiltro(v ? Number(v) : null)}
                proveedores={proveedores ?? []}
                allLabel="Todos"
                className="w-44 h-9"
                size="md"
              />
            </fieldset>

            {(hasRfActive || search) && (
              <button
                onClick={() => {
                  clearRf();
                  setSearchInput("");
                  setSearch("");
                  setPage(1);
                }}
                className="flex items-center gap-1 px-3 py-1.5 rounded-xl border border-base-300 text-xs font-bold text-base-content/60 hover:text-error hover:border-error/40 transition-all self-end mb-0.5"
              >
                <X className="w-3 h-3" />
                Limpiar filtros
              </button>
            )}
          </div>
        )}

        {tabActivo === "guias" ? (
          <div className="space-y-4 animate-fadeIn">
            {/* Barra de búsqueda */}
            <div className="rounded-2xl border border-base-200 bg-base-100 p-3 shadow-sm flex items-center max-w-md">
              <Search className="h-4 w-4 opacity-40 shrink-0 mr-2" />
              <input
                type="text"
                placeholder="Buscar por N° guía, proveedor o recepción..."
                className="grow text-sm bg-transparent outline-none border-none"
                value={guiaSearchInput}
                onChange={(e) => setGuiaSearchInput(e.target.value)}
              />
              {guiaSearchInput && (
                <button
                  onClick={() => setGuiaSearchInput("")}
                  className="btn btn-ghost btn-xs btn-circle"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            {/* Galería Visual */}
            {isLoadingGuias ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                {[1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    className="card bg-base-100 border border-base-200 overflow-hidden rounded-2xl shadow-sm space-y-3 p-0"
                  >
                    <Skeleton className="h-40 w-full rounded-t-2xl rounded-b-none" />
                    <div className="p-4 space-y-2">
                      <Skeleton className="h-4 w-2/3 rounded-lg" />
                      <Skeleton className="h-3 w-1/2 rounded-lg" />
                      <Skeleton className="h-8 w-full rounded-xl mt-3" />
                    </div>
                  </div>
                ))}
              </div>
            ) : rowsGuias.length === 0 ? (
              <div className="rounded-[2rem] border border-base-200 bg-base-100 p-12 text-center shadow-sm">
                <ImageIcon className="w-12 h-12 mx-auto mb-3 opacity-20 text-primary" />
                <h3 className="font-bold text-base mb-1">
                  No se encontraron guías respaldadas
                </h3>
                <p className="text-sm opacity-40 max-w-md mx-auto">
                  {guiaSearch
                    ? "Ajusta los filtros de búsqueda o ingresa un término diferente."
                    : "Aún no se han adjuntado fotos de guías de despacho en las recepciones."}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                {rowsGuias.map((guia) => (
                  <div
                    key={guia.id}
                    className="card bg-base-100 border border-base-200 overflow-hidden rounded-2xl shadow-sm hover:shadow-md transition-all duration-200 group flex flex-col"
                  >
                    {/* Thumbnail */}
                    <div className="relative h-40 w-full overflow-hidden bg-base-200 shrink-0">
                      {guia.guia_despacho_archivo ? (
                        <AuthenticatedUploadImage
                          path={guia.guia_despacho_archivo}
                          alt={`Guía ${guia.guia_despacho}`}
                          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                        />
                      ) : (
                        <div className="flex items-center justify-center h-full text-base-content/30">
                          <ImageIcon className="h-8 w-8" />
                        </div>
                      )}
                      <div className="absolute top-2 right-2">
                        <span className="badge badge-sm bg-base-100/90 text-[10px] font-bold shadow-sm py-2 px-2.5 border-none">
                          {guia.proveedor_nombre}
                        </span>
                      </div>
                    </div>

                    {/* Info */}
                    <div className="p-4 flex-1 flex flex-col justify-between space-y-3">
                      <div className="space-y-1">
                        <div className="flex items-start justify-between gap-1">
                          <div className="min-w-0">
                            <p className="text-[10px] uppercase font-bold tracking-wider opacity-45">
                              N° Guía
                            </p>
                            <h3
                              className="font-mono font-bold text-sm text-primary truncate"
                              title={guia.guia_despacho ?? ""}
                            >
                              {guia.guia_despacho || "PROVISIONAL"}
                            </h3>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-[10px] uppercase font-bold tracking-wider opacity-45">
                              Recepción
                            </p>
                            <Link
                              to={`/recepciones/${guia.id}`}
                              className="font-mono font-bold text-xs hover:underline text-base-content/70"
                            >
                              {guia.numero_documento}
                            </Link>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-2 border-t border-base-200 text-[11px] text-base-content/50">
                        <span>{formatDate(guia.fecha_recepcion)}</span>
                        <span
                          className="truncate max-w-[110px]"
                          title={guia.usuario_nombre}
                        >
                          {guia.usuario_nombre}
                        </span>
                      </div>

                      {guia.guia_despacho_archivo && (
                        <button
                          type="button"
                          className="btn btn-xs btn-primary font-bold w-full gap-1.5 shadow-sm hover:scale-[1.01] transition-all"
                          onClick={() => {
                            setSelectedFotoPath(guia.guia_despacho_archivo);
                            setSelectedFotoTitle(
                              guia.guia_despacho || guia.numero_documento,
                            );
                          }}
                        >
                          <FileText className="h-3.5 w-3.5" />
                          Ver Documento
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Paginación Guías */}
            {!isLoadingGuias && rowsGuias.length > 0 && (
              <div className="flex items-center justify-between text-sm pt-4">
                <span className="opacity-50 text-xs">
                  {totalGuias} resultado{totalGuias !== 1 ? "s" : ""} · página{" "}
                  {pageGuias} de {totalPagesGuias}
                </span>
                <div className="join">
                  <button
                    className="join-item btn btn-sm btn-ghost"
                    onClick={() => setPageGuias((p) => Math.max(1, p - 1))}
                    disabled={pageGuias === 1}
                  >
                    <ChevronLeft className="h-4 w-4" />
                    Anterior
                  </button>
                  <button
                    className="join-item btn btn-sm btn-ghost"
                    onClick={() =>
                      setPageGuias((p) => Math.min(totalPagesGuias, p + 1))
                    }
                    disabled={pageGuias >= totalPagesGuias}
                  >
                    Siguiente
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : isLoading ? (
          <PageLoading label="Cargando recepciones..." />
        ) : (
          <>
            <div className="rounded-xl border border-base-200 overflow-hidden">
              <table className="table table-sm w-full">
                <thead className="bg-base-200/60 text-xs uppercase tracking-wider">
                  <tr>
                    <th className="font-semibold opacity-60">N° Documento</th>
                    <th className="font-semibold opacity-60">Proveedor</th>
                    <th className="font-semibold opacity-60">Fecha</th>
                    <th className="font-semibold opacity-60 hidden md:table-cell">
                      Usuario
                    </th>
                    <th className="font-semibold opacity-60">Estado</th>
                    <th className="font-semibold opacity-60 w-4"></th>
                    {tabActivo === "borradores" && (
                      <th className="font-semibold opacity-60 text-right">
                        Acciones
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {pageRows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={tabActivo === "borradores" ? 7 : 6}
                        className="py-6"
                      >
                        <EmptyState
                          contexto="sin_recepciones"
                          titulo={
                            tabActivo === "borradores"
                              ? "Sin borradores"
                              : tabActivo === "confirmadas"
                                ? "Sin recepciones confirmadas"
                                : "Sin recepciones registradas"
                          }
                          descripcion={
                            tabActivo === "borradores"
                              ? "No tienes ninguna recepción en borrador."
                              : tabActivo === "confirmadas"
                                ? "No hay recepciones confirmadas registradas."
                                : "Ajusta los filtros o registra la primera recepción."
                          }
                          className="border-none bg-transparent p-6"
                        />
                      </td>
                    </tr>
                  ) : (
                    pageRows.map((item) => (
                      <tr
                        key={item.id}
                        className={cn(
                          "hover:bg-base-200/30 border-base-200/60 cursor-pointer transition-colors",
                          selectedId === item.id &&
                            "bg-primary/5 border-l-2 border-l-primary",
                        )}
                        onClick={() => handleRowClick(item.id)}
                      >
                        <td>
                          <span className="font-mono text-sm font-medium">
                            {item.numero_documento}
                          </span>
                        </td>
                        <td>
                          <div className="flex items-center gap-2">
                            <ProveedorIcon
                              proveedor={{
                                nombre: item.proveedor_nombre,
                                icono: item.proveedor_icono,
                              }}
                              className="h-5 w-5"
                            />
                            <span className="text-sm">
                              {item.proveedor_nombre}
                            </span>
                          </div>
                        </td>
                        <td className="text-sm">
                          {formatDate(item.fecha_recepcion)}
                        </td>
                        <td className="text-sm hidden md:table-cell">
                          {item.usuario_nombre}
                        </td>
                        <td>
                          <div className="flex flex-col gap-0.5">
                            <EstadoBadge
                              estado={
                                item.estado === "completa"
                                  ? "confirmada"
                                  : item.estado
                              }
                              size="sm"
                            />
                            {/* Badge items/lotes */}
                            {item.items_count > 0 && (
                              <span className="text-[10px] text-base-content/40 font-medium">
                                {item.items_count}{" "}
                                {item.items_count === 1 ? "item" : "items"} ·{" "}
                                {item.lotes_count}{" "}
                                {item.lotes_count === 1 ? "lote" : "lotes"}
                              </span>
                            )}
                          </div>
                        </td>
                        <td>
                          {/* Completitud para borradores */}
                          {item.estado === "borrador" ? (
                            item.items_count > 0 &&
                            item.lotes_count >= item.items_count ? (
                              <span className="text-[10px] font-bold text-success flex items-center gap-1">
                                <CheckCircle2 className="h-3 w-3" /> Listo
                              </span>
                            ) : (
                              <span
                                className="text-[10px] font-bold text-warning flex items-center gap-1"
                                title="Faltan lotes en algunos items"
                              >
                                ⚠ Incompleto
                              </span>
                            )
                          ) : item.tiene_foto ? (
                            <FileText className="h-4 w-4 text-primary/60" />
                          ) : (
                            <FileX className="h-4 w-4 text-base-content/20" />
                          )}
                        </td>
                        {tabActivo === "borradores" && (
                          <td
                            className="text-right"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="flex items-center justify-end gap-1">
                              <button
                                className="btn btn-xs btn-success gap-1"
                                disabled={
                                  confirmarMutation.isPending ||
                                  (item.items_count > 0 &&
                                    item.lotes_count < item.items_count)
                                }
                                title={
                                  item.items_count > 0 &&
                                  item.lotes_count < item.items_count
                                    ? "Faltan lotes en algunos items"
                                    : undefined
                                }
                                onClick={() =>
                                  confirmarMutation.mutate(item.id)
                                }
                              >
                                <CheckCircle2 className="h-3 w-3" />
                                Confirmar
                              </button>
                              <button
                                className="btn btn-xs btn-ghost text-error"
                                disabled={eliminarMutation.isPending}
                                onClick={() => {
                                  setBorradorAEliminar(item.id);
                                  setBorradorItemAEliminar(item);
                                }}
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Paginación */}
            <div className="flex items-center justify-between text-sm">
              <span className="opacity-50 text-xs">
                {total} resultado{total !== 1 ? "s" : ""} · página {page} de{" "}
                {totalPages}
              </span>
              <div className="join">
                <button
                  className="join-item btn btn-sm btn-ghost"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                {(() => {
                  const pages: (number | null)[] = [];
                  if (totalPages <= 7) {
                    for (let i = 1; i <= totalPages; i++) pages.push(i);
                  } else {
                    pages.push(1);
                    if (page > 3) pages.push(null);
                    for (
                      let i = Math.max(2, page - 1);
                      i <= Math.min(totalPages - 1, page + 1);
                      i++
                    )
                      pages.push(i);
                    if (page < totalPages - 2) pages.push(null);
                    pages.push(totalPages);
                  }
                  return pages.map((p, i) =>
                    p === null ? (
                      <button
                        key={`ellipsis-${i}`}
                        className="join-item btn btn-sm btn-ghost btn-disabled"
                      >
                        …
                      </button>
                    ) : (
                      <button
                        key={p}
                        className={`join-item btn btn-sm ${p === page ? "btn-primary" : "btn-ghost"}`}
                        onClick={() => setPage(p)}
                      >
                        {p}
                      </button>
                    ),
                  );
                })()}
                <button
                  className="join-item btn btn-sm btn-ghost"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── Panel detalle: solo desktop, solo cuando hay selección ── */}
      {selectedId && tabActivo !== "guias" && (
        <div className="hidden lg:flex lg:flex-[2] lg:sticky lg:top-24 self-start flex-col min-w-0">
          <RecepcionDetailPanel
            recepcionData={selectedRecepcion}
            isLoading={loadingDetalle}
            onClose={() => setSelectedId(null)}
            onConfirmar={(id) => confirmarMutation.mutate(id)}
            onEliminar={(id) => {
              const item = pageRows.find((r) => r.id === id) ?? null;
              setBorradorAEliminar(id);
              setBorradorItemAEliminar(item);
            }}
            confirmarPending={confirmarMutation.isPending}
            eliminarPending={eliminarMutation.isPending}
            onVerFoto={() => setFotoOpen(true)}
            onAdjuntarFoto={() => fileInputFirstRef.current?.click()}
            onReemplazarFoto={() => {
              if (
                window.confirm(
                  "La foto actual será reemplazada permanentemente. ¿Deseas continuar?",
                )
              ) {
                fileInputRef.current?.click();
              }
            }}
            uploadFotoPending={uploadFotoMut.isPending}
            onImprimirEtiquetas={() => setPrintModalOpen(true)}
          />
        </div>
      )}

      {/* Confirmar eliminación de borrador */}
      <ConfirmDialog
        open={borradorAEliminar !== null}
        onClose={() => {
          setBorradorAEliminar(null);
          setBorradorItemAEliminar(null);
        }}
        onConfirm={() => {
          if (borradorAEliminar) eliminarMutation.mutate(borradorAEliminar);
          setBorradorAEliminar(null);
          setBorradorItemAEliminar(null);
        }}
        loading={eliminarMutation.isPending}
        title="Eliminar borrador"
        description="Esta acción eliminará el borrador permanentemente."
        confirmLabel="Eliminar"
        variant="danger"
        impacto={[
          ...(borradorItemAEliminar?.numero_documento
            ? [
                {
                  label: "Documento",
                  valor: borradorItemAEliminar.numero_documento,
                },
              ]
            : []),
          ...(borradorItemAEliminar?.proveedor_nombre
            ? [
                {
                  label: "Proveedor",
                  valor: borradorItemAEliminar.proveedor_nombre,
                },
              ]
            : []),
          ...(borradorItemAEliminar && borradorItemAEliminar.items_count > 0
            ? [
                {
                  label: "Ítems",
                  valor: `${borradorItemAEliminar.items_count} ${borradorItemAEliminar.items_count === 1 ? "item" : "items"} · ${borradorItemAEliminar.lotes_count} ${borradorItemAEliminar.lotes_count === 1 ? "lote" : "lotes"}`,
                },
              ]
            : []),
        ]}
      />

      {/* Inputs de foto ocultos */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFotoFile}
      />
      <input
        ref={fileInputFirstRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFotoFile}
      />

      {/* Lightbox foto */}
      {fotoOpen && selectedRecepcion?.foto_documento && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
          onClick={() => setFotoOpen(false)}
        >
          <div
            className="relative max-h-[90vh] max-w-[90vw]"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="absolute -right-3 -top-3 btn btn-circle btn-sm btn-error z-10"
              onClick={() => setFotoOpen(false)}
            >
              <X className="h-4 w-4" />
            </button>
            <AuthenticatedUploadImage
              path={selectedRecepcion.foto_documento}
              alt="Guía de despacho"
              className="max-h-[85vh] max-w-[85vw] rounded-xl shadow-2xl object-contain"
            />
          </div>
        </div>
      )}

      {printModalOpen && selectedRecepcion && (
        <Dialog
          open={printModalOpen}
          onClose={() => setPrintModalOpen(false)}
          title="Reimprimir etiquetas"
        >
          <div className="mt-1 text-xs text-base-content/60 mb-4 font-medium">
            Configura el formato y cantidad de etiquetas para imprimir los lotes
            de esta recepción.
          </div>
          <LabelsSection
            lotesConfirmados={selectedRecepcion.detalle.map((item) => ({
              lote_id: item.lote_id,
              codigo_interno: item.codigo_interno,
              numero_lote: item.numero_lote,
              fecha_vencimiento: item.fecha_vencimiento,
              producto_nombre: item.producto_nombre,
              presentacion_nombre: item.presentacion_nombre,
              area_nombre: item.area_destino,
              cantidad_etiquetas: 1,
            }))}
          />
          <div className="mt-4 border-t border-base-200 pt-3">
            <button
              className="btn btn-outline btn-sm w-full text-xs font-semibold py-2"
              onClick={() => setPrintModalOpen(false)}
            >
              Cerrar
            </button>
          </div>
        </Dialog>
      )}

      {/* Lightbox para visor de fotos de guías de despacho (Galería) */}
      {selectedFotoPath && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 transition-opacity"
          onClick={() => {
            setSelectedFotoPath(null);
            setSelectedFotoTitle(null);
          }}
        >
          <div
            className="relative max-h-[90vh] max-w-[90vw]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="absolute -top-12 left-0 right-0 flex items-center justify-between text-white px-2">
              <span className="font-semibold text-sm">
                Guía: {selectedFotoTitle}
              </span>
              <div className="flex items-center gap-2">
                <button
                  className="btn btn-sm btn-primary gap-1.5 font-bold"
                  onClick={() =>
                    downloadUpload(
                      selectedFotoPath,
                      `guia-${selectedFotoTitle ?? "despacho"}.jpg`,
                    )
                  }
                >
                  <Download className="h-4 w-4" />
                  Descargar
                </button>
                <button
                  className="btn btn-circle btn-sm btn-error"
                  onClick={() => {
                    setSelectedFotoPath(null);
                    setSelectedFotoTitle(null);
                  }}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <AuthenticatedUploadImage
              path={selectedFotoPath}
              alt="Guía de despacho"
              className="max-h-[80vh] max-w-[85vw] rounded-xl shadow-2xl object-contain border border-base-200/20"
            />
          </div>
        </div>
      )}
    </div>
  );
}
