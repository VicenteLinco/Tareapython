# Auth Session Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar silent refresh al abrir el browser + inactivity timeout de 90 minutos con aviso previo, sin interrumpir la sesión del usuario en uso normal.

**Architecture:** Un componente `AuthInitializer` resuelve el estado de auth antes de renderizar cualquier ruta (silent refresh si hay refreshToken). Un hook `useInactivityTimeout` montado en `AppLayout` detecta inactividad y lanza un dialog de aviso, cerrando la sesión si no hay respuesta.

**Tech Stack:** React 19, TypeScript, Zustand, Axios, DaisyUI modal, Lucide icons, sonner toast, react-router-dom

---

## File Map

| Acción | Archivo | Responsabilidad |
|--------|---------|-----------------|
| Crear | `frontend/src/lib/auth-config.ts` | Constantes de tiempo (timeout, warning offset) |
| Crear | `frontend/src/components/auth/AuthInitializer.tsx` | Silent refresh al montar, spinner mientras resuelve |
| Crear | `frontend/src/components/auth/InactivityWarningDialog.tsx` | Dialog de cuenta regresiva, no cierra con click afuera |
| Crear | `frontend/src/hooks/use-inactivity-timeout.ts` | Event listeners, timers, visibility API, logout |
| Modificar | `frontend/src/App.tsx` | Envolver con `<AuthInitializer>` |
| Modificar | `frontend/src/components/layout/app-layout.tsx` | Llamar `useInactivityTimeout()` |
| Ya modificado | `frontend/src/hooks/use-auth-store.ts` | `partialize` excluye `accessToken` — no tocar |

---

## Task 1: Constantes de configuración

**Files:**
- Create: `frontend/src/lib/auth-config.ts`

- [ ] **Step 1: Crear el archivo de constantes**

```ts
// frontend/src/lib/auth-config.ts
export const INACTIVITY_TIMEOUT_MS = 90 * 60 * 1000   // 90 minutos
export const INACTIVITY_WARNING_MS = 88 * 60 * 1000   // aviso a los 88 min (2 min antes)
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/lib/auth-config.ts
git commit -m "feat(auth): add inactivity timeout constants"
```

---

## Task 2: AuthInitializer — silent refresh al abrir

**Files:**
- Create: `frontend/src/components/auth/AuthInitializer.tsx`
- Modify: `frontend/src/App.tsx`

**Contexto importante:** Usar `axios` directamente (no `api` de `lib/api.ts`) para evitar que el interceptor de 401 entre en un loop de refresh recursivo. El interceptor ya hace `axios.post('/api/v1/auth/refresh', ...)` por la misma razón.

- [ ] **Step 1: Crear `AuthInitializer.tsx`**

```tsx
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
```

- [ ] **Step 2: Modificar `App.tsx` para envolver con `AuthInitializer`**

En `frontend/src/App.tsx`, agregar el import y envolver el contenido del return:

```tsx
// Agregar al bloque de imports existente:
import { AuthInitializer } from '@/components/auth/AuthInitializer'

// Cambiar el return de App():
return (
  <ErrorBoundary>
    <AuthInitializer>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <Routes>
            {/* ... rutas sin cambios ... */}
          </Routes>
        </BrowserRouter>
        <Toaster position="top-right" richColors />
      </QueryClientProvider>
    </AuthInitializer>
  </ErrorBoundary>
)
```

El archivo completo queda así:

