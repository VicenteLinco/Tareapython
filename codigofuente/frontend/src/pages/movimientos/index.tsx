import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useFilterStorage } from "@/hooks/use-filter-storage";
import {
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BarChart3, Download, History, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/ui/data-table";
import { Pagination } from "@/components/ui/pagination";
import api from "@/lib/api";
import type { PaginatedResponse, Movimiento, Area } from "@/types";
import { formatDateTime, formatCantidad, APP_LOCALE } from "@/lib/utils";
import { useAreaStore } from "@/hooks/use-area-store";
import { useFullWidthPage } from "@/components/layout/page-width";

type Tab = "historial" | "tendencias";
type Granularidad = "dia" | "mes" | "trimestre" | "semestre" | "anio";
type PeriodoAnalisis = "mes" | "trimestre" | "semestre" | "anio";
type AgruparPor = "global" | "area" | "producto";

interface ProductoOption {
  id: string;
  nombre: string;
  codigo_interno?: string;
  unidad_base?: {
    nombre: string;
    nombre_plural: string;
  };
}

interface TendenciaRow {
  periodo_inicio: string;
  periodo_label: string;
  area_id: number | null;
  area_nombre: string | null;
  producto_id: string | null;
  producto_nombre: string | null;
  unidad_base_nombre: string | null;
  unidad_base_nombre_plural: string | null;
  cantidad: number | string;
  movimientos: number;
  dias_con_consumo: number;
}

interface TendenciaResponse {
  granularidad: Granularidad;
  agrupar_por: AgruparPor;
  desde: string | null;
  hasta: string | null;
  resumen: {
    total_consumido: number | string;
    total_movimientos: number;
    periodos_con_consumo: number;
    promedio_por_periodo: number | string;
    promedio_por_movimiento: number | string;
  };
  series: TendenciaRow[];
}

const tipoConfig: Record<
  string,
  {
    label: string;
    variant: "success" | "destructive" | "info" | "warning" | "secondary";
  }
> = {
  entrada: { label: "Entrada", variant: "success" },
  salida: { label: "Salida", variant: "destructive" },
  descarte: { label: "Descarte", variant: "destructive" },
  ajuste_pos: { label: "Ajuste (+)", variant: "success" },
  ajuste_neg: { label: "Ajuste (-)", variant: "destructive" },
  transferencia_entrada: { label: "Transferencia (+)", variant: "info" },
  transferencia_salida: { label: "Transferencia (-)", variant: "warning" },
};

const chartColors = [
  "#4f46e5",
  "#0891b2",
  "#16a34a",
  "#f59e0b",
  "#dc2626",
  "#7c3aed",
  "#0f766e",
  "#db2777",
];

const numberFormatter = new Intl.NumberFormat(APP_LOCALE, {
  maximumFractionDigits: 2,
});

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function formatDateISO(date: Date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function currentMonthValue() {
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function monthLabel(date: Date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
}

function toNumber(value: number | string | null | undefined) {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatNumber(value: number | string | null | undefined) {
  return numberFormatter.format(toNumber(value));
}

function csvEscape(value: string | number | null | undefined) {
  const text = String(value ?? "");
  return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadCsv(filename: string, rows: TendenciaRow[]) {
  const header = [
    "periodo",
    "area",
    "producto",
    "cantidad",
    "movimientos",
    "dias_con_consumo",
  ];
  const lines = rows.map((row) =>
    [
      row.periodo_label,
      row.area_nombre ?? "Global",
      row.producto_nombre ?? "",
      toNumber(row.cantidad),
      row.movimientos,
      row.dias_con_consumo,
    ]
      .map(csvEscape)
      .join(";"),
  );
  const blob = new Blob([[header.join(";"), ...lines].join("\n")], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export default function MovimientosPage() {
  useFullWidthPage();
  const selectedAreaId = useAreaStore((s) => s.selectedAreaId);
  const setSelectedArea = useAreaStore((s) => s.setSelectedArea);
  const MOV_DEFAULTS = { tab: "historial" as Tab, tipo: "" };
  const { filters: mf, setFilters: setMf } = useFilterStorage(
    "movimientos",
    MOV_DEFAULTS,
  );
  const tab = mf.tab;
  const tipo = mf.tipo;
  const setTab = (v: Tab) => setMf((f) => ({ ...f, tab: v }));
  const setTipo = (v: string) => setMf((f) => ({ ...f, tipo: v }));
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [areaId, setAreaId] = useState(
    selectedAreaId ? String(selectedAreaId) : "",
  );
  const [page, setPage] = useState(1);

  const currentYear = new Date().getFullYear();
  const currentQuarter = Math.ceil((new Date().getMonth() + 1) / 3);
  const currentSemester = new Date().getMonth() < 6 ? 1 : 2;
  const [periodoAnalisis, setPeriodoAnalisis] =
    useState<PeriodoAnalisis>("mes");
  const [mesAnalisis, setMesAnalisis] = useState(currentMonthValue());
  const [anioAnalisis, setAnioAnalisis] = useState(String(currentYear));
  const [trimestreAnalisis, setTrimestreAnalisis] = useState(
    String(currentQuarter),
  );
  const [semestreAnalisis, setSemestreAnalisis] = useState(
    String(currentSemester),
  );
  const [agruparPor, setAgruparPor] = useState<AgruparPor>("global");
  const [incluirDescartes, setIncluirDescartes] = useState(false);
  const [productoSearch, setProductoSearch] = useState("");
  const [productosSeleccionados, setProductosSeleccionados] = useState<
    ProductoOption[]
  >([]);

  const activeFilterCount = [
    desde && desde !== "",
    hasta && hasta !== "",
    // areaId excluded — it mirrors the global area context filter, not a user-chosen extra filter
    tab === "historial" && tipo && tipo !== "",
    tab === "tendencias" && agruparPor !== "global",
    tab === "tendencias" && incluirDescartes,
    tab === "tendencias" && productosSeleccionados.length > 0,
  ].filter(Boolean).length;

  const periodoConfig = useMemo(() => {
    const year = Number(anioAnalisis) || currentYear;
    if (periodoAnalisis === "mes") {
      const [y, m] = mesAnalisis.split("-").map(Number);
      const start = new Date(y, m - 1, 1);
      const end = new Date(y, m, 0);
      return {
        desde: formatDateISO(start),
        hasta: formatDateISO(end),
        granularidad: "dia" as Granularidad,
        titulo: new Intl.DateTimeFormat(APP_LOCALE, {
          month: "long",
          year: "numeric",
        }).format(start),
      };
    }
    if (periodoAnalisis === "trimestre") {
      const q = Number(trimestreAnalisis) || 1;
      const startMonth = (q - 1) * 3;
      const start = new Date(year, startMonth, 1);
      const end = new Date(year, startMonth + 3, 0);
      return {
        desde: formatDateISO(start),
        hasta: formatDateISO(end),
        granularidad: "dia" as Granularidad,
        titulo: `T${q} ${year}`,
      };
    }
    if (periodoAnalisis === "semestre") {
      const semester = Number(semestreAnalisis) || 1;
      const startMonth = semester === 1 ? 0 : 6;
      const start = new Date(year, startMonth, 1);
      const end = new Date(year, startMonth + 6, 0);
      return {
        desde: formatDateISO(start),
        hasta: formatDateISO(end),
        granularidad: "mes" as Granularidad,
        titulo: `S${semester} ${year}`,
      };
    }
    const start = new Date(year, 0, 1);
    const end = new Date(year, 12, 0);
    return {
      desde: formatDateISO(start),
      hasta: formatDateISO(end),
      granularidad: "mes" as Granularidad,
      titulo: String(year),
    };
  }, [
    anioAnalisis,
    currentYear,
    mesAnalisis,
    periodoAnalisis,
    semestreAnalisis,
    trimestreAnalisis,
  ]);

  useEffect(() => {
    setAreaId(selectedAreaId ? String(selectedAreaId) : "");
    setPage(1);
  }, [selectedAreaId]);

  const { data: areas } = useQuery({
    queryKey: ["areas"],
    queryFn: () => api.get<Area[]>("/areas").then((r) => r.data),
  });

  const { data, isLoading } = useQuery({
    queryKey: ["movimientos", { tipo, desde, hasta, areaId, page }],
    queryFn: () =>
      api
        .get<PaginatedResponse<Movimiento>>("/movimientos", {
          params: {
            tipo: tipo || undefined,
            desde: desde || undefined,
            hasta: hasta || undefined,
            area_id: areaId || undefined,
            page,
            per_page: 30,
          },
        })
        .then((r) => r.data),
    enabled: tab === "historial",
  });

  const { data: productos } = useQuery({
    queryKey: ["productos-analisis", productoSearch],
    queryFn: () =>
      api
        .get<PaginatedResponse<ProductoOption>>("/productos", {
          params: { q: productoSearch || undefined, per_page: 20 },
        })
        .then((r) => r.data.data),
    enabled: tab === "tendencias",
  });

  const { data: tendencias, isLoading: isLoadingTendencias } = useQuery({
    queryKey: [
      "movimientos-tendencias-consumo",
      {
        periodoConfig,
        areaId,
        agruparPor,
        incluirDescartes,
        productosSeleccionados,
      },
    ],
    queryFn: () =>
      api
        .get<TendenciaResponse>("/movimientos/tendencias-consumo", {
          params: {
            desde: periodoConfig.desde,
            hasta: periodoConfig.hasta,
            area_id: areaId || undefined,
            granularidad: periodoConfig.granularidad,
            agrupar_por: agruparPor,
            incluir_descartes: incluirDescartes || undefined,
            producto_ids:
              productosSeleccionados.map((p) => p.id).join(",") || undefined,
          },
        })
        .then((r) => r.data),
    enabled: tab === "tendencias",
  });

  const columns = [
    {
      key: "created_at",
      header: "Fecha",
      render: (item: Movimiento) => (
        <span className="text-xs opacity-60 font-mono">
          {formatDateTime(item.created_at)}
        </span>
      ),
    },
    {
      key: "tipo",
      header: "Tipo",
      render: (item: Movimiento) => {
        const t = tipoConfig[item.tipo] ?? {
          label: item.tipo,
          variant: "secondary" as const,
        };
        return <Badge variant={t.variant}>{t.label}</Badge>;
      },
    },
    {
      key: "producto_nombre",
      header: "Producto",
      render: (item: Movimiento) => (
        <span className="text-sm font-medium">{item.producto_nombre}</span>
      ),
    },
    {
      key: "codigo_lote",
      header: "Lote",
      className: "hidden md:table-cell",
      render: (item: Movimiento) => (
        <span className="font-mono text-xs opacity-50">{item.codigo_lote}</span>
      ),
    },
    {
      key: "cantidad",
      header: "Cantidad",
      render: (item: Movimiento) => {
        const neg = [
          "salida",
          "descarte",
          "ajuste_neg",
          "transferencia_salida",
        ].includes(item.tipo);
        const cantidadEntera = Math.round(item.cantidad);
        const unidadLabel = formatCantidad(
          cantidadEntera,
          item.unidad_base_nombre || "",
          item.unidad_base_nombre_plural ?? undefined,
        )
          .replace(/^[\d.,\s]+/, "")
          .trim();
        return (
          <span
            className={`font-mono font-semibold text-sm ${neg ? "text-error" : "text-success"}`}
          >
            {neg ? "-" : "+"}
            {cantidadEntera}
            <span className="text-[10px] opacity-40 ml-0.5">{unidadLabel}</span>
          </span>
        );
      },
    },
    {
      key: "area_nombre",
      header: "Area",
      className: "hidden lg:table-cell",
      render: (item: Movimiento) => (
        <span className="text-sm opacity-50">{item.area_nombre}</span>
      ),
    },
    {
      key: "usuario_nombre",
      header: "Usuario",
      className: "hidden lg:table-cell",
      render: (item: Movimiento) => (
        <span className="text-xs opacity-40">{item.usuario_nombre}</span>
      ),
    },
  ];

  const chart = useMemo(() => {
    const rows = tendencias?.series ?? [];
    const keys = Array.from(
      new Set(
        rows.map((row) => row.producto_nombre ?? row.area_nombre ?? "Consumo"),
      ),
    );
    const effectiveKeys = keys.length > 0 ? keys : ["Consumo"];
    const byPeriod = new Map<string, Record<string, string | number>>();

    if (periodoConfig.granularidad === "dia") {
      let cursor = new Date(`${periodoConfig.desde}T00:00:00`);
      const end = new Date(`${periodoConfig.hasta}T00:00:00`);
      while (cursor <= end) {
        const label = formatDateISO(cursor);
        byPeriod.set(label, {
          periodo: label.slice(8, 10),
          fecha: label,
          ...Object.fromEntries(effectiveKeys.map((key) => [key, 0])),
        });
        cursor = addDays(cursor, 1);
      }
    } else if (periodoConfig.granularidad === "mes") {
      const start = new Date(`${periodoConfig.desde}T00:00:00`);
      const end = new Date(`${periodoConfig.hasta}T00:00:00`);
      let cursor = new Date(start.getFullYear(), start.getMonth(), 1);
      while (cursor <= end) {
        const label = monthLabel(cursor);
        byPeriod.set(label, {
          periodo: new Intl.DateTimeFormat(APP_LOCALE, {
            month: "short",
          }).format(cursor),
          fecha: label,
          ...Object.fromEntries(effectiveKeys.map((key) => [key, 0])),
        });
        cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
      }
    }

    rows.forEach((row) => {
      const lookupKey =
        periodoConfig.granularidad === "dia" ||
        periodoConfig.granularidad === "mes"
          ? row.periodo_label
          : row.periodo_label;
      const current = byPeriod.get(lookupKey) ?? {
        periodo: row.periodo_label,
        fecha: row.periodo_label,
      };
      current[row.producto_nombre ?? row.area_nombre ?? "Consumo"] = toNumber(
        row.cantidad,
      );
      byPeriod.set(lookupKey, current);
    });
    return { data: Array.from(byPeriod.values()), keys: effectiveKeys };
  }, [
    periodoConfig.desde,
    periodoConfig.granularidad,
    periodoConfig.hasta,
    tendencias,
  ]);

  const ranking = useMemo(() => {
    const totals = new Map<string, number>();
    (tendencias?.series ?? []).forEach((row) => {
      const key = row.producto_nombre ?? row.area_nombre ?? "Global";
      totals.set(key, (totals.get(key) ?? 0) + toNumber(row.cantidad));
    });
    return Array.from(totals.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
  }, [tendencias]);

  const selectedUnit =
    productosSeleccionados.length === 1
      ? (productosSeleccionados[0].unidad_base?.nombre_plural ??
        productosSeleccionados[0].unidad_base?.nombre ??
        "unidades")
      : "unidades";
  const promedioPorPunto =
    chart.data.length > 0
      ? toNumber(tendencias?.resumen.total_consumido) / chart.data.length
      : 0;
  const promedioLabel =
    periodoConfig.granularidad === "dia"
      ? "Promedio diario"
      : "Promedio mensual";

  const addProducto = (producto: ProductoOption) => {
    setProductosSeleccionados((prev) =>
      prev.some((p) => p.id === producto.id) ? prev : [...prev, producto],
    );
    setProductoSearch("");
  };

  const handleClearFilters = () => {
    setDesde("");
    setHasta("");
    setAreaId(selectedAreaId ? String(selectedAreaId) : "");
    setTipo("");
    setAgruparPor("global");
    setIncluirDescartes(false);
    setProductosSeleccionados([]);
    setPage(1);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="t-h1 tracking-tight">Movimientos</h1>
          <p className="text-sm opacity-50 mt-0.5">
            Historial y análisis de consumo
          </p>
        </div>
      </div>

      <div className="min-w-0">
        {/* Contenido principal */}
        <div className="flex-1 min-w-0">
          {/* Toolbar: tabs + botón filtros + export CSV */}
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <div className="tabs tabs-boxed w-fit">
              <button
                className={`tab gap-2 ${tab === "historial" ? "tab-active" : ""}`}
                onClick={() => setTab("historial")}
              >
                <History className="h-4 w-4" /> Historial
              </button>
              <button
                className={`tab gap-2 ${tab === "tendencias" ? "tab-active" : ""}`}
                onClick={() => setTab("tendencias")}
              >
                <BarChart3 className="h-4 w-4" /> Tendencias
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                className="select select-bordered select-sm h-9 w-40"
                value={areaId}
                onChange={(e) => {
                  const val = e.target.value;
                  setAreaId(val);
                  setSelectedArea(val ? Number(val) : null);
                  setPage(1);
                }}
              >
                <option value="">Todas las areas</option>
                {(areas ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.nombre}
                  </option>
                ))}
              </select>

              {tab === "historial" && (
                <>
                  <select
                    className="select select-bordered select-sm h-9 w-36"
                    value={tipo}
                    onChange={(e) => {
                      setTipo(e.target.value);
                      setPage(1);
                    }}
                  >
                    <option value="">Todos los tipos</option>
                    {Object.entries(tipoConfig).map(([value, { label }]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <input
                    type="date"
                    className="input input-bordered input-sm h-9 w-36"
                    value={desde}
                    onChange={(e) => {
                      setDesde(e.target.value);
                      setPage(1);
                    }}
                  />
                  <input
                    type="date"
                    className="input input-bordered input-sm h-9 w-36"
                    value={hasta}
                    onChange={(e) => {
                      setHasta(e.target.value);
                      setPage(1);
                    }}
                  />
                </>
              )}

              {tab === "tendencias" && (
                <>
                  <select
                    className="select select-bordered select-sm h-9 w-32"
                    value={periodoAnalisis}
                    onChange={(e) =>
                      setPeriodoAnalisis(e.target.value as PeriodoAnalisis)
                    }
                  >
                    <option value="mes">Mensual</option>
                    <option value="trimestre">Trimestral</option>
                    <option value="semestre">Semestral</option>
                    <option value="anio">Anual</option>
                  </select>
                  {periodoAnalisis === "mes" ? (
                    <input
                      type="month"
                      className="input input-bordered input-sm h-9 w-36"
                      value={mesAnalisis}
                      onChange={(e) => setMesAnalisis(e.target.value)}
                    />
                  ) : (
                    <input
                      type="number"
                      className="input input-bordered input-sm h-9 w-24"
                      value={anioAnalisis}
                      min="2020"
                      max="2100"
                      onChange={(e) => setAnioAnalisis(e.target.value)}
                    />
                  )}
                  {periodoAnalisis === "trimestre" && (
                    <select
                      className="select select-bordered select-sm h-9 w-20"
                      value={trimestreAnalisis}
                      onChange={(e) => setTrimestreAnalisis(e.target.value)}
                    >
                      <option value="1">T1</option>
                      <option value="2">T2</option>
                      <option value="3">T3</option>
                      <option value="4">T4</option>
                    </select>
                  )}
                  {periodoAnalisis === "semestre" && (
                    <select
                      className="select select-bordered select-sm h-9 w-20"
                      value={semestreAnalisis}
                      onChange={(e) => setSemestreAnalisis(e.target.value)}
                    >
                      <option value="1">S1</option>
                      <option value="2">S2</option>
                    </select>
                  )}
                  <select
                    className="select select-bordered select-sm h-9 w-32"
                    value={agruparPor}
                    onChange={(e) =>
                      setAgruparPor(e.target.value as AgruparPor)
                    }
                  >
                    <option value="global">Global</option>
                    <option value="area">Por área</option>
                    <option value="producto">Por producto</option>
                  </select>
                  <label className="label h-9 cursor-pointer gap-2 py-0">
                    <input
                      type="checkbox"
                      className="checkbox checkbox-sm"
                      checked={incluirDescartes}
                      onChange={(e) => setIncluirDescartes(e.target.checked)}
                    />
                    <span className="label-text text-xs">Descartes</span>
                  </label>
                </>
              )}

              {activeFilterCount > 0 && (
                <button
                  type="button"
                  onClick={handleClearFilters}
                  className="btn btn-ghost btn-sm h-9 px-2 text-xs"
                >
                  Limpiar
                </button>
              )}
            </div>

            <div className="ml-auto flex items-center gap-2">
              {/* Export CSV — solo tendencias */}
              {tab === "tendencias" && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 gap-2"
                  disabled={!tendencias?.series.length}
                  onClick={() =>
                    downloadCsv(
                      `tendencias-consumo-${periodoAnalisis}-${periodoConfig.titulo}.csv`,
                      tendencias?.series ?? [],
                    )
                  }
                >
                  <Download className="h-4 w-4" /> Exportar
                </Button>
              )}
            </div>
          </div>

          {tab === "historial" ? (
            isLoading ? (
              <div className="space-y-1.5">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="skeleton h-12 w-full rounded-lg" />
                ))}
              </div>
            ) : (
              <>
                <DataTable
                  columns={columns}
                  data={data?.data ?? []}
                  emptyMessage="No hay movimientos"
                />
                <Pagination
                  page={data?.page ?? 1}
                  totalPages={data?.total_pages ?? 1}
                  onPageChange={setPage}
                />
              </>
            )
          ) : (
            <div className="space-y-4">
              {/* Buscador de productos */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 opacity-30" />
                <input
                  className="input input-bordered input-sm h-10 w-full pl-9"
                  placeholder="Filtrar por producto o seleccionar varios"
                  value={productoSearch}
                  onChange={(e) => setProductoSearch(e.target.value)}
                />
                {productoSearch && (
                  <div className="app-floating-menu absolute mt-1 max-h-72 w-full overflow-y-auto rounded-box">
                    {(productos ?? []).map((producto) => (
                      <button
                        key={producto.id}
                        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-base-200"
                        onClick={() => addProducto(producto)}
                      >
                        <span className="font-medium">{producto.nombre}</span>
                        <span className="text-xs opacity-40">
                          {producto.codigo_interno}
                        </span>
                      </button>
                    ))}
                    {(productos ?? []).length === 0 && (
                      <div className="px-3 py-2 text-sm opacity-50">
                        Sin resultados
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Chips de productos seleccionados */}
              {productosSeleccionados.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  {productosSeleccionados.map((producto) => (
                    <Badge
                      key={producto.id}
                      variant="secondary"
                      className="gap-1"
                    >
                      {producto.nombre}
                      <button
                        aria-label={`Quitar ${producto.nombre}`}
                        onClick={() =>
                          setProductosSeleccionados((prev) =>
                            prev.filter((p) => p.id !== producto.id),
                          )
                        }
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}

              <div className="grid gap-3 md:grid-cols-4">
                <div className="rounded-lg border border-base-300 bg-base-100 p-4">
                  <p className="text-xs font-medium uppercase opacity-40">
                    Consumo total
                  </p>
                  <p className="mt-1 text-2xl font-bold">
                    {formatNumber(tendencias?.resumen.total_consumido)}{" "}
                    <span className="text-sm font-medium opacity-40">
                      {selectedUnit}
                    </span>
                  </p>
                </div>
                <div className="rounded-lg border border-base-300 bg-base-100 p-4">
                  <p className="text-xs font-medium uppercase opacity-40">
                    {promedioLabel}
                  </p>
                  <p className="mt-1 text-2xl font-bold">
                    {formatNumber(promedioPorPunto)}
                  </p>
                </div>
                <div className="rounded-lg border border-base-300 bg-base-100 p-4">
                  <p className="text-xs font-medium uppercase opacity-40">
                    Promedio movimiento
                  </p>
                  <p className="mt-1 text-2xl font-bold">
                    {formatNumber(tendencias?.resumen.promedio_por_movimiento)}
                  </p>
                </div>
                <div className="rounded-lg border border-base-300 bg-base-100 p-4">
                  <p className="text-xs font-medium uppercase opacity-40">
                    Registros analizados
                  </p>
                  <p className="mt-1 text-2xl font-bold">
                    {formatNumber(tendencias?.resumen.total_movimientos)}
                  </p>
                </div>
              </div>

              <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
                <div className="rounded-lg border border-base-300 bg-base-100 p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="text-sm font-semibold">
                      Consumo punto por punto
                    </h2>
                    <span className="text-xs opacity-40">
                      {periodoConfig.titulo} - {chart.keys.length} serie
                      {chart.keys.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="h-[360px]">
                    {isLoadingTendencias ? (
                      <div className="skeleton h-full w-full rounded-lg" />
                    ) : chart.data.length === 0 ? (
                      <div className="flex h-full items-center justify-center text-sm opacity-40">
                        No hay consumo para los filtros seleccionados
                      </div>
                    ) : (
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={chart.data}>
                          <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                          <XAxis dataKey="periodo" tick={{ fontSize: 12 }} />
                          <YAxis tick={{ fontSize: 12 }} />
                          <Tooltip
                            formatter={(value) => formatNumber(value as number)}
                            labelFormatter={(_, payload) =>
                              payload?.[0]?.payload?.fecha ?? ""
                            }
                          />
                          <Legend />
                          {chart.keys.map((key, index) => (
                            <Line
                              key={key}
                              type="monotone"
                              dataKey={key}
                              stroke={chartColors[index % chartColors.length]}
                              strokeWidth={2.5}
                              dot={{ r: 3, strokeWidth: 2 }}
                              activeDot={{ r: 6, strokeWidth: 2 }}
                              connectNulls
                            />
                          ))}
                        </ComposedChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </div>

                <div className="rounded-lg border border-base-300 bg-base-100 p-4">
                  <h2 className="text-sm font-semibold">Ranking</h2>
                  <div className="mt-3 space-y-3">
                    {ranking.length === 0 ? (
                      <p className="py-12 text-center text-sm opacity-40">
                        Sin datos
                      </p>
                    ) : (
                      ranking.map(([label, value], index) => (
                        <div key={label} className="space-y-1">
                          <div className="flex items-center justify-between gap-3 text-sm">
                            <span className="truncate font-medium">
                              {index + 1}. {label}
                            </span>
                            <span className="font-mono text-xs opacity-60">
                              {formatNumber(value)}
                            </span>
                          </div>
                          <progress
                            className="progress progress-primary h-1.5"
                            value={value}
                            max={ranking[0]?.[1] || 1}
                          />
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
