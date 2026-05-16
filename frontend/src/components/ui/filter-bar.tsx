import { useState } from 'react'
import { ChevronDown, ChevronUp, SlidersHorizontal, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

export interface QuickChip {
  label: string
  value: string
  active: boolean
  onClick: () => void
  variant?: 'default' | 'destructive' | 'warning' | 'success'
}

interface FilterBarProps {
  search?: React.ReactNode
  primaryFilter?: React.ReactNode
  secondaryFilters?: React.ReactNode
  activeSecondaryCount?: number
  chips?: QuickChip[]
  actions?: React.ReactNode
  defaultExpanded?: boolean
  className?: string
}

export function FilterBar({
  search,
  primaryFilter,
  secondaryFilters,
  activeSecondaryCount = 0,
  chips,
  actions,
  defaultExpanded = false,
  className,
}: FilterBarProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center gap-2 flex-wrap">
        {search && <div className="flex-1 min-w-[200px]">{search}</div>}
        {primaryFilter && <div className="w-auto">{primaryFilter}</div>}
        {secondaryFilters && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setExpanded(v => !v)}
            className="gap-1.5 shrink-0"
          >
            <SlidersHorizontal className="h-4 w-4" />
            Filtros
            {activeSecondaryCount > 0 && (
              <Badge variant="secondary" className="h-4 px-1 text-[10px] font-semibold">
                {activeSecondaryCount}
              </Badge>
            )}
            {expanded ? (
              <ChevronUp className="h-3 w-3" />
            ) : (
              <ChevronDown className="h-3 w-3" />
            )}
          </Button>
        )}
        {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
      </div>

      {secondaryFilters && expanded && (
        <div className="rounded-lg border bg-muted/30 p-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {secondaryFilters}
          </div>
          {activeSecondaryCount > 0 && (
            <div className="mt-3 flex justify-end">
              <Button
                variant="ghost"
                size="sm"
                className="gap-1 text-muted-foreground hover:text-foreground"
                onClick={() => setExpanded(false)}
              >
                <X className="h-3 w-3" />
                Cerrar
              </Button>
            </div>
          )}
        </div>
      )}

      {chips && chips.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {chips.map(chip => (
            <button
              key={chip.value}
              onClick={chip.onClick}
              className={cn(
                'inline-flex items-center rounded-full px-3 py-0.5 text-xs font-medium transition-colors border',
                chip.active
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background text-muted-foreground border-border hover:bg-muted'
              )}
            >
              {chip.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
