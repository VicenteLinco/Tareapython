---
title: Auth Session Management — Silent Refresh + Inactivity Timeout
date: 2026-04-06
status: approved
---

# Auth Session Management

## Contexto

El sistema usa JWT con `accessToken` (15 min) + `refreshToken` (24 h). El problema actual: ambos tokens se persisten en `localStorage` via Zustand, lo que hace que al abrir el browser el usuario vea el dashboard directamente aunque el `accessToken` esté expirado — y sin ningún mecanismo de expiración por inactividad para PCs compartidos.

**Ya aplicado:** `accessToken` excluido de la persistencia (`partialize`). Solo `refreshToken` y `usuario` persisten en `localStorage`.

---

## Objetivo

- Si el `refreshToken` es válido al abrir el browser → entrar al dashboard sin pedir contraseña (fluido)
- Si el `refreshToken` expiró → ir al login
- Si el usuario no interactúa por 90 minutos → avisar y luego cerrar sesión automáticamente

---

## Arquitectura

### 1. `AuthInitializer` (nuevo componente)

**Ubicación:** `frontend/src/components/auth/AuthInitializer.tsx`

**Responsabilidad:** Resolver el estado de autenticación antes de renderizar cualquier ruta.

**Flujo al montar:**

```
refreshToken en store?
  ├── Sí → POST /auth/refresh
  │         ├── OK  → setTokens(access, refresh) → ready = true
  │         └── Error → logout() → ready = true
  └── No  → ready = true
```

**Mientras `ready = false`:** Pantalla de carga (spinner centrado, logo del sistema).

**Integración en `App.tsx`:**
```tsx
<AuthInitializer>
  <BrowserRouter>
    <Routes>...</Routes>
  </BrowserRouter>
</AuthInitializer>
```

`AppLayout` no cambia — sigue haciendo `if (!accessToken) return <Navigate to="/login" />`. Ahora funciona correctamente porque `AuthInitializer` ya resolvió el token antes de renderizar.

---

### 2. `useInactivityTimeout` (nuevo hook)

**Ubicación:** `frontend/src/hooks/use-inactivity-timeout.ts`

**Responsabilidad:** Detectar inactividad del usuario y cerrar sesión automáticamente.

**Eventos monitoreados:** `mousemove`, `keydown`, `click`, `scroll`, `touchstart`

**Timers:**
| Evento | Tiempo |
|--------|--------|
| Aviso previo | 88 minutos sin actividad |
| Logout automático | 90 minutos sin actividad |

**Comportamiento del aviso (88 min):**
- Abre un dialog modal: _"Tu sesión expirará en 2:00 min. ¿Deseas continuar?"_
- Cuenta regresiva visible en el dialog (2:00 → 0:00)
- Botón "Sí, continuar" → resetea timer, cierra dialog
- Si no hay respuesta → logout + redirect a `/login`

**Comportamiento de visibilidad:**
- Usa `document.addEventListener('visibilitychange')` — cuando la tab pierde el foco (`hidden`), guarda el timestamp
- Al volver (`visible`), calcula el tiempo transcurrido y lo aplica al timer
- Esto evita que el tiempo bloqueado del PC cuente como inactividad

**Logout por inactividad:**
```ts
useAuthStore.getState().logout()
toast.info('Sesión cerrada por inactividad')
navigate('/login', { replace: true })
```

**Integración:** Llamado dentro de `AppLayout` (solo activo en rutas protegidas, no en `/login`, `/kiosk`, `/qr`).

---

### 3. Cambios en archivos existentes

| Archivo | Cambio |
|---------|--------|
| `use-auth-store.ts` | Ya aplicado: `partialize` excluye `accessToken` |
| `App.tsx` | Envolver con `<AuthInitializer>` |
| `app-layout.tsx` | Llamar `useInactivityTimeout()` |

---

## Componente de aviso — InactivityWarningDialog

**Ubicación:** `frontend/src/components/auth/InactivityWarningDialog.tsx`

Dialog modal simple (no closeable con Escape ni click fuera) con:
- Ícono de reloj
- Texto: "Por seguridad, tu sesión se cerrará automáticamente."
- Cuenta regresiva: `1:47`, `1:46`, ...
- Botón primario: "Sí, continuar"

Usa el componente `Dialog` de shadcn/ui existente.

---

## Constantes configurables

```ts
// frontend/src/lib/auth-config.ts
export const INACTIVITY_TIMEOUT_MS = 90 * 60 * 1000   // 90 minutos
export const INACTIVITY_WARNING_MS = 88 * 60 * 1000   // aviso a los 88 min
```

---

## Flujos completos

### Apertura del browser (refreshToken válido)
```
Browser abre → AuthInitializer monta → spinner
→ POST /auth/refresh → OK
→ setTokens() → ready = true
→ AppLayout ve accessToken → renderiza dashboard
Tiempo total: ~300-500ms (1 request)
```

### Apertura del browser (sin sesión previa / expirada)
```
Browser abre → AuthInitializer monta → spinner
→ no refreshToken (o refresh falla) → logout() → ready = true
→ AppLayout ve accessToken = null → redirect /login
Tiempo total: ~50ms (sin request) o ~300ms (refresh falló)
```

### Inactividad 90 minutos
```
88 min sin actividad → InactivityWarningDialog abre con cuenta regresiva
→ usuario no responde 2 min → logout() → toast "Sesión cerrada por inactividad"
→ redirect /login
```

### Inactividad — usuario responde
```
88 min sin actividad → dialog abre
→ usuario hace click "Sí, continuar" → timer se resetea → dialog cierra
→ sesión continúa
```

---

## Archivos nuevos

```
frontend/src/components/auth/AuthInitializer.tsx
frontend/src/components/auth/InactivityWarningDialog.tsx
frontend/src/hooks/use-inactivity-timeout.ts
frontend/src/lib/auth-config.ts
```

## Archivos modificados

```
frontend/src/hooks/use-auth-store.ts   (ya modificado)
frontend/src/App.tsx
frontend/src/components/layout/app-layout.tsx
```