```tsx
// frontend/src/App.tsx
import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { AppLayout } from '@/components/layout/app-layout'
import { ErrorBoundary } from '@/components/ui/error-boundary'
import { AuthInitializer } from '@/components/auth/AuthInitializer'
import LoginPage from '@/pages/login'
import DashboardPage from '@/pages/dashboard'
import StockPage from '@/pages/stock'
import ConsumosPage from '@/pages/consumos'
import RecepcionesPage from '@/pages/recepciones'
import NuevaRecepcionPage from '@/pages/recepciones/nueva'
import RecepcionDetallePage from '@/pages/recepciones/detalle'
import MovimientosPage from '@/pages/movimientos'
import SolicitudesCompraPage from '@/pages/solicitudes-compra'
import CreadorProductosPage from '@/pages/creador-productos'
import DescartesPage from '@/pages/descartes'
import ConfiguracionPage from '@/pages/configuracion'
import SetupPage from '@/pages/setup'
import UsuariosPage from '@/pages/usuarios'
import ConteoPage from '@/pages/conteo/index'
import ConteoDetallePage from '@/pages/conteo/detalle'
import KioskPage from '@/pages/kiosk'
import ModoQrPage from '@/pages/modo-qr'
import AuditLogPage from '@/pages/audit-log'
import ScanPage from './pages/scan/index'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30000,
      retry: 1,
    },
  },
})

export default function App() {
  useEffect(() => {
    const handleWheel = () => {
      if (document.activeElement?.getAttribute('type') === 'number') {
        (document.activeElement as HTMLElement).blur()
      }
    }
    window.addEventListener('wheel', handleWheel, { passive: true })
    return () => window.removeEventListener('wheel', handleWheel)
  }, [])

  return (
    <ErrorBoundary>
      <AuthInitializer>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route element={<AppLayout />}>
                <Route path="/" element={<DashboardPage />} />
                <Route path="/stock" element={<StockPage />} />
                <Route path="/consumos" element={<ConsumosPage />} />
                <Route path="/descartes" element={<DescartesPage />} />
                <Route path="/recepciones" element={<RecepcionesPage />} />
                <Route path="/recepciones/nueva" element={<NuevaRecepcionPage />} />
                <Route path="/recepciones/:id" element={<RecepcionDetallePage />} />
                <Route path="/conteo" element={<ConteoPage />} />
                <Route path="/conteo/:id" element={<ConteoDetallePage />} />
                <Route path="/movimientos" element={<MovimientosPage />} />
                <Route path="/solicitudes-compra" element={<SolicitudesCompraPage />} />
                <Route path="/creador-productos" element={<CreadorProductosPage />} />
                <Route path="/configuracion" element={<ConfiguracionPage />} />
                <Route path="/usuarios" element={<UsuariosPage />} />
                <Route path="/audit-log" element={<AuditLogPage />} />
                <Route path="/setup" element={<SetupPage />} />
              </Route>
              <Route path="/kiosk" element={<KioskPage />} />
              <Route path="/qr" element={<ModoQrPage />} />
              <Route path="/scan/:token" element={<ScanPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
          <Toaster position="top-right" richColors />
        </QueryClientProvider>
      </AuthInitializer>
    </ErrorBoundary>
  )
}
```

- [ ] **Step 3: Verificar manualmente**

  1. Abrir el browser con una sesión activa (tienes `refreshToken` en localStorage)
  2. Refrescar la página — deberías ver el spinner brevemente (~300ms) y luego el dashboard sin pasar por login
  3. Abrir DevTools → Application → Local Storage → borrar `lab-auth-v3`
  4. Refrescar — deberías ir directo a `/login` sin spinner perceptible

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/auth/AuthInitializer.tsx frontend/src/App.tsx
git commit -m "feat(auth): add AuthInitializer for silent refresh on app start"
```

---

## Task 3: InactivityWarningDialog — dialog de cuenta regresiva

**Files:**
- Create: `frontend/src/components/auth/InactivityWarningDialog.tsx`

**Contexto importante:** No usar el componente `Dialog` existente (`components/ui/dialog.tsx`) porque cierra con click afuera (`onClick` en backdrop → `onClose`). Este dialog de seguridad no debe cerrarse con click afuera ni con Escape — solo con el botón "Sí, continuar".

- [ ] **Step 1: Crear `InactivityWarningDialog.tsx`**

```tsx
// frontend/src/components/auth/InactivityWarningDialog.tsx
import { useEffect, useRef } from 'react'
import { Clock } from 'lucide-react'

interface Props {
  open: boolean
  secondsLeft: number
  onContinue: () => void
}

