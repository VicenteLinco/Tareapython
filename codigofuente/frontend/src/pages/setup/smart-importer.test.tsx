// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SmartImporter, buildProductImportTemplate } from "./smart-importer";

const { apiGet, apiPost } = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn() }));
vi.mock("@/lib/api", () => ({ default: { get: apiGet, post: apiPost } }));
vi.mock("@/lib/notify", () => ({ notify: { error: vi.fn(), success: vi.fn() } }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SmartImporter upload step", () => {
  it("exposes an accessible CSV browse control connected to the file input", () => {
    render(<SmartImporter onComplete={vi.fn()} onCancel={vi.fn()} />);

    const input = screen.getByLabelText("Seleccionar archivo CSV");
    const browse = screen.getByText("Explorar CSV", { selector: "label" });

    expect(input.getAttribute("id")).toBe("smart-importer-csv-file");
    expect(browse.getAttribute("for")).toBe("smart-importer-csv-file");
  });

  it("maps active product-scoped Lab fields and manages independent global fills", async () => {
    apiGet.mockResolvedValueOnce({
      data: [
        { id: "field-1", nombre: "Registro sanitario", tipo_dato: "texto", requerido: false, considerar_filtro: true, activo: true, alcance: "producto" },
        { id: "field-2", nombre: "Nombre del laboratorio", tipo_dato: "texto", requerido: false, considerar_filtro: true, activo: true, alcance: "laboratorio" },
      ],
    });
    render(<SmartImporter onComplete={vi.fn()} onCancel={vi.fn()} />);

    const input = screen.getByLabelText("Seleccionar archivo CSV");
    fireEvent.change(input, { target: { files: [new File(["nombre,registro\nReactivo A,RS-1"], "productos.csv", { type: "text/csv" })] } });

    expect(await screen.findByLabelText("Columna CSV para Registro sanitario")).toBeTruthy();
    expect(screen.queryByText("Nombre del laboratorio")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Agregar relleno global" }));
    expect(screen.getAllByLabelText("Valor de relleno global")).toHaveLength(2);
    fireEvent.click(screen.getAllByRole("button", { name: "Eliminar relleno global" })[0]);
    expect(screen.getAllByLabelText("Valor de relleno global")).toHaveLength(1);
  });

  it("shows the explicit server rejection cause inside the importer", async () => {
    apiGet.mockResolvedValueOnce({ data: [] });
    apiPost.mockRejectedValueOnce({ response: { data: { mensaje: "La fila 2 tiene una fecha inválida" } } });
    render(<SmartImporter onComplete={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Seleccionar archivo CSV"), {
      target: { files: [new File(["nombre\nReactivo A"], "productos.csv", { type: "text/csv" })] },
    });
    fireEvent.click(await screen.findByRole("button", { name: /Validar Datos/i }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("La fila 2 tiene una fecha inválida"));
  });

  it("submits an effective mapping for an unmapped custom-field global fill", async () => {
    const fieldId = "11111111-1111-1111-1111-111111111111";
    apiGet.mockResolvedValueOnce({
      data: [{ id: fieldId, nombre: "Registro sanitario", tipo_dato: "texto", requerido: false, considerar_filtro: true, activo: true, alcance: "producto" }],
    });
    apiPost.mockResolvedValueOnce({ data: { preview: [], errores: [], advertencias: [] } });
    render(<SmartImporter onComplete={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Seleccionar archivo CSV"), {
      target: { files: [new File(["nombre\nReactivo A"], "productos.csv", { type: "text/csv" })] },
    });
    await screen.findByLabelText("Columna CSV para Registro sanitario");

    fireEvent.change(screen.getByLabelText("Campo de relleno global"), {
      target: { value: `lab_${fieldId}` },
    });
    fireEvent.change(screen.getByLabelText("Valor de relleno global"), {
      target: { value: "RS-99" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Validar Datos/i }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
    const formData = apiPost.mock.calls[0][1] as FormData;
    const config = JSON.parse(String(formData.get("config")));
    expect(config.mapping[`lab_${fieldId}`]).toBe(`lab_${fieldId}`);
    expect(await (formData.get("file") as File).text()).toContain(`lab_${fieldId}`);
  });

  it("clears a previous rejection after a successful validation retry", async () => {
    apiGet.mockResolvedValueOnce({ data: [] });
    apiPost
      .mockRejectedValueOnce({ response: { data: { mensaje: "CSV rechazado por fecha inválida" } } })
      .mockResolvedValueOnce({ data: { preview: [], errores: [], advertencias: [] } });
    render(<SmartImporter onComplete={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Seleccionar archivo CSV"), {
      target: { files: [new File(["nombre\nReactivo A"], "productos.csv", { type: "text/csv" })] },
    });
    const validate = await screen.findByRole("button", { name: /Validar Datos/i });
    fireEvent.click(validate);
    await screen.findByRole("alert");
    fireEvent.click(validate);

    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("generates a usable typed template with active dynamic Lab fields", async () => {
    const fieldId = "22222222-2222-2222-2222-222222222222";
    const customField = {
      id: fieldId,
      nombre: "Registro sanitario",
      tipo_dato: "entero",
      requerido: true,
      considerar_filtro: true,
      activo: true,
      alcance: "producto" as const,
      opciones_lista: null,
    };
    const template = buildProductImportTemplate([customField]);
    const [headerLine] = template.split("\n");
    expect(headerLine).toContain("nombre [tipo=texto; requerido=si]");
    expect(headerLine).toContain(
      `lab_${fieldId} [nombre=Registro sanitario; tipo=entero; requerido=si]`,
    );
    expect(template.split("\n")).toHaveLength(1);

    apiGet.mockResolvedValueOnce({ data: [customField] });
    apiPost.mockResolvedValueOnce({
      data: {
        preview: [],
        errores: [{
          fila: 2,
          campo: `lab_${fieldId}`,
          codigo: "INVALID_CUSTOM_INTEGER",
          mensaje: "El campo 'Registro sanitario' espera tipo entero; valor recibido: 'no-es-entero'.",
        }],
        advertencias: [],
      },
    });
    render(<SmartImporter onComplete={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Seleccionar archivo CSV"), {
      target: {
        files: [new File([`${template}\nReactivo A,,,,,,,no-es-entero`], "plantilla-productos.csv", { type: "text/csv" })],
      },
    });
    const customMapping = await screen.findByLabelText("Columna CSV para Registro sanitario");
    expect((customMapping as HTMLSelectElement).value).toContain(`lab_${fieldId}`);
    fireEvent.click(screen.getByRole("button", { name: /Validar Datos/i }));
    expect(await screen.findByText(/espera tipo entero; valor recibido: 'no-es-entero'/)).toBeTruthy();
    const formData = apiPost.mock.calls[0][1] as FormData;
    const config = JSON.parse(String(formData.get("config")));
    expect(config.mapping.nombre).toBe("nombre [tipo=texto; requerido=si]");
    expect(config.mapping[`lab_${fieldId}`]).toBe(
      `lab_${fieldId} [nombre=Registro sanitario; tipo=entero; requerido=si]`,
    );
    expect(config.required_fields).toEqual([]);
  });

  it("round-trips quoted custom metadata with commas, quotes, newlines, and CRLF", async () => {
    const fieldId = "33333333-3333-3333-3333-333333333333";
    const customField = {
      id: fieldId,
      nombre: 'Clasificación, "sanitaria"\nregional',
      tipo_dato: "lista",
      requerido: false,
      considerar_filtro: true,
      activo: true,
      alcance: "producto" as const,
      opciones_lista: ['A, "especial"', "B\nregional"],
    };
    const template = buildProductImportTemplate([customField]);
    const expectedCustomHeader =
      `lab_${fieldId} [nombre=${customField.nombre}; tipo=lista; requerido=no; opciones=${customField.opciones_lista.join("|")}]`;
    apiGet.mockResolvedValueOnce({ data: [customField] });
    apiPost.mockResolvedValueOnce({
      data: { preview: [], errores: [], advertencias: [] },
    });
    render(<SmartImporter onComplete={vi.fn()} onCancel={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("Seleccionar archivo CSV"), {
      target: {
        files: [
          new File(
            [`${template.replace(/\n/g, "\r\n")}\r\nReactivo A,,,,,,,"A, ""especial"""`],
            "plantilla-productos.csv",
            { type: "text/csv" },
          ),
        ],
      },
    });
    const customMapping = await screen.findByLabelText(
      /Columna CSV para Clasificación, "sanitaria" regional/,
    );
    expect((customMapping as HTMLSelectElement).value).toBe(expectedCustomHeader.replace(/\n/g, "\r\n"));
    fireEvent.click(screen.getByRole("button", { name: /Validar Datos/i }));

    await waitFor(() => expect(apiPost).toHaveBeenCalledTimes(1));
    const formData = apiPost.mock.calls[0][1] as FormData;
    const config = JSON.parse(String(formData.get("config")));
    expect(config.mapping.nombre).toBe("nombre [tipo=texto; requerido=si]");
    expect(config.mapping[`lab_${fieldId}`]).toBe(expectedCustomHeader.replace(/\n/g, "\r\n"));
  });

  it("offers a base template and retries custom-field loading after a transient failure", async () => {
    apiGet
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce({ data: [] });
    render(<SmartImporter onComplete={vi.fn()} onCancel={vi.fn()} />);

    const baseTemplate = await screen.findByRole("button", {
      name: "Descargar plantilla base",
    });
    expect(baseTemplate.hasAttribute("disabled")).toBe(false);
    fireEvent.click(
      screen.getByRole("button", { name: "Reintentar campos personalizados" }),
    );

    expect(
      (await screen.findByRole("button", { name: "Descargar plantilla" })).hasAttribute(
        "disabled",
      ),
    ).toBe(false);
    expect(apiGet).toHaveBeenCalledTimes(2);
  });
});
