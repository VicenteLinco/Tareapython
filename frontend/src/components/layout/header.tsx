import { LogOut, Search } from 'lucide-react'
import { useAuthStore } from '@/hooks/use-auth-store'
import { useNavigate } from 'react-router-dom'
import { clearDeviceMode } from '@/lib/device-mode'

interface HeaderProps {
  onOpenSearch?: () => void
}

export function Header({ onOpenSearch }: HeaderProps) {
  const { usuario, logout } = useAuthStore()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    clearDeviceMode()
    navigate('/login')
  }

  return (
    <header className="glass-header sticky top-0 z-20 flex h-[60px] items-center justify-between border-b border-base-200 bg-base-100/80 px-6">
      <div className="flex items-center gap-3">
        {onOpenSearch && (
          <button
            onClick={onOpenSearch}
            className="hidden md:flex items-center gap-2 h-8 px-3 rounded-xl border border-base-300 bg-base-200/50 text-xs text-base-content/40 hover:text-base-content hover:border-base-400 transition-all"
          >
            <Search className="h-3.5 w-3.5" />
            <span>Buscar…</span>
            <div className="flex items-center gap-0.5 ml-1">
              <kbd className="kbd kbd-sm text-[9px]">Ctrl</kbd>
              <kbd className="kbd kbd-sm text-[9px]">K</kbd>
            </div>
          </button>
        )}
      </div>

      <div className="flex items-center gap-2">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-bold">
            {usuario?.nombre?.charAt(0)?.toUpperCase() ?? 'U'}
          </div>
          <div className="hidden sm:flex flex-col">
            <span className="text-xs font-semibold leading-tight">{usuario?.nombre}</span>
            <span className="text-[10px] opacity-40 capitalize leading-tight">{usuario?.rol}</span>
          </div>
        </div>
        <div className="tooltip tooltip-bottom" data-tip="Cerrar sesión">
          <button onClick={handleLogout} className="btn btn-ghost btn-xs btn-square opacity-40 hover:opacity-100">
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </header>
  )
}
