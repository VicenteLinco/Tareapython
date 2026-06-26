import { useState, useRef, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { Html5Qrcode } from "html5-qrcode";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Pencil,
  Trash2,
  Search,
  Eye,
  Tag,
  FileText,
  RotateCcw,
  Copy,
  Download,
  LayoutGrid,
  Table2,
  PackagePlus,
  X,
  AlertCircle,
} from "lucide-react";
import { comprimirImagen } from "@/lib/image-utils";
import { ProductoImage } from "@/components/ui/producto-image";
import { DataTable } from "@/components/ui/data-table";
import { PageLoading } from "@/components/ui/page-state";
import { Badge } from "@/components/ui/badge";
import { Pagination } from "@/components/ui/pagination";
import { Dialog } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Sheet } from "@/components/ui/sheet";
import api from "@/lib/api";
import { parseApiError } from "@/lib/api-error";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";
import { PresentacionesManager } from "./presentaciones-manager";
import type {
  PaginatedResponse,
  Categoria,
  UnidadBasica,
  Area,
  CreateProducto,
  UpdateProducto,
  ControlLote,
} from "@/types";
import { CONTROL_LOTE_OPTIONS, controlLoteHelp } from "@/lib/control-lote";

// Matches actual backend response for the list endpoint
interface ProductoListItem {
  id: string;
  codigo_interno: string | null;
  nombre: string;
  categoria: { id: number; nombre: string } | null;
  unidad_base: { id: number; nombre: string; nombre_plural: string };
  area: { id: number; nombre: string } | null;
  lead_time_propio: number | null;
  activo: boolean;
  estado_stock?: "activo" | "inactivo" | "pendiente_inicializar" | "sin_stock";
  imagen_url?: string | null;
  mpn?: string | null;
  alias_unidad_clinica?: string | null;
  codigo_loinc_cpt?: string | null;
  es_kit?: boolean;
  stock_minimo_global?: number;
  version: number;
}

interface ProductoDetailResponse {
  id: string;
  codigo_interno: string | null;
  nombre: string;
  descripcion: string | null;
  categoria_id?: number | null;
  categoria?: { id: number; nombre: string } | null;
  categoria_nombre?: string | null;
  unidad_base?: { id: number; nombre: string; nombre_plural?: string } | null;
  areas: { id: number; nombre: string }[];
  pres_codigo_barras: string | null;
  imagen_url: string | null;
  ubicacion: string | null;
  temperatura_almacenamiento: string | null;
  requiere_cadena_frio: boolean;
  dias_estabilidad_abierto: number | null;
  clase_riesgo: string | null;
  control_lote: ControlLote;
  fabricante: string | null;
  mpn?: string | null;
  alias_unidad_clinica?: string | null;
  codigo_loinc_cpt?: string | null;
  es_kit?: boolean;
  stock_minimo_global?: number;
  activo: boolean;
  version: number;
  codigos_barras?: { id: number; codigo: string }[];
}


// ── Helpers ─────────────────────────────────────────────────

function productoEstadoBadge(item: ProductoListItem) {
  if (item.estado_stock === "pendiente_inicializar") {
    return <Badge variant="warning">Pendiente inicializar</Badge>;
  }
  if (item.estado_stock === "sin_stock") {
    return <Badge variant="destructive">Sin stock</Badge>;
  }
  return item.activo ? (
    <Badge variant="success">Activo</Badge>
  ) : (
    <Badge variant="outline">Inactivo</Badge>
  );
}

function productoEstadoTexto(item: ProductoListItem) {
  if (item.estado_stock === "pendiente_inicializar")
    return "Pendiente inicializar";
  if (item.estado_stock === "sin_stock") return "Sin stock";
  return item.activo ? "Activo" : "Inactivo";
}


function isValidEan13(value: string) {
  if (!/^\d{13}$/.test(value)) return false;
  const digits = value.split("").map(Number);
  const check = digits.pop()!;
  const sum = digits.reduce((acc, n, i) => acc + n * (i % 2 === 0 ? 1 : 3), 0);
  return (10 - (sum % 10)) % 10 === check;
}

