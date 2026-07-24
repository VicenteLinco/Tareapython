import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { useFilterStorage } from "@/hooks/use-filter-storage";
import { useDebounce } from "@/hooks/use-debounce";
import type { StockItem } from "@/types";

export type EstadoFiltro =
  | "todos"
  | "normal"
  | "bajo"
  | "agotado"
  | "vencido"
  | "vence_pronto"
  | "sin_datos";

const STOCK_FILTER_DEFAULTS = {
  categoriaId: null as number | null,
  proveedorId: null as number | null,
  areaId: null as number | null,
  customFilters: {} as Record<string, string>,
};

function parseEstado(raw: string): EstadoFiltro {
  const valid: EstadoFiltro[] = [
    "todos",
    "normal",
    "bajo",
    "agotado",
    "vencido",
    "vence_pronto",
    "sin_datos",
  ];
  if ((valid as string[]).includes(raw)) return raw as EstadoFiltro;
  // compat legacy
  if (raw === "sin_stock" || raw === "sin-stock") return "agotado";
  if (raw === "vencidos") return "vencido";
  if (raw === "critico" || raw === "reponer" || raw === "bajo_minimo")
    return "bajo";
  if (raw === "riesgo_venc" || raw === "por_vencer" || raw === "vencimiento")
    return "vence_pronto";
  return "todos";
}

export function useStockFilters() {
  const [searchParams, setSearchParams] = useSearchParams();

  const [search, setSearch] = useState(searchParams.get("search") || "");
  const debouncedSearch = useDebounce(search, 300);
  const [searchActiveIndex, setSearchActiveIndex] = useState(-1);
  const [searchDropdownOpen, setSearchDropdownOpen] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const searchItemRefs = useRef<(HTMLDivElement | null)[]>([]);

  const {
    filters: sf,
    setFilters: setSf,
    clearFilters: clearSf,
    hasActiveFilters: hasSfActive,
  } = useFilterStorage("stock", STOCK_FILTER_DEFAULTS);

  const categoriaId = sf.categoriaId;
  const proveedorId = sf.proveedorId;
  const areaId = sf.areaId;
  const customFilters = sf.customFilters || {};
  const setCategoriaId = (v: number | null) =>
    setSf((f) => ({ ...f, categoriaId: v }));
  const setProveedorId = (v: number | null) =>
    setSf((f) => ({ ...f, proveedorId: v }));
  const setAreaId = (v: number | null) => setSf((f) => ({ ...f, areaId: v }));
  const setCustomFilter = (key: string, value: string | null) => {
    setSf((f) => {
      const nextCustom = { ...f.customFilters || {} };
      if (value === null || value === "") {
        delete nextCustom[key];
      } else {
        nextCustom[key] = value;
      }
      return { ...f, customFilters: nextCustom };
    });
  };

  const estadoParam =
    searchParams.get("estado") ?? searchParams.get("filter") ?? "todos";
  const [estado, setEstadoState] = useState<EstadoFiltro>(
    parseEstado(estadoParam),
  );

  const setEstado = (e: EstadoFiltro) => {
    setEstadoState(e);
    const newParams = new URLSearchParams(searchParams);
    newParams.delete("filter");
    newParams.delete("alertas");
    if (e === "todos") newParams.delete("estado");
    else newParams.set("estado", e);
    setSearchParams(newParams);
  };

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

  // Sincronizar URL con estado local
  useEffect(() => {
    const s = searchParams.get("search");
    const eParam =
      searchParams.get("estado") ?? searchParams.get("filter") ?? "todos";
    const eValido = parseEstado(eParam);
    if (s !== null && s !== search) setSearch(s);
    if (eValido !== estado) setEstadoState(eValido);
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSearchKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    searchSuggestions: StockItem[],
  ) => {
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
        setSearch(searchSuggestions[searchActiveIndex].producto_nombre);
        setSearchDropdownOpen(false);
        setSearchActiveIndex(-1);
      }
    } else if (e.key === "Escape") {
      setSearch("");
      setSearchDropdownOpen(false);
      setSearchActiveIndex(-1);
    }
  };

  return {
    search,
    debouncedSearch,
    setSearch,
    estado,
    setEstado,
    categoriaId,
    setCategoriaId,
    proveedorId,
    setProveedorId,
    areaId,
    setAreaId,
    clearSf,
    hasSfActive,
    customFilters,
    setCustomFilter,
    searchActiveIndex,
    setSearchActiveIndex,
    searchDropdownOpen,
    setSearchDropdownOpen,
    searchContainerRef,
    searchItemRefs,
    handleSearchKeyDown,
  };
}
