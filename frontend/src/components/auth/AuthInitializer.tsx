// frontend/src/components/auth/AuthInitializer.tsx
import { useEffect, useState } from 'react'
import axios from 'axios'
import { FlaskConical } from 'lucide-react'
import { useAuthStore } from '@/hooks/use-auth-store'

interface Props {
  children: React.ReactNode
}

export function AuthInitializer({ children }: Props) {
  const [ready, setReady] = useState(false)
  const { refreshToken, setTokens, logout } = useAuthStore()

  useEffect(() => {
    if (!refreshToken) {
      setReady(true)
      return
    }

    axios
      .post('/api/v1/auth/refresh', { refresh_token: refreshToken })
      .then((res) => {
        const { access_token, refresh_token } = res.data
        setTokens(access_token, refresh_token)
      })
      .catch(() => {
        logout()
      })
      .finally(() => {
        setReady(true)
      })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'lab-auth-v3') {
        if (!e.newValue) {
          logout()
          window.location.href = '/login'
        } else {
          try {
            const parsed = JSON.parse(e.newValue)
            if (!parsed.state || !parsed.state.refreshToken) {
              logout()
              window.location.href = '/login'
            }
          } catch (err) {
            console.error('Error parsing synced auth store:', err)
          }
        }
      }
    }

    window.addEventListener('storage', handleStorageChange)
    return () => window.removeEventListener('storage', handleStorageChange)
  }, [logout])

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-base-200/50">
        <div className="flex flex-col items-center gap-4 text-base-content/40">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
            <FlaskConical className="h-7 w-7 text-primary" />
          </div>
          <span className="loading loading-spinner loading-md" />
        </div>
      </div>
    )
  }

  return <>{children}</>
}
