import { useState, useRef, useEffect, useMemo } from "react";
import { Truck, ChevronDown, Check, Search } from "lucide-react";
import type { Proveedor } from "@/types";
import { isSafeIconUrl, cn } from "@/lib/utils";

// Reusable icon: emoji, logo URL (https only), or truck fallback
export function ProveedorIcon({
  proveedor,
  className = "h-5 w-5",
}: {
  proveedor: { nombre?: string; icono?: string | null } | null | undefined;
  className?: string;
}) {
  const [imgError, setImgError] = useState(false);
  const icono = proveedor?.icono;
  const safeUrl = isSafeIconUrl(icono);

  // Un emoji es una cadena muy corta que no empieza como una URL o data URL.
  // Usamos una Regex para detectar si contiene al menos un emoji común.
  const isEmoji =
    !!icono &&
    icono.length <= 10 &&
    !icono.startsWith("http") &&
    !icono.startsWith("/") &&
    !icono.startsWith("data:");

  if (isEmoji) {
    return (
      <span
        className={cn(
          "shrink-0 flex items-center justify-center text-lg leading-none select-none",
          className,
        )}
      >
        {icono}
      </span>
    );
  }

  if (safeUrl && !imgError) {
    return (
      <div
        className={cn(
          "relative shrink-0 flex items-center justify-center overflow-hidden rounded",
          className,
        )}
      >
        <img
          src={icono!}
          alt=""
          className="h-full w-full object-contain"
          onError={() => setImgError(true)}
          referrerPolicy="no-referrer"
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "shrink-0 flex items-center justify-center bg-base-200 rounded",
        className,
      )}
    >
      <Truck className="h-[60%] w-[60%] opacity-30" />
    </div>
  );
}

interface ProveedorSelectProps {
  value: string | number;
  onChange: (value: string) => void;
  proveedores: Proveedor[];
  placeholder?: string;
  /** If provided, an "all" option is shown at the top with this label */
  allLabel?: string;
  className?: string;
  size?: "sm" | "md";
  searchable?: boolean;
}

export function ProveedorSelect({
  value,
  onChange,
  proveedores,
  placeholder = "Seleccionar proveedor...",
  allLabel,
  className = "",
  size = "sm",
  searchable = false,
}: ProveedorSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const selected = proveedores.find((p) => String(p.id) === String(value));

  const filteredProveedores = useMemo(() => {
    return searchable && query.trim()
      ? proveedores.filter((p) =>
          p.nombre.toLowerCase().includes(query.toLowerCase()),
        )
      : proveedores;
  }, [proveedores, searchable, query]);

  const options = useMemo(() => {
    const list: Array<{ id: string; nombre: string; isAll?: boolean }> = [];
    if (allLabel !== undefined) {
      list.push({ id: "", nombre: allLabel, isAll: true });
    }
    filteredProveedores.forEach((p) => {
      list.push({ id: String(p.id), nombre: p.nombre });
    });
    return list;
  }, [allLabel, filteredProveedores]);

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  useEffect(() => {
    if (open && searchable) {
      setTimeout(() => searchRef.current?.focus(), 50);
    }
    if (!open) setQuery("");
    setActiveIndex(-1);
  }, [open, searchable, query]);

  useEffect(() => {
    if (activeIndex >= 0 && listRef.current) {
      const activeEl = listRef.current.children[activeIndex] as HTMLElement;
      if (activeEl) {
        activeEl.scrollIntoView({
          block: "nearest",
        });
      }
    }
  }, [activeIndex]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter") {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (options.length === 0) return;
      setActiveIndex((i) => (i + 1) % options.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (options.length === 0) return;
      setActiveIndex((i) => (i <= 0 ? options.length - 1 : i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIndex >= 0 && options[activeIndex]) {
        const opt = options[activeIndex];
        onChange(opt.id);
      }
      setOpen(false);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      setQuery("");
    }
  };

  const height = size === "sm" ? "h-9" : "h-10";
  const textSize = size === "sm" ? "text-sm" : "text-base";

  return (
    <div ref={ref} className={`relative ${className}`} onKeyDown={handleKeyDown}>
      <button
        type="button"
        className={`${height} ${textSize} w-full flex items-center gap-2 px-3 border border-base-300 rounded-lg bg-base-100 hover:bg-base-200 transition-colors`}
        onClick={() => setOpen((o) => !o)}
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {selected ? (
            <>
              <ProveedorIcon proveedor={selected} className="h-4 w-4" />
              <span className="truncate">{selected.nombre}</span>
            </>
          ) : (
            <span className="text-base-content/40 truncate">
              {allLabel ?? placeholder}
            </span>
          )}
        </div>
        <ChevronDown className="h-3.5 w-3.5 opacity-40 shrink-0" />
      </button>

      {open && (
        <div className="app-floating-menu absolute top-full mt-1 left-0 right-0 rounded-box z-50">
          {searchable && (
            <div className="p-2 border-b border-base-200">
              <div className="flex items-center gap-2 px-2 py-1.5 bg-base-200 rounded-lg">
                <Search className="h-3.5 w-3.5 opacity-40 shrink-0" />
                <input
                  ref={searchRef}
                  type="text"
                  className="bg-transparent text-sm outline-none flex-1 min-w-0 placeholder:opacity-40"
                  placeholder="Buscar proveedor..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onMouseDown={(e) => e.stopPropagation()}
                />
              </div>
            </div>
          )}
          <div className="max-h-56 overflow-y-auto" ref={listRef}>
            {allLabel !== undefined && (
              <div
                className={`flex items-center gap-2 px-3 py-2 cursor-pointer text-sm text-base-content/40 ${activeIndex === 0 ? "bg-base-200" : !value ? "bg-base-200/50" : "hover:bg-base-200"}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange("");
                  setOpen(false);
                }}
              >
                {allLabel}
              </div>
            )}
            {filteredProveedores.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs opacity-40">
                Sin resultados
              </div>
            ) : (
              filteredProveedores.map((p, idx) => {
                const itemIndex = allLabel !== undefined ? idx + 1 : idx;
                const isActive = activeIndex === itemIndex;
                const isSelected = String(p.id) === String(value);
                return (
                  <div
                    key={p.id}
                    className={`flex items-center gap-2 px-3 py-2 cursor-pointer ${isActive ? "bg-base-200" : isSelected ? "bg-primary/10" : "hover:bg-base-200"}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      onChange(String(p.id));
                      setOpen(false);
                    }}
                  >
                    <ProveedorIcon proveedor={p} className="h-4 w-4" />
                    <span className="text-sm flex-1">{p.nombre}</span>
                    {isSelected && (
                      <Check className="h-3.5 w-3.5 text-primary shrink-0" />
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
