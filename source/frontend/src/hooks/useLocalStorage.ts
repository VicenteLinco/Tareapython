import { useState, useEffect } from "react";

/**
 * Estado booleano sincronizado con localStorage.
 * Guarda 'true' / 'false' como string. Devuelve `defaultValue` si la clave no existe.
 */
export function useLocalStorageBoolean(
  key: string,
  defaultValue: boolean,
): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState<boolean>(() => {
    const stored = localStorage.getItem(key);
    if (stored === null) return defaultValue;
    return stored !== "false";
  });

  useEffect(() => {
    localStorage.setItem(key, String(value));
  }, [key, value]);

  return [value, setValue];
}
