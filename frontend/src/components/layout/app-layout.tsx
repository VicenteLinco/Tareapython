import { useState, useEffect } from 'react'
import { Outlet, Navigate } from 'react-router-dom'
import { Sidebar } from './sidebar'
import { Header } from './header'
import { Breadcrumb } from './breadcrumb'
import { useAuthStore } from '@/hooks/use-auth-store'
import { useInactivityTimeout } from '@/hooks/use-inactivity-timeout'
import { InactivityWarningDialog } from '@/components/auth/InactivityWarningDialog'
import { GlobalSearch } from '@/components/ui/global-search'
import { PageWidthProvider, usePageWidth } from './page-width'
import { cn } from '@/lib/utils'

function MainContent() {
  const { fullWidth } = usePageWidth()
  return (
    <main
      className={cn(
        'w-full mx-auto px-4 sm:px-6 py-4 sm:py-6',
        fullWidth ? 'max-w-none' : 'max-w-[1536px]',
      )}
    >
      <Outlet />
    </main>
  )
}

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
    <PageWidthProvider>
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
        <Header
          onOpenSearch={() => setSearchOpen(true)}
          onMenuClick={() => setMobileSidebarOpen(true)}
        />
        <Breadcrumb />
        <MainContent />
      </div>
      <InactivityWarningDialog
        open={dialogOpen}
        secondsLeft={secondsLeft}
        onContinue={onContinue}
      />
      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
    </PageWidthProvider>
  )
}
