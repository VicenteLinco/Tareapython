// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { OfertasProveedorManager } from "./ofertas-proveedor-manager";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import api from "@/lib/api";
import { notify } from "@/lib/notify";

// Mock api
vi.mock("@/lib/api", () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

// Mock notify
vi.mock("@/lib/notify", () => ({
  notify: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock ProveedorSelect
vi.mock("@/components/ui/proveedor-select", () => ({
  ProveedorSelect: ({ value, onChange, proveedores }: any) => (
    <select
      data-testid="mock-proveedor-select"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">Select provider</option>
      {proveedores.map((p: any) => (
        <option key={p.id} value={p.id}>
          {p.nombre}
        </option>
      ))}
    </select>
  ),
}));

// Mock useProveedores hook
vi.mock("@/hooks/dominio", () => ({
  useProveedores: () => ({
    data: [
      { id: 1, nombre: "Proveedor A" },
      { id: 2, nombre: "Proveedor B" },
    ],
  }),
}));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
});

const renderComponent = () => {
  return render(
    <QueryClientProvider client={queryClient}>
      <OfertasProveedorManager productoId="prod-123" />
    </QueryClientProvider>
  );
};

describe("OfertasProveedorManager", () => {
  beforeEach(() => {
    // Mock HTMLDialogElement methods that are missing in JSDOM
    HTMLDialogElement.prototype.showModal = vi.fn();
    HTMLDialogElement.prototype.close = vi.fn();
    vi.clearAllMocks();
  });

  it("renders loader initially and then renders the data table and new offer button", async () => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes("presentaciones")) {
        return Promise.resolve({
          data: [
            { id: 10, nombre: "Caja x100", factor_conversion: 100 },
          ],
        });
      }
      if (url.includes("ofertas")) {
        return Promise.resolve({
          data: [
            { id: 1, presentacion_id: 10, proveedor_id: 1, precio_adquisicion: "85.00", sku: "SKU123" },
          ],
        });
      }
      return Promise.reject(new Error("Unknown URL"));
    });

    renderComponent();

    // Check loader
    expect(screen.getByText(/Cargando/)).toBeDefined();

    // Wait for content
    await waitFor(() => {
      expect(screen.getByText("Ofertas de Proveedores")).toBeDefined();
      const buttons = screen.getAllByText("Nueva Oferta");
      expect(buttons.some(el => el.tagName === "BUTTON")).toBe(true);
      expect(screen.getByText("SKU123")).toBeDefined();
    });
  });

  it("opens modal and allows filling and submitting form for a new supplier offer", async () => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes("presentaciones")) {
        return Promise.resolve({
          data: [
            { id: 10, nombre: "Caja x100", factor_conversion: 100 },
          ],
        });
      }
      if (url.includes("ofertas")) {
        return Promise.resolve({ data: [] });
      }
      return Promise.reject(new Error("Unknown URL"));
    });

    vi.mocked(api.post).mockResolvedValue({ data: { success: true } });

    renderComponent();

    await waitFor(() => {
      const buttons = screen.getAllByText("Nueva Oferta");
      expect(buttons.some(el => el.tagName === "BUTTON")).toBe(true);
    });

    const addBtn = screen.getAllByText("Nueva Oferta").find(el => el.tagName === "BUTTON")!;
    fireEvent.click(addBtn);

    // Form inputs should now be in the DOM
    await waitFor(() => {
      expect(screen.getByText("Precio de Adquisición")).toBeDefined();
    });

    // Select presentation (automatically selected since there is only one)
    const presSelect = document.querySelector("select") as HTMLSelectElement;
    expect(presSelect.value).toBe("10");

    // Select provider
    const provSelect = screen.getByTestId("mock-proveedor-select") as HTMLSelectElement;
    fireEvent.change(provSelect, { target: { value: "1" } });
    expect(provSelect.value).toBe("1");

    // Enter price
    const priceInput = screen.getByPlaceholderText("0.00") as HTMLInputElement;
    fireEvent.change(priceInput, { target: { value: "125.50" } });
    expect(priceInput.value).toBe("125.50");

    // Enter SKU
    const skuInput = screen.getByPlaceholderText("Ej: REF-12345") as HTMLInputElement;
    fireEvent.change(skuInput, { target: { value: "REF-TEST" } });
    expect(skuInput.value).toBe("REF-TEST");

    // Submit
    const submitBtn = screen.getByText("Guardar Oferta");
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        "/productos/prod-123/ofertas",
        {
          presentacion_id: 10,
          proveedor_id: 1,
          precio_adquisicion: "125.50",
          sku: "REF-TEST",
        }
      );
      expect(notify.success).toHaveBeenCalledWith("Oferta registrada exitosamente");
    });
  });
});
