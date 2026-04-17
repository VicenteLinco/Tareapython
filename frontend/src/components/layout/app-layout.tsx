import { Outlet, Navigate } from 'react-router-dom'
import { Sidebar } from './sidebar'
import { Header } from './header'
import { Breadcrumb } from './breadcrumb'
import { useAuthStore } from '@/hooks/use-auth-store'
import { useInactivityTimeout } from '@/hooks/use-inactivity-timeout'
import { InactivityWarningDialog } from '@/components/auth/InactivityWarningDialog'

export function AppLayout() {
  const accessToken = useAuthStore((s) => s.accessToken)
  const { dialogOpen, secondsLeft, onContinue } = useInactivityTimeout()

  if (!accessToken) {
    return <Navigate to="/login" replace />
  }

  return (
    <div className="min-h-screen bg-base-200/50">
      <Sidebar />
      <div className="pl-[60px] transition-all duration-300">
        <Header />
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
    </div>
  )
}
