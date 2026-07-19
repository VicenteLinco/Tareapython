import { describe, expect, it } from "vitest";
import { parseConfiguredAiModels } from "./ai-model-options";

describe("parseConfiguredAiModels", () => {
  it("returns configured selectable models including automatic entries", () => {
    expect(
      parseConfiguredAiModels(JSON.stringify([
        { id: "gemini-auto", name: "Gemini documentos", provider: "gemini", model: "auto", active: true },
        { id: "openai-vision", name: "OpenAI visión", provider: "openai", model: "gpt-4o-mini", active: false },
      ])),
    ).toEqual([
      { id: "gemini-auto", label: "Gemini documentos · Automático" },
      { id: "openai-vision", label: "OpenAI visión · gpt-4o-mini" },
    ]);
  });

  it.each(["", "not-json", "{}", "[null,{}]"])(
    "handles malformed or empty configured JSON: %s",
    (value) => expect(parseConfiguredAiModels(value)).toEqual([]),
  );

  it("trims IDs and rejects empty or duplicate normalized IDs", () => {
    expect(parseConfiguredAiModels(JSON.stringify([
      { id: " vision-a ", name: "Visión", provider: "openai", model: "gpt-4o-mini" },
    ]))[0].id).toBe("vision-a");

    expect(parseConfiguredAiModels(JSON.stringify([
      { id: "vision-a", name: "A", provider: "openai", model: "gpt-4o-mini" },
      { id: " vision-a ", name: "B", provider: "gemini", model: "gemini-2.5-flash" },
    ]))).toEqual([]);
    expect(parseConfiguredAiModels(JSON.stringify([
      { id: "   ", name: "Vacío", provider: "openai", model: "gpt-4o-mini" },
    ]))).toEqual([]);
  });

});