export function InactivityWarningDialog({ open, secondsLeft, onContinue }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  // Bloquear cierre con Escape
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    const handleCancel = (e: Event) => e.preventDefault()
    dialog.addEventListener('cancel', handleCancel)
    return () => dialog.removeEventListener('cancel', handleCancel)
  }, [])

  const minutes = Math.floor(secondsLeft / 60)
  const seconds = secondsLeft % 60
  const countdown = `${minutes}:${String(seconds).padStart(2, '0')}`

  return (
    <dialog ref={dialogRef} className="modal">
      {/* Sin onClick en el backdrop — no cierra con click afuera */}
      <div className="modal-box max-w-sm text-center">
        <div className="flex justify-center mb-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-warning/15">
            <Clock className="h-7 w-7 text-warning" />
          </div>
        </div>
        <h3 className="font-bold text-lg mb-2">¿Sigues ahí?</h3>
        <p className="text-sm text-base-content/60 mb-1">
          Por seguridad, tu sesión se cerrará automáticamente.
        </p>
        <p className="text-3xl font-mono font-bold text-warning my-4">{countdown}</p>
        <button
          className="btn btn-primary w-full"
          onClick={onContinue}
        >
          Sí, continuar
        </button>
      </div>
    </dialog>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/auth/InactivityWarningDialog.tsx
git commit -m "feat(auth): add InactivityWarningDialog with countdown"
```

---

## Task 4: useInactivityTimeout — hook de detección de inactividad

**Files:**
- Create: `frontend/src/hooks/use-inactivity-timeout.ts`

**Contexto:** El hook devuelve `{ dialogOpen, secondsLeft, onContinue }` para que `AppLayout` lo use para renderizar el dialog. Internamente maneja todos los timers y event listeners.

- [ ] **Step 1: Crear `use-inactivity-timeout.ts`**

**Nota de diseño:** Todo el estado mutable (timers, tiempo restante, si el dialog está abierto) vive en refs, no en deps de useEffect. Así los event listeners se registran solo una vez al montar y no se re-registran al cambiar estado. El estado de React (`dialogOpen`, `secondsLeft`) solo se usa para renderizar.

```ts
// frontend/src/hooks/use-inactivity-timeout.ts
import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useAuthStore } from '@/hooks/use-auth-store'
import { INACTIVITY_TIMEOUT_MS, INACTIVITY_WARNING_MS } from '@/lib/auth-config'

const WARNING_DURATION_MS = INACTIVITY_TIMEOUT_MS - INACTIVITY_WARNING_MS // 2 min = 120_000 ms

