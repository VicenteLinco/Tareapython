import { Outlet, Navigate } from 'react-router-dom'
import { Sidebar } from './sidebar'
import { Header } from './header'
import { useAuthStore } from '@/hooks/use-auth-store'

export function AppLayout() {
  const accessToken = useAuthStore((s) => s.accessToken)

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
    </div>
  )
}
