import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard,
  Package,
  ClipboardList,
  ArrowDownToLine,
  Trash2,
  History,
  Settings,
  SlidersHorizontal,
  Users,
  FileText,
  Rocket,
  ChevronLeft,
  ChevronRight,
  FlaskConical,
  Sun,
  Moon,
  ClipboardCheck,
} from 'lucide-react'
import { useAuthStore } from '@/hooks/use-auth-store'

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/stock', icon: Package, label: 'Inventario' },
  { to: '/consumos', icon: ClipboardList, label: 'Consumos' },
  { to: '/recepciones', icon: ArrowDownToLine, label: 'Recepciones' },
  { to: '/conteo', icon: ClipboardCheck, label: 'Conteo' },
  { to: '/descartes', icon: Trash2, label: 'Descartes' },
  { to: '/movimientos', icon: History, label: 'Movimientos' },
]

const adminItems = [
  { to: '/catalogos', icon: Settings, label: 'Creador de Productos' },
  { to: '/configuracion', icon: SlidersHorizontal, label: 'Configuración' },
  { to: '/usuarios', icon: Users, label: 'Usuarios' },
  { to: '/audit-log', icon: FileText, label: 'Audit Log' },
  { to: '/setup', icon: Rocket, label: 'Setup' },
]

export function Sidebar() {
  const [expanded, setExpanded] = useState(false)
  const [isDark, setIsDark] = useState(
    document.documentElement.getAttribute('data-theme') === 'dark'
  )
  const usuario = useAuthStore((s) => s.usuario)
  const isAdmin = usuario?.rol === 'admin'

  const toggleTheme = () => {
    const next = isDark ? 'emerald' : 'dark'
    document.documentElement.setAttribute('data-theme', next)
    localStorage.setItem('lab-theme', next)
    setIsDark(!isDark)
  }

  return (
    <aside
      className={cn(
        'fixed left-0 top-0 z-40 flex h-screen flex-col border-r border-base-200 bg-base-100 transition-all duration-300 ease-out',
        expanded ? 'w-56' : 'w-[60px]'
      )}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
    >
      {/* Logo */}
      <div className="flex h-[60px] items-center gap-2.5 px-4 border-b border-base-200">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary">
          <FlaskConical className="h-4.5 w-4.5 text-primary-content" />
        </div>
        <span
          className={cn(
            'font-semibold text-sm tracking-tight whitespace-nowrap transition-all duration-300',
            expanded ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-2 w-0 overflow-hidden'
          )}
        >
          Lab Inventario
        </span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-2 px-2">
        <div className="space-y-0.5">
          {navItems.map((item) => (
            <SidebarLink key={item.to} {...item} expanded={expanded} />
          ))}
        </div>

        {isAdmin && (
          <>
            <div className="my-3 mx-2 h-px bg-base-200" />
            <p className={cn(
              'px-3 mb-1 text-[10px] font-semibold uppercase tracking-widest opacity-40 transition-all duration-300',
              expanded ? 'opacity-40' : 'opacity-0'
            )}>
              Admin
            </p>
            <div className="space-y-0.5">
              {adminItems.map((item) => (
                <SidebarLink key={item.to} {...item} expanded={expanded} />
              ))}
            </div>
          </>
        )}
      </nav>

      {/* Bottom actions */}
      <div className="border-t border-base-200 p-2 space-y-0.5">
        <button
          onClick={toggleTheme}
          className="flex h-9 w-full items-center gap-2.5 rounded-lg px-3 text-sm opacity-50 hover:opacity-100 hover:bg-base-200 transition-all cursor-pointer"
        >
          {isDark ? <Sun className="h-[18px] w-[18px] shrink-0" /> : <Moon className="h-[18px] w-[18px] shrink-0" />}
          <span className={cn(
            'whitespace-nowrap transition-all duration-300',
            expanded ? 'opacity-100' : 'opacity-0 w-0 overflow-hidden'
          )}>
            {isDark ? 'Modo claro' : 'Modo oscuro'}
          </span>
        </button>
        <button
          onClick={() => setExpanded((e) => !e)}
          className="flex h-9 w-full items-center justify-center rounded-lg opacity-30 hover:opacity-70 hover:bg-base-200 transition-all cursor-pointer"
        >
          {expanded ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
      </div>
    </aside>
  )
}

function SidebarLink({
  to,
  icon: Icon,
  label,
  expanded,
}: {
  to: string
  icon: React.ComponentType<{ className?: string }>
  label: string
  expanded: boolean
}) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-2.5 rounded-lg px-3 h-9 text-[13px] font-medium transition-all duration-150',
          isActive
            ? 'bg-primary text-primary-content sidebar-link-active'
            : 'opacity-60 hover:opacity-100 hover:bg-base-200'
        )
      }
    >
      <Icon className="h-[18px] w-[18px] shrink-0" />
      <span
        className={cn(
          'whitespace-nowrap transition-all duration-300',
          expanded ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-2 w-0 overflow-hidden'
        )}
      >
        {label}
      </span>
    </NavLink>
  )
}
