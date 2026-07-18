import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Search, Package, FileText, Zap, ArrowRight, X } from "lucide-react";
import api from "@/lib/api";
import type { StockItem, PaginatedResponse } from "@/types";
import type { RecepcionListItem } from "@/types";
import { cn } from "@/lib/utils";

const ACCIONES_RAPIDAS = [
  {
    id: "a1",
    title: "Nueva recepción",
    subtitle: "Registrar entrada de insumos",
    path: "/recepciones/nueva",
    keywords: ["nueva", "recepcion", "entrada"],
  },
  {
    id: "a3",
    title: "Stock bajo mínimo",
    subtitle: "Productos bajo el mínimo de stock",
    path: "/stock?estado=bajo",
    keywords: ["bajo", "minimo", "alerta"],
  },
  {
    id: "a4",
    title: "Nueva solicitud de compra",
    subtitle: "Crear pedido a proveedor",
    path: "/solicitudes-compra",
    keywords: ["solicitud", "compra", "pedido", "proveedor"],
  },
  {
    id: "a5",
    title: "Registrar consumo",
    subtitle: "Consumir insumos del stock",
    path: "/consumos",
    keywords: ["consumo", "consumir", "usar", "salida"],
  },
] as const;

type ResultItem = {
  id: string;
  type: "producto" | "recepcion" | "accion";
  title: string;
  subtitle?: string;
  badge?: string;
  action: () => void;
};

interface GlobalSearchProps {
  open: boolean;
  onClose: () => void;
}

