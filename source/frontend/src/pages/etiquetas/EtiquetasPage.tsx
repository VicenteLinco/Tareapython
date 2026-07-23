import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Tag, X } from "lucide-react";
import api from "@/lib/api";
import { cn } from "@/lib/utils";
import { formatCantidad } from "@/lib/utils";
import type { StockItem, PaginatedResponse } from "@/types";
import type { LoteParaEtiqueta } from "@/lib/label-print";
import { LabelsSection } from "@/pages/recepciones/components/labels-section";

// Lote en stock de un producto (subconjunto de lo que devuelve GET /lotes).
interface LoteEnStock {
  id: string;
  numero_lote: string;
  fecha_vencimiento: string;
  stock_total: string | null;
  producto_nombre: string;
}

/**
 * Herramienta de reimpresión de etiquetas de lote.
 *
 * Caso de uso: un lote ya en stock perdió o dañó su etiqueta y hay que reponerla.
 * El usuario busca por PRODUCTO (no por número de lote), elige uno o más lotes en
 * stock y reimprime con el mismo motor que recepción (QR = lote_id), de modo que
 * la etiqueta vuelve a ser escaneable en consumo.
 */
export function EtiquetasPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [producto, setProducto] = useState<StockItem | null>(null);
  const [selectedLoteIds, setSelectedLoteIds] = useState<string[]>([]);

  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      )
        setDropdownOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    if (activeIndex >= 0)
      itemRefs.current[activeIndex]?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  useEffect(() => {
    setActiveIndex(-1);
  }, [searchQuery]);

  // ── Búsqueda de producto ───────────────────────────────────────────────────
  const { data: stockResponse, isLoading: cargandoProductos } = useQuery({
    queryKey: ["etiquetas-stock", searchQuery],
    queryFn: () =>
      api
        .get<PaginatedResponse<StockItem>>("/stock", {
          params: { ...(searchQuery && { q: searchQuery }), per_page: 100 },
        })
        .then((r) => r.data),
  });

  const allProducts = stockResponse?.data ?? [];
  const dropdownItems: StockItem[] = searchQuery
    ? allProducts
    : allProducts.slice(0, 16);

  const seleccionarProducto = (p: StockItem) => {
    setProducto(p);
    setSelectedLoteIds([]);
    setSearchQuery("");
    setDropdownOpen(false);
    setActiveIndex(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!dropdownOpen) setDropdownOpen(true);
      if (dropdownItems.length === 0) return;
      setActiveIndex((i) => (i < dropdownItems.length - 1 ? i + 1 : 0));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (dropdownItems.length === 0) return;
      setActiveIndex((i) => (i > 0 ? i - 1 : dropdownItems.length - 1));
      return;
    }
    if (e.key === "Escape") {
      setDropdownOpen(false);
      setActiveIndex(-1);
      setSearchQuery("");
      inputRef.current?.blur();
      return;
    }
    if (e.key === "Enter" && activeIndex >= 0 && dropdownItems[activeIndex]) {
      e.preventDefault();
      seleccionarProducto(dropdownItems[activeIndex]);
    }
  };

  // ── Lotes en stock del producto elegido ──────────────────────────────────────
  const { data: lotes = [], isLoading: cargandoLotes } = useQuery({
    queryKey: ["etiquetas-lotes", producto?.producto_id],
    queryFn: () =>
      api
        .get<LoteEnStock[]>("/lotes", {
          params: { producto_id: producto!.producto_id, con_stock: true },
        })
        .then((r) => r.data),
    enabled: !!producto,
  });

  const toggleLote = (loteId: string) => {
    setSelectedLoteIds((prev) =>
      prev.includes(loteId)
        ? prev.filter((id) => id !== loteId)
        : [...prev, loteId],
    );
  };

  // Lotes elegidos → formato que consume el motor de impresión (QR = lote_id).
  const lotesParaImprimir: LoteParaEtiqueta[] = useMemo(
    () =>
      lotes
        .filter((l) => selectedLoteIds.includes(l.id))
        .map((l) => ({
          lote_id: l.id,
          numero_lote: l.numero_lote,
          fecha_vencimiento: l.fecha_vencimiento,
          producto_nombre: l.producto_nombre,
          area_nombre: "",
          cantidad_etiquetas: 1,
        })),
    [lotes, selectedLoteIds],
  );

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-2">
        <Tag className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Reimprimir etiquetas</h1>
          <p className="text-sm text-base-content/60">
            Busca un producto y elige los lotes cuya etiqueta quieres reponer.
          </p>
        </div>
      </div>

      {/* Buscador de producto */}
      <div ref={containerRef} className="relative">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-base-content/40" />
          <input
            ref={inputRef}
            className="input input-bordered w-full pl-10 bg-base-100 border-base-300 rounded-xl"
            placeholder="Buscar producto…"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setDropdownOpen(true);
            }}
            onFocus={() => setDropdownOpen(true)}
            onKeyDown={handleKeyDown}
            aria-activedescendant={
              activeIndex >= 0
                ? `etiqueta-sugerencia-${activeIndex}`
                : undefined
            }
          />
        </div>

        {dropdownOpen && (
          <div className="absolute z-20 mt-1 w-full max-h-72 overflow-y-auto rounded-xl border border-base-300 bg-base-100 shadow-lg">
            {cargandoProductos && (
              <div className="px-4 py-3 text-sm text-base-content/50">
                Buscando…
              </div>
            )}
            {!cargandoProductos && dropdownItems.length === 0 && (
              <div className="px-4 py-3 text-sm text-base-content/50">
                Sin resultados.
              </div>
            )}
            {dropdownItems.map((p, i) => (
              <div
                key={p.producto_id}
                id={`etiqueta-sugerencia-${i}`}
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                role="option"
                aria-selected={i === activeIndex}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => seleccionarProducto(p)}
                className={cn(
                  "flex cursor-pointer items-center justify-between gap-3 px-4 py-2.5 text-sm",
                  i === activeIndex && "bg-base-200",
                )}
              >
                <span className="min-w-0 flex-1 truncate font-medium">
                  {p.producto_nombre}
                </span>
                <span className="flex-shrink-0 text-xs text-base-content/50">
                  {formatCantidad(
                    p.stock_total ?? 0,
                    p.unidad,
                    p.unidad_plural ?? undefined,
                  )}{" "}
                  en stock
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Producto elegido + lotes */}
      {producto && (
        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-xl border border-base-200 bg-base-100 px-4 py-3">
            <div className="min-w-0">
              <p className="truncate font-semibold">
                {producto.producto_nombre}
              </p>
              <p className="text-xs text-base-content/50">
                {producto.codigo_interno}
              </p>
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-sm btn-circle"
              aria-label="Cambiar producto"
              onClick={() => {
                setProducto(null);
                setSelectedLoteIds([]);
                inputRef.current?.focus();
              }}
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between gap-2 flex-wrap">
              <p className="text-[10px] font-bold uppercase tracking-widest text-base-content/50">
                Lotes en stock ({lotes.length})
              </p>
              {lotes.length > 0 && (
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    className="btn btn-xs btn-ghost text-xs text-primary font-bold hover:bg-primary/10 rounded-lg"
                    onClick={() => setSelectedLoteIds(lotes.map((l) => l.id))}
                  >
                    Seleccionar Todos ({lotes.length})
                  </button>
                  <button
                    type="button"
                    className="btn btn-xs btn-ghost text-xs text-base-content/50 hover:bg-base-200 rounded-lg"
                    onClick={() => setSelectedLoteIds([])}
                  >
                    Desmarcar
                  </button>
                </div>
              )}
            </div>
            {cargandoLotes && (
              <p className="text-sm text-base-content/50">Cargando lotes…</p>
            )}
            {!cargandoLotes && lotes.length === 0 && (
              <p className="text-sm text-warning/80">
                Este producto no tiene lotes con stock.
              </p>
            )}
            <div className="space-y-1.5">
              {lotes.map((l) => {
                const checked = selectedLoteIds.includes(l.id);
                return (
                  <label
                    key={l.id}
                    className={cn(
                      "flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-2.5 transition",
                      checked
                        ? "border-primary/40 bg-primary/5"
                        : "border-base-200 bg-base-100 hover:border-base-300",
                    )}
                  >
                    <input
                      type="checkbox"
                      className="checkbox checkbox-sm checkbox-primary"
                      checked={checked}
                      onChange={() => toggleLote(l.id)}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-sm">Lote: {l.numero_lote}</p>
                      <p className="text-xs text-base-content/50">
                        Vence:{" "}
                        {new Date(
                          l.fecha_vencimiento + "T00:00:00",
                        ).toLocaleDateString("es-AR")}
                      </p>
                    </div>
                    <span className="flex-shrink-0 text-xs text-base-content/50">
                      {formatCantidad(
                        l.stock_total ?? 0,
                        producto.unidad,
                        producto.unidad_plural ?? undefined,
                      )}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Formato, cantidad por lote e impresión — reusa el motor de recepción */}
          {lotesParaImprimir.length > 0 && (
            <LabelsSection
              key={selectedLoteIds.join(",")}
              lotesConfirmados={lotesParaImprimir}
            />
          )}
        </div>
      )}
    </div>
  );
}
