import { cn } from '@/lib/utils'

interface Column<T> {
  key: string
  header: string
  className?: string
  render?: (item: T) => React.ReactNode
}

interface DataTableProps<T> {
  columns: Column<T>[]
  data: T[]
  onRowClick?: (item: T) => void
  selectedId?: number | null
  keyField?: string
  emptyMessage?: string
  className?: string
}

export function DataTable<T extends Record<string, unknown>>({
  columns,
  data,
  onRowClick,
  selectedId,
  keyField = 'id',
  emptyMessage = 'No hay datos',
  className,
}: DataTableProps<T>) {
  return (
    <div className={cn('overflow-x-auto rounded-xl border border-base-200 bg-base-100', className)}>
      <table className="table table-sm">
        <thead>
          <tr className="border-base-200">
            {columns.map((col) => (
              <th key={col.key} className={cn('text-[11px] font-semibold uppercase tracking-wider opacity-40 bg-base-100', col.className)}>
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="text-center py-16">
                <p className="text-sm opacity-40">{emptyMessage}</p>
              </td>
            </tr>
          ) : (
            data.map((item) => (
              <tr
                key={item[keyField] as string | number}
                onClick={() => onRowClick?.(item)}
                className={cn(
                  'table-row-interactive border-base-200/60',
                  onRowClick && 'cursor-pointer',
                  selectedId !== undefined &&
                    item[keyField] === selectedId &&
                    'bg-primary/5 !border-l-2 !border-l-primary'
                )}
              >
                {columns.map((col) => (
                  <td key={col.key} className={cn('py-3', col.className)}>
                    {col.render
                      ? col.render(item)
                      : (item[col.key] as React.ReactNode)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
