# Refactor de calidad de código — Frontend — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reducir la deuda técnica del frontend extrayendo hooks compartidos, centralizando colores de estado y dividiendo los componentes más grandes en unidades con una sola responsabilidad.

**Architecture:** Primero se crean las utilidades base sin dependencias (`theme.ts`, `useLocalStorage.ts`, `useDialogState.ts`), luego se aplican a las páginas existentes sin cambiar comportamiento visible. Finalmente se refactorizan las dos páginas más grandes (`solicitudes-compra/index.tsx` y `recepciones/nueva.tsx`) extrayendo hooks y sub-componentes.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4 + DaisyUI, Zustand, React Query (@tanstack/react-query), Vite.

**Sin tests:** No hay suite de tests. Cada tarea incluye un paso de verificación manual en el navegador (`npm run dev`).

---

## Mapa de archivos

| Acción | Archivo |
|--------|---------|
| Crear | `frontend/src/lib/theme.ts` |
| Crear | `frontend/src/hooks/useLocalStorage.ts` |
| Crear | `frontend/src/hooks/useDialogState.ts` |
| Modificar | `frontend/src/pages/stock/stock-detail.tsx` |
| Modificar | `frontend/src/pages/consumos/components/producto-card.tsx` |
| Modificar | `frontend/src/components/ui/proveedor-select.tsx` |
| Modificar | `frontend/src/pages/recepciones/nueva.tsx` |
| Crear | `frontend/src/pages/solicitudes-compra/hooks/useSolicitudState.ts` |
| Modificar | `frontend/src/pages/solicitudes-compra/index.tsx` |
| Crear | `frontend/src/pages/recepciones/hooks/useRecepcionWizard.ts` |
| Crear | `frontend/src/pages/recepciones/hooks/useRecepcionItems.ts` |
| Crear | `frontend/src/pages/recepciones/steps/ProveedorStep.tsx` |
| Crear | `frontend/src/pages/recepciones/steps/ItemsStep.tsx` |
| Crear | `frontend/src/pages/recepciones/steps/ConfirmStep.tsx` |
| Crear | `frontend/src/pages/recepciones/components/ReconciliacionModal.tsx` |
| Crear | `frontend/src/pages/recepciones/components/VincularSolicitudModal.tsx` |

---

## Task 1: Crear `src/lib/theme.ts` — constantes de colores de estado

**Files:**
- Create: `frontend/src/lib/theme.ts`

- [ ] **Step 1: Crear el archivo con todas las constantes**

```ts
// frontend/src/lib/theme.ts

export const STATUS_COLORS = {
  vencido:    'bg-error/10 text-error',
  critico:    'bg-error/5 text-error/80',
  proximo:    'bg-warning/10 text-warning',
  intermedio: 'bg-yellow-50 text-yellow-700',
  disponible: 'bg-success/10 text-success/80',
} as const

/** Devuelve la clase Tailwind para un chip de días de autonomía. */
export function daysChipColor(days: number): string {
  if (days <= 0)  return STATUS_COLORS.vencido
  if (days <= 7)  return STATUS_COLORS.critico
  if (days <= 30) return STATUS_COLORS.proximo
  if (days <= 90) return STATUS_COLORS.intermedio
  return STATUS_COLORS.disponible
}

/** Clases para badges de alerta de stock. */
export const STOCK_ALERT_COLORS = {
  sinStock:   'bg-error/10 text-error border-error/20',
  stockBajo:  'bg-warning/10 text-warning border-warning/20',
  normal:     'bg-base-200/50 border-base-200',
} as const

/** Clases para lotes vencidos / próximos a vencer en tablas. */
export const LOTE_ROW_COLORS = {
  vencido:  'border-error/30 bg-error/5',
  proximo:  'border-warning/30 bg-warning/5 ring-1 ring-warning/20 shadow-sm shadow-warning/10',
  normal:   'border-base-200/60 bg-base-100',
} as const
```

- [ ] **Step 2: Verificar que TypeScript compila sin errores**

```bash
cd frontend && npx tsc --noEmit
```

Esperado: sin errores.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/theme.ts
git commit -m "feat(frontend): centralizar constantes de colores de estado en theme.ts"
```

---

## Task 2: Crear `src/hooks/useLocalStorage.ts`

**Files:**
- Create: `frontend/src/hooks/useLocalStorage.ts`

- [ ] **Step 1: Crear el hook**

```ts
// frontend/src/hooks/useLocalStorage.ts
import { useState, useEffect } from 'react'

/**
 * Estado booleano sincronizado con localStorage.
 * Guarda 'true' / 'false' como string. Devuelve `defaultValue` si la clave no existe.
 */
export function useLocalStorageBoolean(
  key: string,
  defaultValue: boolean,
): [boolean, (v: boolean) => void] {
  const [value, setValue] = useState<boolean>(() => {
    const stored = localStorage.getItem(key)
    if (stored === null) return defaultValue
    return stored !== 'false'
  })

  useEffect(() => {
    localStorage.setItem(key, String(value))
  }, [key, value])

  return [value, setValue]
}
```

- [ ] **Step 2: Verificar TypeScript**

```bash
cd frontend && npx tsc --noEmit
```

Esperado: sin errores.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/useLocalStorage.ts
git commit -m "feat(frontend): agregar hook useLocalStorageBoolean"
```

---

## Task 3: Crear `src/hooks/useDialogState.ts`

**Files:**
- Create: `frontend/src/hooks/useDialogState.ts`

- [ ] **Step 1: Crear el hook**

```ts
// frontend/src/hooks/useDialogState.ts
import { useState, useCallback } from 'react'

export interface DialogState {
  open: boolean
  onOpen: () => void
  onClose: () => void
  toggle: () => void
}

/**
 * Estado abierto/cerrado para modales, drawers y popovers.
 * Reemplaza el patrón `useState(false)` + handlers manuales.
 */
export function useDialogState(initial = false): DialogState {
  const [open, setOpen] = useState(initial)
  const onOpen  = useCallback(() => setOpen(true), [])
  const onClose = useCallback(() => setOpen(false), [])
  const toggle  = useCallback(() => setOpen(v => !v), [])
  return { open, onOpen, onClose, toggle }
}
```

- [ ] **Step 2: Verificar TypeScript**

```bash
cd frontend && npx tsc --noEmit
```

Esperado: sin errores.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/useDialogState.ts
git commit -m "feat(frontend): agregar hook useDialogState para modales"
```

---

## Task 4: Aplicar `theme.ts` en `stock-detail.tsx`

**Files:**
- Modify: `frontend/src/pages/stock/stock-detail.tsx`

Reemplaza las clases `amber-*` hardcodeadas y los ternarios de color inline por las constantes de `theme.ts`.

- [ ] **Step 1: Agregar import de theme.ts al inicio del archivo**

Después de `import { cn, ... } from '@/lib/utils'` agregar:
```ts
import { LOTE_ROW_COLORS, STOCK_ALERT_COLORS, daysChipColor } from '@/lib/theme'
```

- [ ] **Step 2: Reemplazar clases del card de stock bajo (línea ~101)**

Buscar:
```tsx
isLow ? 'bg-error/5 border-error/20' : 'bg-base-200/50 border-base-200'
```

Reemplazar con:
```tsx
isLow ? STOCK_ALERT_COLORS.stockBajo : STOCK_ALERT_COLORS.normal
```

- [ ] **Step 3: Reemplazar chip de "PRÓX" en lotes (línea ~142)**

Buscar (clase hardcodeada amber):
```tsx
className="text-[9px] font-bold uppercase tracking-wider text-amber-600 border border-amber-300 bg-amber-50 px-1.5 py-0.5 rounded cursor-default"
```

Reemplazar con:
```tsx
className="text-[9px] font-bold uppercase tracking-wider border px-1.5 py-0.5 rounded cursor-default bg-warning/10 text-warning border-warning/30"
```

- [ ] **Step 4: Reemplazar fila amber de la sección de lotes (línea ~156)**

Buscar:
```tsx
<div className="flex items-center justify-between px-4 py-3 bg-amber-50/60">
```

Reemplazar con:
```tsx
<div className="flex items-center justify-between px-4 py-3 bg-warning/5">
```

- [ ] **Step 5: Reemplazar clases de filas de lotes (líneas ~217-219)**

Buscar:
```tsx
? 'border-error/30 bg-error/5'
: isSoon
? 'border-warning/30 bg-warning/5 ring-1 ring-warning/20 shadow-sm shadow-warning/10'
```

Reemplazar con:
```tsx
? LOTE_ROW_COLORS.vencido
: isSoon
? LOTE_ROW_COLORS.proximo
```

- [ ] **Step 6: Reemplazar color de texto de fecha de vencimiento (línea ~254)**

Buscar:
```tsx
isExpired ? 'text-error' : isSoon ? 'text-warning' : 'opacity-40'
```

Este es correcto (usa DaisyUI), dejarlo sin cambios.

- [ ] **Step 7: Verificar TypeScript y app**

```bash
cd frontend && npx tsc --noEmit
```

Luego abrir `http://localhost:5173` y navegar a Stock → detalle de cualquier producto. Verificar que los colores de lotes vencidos/próximos se ven igual que antes.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/pages/stock/stock-detail.tsx
git commit -m "refactor(stock): reemplazar clases amber hardcodeadas por constantes de theme.ts"
```

---

## Task 5: Aplicar `theme.ts` en `consumos/components/producto-card.tsx`

**Files:**
- Modify: `frontend/src/pages/consumos/components/producto-card.tsx`

- [ ] **Step 1: Leer el archivo actual**

Leer `frontend/src/pages/consumos/components/producto-card.tsx` completo para identificar el ternario de colores de días.

- [ ] **Step 2: Agregar import de theme.ts**

```ts
import { daysChipColor } from '@/lib/theme'
```

- [ ] **Step 3: Reemplazar el ternario de colores inline**

Buscar el bloque que calcula clases para el chip de días de autonomía (parecido a):
```tsx
const cls = days <= 7
  ? 'bg-error/10 text-error'
  : days <= 30
    ? 'bg-warning/10 text-warning'
    : days <= 90
      ? 'bg-yellow-50 text-yellow-600'
      : 'bg-success/10 text-success/80'
