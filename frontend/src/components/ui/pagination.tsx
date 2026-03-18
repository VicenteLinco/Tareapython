import { ChevronLeft, ChevronRight } from 'lucide-react'

interface PaginationProps {
  page: number
  totalPages: number
  onPageChange: (page: number) => void
}

export function Pagination({ page, totalPages, onPageChange }: PaginationProps) {
  if (totalPages <= 1) return null

  return (
    <div className="flex items-center justify-between pt-2">
      <span className="text-xs opacity-40 font-medium">
        Página {page} de {totalPages}
      </span>
      <div className="join">
        <button
          className="join-item btn btn-sm btn-ghost"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button className="join-item btn btn-sm btn-ghost font-mono">
          {page}
        </button>
        <button
          className="join-item btn btn-sm btn-ghost"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