export default function ProductosTab() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [searchActiveIndex, setSearchActiveIndex] = useState(-1);
  const [searchDropdownOpen, setSearchDropdownOpen] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const searchItemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [categoriaId, setCategoriaId] = useState("");
  const [areaId, setAreaId] = useState("");
  const [verInactivos, setVerInactivos] = useState(false);
  const [sortBy, setSortBy] = useState("nombre");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [viewMode, setViewMode] = useState<"tabla" | "tarjetas">("tabla");
  const [page, setPage] = useState(1);

  const [createOpen, setCreateOpen] = useState(
    () => searchParams.get("nuevo") === "true",
  );
  const [duplicateSource, setDuplicateSource] =
    useState<ProductoDetailResponse | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProductoListItem | null>(
    null,
  );
  const [reactivateTarget, setReactivateTarget] =
    useState<ProductoListItem | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: [
      "productos",
      {
        search,
        categoriaId,
        areaId,
        page,
        activo: !verInactivos,
        sortBy,
        sortDir,
      },
    ],
    queryFn: () =>
      api
        .get<PaginatedResponse<ProductoListItem>>("/productos", {
          params: {
            q: search || undefined,
            categoria_id: categoriaId || undefined,
            area_id: areaId || undefined,
            activo: !verInactivos,
            sort_by: sortBy,
            sort_dir: sortDir,
            page,
            per_page: 20,
          },
        })
        .then((r) => r.data),
  });

  const { data: categorias } = useQuery({
    queryKey: ["categorias"],
    queryFn: () => api.get<Categoria[]>("/categorias").then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });

  const { data: unidades } = useQuery({
    queryKey: ["unidades-basicas"],
    queryFn: () =>
      api.get<UnidadBasica[]>("/unidades-basicas").then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });

  const { data: areas } = useQuery({
    queryKey: ["areas"],
    queryFn: () => api.get<Area[]>("/areas").then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });


  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/productos/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["productos"] });
      notify.success("Producto desactivado");
      setDeleteTarget(null);
    },
    onError: (err) => notify.error(parseApiError(err)),
  });

  const reactivarMut = useMutation({
    mutationFn: (id: string) => api.post(`/productos/${id}/reactivar`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["productos"] });
      notify.success("Producto reactivado");
      setReactivateTarget(null);
    },
    onError: (err) => notify.error(parseApiError(err)),
  });

  const columns = [
    {
      key: "nombre",
      header: "Nombre completo",
      width: "320px",
      render: (item: ProductoListItem) => (
        <div
          className={`flex flex-col min-w-0 w-full overflow-hidden ${!item.activo ? "opacity-50" : ""}`}
          title={item.nombre}
        >
          <p className="font-medium text-sm truncate">{item.nombre}</p>
          {item.codigo_interno && (
            <p className="text-[10px] font-mono opacity-35 truncate">
              {item.codigo_interno}
            </p>
          )}
        </div>
      ),
    },
    {
      key: "categoria",
      header: "Categoría",
      className: "hidden md:table-cell",
      render: (item: ProductoListItem) => (
        <span
          className={`text-sm opacity-50 ${!item.activo ? "opacity-30" : ""}`}
        >
          {item.categoria?.nombre || "--"}
        </span>
      ),
    },
    {
      key: "area",
      header: "Área / Sección",
      className: "hidden lg:table-cell",
      render: (item: ProductoListItem) =>
        item.area ? (
          <Badge
            variant="secondary"
            className={!item.activo ? "opacity-50" : ""}
          >
            {item.area.nombre}
          </Badge>
        ) : (
          <span className="text-sm opacity-30">--</span>
        ),
    },
    {
      key: "unidad_base",
      header: "Unidad",
      render: (item: ProductoListItem) => (
        <span
          className={`font-mono text-sm bg-base-200 px-2 py-0.5 rounded ${!item.activo ? "opacity-50" : ""}`}
        >
          {item.unidad_base.nombre}
        </span>
      ),
    },
    {
      key: "activo",
      header: "Estado",
      render: (item: ProductoListItem) => productoEstadoBadge(item),
    },
    {
      key: "acciones",
      header: "",
      className: "w-28",
      render: (item: ProductoListItem) => (
        <div
          className="flex gap-1 justify-end"
          onClick={(e) => e.stopPropagation()}
        >
          {item.activo ? (
            <>
              {item.estado_stock === "pendiente_inicializar" && (
                <button
                  className="btn btn-ghost btn-xs btn-square text-warning"
                  title="Inicializar stock — crear primera recepción"
                  onClick={() => {
                    const params = new URLSearchParams({
                      producto_id: item.id,
                    });
                    navigate(`/recepciones/nueva?${params.toString()}`);
                  }}
                >
                  <PackagePlus className="h-3.5 w-3.5" />
                </button>
              )}
              <button
                className="btn btn-ghost btn-xs btn-square"
                onClick={() => setDetailId(item.id)}
              >
                <Eye className="h-3.5 w-3.5 opacity-50" />
              </button>
              <button
                className="btn btn-ghost btn-xs btn-square"
                onClick={() => setEditId(item.id)}
              >
                <Pencil className="h-3.5 w-3.5 opacity-50" />
              </button>
              <button
                className="btn btn-ghost btn-xs btn-square"
                title="Duplicar"
                onClick={async () => {
                  const res = await api.get<ProductoDetailResponse>(
                    `/productos/${item.id}`,
                  );
                  setDuplicateSource(res.data);
                  setCreateOpen(true);
                }}
              >
                <Copy className="h-3.5 w-3.5 opacity-50" />
              </button>
              <button
                className="btn btn-ghost btn-xs btn-square"
                onClick={() => setDeleteTarget(item)}
              >
                <Trash2 className="h-3.5 w-3.5 opacity-50 hover:text-error" />
              </button>
            </>
          ) : (
            <button
              className="btn btn-ghost btn-xs btn-square"
              title="Reactivar"
              onClick={() => setReactivateTarget(item)}
            >
              <RotateCcw className="h-3.5 w-3.5 opacity-60 text-primary" />
            </button>
          )}
        </div>
      ),
    },
  ];

  const productos = data?.data ?? [];

  function csvEscape(value: string | number | null | undefined) {
    const text = value == null ? "" : String(value);
    return `"${text.replace(/"/g, '""')}"`;
  }

  function exportCurrentCsv() {
    const header = [
      "codigo",
      "nombre",
      "categoria",
      "area",
      "unidad",
      "estado",
    ];
    const lines = productos.map((p) =>
      [
        p.codigo_interno,
        p.nombre,
        p.categoria?.nombre,
        p.area?.nombre,
        p.unidad_base.nombre,
        productoEstadoTexto(p),
      ]
        .map(csvEscape)
        .join(";"),
    );
    const blob = new Blob([[header.join(";"), ...lines].join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "productos.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  useEffect(() => {
    setSearchActiveIndex(-1);
  }, [search]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        searchContainerRef.current &&
        !searchContainerRef.current.contains(e.target as Node)
      )
        setSearchDropdownOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    if (searchActiveIndex >= 0)
      searchItemRefs.current[searchActiveIndex]?.scrollIntoView({
        block: "nearest",
      });
  }, [searchActiveIndex]);

  const searchSuggestions = productos.slice(0, 16);
  const showSearchDropdown = searchDropdownOpen && searchSuggestions.length > 0;

  const groupedSearchItems = (() => {
    const result: (
      | { type: "header"; letter: string }
      | { type: "item"; item: (typeof productos)[number]; idx: number }
    )[] = [];
    let lastL = "";
    searchSuggestions.forEach((item, idx) => {
      const l = item.nombre[0]?.toUpperCase() ?? "#";
      if (l !== lastL) {
        result.push({ type: "header", letter: l });
        lastL = l;
      }
      result.push({ type: "item", item, idx });
    });
    return result;
  })();

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!searchDropdownOpen) setSearchDropdownOpen(true);
      if (searchSuggestions.length === 0) return;
      setSearchActiveIndex((i) =>
        i < searchSuggestions.length - 1 ? i + 1 : 0,
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (searchSuggestions.length === 0) return;
      setSearchActiveIndex((i) =>
        i > 0 ? i - 1 : searchSuggestions.length - 1,
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (searchActiveIndex >= 0 && searchSuggestions[searchActiveIndex]) {
        setSearch(searchSuggestions[searchActiveIndex].nombre);
        setPage(1);
        setSearchDropdownOpen(false);
        setSearchActiveIndex(-1);
      }
    } else if (e.key === "Escape") {
      setSearchDropdownOpen(false);
      setSearchActiveIndex(-1);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2.5 justify-between">
        <div className="flex flex-wrap gap-2.5 flex-1">
          <div
            ref={searchContainerRef}
            className="relative flex-1 min-w-[200px] max-w-sm"
          >
            <label className="input input-bordered input-sm flex items-center gap-2 h-9 w-full">
              <Search className="h-3.5 w-3.5 opacity-35 shrink-0" />
              <input
                type="text"
                className="grow text-sm"
                placeholder="Buscar producto..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                  setSearchDropdownOpen(true);
                }}
                onKeyDown={handleSearchKeyDown}
                onFocus={() => setSearchDropdownOpen(true)}
                aria-autocomplete="list"
                aria-expanded={showSearchDropdown}
              />
            </label>
            {showSearchDropdown && (
              <div
                className="absolute top-full left-0 right-0 mt-1 z-50 bg-base-100 border border-base-200 rounded-xl shadow-lg overflow-y-auto max-h-72"
                role="listbox"
              >
                {groupedSearchItems.map((entry) =>
                  entry.type === "header" ? (
                    <div
                      key={`h-${entry.letter}`}
                      className="px-3 py-0.5 text-[10px] font-bold uppercase tracking-widest text-base-content/30 bg-base-200/40 sticky top-0"
                    >
                      {entry.letter}
                    </div>
                  ) : (
                    <div
                      key={entry.item.id}
                      ref={(el) => {
                        searchItemRefs.current[entry.idx] = el;
                      }}
                      role="option"
                      aria-selected={entry.idx === searchActiveIndex}
                      className={cn(
                        "flex items-center justify-between px-3 py-2 cursor-pointer text-sm transition-colors",
                        entry.idx === searchActiveIndex
                          ? "bg-primary/10 text-primary"
                          : "hover:bg-base-200/60",
                      )}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setSearch(entry.item.nombre);
                        setPage(1);
                        setSearchDropdownOpen(false);
                        setSearchActiveIndex(-1);
                      }}
                    >
                      <span className="font-medium truncate">
                        {entry.item.nombre}
                      </span>
                      {entry.item.codigo_interno && (
                        <span className="text-[10px] font-mono opacity-40 shrink-0 ml-2">
                          #{entry.item.codigo_interno}
                        </span>
                      )}
                    </div>
                  ),
                )}
              </div>
            )}
          </div>
          <select
            className="select select-bordered select-sm h-9 w-40 text-sm"
            value={categoriaId}
            onChange={(e) => {
              setCategoriaId(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Categoría</option>
            {categorias?.map((c) => (
              <option key={c.id} value={String(c.id)}>
                {c.nombre}
              </option>
            ))}
          </select>
          <select
            className="select select-bordered select-sm h-9 w-40 text-sm"
            value={areaId}
            onChange={(e) => {
              setAreaId(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Área / Sección</option>
            {areas?.map((a) => (
              <option key={a.id} value={String(a.id)}>
                {a.nombre}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              className="checkbox checkbox-xs checkbox-primary"
              checked={verInactivos}
              onChange={(e) => {
                setVerInactivos(e.target.checked);
                setPage(1);
              }}
            />
            <span className="text-xs opacity-60">Ver inactivos</span>
          </label>
          <select
            className="select select-bordered select-sm h-9 w-36 text-sm"
            value={sortBy}
            onChange={(e) => {
              setSortBy(e.target.value);
              setPage(1);
            }}
          >
            <option value="nombre">Nombre</option>
            <option value="codigo">Código</option>
            <option value="categoria">Categoría</option>
            <option value="estado">Estado</option>
          </select>
          <button
            type="button"
            className="btn btn-sm btn-ghost h-9"
            onClick={() => {
              setSortDir(sortDir === "asc" ? "desc" : "asc");
              setPage(1);
            }}
          >
            {sortDir === "asc" ? "Asc" : "Desc"}
          </button>
        </div>
        <div className="flex gap-1.5">
          <button
            className="btn btn-ghost btn-sm btn-square"
            title={viewMode === "tabla" ? "Ver tarjetas" : "Ver tabla"}
            onClick={() =>
              setViewMode(viewMode === "tabla" ? "tarjetas" : "tabla")
            }
          >
            {viewMode === "tabla" ? (
              <LayoutGrid className="h-4 w-4" />
            ) : (
              <Table2 className="h-4 w-4" />
            )}
          </button>
          <button
            className="btn btn-ghost btn-sm btn-square"
            title="Exportar CSV"
            onClick={exportCurrentCsv}
          >
            <Download className="h-4 w-4" />
          </button>
          <button
            className="btn btn-primary btn-sm gap-1.5"
            onClick={() => {
              setDuplicateSource(null);
              setCreateOpen(true);
            }}
          >
            <Plus className="h-4 w-4" />
            Nuevo producto
          </button>
        </div>
      </div>

      {isLoading ? (
        <PageLoading label="Cargando productos..." />
      ) : (
        <>
          {viewMode === "tabla" ? (
            <DataTable
              columns={columns}
              data={data?.data ?? []}
              emptyMessage="No hay productos registrados"
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {productos.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="text-left border border-base-300 rounded-lg p-3 bg-base-100 hover:bg-base-200/60 transition-colors"
                  onClick={() => setDetailId(item.id)}
                >
                  <div className="flex gap-3">
                    <ProductoImage src={item.imagen_url ?? null} size="md" />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-sm truncate">
                        {item.nombre}
                      </p>
                      <p className="text-[10px] font-mono opacity-40 truncate">
                        {item.codigo_interno ?? "--"}
                      </p>
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {item.categoria && (
                          <Badge variant="secondary">
                            {item.categoria.nombre}
                          </Badge>
                        )}
                        {productoEstadoBadge(item)}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
          <Pagination
            page={data?.page ?? 1}
            totalPages={data?.total_pages ?? 1}
            onPageChange={setPage}
          />
        </>
      )}

      <CreateProductoDialog
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
          if (searchParams.get("nuevo")) {
            const next = new URLSearchParams(searchParams);
            next.delete("nuevo");
            setSearchParams(next, { replace: true });
          }
        }}
        categorias={categorias ?? []}
        unidades={unidades ?? []}
        areas={areas ?? []}
        duplicateSource={duplicateSource}
        onViewDetail={(id) => {
          setDetailId(id);
          setCreateOpen(false);
        }}
      />

      {editId && (
        <EditProductoDialog
          open={!!editId}
          onClose={() => setEditId(null)}
          productoId={editId}
          categorias={categorias ?? []}
          areas={areas ?? []}
        />
      )}

      <Sheet
        open={!!detailId}
        onClose={() => setDetailId(null)}
        title="Detalle de producto"
      >
        {detailId && <ProductoDetail id={detailId} />}
      </Sheet>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Desactivar producto"
        description={`¿Estás seguro de desactivar "${deleteTarget?.nombre}"? Esta acción no se puede deshacer si tiene stock activo.`}
        confirmLabel="Desactivar"
        loading={deleteMut.isPending}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deleteMut.mutate(deleteTarget.id)}
      />

      <ConfirmDialog
        open={!!reactivateTarget}
        title="Reactivar producto"
        description={`¿Quieres volver a activar el producto "${reactivateTarget?.nombre}"?`}
        confirmLabel="Reactivar"
        variant="warning"
        loading={reactivarMut.isPending}
        onClose={() => setReactivateTarget(null)}
        onConfirm={() =>
          reactivateTarget && reactivarMut.mutate(reactivateTarget.id)
        }
      />
    </div>
  );
}

// ── Quick-create mini forms ──────────────────────────────────

function QuickCreateCategoria({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (c: Categoria) => void;
}) {
  const queryClient = useQueryClient();
  const [nombre, setNombre] = useState("");
  const mut = useMutation({
    mutationFn: () =>
      api.post<Categoria>("/categorias", { nombre: nombre.trim() }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["categorias"] });
      notify.success("Categoría creada");
      onCreated(res.data);
      setNombre("");
    },
    onError: (err) => notify.error(parseApiError(err)),
  });
  return (
    <Dialog open={open} onClose={onClose} title="Nueva categoría">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (nombre.trim()) mut.mutate();
        }}
        className="space-y-4"
      >
        <div className="form-control">
          <label className="label">
            <span className="label-text text-sm font-medium">Nombre *</span>
          </label>
          <input
            type="text"
            className="input input-bordered input-sm h-9"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Ej: Reactivos"
            autoFocus
            required
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
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
            disabled={mut.isPending}
          >
            {mut.isPending ? (
              <span className="loading loading-spinner loading-xs" />
            ) : (
              "Crear"
            )}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function QuickCreateUnidad({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (u: UnidadBasica) => void;
}) {
  const queryClient = useQueryClient();
  const [f, setF] = useState({ nombre: "", nombre_plural: "" });
  const mut = useMutation({
    mutationFn: () =>
      api.post<UnidadBasica>("/unidades-basicas", {
        nombre: f.nombre.trim(),
        nombre_plural: f.nombre_plural.trim(),
      }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["unidades-basicas"] });
      notify.success("Unidad creada");
      onCreated(res.data);
      setF({ nombre: "", nombre_plural: "" });
    },
    onError: (err) => notify.error(parseApiError(err)),
  });
  return (
    <Dialog open={open} onClose={onClose} title="Nueva unidad básica">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (f.nombre.trim() && f.nombre_plural.trim()) mut.mutate();
        }}
        className="space-y-4"
      >
        <div className="grid grid-cols-2 gap-3">
          <div className="form-control">
            <label className="label">
              <span className="label-text text-sm font-medium">Singular *</span>
            </label>
            <input
              type="text"
              className="input input-bordered input-sm h-9"
              value={f.nombre}
              onChange={(e) => setF((p) => ({ ...p, nombre: e.target.value }))}
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
              value={f.nombre_plural}
              onChange={(e) =>
                setF((p) => ({ ...p, nombre_plural: e.target.value }))
              }
              placeholder="Ej: placas"
              required
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
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
            disabled={mut.isPending}
          >
            {mut.isPending ? (
              <span className="loading loading-spinner loading-xs" />
            ) : (
              "Crear"
            )}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function QuickCreateArea({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (a: Area) => void;
}) {
  const queryClient = useQueryClient();
  const [nombre, setNombre] = useState("");
  const mut = useMutation({
    mutationFn: () => api.post<Area>("/areas", { nombre: nombre.trim() }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["areas"] });
      notify.success("Área creada");
      onCreated(res.data);
      setNombre("");
    },
    onError: (err) => notify.error(parseApiError(err)),
  });
  return (
    <Dialog open={open} onClose={onClose} title="Nueva área">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (nombre.trim()) mut.mutate();
        }}
        className="space-y-4"
      >
        <div className="form-control">
          <label className="label">
            <span className="label-text text-sm font-medium">Nombre *</span>
          </label>
          <input
            type="text"
            className="input input-bordered input-sm h-9"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Ej: PCR"
            autoFocus
            required
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
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
            disabled={mut.isPending}
          >
            {mut.isPending ? (
              <span className="loading loading-spinner loading-xs" />
            ) : (
              "Crear"
            )}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

// ── Barcode Scanner ──────────────────────────────────────────

function BarcodeScanner({
  onScan,
  onClose,
}: {
  onScan: (code: string) => void;
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const onScanRef = useRef(onScan);
  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    const timer = setTimeout(async () => {
      try {
        const scanner = new Html5Qrcode("barcode-scanner-viewport");
        scannerRef.current = scanner;
        await scanner.start(
          { facingMode: "environment" },
          {
            fps: 15,
            qrbox: { width: 250, height: 120 },
            aspectRatio: 1.777778,
          },
          (decoded) => {
            onScanRef.current(decoded);
          },
          () => {},
        );
      } catch (err) {
        console.error("Barcode scanner error:", err);
        setError(
          "No se pudo acceder a la cámara o el navegador no es compatible.",
        );
      }
    }, 100);

    return () => {
      clearTimeout(timer);
      if (scannerRef.current) {
        const s = scannerRef.current;
        if (s.isScanning) {
          s.stop()
            .catch(() => {})
            .finally(() => s.clear());
        } else {
          s.clear();
        }
      }
    };
  }, []);

  return (
    <div className="space-y-3">
      {error ? (
        <p className="text-sm text-warning py-6 text-center">{error}</p>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-base-content/50 text-center">
            Apunta la cámara al código de barras
          </p>
          <div
            id="barcode-scanner-viewport"
            className="w-full rounded-lg overflow-hidden bg-black"
            style={{ minHeight: "220px" }}
          />
        </div>
      )}
      <div className="flex justify-end">
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onClose}
        >
          Cerrar
        </button>
      </div>
    </div>
  );
}