```

Reemplazar con:
```tsx
const cls = daysChipColor(days)
```

- [ ] **Step 4: Verificar en app**

Abrir Consumos y verificar que los chips de días de autonomía siguen mostrando colores correctos (rojo/amarillo/verde según urgencia).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/consumos/components/producto-card.tsx
git commit -m "refactor(consumos): usar daysChipColor de theme.ts en chip de autonomía"
```

---

## Task 6: Aplicar `useLocalStorageBoolean` y `useDialogState` en `recepciones/nueva.tsx`

**Files:**
- Modify: `frontend/src/pages/recepciones/nueva.tsx`

Este task solo reemplaza hooks, sin mover lógica.

- [ ] **Step 1: Agregar imports**

Al inicio de `nueva.tsx`, agregar:
```ts
import { useLocalStorageBoolean } from '@/hooks/useLocalStorage'
import { useDialogState } from '@/hooks/useDialogState'
```

- [ ] **Step 2: Reemplazar estado `modoExperto`**

Buscar (líneas 83-84):
```ts
const [modoExperto, setModoExperto] = useState(() => localStorage.getItem('rec-modo-experto') !== 'false')
const setModoExpertoAndSave = (v: boolean) => { setModoExperto(v); localStorage.setItem('rec-modo-experto', String(v)) }
```

Reemplazar con:
```ts
const [modoExperto, setModoExpertoAndSave] = useLocalStorageBoolean('rec-modo-experto', true)
```

- [ ] **Step 3: Reemplazar estado de modales con `useDialogState`**

Buscar (líneas 95, 123, 128):
```ts
const [solicitudModalOpen, setSolicitudModalOpen] = useState(false)
// ...
const [showPrintModal, setShowPrintModal] = useState(false)
// ...
const [reconciliacionOpen, setReconciliacionOpen] = useState(false)
```

Reemplazar con:
```ts
const solicitudModal = useDialogState()
const printModal = useDialogState()
const reconciliacionModal = useDialogState()
```

- [ ] **Step 4: Actualizar todas las referencias a los estados reemplazados**

Buscar y reemplazar en el archivo:
- `solicitudModalOpen` → `solicitudModal.open`
- `setSolicitudModalOpen(true)` → `solicitudModal.onOpen()`
- `setSolicitudModalOpen(false)` → `solicitudModal.onClose()`
- `setShowPrintModal(true)` → `printModal.onOpen()`
- `setShowPrintModal(false)` → `printModal.onClose()`
- `showPrintModal` → `printModal.open`
- `reconciliacionOpen` → `reconciliacionModal.open`
- `setReconciliacionOpen(true)` → `reconciliacionModal.onOpen()`
- `setReconciliacionOpen(false)` → `reconciliacionModal.onClose()`

- [ ] **Step 5: Verificar TypeScript**

```bash
cd frontend && npx tsc --noEmit
```

Esperado: sin errores.

- [ ] **Step 6: Verificar en app**

Abrir Recepciones → Nueva Recepción. Verificar:
- Selector de proveedor funciona
- Modal de vincular solicitud abre/cierra
- Modal de impresión de etiquetas abre/cierra
- Toggle modo experto persiste al recargar página

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/recepciones/nueva.tsx
git commit -m "refactor(recepciones): usar useLocalStorageBoolean y useDialogState en nueva.tsx"
```

---

## Task 7: Crear `useSolicitudState.ts` — extraer todo el estado de solicitudes-compra

**Files:**
- Create: `frontend/src/pages/solicitudes-compra/hooks/useSolicitudState.ts`

Este es el task más grande. Mueve todo el estado, queries, mutations y handlers de `index.tsx` a un hook.

- [ ] **Step 1: Crear la carpeta y el archivo**

```bash
mkdir -p "frontend/src/pages/solicitudes-compra/hooks"
```

- [ ] **Step 2: Crear el hook con todo el contenido extraído de index.tsx**

Crear `frontend/src/pages/solicitudes-compra/hooks/useSolicitudState.ts` con el siguiente contenido:

```ts
// frontend/src/pages/solicitudes-compra/hooks/useSolicitudState.ts
import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useLocation } from 'react-router-dom'
import { toast } from 'sonner'
import api from '@/lib/api'
import { useAuthStore } from '@/hooks/use-auth-store'
import type {
  PaginatedResponse,
  SolicitudResumen,
  SolicitudDetalle,
  SolicitudItem,
  ItemRecomendado,
  UpdateSolicitudRequest,
  Producto,
  Proveedor,
} from '@/types'
import { calcularCantidad, fetchHorizonte } from '../solicitud-utils'

type ProductoExt = Producto & {
  imagen_url?: string | null
  unidad_base?: { id: number; nombre: string; nombre_plural: string }
  proveedor?: { id: number; nombre: string; icono?: string | null }
  pres_id?: number | null
  pres_nombre?: string | null
  pres_nombre_plural?: string | null
  pres_factor?: string | null
}

