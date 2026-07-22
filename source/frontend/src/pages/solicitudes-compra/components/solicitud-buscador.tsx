import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import api from "@/lib/api";
import type { Producto, PaginatedResponse } from "@/types";
import { ProductoImage } from "@/components/ui/producto-image";

interface Props {
  proveedorId: number | null;
  monedaCodigo?: string;
  excluidos: string[];
  onAdd: (p: Producto) => void;
}

export function SolicitudBuscador({
  proveedorId,
  excluidos,
  onAdd,
}: Props) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Debounce
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedQuery(query), 220);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  // Reset active index on query change
  useEffect(() => {
    setActiveIndex(-1);
  }, [debouncedQuery]);

  // Scroll automático al ítem activo
  useEffect(() => {
    if (activeIndex >= 0) {
      itemRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const { data, isFetching } = useQuery({
    queryKey: ["solicitud-buscador", debouncedQuery, proveedorId],
    queryFn: () =>
      api
        .get<PaginatedResponse<Producto & { imagen_url?: string | null }>>(
          "/productos",
          {
            params: {
              q: debouncedQuery || undefined,
              proveedor_id: proveedorId,
              per_page: 8,
              activo: true,
            },
          },
        )
        .then((r) => r.data),
    staleTime: 30_000,
  });

  const suggestions = (data?.data ?? []).filter(
    (p) => !excluidos.includes(String(p.id)),
  );

  const select = (p: Producto) => {
    onAdd(p);
    setQuery("");
    setDebouncedQuery("");
    setOpen(false);
    setActiveIndex(-1);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const wasClosed = !open;
      if (wasClosed) {
        setOpen(true);
      }
      if (suggestions.length === 0) return;
      if (wasClosed) {
        setActiveIndex(0);
      } else {
        setActiveIndex((i) => (i + 1) % suggestions.length);
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (suggestions.length === 0) return;
      setActiveIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === "Enter") {
      if (activeIndex >= 0 && suggestions[activeIndex]) {
        e.preventDefault();
        select(suggestions[activeIndex]);
      }
    } else if (e.key === "Escape") {
      setQuery("");
      setDebouncedQuery("");
      setOpen(false);
      setActiveIndex(-1);
    }
  };


  const showDropdown = open;

  return (
    <div ref={containerRef} className="relative">
      <div className="input flex h-11 w-full items-center gap-2 border-base-300 bg-base-100 px-3 focus-within:border-primary focus-within:outline focus-within:outline-2 focus-within:outline-primary/25 transition-all">
        <Search className="h-4 w-4 opacity-30 flex-shrink-0" />
        <input
          ref={inputRef}
          className="flex-1 bg-transparent text-sm outline-none placeholder:opacity-40"
          placeholder="Nombre o código..."
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={handleKeyDown}
          onFocus={() => setOpen(true)}
        />
        {isFetching && (
          <span className="loading loading-spinner loading-xs opacity-30 flex-shrink-0" />
        )}
        {query && !isFetching && (
          <button
            className="opacity-30 hover:opacity-60 transition-opacity flex-shrink-0"
            onMouseDown={(e) => {
              e.preventDefault();
              setQuery("");
              setDebouncedQuery("");
              setOpen(false);
            }}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {showDropdown && (
        <div className="app-floating-menu absolute top-full left-0 right-0 mt-1.5 rounded-box overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150">
          {suggestions.length === 0 && !isFetching ? (
            <div className="px-4 py-5 text-sm text-center opacity-40">
              {debouncedQuery
                ? `Sin resultados para "${debouncedQuery}"`
                : "Sin productos para este proveedor"}
            </div>
          ) : (
            <div className="py-1.5">
              {suggestions.map((p, i) => {
                type PExt = Producto & {
                  imagen_url?: string | null;
                  unidad_base?: {
                    id: number;
                    nombre: string;
                    nombre_plural: string;
                  };
                  pres_nombre?: string | null;
                  pres_factor?: string | null;
                };
                const px = p as PExt;
                return (
                  <div
                    key={p.id}
                    ref={(el) => {
                      itemRefs.current[i] = el;
                    }}
                    className={`flex items-center gap-3 px-3 py-2.5 mx-1.5 rounded-xl cursor-pointer transition-colors ${
                      i === activeIndex
                        ? "bg-primary/8 text-primary"
                        : "hover:bg-base-200"
                    }`}
                    onMouseDown={() => select(p)}
                    onMouseEnter={() => setActiveIndex(i)}
                  >
                    {px.imagen_url && (
                      <ProductoImage
                        src={px.imagen_url}
                        size="sm"
                        className="flex-shrink-0"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-semibold truncate">
                          {p.nombre}
                        </p>
                        {p.estado_catalogo === "pendiente_aprobacion" && (
                          <span className="badge badge-warning badge-xs shrink-0 font-semibold px-1 py-0.5 rounded text-[9px]">
                            En Cuarentena
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] opacity-40 font-mono">
                        #{p.codigo_interno}
                      </p>
                    </div>
                    <div
                      className={`h-6 w-6 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors ${
                        i === activeIndex
                          ? "bg-primary text-primary-content"
                          : "bg-base-200 text-base-content/40"
                      }`}
                    >
                      <span className="text-xs font-bold">+</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <div className="px-4 pb-2 pt-0.5 border-t border-base-200 flex items-center gap-2 text-[9px] opacity-25 font-medium">
            <span>↑↓ navegar</span>
            <span>·</span>
            <span>↵ agregar</span>
            <span>·</span>
            <span>Esc cerrar</span>
          </div>
        </div>
      )}
    </div>
  );
}