// ── Create Dialog ────────────────────────────────────────────

function CreateProductoDialog({
  open,
  onClose,
  categorias,
  unidades,
  areas,
  duplicateSource,
  onViewDetail,
}: {
  open: boolean;
  onClose: () => void;
  categorias: Categoria[];
  unidades: UnidadBasica[];
  areas: Area[];
  duplicateSource?: ProductoDetailResponse | null;
  onViewDetail?: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const [, setSearchParams] = useSearchParams();

  const [form, setForm] = useState({
    nombre: "",
    descripcion: "",
    categoria_id: "",
    unidad_base_id: "",
    area_id: "",
    ubicacion: "",
    control_lote: "con_vto" as ControlLote,
    fabricante: "",
    mpn: "",
    alias_unidad_clinica: "",
    codigo_loinc_cpt: "",
    es_kit: false,
    stock_minimo_global: "",
    pres_codigo_barras: "",
    imagen_data_url: null as string | null,
  });

  const [temperaturaAlmacenamiento, setTemperaturaAlmacenamiento] = useState<
    string | null
  >(null);
  const [requiereCadenaFrio, setRequiereCadenaFrio] = useState(false);
  const [diasEstabilidadAbierto, setDiasEstabilidadAbierto] = useState<
    number | null
  >(null);
  const [claseRiesgo, setClaseRiesgo] = useState<string | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);

  const [newCatOpen, setNewCatOpen] = useState(false);
  const [newUnidadOpen, setNewUnidadOpen] = useState(false);
  const [newAreaOpen, setNewAreaOpen] = useState(false);

  // Autocomplete and duplicate warning states
  const [lookupLoading, setLookupLoading] = useState(false);
  const [duplicateWarning, setDuplicateWarning] = useState<{
    id: string;
    nombre: string;
    codigo_interno: string;
    estado_catalogo: "pendiente_aprobacion" | "aprobado";
  } | null>(null);

  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  const performGtinLookup = async (code: string) => {
    if (!code) return;
    setLookupLoading(true);
    setDuplicateWarning(null);
    try {
      const { data: res } = await api.get<any>("/productos/scan/lookup", {
        params: { codigo: code },
      });
      if (res.found) {
        if (res.existing_product) {
          setDuplicateWarning(res.existing_product);
          notify.warning("Código de barras ya registrado en el catálogo");
        } else if (res.data) {
          setForm((f) => ({
            ...f,
            nombre: res.data.nombre || f.nombre,
            fabricante: res.data.fabricante || f.fabricante,
            mpn: res.data.sku_ref || f.mpn,
            descripcion: res.data.descripcion || f.descripcion,
          }));
          if (res.data.clase_riesgo) {
            setClaseRiesgo(res.data.clase_riesgo);
          }
          notify.success(
            "Información autocompletada desde registro regulatorio",
          );
        }
      } else {
        notify.info("El código no se encuentra en el registro regulatorio");
      }
    } catch (err) {
      console.error(err);
      notify.error("Error al realizar la consulta del código");
    } finally {
      setLookupLoading(false);
    }
  };

  const handleGtinLookup = () => {
    const code = form.pres_codigo_barras.trim();
    if (!code) {
      notify.error("Ingresa un código de barras para buscar");
      return;
    }
    performGtinLookup(code);
  };

  useEffect(() => {
    const code = form.pres_codigo_barras.trim();
    if (/^\d{8}$|^\d{12}$|^\d{13}$|^\d{14}$/.test(code)) {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(() => {
        performGtinLookup(code);
      }, 500);
    }
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [form.pres_codigo_barras]);

  useEffect(() => {
    if (!open || !duplicateSource) return;
    setForm({
      nombre: `${duplicateSource.nombre} copia`,
      descripcion: duplicateSource.descripcion ?? "",
      categoria_id: duplicateSource.categoria?.id
        ? String(duplicateSource.categoria.id)
        : "",
      unidad_base_id: duplicateSource.unidad_base?.id
        ? String(duplicateSource.unidad_base.id)
        : "",
      area_id: duplicateSource.areas?.[0]?.id
        ? String(duplicateSource.areas[0].id)
        : "",
      ubicacion: duplicateSource.ubicacion ?? "",
      control_lote: duplicateSource.control_lote ?? "con_vto",
      fabricante: duplicateSource.fabricante ?? "",
      mpn: duplicateSource.mpn ?? "",
      alias_unidad_clinica: duplicateSource.alias_unidad_clinica ?? "",
      codigo_loinc_cpt: duplicateSource.codigo_loinc_cpt ?? "",
      es_kit: duplicateSource.es_kit ?? false,
      stock_minimo_global: duplicateSource.stock_minimo_global
        ? String(duplicateSource.stock_minimo_global)
        : "",
      pres_codigo_barras: duplicateSource.pres_codigo_barras ?? "",
      imagen_data_url: null,
    });
    setTemperaturaAlmacenamiento(
      duplicateSource.temperatura_almacenamiento ?? null,
    );
    setRequiereCadenaFrio(duplicateSource.requiere_cadena_frio ?? false);
    setDiasEstabilidadAbierto(duplicateSource.dias_estabilidad_abierto ?? null);
    setClaseRiesgo(duplicateSource.clase_riesgo ?? null);
  }, [open, duplicateSource]);

  const createMut = useMutation({
    mutationFn: (data: CreateProducto) => api.post("/productos", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["productos"] });
      notify.success("Producto creado");
      handleClose();
    },
    onError: (err) => notify.error(parseApiError(err)),
  });

  function handleClose() {
    onClose();
    setForm({
      nombre: "",
      descripcion: "",
      categoria_id: "",
      unidad_base_id: "",
      area_id: "",
      ubicacion: "",
      control_lote: "con_vto" as ControlLote,
      fabricante: "",
      mpn: "",
      alias_unidad_clinica: "",
      codigo_loinc_cpt: "",
      es_kit: false,
      stock_minimo_global: "",
      pres_codigo_barras: "",
      imagen_data_url: null,
    });
    setTemperaturaAlmacenamiento(null);
    setRequiereCadenaFrio(false);
    setDiasEstabilidadAbierto(null);
    setClaseRiesgo(null);
    setDuplicateWarning(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.nombre.trim()) {
      notify.error("El nombre del producto es requerido");
      return;
    }
    if (!form.unidad_base_id) {
      notify.error("Selecciona una unidad base");
      return;
    }
    if (!form.area_id) {
      notify.error("Selecciona un área");
      return;
    }
    if (
      form.pres_codigo_barras &&
      /^\d{13}$/.test(form.pres_codigo_barras) &&
      !isValidEan13(form.pres_codigo_barras)
    ) {
      notify.error("El EAN-13 ingresado no tiene un dígito de control válido");
      return;
    }
    createMut.mutate({
      nombre: form.nombre.trim(),
      descripcion: form.descripcion.trim() || undefined,
      categoria_id: form.categoria_id ? Number(form.categoria_id) : undefined,
      unidad_base_id: Number(form.unidad_base_id),
      area_ids: [Number(form.area_id)],
      ubicacion: form.ubicacion.trim() || undefined,
      control_lote: form.control_lote,
      fabricante: form.fabricante.trim() || undefined,
      mpn: form.mpn.trim() || undefined,
      alias_unidad_clinica: form.alias_unidad_clinica.trim() || undefined,
      codigo_loinc_cpt: form.codigo_loinc_cpt.trim() || undefined,
      es_kit: form.es_kit,
      stock_minimo_global: form.stock_minimo_global
        ? Number(form.stock_minimo_global)
        : undefined,
      pres_codigo_barras: form.pres_codigo_barras || undefined,
      imagen_data_url: form.imagen_data_url || undefined,
      temperatura_almacenamiento: temperaturaAlmacenamiento,
      requiere_cadena_frio: requiereCadenaFrio,
      dias_estabilidad_abierto: diasEstabilidadAbierto,
      clase_riesgo: claseRiesgo,
    });
  }

  function handleCategoriaChange(value: string) {
    if (value === "__new__") {
      setNewCatOpen(true);
      return;
    }
    setForm((f) => ({ ...f, categoria_id: value }));
  }

  function handleUnidadChange(value: string) {
    if (value === "__new__") {
      setNewUnidadOpen(true);
      return;
    }
    setForm((f) => ({ ...f, unidad_base_id: value }));
  }

  function handleAreaChange(value: string) {
    if (value === "__new__") {
      setNewAreaOpen(true);
      return;
    }
    setForm((f) => ({ ...f, area_id: value }));
  }

  return (
    <>
      <Dialog
        open={open}
        onClose={handleClose}
        title="Nuevo producto"
        className="max-w-2xl"
        closeOnBackdrop={false}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Warning Banner for Duplicates */}
          {duplicateWarning && (
            <div className="alert alert-warning text-xs flex flex-col items-start gap-2 bg-warning/15 border-warning p-3 rounded-lg">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 shrink-0 text-warning" />
                <div>
                  <span className="font-semibold">
                    Código duplicado detectado:{" "}
                  </span>
                  {duplicateWarning.estado_catalogo === "aprobado" ? (
                    <span>
                      El producto ya existe en el catálogo aprobado con código{" "}
                      <strong className="font-mono">
                        {duplicateWarning.codigo_interno}
                      </strong>{" "}
                      ("{duplicateWarning.nombre}").
                    </span>
                  ) : (
                    <span>
                      El producto está registrado en cuarentena ("
                      {duplicateWarning.nombre}").
                    </span>
                  )}
                </div>
              </div>
              <div className="flex gap-2 mt-2 w-full justify-end">
                {duplicateWarning.estado_catalogo === "aprobado" ? (
                  <button
                    type="button"
                    className="btn btn-xs btn-primary font-semibold text-primary-content"
                    onClick={() => onViewDetail?.(duplicateWarning.id)}
                  >
                    Ver detalle del producto
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-xs btn-warning font-semibold text-warning-content"
                    onClick={() => {
                      setSearchParams({ tab: "catalogacion" });
                      handleClose();
                    }}
                  >
                    Ir a Bandeja de Catalogación
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-xs btn-ghost btn-outline border-base-300"
                  onClick={() => setDuplicateWarning(null)}
                >
                  Omitir advertencia
                </button>
              </div>
            </div>
          )}

          {/* ── Identificación ── */}
          <div className="space-y-3">
            <div className="flex items-center gap-1.5">
              <Tag className="h-3.5 w-3.5 text-primary/50" />
              <span className="text-[10px] font-semibold uppercase tracking-widest text-base-content/40">
                Identificación
              </span>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="form-control col-span-2">
                <label className="label py-0.5">
                  <span className="label-text text-sm font-medium">Nombre</span>
                  <span className="label-text-alt text-error text-[10px]">
                    requerido
                  </span>
                </label>
                <input
                  type="text"
                  className="input input-bordered input-sm h-9 bg-base-100 border-base-300"
                  value={form.nombre}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, nombre: e.target.value }))
                  }
                  placeholder="Nombre del producto"
                  autoFocus
                />
              </div>
              <div className="form-control">
                <label className="label py-0.5">
                  <span className="label-text text-sm font-medium">
                    Unidad base
                  </span>
                  <span className="label-text-alt text-error text-[10px]">
                    requerido
                  </span>
                </label>
                <select
                  className="select select-bordered select-sm h-9 text-sm bg-base-100 border-base-300"
                  value={form.unidad_base_id}
                  onChange={(e) => handleUnidadChange(e.target.value)}
                >
                  <option value="">Seleccionar...</option>
                  {unidades.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.nombre} / {u.nombre_plural}
                    </option>
                  ))}
                  <option value="__new__">＋ Crear nueva unidad...</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="form-control">
                <label className="label py-0.5">
                  <span className="label-text text-sm font-medium">
                    Tipo / Categoría
                  </span>
                  <span className="label-text-alt text-base-content/40 text-[10px]">
                    opcional
                  </span>
                </label>
                <select
                  className="select select-bordered select-sm h-9 text-sm bg-base-100 border-base-300"
                  value={form.categoria_id}
                  onChange={(e) => handleCategoriaChange(e.target.value)}
                >
                  <option value="">Sin categoría</option>
                  {categorias.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nombre}
                    </option>
                  ))}
                  <option value="__new__">＋ Crear nueva categoría...</option>
                </select>
              </div>
              <div className="form-control">
                <label className="label py-0.5">
                  <span className="label-text text-sm font-medium">
                    Fabricante
                  </span>
                  <span className="label-text-alt text-base-content/40 text-[10px]">
                    opcional
                  </span>
                </label>
                <input
                  type="text"
                  className="input input-bordered input-sm h-9 bg-base-100 border-base-300"
                  value={form.fabricante}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, fabricante: e.target.value }))
                  }
                  placeholder="Ej: Roche, Siemens"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="form-control">
                <label className="label py-0.5">
                  <span className="label-text text-sm font-medium">Área</span>
                  <span className="label-text-alt text-error text-[10px]">
                    requerido
                  </span>
                </label>
                <select
                  className={cn(
                    "select select-bordered select-sm h-9 text-sm bg-base-100 border-base-300",
                    !form.area_id && "select-error",
                  )}
                  value={form.area_id}
                  onChange={(e) => handleAreaChange(e.target.value)}
                >
                  <option value="">Seleccionar área...</option>
                  {areas.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.nombre}
                    </option>
                  ))}
                  <option value="__new__">＋ Crear nueva área...</option>
                </select>
                <p className="text-[10px] text-base-content/40 mt-0.5">
                  Sección del laboratorio donde este producto pertenece y se usa
                </p>
              </div>
              <div className="form-control">
                <label className="label py-0.5">
                  <span className="label-text text-sm font-medium">
                    Control de lote
                  </span>
                  <span className="label-text-alt text-base-content/40 text-[10px]">
                    requerido
                  </span>
                </label>
                <select
                  className="select select-bordered select-sm h-9 text-sm bg-base-100 border-base-300"
                  value={form.control_lote}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      control_lote: e.target.value as ControlLote,
                    }))
                  }
                >
                  {CONTROL_LOTE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-base-content/40 mt-0.5">
                  {controlLoteHelp(form.control_lote)}
                </p>
              </div>
            </div>

            <div className="form-control">
              <label className="label py-0.5">
                <span className="label-text text-sm font-medium">
                  Código de barras
                </span>
                <span className="label-text-alt text-base-content/40 text-[10px]">
                  opcional
                </span>
              </label>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  className="input input-bordered input-sm h-9 flex-1 font-mono bg-base-100 border-base-300"
                  value={form.pres_codigo_barras}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      pres_codigo_barras: e.target.value,
                    }))
                  }
                  placeholder="EAN-13, Code-128..."
                />
                <button
                  type="button"
                  className="btn btn-sm btn-ghost border border-base-300 px-2"
                  onClick={() => setScannerOpen(true)}
                  title="Escanear código de barras"
                >
                  📷
                </button>
                <button
                  type="button"
                  className="btn btn-sm btn-primary h-9 font-semibold text-xs gap-1"
                  onClick={handleGtinLookup}
                  disabled={lookupLoading || !form.pres_codigo_barras.trim()}
                  title="Buscar/Autocompletar con GTIN"
                >
                  {lookupLoading ? (
                    <span className="loading loading-spinner loading-xs" />
                  ) : (
                    "Buscar GTIN"
                  )}
                </button>
              </div>
              <p className="text-[10px] text-base-content/40 mt-0.5">
                Código para escanear. Al ingresar 8, 12, 13 o 14 dígitos, se
                consultará automáticamente el registro regulatorio.
              </p>
            </div>

            <div className="form-control">
              <label className="label py-0.5">
                <span className="label-text text-sm font-medium">
                  Ubicación de almacenamiento
                </span>
                <span className="label-text-alt text-base-content/40 text-[10px]">
                  opcional
                </span>
              </label>
              <input
                type="text"
                className="input input-bordered input-sm h-9 bg-base-100 border-base-300"
                value={form.ubicacion}
                onChange={(e) =>
                  setForm((f) => ({ ...f, ubicacion: e.target.value }))
                }
                placeholder="Ej: Refrigerador 2, estante superior"
              />
              <p className="text-[10px] text-base-content/40 mt-0.5">
                Lugar físico exacto: refrigerador, armario, estante
              </p>
            </div>

            <div className="flex items-center gap-2">
              {form.imagen_data_url && (
                <div className="w-8 h-8 rounded-lg overflow-hidden border border-base-300 shrink-0">
                  <img
                    src={form.imagen_data_url}
                    alt="Vista previa"
                    className="w-full h-full object-cover"
                  />
                </div>
              )}
              <label className="btn btn-xs btn-outline gap-1">
                {form.imagen_data_url ? "Cambiar foto" : "Foto del producto"}
                <input
                  type="file"
                  accept="image/jpeg,image/png"
                  className="hidden"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file) return;
                    try {
                      const dataUrl = await comprimirImagen(file);
                      setForm((f) => ({ ...f, imagen_data_url: dataUrl }));
                    } catch (err) {
                      notify.error(
                        err instanceof Error
                          ? err.message
                          : "Error cargando imagen",
                      );
                    }
                  }}
                />
              </label>
            </div>

            {/* ── Datos Comerciales & Clínicos ── */}
            <div className="space-y-2 p-3 bg-base-200/50 border border-base-300 rounded-xl">
              <p className="text-[10px] font-bold uppercase tracking-widest text-base-content/40">
                Datos Comerciales & Clínicos
              </p>

              <div className="grid grid-cols-2 gap-3">
                <div className="form-control">
                  <label className="label py-0.5">
                    <span className="label-text text-sm font-medium">MPN</span>
                    <span className="label-text-alt text-base-content/40 text-[10px]">
                      opcional
                    </span>
                  </label>
                  <input
                    type="text"
                    className="input input-bordered input-sm h-9 bg-base-100"
                    value={form.mpn}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, mpn: e.target.value }))
                    }
                    placeholder="Nº de parte de fabricante"
                  />
                </div>
                <div className="form-control">
                  <label className="label py-0.5">
                    <span className="label-text text-sm font-medium">
                      LOINC/CPT
                    </span>
                    <span className="label-text-alt text-base-content/40 text-[10px]">
                      opcional
                    </span>
                  </label>
                  <input
                    type="text"
                    className="input input-bordered input-sm h-9 bg-base-100"
                    value={form.codigo_loinc_cpt}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        codigo_loinc_cpt: e.target.value,
                      }))
                    }
                    placeholder="Código estándar clínico"
                  />
                </div>
              </div>

              <div className="form-control">
                <label className="label py-0.5">
                  <span className="label-text text-sm font-medium">
                    Alias en Unidad Clínica
                  </span>
                  <span className="label-text-alt text-base-content/40 text-[10px]">
                    opcional
                  </span>
                </label>
                <input
                  type="text"
                  className="input input-bordered input-sm h-9 bg-base-100"
                  value={form.alias_unidad_clinica}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      alias_unidad_clinica: e.target.value,
                    }))
                  }
                  placeholder="Ej: jeringa tuberculina"
                />
              </div>

              <div className="grid grid-cols-2 gap-3 mt-1">
                <div className="form-control">
                  <label className="label py-0.5">
                    <span className="label-text text-sm font-medium">
                      Stock Mínimo Global
                    </span>
                    <span className="label-text-alt text-base-content/40 text-[10px]">
                      opcional
                    </span>
                  </label>
                  <input
                    type="number"
                    className="input input-bordered input-sm h-9 bg-base-100"
                    value={form.stock_minimo_global}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        stock_minimo_global: e.target.value,
                      }))
                    }
                    placeholder="0"
                    min="0"
                  />
                </div>
                <div className="form-control justify-center pt-5">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      className="checkbox checkbox-sm checkbox-primary"
                      checked={form.es_kit}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, es_kit: e.target.checked }))
                      }
                    />
                    <span className="text-sm font-medium">
                      Es Kit / Compuesto
                    </span>
                  </label>
                </div>
              </div>
            </div>
          </div>

          <div className="divider my-0" />

          {/* ── Almacenamiento ── */}
          <div className="space-y-3 border-t border-base-200 pt-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-base-content/40">
              Almacenamiento
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold uppercase tracking-widest text-base-content/40">
                  Temperatura
                </label>
                <select
                  className="select select-sm bg-base-100 border border-base-300 rounded-xl"
                  value={temperaturaAlmacenamiento ?? ""}
                  onChange={(e) =>
                    setTemperaturaAlmacenamiento(e.target.value || null)
                  }
                >
                  <option value="">No especificada</option>
                  <option value="ambiente">Ambiente (15–30°C)</option>
                  <option value="refrigerado">Refrigerado (2–8°C)</option>
                  <option value="congelado">Congelado (-20°C)</option>
                  <option value="ultra_frio">Ultra frío (-80°C)</option>
                  <option value="no_aplica">No aplica</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold uppercase tracking-widest text-base-content/40">
                  Clase de riesgo
                </label>
                <select
                  className="select select-sm bg-base-100 border border-base-300 rounded-xl"
                  value={claseRiesgo ?? ""}
                  onChange={(e) => setClaseRiesgo(e.target.value || null)}
                >
                  <option value="">Ninguno</option>
                  <option value="biologico">Biológico</option>
                  <option value="quimico">Químico</option>
                  <option value="inflamable">Inflamable</option>
                  <option value="corrosivo">Corrosivo</option>
                  <option value="radiactivo">Radiactivo</option>
                </select>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="checkbox checkbox-sm checkbox-primary"
                  checked={requiereCadenaFrio}
                  onChange={(e) => setRequiereCadenaFrio(e.target.checked)}
                />
                <span className="text-sm">Requiere cadena de frío</span>
              </label>
              <div className="flex flex-col gap-1 flex-1">
                <label className="text-[10px] font-bold uppercase tracking-widest text-base-content/40">
                  Estabilidad abierto (días)
                </label>
                <input
                  type="number"
                  className="input input-sm input-bordered bg-base-100"
                  placeholder="ej: 30"
                  value={diasEstabilidadAbierto ?? ""}
                  onChange={(e) =>
                    setDiasEstabilidadAbierto(
                      e.target.value ? parseInt(e.target.value) : null,
                    )
                  }
                  min="1"
                />
              </div>
            </div>
          </div>

          <div className="divider my-0" />

          {/* ── Información adicional ── */}
          <div className="space-y-3">
            <div className="flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5 text-base-content/30" />
              <span className="text-[10px] font-semibold uppercase tracking-widest text-base-content/40">
                Información adicional
              </span>
            </div>
            <div className="form-control">
              <input
                type="text"
                className="input input-bordered input-sm h-9"
                value={form.descripcion}
                onChange={(e) =>
                  setForm((f) => ({ ...f, descripcion: e.target.value }))
                }
                placeholder="Especificaciones técnicas, observaciones... (opcional)"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-base-300">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={handleClose}
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={createMut.isPending}
            >
              {createMut.isPending ? (
                <span className="loading loading-spinner loading-xs" />
              ) : (
                "Crear producto"
              )}
            </button>
          </div>
        </form>
      </Dialog>

      {/* Quick-create sub-dialogs */}
      <QuickCreateCategoria
        open={newCatOpen}
        onClose={() => setNewCatOpen(false)}
        onCreated={(c) => {
          setForm((f) => ({ ...f, categoria_id: String(c.id) }));
          setNewCatOpen(false);
        }}
      />
      <QuickCreateUnidad
        open={newUnidadOpen}
        onClose={() => setNewUnidadOpen(false)}
        onCreated={(u) => {
          setForm((f) => ({ ...f, unidad_base_id: String(u.id) }));
          setNewUnidadOpen(false);
        }}
      />
      <QuickCreateArea
        open={newAreaOpen}
        onClose={() => setNewAreaOpen(false)}
        onCreated={(a) => {
          setForm((f) => ({ ...f, area_id: String(a.id) }));
          setNewAreaOpen(false);
        }}
      />
      <Dialog
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        title="Escanear código de barras"
      >
        {scannerOpen && (
          <BarcodeScanner
            onScan={(code) => {
              setForm((f) => ({ ...f, pres_codigo_barras: code }));
              setScannerOpen(false);
            }}
            onClose={() => setScannerOpen(false)}
          />
        )}
      </Dialog>
    </>
  );
}

