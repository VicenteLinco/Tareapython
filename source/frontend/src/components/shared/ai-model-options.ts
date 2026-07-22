export interface ConfiguredAiModelOption {
  id: string;
  label: string;
}

export function parseConfiguredAiModels(value: unknown): ConfiguredAiModelOption[] {
  if (typeof value !== "string" || !value.trim()) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const options = parsed.flatMap((entry): ConfiguredAiModelOption[] => {
    if (!entry || typeof entry !== "object") return [];
    const candidate = entry as Record<string, unknown>;
    const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
    const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
    const provider = typeof candidate.provider === "string" ? candidate.provider.trim() : "";
    const model = typeof candidate.model === "string" ? candidate.model.trim() : "";
    if (!id || !name || !provider || !model) return [];

    return [{
      id,
      label: `${name} · ${model.toLowerCase() === "auto" ? "Automático" : model}`,
    }];
  });
  const seenIds = new Set<string>();
  for (const option of options) {
    if (seenIds.has(option.id)) return [];
    seenIds.add(option.id);
  }
  return options;
}
