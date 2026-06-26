import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface Column<T> {
  key: string;
  header: string;
  className?: string;
  render?: (item: T) => ReactNode;
  filter?: ReactNode;
  width?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  onRowClick?: (item: T) => void;
  selectedId?: number | null | string;
  keyField?: string;
  emptyMessage?: ReactNode;
  className?: string;
}

function getCellValue<T>(item: T, key: string): unknown {
  return (item as Record<string, unknown>)[key];
}

export function DataTable<T>({
  columns,
  data,
  onRowClick,
  selectedId,
  keyField = "id",
  emptyMessage = "No hay datos",
  className,
}: DataTableProps<T>) {
  const hasFilters = columns.some((c) => c.filter);

  return (
    <div
      className={cn(
        "overflow-x-auto w-full rounded-xl border border-base-200 bg-base-100",
        className,
      )}
    >
      <table className="table table-sm w-full border-separate border-spacing-0">
        <thead>
          <tr className="bg-base-200/50">
            {columns.map((col) => (
              <th
                key={col.key}
                className={cn(
                  "text-[11px] font-bold uppercase tracking-wider py-3 border-b border-base-200",
                  col.className,
                )}
                style={{ width: col.width, minWidth: col.width }}
              >
                {col.header}
              </th>
            ))}
          </tr>
          {hasFilters && (
            <tr className="bg-base-100">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={cn(
                    "py-2 px-2 border-b border-base-200",
                    col.className,
                  )}
                >
                  {col.filter ?? null}
                </th>
              ))}
            </tr>
          )}
        </thead>
        <tbody className="divide-y divide-base-200">
          {data.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="text-center py-12 opacity-40 italic text-sm"
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            data.map((item) => (
              <tr
                key={String(getCellValue(item, keyField))}
                onClick={() => onRowClick?.(item)}
                className={cn(
                  "hover:bg-base-200/40 transition-colors",
                  onRowClick && "cursor-pointer",
                  selectedId !== undefined &&
                    String(getCellValue(item, keyField)) ===
                      String(selectedId) &&
                    "bg-primary/5 !border-l-4 !border-l-primary",
                )}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={cn(
                      "py-3 align-middle whitespace-nowrap overflow-hidden text-ellipsis",
                      col.className,
                    )}
                    style={{ maxWidth: col.width }}
                  >
                    {col.render
                      ? col.render(item)
                      : (() => {
                          const val = String(getCellValue(item, col.key) ?? "");
                          if (
                            val.startsWith("data:image") ||
                            val.length > 500
                          ) {
                            return (
                              <span className="text-[10px] opacity-20 italic">
                                Dato largo / Imagen
                              </span>
                            );
                          }
                          return (
                            <span className="truncate block" title={val}>
                              {val}
                            </span>
                          );
                        })()}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
