import { Link, useLocation } from 'react-router-dom'
import { ChevronRight, Home } from 'lucide-react'
import { cn } from '@/lib/utils'

const SEGMENT_LABELS: Record<string, string> = {
  stock: 'Stock',
  consumos: 'Consumos',
  recepciones: 'Recepciones',
  conteo: 'Conteo',
  movimientos: 'Movimientos',
  descartes: 'Descartes',
  'solicitudes-compra': 'Solicitudes',
  'creador-productos': 'Catálogos',
  usuarios: 'Usuarios',
  configuracion: 'Configuración',
  'audit-log': 'Auditoría',
  setup: 'Setup',
  nueva: 'Nueva recepción',
}

// Segmentos que indican detalle (UUIDs, REC-XXXXXX, etc.)
function esSegmentoDetalle(seg: string): boolean {
  return (
    /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(seg) ||   // UUID
    /^[A-Z]+-\d+$/.test(seg)                       // REC-000001, etc.
  )
}

function labelSegmento(seg: string, parent: string): string {
  if (esSegmentoDetalle(seg)) {
    // Mostrar el número de documento si tiene formato legible
    if (/^[A-Z]+-\d+$/.test(seg)) return seg
    // Para UUIDs usar "Detalle"
    const parentLabel = SEGMENT_LABELS[parent]
    return parentLabel ? `Detalle de ${parentLabel.toLowerCase().replace(/s$/, '')}` : 'Detalle'
  }
  return SEGMENT_LABELS[seg] ?? seg
}

// Rutas sin breadcrumb (primer nivel o especiales)
const SIN_BREADCRUMB = new Set(['', '/', '/login'])

export function Breadcrumb() {
  const { pathname } = useLocation()

  const segments = pathname.split('/').filter(Boolean)

  // No mostrar en primer nivel o rutas especiales
  if (segments.length <= 1 || SIN_BREADCRUMB.has(pathname)) return null

  // Construir migas
  const crumbs: { label: string; to: string }[] = [
    { label: 'Inicio', to: '/' },
  ]

  let accum = ''
  segments.forEach((seg, idx) => {
    accum += `/${seg}`
    const label = idx === 0
      ? (SEGMENT_LABELS[seg] ?? seg)
      : labelSegmento(seg, segments[idx - 1])
    crumbs.push({ label, to: accum })
  })

  return (
    <nav className="flex items-center gap-1 px-6 py-2 text-[11px] text-base-content/50 border-b border-base-200/60 bg-base-100/60 backdrop-blur-sm">
      {crumbs.map((crumb, idx) => {
        const isLast = idx === crumbs.length - 1
        return (
          <div key={crumb.to} className="flex items-center gap-1">
            {idx === 0 && <Home className="h-3 w-3 shrink-0" />}
            {isLast ? (
              <span className="font-semibold text-base-content/80 truncate max-w-[200px]">
                {crumb.label}
              </span>
            ) : (
              <Link
                to={crumb.to}
                className={cn(
                  "hover:text-base-content transition-colors truncate max-w-[150px]",
                  idx === 0 && "ml-0.5"
                )}
              >
                {crumb.label}
              </Link>
            )}
            {!isLast && <ChevronRight className="h-3 w-3 shrink-0 opacity-40" />}
          </div>
        )
      })}
    </nav>
  )
}
