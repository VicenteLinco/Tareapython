import { useState, useCallback } from "react";

/**
 * Persiste filtros de una página en sessionStorage.
 * La clave debe ser única por pantalla (ej. 'stock', 'recepciones').
 */
export function useFilterStorage<T extends object>(key: string, defaults: T) {
  const storageKey = `filters:${key}`;

  const [filters, setFiltersInner] = useState<T>(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw) return { ...defaults, ...JSON.parse(raw) };
    } catch {
      /* ignore */
    }
    return { ...defaults };
  });

  const setFilters = useCallback(
    (value: T | ((prev: T) => T)) => {
      setFiltersInner((prev) => {
        const next = typeof value === "function" ? value(prev) : value;
        try {
          sessionStorage.setItem(storageKey, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      });
    },
    [storageKey],
  );

  const clearFilters = useCallback(() => {
    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      /* ignore */
    }
    setFiltersInner({ ...defaults });
    // defaults se compara por identidad — los callers deben pasar un objeto estable (literal de módulo)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  const hasActiveFilters = JSON.stringify(filters) !== JSON.stringify(defaults);

  return { filters, setFilters, clearFilters, hasActiveFilters };
}