export function GlobalSearch({ open, onClose }: GlobalSearchProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    setActiveIndex(-1);
  }, [query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setDebouncedQuery("");
      setActiveIndex(-1);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    if (activeIndex >= 0) {
      itemRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex]);

  const enabled = debouncedQuery.length >= 2;

  const { data: stockData } = useQuery({
    queryKey: ["global-search-stock", debouncedQuery],
    queryFn: () =>
      api
        .get<
          PaginatedResponse<StockItem>
        >("/stock", { params: { q: debouncedQuery, per_page: 6 } })
        .then((r) => r.data),
    enabled,
    staleTime: 30_000,
  });

  const { data: recData } = useQuery({
    queryKey: ["global-search-rec", debouncedQuery],
    queryFn: () =>
      api
        .get<{
          data: RecepcionListItem[];
        }>("/recepciones", { params: { q: debouncedQuery, per_page: 4 } })
        .then((r) => r.data),
    enabled,
    staleTime: 30_000,
  });

  const navAndClose = useCallback(
    (path: string) => {
      navigate(path);
      onClose();
    },
    [navigate, onClose],
  );

  const lowerQuery = query.toLowerCase();

  const acciones: ResultItem[] = ACCIONES_RAPIDAS.filter(
    (a) =>
      query.length < 2 ||
      a.title.toLowerCase().includes(lowerQuery) ||
      a.keywords.some((k) => k.includes(lowerQuery)),
  ).map((a) => ({
    id: a.id,
    type: "accion" as const,
    title: a.title,
    subtitle: a.subtitle,
    action: () => navAndClose(a.path),
  }));

  const productos: ResultItem[] = (stockData?.data ?? []).map((item) => ({
    id: `p-${item.producto_id}`,
    type: "producto" as const,
    title: item.producto_nombre,
    subtitle: item.categoria ?? undefined,
    badge: item.codigo_interno,
    action: () => navAndClose(`/stock?select=${item.producto_id}`),
  }));

  const recepciones: ResultItem[] = (recData?.data ?? []).map((r) => ({
    id: `r-${r.id}`,
    type: "recepcion" as const,
    title: r.numero_documento,
    subtitle: r.proveedor_nombre,
    badge: r.estado === "completa" ? "Confirmada" : "Borrador",
    action: () => navAndClose(`/recepciones/${r.id}`),
  }));

  // Flat list for keyboard navigation
  const results: ResultItem[] = [...acciones, ...productos, ...recepciones];

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (results.length === 0) return;
      setActiveIndex((i) => (i < results.length - 1 ? i + 1 : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (results.length === 0) return;
      setActiveIndex((i) => (i > 0 ? i - 1 : results.length - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIndex >= 0 && results[activeIndex]) {
        results[activeIndex].action();
      }
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  if (!open) return null;

  const typeIcon = (type: ResultItem["type"]) => {
    if (type === "accion") return <Zap className="h-4 w-4" />;
    if (type === "producto") return <Package className="h-4 w-4" />;
    return <FileText className="h-4 w-4" />;
  };

  const renderGroup = (label: string, items: ResultItem[]) => {
    if (items.length === 0) return null;
    return (
      <div key={label}>
        <div className="px-4 pt-3 pb-1 text-[10px] font-bold uppercase tracking-widest opacity-30">
          {label}
        </div>
        {items.map((item) => {
          const idx = results.indexOf(item);
          const isActive = idx === activeIndex;
          return (
            <div
              key={item.id}
              id={`gs-result-${idx}`}
              role="option"
              aria-selected={isActive}
              ref={(el) => {
                itemRefs.current[idx] = el;
              }}
              onClick={item.action}
              className={cn(
                "flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors group",
                isActive ? "bg-primary/10" : "hover:bg-base-200/60",
              )}
            >
              <div
                className={cn(
                  "shrink-0 opacity-40 transition-colors",
                  isActive && "opacity-100 text-primary",
                )}
              >
                {typeIcon(item.type)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{item.title}</div>
                {item.subtitle && (
                  <div className="text-[11px] opacity-40 truncate">
                    {item.subtitle}
                  </div>
                )}
              </div>
              {item.badge && (
                <span className="text-[10px] font-mono opacity-40 shrink-0">
                  {item.badge}
                </span>
              )}
              <ArrowRight
                className={cn(
                  "h-3.5 w-3.5 shrink-0 transition-opacity",
                  isActive ? "opacity-40" : "opacity-0 group-hover:opacity-20",
                )}
              />
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[14vh] bg-black/40 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl mx-4 bg-base-100 rounded-2xl shadow-2xl border border-base-200 overflow-hidden animate-in slide-in-from-top-4 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Input */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-base-200">
          <Search className="h-5 w-5 opacity-40 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            className="flex-1 bg-transparent outline-none text-base placeholder:opacity-40"
            placeholder="Buscar producto, recepción, acción…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            aria-autocomplete="list"
            aria-expanded={results.length > 0}
            aria-activedescendant={
              activeIndex >= 0 ? `gs-result-${activeIndex}` : undefined
            }
          />
          {query ? (
            <button
              onClick={() => setQuery("")}
              className="p-1 hover:bg-base-200 rounded-lg transition-colors"
            >
              <X className="h-3.5 w-3.5 opacity-50" />
            </button>
          ) : (
            <kbd className="kbd kbd-sm opacity-30 text-[10px]">Esc</kbd>
          )}
        </div>

        {/* Results */}
        <div className="overflow-y-auto max-h-[55vh]" role="listbox">
          {results.length === 0 && query.length >= 2 ? (
            <div className="py-10 text-center text-sm opacity-40">
              Sin resultados para "{query}"
            </div>
          ) : (
            <>
              {renderGroup("Acciones", acciones)}
              {renderGroup("Productos", productos)}
              {renderGroup("Recepciones", recepciones)}
              {query.length < 2 && (
                <div className="px-4 pb-4 pt-1 text-[11px] opacity-30 text-center">
                  Escribe para buscar productos y recepciones
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 border-t border-base-200 flex items-center justify-between text-[11px] opacity-30">
          <span>↑↓ navegar · Enter seleccionar · Esc cerrar</span>
          <div className="flex items-center gap-1">
            <kbd className="kbd kbd-sm text-[9px]">Ctrl</kbd>
            <kbd className="kbd kbd-sm text-[9px]">K</kbd>
          </div>
        </div>
      </div>
    </div>
  );
}