export function useSolicitudState() {
  useAuthStore()
  const queryClient = useQueryClient()
  const location = useLocation()

  const [view, setView] = useState<'crear' | 'historial'>('crear')
  const [selectedProveedor, setSelectedProveedor] = useState<Proveedor | null>(null)
  const [items, setItems] = useState<SolicitudItem[]>([])
  const [solicitudId, setSolicitudId] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [historialSearch, setHistorialSearch] = useState('')
  const [historialEstado, setHistorialEstado] = useState<string | null>(null)
  const [selectedSolicitudId, setSelectedSolicitudId] = useState<string | null>(null)
  const [pdfFirmaLabel, setPdfFirmaLabel] = useState('')
  const [horizonteGlobal, setHorizonteGlobal] = useState<number>(30)
  const [tabIzquierdo, setTabIzquierdo] = useState<'quiebres' | 'buscar'>('buscar')
  const [popoverOpenId, setPopoverOpenId] = useState<string | null>(null)
  const [restaurando, setRestaurando] = useState(true)
  const borradorCargado = useRef(false)

  const [modoRevision, setModoRevision] = useState(() => localStorage.getItem('solicitud-modo') !== 'avanzado')
  const [descartados, setDescartados] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('solicitud-descartados') ?? '[]')) } catch { return new Set() }
  })

  const setModo = (revision: boolean) => {
    setModoRevision(revision)
    localStorage.setItem('solicitud-modo', revision ? 'revision' : 'avanzado')
  }

  const handleDescartar = (productoId: string) => {
    setDescartados(prev => {
      const next = new Set(prev)
      next.add(productoId)
      localStorage.setItem('solicitud-descartados', JSON.stringify([...next]))
      return next
    })
  }

  const handleRestaurar = (productoId: string) => {
    setDescartados(prev => {
      const next = new Set(prev)
      next.delete(productoId)
      localStorage.setItem('solicitud-descartados', JSON.stringify([...next]))
      return next
    })
  }

  useEffect(() => {
    if (location.state?.view) setView(location.state.view)
    if (location.state?.estado) setHistorialEstado(location.state.estado)
  }, [location.state])

  useEffect(() => {
    if (!popoverOpenId) return
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('[data-popover-item]')) setPopoverOpenId(null)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [popoverOpenId])

  // ── Queries ──────────────────────────────────────────────────────────────────

  const { data: proveedores, isLoading: isLoadingProveedores } = useQuery({
    queryKey: ['proveedores-activos'],
    queryFn: () => api.get<Proveedor[]>('/proveedores').then(r => r.data),
    staleTime: 300_000,
  })

  const { data: recomendaciones, isLoading: isLoadingRecs } = useQuery({
    queryKey: ['solicitudes-recomendaciones'],
    queryFn: () => api.get<{ data: ItemRecomendado[] }>('/solicitudes-compra/recomendaciones').then(r => r.data.data),
    enabled: view === 'crear',
  })

  const { data: historial, isLoading: isLoadingHistorial } = useQuery({
    queryKey: ['solicitudes-historial', historialSearch, historialEstado],
    queryFn: () =>
      api.get<PaginatedResponse<SolicitudResumen>>('/solicitudes-compra', {
        params: { q: historialSearch || undefined, estado: historialEstado || undefined, per_page: 50 },
      }).then(r => r.data),
    enabled: view === 'historial',
  })

  const { data: configuracion } = useQuery({
    queryKey: ['configuracion'],
    queryFn: () =>
      api.get<{ nombre_laboratorio: string; logo_base64: string; moneda_simbolo: string; moneda_codigo: string }>('/configuracion')
        .then(r => r.data),
    staleTime: 300_000,
  })

  const monedaCodigo = configuracion?.moneda_codigo ?? 'CLP'

  // ── Restauración del borrador ────────────────────────────────────────────────

  useEffect(() => {
    if (view !== 'crear' || borradorCargado.current) return
    borradorCargado.current = true

    async function restaurar() {
      setRestaurando(true)
      try {
        const [borradorRes, proveedoresRes] = await Promise.all([
          api.get<{ borrador: SolicitudDetalle | null }>('/solicitudes-compra/borrador'),
          api.get<Proveedor[]>('/proveedores'),
        ])
        const b = borradorRes.data.borrador
        const provs = proveedoresRes.data

        const borradorItems: SolicitudItem[] = b ? b.items.map(item => ({
          producto_id: item.producto_id,
          producto_nombre: item.producto_nombre,
          codigo_proveedor: item.codigo_proveedor,
          codigo_maestro: item.codigo_maestro,
          proveedor_id: null,
          proveedor_nombre: item.proveedor_nombre || 'Desconocido',
          lead_time: 0,
          presentacion_id: item.presentacion_id,
          presentacion_nombre: item.presentacion_nombre,
          presentacion_nombre_plural: item.presentacion_nombre_plural,
          factor_conversion: item.factor_conversion ? parseFloat(item.factor_conversion) : null,
          unidad_base: item.unidad,
          unidad_base_plural: item.unidad_plural ?? item.unidad,
          cantidad: parseFloat(item.cantidad_sugerida),
          precio_unitario: item.precio_unitario ? parseFloat(item.precio_unitario) : 0,
          imagen_url: item.imagen_url,
          consumo_diario: 0,
          stock_actual: 0,
          stock_minimo: 0,
          horizonte_dias: item.horizonte_dias ?? null,
          horizonte_sugerido: item.horizonte_sugerido ?? null,
          horizonte_razon: item.horizonte_razon ?? null,
        })) : []

        if (b) setSolicitudId(b.id)

        if (borradorItems.length > 0) {
          const savedId = localStorage.getItem('solicitud_proveedor_id')
          if (savedId) {
            const prov = provs.find(p => p.id === parseInt(savedId))
            if (prov) setSelectedProveedor(prov)
          }
        }

        setItems(borradorItems)
      } catch (err) { console.warn('[solicitudes] Error restaurando borrador:', err) }
      setRestaurando(false)
    }

    restaurar()
  }, [view])

  // ── Mutations ────────────────────────────────────────────────────────────────

  const saveMutation = useMutation({
    mutationFn: (data: UpdateSolicitudRequest) =>
      solicitudId
        ? api.put(`/solicitudes-compra/${solicitudId}`, data)
        : api.post('/solicitudes-compra', data),
    onSuccess: (res) => {
      if (!solicitudId) setSolicitudId(res.data.id)
      queryClient.invalidateQueries({ queryKey: ['solicitudes-historial'] })
      toast.success('Borrador guardado')
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      toast.error(msg ?? 'Error al guardar borrador')
    },
  })

  const guardarMutation = useMutation({
    mutationFn: async () => {
      const saveData: UpdateSolicitudRequest = {
        nota: null,
        items: items.map(i => ({
          producto_id: i.producto_id,
          cantidad_sugerida: i.cantidad.toString(),
          unidad: i.unidad_base,
          precio_unitario: i.precio_unitario.toString(),
          presentacion_id: i.presentacion_id,
          cantidad_presentaciones: i.cantidad.toString(),
          horizonte_dias: i.horizonte_dias ?? null,
          horizonte_sugerido: i.horizonte_sugerido ?? null,
          horizonte_razon: i.horizonte_razon ?? null,
        })),
      }
      let id = solicitudId
      if (id) {
        await api.put(`/solicitudes-compra/${id}`, saveData)
      } else {
        const res = await api.post('/solicitudes-compra', saveData)
        id = res.data.id
        setSolicitudId(id)
      }
      return api.post(`/solicitudes-compra/${id}/guardar`)
    },
    onSuccess: () => {
      toast.success('Solicitud guardada correctamente')
      setItems([])
      setSolicitudId(null)
      setSelectedProveedor(null)
      borradorCargado.current = false
      localStorage.removeItem('solicitud_proveedor_id')
      setView('historial')
      queryClient.invalidateQueries({ queryKey: ['solicitudes-historial'] })
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
      toast.error(msg ?? 'Error al guardar solicitud')
    },
  })

  // ── Actions ──────────────────────────────────────────────────────────────────

  const handleAddFromRec = async (r: ItemRecomendado) => {
    if (items.find(i => i.producto_id === r.producto_id)) {
      toast.error('Producto ya está en la lista')
      return
    }
    const proveedorId = r.proveedor_id ?? selectedProveedor?.id ?? null
    const horizData = await fetchHorizonte(r.producto_id, proveedorId)
    const consumoDiario = parseFloat(r.consumo_diario.toString())
    const stockActual = parseFloat(r.stock_actual.toString())
    const stockMinimo = parseFloat(r.stock_seguridad.toString())
    const factorConv = r.factor_conversion ? parseFloat(r.factor_conversion.toString()) : null
    const cantidadCalc = calcularCantidad(horizonteGlobal, consumoDiario, r.lead_time, stockMinimo, stockActual, factorConv)
    const cantidad = r.confianza === 'baja' ? 0 : cantidadCalc

    setItems(prev => [...prev, {
      producto_id: r.producto_id,
      producto_nombre: r.producto_nombre,
      codigo_proveedor: r.codigo_proveedor,
      codigo_maestro: r.codigo_maestro,
      proveedor_id: proveedorId,
      proveedor_nombre: r.proveedor_nombre || 'S/P',
      lead_time: r.lead_time,
      presentacion_id: r.presentacion_id,
      presentacion_nombre: r.presentacion_nombre,
      presentacion_nombre_plural: r.presentacion_nombre_plural,
      factor_conversion: factorConv,
      unidad_base: r.unidad_base,
      unidad_base_plural: r.unidad_base_plural || r.unidad_base,
      cantidad,
      precio_unitario: r.precio_ultima_recepcion ? parseFloat(r.precio_ultima_recepcion.toString()) : 0,
      imagen_url: r.imagen_url,
      consumo_diario: consumoDiario,
      stock_actual: stockActual,
      stock_minimo: stockMinimo,
      horizonte_dias: horizonteGlobal,
      horizonte_sugerido: horizData.horizonte_sugerido,
      horizonte_razon: horizData.razon,
      tipo_estimacion_demanda: r.confianza === 'baja' ? 'sin_historial' : 'forecast',
      horizonte_personalizado: false,
    }])
  }

  const handleAddFromRecConCantidad = async (r: ItemRecomendado, cantidad: number) => {
    if (items.find(i => i.producto_id === r.producto_id)) {
      toast.error('Producto ya está en la lista')
      return
    }
    const proveedorId = r.proveedor_id ?? selectedProveedor?.id ?? null
    const horizData = await fetchHorizonte(r.producto_id, proveedorId)
    const factorConv = r.factor_conversion ? parseFloat(r.factor_conversion.toString()) : null
    setItems(prev => [...prev, {
      producto_id: r.producto_id,
      producto_nombre: r.producto_nombre,
      codigo_proveedor: r.codigo_proveedor,
      codigo_maestro: r.codigo_maestro,
      proveedor_id: proveedorId,
      proveedor_nombre: r.proveedor_nombre || 'S/P',
      lead_time: r.lead_time,
      presentacion_id: r.presentacion_id,
      presentacion_nombre: r.presentacion_nombre,
      presentacion_nombre_plural: r.presentacion_nombre_plural,
      factor_conversion: factorConv,
      unidad_base: r.unidad_base,
      unidad_base_plural: r.unidad_base_plural || r.unidad_base,
      cantidad,
      precio_unitario: r.precio_ultima_recepcion ? parseFloat(r.precio_ultima_recepcion.toString()) : 0,
      imagen_url: r.imagen_url,
      consumo_diario: parseFloat(r.consumo_diario.toString()),
      stock_actual: parseFloat(r.stock_actual.toString()),
      stock_minimo: parseFloat(r.stock_seguridad.toString()),
      horizonte_dias: horizonteGlobal,
      horizonte_sugerido: horizData.horizonte_sugerido,
      horizonte_razon: horizData.razon,
      tipo_estimacion_demanda: r.confianza === 'baja' ? 'sin_historial' : 'forecast',
      horizonte_personalizado: true,
    }])
  }

  const handleAddFromSearch = async (p: Producto) => {
    if (items.find(i => i.producto_id === p.id)) {
      toast.error('Producto ya está en la lista')
      return
    }
    const px = p as ProductoExt
    const proveedorId = px.proveedor?.id ?? selectedProveedor?.id ?? null
    const horizData = await fetchHorizonte(p.id, proveedorId)
    const factorConvSearch = px.pres_factor ? parseFloat(px.pres_factor) : null
    const cantidad = calcularCantidad(
      horizonteGlobal, horizData.consumo_diario, p.lead_time_propio || 0,
      horizData.stock_minimo, horizData.stock_actual, factorConvSearch
    )
    setItems(prev => [...prev, {
      producto_id: p.id,
      producto_nombre: p.nombre,
      codigo_proveedor: p.codigo_proveedor,
      codigo_maestro: p.codigo_maestro,
      proveedor_id: proveedorId,
      proveedor_nombre: selectedProveedor?.nombre ?? 'Manual',
      lead_time: p.lead_time_propio || 0,
      presentacion_id: px.pres_id ?? null,
      presentacion_nombre: px.pres_nombre ?? null,
      presentacion_nombre_plural: px.pres_nombre_plural ?? null,
      factor_conversion: factorConvSearch,
      unidad_base: px.unidad_base?.nombre ?? 'u',
      unidad_base_plural: px.unidad_base?.nombre_plural ?? 'u',
      cantidad,
      precio_unitario: p.precio_unidad ? parseFloat(String(p.precio_unidad)) : 0,
      imagen_url: px.imagen_url ?? null,
      consumo_diario: horizData.consumo_diario,
      stock_actual: horizData.stock_actual,
      stock_minimo: horizData.stock_minimo,
      horizonte_dias: horizonteGlobal,
      horizonte_sugerido: horizData.horizonte_sugerido,
      horizonte_razon: horizData.razon,
      tipo_estimacion_demanda: horizData.tipo_estimacion_demanda,
      horizonte_personalizado: false,
    }])
  }

  const handleUpdateQty = (pid: string, val: number) =>
    setItems(prev => prev.map(i => i.producto_id === pid ? { ...i, cantidad: Math.max(1, val) } : i))

  const handleRemove = (pid: string) =>
    setItems(prev => prev.filter(i => i.producto_id !== pid))

  const handleGlobalHorizonteChange = (dias: number) => {
    const conservados = items.filter(i => i.horizonte_personalizado).length
    const recalculados = items.length - conservados
    setHorizonteGlobal(dias)
    setItems(prev => prev.map(i => {
      if (i.horizonte_personalizado) return i
      const nueva = calcularCantidad(dias, i.consumo_diario, i.lead_time, i.stock_minimo, i.stock_actual, i.factor_conversion)
      return { ...i, horizonte_dias: dias, cantidad: nueva }
    }))
    if (items.length === 0) return
    const label = dias >= 365 ? '1 año' : dias >= 180 ? '6 meses' : dias >= 90 ? '3 meses' : `${dias} días`
    if (conservados === items.length) {
      toast.info('Todos los items tienen horizonte personalizado 📌')
    } else if (conservados > 0) {
      toast.success(`Horizonte actualizado a ${label}. ${recalculados} recalculados, ${conservados} con horizonte personalizado 📌.`)
    } else {
      toast.success(`Horizonte actualizado a ${label}. ${recalculados} ${recalculados === 1 ? 'item recalculado' : 'items recalculados'}.`)
    }
  }

  const handleHorizonteChip = (pid: string, dias: number) => {
    setItems(prev => prev.map(i => {
      if (i.producto_id !== pid) return i
      const nueva = calcularCantidad(dias, i.consumo_diario, i.lead_time, i.stock_minimo, i.stock_actual, i.factor_conversion)
      return { ...i, horizonte_dias: dias, cantidad: nueva, horizonte_personalizado: dias !== horizonteGlobal }
    }))
    setPopoverOpenId(null)
  }

  const handleResetHorizonteToGlobal = (pid: string) => {
    setItems(prev => prev.map(i => {
      if (i.producto_id !== pid) return i
      const nueva = calcularCantidad(horizonteGlobal, i.consumo_diario, i.lead_time, i.stock_minimo, i.stock_actual, i.factor_conversion)
      return { ...i, horizonte_dias: horizonteGlobal, cantidad: nueva, horizonte_personalizado: false }
    }))
    setPopoverOpenId(null)
  }

  const handleSaveBorrador = () => {
    if (items.length === 0) return
    setIsSaving(true)
    saveMutation.mutate(
      {
        nota: null,
        items: items.map(i => ({
          producto_id: i.producto_id,
          cantidad_sugerida: i.cantidad.toString(),
          unidad: i.unidad_base,
          precio_unitario: i.precio_unitario.toString(),
          presentacion_id: i.presentacion_id,
          cantidad_presentaciones: i.cantidad.toString(),
          horizonte_dias: i.horizonte_dias ?? null,
          horizonte_sugerido: i.horizonte_sugerido ?? null,
          horizonte_razon: i.horizonte_razon ?? null,
        })),
      },
      { onSettled: () => setIsSaving(false) }
    )
  }

  const handleSelectProveedor = (p: Proveedor) => {
    if (items.length > 0) {
      setItems([])
      setSolicitudId(null)
      toast('Lista anterior limpiada', { icon: '↩' })
    }
    localStorage.setItem('solicitud_proveedor_id', String(p.id))
    setSelectedProveedor(p)
  }

  const handleCambiarProveedor = () => {
    if (items.length > 0) {
      setItems([])
      setSolicitudId(null)
      toast('Lista limpiada al cambiar proveedor', { icon: '↩' })
    }
    localStorage.removeItem('solicitud_proveedor_id')
    setSelectedProveedor(null)
  }

  // ── Detail query ─────────────────────────────────────────────────────────────

  const { data: detail, isLoading: isLoadingDetail } = useQuery({
    queryKey: ['solicitud-detail', selectedSolicitudId],
    queryFn: () =>
      api.get<SolicitudDetalle>(`/solicitudes-compra/${selectedSolicitudId}`).then(r => r.data),
    enabled: !!selectedSolicitudId,
  })

  // ── Derived ──────────────────────────────────────────────────────────────────

  const recsFiltered = selectedProveedor
    ? (recomendaciones ?? []).filter(r => r.proveedor_id === selectedProveedor.id)
    : []

  const urgenciasByProveedor = (recomendaciones ?? []).reduce<Record<number, { total: number; criticos: number }>>((acc, r) => {
    const pid = r.proveedor_id
    if (pid == null) return acc
    if (!acc[pid]) acc[pid] = { total: 0, criticos: 0 }
    acc[pid].total++
    if (r.nivel_urgencia === 'critica' || r.nivel_urgencia === 'critico') acc[pid].criticos++
    return acc
  }, {})

  return {
    // Vista
    view, setView,
    // Proveedor
    selectedProveedor, handleSelectProveedor, handleCambiarProveedor,
    // Items
    items,
    handleAddFromRec, handleAddFromRecConCantidad, handleAddFromSearch,
    handleUpdateQty, handleRemove,
    // Horizonte
    horizonteGlobal, handleGlobalHorizonteChange, handleHorizonteChip, handleResetHorizonteToGlobal,
    // Borrador / guardar
    solicitudId, isSaving, saveMutation, guardarMutation,
    handleSaveBorrador,
    // Historial
    historialSearch, setHistorialSearch,
    historialEstado, setHistorialEstado,
    historial, isLoadingHistorial,
    // Detalle modal
    selectedSolicitudId, setSelectedSolicitudId,
    detail, isLoadingDetail,
    pdfFirmaLabel, setPdfFirmaLabel,
    // Modo / tabs
    modoRevision, setModo,
    tabIzquierdo, setTabIzquierdo,
    popoverOpenId, setPopoverOpenId,
    restaurando,
    // Descartados (modo revisión)
    descartados, handleDescartar, handleRestaurar,
    // Datos globales
    proveedores, isLoadingProveedores,
    recomendaciones, isLoadingRecs,
    recsFiltered, urgenciasByProveedor,
    configuracion, monedaCodigo,
  }
}

