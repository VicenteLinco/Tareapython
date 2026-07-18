// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";

// We test the cache logic and default values by importing the context module
// and testing the provider behavior through mocked fetch.

describe("BrandingContext", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("uses defaults when no cache and fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network")));

    const { BrandingProvider, useBranding } = await import(
      "@/contexts/BrandingContext"
    );
    const { renderHook, act } = await import("@testing-library/react");

    const { result } = renderHook(() => useBranding(), {
      wrapper: BrandingProvider,
    });

    // Initially loading with defaults
    expect(result.current.nombre).toBe("Laboratorio Clínico");
    expect(result.current.favicon_base64).toBeNull();
    expect(result.current.login_bg_color).toBeNull();

    // After fetch fails, loading should be false and defaults remain
    await act(async () => {
      // Wait for the fetch to resolve/reject
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.nombre).toBe("Laboratorio Clínico");
  });

  it("applies branding data from fetch", async () => {
    const mockData = {
      nombre_laboratorio: "Lab Test",
      login_imagen_base64: null,
      favicon_base64: "data:image/x-icon;base64,abc123",
      login_bg_color: "#ff0000",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockData),
      }),
    );

    const { BrandingProvider, useBranding } = await import(
      "@/contexts/BrandingContext"
    );
    const { renderHook, act } = await import("@testing-library/react");

    const { result } = renderHook(() => useBranding(), {
      wrapper: BrandingProvider,
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.nombre).toBe("Lab Test");
    expect(result.current.favicon_base64).toBe("data:image/x-icon;base64,abc123");
    expect(result.current.login_bg_color).toBe("#ff0000");
  });
});
