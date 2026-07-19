// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProductSchema } from "@/types";
import {
  ProductImporter,
  validateProductMapping,
} from "./product-importer";

const schema: ProductSchema = {
  version: "1",
  limits: {
    max_file_bytes: 5_242_880,
    max_rows: 5_000,
    max_columns: 64,
    max_cell_bytes: 4_096,
  },
  fields: [
    {
      key: "nombre",
      label: "Nombre",
      type: "text",
      section: "identity",
      order: 10,
      domain_required: true,
      import_supported: true,
      aliases: ["producto", "nombre producto"],
      catalog_endpoint: null,
      allowed_values: [],
    },
    {
      key: "categoria_id",
      label: "Categoría",
      type: "catalog",
      section: "classification",
      order: 20,
      domain_required: false,
      import_supported: true,
      aliases: ["categoria"],
      catalog_endpoint: "/categorias",
      allowed_values: [],
    },
    {
      key: "unidad_base_id",
      label: "Unidad base",
      type: "catalog",
      section: "classification",
      order: 25,
      domain_required: false,
      import_supported: true,
      aliases: ["unidad"],
      catalog_endpoint: "/unidades-basicas",
      allowed_values: [],
    },
    {
      key: "imagen",
      label: "Imagen",
      type: "image",
      section: "media",
      order: 30,
      domain_required: false,
      import_supported: false,
      aliases: [],
      catalog_endpoint: null,
      allowed_values: [],
    },
  ],
};

afterEach(cleanup);

describe("ProductImporter schema-driven mapper", () => {
  it("requires only nombre when unidad is optional in the schema", () => {
    const optionalUnitSchema: ProductSchema = {
      ...schema,
      fields: schema.fields.map((field) =>
        field.key === "unidad_base_id"
          ? { ...field, domain_required: false }
          : field,
      ),
    };

    expect(validateProductMapping(optionalUnitSchema, { nombre: "Nombre" })).toEqual({
      valid: true,
      errors: [],
    });
  });
  it("renders every import-supported schema field and locks domain requirements", () => {
    render(
      <ProductImporter
        schema={schema}
        sourceHeaders={["Producto", "Categoría"]}
        onConfigChange={vi.fn()}
      />,
    );

    expect(screen.getByLabelText("Columna CSV para Nombre")).toBeDefined();
    expect(screen.getByLabelText("Columna CSV para Categoría")).toBeDefined();
    expect(screen.queryByLabelText("Columna CSV para Imagen")).toBeNull();

    const requiredName = screen.getByRole("checkbox", {
      name: "Nombre obligatorio para esta importación",
    }) as HTMLInputElement;
    expect(requiredName.checked).toBe(true);
    expect(requiredName.disabled).toBe(true);
  });

  it("only allows promoting an optional field after it is mapped", () => {
    const onConfigChange = vi.fn();
    render(
      <ProductImporter
        schema={schema}
        sourceHeaders={["Producto", "Categoría"]}
        onConfigChange={onConfigChange}
      />,
    );

    const optionalRequired = screen.getByRole("checkbox", {
      name: "Categoría obligatorio para esta importación",
    }) as HTMLInputElement;
    expect(optionalRequired.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Columna CSV para Nombre"), {
      target: { value: "Producto" },
    });
    fireEvent.change(screen.getByLabelText("Columna CSV para Categoría"), {
      target: { value: "Categoría" },
    });
    expect(optionalRequired.disabled).toBe(false);

    fireEvent.click(optionalRequired);
    expect(onConfigChange).toHaveBeenLastCalledWith({
      mapping: { nombre: "Producto", categoria_id: "Categoría" },
      required_fields: ["nombre", "categoria_id"],
      valid: true,
      errors: [],
    });
  });

  it("reports one source column mapped to multiple product fields", () => {
    expect(
      validateProductMapping(schema, {
        nombre: "Producto",
        categoria_id: "Producto",
      }),
    ).toEqual({
      valid: false,
      errors: ['La columna "Producto" está mapeada más de una vez.'],
    });

    expect(
      validateProductMapping(schema, {
        nombre: "Producto",
        categoria_id: "Categoría",
      }),
    ).toEqual({ valid: true, errors: [] });
  });
});