export type SolicitudStateReturn = ReturnType<typeof useSolicitudState>
```

- [ ] **Step 3: Verificar TypeScript**

```bash
cd frontend && npx tsc --noEmit
```

Esperado: sin errores.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/solicitudes-compra/hooks/useSolicitudState.ts
git commit -m "feat(solicitudes): extraer useSolicitudState hook con todo el estado y lógica"
```

---

## Task 8: Refactorizar `solicitudes-compra/index.tsx` para usar `useSolicitudState`

**Files:**
- Modify: `frontend/src/pages/solicitudes-compra/index.tsx`

- [ ] **Step 1: Reemplazar el contenido completo de index.tsx**

```tsx
// frontend/src/pages/solicitudes-compra/index.tsx
import { ShoppingCart, Plus, History } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSolicitudState } from './hooks/useSolicitudState'
import { ProveedorGallery } from './components/proveedor-gallery'
import { QuiebresPanelIzquierdo } from './components/quiebres-panel'
import { PedidoPanel } from './components/pedido-panel'
import { HistorialView } from './components/historial-view'
import { DetalleModal } from './components/detalle-modal'
import { RevisionView } from './components/revision-view'
import { ProveedorBanner } from './components/proveedor-banner'

export default function SolicitudesCompraPage() {
  const s = useSolicitudState()

  return (
    <div className="flex flex-col h-[calc(100vh-100px)] gap-6 p-2">

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ShoppingCart className="h-6 w-6 text-primary" />
            Solicitudes de Compra
          </h1>
          <p className="text-sm opacity-50">Gestiona tus pedidos y revisa recomendaciones basadas en stock</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {s.view === 'crear' && (
            <div className="tabs tabs-boxed bg-base-200 p-1 rounded-xl self-start">
              <button
                className={cn("tab gap-1.5 rounded-lg transition-all px-4 h-8 text-xs font-bold", s.modoRevision ? "tab-active bg-base-100 shadow-sm" : "opacity-50 hover:opacity-80")}
                onClick={() => s.setModo(true)}
              >
                Revisión
              </button>
              <button
                className={cn("tab gap-1.5 rounded-lg transition-all px-4 h-8 text-xs font-bold", !s.modoRevision ? "tab-active bg-base-100 shadow-sm" : "opacity-50 hover:opacity-80")}
                onClick={() => s.setModo(false)}
              >
                Avanzado
              </button>
            </div>
          )}
          <div className="tabs tabs-boxed bg-base-200 p-1 rounded-2xl self-start">
            <button
              className={cn("tab gap-2 rounded-xl transition-all px-6 h-10", s.view === 'crear' ? "tab-active bg-primary text-primary-content font-bold shadow-lg" : "hover:bg-base-300")}
              onClick={() => s.setView('crear')}
            >
              <Plus className="h-4 w-4" /> Nueva
            </button>
            <button
              className={cn("tab gap-2 rounded-xl transition-all px-6 h-10", s.view === 'historial' ? "tab-active bg-primary text-primary-content font-bold shadow-lg" : "hover:bg-base-300")}
              onClick={() => s.setView('historial')}
            >
              <History className="h-4 w-4" /> Historial
            </button>
          </div>
        </div>
      </div>

      {/* Cuerpo */}
      {s.view === 'crear' && s.restaurando ? (
        <div className="flex-1 grid grid-cols-[30%_1fr] gap-4 min-h-0 animate-pulse">
          <div className="bg-base-200/60 rounded-[2rem]" />
          <div className="flex flex-col gap-3">
            <div className="h-16 bg-base-200/60 rounded-2xl" />
            <div className="flex-1 bg-base-200/60 rounded-[2.5rem]" />
          </div>
        </div>
      ) : s.view === 'crear' && s.modoRevision ? (
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4 min-h-0 overflow-y-auto">
          <div className="overflow-y-auto custom-scrollbar pr-1">
            <RevisionView
              recomendaciones={s.recomendaciones ?? []}
              isLoading={s.isLoadingRecs}
              itemsEnPedido={s.items}
              descartados={s.descartados}
              horizonteGlobal={s.horizonteGlobal}
              onAceptar={s.handleAddFromRec}
              onAceptarConCantidad={s.handleAddFromRecConCantidad}
              onDescartar={s.handleDescartar}
              onRestaurar={s.handleRestaurar}
              onCambiarAAvanzado={() => s.setModo(false)}
            />
          </div>
          {s.items.length > 0 && s.selectedProveedor && (
            <div className="overflow-y-auto custom-scrollbar">
              <PedidoPanel
                proveedor={s.selectedProveedor}
                items={s.items}
                solicitudId={s.solicitudId}
                isSaving={s.isSaving}
                isGuardando={s.guardarMutation.isPending}
                horizonteGlobal={s.horizonteGlobal}
                popoverOpenId={s.popoverOpenId}
                monedaCodigo={s.monedaCodigo}
                onUpdateQty={s.handleUpdateQty}
                onRemove={s.handleRemove}
                onGlobalHorizonteChange={s.handleGlobalHorizonteChange}
                onHorizonteChip={s.handleHorizonteChip}
                onResetHorizonteToGlobal={s.handleResetHorizonteToGlobal}
                onPopoverToggle={s.setPopoverOpenId}
                onSaveBorrador={s.handleSaveBorrador}
                onGuardar={() => s.guardarMutation.mutate()}
              />
            </div>
          )}
        </div>
      ) : s.view === 'crear' ? (
        s.selectedProveedor === null ? (
          <ProveedorGallery
            proveedores={s.proveedores}
            isLoading={s.isLoadingProveedores}
            urgenciasByProveedor={s.urgenciasByProveedor}
            logoBase64={s.configuracion?.logo_base64}
            onSelect={s.handleSelectProveedor}
          />
        ) : (
          <div className="flex-1 flex flex-col gap-4 min-h-0">
            <ProveedorBanner
              proveedor={s.selectedProveedor}
              quiebresCount={s.recsFiltered.length}
              onCambiar={s.handleCambiarProveedor}
            />
            <div className="flex-1 grid grid-cols-1 lg:grid-cols-[30%_1fr] gap-4 min-h-0">
              <QuiebresPanelIzquierdo
                proveedor={s.selectedProveedor}
                recomendaciones={s.recsFiltered}
                isLoadingRecs={s.isLoadingRecs}
                itemsEnPedido={s.items}
                tab={s.tabIzquierdo}
                monedaCodigo={s.monedaCodigo}
                onTabChange={s.setTabIzquierdo}
                onAddFromRec={s.handleAddFromRec}
                onAddFromSearch={s.handleAddFromSearch}
              />
              <PedidoPanel
                proveedor={s.selectedProveedor}
                items={s.items}
                solicitudId={s.solicitudId}
                isSaving={s.isSaving}
                isGuardando={s.guardarMutation.isPending}
                horizonteGlobal={s.horizonteGlobal}
                popoverOpenId={s.popoverOpenId}
                monedaCodigo={s.monedaCodigo}
                onUpdateQty={s.handleUpdateQty}
                onRemove={s.handleRemove}
                onGlobalHorizonteChange={s.handleGlobalHorizonteChange}
                onHorizonteChip={s.handleHorizonteChip}
                onResetHorizonteToGlobal={s.handleResetHorizonteToGlobal}
                onPopoverToggle={s.setPopoverOpenId}
                onSaveBorrador={s.handleSaveBorrador}
                onGuardar={() => s.guardarMutation.mutate()}
              />
            </div>
          </div>
        )
      ) : (
        <HistorialView
          solicitudes={s.historial?.data}
          isLoading={s.isLoadingHistorial}
          search={s.historialSearch}
          onSearchChange={s.setHistorialSearch}
          onSelectSolicitud={s.setSelectedSolicitudId}
          estado={s.historialEstado}
          onEstadoChange={s.setHistorialEstado}
        />
      )}

      <DetalleModal
        solicitudId={s.selectedSolicitudId}
        detail={s.detail}
        isLoading={s.isLoadingDetail}
        pdfFirmaLabel={s.pdfFirmaLabel}
        monedaCodigo={s.monedaCodigo}
        monedaSimbolo={s.configuracion?.moneda_simbolo ?? '$'}
        nombreLaboratorio={s.configuracion?.nombre_laboratorio ?? 'Laboratorio Clínico'}
        logoBase64={s.configuracion?.logo_base64}
        onClose={() => { s.setSelectedSolicitudId(null); s.setPdfFirmaLabel('') }}
        onPdfFirmaChange={s.setPdfFirmaLabel}
      />
    </div>
  )
}
```

