import { useState, useEffect } from 'react'
import { Outlet, Navigate } from 'react-router-dom'
import { Sidebar } from './sidebar'
import { Header } from './header'
import { Breadcrumb } from './breadcrumb'
import { useAuthStore } from '@/hooks/use-auth-store'
import { useInactivityTimeout } from '@/hooks/use-inactivity-timeout'
import { InactivityWarningDialog } from '@/components/auth/InactivityWarningDialog'
import { GlobalSearch } from '@/components/ui/global-search'

export function AppLayout() {
  const accessToken = useAuthStore((s) => s.accessToken)
  const { dialogOpen, secondsLeft, onContinue } = useInactivityTimeout()
  const [searchOpen, setSearchOpen] = useState(false)
  const [sidebarExpanded, setSidebarExpanded] = useState(false)

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
      <Sidebar expanded={sidebarExpanded} onExpandedChange={setSidebarExpanded} />
      <div className={sidebarExpanded ? 'pl-56 transition-all duration-300' : 'pl-[60px] transition-all duration-300'}>
        <Header onOpenSearch={() => setSearchOpen(true)} />
        <Breadcrumb />
        <main className="mx-auto max-w-6xl px-6 py-6">
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
