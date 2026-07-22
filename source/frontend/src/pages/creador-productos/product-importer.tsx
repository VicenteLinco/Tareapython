import { useMemo, useState } from "react";
import type {
  ProductImportMapperConfig,
  ProductSchema,
} from "@/types";

interface ProductImporterProps {
  schema: ProductSchema;
  sourceHeaders: string[];
  onConfigChange: (config: ProductImportMapperConfig) => void;
}

export function validateProductMapping(
  schema: ProductSchema,
  mapping: Record<string, string>,
): Pick<ProductImportMapperConfig, "valid" | "errors"> {
  const errors: string[] = [];
  const mappedHeaders = Object.values(mapping).filter(Boolean);
  const duplicateHeaders = mappedHeaders.filter(
    (header, index) => mappedHeaders.indexOf(header) !== index,
  );

  for (const header of [...new Set(duplicateHeaders)]) {
    errors.push(`La columna "${header}" está mapeada más de una vez.`);
  }

  for (const field of schema.fields) {
    if (field.import_supported && field.domain_required && !mapping[field.key]) {
      errors.push(`El campo obligatorio "${field.label}" no tiene una columna mapeada.`);
    }
  }

  return { valid: errors.length === 0, errors };
}

export function ProductImporter({
  schema,
  sourceHeaders,
  onConfigChange,
}: ProductImporterProps) {
  const importableFields = useMemo(
    () =>
      schema.fields
        .filter((field) => field.import_supported)
        .sort((left, right) => left.order - right.order),
    [schema],
  );
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [requiredFields, setRequiredFields] = useState<string[]>(() =>
    importableFields
      .filter((field) => field.domain_required)
      .map((field) => field.key),
  );

  const publish = (
    nextMapping: Record<string, string>,
    nextRequiredFields: string[],
  ) => {
    onConfigChange({
      mapping: nextMapping,
      required_fields: nextRequiredFields,
      ...validateProductMapping(schema, nextMapping),
    });
  };

  const changeMapping = (fieldKey: string, sourceHeader: string) => {
    const nextMapping = { ...mapping };
    if (sourceHeader) {
      nextMapping[fieldKey] = sourceHeader;
    } else {
      delete nextMapping[fieldKey];
    }

    const field = importableFields.find((candidate) => candidate.key === fieldKey);
    let nextRequiredFields = requiredFields;
    if (!sourceHeader && field && !field.domain_required) {
      nextRequiredFields = requiredFields.filter((key) => key !== fieldKey);
      setRequiredFields(nextRequiredFields);
    }

    setMapping(nextMapping);
    publish(nextMapping, nextRequiredFields);
  };

  const toggleRequired = (fieldKey: string, checked: boolean) => {
    const nextRequiredFields = checked
      ? [...new Set([...requiredFields, fieldKey])]
      : requiredFields.filter((key) => key !== fieldKey);
    setRequiredFields(nextRequiredFields);
    publish(mapping, nextRequiredFields);
  };

  return (
    <div aria-label="Mapeo de columnas de productos" className="space-y-3">
      {importableFields.map((field) => {
        const mapped = Boolean(mapping[field.key]);
        return (
          <div key={field.key} className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
            <span>{field.label}</span>
            <select
              aria-label={`Columna CSV para ${field.label}`}
              value={mapping[field.key] ?? ""}
              onChange={(event) => changeMapping(field.key, event.target.value)}
            >
              <option value="">No importar</option>
              {sourceHeaders.map((header) => (
                <option key={header} value={header}>
                  {header}
                </option>
              ))}
            </select>
            <label>
              <input
                type="checkbox"
                aria-label={`${field.label} obligatorio para esta importación`}
                checked={field.domain_required || requiredFields.includes(field.key)}
                disabled={field.domain_required || !mapped}
                onChange={(event) =>
                  toggleRequired(field.key, event.target.checked)
                }
              />
              Obligatorio
            </label>
          </div>
        );
      })}
    </div>
  );
}