- [ ] **Step 2: Crear el componente `ProveedorBanner`** que fue extraído del JSX inline

Crear `frontend/src/pages/solicitudes-compra/components/proveedor-banner.tsx`:

```tsx
// frontend/src/pages/solicitudes-compra/components/proveedor-banner.tsx
import { ChevronLeft, Clock, Phone, Mail } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Proveedor } from '@/types'

interface Props {
  proveedor: Proveedor
  quiebresCount: number
  onCambiar: () => void
}

export function ProveedorBanner({ proveedor, quiebresCount, onCambiar }: Props) {
  return (
    <div className="flex items-center gap-4 px-5 py-3 bg-primary/5 border border-primary/15 rounded-2xl shrink-0">
      <div className="w-10 h-10 rounded-xl overflow-hidden shrink-0 flex items-center justify-center bg-base-200 text-2xl">
        {proveedor.icono
          ? <img src={proveedor.icono} alt={proveedor.nombre} className="h-full w-full object-contain" />
          : '🏭'}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-bold text-sm">{proveedor.nombre}</p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5">
          <span className="text-[10px] opacity-40 font-medium uppercase tracking-wide">
            {quiebresCount > 0 ? `${quiebresCount} quiebre${quiebresCount !== 1 ? 's' : ''}` : 'Sin quiebres'}
          </span>
          {(proveedor.dias_despacho_tierra || proveedor.dias_despacho_aereo) && (
            <span className="text-[10px] opacity-40 flex items-center gap-0.5">
              <Clock className="h-2.5 w-2.5" />
              {proveedor.dias_despacho_tierra ?? proveedor.dias_despacho_aereo}d despacho
            </span>
          )}
          {proveedor.contacto && (
            <span className="text-[10px] opacity-40 truncate">👤 {proveedor.contacto}</span>
          )}
          {proveedor.telefono && (
            <span className="text-[10px] opacity-40 flex items-center gap-0.5">
              <Phone className="h-2.5 w-2.5" /> {proveedor.telefono}
            </span>
          )}
          {proveedor.email && (
            <span className="text-[10px] opacity-40 flex items-center gap-0.5">
              <Mail className="h-2.5 w-2.5" /> {proveedor.email}
            </span>
          )}
        </div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="rounded-xl h-8 gap-1.5 text-xs shrink-0"
        onClick={onCambiar}
        aria-label="Cambiar proveedor"
      >
        <ChevronLeft className="h-3.5 w-3.5" /> Cambiar
      </Button>
    </div>
  )
}
```

