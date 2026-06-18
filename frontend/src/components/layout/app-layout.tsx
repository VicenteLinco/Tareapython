import { useState, useEffect } from 'react'
import { Outlet, Navigate } from 'react-router-dom'
import { Menu } from 'lucide-react'
import { Sidebar } from './sidebar'
import { Header } from './header'
import { Breadcrumb } from './breadcrumb'
import { useAuthStore } from '@/hooks/use-auth-store'
import { useInactivityTimeout } from '@/hooks/use-inactivity-timeout'
import { InactivityWarningDialog } from '@/components/auth/InactivityWarningDialog'
import { GlobalSearch } from '@/components/ui/global-search'
import { cn } from '@/lib/utils'

export function AppLayout() {
  const accessToken = useAuthStore((s) => s.accessToken)
  const { dialogOpen, secondsLeft, onContinue } = useInactivityTimeout()
  const [searchOpen, setSearchOpen] = useState(false)
  const [sidebarExpanded, setSidebarExpanded] = useState(false)
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        setSearchOpen(prev => !prev)
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [])

  if (!accessToken) {
    return <Navigate to="/login" replace />
  }

  return (
    <div className="min-h-screen bg-base-200/50">
      <Sidebar
        expanded={sidebarExpanded}
        onExpandedChange={setSidebarExpanded}
        mobileOpen={mobileSidebarOpen}
        onMobileClose={() => setMobileSidebarOpen(false)}
      />
      <div className={cn(
        'transition-all duration-300 overflow-x-hidden w-full',
        sidebarExpanded ? 'md:pl-56' : 'md:pl-[60px]',
      )}>
        {/* Hamburger — solo visible en móvil */}
        <div className="md:hidden fixed top-[14px] left-3 z-30">
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setMobileSidebarOpen(true)}
            aria-label="Abrir menú"
            aria-expanded={mobileSidebarOpen}
          >
            <Menu className="w-5 h-5" />
          </button>
        </div>
        <Header onOpenSearch={() => setSearchOpen(true)} />
        <Breadcrumb />
        <main className="w-full mx-auto max-w-6xl px-4 sm:px-6 py-4 sm:py-6">
          <Outlet />
        </main>
      </div>
      <InactivityWarningDialog
        open={dialogOpen}
        secondsLeft={secondsLeft}
        onContinue={onContinue}
      />
      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  )
}
