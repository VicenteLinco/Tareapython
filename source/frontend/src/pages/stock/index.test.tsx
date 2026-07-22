// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import api from "@/lib/api";
import StockPage from ".";

vi.mock("@/lib/api", () => ({
  default: { get: vi.fn() },
}));

vi.mock("@/hooks/use-auth-store", () => ({
  useAuthStore: (selector: (state: unknown) => unknown) =>
    selector({ usuario: { nombre: "Test", rol: "tecnologo" } }),
}));

vi.mock("@/hooks/dominio/useCatalogos", () => ({
  useAreas: () => ({ data: [] }),
  useCategorias: () => ({ data: [] }),
  useProveedores: () => ({ data: [] }),
}));

vi.mock("./components/stock-list", () => ({
  StockList: () => <div>Stock rows</div>,
}));

vi.mock("./components/stock-secondary-filters", () => ({
  StockSecondaryFilters: () => null,
}));

vi.mock("./components/stock-detail-panel", () => ({
  StockDetailPanel: () => null,
}));

vi.mock("./components/search-dropdown", () => ({
  SearchDropdown: () => null,
}));

vi.mock("./components/pdf-export-modal", () => ({
  PdfExportModal: () => null,
}));

const renderPage = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MemoryRouter initialEntries={["/stock"]}>
      <QueryClientProvider client={queryClient}>
        <StockPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
};

describe("StockPage pagination", () => {
  afterEach(cleanup);

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.mocked(api.get).mockImplementation((url, config) => {
      if (url === "/stock") {
        return Promise.resolve({
          data: {
            data: [],
            total: 75,
            page: config?.params?.page ?? 1,
            per_page: config?.params?.per_page ?? 25,
            total_pages: 3,
          },
        });
      }
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });
  });

  it("requests and displays each selected page", async () => {
    renderPage();

    await screen.findByText("Mostrando 1-25 de 75 resultados");
    expect(api.get).toHaveBeenCalledWith(
      "/stock",
      expect.objectContaining({
        params: expect.objectContaining({
          incluir_pendientes: true,
          page: 1,
          per_page: 25,
        }),
      }),
    );

    const nextButton = screen.getByRole("button", { name: "Página siguiente" });
    fireEvent.click(nextButton);

    await screen.findByText("Mostrando 26-50 de 75 resultados");
    expect(api.get).toHaveBeenCalledWith(
      "/stock",
      expect.objectContaining({
        params: expect.objectContaining({ page: 2, per_page: 25 }),
      }),
    );
  });

  it("returns to the first page when a filter changes", async () => {
    renderPage();
    await screen.findByText("Mostrando 1-25 de 75 resultados");

    const nextButton = screen.getByRole("button", { name: "Página siguiente" });
    fireEvent.click(nextButton);
    await screen.findByText("Mostrando 26-50 de 75 resultados");

    fireEvent.change(screen.getByPlaceholderText("Buscar por nombre o código..."), {
      target: { value: "reactivo" },
    });

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith(
        "/stock",
        expect.objectContaining({
          params: expect.objectContaining({ q: "reactivo", page: 1 }),
        }),
      );
    });
    expect(await screen.findByText("Mostrando 1-25 de 75 resultados")).toBeDefined();
  });

  it("recovers automatically when the selected page is no longer valid", async () => {
    vi.mocked(api.get).mockImplementation((url, config) => {
      if (url !== "/stock") return Promise.reject(new Error(`Unexpected request: ${url}`));
      const page = config?.params?.page ?? 1;
      return Promise.resolve({
        data: {
          data: [],
          total: 10,
          page,
          per_page: 25,
          total_pages: page === 1 ? 3 : 1,
        },
      });
    });
    renderPage();
    await screen.findByText("Mostrando 1-10 de 10 resultados");
    vi.mocked(api.get).mockClear();

    const nextButton = screen.getByRole("button", { name: "Página siguiente" });
    fireEvent.click(nextButton);

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith(
        "/stock",
        expect.objectContaining({
          params: expect.objectContaining({ page: 2 }),
        }),
      );
    });
    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith(
        "/stock",
        expect.objectContaining({
          params: expect.objectContaining({ page: 1 }),
        }),
      );
    });
    expect(await screen.findByText("Mostrando 1-10 de 10 resultados")).toBeDefined();
  });
});