- [ ] **Step 3: Verificar TypeScript**

```bash
cd frontend && npx tsc --noEmit
```

Esperado: sin errores. Si hay errores de tipos por props faltantes, agregarlas al hook o componente según corresponda.

- [ ] **Step 4: Verificar en app**

Abrir `http://localhost:5173/solicitudes-compra`. Verificar:
- La galería de proveedores carga
- Seleccionar un proveedor muestra el banner y el panel dual
- Modo Revisión / Avanzado funciona
- El historial carga al cambiar de tab
- El modal de detalle abre desde el historial

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/solicitudes-compra/index.tsx \
        frontend/src/pages/solicitudes-compra/components/proveedor-banner.tsx
git commit -m "refactor(solicitudes): index.tsx usa useSolicitudState, extraer ProveedorBanner"
```

---

## Task 9: Crear `useRecepcionWizard.ts` — estado del wizard de recepciones

**Files:**
- Create: `frontend/src/pages/recepciones/hooks/useRecepcionWizard.ts`

- [ ] **Step 1: Crear la carpeta y el archivo**

```bash
mkdir -p "frontend/src/pages/recepciones/hooks"
```

Crear `frontend/src/pages/recepciones/hooks/useRecepcionWizard.ts`:

```ts
// frontend/src/pages/recepciones/hooks/useRecepcionWizard.ts
import { useState, useRef } from 'react'
import { useLocalStorageBoolean } from '@/hooks/useLocalStorage'
import { useDialogState } from '@/hooks/useDialogState'
import type { Proveedor, SolicitudResumen } from '@/types'

export type PasoRecepcion = 1 | 2 | 3

