# Análisis y Plan de Implementación — Mejoras de Flujo

> **Estado**: Análisis completo  
> **Audiencia**: Implementación técnica  
> **Basado en**: Exploración exhaustiva del código base (Rust + React, PostgreSQL)

---

## Índice

1. [Resumen Ejecutivo](#1-resumen-ejecutivo)
2. [Problema 1: Estados de Carga Genéricos](#2-problema-1-estados-de-carga-genéricos)
3. [Problema 2: Cuarentena sin Atajo desde Recepción](#3-problema-2-cuarentena-sin-atajo-desde-recepción)
4. [Problema 3: Catálogos sin Acceso Directo desde Listas](#4-problema-3-catálogos-sin-acceso-directo-desde-listas)
5. [Problema 4: Fricción del Flujo de Cuarentena](#5-problema-4-fricción-del-flujo-de-cuarentena)
6. [Plan de Implementación Integrado](#6-plan-de-implementación-integrado)
7. [Puntos Débiles y Riesgos](#7-puntos-débiles-y-riesgos)
8. [Recomendaciones Finales](#8-recomendaciones-finales)

---

## 1. Resumen Ejecutivo

El sistema actual tiene 4 áreas de mejora identificadas que, aunque parecen independientes, comparten un núcleo común: **reducir la fricción entre detección de un producto nuevo y su aprobación final**.

| Área | Problema Central | Impacto |
|------|-----------------|---------|
| Carga visual | Spinners mudos en operaciones lentas (GS1 lookup, FDA cascade) | Usuario no sabe si algo anda mal o está procesando |
| Cuarentena ↔ Recepción | El recepcionista ve un badge "en cuarentena" pero no puede aprobar desde ahí | Cambio de contexto forzado a otra pantalla |
| Catálogos en listas | Categoria/unidad/área/proveedor son texto plano sin acciones | El usuario debe ir a otro tab para crear/editar algo que falta |
| Flujo de cuarentena | Producto en cuarentena no cuenta como inventario, bloquea consumo, está aislado | Complejidad innecesaria, fricción, datos invisibles |

El cambio más profundo y el que más valor aporta es la **refactorización del concepto `pendiente_aprobacion`** para que sea un estado liviano que no oculte stock ni bloquee consumo, combinado con atajos contextuales.

---

## 2. Problema 1: Estados de Carga Genéricos

### 2.1 Diagnóstico

Actualmente los estados de carga usan un spinner genérico de daisyUI con texto estático:

```
// PageLoading — genérico, no recibe descripción dinámica
<span className="loading loading-spinner loading-lg text-primary" />
<p className="text-sm opacity-50">Cargando...</p>

// BandejaCatalogacionTab:
<p className="text-sm opacity-50">Cargando bandeja de catalogación...</p>
```

**El problema**: En operaciones con múltiples etapas (especialmente escaneo GS1 con cascade a FDA/EUDAMED), el usuario ve un spinner genérico durante 3-10 segundos sin saber qué está pasando. Sospecha que la app se colgó.

### 2.2 Puntos Calientes Identificados

1. **Escaneo GS1 en recepción** — `useRecepcionItems.ts` + `recepcion-scan.ts`: cuando se escanea un código, puede pasar por:
   - Parseo GS1 local (inmediato)
   - Búsqueda en base local por GTIN (~200ms)
   - Cascade a FDA API (~2-5s)
   - Cascade a EUDAMED (~2-5s)
   - Auto-creación de producto en cuarentena (~300ms)

2. **Importación de guía PDF** — `ImportadorGuiaModal.tsx`: proceso batch puede crear múltiples productos

3. **Confirmación de recepción** — `recepcion_service.rs`: transacción pesada con múltiples inserts, upserts, y reconciliación

4. **Aprobación de cuarentena** — `POST /productos/{id}/approve`: puede incluir stock scaling si cambia factor de presentación

### 2.3 Solución Propuesta

Crear un sistema de **estados de carga progresivos** con mensajes descriptivos que cambien según la etapa:

```
┌─────────────────────────────────────┐
│  ⟳  Consultando base local...       │  → ~0-500ms
│                                     │
│  ⟳  Consultando catálogo global...  │  → ~500ms-3s
│                                     │
│  ⟳  Consultando FDA / EUDAMED...    │  → ~3-8s
│                                     │
│  ⟳  Creando registro...             │  → final
└─────────────────────────────────────┘
```

**Componentes a crear**:

```
src/
  components/
    ui/
      progress-loader.tsx         ← Nuevo: loader con etapas
      use-progress-stage.ts       ← Nuevo: hook de etapas con timing
```

#### `ProgressLoader` API

```tsx
interface ProgressStage {
  key: string
  label: string        // "Consultando base local"
  icon?: string        // icono opcional
  timeout?: number     // ms después del cual mostrar (default 200)
}

interface ProgressLoaderProps {
  stages: ProgressStage[]
  currentStage: string     // key del stage actual
  error?: string | null    // si hay error, muestra mensaje de falla
  estimatedTotal?: number  // ms totales estimados para barra opcional
}

// Uso típico:
<ProgressLoader
  stages={[
    { key: 'local', label: 'Consultando base local...' },
    { key: 'cascade', label: 'Consultando catálogo global...' },
    { key: 'regulatory', label: 'Consultando FDA / EUDAMED...' },
    { key: 'saving', label: 'Creando registro...' },
    { key: 'done', label: '¡Listo!', icon: 'check' },
  ]}
  currentStage={stage}
/>
```

#### `useProgressStage` Hook

Hook que maneja el timing y la transición automática de etapas:

```ts
function useProgressStage(stages: Stage[], options?: {
  onStageChange?: (key: string) => void
  minStageTime?: number    // tiempo mínimo por etapa (default 800ms)
}) => {
  currentStage: string
  start: () => void
  advance: () => void      // avanza manualmente
  done: () => void
  error: (msg: string) => void
  reset: () => void
}
```

### 2.4 Puntos de Integración

| Operación | Etapas | Archivos a modificar |
|-----------|--------|---------------------|
| Escaneo GS1 en recepción | `local → cascade → regulatory → saving → done` | `recepcion-scan.ts`, `useRecepcionItems.ts`, `scanner-panel.tsx` |
| Confirmar recepción | `validando → guardando → reconciliando → imprimiendo → done` | `useRecepcionItems.ts:confirmarMutation` |
| Importar guía PDF | `parseando → consultando productos → creando → done` | `ImportadorGuiaModal.tsx` |
| Aprobar producto cuarentena | `validando → escalando → actualizando → done` | `BandejaCatalogacionTab.tsx` |
| Escaneo lookup en consumos | `local → cascade → regulatory → done` | `consumos/index.tsx` |

---

## 3. Problema 2: Cuarentena sin Atajo desde Recepción

### 3.1 Diagnóstico

Cuando un recepcionista escanea un producto que resulta estar en cuarentena (`estado_catalogo = 'pendiente_aprobacion'`), el `item-card.tsx` muestra un badge `⚠️ En cuarentena (Pendiente de aprobación)`. Pero no hay ninguna acción disponible desde ahí.

El recepcionista debe:
1. Recordar que el producto existe
2. Navegar a `/creador-productos?tab=catalogacion`
3. Encontrar el producto en la lista
4. Aprobarlo manualmente
5. Volver a recepción

**Esto rompe el flujo de trabajo**. El recepcionista es quien tiene el producto físico en la mano y quien puede verificar los datos. Forzarlo a cambiar de contexto es una fricción evitable.

### 3.2 Solución Propuesta

Agregar un **botón de acción directa** en el `item-card.tsx` cuando el producto está en cuarentena:

```
┌─────────────────────────────────────┐
│  Producto: Alcohol 70°              │
│  ⚠️ Pendiente de revisión manual    │
│                                     │
│  [✔️ Aprobar y seguir]              │
│           ↑                         │
│      Nuevo botón directo            │
└─────────────────────────────────────┘
```

#### Backend

**Crear endpoint**: `POST /api/v1/productos/{id}/quick-approve`

```rust
// handlers/productos.rs — nuevo handler
async fn quick_approve_product(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<i32>,
) -> Result<Json<serde_json::Value>, AppError> {
    // Requiere admin O inventario (más permisivo que el approve completo)
    crate::auth::middleware::require_role(&["admin", "inventario"])(&claims)?;

    // Versión simplificada de approve_product:
    // 1. Cambia estado_catalogo → 'aprobado' SOLO si no requiere edición manual
    // 2. NO permite cambiar metadata (nombre, categoría, factor, etc.)
    // 3. Usa los valores por defecto que ya tenga el producto
    // 4. Si faltan datos REQUERIDOS (categoría, unidad_base), rechaza con error claro
    // 5. Retorna el producto aprobado
}
```

**Reglas de `quick-approve`**:
- Solo funciona si el producto tiene `categoria_id` y `unidad_base_id` (datos mínimos)
- Usa los valores existentes, no permite edición
- Si falta algo, retorna error `MISSING_REQUIRED_FIELDS` con detalle de qué falta
- Es más permisivo en roles (inventario puede aprobar, no solo admin)
- Audit log con acción `quick_approve`

#### Frontend

**Modificar** `item-card.tsx` (líneas 232-236):

```tsx
// Estado actual — solo badge:
{d.estado_catalogo === 'pendiente_aprobacion' && (
  <span className="...">⚠️ En cuarentena...</span>
)}

// Nuevo estado — badge + botón:
{d.estado_catalogo === 'pendiente_aprobacion' && (
  <div className="flex items-center gap-2">
    <span className="badge badge-sm badge-warning font-semibold gap-1 text-[10px]">
      ⏳ Pendiente de revisión manual
    </span>
    <button
      className="btn btn-ghost btn-xs text-success gap-1"
      onClick={() => handleQuickApprove(d)}
      disabled={quickApprovePending}
    >
      {quickApprovePending
        ? <span className="loading loading-spinner loading-xs" />
        : <Check className="h-3 w-3" />
      }
      Aprobar
    </button>
  </div>
)}
```

**Crear hook**: `useQuickApprove` en `useRecepcionItems.ts`:

```ts
const quickApproveMutation = useMutation({
  mutationFn: (productoId: number) => api.post(`/productos/${productoId}/quick-approve`),
  onSuccess: (_, productoId) => {
    // Actualiza el estado local del ítem inmediatamente (optimistic)
    updateItemEstadoCatalogo(productoId, 'aprobado')
    notify.success('Producto aprobado correctamente')
    // Opcional: invalidar quarantine list si alguien la tiene abierta
    qc.invalidateQueries({ queryKey: ['productos', 'quarantine'] })
  },
  onError: (err) => {
    notify.error(getErrorMessage(err))
  },
})
```

**Advertencia visual**: Si faltan datos (categoría, unidad base), el botón debe mostrar un tooltip con "Requiere configuración en Creador de Productos" y deshabilitarse.

### 3.3 Archivos a Modificar

| Archivo | Cambio |
|---------|--------|
| `backend/src/handlers/productos.rs` | Nuevo handler `quick_approve_product`, nueva ruta |
| `backend/src/services/producto_service.rs` | Nueva función `quick_approve_producto` |
| `backend/src/auth/middleware.rs` | (sin cambio, ya existe require_role) |
| `backend/src/errors.rs` | Posible nuevo error `MissingRequiredFields` |
| `backend/backend/tests/catalogacion_tests.rs` | Tests del nuevo endpoint |
| `frontend/src/pages/recepciones/components/item-card.tsx` | Botón "Aprobar" en card |
| `frontend/src/pages/recepciones/hooks/useRecepcionItems.ts` | `quickApproveMutation`, `updateItemEstadoCatalogo` |
| `frontend/src/api/catalogos.ts` | Nueva función `quickApproveProducto` |

---

## 4. Problema 3: Catálogos sin Acceso Directo desde Listas

### 4.1 Diagnóstico

En todas las listas del sistema (productos, movimientos, consumos, etc.), las columnas de catálogo (categoría, unidad base, área, proveedor) muestran **texto plano**. Ejemplo en `productos-tab.tsx`:

```tsx
// Línea 260: Categoría como texto
item.categoria?.nombre || '—'

// Línea 267: Proveedor como texto con icono
<ProveedorIcon ... /> {item.proveedor?.nombre}

// Línea 278: Área como badge
<Badge variant="secondary">{item.area?.nombre}</Badge>
```

Si el usuario necesita crear o editar una categoría porque no existe la que busca, debe:
1. Ir al tab de categorías
2. Crearla
3. Volver al tab de productos
4. Recargar y seleccionar

Esto rompe el flujo. Ya existe el patrón `"__new__"` en los selects del formulario de producto (líneas 1018-1028), pero no en las tablas de datos.

### 4.2 Solución Propuesta

Crear un componente **`CatalogLink`** que envuelva cualquier valor de catálogo y permita acciones inline:

```tsx
<CatalogLink
  type="categoria"           // | "unidad" | "area" | "proveedor"
  id={item.categoria?.id}
  name={item.categoria?.nombre || '—'}
  onRefresh={() => refetch()}   // callback post-create/edit/delete
/>
```

#### Comportamiento:

1. **Click**: abre un pequeño popover/dropdown con acciones:
   - ✏️ Editar "Nombre de la categoría"
   - 🗑️ Eliminar (con confirmación)
   - ➕ Nueva [categoría] (abre el formulario de creación)

2. **Popover autónomo**: no requiere Dialog, es un dropdown contextual con DaisyUI dropdown:

```
┌─ Categoría: Insumos ───────────────┐
│                                     │
│  [click]                            │
│     ┌───────────────────┐           │
│     │ ✏️ Editar         │           │
│     │ 🗑️ Eliminar       │           │
│     │ ───────────────── │           │
│     │ ➕ Nueva categoría│           │
│     └───────────────────┘           │
└─────────────────────────────────────┘
```

3. **Formularios inline**: editar y crear se abren en un mini-formulario dentro del mismo dropdown (para nombres cortos como categoría/unidad), o en un Dialog (para formularios complejos como proveedor).

#### Arquitectura del Componente

```
src/
  components/
    ui/
      catalog-link.tsx              ← Nuevo: componente principal
      catalog-link-editor.tsx       ← Nuevo: formulario inline para edición rápida
      catalog-link-creator.tsx      ← Nuevo: formulario inline para creación rápida
```

`catalog-link.tsx` se compone de:

```tsx
interface CatalogLinkProps {
  type: 'categoria' | 'unidad' | 'area' | 'proveedor'
  id?: number | null
  name: string
  onRefresh?: () => void     // callback después de mutaciones
  showActions?: ('edit' | 'delete' | 'create')[]
  variant?: 'text' | 'badge' | 'link'
}
```

#### Detalles Técnicos

1. **Cache invalidation**: después de crear/editar/eliminar desde el dropdown, debe invalidar las queries de TanStack Query apropiadas
2. **Optimistic updates**: el nombre debe actualizarse en el dropdown inmediatamente
3. **Lazy mutation calls**: usa los hooks existentes `useCrearCategoria`, `useActualizarCategoria`, etc. re-exportándolos fuera del tab de creador-productos para que sean accesibles globalmente
4. **Refetch automático**: el `onRefresh` permite propagar el cambio a la lista padre

#### Migración de Hooks

Actualmente los hooks CRUD de catálogos están en `useCatalogos.ts` (en `hooks/dominio/`), lo cual es correcto. Pero están acoplados al `staleTime: 5min` de las queries de lista. Para el dropdown rápido necesitamos:

```ts
// Hook de mutación sin staleTime, con invalidación agresiva
export function useQuickCrearCategoria(onSuccess?: () => void) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateCategoria) => api.post('/categorias', data),
    onSuccess: (result) => {
      // Invalidación inmediata
      qc.invalidateQueries({ queryKey: ['categorias'] })
      qc.invalidateQueries({ queryKey: ['productos'] })
      onSuccess?.()
    }
  })
}
```

#### Puntos de Integración (lista inicial)

| Componente | Tipo | Reemplazar texto por |
|-----------|------|---------------------|
| `productos-tab.tsx:260` | Categoría | `<CatalogLink type="categoria" .../>` |
| `productos-tab.tsx:267` | Proveedor | `<CatalogLink type="proveedor" .../>` |
| `productos-tab.tsx:278` | Área | `<CatalogLink type="area" .../>` |
| `productos-tab.tsx:285` | Unidad base | `<CatalogLink type="unidad" .../>` |
| `movimientos` / `consumos` | (cuando se implemente) | Misma mecánica |

### 4.3 Integración con Quick Create Existente

El `CreateProductoDialog` ya tiene `QuickCreateCategoria`, `QuickCreateUnidad`, `QuickCreateArea` (líneas 635-744). Esto es un patrón existente que podemos **reutilizar** como fallback cuando el usuario necesita crear un catálogo nuevo desde el dropdown.

El `CatalogLink` puede:
1. Si es **editar** con pocos campos (categoría: nombre + descripción) → inline en dropdown
2. Si es **crear** o editar complejo (proveedor: icono + contacto + tiempos) → abre Dialog o redirige al tab

---

## 5. Problema 4: Fricción del Flujo de Cuarentena

### 5.1 Diagnóstico Profundo

Este es el cambio más significativo y el que requiere más análisis. El flujo actual:

```
Producto creado automáticamente
  (API regulatoria / guía PDF)
         │
         ▼
  estado_catalogo = 'pendiente_aprobacion'
         │
         ├── Stock: OCULTO (filtrado en todas las queries)
         ├── Consumo: BLOQUEADO (error ProductInQuarantine)
         ├── Vista: SOLO en BandejaCatalogacionTab
         │
         ▼
  Admin aprueba → estado_catalogo = 'aprobado'
         │
         ├── Stock: VISIBLE inmediatamente
         ├── Consumo: PERMITIDO
         └── (opcional) Stock scaling si cambió factor
```

**Problemas identificados**:

1. **Ocultar stock es contraproducente**: El producto físico YA ESTÁ en el depósito. Ocultarlo del stock da una visión falsa de la realidad. El usuario no puede verlo ni trackearlo hasta que alguien lo apruebe.

2. **Bloquear consumo es problemático**: Si el producto es urgente y alguien necesita usarlo, no puede. La burocracia de aprobación retrasa la operación.

3. **Doble gestión**: Los productos en cuarentena requieren:
   - Tracking en el sistema (stock excluido)
   - Tracking físico (estante separado)
   - Aprobación manual
   - Liberación de stock post-aprobación
   
   Esto duplica la carga cognitiva y operativa sin beneficio claro.

4. **Rechazo = soft-delete**: Cuando se rechaza un producto, se pierde toda la historia. No hay estado `rechazado` en el CHECK constraint de la DB.

### 5.2 Solución Propuesta: "Pendiente de Revisión Manual" sin Bloqueo

Rebautizar el concepto de `pendiente_aprobacion` a un estado liviano que **no bloquee** la operativa normal pero sí **alerte** al usuario:

```
NUEVO FLUJO:

Producto creado automáticamente
  (API regulatoria / guía PDF)
         │
         ▼
  estado_catalogo = 'pendiente_revision'  ← renombrado
         │
         ├── Stock: VISIBLE (se cuenta como inventario real)
         ├── Consumo: PERMITIDO (con advertencia)
         ├── Badge: "⏳ Pendiente de revisión" (en todas partes)
         ├── En listas: aparece normalmente
         │
         ▼
  Usuario revisa (desde donde sea) → estado_catalogo = 'aprobado'
         │
         ├── Badge cambia a "✔️ Aprobado"
         ├── No hay stock scaling
         └── Audit log: revisado por {usuario}
```

### 5.3 Cambios Técnicos Detallados

#### 5.3.1 Base de Datos

```sql
-- Migration 010: Renombrar estado y relajar restricciones

-- 1. Nuevo valor del enum
ALTER TABLE productos 
  DROP CONSTRAINT productos_estado_catalogo_check;

ALTER TABLE productos
  ADD CONSTRAINT productos_estado_catalogo_check 
  CHECK (estado_catalogo IN ('pendiente_revision', 'aprobado', 'rechazado'));

-- NOTA: 'rechazado' es nuevo — permite rechazar sin perder el registro

-- 2. Actualizar vista de stock (YA NO FILTRAR por estado)
DROP VIEW IF EXISTS v_stock_por_producto_area;
CREATE VIEW v_stock_por_producto_area AS
SELECT ...  -- sin WHERE p.estado_catalogo = 'aprobado'
WHERE p.activo = true;
-- Los productos pendiente_revision y rechazados NO activos se excluyen igual
```

#### 5.3.2 Backend — Domain

```rust
// domain/estados.rs
pub enum EstadoCatalogo {
    PendienteRevision,  // renombrado
    Aprobado,
    Rechazado,          // nuevo
}
```

#### 5.3.3 Backend — Services

**`stock_service.rs`** — Eliminar filtros de `estado_catalogo`:

```rust
// ANTES (lineas 495, 992, 1011):
WHERE p.activo = true AND p.estado_catalogo = 'aprobado'

// DESPUÉS:
WHERE p.activo = true
```

**`consumo_service.rs`** — Relajar bloqueo a advertencia:

```rust
// ANTES (lineas 99-100):
if estado_catalogo == "pendiente_aprobacion" {
    return Err(AppError::ProductInQuarantine)
}

// DESPUÉS:
// - Permitir consumo
// - Agregar flag en la respuesta "pendiente_revision: true"
// - El frontend muestra advertencia
```

**`producto_service.rs`** — Actualizar `crear_producto`:

```rust
// Línea 344: default cambia
estado_catalogo: Some(crate::domain::EstadoCatalogo::Aprobado),

// Línea 1118: auto-creación API
estado_catalogo: Some(crate::domain::EstadoCatalogo::PendienteRevision),
```

#### 5.3.4 Backend — Endpoints Existentes

**`GET /productos/quarantine`** → renombrar a `GET /productos/pending-review`:

```rust
// handlers/productos.rs
// Cambiar query para usar el nuevo nombre de estado
async fn listar_pendientes_revision(...) {
    // SELECT * FROM productos WHERE estado_catalogo = 'pendiente_revision'
}
```

**`POST /productos/{id}/approve`** — Simplificar:

- Ya no necesita stock scaling (el stock siempre fue visible)
- Solo cambia el estado
- Audit log

**`POST /productos/{id}/reject`** — Cambiar a estado `rechazado` en vez de soft-delete:

```rust
// ANTES: eliminar_producto (soft-delete)
// DESPUÉS:
UPDATE productos SET estado_catalogo = 'rechazado', updated_at = NOW()
WHERE id = $1
```

**Nuevo: `POST /productos/{id}/reactivar-catalogo`** — Para reactivar un `rechazado`:

```rust
UPDATE productos SET estado_catalogo = 'pendiente_revision', activo = true
WHERE id = $1 AND estado_catalogo = 'rechazado'
```

#### 5.3.5 Frontend — Traducción de Componentes

| Componente Actual | Cambio |
|------------------|--------|
| `BandejaCatalogacionTab` | Renombrar a `BandejaRevisionTab`. El mismo componente, mismo endpoint renombrado |
| `estado-badge.tsx:10` | `pendiente_aprobacion` → `pendiente_revision` con `badge-warning` "Pend. revisión" |
| `estado-badge.tsx` | Nuevo: `rechazado` con `badge-error` "Rechazado" |
| `item-card.tsx:234` | Badge cambia texto + el nuevo botón "Aprobar y seguir" |
| `consumos/index.tsx:568-571` | Cambiar bloqueo por advertencia toast + confirmación extra |
| `ImportadorGuiaModal.tsx:182` | Usar nuevo estado en creación |
| `productos-tab.tsx:870-871` | Mantener detección de duplicados, actualizar texto |

#### 5.3.6 Consumo con Advertencia

```tsx
// En consumos/index.tsx — cuando producto tiene estado pendiente_revision:
const handleConsumeWithWarning = async (producto: Producto, cantidad: number) => {
  if (producto.estado_catalogo === 'pendiente_revision') {
    const confirmed = await confirmDialog({
      title: 'Producto pendiente de revisión',
      message: 'Este producto aún no fue revisado en el catálogo. ¿Confirmás el consumo igual?',
      variant: 'warning',
      confirmLabel: 'Consumir igual',
    })
    if (!confirmed) return
  }
  // proceder con el consumo normal
}
```

### 5.4 Integración en el Creador de Productos

La bandeja de revisión (ex-cuarentena) se mantiene como tab en el creador de productos, pero **los productos pendientes también aparecen en el listado general de productos** con un badge distintivo. Esto permite:

1. Ver todos los productos en un solo lugar
2. Aprobar desde el listado general (acción inline)
3. Editar metadata desde el listado general (ya existe)

```
┌────────────────────────────────────────────────┐
│ Productos                         Buscar... 🔍 │
├──────────┬──────────┬──────────┬───────────────┤
│ Producto │ Categoría│ Estado   │ Acciones      │
├──────────┼──────────┼──────────┼───────────────┤
│ Alcohol  │ Insumos  │ ⏳ Pend. │ [✔️] [✏️] [🗑️]│
│         │          │ revisión │                │
├──────────┼──────────┼──────────┼───────────────┤
│ Jeringa  │ Descart. │ ✅ Activo│ [✏️] [🗑️]     │
└──────────┴──────────┴──────────┴───────────────┘
```

La acción inline de aprobar (`✔️`) en la tabla de productos usa el mismo `quick-approve` que el botón en recepción.

### 5.5 Archivos a Modificar (Resumen)

| Archivo | Cambio |
|---------|--------|
| `backend/migrations/010_revision_estado.sql` | (NUEVO) Renombrar, agregar `rechazado`, actualizar vista |
| `backend/src/domain/estados.rs` | Renombrar enum variants |
| `backend/src/errors.rs` | Opcional: eliminar `ProductInQuarantine`, reemplazar por `ProductInRevision` |
| `backend/src/services/producto_service.rs` | Default Aprobado, auto-creación PendienteRevision |
| `backend/src/services/stock_service.rs` | Eliminar filtro `estado_catalogo = 'aprobado'` |
| `backend/src/services/consumo_service.rs` | Relajar bloqueo |
| `backend/src/services/whatsapp_service.rs:350` | Eliminar filtro |
| `backend/src/handlers/productos.rs` | Renombrar ruta quarantine, nuevo quick-approve, reject a estado |
| `backend/src/handlers/recepciones.rs` | (sin cambio, usa el proceso de aprobación) |
| `backend/tests/catalogacion_tests.rs` | Actualizar tests con nuevo estado y comportamiento |
| `frontend/src/api/catalogos.ts` | Renombrar funciones, agregar quick-approve |
| `frontend/src/hooks/dominio/useCatalogos.ts` | Renombrar hooks |
| `frontend/src/pages/creador-productos/BandejaCatalogacionTab.tsx` | Renombrar, actualizar copy |
| `frontend/src/pages/creador-productos/index.tsx` | Renombrar tab |
| `frontend/src/pages/creador-productos/productos-tab.tsx` | Agregar acción inline de aprobar |
| `frontend/src/components/ui/estado-badge.tsx` | Nuevos estados |
| `frontend/src/pages/recepciones/components/item-card.tsx` | Botón quick-approve |
| `frontend/src/pages/consumos/index.tsx` | Advertencia en vez de bloqueo |
| `frontend/src/components/shared/ImportadorGuiaModal.tsx` | Nuevo estado |
| `frontend/src/types/generated.ts` | Regenerar tipos |

---

## 6. Plan de Implementación Integrado

### 6.1 Dependencias y Orden

Los 4 problemas NO son independientes. El orden correcto es:

```
Fase 0: Base (Problema 4) → refactorizar cuarentena primero
  ↓
Fase 1: Quick-approve desde recepción (Problema 2)
  ↓
Fase 2: CatalogLink en listas (Problema 3)
  ↓
Fase 3: ProgressLoader (Problema 1) — se integra en todo lo anterior
```

**Razón**: El problema 4 (cuarentena) cambia el modelo de datos y la semántica. Si lo hacemos primero, todo lo demás se construye sobre el nuevo concepto. Hacerlo al revés obligaría a refactorizar dos veces.

### 6.2 Fase 0 — Refactorización de Cuarentena (Problema 4)

**Estimación**: 3-4 días

#### Día 1: Base de datos y backend core

| # | Tarea | Archivos | Depende de |
|---|-------|----------|------------|
| 0.1 | Migration SQL: renombrar estado, agregar `rechazado`, actualizar vista | `migrations/010_*.sql` | — |
| 0.2 | Actualizar enum `EstadoCatalogo` en Rust | `domain/estados.rs` | 0.1 |
| 0.3 | Actualizar `crear_producto` default y auto-creación | `producto_service.rs` | 0.2 |
| 0.4 | Eliminar filtros `estado_catalogo = 'aprobado'` en stock service | `stock_service.rs` (3 lugares) | 0.1 |
| 0.5 | Relajar bloqueo en consumo service | `consumo_service.rs` | 0.2 |
| 0.6 | Eliminar filtro en WhatsApp service | `whatsapp_service.rs` | 0.1 |

#### Día 2: Backend endpoints

| # | Tarea | Archivos | Depende de |
|---|-------|----------|------------|
| 0.7 | Renombrar/quarantine a /pending-review | `handlers/productos.rs` | 0.2 |
| 0.8 | Cambiar reject a estado `rechazado` (no soft-delete) | `handlers/productos.rs` | 0.1 |
| 0.9 | Nuevo handler `quick_approve_product` | `handlers/productos.rs` | 0.7 |
| 0.10 | Nuevo handler `reactivar_catalogo` | `handlers/productos.rs` | 0.8 |
| 0.11 | Tests: actualizar suite de catalogación | `tests/catalogacion_tests.rs` | 0.1-0.10 |

#### Día 3: Frontend — Estados y traducción

| # | Tarea | Archivos | Depende de |
|---|-------|----------|------------|
| 0.12 | Regenerar tipos TypeScript | `types/generated.ts` | 0.1-0.2 |
| 0.13 | Actualizar `estado-badge.tsx` con nuevos estados | `components/ui/estado-badge.tsx` | 0.12 |
| 0.14 | Renombrar `BandejaCatalogacionTab` → `BandejaRevisionTab` | `creador-productos/*` | 0.13 |
| 0.15 | Actualizar API calls y hooks | `api/catalogos.ts`, `hooks/dominio/useCatalogos.ts` | 0.12 |
| 0.16 | Actualizar advertencia en consumo (de bloqueo a confirm) | `consumos/index.tsx` | 0.5 |
| 0.17 | Actualizar ImportadorGuiaModal con nuevo estado | `ImportadorGuiaModal.tsx` | 0.13 |

#### Día 4: Frontend — Aprobación inline

| # | Tarea | Archivos | Depende de |
|---|-------|----------|------------|
| 0.18 | Agregar acción de aprobar en tabla de productos | `productos-tab.tsx` | 0.9 |
| 0.19 | Filtrar productos rechazados con opción "ver rechazados" | `productos-tab.tsx` | 0.8 |

### 6.3 Fase 1 — Quick-Approve desde Recepción (Problema 2)

**Estimación**: 1 día

| # | Tarea | Archivos | Depende de |
|---|-------|----------|------------|
| 1.1 | Botón "Aprobar" en item-card cuando `pendiente_revision` | `item-card.tsx` | 0.9 (backend) |
| 1.2 | Hook `useQuickApprove` en wizard de recepción | `useRecepcionItems.ts` | 0.9 |
| 1.3 | API function `quickApproveProducto` | `api/catalogos.ts` | 0.9 |
| 1.4 | Optimistic update + notificación toast | `useRecepcionItems.ts` | 1.2 |
| 1.5 | Tooltip de advertencia cuando faltan datos | `item-card.tsx` | 0.9 |

### 6.4 Fase 2 — CatalogLink en Listas (Problema 3)

**Estimación**: 2-3 días

| # | Tarea | Archivos | Depende de |
|---|-------|----------|------------|
| 2.1 | Componente `CatalogLink` con popover contextual | `components/ui/catalog-link.tsx` | — |
| 2.2 | Componente `CatalogLinkEditor` (edición inline) | `components/ui/catalog-link-editor.tsx` | 2.1 |
| 2.3 | Componente `CatalogLinkCreator` (creación inline) | `components/ui/catalog-link-creator.tsx` | 2.1 |
| 2.4 | Hooks de mutación rápida (sin staleTime) para catálogos | `hooks/dominio/useCatalogos.ts` (extender) | 2.1 |
| 2.5 | Integrar en tabla de productos: categoría | `productos-tab.tsx:260` | 2.1 |
| 2.6 | Integrar en tabla de productos: proveedor | `productos-tab.tsx:267` | 2.1 |
| 2.7 | Integrar en tabla de productos: área | `productos-tab.tsx:278` | 2.1 |
| 2.8 | Integrar en tabla de productos: unidad base | `productos-tab.tsx:285` | 2.1 |
| 2.9 | Integrar en otros listados (stock, consumos, movimientos) | Según se identifique | 2.1 |

### 6.5 Fase 3 — ProgressLoader (Problema 1)

**Estimación**: 2 días

| # | Tarea | Archivos | Depende de |
|---|-------|----------|------------|
| 3.1 | Componente `ProgressLoader` con stages y timing | `components/ui/progress-loader.tsx` | — |
| 3.2 | Hook `useProgressStage` con transiciones automáticas | `hooks/use-progress-stage.ts` | — |
| 3.3 | Integrar en escaneo GS1 de recepción | `recepcion-scan.ts`, `scanner-panel.tsx` | 3.1, 3.2 |
| 3.4 | Integrar en confirmación de recepción | `useRecepcionItems.ts` | 3.1, 3.2 |
| 3.5 | Integrar en importación de guía PDF | `ImportadorGuiaModal.tsx` | 3.1, 3.2 |
| 3.6 | Integrar en aprobación de producto | `BandejaRevisionTab.tsx` + `item-card.tsx` | 3.1, 3.2 |
| 3.7 | Integrar en escaneo de consumo | `consumos/index.tsx` | 3.1, 3.2 |

---

## 7. Puntos Débiles y Riesgos

### 7.1 Riesgos Técnicos

| Riesgo | Severidad | Mitigación |
|--------|-----------|------------|
| **Stock duplicado**: Si productos en `pendiente_revision` ahora son visibles, puede haber stock duplicado si el usuario crea el mismo producto manualmente después | **ALTA** | Reforzar detección de duplicados en el creador de productos (ya existe para GTIN, extender a nombre + fabricante). No permitir crear duplicado si existe pendiente/aprobado |
| **Consumo sin revisión**: Producto con datos incorrectos (nombre mal tipeado, categoría incorrecta) se consume y afecta reportes | **MEDIA** | El badge de "Pend. revisión" es visible. El consumo muestra confirmación extra. El reporte debe poder filtrar por estado |
| **Rechazo con historial**: Si rechazamos un producto, ya no se puede consumir, pero existía stock de recepciones anteriores | **ALTA** | El rechazo debe dejar el stock congelado (no eliminarlo). El producto `rechazado` con stock > 0 debe ser notificado. La reactivación debe restaurar el stock automáticamente |
| **Cache de TanStack Query**: Hooks con staleTime 5min no reflejarán cambios rápidos (quick-approve) | **BAJA** | Usar `invalidateQueries` agresivo en todas las mutaciones. Para CatalogLink, invalidar queries padre también |
| **Rendimiento de vista de stock**: Si eliminamos el filtro `WHERE p.estado_catalogo = 'aprobado'`, productos pendientes entran en la vista | **BAJA** | La vista se mantiene igual, solo más inclusiva. Si hay performance issues, agregar índice compuesto en `(activo, estado_catalogo)` |

### 7.2 Riesgos de UX

| Riesgo | Severidad | Mitigación |
|--------|-----------|------------|
| **Usuario no distingue** productos revisados de no revisados | **MEDIA** | Badge visible en todas las listas. Columna de estado al inicio de la tabla. Color warning distintivo |
| **Aprobación accidental** desde recepción (producto con datos incorrectos) | **MEDIA** | El `quick-approve` requiere campos mínimos. Si falta categoría, se deshabilita. Tooltip explainer |
| **CatalogLink demasiado pequeño** en UI móvil | **BAJA** | En mobile, mostrar como badge clickeable más grande o usar Sheet en vez de dropdown |
| **ProgressLoader molesto** en operaciones rápidas | **BAJA** | No mostrar si < 400ms. Transiciones suaves. No bloquear input (overlay no modal) |

### 7.3 Puntos Débiles de la Propuesta

1. **Pérdida del concepto "estante de cuarentena"**: Actualmente los productos auto-creados tienen `ubicacion: "Estantería de cuarentena"`. Al eliminar el bloqueo, esta ubicación pierde sentido. Solución: reemplazar por `ubicacion: "Pendiente de clasificar"` o permitir que el recepcionista asigne la ubicación real al aprobar.

2. **Inconsistencia transaccional**: Si un producto está `pendiente_revision` y se consumen 10 unidades, luego se aprueba con un `pres_factor` diferente, la recálculo no afecta al consumo ya registrado. Solución: el `quick-approve` no permite cambiar `pres_factor`. El approve completo (solo admin) sí, pero debe mostrar una advertencia clara de que los consumos previos no se recalculan.

3. **WhatsApp y reportes**: Productos `pendiente_revision` ahora aparecen en consultas de WhatsApp. Esto puede ser deseable (stock real) o no deseable (datos no verificados). Solución: agregar un flag en las queries de WhatsApp (`incluir_pendientes`) default false, con toggle en la UI de WhatsApp.

---

## 8. Recomendaciones Finales

### 8.1 Prioridad de Implementación

**Hacer primero (Fase 0)**: La refactorización de cuarentena es la base. Sin esto, los otros cambios son parches sobre un modelo con fricción.

**Hacer después (Fase 1+2)**: Quick-approve y CatalogLink añaden valor inmediato una vez que el modelo está limpio. Son cambios puramente frontend (excepto el endpoint de quick-approve que ya está en Fase 0).

**Terminar (Fase 3)**: ProgressLoader es el pulido final. Mejora la percepción de velocidad pero no cambia la funcionalidad. Hacerlo al final evita refactorizar los loaders si los componentes cambian en fases anteriores.

### 8.2 Resumen de Archivos Nuevos

```
frontend/src/components/ui/
  ├── progress-loader.tsx           ← NUEVO (Fase 3)
  ├── catalog-link.tsx              ← NUEVO (Fase 2)
  ├── catalog-link-editor.tsx       ← NUEVO (Fase 2)
  └── catalog-link-creator.tsx      ← NUEVO (Fase 2)

frontend/src/hooks/
  └── use-progress-stage.ts         ← NUEVO (Fase 3)

backend/src/migrations/
  └── 010_revision_estado.sql       ← NUEVO (Fase 0)
```

### 8.3 Métricas de Éxito

| Indicador | Antes | Después (esperado) |
|-----------|-------|-------------------|
| Tiempo recepción → stock visible | Horas/días (esperar aprobación) | Inmediato |
| Pasos para aprobar desde recepción | 5+ (cambio de contexto) | 1 click |
| Pasos para crear catálogo desde lista | 3+ (navegar tabs) | 1 click (dropdown) |
| Feedback durante escaneo lento | Spinner genérico (el usuario duda) | Texto progresivo (el usuario sabe) |
| Productos rechazados visibles | No (soft-delete) | Sí (con estado `rechazado`) |

### 8.4 Decisión Arquitectónica Clave

La decisión más importante es **si `pendiente_revision` oculta stock o no**. Mi recomendación es **NO ocultarlo**, porque:

1. El stock físico existe independientemente del estado del catálogo
2. Ocultarlo da una visión falsa del inventario
3. El costo de la aprobación manual no debería ser la invisibilidad
4. El badge de advertencia + confirmación extra en consumo es suficiente control

Si el equipo decide mantener el bloqueo por razones regulatorias/calidad, entonces la recomendación cambia a:
- Mantener invisible pero agregar un contador "X productos en revisión" en el header de stock
- Agregar una vista "Stock total (incluyendo no revisado)" para el administrador
- El quick-approve desde recepción es aún más crítico en este escenario

---

*Documento generado a partir de análisis exhaustivo del código base. Para implementar, seguir el orden de fases indicado.*
