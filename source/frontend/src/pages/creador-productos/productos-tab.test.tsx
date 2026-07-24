// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import api from "@/lib/api";
import ProductosTab from "./productos-tab";

vi.mock("@/lib/api", () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

const product = (index: number) => ({
  id: `00000000-0000-0000-0000-${String(index).padStart(12, "0")}`,
  codigo_interno: `PRD-${String(index).padStart(4, "0")}`,
  nombre: `Producto ${String(index).padStart(2, "0")}`,
  categoria: null,
  unidad_base: null,
  area: null,
  lead_time_propio: null,
  activo: true,
  version: 1,
});

function renderTab() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MemoryRouter initialEntries={["/creador-productos"]}>
      <QueryClientProvider client={queryClient}>
        <ProductosTab />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("ProductosTab pagination", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.get).mockImplementation((url, config) => {
      if (url === "/productos") {
        const page = config?.params?.page ?? 1;
        return Promise.resolve({
          data: {
            data: page === 1
              ? Array.from({ length: 20 }, (_, index) => product(index + 1))
              : [product(21)],
            total: 21,
            page,
            per_page: 20,
            total_pages: 2,
          },
        });
      }
      if (["/categorias", "/unidades-basicas", "/areas"].includes(url)) {
        return Promise.resolve({ data: [] });
      }
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });
  });

  it("shows controls for 21 products and requests the second page", async () => {
    renderTab();

    await screen.findByText("Mostrando 1-20 de 21 resultados");
    expect(screen.getByText("Producto 01")).toBeInTheDocument();

    const nextButton = screen.getByRole("button", { name: "Página siguiente" });
    fireEvent.click(nextButton);

    expect(await screen.findByText("Mostrando 21-21 de 21 resultados")).toBeInTheDocument();
    expect(await screen.findByText("Producto 21")).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith(
      "/productos",
      expect.objectContaining({
        params: expect.objectContaining({ page: 2, per_page: 20 }),
      }),
    );
  });

  it("returns to page one when a filter changes", async () => {
    renderTab();

    await screen.findByText("Mostrando 1-20 de 21 resultados");
    const nextButton = screen.getByRole("button", { name: "Página siguiente" });
    fireEvent.click(nextButton);
    await screen.findByText("Mostrando 21-21 de 21 resultados");

    fireEvent.change(screen.getByPlaceholderText("Buscar producto..."), {
      target: { value: "reactivo" },
    });

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith(
        "/productos",
        expect.objectContaining({
          params: expect.objectContaining({ q: "reactivo", page: 1 }),
        }),
      );
    });
    expect(await screen.findByText("Mostrando 1-20 de 21 resultados")).toBeInTheDocument();
  });

  it("recovers when the selected page is no longer valid", async () => {
    vi.mocked(api.get).mockImplementation((url, config) => {
      if (url === "/productos") {
        const page = config?.params?.page ?? 1;
        return Promise.resolve({
          data: {
            data: page === 1 ? [product(1)] : [],
            total: page === 1 ? 21 : 1,
            page,
            per_page: 20,
            total_pages: page === 1 ? 2 : 1,
          },
        });
      }
      if (["/categorias", "/unidades-basicas", "/areas"].includes(url)) {
        return Promise.resolve({ data: [] });
      }
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });
    renderTab();

    await screen.findByText("Mostrando 1-20 de 21 resultados");
    const nextButton = screen.getByRole("button", { name: "Página siguiente" });
    fireEvent.click(nextButton);

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith(
        "/productos",
        expect.objectContaining({
          params: expect.objectContaining({ page: 2 }),
        }),
      );
    });
    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith(
        "/productos",
        expect.objectContaining({
          params: expect.objectContaining({ page: 1 }),
        }),
      );
    });
    expect(await screen.findByText("Producto 01")).toBeInTheDocument();
  });
});

describe('Creador Freeze Rules', () => {
  it('UI-CREADOR-FREEZE-001: Ofertas tab must be hidden', () => {
    renderTab();
    expect(screen.queryByText('Ofertas')).not.toBeInTheDocument();
  });
});