export interface RecepcionWizardState {
  pasoActual: PasoRecepcion
  setPasoActual: (p: PasoRecepcion) => void
  modoExperto: boolean
  setModoExperto: (v: boolean) => void
  // Cabecera
  proveedorId: number | null
  setProveedorId: (id: number | null) => void
  proveedorError: boolean
  setProveedorError: (v: boolean) => void
  proveedorRef: React.RefObject<HTMLDivElement>
  guiaDespacho: string
  setGuiaDespacho: (v: string) => void
  guiaProvisoria: boolean
  setGuiaProvisoria: (v: boolean) => void
  fechaRecepcion: string
  setFechaRecepcion: (v: string) => void
  fechaExpanded: boolean
  setFechaExpanded: (v: boolean) => void
  // Solicitud vinculada
  solicitudId: string | null
  setSolicitudId: (v: string | null) => void
  solicitudNumero: string | null
  setSolicitudNumero: (v: string | null) => void
  solicitudModal: ReturnType<typeof useDialogState>
  solicitudesPendientes: SolicitudResumen[] | undefined
  // Decisión (paso 3)
  decision: 'completa' | 'parcial' | 'rechazada'
  setDecision: (v: 'completa' | 'parcial' | 'rechazada') => void
  motivosSeleccionados: string[]
  setMotivosSeleccionados: (v: string[]) => void
  motivoOtro: string
  setMotivoOtro: (v: string) => void
  nota: string
  setNota: (v: string) => void
}
```

Nota: el hook en sí importa las queries necesarias y exporta el estado completo del wizard. Ver implementación completa abajo:

```ts
import { useState, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import api from '@/lib/api'
import { useLocalStorageBoolean } from '@/hooks/useLocalStorage'
import { useDialogState } from '@/hooks/useDialogState'
import type { SolicitudResumen } from '@/types'

export type PasoRecepcion = 1 | 2 | 3
type Decision = 'completa' | 'parcial' | 'rechazada'

export function useRecepcionWizard() {
  const [pasoActual, setPasoActual] = useState<PasoRecepcion>(1)
  const [modoExperto, setModoExperto] = useLocalStorageBoolean('rec-modo-experto', true)

  // Cabecera
  const [proveedorId, setProveedorIdRaw] = useState<number | null>(null)
  const [proveedorError, setProveedorError] = useState(false)
  const proveedorRef = useRef<HTMLDivElement>(null)
  const [guiaDespacho, setGuiaDespacho] = useState('')
  const [guiaProvisoria, setGuiaProvisoria] = useState(false)
  const [fechaRecepcion, setFechaRecepcion] = useState(() => new Date().toISOString().slice(0, 16))
  const [fechaExpanded, setFechaExpanded] = useState(false)

  // Solicitud
  const [solicitudId, setSolicitudId] = useState<string | null>(null)
  const [solicitudNumero, setSolicitudNumero] = useState<string | null>(null)
  const solicitudModal = useDialogState()

  // Decisión (paso 3)
  const [decision, setDecision] = useState<Decision>('completa')
  const [motivosSeleccionados, setMotivosSeleccionados] = useState<string[]>([])
  const [motivoOtro, setMotivoOtro] = useState('')
  const [nota, setNota] = useState('')

  const { data: solicitudesPendientes } = useQuery({
    queryKey: ['solicitudes-activas', proveedorId],
    queryFn: () => api.get<{ data: SolicitudResumen[] }>('/solicitudes-compra', {
      params: { per_page: 100, ...(proveedorId ? { proveedor_id: proveedorId } : {}) }
    }).then(r => (r.data.data ?? []).filter(s => ['aprobada', 'enviada'].includes(s.estado))),
  })

  const setProveedorId = (id: number | null) => {
    setProveedorIdRaw(id)
    if (id !== proveedorId) {
      setSolicitudId(null)
      setSolicitudNumero(null)
    }
  }

  return {
    pasoActual, setPasoActual,
    modoExperto, setModoExperto,
    proveedorId, setProveedorId, proveedorError, setProveedorError, proveedorRef,
    guiaDespacho, setGuiaDespacho,
    guiaProvisoria, setGuiaProvisoria,
    fechaRecepcion, setFechaRecepcion,
    fechaExpanded, setFechaExpanded,
    solicitudId, setSolicitudId, solicitudNumero, setSolicitudNumero, solicitudModal,
    solicitudesPendientes,
    decision, setDecision,
    motivosSeleccionados, setMotivosSeleccionados,
    motivoOtro, setMotivoOtro,
    nota, setNota,
  }
}

export type RecepcionWizardReturn = ReturnType<typeof useRecepcionWizard>
```

- [ ] **Step 2: Verificar TypeScript**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/recepciones/hooks/useRecepcionWizard.ts
git commit -m "feat(recepciones): extraer useRecepcionWizard con estado del wizard"
```

---

## Task 10: Crear `useRecepcionItems.ts` — ítems, scan y confirmación

**Files:**
- Create: `frontend/src/pages/recepciones/hooks/useRecepcionItems.ts`

- [ ] **Step 1: Leer el archivo `nueva.tsx` (líneas 182–700) para identificar toda la lógica de ítems**

Leer `frontend/src/pages/recepciones/nueva.tsx` líneas 182 a 700.

- [ ] **Step 2: Crear el hook**

Crear `frontend/src/pages/recepciones/hooks/useRecepcionItems.ts` extrayendo de `nueva.tsx`:
- El estado `detalles`, `scannerPaused`, `scanCount`, `pendingScan`
- La función `addProducto`
- La función `handleSearch`
- La función `handleScanDetected`
- Las funciones de actualización de ítems (`handleUpdateDetalle`, `handleAddLote`, `handleRemoveLote`, etc.)
- El estado post-confirmación `lotesConfirmados`, `showPrintModal`
- El estado de reconciliación `solicitudItemsRef`, `reconciliacionModal`, `pendingConfirmarPayload`
- La mutation de confirmación

El hook recibe como parámetros lo que necesita del wizard:
```ts
export function useRecepcionItems(params: {
  proveedorId: number | null
  proveedores: Proveedor[] | undefined
  productos: Producto[] | undefined
  areas: Area[] | undefined
  monedaSimbolo: string
  solicitudId: string | null
  setSolicitudId: (id: string | null) => void
  solicitudNumero: string | null
  guiaDespacho: string
  guiaProvisoria: boolean
  fechaRecepcion: string
  decision: string
  motivosSeleccionados: string[]
  motivoOtro: string
  nota: string
  setPasoActual: (p: 1 | 2 | 3) => void
})
```

El hook exporta `detalles`, `setDetalles`, `addProducto`, `handleSearch`, `handleScanDetected`, `scannerPaused`, `setScannerPaused`, `scanCount`, `pendingScan`, `setPendingScan`, `handleConfirmar`, `confirmarMutation`, `lotesConfirmados`, `printModal`, `reconciliacionModal`, `pendingConfirmarPayload`, `setPendingConfirmarPayload`, `solicitudItemsRef`.

**Nota:** Este hook es grande porque contiene la lógica de negocio principal. El objetivo es que `nueva.tsx` quede como orquestador y los steps como presentación pura.

- [ ] **Step 3: Verificar TypeScript**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/recepciones/hooks/useRecepcionItems.ts
git commit -m "feat(recepciones): extraer useRecepcionItems con lógica de ítems y scan"
```

---

## Task 11: Extraer modales de recepciones

**Files:**
- Create: `frontend/src/pages/recepciones/components/ReconciliacionModal.tsx`
- Create: `frontend/src/pages/recepciones/components/VincularSolicitudModal.tsx`

- [ ] **Step 1: Leer `nueva.tsx` para identificar el JSX de ReconciliacionModal (líneas ~1090-1170)**

Leer `frontend/src/pages/recepciones/nueva.tsx` líneas 1090 a 1200.

- [ ] **Step 2: Crear `ReconciliacionModal.tsx`**

Extraer el bloque de reconciliación (el IIFE condicional) a un componente independiente:

```tsx
// frontend/src/pages/recepciones/components/ReconciliacionModal.tsx
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import type { DetalleLineUI } from './item-card'

interface SolicitudItemSimple {
  producto_id: string
  producto_nombre: string
  cantidad_base: number
  unidad: string
}

interface Props {
  open: boolean
  onClose: () => void
  solicitudItems: SolicitudItemSimple[]
  detalles: DetalleLineUI[]
  onConfirmar: (payload: Record<string, unknown>) => void
  pendingPayload: Record<string, unknown> | null
}

export function ReconciliacionModal({ open, onClose, solicitudItems, detalles, onConfirmar, pendingPayload }: Props) {
  if (!open || !pendingPayload) return null
  // Mover aquí el JSX completo del modal de reconciliación que actualmente
  // está como IIFE en nueva.tsx (el bloque {reconciliacionOpen && pendingConfirmarPayload && (() => {...})()})
  return (
    <Dialog open={open} onClose={onClose} title="Confirmar recepción">
      {/* JSX extraído de nueva.tsx */}
    </Dialog>
  )
}
```

**Nota:** Leer el JSX actual del modal en nueva.tsx y copiarlo aquí, adaptando las referencias a props.

- [ ] **Step 3: Crear `VincularSolicitudModal.tsx`**

```tsx
// frontend/src/pages/recepciones/components/VincularSolicitudModal.tsx
import { Dialog } from '@/components/ui/dialog'
import type { SolicitudResumen } from '@/types'

interface Props {
  open: boolean
  onClose: () => void
  solicitudes: SolicitudResumen[] | undefined
  solicitudIdActual: string | null
  onVincular: (id: string, numero: string) => void
  onDesvincular: () => void
}

export function VincularSolicitudModal({ open, onClose, solicitudes, solicitudIdActual, onVincular, onDesvincular }: Props) {
  if (!open) return null
  // Mover aquí el JSX del Dialog de solicitudModalOpen en nueva.tsx
  return (
    <Dialog open={open} onClose={onClose} title="Vincular Solicitud">
      {/* JSX extraído de nueva.tsx */}
    </Dialog>
  )
}
```

- [ ] **Step 4: Verificar TypeScript**

```bash
cd frontend && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/recepciones/components/ReconciliacionModal.tsx \
        frontend/src/pages/recepciones/components/VincularSolicitudModal.tsx
git commit -m "feat(recepciones): extraer ReconciliacionModal y VincularSolicitudModal"
```

---

## Task 12: Refactorizar `recepciones/nueva.tsx` como orquestador

**Files:**
- Modify: `frontend/src/pages/recepciones/nueva.tsx`
- Create: `frontend/src/pages/recepciones/steps/ProveedorStep.tsx`
- Create: `frontend/src/pages/recepciones/steps/ItemsStep.tsx`
- Create: `frontend/src/pages/recepciones/steps/ConfirmStep.tsx`

- [ ] **Step 1: Crear la carpeta de steps**

```bash
mkdir -p "frontend/src/pages/recepciones/steps"
```

- [ ] **Step 2: Crear `ProveedorStep.tsx`**

Extraer de `nueva.tsx` el JSX del paso 1 (selección de proveedor, guía de despacho, fecha, vincular solicitud):

```tsx
// frontend/src/pages/recepciones/steps/ProveedorStep.tsx
import type { RecepcionWizardReturn } from '../hooks/useRecepcionWizard'
import { ProveedorSelect } from '@/components/ui/proveedor-select'
import { VincularSolicitudModal } from '../components/VincularSolicitudModal'
import type { Proveedor } from '@/types'

interface Props {
  wizard: RecepcionWizardReturn
  proveedores: Proveedor[] | undefined
  onSiguiente: () => void
}

export function ProveedorStep({ wizard, proveedores, onSiguiente }: Props) {
  // JSX del paso 1 extraído de nueva.tsx
  // Incluye: ProveedorSelect, inputs de guia/fecha, botón Vincular Solicitud, botón Siguiente
  return (
    <div>
      {/* JSX extraído */}
      <VincularSolicitudModal
        open={wizard.solicitudModal.open}
        onClose={wizard.solicitudModal.onClose}
        solicitudes={wizard.solicitudesPendientes}
        solicitudIdActual={wizard.solicitudId}
        onVincular={(id, numero) => {
          wizard.setSolicitudId(id)
          wizard.setSolicitudNumero(numero)
          wizard.solicitudModal.onClose()
        }}
        onDesvincular={() => {
          wizard.setSolicitudId(null)
          wizard.setSolicitudNumero(null)
        }}
      />
    </div>
  )
}
```

- [ ] **Step 3: Crear `ItemsStep.tsx`**

Extraer el JSX del paso 2 (lista de ítems, ProductoAutocomplete, ScannerPanel):

```tsx
// frontend/src/pages/recepciones/steps/ItemsStep.tsx
import type { RecepcionWizardReturn } from '../hooks/useRecepcionWizard'
import type { RecepcionItemsReturn } from '../hooks/useRecepcionItems'
import { ReceptionItemCard } from '../components/item-card'
import { ProductoAutocomplete } from '../components/producto-autocomplete'
import { ScannerPanel } from '../components/scanner-panel'
import type { Producto } from '@/types'

interface Props {
  wizard: RecepcionWizardReturn
  items: RecepcionItemsReturn
  productos: Producto[] | undefined
}

export function ItemsStep({ wizard, items, productos }: Props) {
  // JSX del paso 2 extraído de nueva.tsx
  return (
    <div>
      {/* ProductoAutocomplete + ScannerPanel + lista de ReceptionItemCard */}
    </div>
  )
}
```

- [ ] **Step 4: Crear `ConfirmStep.tsx`**

Extraer el JSX del paso 3 (decisión completa/parcial/rechazada, motivos, nota, botón confirmar):

```tsx
// frontend/src/pages/recepciones/steps/ConfirmStep.tsx
import type { RecepcionWizardReturn } from '../hooks/useRecepcionWizard'
import type { RecepcionItemsReturn } from '../hooks/useRecepcionItems'
import { LabelsSection } from '../components/labels-section'

interface Props {
  wizard: RecepcionWizardReturn
  items: RecepcionItemsReturn
  monedaSimbolo: string
}

export function ConfirmStep({ wizard, items, monedaSimbolo }: Props) {
  // JSX del paso 3 extraído de nueva.tsx
  return (
    <div>
      {/* Decisión + motivos + nota + LabelsSection + botón confirmar */}
    </div>
  )
}
```

- [ ] **Step 5: Reemplazar el cuerpo de `nueva.tsx` como orquestador**

El resultado final de `nueva.tsx` debe quedar similar a:

```tsx
// frontend/src/pages/recepciones/nueva.tsx
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import api from '@/lib/api'
import type { Proveedor, Producto, Area } from '@/types'
import { useRecepcionWizard } from './hooks/useRecepcionWizard'
import { useRecepcionItems } from './hooks/useRecepcionItems'
import { ProveedorStep } from './steps/ProveedorStep'
import { ItemsStep } from './steps/ItemsStep'
import { ConfirmStep } from './steps/ConfirmStep'
import { ReconciliacionModal } from './components/ReconciliacionModal'
import { LabelsSection } from './components/labels-section'
import { ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'

const MOTIVOS_RECHAZO = [
  { id: 'temperatura', label: 'Cadena de frío rota' },
  { id: 'embalaje', label: 'Embalaje dañado' },
  { id: 'documentos', label: 'Documentos incorrectos' },
  { id: 'cantidad', label: 'Cantidad no coincide' },
  { id: 'no_solicitado', label: 'Producto no solicitado' },
]

export default function NuevaRecepcionPage() {
  const navigate = useNavigate()
  const wizard = useRecepcionWizard()

  const { data: areas } = useQuery({ queryKey: ['areas'], queryFn: () => api.get<Area[]>('/areas').then(r => r.data) })
  const { data: proveedores } = useQuery({ queryKey: ['proveedores'], queryFn: () => api.get<Proveedor[]>('/proveedores').then(r => r.data) })
  const { data: productos } = useQuery({
    queryKey: ['productos-recepcion', wizard.proveedorId],
    queryFn: () => api.get<{ data: Producto[] }>('/productos', {
      params: { per_page: 500, ...(wizard.proveedorId ? { proveedor_id: wizard.proveedorId } : {}) },
    }).then(r => r.data.data),
  })
  const { data: configuracion } = useQuery({
    queryKey: ['configuracion'],
    queryFn: () => api.get<{ moneda_simbolo: string }>('/configuracion').then(r => r.data),
  })
  const monedaSimbolo = configuracion?.moneda_simbolo ?? '$'

  const items = useRecepcionItems({
    proveedorId: wizard.proveedorId,
    proveedores,
    productos,
    areas,
    monedaSimbolo,
    solicitudId: wizard.solicitudId,
    setSolicitudId: wizard.setSolicitudId,
    solicitudNumero: wizard.solicitudNumero,
    guiaDespacho: wizard.guiaDespacho,
    guiaProvisoria: wizard.guiaProvisoria,
    fechaRecepcion: wizard.fechaRecepcion,
    decision: wizard.decision,
    motivosSeleccionados: wizard.motivosSeleccionados,
    motivoOtro: wizard.motivoOtro,
    nota: wizard.nota,
    setPasoActual: wizard.setPasoActual,
  })

  return (
    <div className="flex flex-col gap-4 p-4 max-w-4xl mx-auto">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate('/recepciones')} aria-label="Volver">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-xl font-bold">Nueva Recepción</h1>
      </div>

      {wizard.pasoActual === 1 && (
        <ProveedorStep
          wizard={wizard}
          proveedores={proveedores}
          onSiguiente={() => wizard.setPasoActual(2)}
        />
      )}
      {wizard.pasoActual === 2 && (
        <ItemsStep
          wizard={wizard}
          items={items}
          productos={productos}
        />
      )}
      {wizard.pasoActual === 3 && (
        <ConfirmStep
          wizard={wizard}
          items={items}
          monedaSimbolo={monedaSimbolo}
        />
      )}

      <ReconciliacionModal
        open={items.reconciliacionModal.open}
        onClose={items.reconciliacionModal.onClose}
        solicitudItems={items.solicitudItemsRef}
        detalles={items.detalles}
        pendingPayload={items.pendingConfirmarPayload}
        onConfirmar={(payload) => {
          items.setPendingConfirmarPayload(null)
          items.reconciliacionModal.onClose()
          items.confirmarMutation.mutate(payload)
        }}
      />

      {items.printModal.open && items.lotesConfirmados && (
        <LabelsSection
          lotes={items.lotesConfirmados}
          onClose={() => { items.printModal.onClose(); navigate('/recepciones') }}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 6: Verificar TypeScript**

```bash
cd frontend && npx tsc --noEmit
```

Corregir cualquier error de tipos que aparezca.

- [ ] **Step 7: Verificar flujo completo en app**

Abrir `http://localhost:5173/recepciones/nueva`. Verificar paso a paso:
1. Paso 1: seleccionar proveedor, ingresar guía de despacho, vincular solicitud (abrir/cerrar modal)
2. Paso 2: buscar y agregar producto, editar cantidades, escanear código
3. Paso 3: seleccionar decisión, agregar nota, confirmar recepción
4. Modal de impresión de etiquetas aparece post-confirmación
5. Modo experto persiste al recargar

- [ ] **Step 8: Commit final**

```bash
git add frontend/src/pages/recepciones/
git commit -m "refactor(recepciones): dividir nueva.tsx en hooks + steps — orquestador ~80 líneas"
```

---

## Verificación final

- [ ] **Contar líneas de archivos refactorizados**

```bash
wc -l frontend/src/pages/solicitudes-compra/index.tsx \
        frontend/src/pages/recepciones/nueva.tsx
```

Esperado: ambos bajo 200 líneas.

- [ ] **Verificar que no queda localStorage.getItem fuera de useLocalStorage.ts**

```bash
grep -r "localStorage.getItem" frontend/src --include="*.ts" --include="*.tsx" \
  | grep -v "useLocalStorage.ts" \
  | grep -v "solicitud-descartados" \
  | grep -v "solicitud_proveedor_id"
```

Los únicos `localStorage.getItem` restantes son los del patrón especial (descartados y proveedor_id) que no son boolean simples.

- [ ] **Verificar que no quedan clases `bg-amber-` hardcodeadas en pages/**

```bash
grep -r "bg-amber-\|text-amber-\|bg-yellow-" frontend/src/pages --include="*.tsx"
```

Esperado: sin resultados (o sólo en comentarios).

- [ ] **Commit de cierre**

```bash
git add -A
git commit -m "refactor(frontend): completar refactor de calidad — hooks, theme, componentes divididos"
```