export function useInactivityTimeout() {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [secondsLeft, setSecondsLeft] = useState(Math.ceil(WARNING_DURATION_MS / 1000))

  const navigate = useNavigate()
  const logoutFn = useAuthStore.getState().logout  // getState() evita re-render en cambios del store

  // Toda la lógica de timers vive en refs para evitar dependencias en useEffect
  const warningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const logoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const hiddenAtRef = useRef<number | null>(null)
  const remainingWarningRef = useRef(INACTIVITY_WARNING_MS)
  const remainingLogoutRef = useRef(WARNING_DURATION_MS)
  const dialogOpenRef = useRef(false)  // ref espejo de dialogOpen para closures

  function clearAllTimers() {
    if (warningTimerRef.current) { clearTimeout(warningTimerRef.current); warningTimerRef.current = null }
    if (logoutTimerRef.current) { clearTimeout(logoutTimerRef.current); logoutTimerRef.current = null }
    if (countdownIntervalRef.current) { clearInterval(countdownIntervalRef.current); countdownIntervalRef.current = null }
  }

  function doLogout() {
    clearAllTimers()
    dialogOpenRef.current = false
    setDialogOpen(false)
    logoutFn()
    toast.info('Sesión cerrada por inactividad')
    navigate('/login', { replace: true })
  }

  function startLogoutCountdown(remainingMs: number) {
    remainingLogoutRef.current = remainingMs
    setSecondsLeft(Math.ceil(remainingMs / 1000))
    dialogOpenRef.current = true
    setDialogOpen(true)

    logoutTimerRef.current = setTimeout(doLogout, remainingMs)
    countdownIntervalRef.current = setInterval(() => {
      setSecondsLeft((prev) => (prev <= 1 ? 0 : prev - 1))
    }, 1000)
  }

  function startWarningTimer(delayMs: number) {
    remainingWarningRef.current = delayMs
    warningTimerRef.current = setTimeout(() => {
      startLogoutCountdown(WARNING_DURATION_MS)
    }, delayMs)
  }

  function resetTimer() {
    clearAllTimers()
    dialogOpenRef.current = false
    setDialogOpen(false)
    startWarningTimer(INACTIVITY_WARNING_MS)
  }

  const onContinue = () => resetTimer()

  // Montar una sola vez: event listeners de actividad + timer inicial
  useEffect(() => {
    const ACTIVITY_EVENTS = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'] as const

    const handleActivity = () => {
      // Usar ref (no estado) para evitar closure stale
      if (!dialogOpenRef.current) resetTimer()
    }

    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, handleActivity, { passive: true }))
    startWarningTimer(INACTIVITY_WARNING_MS)

    return () => {
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, handleActivity))
      clearAllTimers()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Visibility API — montar una sola vez
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAtRef.current = Date.now()
        clearAllTimers()
      } else {
        if (hiddenAtRef.current === null) return
        const elapsed = Date.now() - hiddenAtRef.current
        hiddenAtRef.current = null

        if (dialogOpenRef.current) {
          // Estaba mostrando el dialog — descontar tiempo transcurrido del countdown
          const newRemaining = Math.max(0, remainingLogoutRef.current - elapsed)
          if (newRemaining <= 0) {
            doLogout()
          } else {
            startLogoutCountdown(newRemaining)
          }
        } else {
          // Estaba en el timer de warning — descontar tiempo transcurrido
          const newRemaining = Math.max(0, remainingWarningRef.current - elapsed)
          if (newRemaining <= 0) {
            startLogoutCountdown(WARNING_DURATION_MS)
          } else {
            startWarningTimer(newRemaining)
          }
        }
      }
    }

    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return { dialogOpen, secondsLeft, onContinue }
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/hooks/use-inactivity-timeout.ts
git commit -m "feat(auth): add useInactivityTimeout hook with visibility API support"
```

---

## Task 5: Integrar en AppLayout

**Files:**
- Modify: `frontend/src/components/layout/app-layout.tsx`

- [ ] **Step 1: Modificar `app-layout.tsx`**

```tsx
// frontend/src/components/layout/app-layout.tsx
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
    if (!accessToken) return
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
```

- [ ] **Step 2: Verificar manualmente**

  Para no esperar 88 minutos, cambiar temporalmente en `auth-config.ts`:
  ```ts
  export const INACTIVITY_TIMEOUT_MS = 20 * 1000   // 20 segundos
  export const INACTIVITY_WARNING_MS = 10 * 1000   // aviso a los 10 seg
  ```
  Luego:
  1. Iniciar sesión → ir al dashboard
  2. No mover el mouse por 10 segundos → debe aparecer el dialog con "1:50" (realmente 0:10)
  3. Hacer click en "Sí, continuar" → dialog cierra, sesión continúa
  4. Esperar sin interactuar → a los 20 seg debe cerrar sesión y aparecer toast "Sesión cerrada por inactividad"
  5. Restaurar los valores originales en `auth-config.ts` (90 min / 88 min)

- [ ] **Step 3: Restaurar constantes a producción**

  Verificar que `auth-config.ts` quede con:
  ```ts
  export const INACTIVITY_TIMEOUT_MS = 90 * 60 * 1000
  export const INACTIVITY_WARNING_MS = 88 * 60 * 1000
  ```

- [ ] **Step 4: Commit final**

```bash
git add frontend/src/components/layout/app-layout.tsx frontend/src/lib/auth-config.ts
git commit -m "feat(auth): integrate inactivity timeout into AppLayout"
```

---

## Verificación final del flujo completo

Una vez implementado todo, verificar estos 4 escenarios:

| Escenario | Pasos | Resultado esperado |
|-----------|-------|--------------------|
| **Browser abre con sesión válida** | Abrir browser con `refreshToken` en localStorage | Spinner breve (~300ms) → dashboard directo |
| **Browser abre sin sesión** | Borrar `lab-auth-v3` de localStorage → abrir | Spinner breve → `/login` |
| **refreshToken expirado** | Manipular `lab-auth-v3.state.refreshToken` a un valor inválido → abrir browser | Spinner breve → `/login` |
| **Inactividad (con timer en 20s para prueba)** | No interactuar 10s → dialog → "Sí, continuar" / ignorar | Dialog aparece → continuar resetea / ignorar cierra sesión |