// ── Edit Dialog ──────────────────────────────────────────────

function EditProductoDialog({
  open,
  onClose,
  productoId,
  categorias,
  areas,
}: {
  open: boolean;
  onClose: () => void;
  productoId: string;
  categorias: Categoria[];
  areas: Area[];
}) {
  const queryClient = useQueryClient();
  const [newAreaOpen, setNewAreaOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);

  const { data: producto, isLoading } = useQuery({
    queryKey: ["producto-detail", productoId],
    queryFn: () =>
      api
        .get<ProductoDetailResponse>(`/productos/${productoId}`)
        .then((r) => r.data),
    enabled: open,
  });

  const [form, setForm] = useState({
    nombre: "",
    descripcion: "",
    categoria_id: "",
    area_id: "",
    ubicacion: "",
    control_lote: "con_vto" as ControlLote,
    fabricante: "",
    mpn: "",
    alias_unidad_clinica: "",
    codigo_loinc_cpt: "",
    es_kit: false,
    stock_minimo_global: "",
    pres_codigo_barras: "",
    imagen_data_url: null as string | null,
  });

  const [temperaturaAlmacenamiento, setTemperaturaAlmacenamientoEdit] =
    useState<string | null>(null);
  const [requiereCadenaFrio, setRequiereCadenaFrioEdit] = useState(false);
  const [diasEstabilidadAbierto, setDiasEstabilidadAbiertoEdit] = useState<
    number | null
  >(null);
  const [claseRiesgo, setClaseRiesgoEdit] = useState<string | null>(null);

  useEffect(() => {
    if (producto) {
      const catId = producto.categoria?.id ?? producto.categoria_id;
      const areaId = producto.areas?.[0]?.id ?? "";
      setForm({
        nombre: producto.nombre,
        descripcion: producto.descripcion ?? "",
        categoria_id: catId ? String(catId) : "",
        area_id: areaId ? String(areaId) : "",
        ubicacion: producto.ubicacion ?? "",
        control_lote: producto.control_lote ?? "con_vto",
        fabricante: producto.fabricante ?? "",
        mpn: producto.mpn ?? "",
        alias_unidad_clinica: producto.alias_unidad_clinica ?? "",
        codigo_loinc_cpt: producto.codigo_loinc_cpt ?? "",
        es_kit: producto.es_kit ?? false,
        stock_minimo_global: producto.stock_minimo_global
          ? String(producto.stock_minimo_global)
          : "",
        pres_codigo_barras: producto.pres_codigo_barras ?? "",
        imagen_data_url: null,
      });
      setTemperaturaAlmacenamientoEdit(
        producto.temperatura_almacenamiento ?? null,
      );
      setRequiereCadenaFrioEdit(producto.requiere_cadena_frio ?? false);
      setDiasEstabilidadAbiertoEdit(producto.dias_estabilidad_abierto ?? null);
      setClaseRiesgoEdit(producto.clase_riesgo ?? null);
    }
  }, [producto]);

  const updateMut = useMutation({
    mutationFn: (data: UpdateProducto) =>
      api.put(`/productos/${productoId}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["productos"] });
      queryClient.invalidateQueries({
        queryKey: ["producto-detail", productoId],
      });
      notify.success("Producto actualizado");
      onClose();
    },
    onError: (err) => notify.error(parseApiError(err)),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!producto) return;
    if (
      form.pres_codigo_barras &&
      /^\d{13}$/.test(form.pres_codigo_barras) &&
      !isValidEan13(form.pres_codigo_barras)
    ) {
      notify.error("El EAN-13 ingresado no tiene un dígito de control válido");
      return;
    }

    const payload: UpdateProducto = {
      nombre: form.nombre.trim() || undefined,
      descripcion: form.descripcion.trim() || undefined,
      categoria_id: form.categoria_id ? Number(form.categoria_id) : undefined,
      area_ids: form.area_id ? [Number(form.area_id)] : undefined,
      ubicacion: form.ubicacion.trim() || null,
      control_lote: form.control_lote,
      fabricante: form.fabricante.trim() || null,
      mpn: form.mpn.trim() || null,
      alias_unidad_clinica: form.alias_unidad_clinica.trim() || null,
      codigo_loinc_cpt: form.codigo_loinc_cpt.trim() || null,
      es_kit: form.es_kit,
      stock_minimo_global: form.stock_minimo_global
        ? Number(form.stock_minimo_global)
        : undefined,
      pres_codigo_barras: form.pres_codigo_barras || null,
      imagen_data_url: form.imagen_data_url || null,
      temperatura_almacenamiento: temperaturaAlmacenamiento,
      requiere_cadena_frio: requiereCadenaFrio,
      dias_estabilidad_abierto: diasEstabilidadAbierto,
      clase_riesgo: claseRiesgo,
      version: producto.version,
    };

    updateMut.mutate(payload);
  }

  function handleAreaChange(value: string) {
    if (value === "__new__") {
      setNewAreaOpen(true);
      return;
    }
    setForm((f) => ({ ...f, area_id: value }));
  }

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        title="Editar producto"
        className="max-w-2xl"
        closeOnBackdrop={false}
      >
        {isLoading ? (
          <PageLoading label="Cargando producto..." size="md" />
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* ── Identificación ── */}
            <div className="space-y-3">
              <div className="flex items-center gap-1.5">
                <Tag className="h-3.5 w-3.5 text-primary/50" />
                <span className="text-[10px] font-semibold uppercase tracking-widest text-base-content/40">
                  Identificación
                </span>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="form-control col-span-2">
                  <label className="label py-0.5">
                    <span className="label-text text-sm font-medium">
                      Nombre
                    </span>
                  </label>
                  <input
                    type="text"
                    className="input input-bordered input-sm h-9"
                    value={form.nombre}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, nombre: e.target.value }))
                    }
                    autoFocus
                  />
                </div>
                <div className="form-control">
                  <label className="label py-0.5">
                    <span className="label-text text-sm font-medium">
                      Unidad base
                    </span>
                  </label>
                  <div className="input input-bordered input-sm h-9 flex items-center font-mono text-sm opacity-60 bg-base-200 cursor-not-allowed">
                    {producto?.unidad_base?.nombre ?? "--"}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="form-control">
                  <label className="label py-0.5">
                    <span className="label-text text-sm font-medium">
                      Tipo / Categoría
                    </span>
                  </label>
                  <select
                    className="select select-bordered select-sm h-9 text-sm bg-base-100 border-base-300"
                    value={form.categoria_id}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, categoria_id: e.target.value }))
                    }
                  >
                    <option value="">Sin categoría</option>
                    {categorias.map((c) => (
                      <option key={c.id} value={String(c.id)}>
                        {c.nombre}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-control">
                  <label className="label py-0.5">
                    <span className="label-text text-sm font-medium">
                      Fabricante
                    </span>
                    <span className="label-text-alt text-base-content/40 text-[10px]">
                      opcional
                    </span>
                  </label>
                  <input
                    type="text"
                    className="input input-bordered input-sm h-9 bg-base-100 border-base-300"
                    value={form.fabricante}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, fabricante: e.target.value }))
                    }
                    placeholder="Ej: Roche, Siemens"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="form-control">
                  <label className="label py-0.5">
                    <span className="label-text text-sm font-medium">Área</span>
                    <span className="label-text-alt text-error text-[10px]">
                      requerido
                    </span>
                  </label>
                  <select
                    className={cn(
                      "select select-bordered select-sm h-9 text-sm bg-base-100 border-base-300",
                      !form.area_id && "select-error",
                    )}
                    value={form.area_id}
                    onChange={(e) => handleAreaChange(e.target.value)}
                  >
                    <option value="">Seleccionar área...</option>
                    {areas.map((a) => (
                      <option key={a.id} value={String(a.id)}>
                        {a.nombre}
                      </option>
                    ))}
                    <option value="__new__">＋ Crear nueva área...</option>
                  </select>
                  <p className="text-[10px] text-base-content/40 mt-0.5">
                    Sección del laboratorio donde este producto pertenece y se
                    usa
                  </p>
                </div>
                <div className="form-control">
                  <label className="label py-0.5">
                    <span className="label-text text-sm font-medium">
                      Control de lote
                    </span>
                    <span className="label-text-alt text-base-content/40 text-[10px]">
                      requerido
                    </span>
                  </label>
                  <select
                    className="select select-bordered select-sm h-9 text-sm bg-base-100 border-base-300"
                    value={form.control_lote}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        control_lote: e.target.value as ControlLote,
                      }))
                    }
                  >
                    {CONTROL_LOTE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <p className="text-[10px] text-base-content/40 mt-0.5">
                    {controlLoteHelp(form.control_lote)}
                  </p>
                </div>
              </div>

              <div className="form-control">
                <label className="label py-0.5">
                  <span className="label-text text-sm font-medium">
                    Código de barras
                  </span>
                  <span className="label-text-alt text-base-content/40 text-[10px]">
                    opcional
                  </span>
                </label>
                <div className="flex gap-1">
                  <input
                    type="text"
                    className="input input-bordered input-sm h-9 flex-1 font-mono"
                    value={form.pres_codigo_barras}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        pres_codigo_barras: e.target.value,
                      }))
                    }
                    placeholder="EAN-13, Code-128..."
                  />
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost px-2"
                    onClick={() => setScannerOpen(true)}
                    title="Escanear código de barras"
                  >
                    📷
                  </button>
                </div>
                <p className="text-[10px] text-base-content/40 mt-0.5">
                  Código para escanear en recepción y consumos
                </p>
              </div>

              <div className="form-control">
                <label className="label py-0.5">
                  <span className="label-text text-sm font-medium">
                    Ubicación de almacenamiento
                  </span>
                  <span className="label-text-alt text-base-content/40 text-[10px]">
                    opcional
                  </span>
                </label>
                <input
                  type="text"
                  className="input input-bordered input-sm h-9"
                  value={form.ubicacion}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, ubicacion: e.target.value }))
                  }
                  placeholder="Ej: Refrigerador 2, estante superior"
                />
                <p className="text-[10px] text-base-content/40 mt-0.5">
                  Lugar físico exacto: refrigerador, armario, estante
                </p>
              </div>

              <div className="flex items-center gap-2">
                {(form.imagen_data_url || producto?.imagen_url) && (
                  <div className="w-8 h-8 rounded-lg overflow-hidden border border-base-300 shrink-0">
                    <img
                      src={form.imagen_data_url ?? producto?.imagen_url ?? ""}
                      alt="Vista previa"
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}
                <label className="btn btn-xs btn-outline gap-1">
                  {form.imagen_data_url || producto?.imagen_url
                    ? "Cambiar foto"
                    : "Foto del producto"}
                  <input
                    type="file"
                    accept="image/jpeg,image/png"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      e.target.value = "";
                      if (!file) return;
                      try {
                        const dataUrl = await comprimirImagen(file);
                        setForm((f) => ({ ...f, imagen_data_url: dataUrl }));
                      } catch (err) {
                        notify.error(
                          err instanceof Error
                            ? err.message
                            : "Error cargando imagen",
                        );
                      }
                    }}
                  />
                </label>
              </div>

              {/* ── Datos Comerciales & Clínicos ── */}
              <div className="space-y-2 p-3 bg-base-200/50 border border-base-300 rounded-xl">
                <p className="text-[10px] font-bold uppercase tracking-widest text-base-content/40">
                  Datos Comerciales & Clínicos
                </p>

                <div className="grid grid-cols-2 gap-3">
                  <div className="form-control">
                    <label className="label py-0.5">
                      <span className="label-text text-sm font-medium">
                        MPN
                      </span>
                      <span className="label-text-alt text-base-content/40 text-[10px]">
                        opcional
                      </span>
                    </label>
                    <input
                      type="text"
                      className="input input-bordered input-sm h-9 bg-base-100"
                      value={form.mpn}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, mpn: e.target.value }))
                      }
                      placeholder="Nº de parte de fabricante"
                    />
                  </div>
                  <div className="form-control">
                    <label className="label py-0.5">
                      <span className="label-text text-sm font-medium">
                        LOINC/CPT
                      </span>
                      <span className="label-text-alt text-base-content/40 text-[10px]">
                        opcional
                      </span>
                    </label>
                    <input
                      type="text"
                      className="input input-bordered input-sm h-9 bg-base-100"
                      value={form.codigo_loinc_cpt}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          codigo_loinc_cpt: e.target.value,
                        }))
                      }
                      placeholder="Código estándar clínico"
                    />
                  </div>
                </div>

                <div className="form-control">
                  <label className="label py-0.5">
                    <span className="label-text text-sm font-medium">
                      Alias en Unidad Clínica
                    </span>
                    <span className="label-text-alt text-base-content/40 text-[10px]">
                      opcional
                    </span>
                  </label>
                  <input
                    type="text"
                    className="input input-bordered input-sm h-9 bg-base-100"
                    value={form.alias_unidad_clinica}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        alias_unidad_clinica: e.target.value,
                      }))
                    }
                    placeholder="Ej: jeringa tuberculina"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3 mt-1">
                  <div className="form-control">
                    <label className="label py-0.5">
                      <span className="label-text text-sm font-medium">
                        Stock Mínimo Global
                      </span>
                      <span className="label-text-alt text-base-content/40 text-[10px]">
                        opcional
                      </span>
                    </label>
                    <input
                      type="number"
                      className="input input-bordered input-sm h-9 bg-base-100"
                      value={form.stock_minimo_global}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          stock_minimo_global: e.target.value,
                        }))
                      }
                      placeholder="0"
                      min="0"
                    />
                  </div>
                  <div className="form-control justify-center pt-5">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        className="checkbox checkbox-sm checkbox-primary"
                        checked={form.es_kit}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, es_kit: e.target.checked }))
                        }
                      />
                      <span className="text-sm font-medium">
                        Es Kit / Compuesto
                      </span>
                    </label>
                  </div>
                </div>
              </div>
            </div>

            <div className="divider my-0" />

            {/* ── Almacenamiento ── */}
            <div className="space-y-3 border-t border-base-200 pt-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-base-content/40">
                Almacenamiento
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-base-content/40">
                    Temperatura
                  </label>
                  <select
                    className="select select-sm bg-base-100 border border-base-300 rounded-xl"
                    value={temperaturaAlmacenamiento ?? ""}
                    onChange={(e) =>
                      setTemperaturaAlmacenamientoEdit(e.target.value || null)
                    }
                  >
                    <option value="">No especificada</option>
                    <option value="ambiente">Ambiente (15–30°C)</option>
                    <option value="refrigerado">Refrigerado (2–8°C)</option>
                    <option value="congelado">Congelado (-20°C)</option>
                    <option value="ultra_frio">Ultra frío (-80°C)</option>
                    <option value="no_aplica">No aplica</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-base-content/40">
                    Clase de riesgo
                  </label>
                  <select
                    className="select select-sm bg-base-100 border border-base-300 rounded-xl"
                    value={claseRiesgo ?? ""}
                    onChange={(e) => setClaseRiesgoEdit(e.target.value || null)}
                  >
                    <option value="">Ninguno</option>
                    <option value="biologico">Biológico</option>
                    <option value="quimico">Químico</option>
                    <option value="inflamable">Inflamable</option>
                    <option value="corrosivo">Corrosivo</option>
                    <option value="radiactivo">Radiactivo</option>
                  </select>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="checkbox checkbox-sm checkbox-primary"
                    checked={requiereCadenaFrio}
                    onChange={(e) =>
                      setRequiereCadenaFrioEdit(e.target.checked)
                    }
                  />
                  <span className="text-sm">Requiere cadena de frío</span>
                </label>
                <div className="flex flex-col gap-1 flex-1">
                  <label className="text-[10px] font-bold uppercase tracking-widest text-base-content/40">
                    Estabilidad abierto (días)
                  </label>
                  <input
                    type="number"
                    className="input input-sm input-bordered bg-base-100"
                    placeholder="ej: 30"
                    value={diasEstabilidadAbierto ?? ""}
                    onChange={(e) =>
                      setDiasEstabilidadAbiertoEdit(
                        e.target.value ? parseInt(e.target.value) : null,
                      )
                    }
                    min="1"
                  />
                </div>
              </div>
            </div>

            <div className="divider my-0" />

            {/* ── Descripción ── */}
            <div className="space-y-3">
              <div className="flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5 text-base-content/30" />
                <span className="text-[10px] font-semibold uppercase tracking-widest text-base-content/40">
                  Información adicional
                </span>
              </div>
              <div className="form-control">
                <input
                  type="text"
                  className="input input-bordered input-sm h-9"
                  value={form.descripcion}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, descripcion: e.target.value }))
                  }
                  placeholder="Especificaciones técnicas, observaciones... (opcional)"
                />
              </div>
            </div>

            <div className="divider my-0" />

            {/* ── Códigos adicionales ── */}
            <CodigosAdicionalesSection productoId={productoId} />

            <div className="flex justify-end gap-2 pt-2 border-t border-base-300">
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
                disabled={updateMut.isPending}
              >
                {updateMut.isPending ? (
                  <span className="loading loading-spinner loading-xs" />
                ) : (
                  "Guardar"
                )}
              </button>
            </div>
          </form>
        )}
      </Dialog>

      <QuickCreateArea
        open={newAreaOpen}
        onClose={() => setNewAreaOpen(false)}
        onCreated={(a) => {
          setForm((f) => ({ ...f, area_id: String(a.id) }));
          setNewAreaOpen(false);
        }}
      />
      <Dialog
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        title="Escanear código de barras"
      >
        {scannerOpen && (
          <BarcodeScanner
            onScan={(code) => {
              setForm((f) => ({ ...f, pres_codigo_barras: code }));
              setScannerOpen(false);
            }}
            onClose={() => setScannerOpen(false)}
          />
        )}
      </Dialog>
    </>
  );
}

// ── Códigos adicionales ─────────────────────────────────────

function CodigosAdicionalesSection({ productoId }: { productoId: string }) {
  const queryClient = useQueryClient();
  const [nuevoCodigo, setNuevoCodigo] = useState("");

  const { data: codigos = [], isLoading } = useQuery({
    queryKey: ["producto-codigos", productoId],
    queryFn: () =>
      api
        .get<
          { id: number; codigo: string }[]
        >(`/productos/${productoId}/codigos`)
        .then((r) => r.data),
  });

  const agregarMut = useMutation({
    mutationFn: () =>
      api.post(`/productos/${productoId}/codigos`, {
        codigo: nuevoCodigo.trim(),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["producto-codigos", productoId],
      });
      notify.success("Código agregado");
      setNuevoCodigo("");
    },
    onError: (err) => notify.error(parseApiError(err)),
  });

  const eliminarMut = useMutation({
    mutationFn: (codigoId: number) =>
      api.delete(`/productos/${productoId}/codigos/${codigoId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["producto-codigos", productoId],
      });
      notify.success("Código eliminado");
    },
    onError: (err) => notify.error(parseApiError(err)),
  });

  return (
    <div className="space-y-2">
      <p className="text-[10px] font-bold uppercase tracking-widest text-base-content/40">
        Códigos adicionales
      </p>
      {isLoading ? (
        <span className="loading loading-spinner loading-xs opacity-40" />
      ) : codigos.length === 0 ? (
        <p className="text-xs text-base-content/40">
          Sin códigos adicionales registrados
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {codigos.map((c) => (
            <span
              key={c.id}
              className="inline-flex items-center gap-1 font-mono text-xs bg-base-200 border border-base-300 rounded-lg px-2 py-0.5"
            >
              {c.codigo}
              <button
                type="button"
                className="text-base-content/40 hover:text-error transition-colors"
                onClick={() => eliminarMut.mutate(c.id)}
                disabled={eliminarMut.isPending}
                title="Eliminar"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <form
        className="flex gap-1.5 mt-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (nuevoCodigo.trim()) agregarMut.mutate();
        }}
      >
        <input
          type="text"
          className="input input-bordered input-xs h-7 flex-1 font-mono"
          value={nuevoCodigo}
          onChange={(e) => setNuevoCodigo(e.target.value)}
          placeholder="EAN-13, Code-128..."
        />
        <button
          type="submit"
          className="btn btn-xs btn-outline"
          disabled={!nuevoCodigo.trim() || agregarMut.isPending}
        >
          {agregarMut.isPending ? (
            <span className="loading loading-spinner loading-xs" />
          ) : (
            "Agregar"
          )}
        </button>
      </form>
    </div>
  );
}

// ── Detail Panel ─────────────────────────────────────────────

function ProductoDetail({ id }: { id: string }) {
  const { data: producto, isLoading } = useQuery({
    queryKey: ["producto-detail", id],
    queryFn: () =>
      api.get<ProductoDetailResponse>(`/productos/${id}`).then((r) => r.data),
  });

  if (isLoading) {
    return <PageLoading label="Cargando detalle..." size="md" />;
  }

  if (!producto) return <p className="text-sm opacity-40">No encontrado</p>;

  const categoriaNombre =
    producto.categoria?.nombre ?? producto.categoria_nombre ?? "--";

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <DetailRow
          label="Código sistema"
          value={producto.codigo_interno ?? "--"}
          mono
        />
        <DetailRow label="Nombre" value={producto.nombre} />
        {producto.descripcion && (
          <DetailRow label="Descripción" value={producto.descripcion} />
        )}
        <DetailRow label="Categoría" value={categoriaNombre} />
        <DetailRow
          label="Unidad base"
          value={producto.unidad_base?.nombre ?? "--"}
        />
        <DetailRow
          label="Estado"
          value={producto.activo ? "Activo" : "Inactivo"}
        />

        <DetailRow label="MPN" value={producto.mpn ?? "--"} mono />
        <DetailRow
          label="Alias"
          value={producto.alias_unidad_clinica ?? "--"}
        />
        <DetailRow
          label="LOINC/CPT"
          value={producto.codigo_loinc_cpt ?? "--"}
          mono
        />
        <DetailRow
          label="Stock Mínimo"
          value={
            producto.stock_minimo_global
              ? String(producto.stock_minimo_global)
              : "--"
          }
        />
        <DetailRow label="Es Kit" value={producto.es_kit ? "Sí" : "No"} />
      </div>

      {producto.areas && producto.areas.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider opacity-40 mb-2">
            Área / Sección
          </h4>
          <div className="flex flex-wrap gap-1.5">
            {producto.areas.map((a: { id: number; nombre: string }) => (
              <Badge key={a.id} variant="secondary">
                {a.nombre}
              </Badge>
            ))}
          </div>
        </div>
      )}

      <div className="pt-4 border-t border-base-200/40">
        <PresentacionesManager productoId={producto.id} />
      </div>
    </div>
  );
}

function DetailRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex justify-between items-start gap-3 border-b border-base-200/40 pb-1.5 last:border-none">
      <span className="text-[11px] opacity-40 shrink-0 font-medium uppercase tracking-wider">
        {label}
      </span>
      <span
        className={cn(
          "text-sm text-right min-w-0 max-w-[70%] break-words",
          mono ? "font-mono" : "",
        )}
      >
        {value}
      </span>
    </div>
  );
}
