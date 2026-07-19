// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SmartImporter } from "./smart-importer";

vi.mock("@/lib/api", () => ({ default: {} }));
vi.mock("@/lib/notify", () => ({ notify: vi.fn() }));

afterEach(cleanup);

describe("SmartImporter upload step", () => {
  it("exposes an accessible CSV browse control connected to the file input", () => {
    render(<SmartImporter onComplete={vi.fn()} onCancel={vi.fn()} />);

    const input = screen.getByLabelText("Seleccionar archivo CSV");
    const browse = screen.getByText("Explorar CSV", { selector: "label" });

    expect(input.getAttribute("id")).toBe("smart-importer-csv-file");
    expect(browse.getAttribute("for")).toBe("smart-importer-csv-file");
  });
});
