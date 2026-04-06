import { useEffect } from 'react'
import { Outlet, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { Sidebar } from './sidebar'
import { Header } from './header'
import { useAuthStore } from '@/hooks/use-auth-store'
import { getDeviceMode } from '@/lib/device-mode'
import { useInactivityTimeout } from '@/hooks/use-inactivity-timeout'
import { InactivityWarningDialog } from '@/components/auth/InactivityWarningDialog'

export function AppLayout() {
  const accessToken = useAuthStore((s) => s.accessToken)
  const navigate = useNavigate()
  const location = useLocation()
  const { dialogOpen, secondsLeft, onContinue } = useInactivityTimeout()

  useEffect(() => {
    if (!accessToken) return  // Not authenticated — let Navigate below handle it
    const mode = getDeviceMode()
    if (mode === 'kiosk' && !location.pathname.startsWith('/kiosk')) {
      navigate('/kiosk', { replace: true })
    } else if (mode === 'qr' && !location.pathname.startsWith('/qr')) {
      navigate('/qr', { replace: true })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (!accessToken) {
    return <Navigate to="/login" replace />
  }

  return (
    <div className="min-h-screen bg-base-200/50">
      <Sidebar />
      <div className="pl-[60px] transition-all duration-300">
        <Header />
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
