import { createContext, useContext, useState, useEffect, type ReactNode } from "react";

interface BrandingData {
  nombre: string;
  favicon_base64: string | null;
  login_imagen_base64: string | null;
  login_bg_color: string | null;
  loading: boolean;
}

const DEFAULTS: BrandingData = {
  nombre: "Laboratorio Clínico",
  favicon_base64: null,
  login_imagen_base64: null,
  login_bg_color: null,
  loading: true,
};

const BrandingContext = createContext<BrandingData>(DEFAULTS);

const CACHE_KEY = "branding-cache";
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CachedBranding {
  data: Omit<BrandingData, "loading">;
  timestamp: number;
}

function readCache(): Omit<BrandingData, "loading"> | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed: CachedBranding = JSON.parse(raw);
    if (Date.now() - parsed.timestamp > CACHE_TTL_MS) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function writeCache(data: Omit<BrandingData, "loading">) {
  try {
    const entry: CachedBranding = { data, timestamp: Date.now() };
    localStorage.setItem(CACHE_KEY, JSON.stringify(entry));
  } catch {
    // Storage full or unavailable — silently ignore
  }
}

export function BrandingProvider({ children }: { children: ReactNode }) {
  const [branding, setBranding] = useState<BrandingData>(() => {
    const cached = readCache();
    if (cached) return { ...cached, loading: false };
    return DEFAULTS;
  });

  useEffect(() => {
    let cancelled = false;

    async function fetchBranding() {
      try {
        const res = await fetch("/api/v1/branding");
        if (!res.ok) throw new Error("Branding fetch failed");
        const data = await res.json();

        const resolved: Omit<BrandingData, "loading"> = {
          nombre: data.nombre_laboratorio?.trim() || DEFAULTS.nombre,
          favicon_base64: data.favicon_base64 || null,
          login_imagen_base64: data.login_imagen_base64 || null,
          login_bg_color: data.login_bg_color || null,
        };

        if (!cancelled) {
          setBranding({ ...resolved, loading: false });
          writeCache(resolved);
        }
      } catch {
        if (!cancelled) {
          setBranding((prev) => ({
            ...prev,
            loading: false,
          }));
        }
      }
    }

    fetchBranding();
    return () => { cancelled = true; };
  }, []);

  // Apply document.title and dynamic favicon when branding loads
  useEffect(() => {
    if (branding.loading) return;

    // Update document title
    if (branding.nombre) {
      document.title = branding.nombre;
    }

    // Update favicon
    if (branding.favicon_base64) {
      let link = document.querySelector<HTMLLinkElement>("link[rel=\"icon\"]");
      if (!link) {
        link = document.createElement("link");
        link.rel = "icon";
        document.head.appendChild(link);
      }
      link.type = "image/x-icon";
      link.href = branding.favicon_base64;
    }
  }, [branding.loading, branding.nombre, branding.favicon_base64]);

  return (
    <BrandingContext.Provider value={branding}>
      {children}
    </BrandingContext.Provider>
  );
}

export function useBranding(): BrandingData {
  return useContext(BrandingContext);
}
