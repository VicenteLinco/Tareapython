import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";

interface PaginationProps {
  page: number;
  totalPages: number;
  total: number;
  perPage: number;
  onPageChange: (page: number) => void;
  onPerPageChange: (perPage: number) => void;
}

export function Pagination({
  page,
  totalPages,
  total,
  perPage,
  onPageChange,
  onPerPageChange,
}: PaginationProps) {
  if (totalPages <= 1 && total <= perPage) return null;

  const start = (page - 1) * perPage + 1;
  const end = Math.min(page * perPage, total);

  // Generate page numbers to display
  const getPageNumbers = () => {
    const pages = [];
    const maxVisible = 5;

    if (totalPages <= maxVisible) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
      return pages;
    }

    pages.push(1);
    
    let startPage = Math.max(2, page - 1);
    let endPage = Math.min(totalPages - 1, page + 1);

    if (page <= 2) {
      endPage = 4;
    } else if (page >= totalPages - 1) {
      startPage = totalPages - 3;
    }

    if (startPage > 2) {
      pages.push("...");
    }

    for (let i = startPage; i <= endPage; i++) {
      pages.push(i);
    }

    if (endPage < totalPages - 1) {
      pages.push("...");
    }

    pages.push(totalPages);
    return pages;
  };

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4">
      <div className="flex items-center gap-4 text-xs opacity-60 font-medium">
        <span>
          Mostrando {start}-{end} de {total} resultados
        </span>
        <select
          className="select select-sm select-bordered h-8 min-h-8 text-xs font-medium"
          value={perPage}
          onChange={(e) => onPerPageChange(Number(e.target.value))}
        >
          <option value={20}>20 / pág</option>
          <option value={50}>50 / pág</option>
          <option value={100}>100 / pág</option>
        </select>
      </div>

      <div className="join">
        <button
          className="join-item btn btn-sm btn-ghost px-2"
          onClick={() => onPageChange(1)}
          disabled={page <= 1}
          aria-label="Primera página"
        >
          <ChevronsLeft className="h-4 w-4" />
        </button>
        <button
          className="join-item btn btn-sm btn-ghost px-2"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          aria-label="Página anterior"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>

        {getPageNumbers().map((p, i) => (
          <button
            key={i}
            className={`join-item btn btn-sm font-mono px-3 ${
              p === page ? "btn-active pointer-events-none" : "btn-ghost"
            } ${p === "..." ? "pointer-events-none" : ""}`}
            onClick={() => typeof p === "number" && onPageChange(p)}
            disabled={p === "..."}
          >
            {p}
          </button>
        ))}

        <button
          className="join-item btn btn-sm btn-ghost px-2"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          aria-label="Página siguiente"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <button
          className="join-item btn btn-sm btn-ghost px-2"
          onClick={() => onPageChange(totalPages)}
          disabled={page >= totalPages}
          aria-label="Última página"
        >
          <ChevronsRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
