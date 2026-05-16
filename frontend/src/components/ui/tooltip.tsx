import * as React from 'react'
import { cn } from '@/lib/utils'

interface TooltipProviderProps {
  delayDuration?: number
  children: React.ReactNode
}

interface TooltipContextValue {
  delayDuration: number
}

const TooltipContext = React.createContext<TooltipContextValue>({ delayDuration: 700 })

export function TooltipProvider({ delayDuration = 700, children }: TooltipProviderProps) {
  return (
    <TooltipContext.Provider value={{ delayDuration }}>
      {children}
    </TooltipContext.Provider>
  )
}

interface TooltipProps {
  open?: boolean
  children: React.ReactNode
}

interface TooltipInternalContextValue {
  open?: boolean
  show: boolean
  setShow: (v: boolean) => void
  delayDuration: number
}

const TooltipInternalContext = React.createContext<TooltipInternalContextValue>({
  open: undefined,
  show: false,
  setShow: () => {},
  delayDuration: 700,
})

export function Tooltip({ open, children }: TooltipProps) {
  const { delayDuration } = React.useContext(TooltipContext)
  const [show, setShow] = React.useState(false)

  return (
    <TooltipInternalContext.Provider value={{ open, show, setShow, delayDuration }}>
      <span style={{ display: 'contents' }}>{children}</span>
    </TooltipInternalContext.Provider>
  )
}

interface TooltipTriggerProps {
  asChild?: boolean
  children: React.ReactNode
}

export function TooltipTrigger({ asChild, children }: TooltipTriggerProps) {
  const { open, setShow, delayDuration } = React.useContext(TooltipInternalContext)
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleMouseEnter = () => {
    if (open === false) return
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setShow(true), delayDuration)
  }

  const handleMouseLeave = () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setShow(false)
  }

  React.useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [])

  if (asChild && React.isValidElement(children)) {
    return React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
      onMouseEnter: handleMouseEnter,
      onMouseLeave: handleMouseLeave,
    })
  }

  return (
    <span onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
      {children}
    </span>
  )
}

interface TooltipContentProps {
  side?: 'top' | 'right' | 'bottom' | 'left'
  className?: string
  children: React.ReactNode
}

export function TooltipContent({ side = 'top', className, children }: TooltipContentProps) {
  const { open, show } = React.useContext(TooltipInternalContext)

  // open===false → always hidden; open===undefined → controlled by hover (show)
  const visible = open === false ? false : (open === true ? true : show)

  if (!visible) return null

  const sideClasses: Record<string, string> = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-1.5',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-1.5',
    left: 'right-full top-1/2 -translate-y-1/2 mr-1.5',
    right: 'left-full top-1/2 -translate-y-1/2 ml-1.5',
  }

  return (
    <span
      role="tooltip"
      className={cn(
        'pointer-events-none absolute z-50 whitespace-nowrap rounded-md bg-base-content px-2.5 py-1 text-xs text-base-100 shadow-md',
        sideClasses[side],
        className
      )}
    >
      {children}
    </span>
  )
}
