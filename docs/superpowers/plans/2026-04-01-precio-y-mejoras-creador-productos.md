# Precio de Insumos + Mejoras Creador de Productos — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar `precio_unidad` a productos, arreglar el crash del Dialog, y mejorar el formulario de creador-productos con campos de precio, stock_minimo, y mejoras menores.

**Architecture:** Un solo precio de referencia `precio_unidad` en `productos`; precio por presentación siempre calculado (`precio_unidad × factor_conversion`). La recepción registra `costo_unitario` en el lote y actualiza el precio de referencia del producto al confirmar.

**Tech Stack:** Rust/Axum/SQLx (backend), React/TypeScript/TanStack Query/Tailwind+DaisyUI (frontend), PostgreSQL.

**Spec de referencia:** `docs/superpowers/specs/2026-04-01-precio-y-mejoras-creador-productos-design.md`

---

## Mapa de archivos

| Archivo | Cambio |
|---------|--------|
| `backend/migrations/028_precio_unidad.sql` | NUEVO — `ALTER TABLE productos ADD COLUMN precio_unidad` |
| `backend/src/models/producto.rs` | +`precio_unidad: Option<Decimal>` al struct |
| `backend/src/services/producto_service.rs` | INSERT + UPDATE + JSON build con precio_unidad |
| `backend/src/handlers/productos.rs` | DTOs CreateProducto + UpdateProducto + handler calls |
| `backend/src/handlers/recepciones.rs` | confirmar_borrador: sync precio a productos |
| `frontend/src/components/ui/dialog.tsx` | fix: `{open && children}` |
| `frontend/src/App.tsx` | mover import AuditLogPage al bloque de imports |
| `frontend/src/types/index.ts` | Producto + CreateProducto + UpdateProducto + Lote |
| `frontend/src/pages/creador-productos/productos-tab.tsx` | precio + stock_minimo en Create/Edit/Detail |
| `frontend/src/pages/recepciones/nueva.tsx` | campo costo_unitario por línea |

---

## Task 1: Migración — ADD COLUMN precio_unidad

**Files:**
- Create: `backend/migrations/028_precio_unidad.sql`

- [ ] **Step 1: Crear el archivo de migración**

```sql
-- backend/migrations/028_precio_unidad.sql
ALTER TABLE productos ADD COLUMN precio_unidad DECIMAL(12,4);
-- NULL significa sin precio definido
```

- [ ] **Step 2: Aplicar la migración en la base de datos**

```bash
# Ejecutar desde el directorio del proyecto
sqlx migrate run --database-url "$DATABASE_URL"
```

Expected: `Applied 1 migration` sin errores.

- [ ] **Step 3: Verificar columna en psql**

```bash
psql "$DATABASE_URL" -c "\d productos" | grep precio
```

Expected: `precio_unidad | numeric(12,4) | | |`

- [ ] **Step 4: Commit**

```bash
git add backend/migrations/028_precio_unidad.sql
git commit -m "feat(db): add precio_unidad to productos table"
```

---

## Task 2: Backend — Modelo Producto

**Files:**
- Modify: `backend/src/models/producto.rs`

- [ ] **Step 1: Agregar campo al struct**

Archivo actual `backend/src/models/producto.rs`, añadir `precio_unidad` después de `stock_minimo`:

```rust
use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::Serialize;
use uuid::Uuid;

#[derive(Debug, Serialize, sqlx::FromRow, specta::Type)]
pub struct Producto {
    pub id: Uuid,
    pub codigo_interno: String,
    pub nombre: String,
    pub descripcion: Option<String>,
    pub categoria_id: Option<i32>,
    pub unidad_base_id: i32,
    pub proveedor_id: Option<i32>,
    pub codigo_proveedor: Option<String>,
    pub codigo_maestro: Option<String>,
    pub stock_minimo: Decimal,
    pub precio_unidad: Option<Decimal>,
    pub activo: bool,
    pub version: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}
```

- [ ] **Step 2: Verificar que compila**

```bash
cd backend && cargo check 2>&1 | head -40
```

Expected: sin errores relacionados a `Producto`.

- [ ] **Step 3: Commit**

```bash
git add backend/src/models/producto.rs
git commit -m "feat(model): add precio_unidad to Producto struct"
```

---

## Task 3: Backend — producto_service.rs

**Files:**
- Modify: `backend/src/services/producto_service.rs`

### 3a: `crear_producto` — agregar parámetro y actualizar INSERT

- [ ] **Step 1: Agregar parámetro `precio_unidad` a la firma**

Cambiar la firma de `crear_producto` (después de `stock_minimo`):

```rust
pub async fn crear_producto(
    pool: &PgPool,
    nombre: String,
    descripcion: Option<String>,
    categoria_id: Option<i32>,
    unidad_base_id: i32,
    proveedor_id: Option<i32>,
    codigo_proveedor: Option<String>,
    codigo_maestro: Option<String>,
    stock_minimo: Option<Decimal>,
    precio_unidad: Option<Decimal>,          // ← nuevo
    presentaciones: Option<Vec<crate::handlers::productos::CreatePresentacionInline>>,
    area_ids: Option<Vec<i32>>,
    usuario_id: Uuid,
) -> Result<Producto, AppError> {
```

- [ ] **Step 2: Actualizar la query INSERT**

Reemplazar la query INSERT (líneas ~34-54) con:

```rust
        let producto = sqlx::query_as::<_, Producto>(
            r#"INSERT INTO productos (codigo_interno, nombre, descripcion, categoria_id, unidad_base_id, proveedor_id, codigo_proveedor, codigo_maestro, stock_minimo, precio_unidad)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *"#,
        )
        .bind(&codigo)
        .bind(&nombre)
        .bind(&descripcion)
        .bind(categoria_id)
        .bind(unidad_base_id)
        .bind(proveedor_id)
        .bind(&codigo_proveedor)
        .bind(&codigo_maestro)
        .bind(stock_minimo.unwrap_or(Decimal::ZERO))
        .bind(precio_unidad)
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| match &e {
            sqlx::Error::Database(db_err) if db_err.is_foreign_key_violation() => {
                AppError::Validation("Categoría, unidad, proveedor o área no existe".into())
            }
            _ => e.into(),
        })?;
```

### 3b: `actualizar_producto` — agregar parámetro y actualizar UPDATE

- [ ] **Step 3: Agregar parámetro `precio_unidad` a la firma de `actualizar_producto`**

```rust
pub async fn actualizar_producto(
    pool: &PgPool,
    id: Uuid,
    nombre: String,
    descripcion: Option<String>,
    categoria_id: Option<i32>,
    proveedor_id: Option<i32>,
    codigo_proveedor: Option<String>,
    codigo_maestro: Option<String>,
    stock_minimo: Option<Decimal>,
    precio_unidad: Option<Decimal>,          // ← nuevo
    area_ids: Option<Vec<i32>>,
    version_esperada: i32,
    usuario_id: Uuid,
) -> Result<Producto, AppError> {
```

- [ ] **Step 4: Actualizar la query UPDATE**

Reemplazar la query UPDATE (líneas ~195-214) con:

```rust
        let producto = sqlx::query_as::<_, Producto>(
            r#"UPDATE productos
               SET nombre = $1, descripcion = $2, categoria_id = $3, proveedor_id = $4, stock_minimo = $5,
                   codigo_proveedor = $6, codigo_maestro = $7, precio_unidad = $8,
                   version = version + 1, updated_at = NOW()
               WHERE id = $9 AND version = $10
               RETURNING *"#,
        )
        .bind(nombre)
        .bind(descripcion)
        .bind(categoria_id)
        .bind(proveedor_id)
        .bind(stock_minimo.unwrap_or(anterior.stock_minimo))
        .bind(codigo_proveedor)
        .bind(codigo_maestro)
        .bind(precio_unidad)
        .bind(id)
        .bind(version_esperada)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or(AppError::Conflict("Error de concurrencia al actualizar".into()))?;
```

### 3c: `obtener_detalle` — incluir precio_unidad en JSON

- [ ] **Step 5: Agregar `precio_unidad` al json_build_object**

En la query de `obtener_detalle`, agregar `'precio_unidad', p.precio_unidad` al JSON. La sección del SELECT debe quedar así (agregar la línea después de `'stock_minimo'`):

```sql
'stock_minimo',    p.stock_minimo,
'precio_unidad',   p.precio_unidad,
'activo',          p.activo,
```

- [ ] **Step 6: Verificar que compila**

```bash
cd backend && cargo check 2>&1 | head -40
```

Expected: sin errores en `producto_service.rs`.

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/producto_service.rs
git commit -m "feat(service): thread precio_unidad through crear/actualizar/obtener_detalle"
```

---

## Task 4: Backend — handlers/productos.rs

**Files:**
- Modify: `backend/src/handlers/productos.rs`

- [ ] **Step 1: Agregar `precio_unidad` al DTO `CreateProducto`**

```rust
#[derive(Debug, Deserialize, specta::Type)]
struct CreateProducto {
    nombre: String,
    descripcion: Option<String>,
    categoria_id: Option<i32>,
    unidad_base_id: i32,
    proveedor_id: Option<i32>,
    codigo_proveedor: Option<String>,
    codigo_maestro: Option<String>,
    stock_minimo: Option<Decimal>,
    precio_unidad: Option<Decimal>,          // ← nuevo
    presentaciones: Option<Vec<CreatePresentacionInline>>,
    area_ids: Option<Vec<i32>>,
}
```

- [ ] **Step 2: Agregar `precio_unidad` al DTO `UpdateProducto`**

```rust
#[derive(Debug, Deserialize)]
struct UpdateProducto {
    nombre: Option<String>,
    descripcion: Option<String>,
    categoria_id: Option<i32>,
    proveedor_id: Option<i32>,
    codigo_proveedor: Option<String>,
    codigo_maestro: Option<String>,
    stock_minimo: Option<Decimal>,
    precio_unidad: Option<Decimal>,          // ← nuevo
    area_ids: Option<Vec<i32>>,
    version: i32,
}
```

- [ ] **Step 3: Pasar `precio_unidad` en la llamada al service en handler `crear`**

Reemplazar la llamada a `ProductoService::crear_producto` en el handler `crear` (líneas ~281-294):

```rust
    let producto = ProductoService::crear_producto(
        &state.pool,
        nombre,
        req.descripcion,
        req.categoria_id,
        req.unidad_base_id,
        req.proveedor_id,
        req.codigo_proveedor,
        req.codigo_maestro,
        req.stock_minimo,
        req.precio_unidad,                   // ← nuevo
        req.presentaciones,
        req.area_ids,
        claims.sub,
    ).await?;
```

- [ ] **Step 4: Pasar `precio_unidad` en la llamada al service en handler `actualizar`**

Reemplazar la llamada a `ProductoService::actualizar_producto` en el handler `actualizar` (líneas ~319-332):

```rust
    let producto = ProductoService::actualizar_producto(
        &state.pool,
        id,
        nombre.to_string(),
        req.descripcion,
        req.categoria_id,
        req.proveedor_id,
        req.codigo_proveedor,
        req.codigo_maestro,
        req.stock_minimo,
        req.precio_unidad,                   // ← nuevo
        req.area_ids,
        req.version,
        claims.sub,
    ).await?;
```

- [ ] **Step 5: Verificar que compila**

```bash
cd backend && cargo check 2>&1 | head -40
```

Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add backend/src/handlers/productos.rs
git commit -m "feat(handler): add precio_unidad to CreateProducto/UpdateProducto DTOs"
```

---

## Task 5: Backend — Sync precio desde recepción

**Files:**
- Modify: `backend/src/handlers/recepciones.rs`

Cuando se confirma una recepción, si el lote registró `costo_unitario`, ese valor se copia a `productos.precio_unidad` como nuevo precio de referencia. Se hace al final del loop de líneas, justo antes del `UPDATE recepciones SET estado = 'completa'`.

- [ ] **Step 1: Ampliar `DetalleLine` para incluir `costo_unitario` del lote**

En `confirmar_borrador`, ampliar el struct `DetalleLine` y la query que obtiene el detalle:

```rust
    #[derive(sqlx::FromRow)]
    struct DetalleLine {
        producto_id: Uuid,
        lote_id: Uuid,
        area_destino_id: i32,
        cantidad_unidades_base: Decimal,
        costo_unitario: Option<Decimal>,     // ← nuevo
    }

    let mut lineas = sqlx::query_as::<_, DetalleLine>(
        r#"SELECT rd.producto_id, rd.lote_id, rd.area_destino_id, rd.cantidad_unidades_base,
                  l.costo_unitario
           FROM recepcion_detalle rd
           JOIN lotes l ON l.id = rd.lote_id
           WHERE rd.recepcion_id = $1"#,
    )
    .bind(id)
    .fetch_all(&mut *tx)
    .await?;
```

- [ ] **Step 2: Actualizar `productos.precio_unidad` en el loop**

Dentro del for loop `for linea in &lineas { ... }`, agregar este bloque después de `auto-populate producto_area`:

```rust
        // Actualizar precio de referencia si el lote tiene costo
        if let Some(costo) = linea.costo_unitario {
            sqlx::query(
                "UPDATE productos SET precio_unidad = $1 WHERE id = $2",
            )
            .bind(costo)
            .bind(linea.producto_id)
            .execute(&mut *tx)
            .await?;
        }
```

- [ ] **Step 3: Verificar que compila**

```bash
cd backend && cargo check 2>&1 | head -40
```

Expected: sin errores.

- [ ] **Step 4: Build completo para asegurar que no hay warnings fatales**

```bash
cd backend && cargo build 2>&1 | tail -20
```

Expected: `Compiling inventario_backend ...` → `Finished`

- [ ] **Step 5: Commit**

```bash
git add backend/src/handlers/recepciones.rs
git commit -m "feat(recepciones): sync precio_unidad to productos on borrador confirmation"
```

---

## Task 6: Frontend — Fix Dialog lazy children (crash fix)

**Files:**
- Modify: `frontend/src/components/ui/dialog.tsx`

**Este es el fix del crash en `/creador-productos`.** El Dialog renderiza sus `{children}` siempre, incluso con `open={false}`, montando los 5 tabs de catálogo al cargar la página y causando renders problemáticos.

- [ ] **Step 1: Cambiar `{children}` a `{open && children}` en dialog.tsx**

Archivo actual `frontend/src/components/ui/dialog.tsx`:

```tsx
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useEffect, useRef } from 'react'

interface DialogProps {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  className?: string
}

export function Dialog({ open, onClose, title, children, className }: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={dialogRef}
      className={cn('modal', open && 'modal-open')}
      onClose={onClose}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className={cn('modal-box max-w-lg', className)}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold">{title}</h3>
          <button onClick={onClose} className="btn btn-ghost btn-xs btn-square opacity-40 hover:opacity-100">
            <X className="h-4 w-4" />
          </button>
        </div>
        {open && children}
      </div>
    </dialog>
  )
}
```

El único cambio es la última línea del contenido: `{children}` → `{open && children}`.

- [ ] **Step 2: Verificar en navegador que `/creador-productos` ya no crashea**

```bash
cd frontend && npm run dev
```

Navegar a `http://localhost:5173/creador-productos`. Expected: la página carga sin ErrorBoundary. Si sigue mostrando el error, abrir DevTools → Console para ver el mensaje exacto.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ui/dialog.tsx
git commit -m "fix(dialog): render children only when open to prevent crash in creador-productos"
```

---

## Task 7: Frontend — App.tsx import fix

**Files:**
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Mover `import AuditLogPage` al bloque de imports**

En `App.tsx`, la línea 35 tiene:
```ts
import AuditLogPage from '@/pages/audit-log'
```
...colocada DESPUÉS de `const queryClient = new QueryClient({...})` (línea 26). Moverla al bloque de imports al inicio del archivo, junto a los demás imports de páginas.

El archivo debe quedar con todos los imports consecutivos al inicio:
```ts
import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { AppLayout } from '@/components/layout/app-layout'
import { ErrorBoundary } from '@/components/ui/error-boundary'
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
import AuditLogPage from '@/pages/audit-log'   // ← movido aquí

const queryClient = new QueryClient({
  // ...
```

Eliminar la línea 35 con el import misplaced.

- [ ] **Step 2: Verificar TypeScript**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -20
```

Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/App.tsx
git commit -m "fix(App): move AuditLogPage import to top of imports block"
```

---

## Task 8: Frontend — types/index.ts

**Files:**
- Modify: `frontend/src/types/index.ts`

- [ ] **Step 1: Agregar `precio_unidad` a la interfaz `Producto`**

```typescript
export interface Producto {
  id: string
  nombre: string
  descripcion?: string | null
  codigo: string | null
  categoria_id: number | null
  categoria_nombre?: string | null
  unidad_base_id: number
  unidad_base_nombre?: string
  stock_minimo: number
  precio_unidad?: string | null    // ← nuevo (Decimal viene como string desde Rust)
  activo: boolean
  version: number
  presentaciones?: Presentacion[]
}
```

- [ ] **Step 2: Agregar `precio_unidad` a `CreateProducto`**

```typescript
export interface CreateProducto {
  nombre: string
  descripcion?: string
  categoria_id?: number
  unidad_base_id: number
  proveedor_id?: number
  codigo_proveedor?: string
  codigo_maestro?: string
  stock_minimo?: number
  precio_unidad?: number           // ← nuevo
  presentaciones?: { nombre: string; nombre_plural: string; factor_conversion: number; codigo_barras?: string }[]
  area_ids?: number[]
}
```

- [ ] **Step 3: Agregar `precio_unidad` a `UpdateProducto`**

```typescript
export interface UpdateProducto {
  nombre?: string
  descripcion?: string
  categoria_id?: number
  proveedor_id?: number
  codigo_proveedor?: string
  codigo_maestro?: string
  stock_minimo?: number
  precio_unidad?: number           // ← nuevo
  area_ids?: number[]
  version: number
}
```

- [ ] **Step 4: Agregar `costo_unitario` a `Lote`**

```typescript
export interface Lote {
  id: number
  producto_id: string
  producto_nombre?: string
  codigo_lote: string
  codigo_interno: string | null
  fecha_vencimiento: string
  proveedor_id: number | null
  proveedor_nombre?: string
  recepcion_id: number | null
  notas: string | null
  costo_unitario: string | null    // ← nuevo
  created_at: string
}
```

- [ ] **Step 5: Verificar TypeScript**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -20
```

Expected: sin errores (o solo errores pre-existentes no relacionados).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/types/index.ts
git commit -m "feat(types): add precio_unidad to Producto/CreateProducto/UpdateProducto, costo_unitario to Lote"
```

---

## Task 9: Frontend — productos-tab.tsx: Create Dialog

**Files:**
- Modify: `frontend/src/pages/creador-productos/productos-tab.tsx`

### 9a: Agregar `stock_minimo` al form de creación

El `CreateProductoDialog` no tiene campo `stock_minimo`. El `EditProductoDialog` sí. Agregarlos en paralelo.

- [ ] **Step 1: Agregar `stock_minimo` y campos de precio al estado del form de creación**

El estado actual (líneas ~522-535) carece de `stock_minimo`, `precio_unidad`, y `precio_pres`. Reemplazar con:

```typescript
  const [form, setForm] = useState({
    nombre: '',
    descripcion: '',
    categoria_id: '',
    unidad_base_id: '',
    area_id: '',
    proveedor_id: '',
    codigo_proveedor: '',
    codigo_maestro: '',
    stock_minimo: '0',
    precio_unidad: '',
    precio_pres: '',
    pres_nombre: '',
    pres_nombre_plural: '',
    pres_factor: '',
    pres_codigo_barras: '',
  })
```

- [ ] **Step 2: Actualizar `handleClose` para resetear los nuevos campos**

```typescript
  function handleClose() {
    onClose()
    setForm({
      nombre: '', descripcion: '', categoria_id: '', unidad_base_id: '',
      area_id: '', proveedor_id: '', codigo_proveedor: '', codigo_maestro: '',
      stock_minimo: '0', precio_unidad: '', precio_pres: '',
      pres_nombre: '', pres_nombre_plural: '', pres_factor: '', pres_codigo_barras: '',
    })
  }
```

- [ ] **Step 3: Agregar lógica de sincronización de precio**

Agregar dos handlers después de `handleClose`:

```typescript
  function handlePrecioUnidadChange(val: string) {
    const num = parseFloat(val)
    const factor = parseFloat(form.pres_factor)
    const presVal = !isNaN(num) && !isNaN(factor) && factor > 0
      ? String((num * factor).toFixed(2))
      : ''
    setForm(f => ({ ...f, precio_unidad: val, precio_pres: presVal }))
  }

  function handlePrecioPresChange(val: string) {
    const num = parseFloat(val)
    const factor = parseFloat(form.pres_factor)
    const unidadVal = !isNaN(num) && !isNaN(factor) && factor > 0
      ? String((num / factor).toFixed(4))
      : ''
    setForm(f => ({ ...f, precio_pres: val, precio_unidad: unidadVal }))
  }
```

- [ ] **Step 4: Incluir `stock_minimo` y `precio_unidad` en el payload de `handleSubmit`**

En la llamada a `createMut.mutate({...})`, agregar:

```typescript
    createMut.mutate({
      nombre: form.nombre.trim(),
      descripcion: form.descripcion.trim() || undefined,
      categoria_id: form.categoria_id ? Number(form.categoria_id) : undefined,
      unidad_base_id: Number(form.unidad_base_id),
      proveedor_id: form.proveedor_id ? Number(form.proveedor_id) : undefined,
      codigo_proveedor: form.codigo_proveedor.trim() || undefined,
      codigo_maestro: form.codigo_maestro.trim() || undefined,
      stock_minimo: form.stock_minimo ? Number(form.stock_minimo) : 0,
      precio_unidad: form.precio_unidad ? Number(form.precio_unidad) : undefined,
      presentaciones,
      area_ids: form.area_id ? [Number(form.area_id)] : undefined,
    })
```

- [ ] **Step 5: Agregar UI para `stock_minimo` en el JSX del CreateDialog**

Buscar la sección de identificación del formulario en el `CreateProductoDialog`. Agregar un input para `stock_minimo` cerca de los campos de nombre/descripción (buscar `codigo_maestro` para orientarse):

```tsx
<div>
  <label className="label"><span className="label-text text-xs">Stock mínimo</span></label>
  <input
    type="number"
    min="0"
    className="input input-sm input-bordered w-full"
    value={form.stock_minimo}
    onChange={e => setForm(f => ({ ...f, stock_minimo: e.target.value }))}
    placeholder="0"
  />
</div>
```

- [ ] **Step 6: Agregar UI de precios en el CreateDialog**

Agregar los campos de precio en la sección de presentación. La lógica: si hay `pres_factor` definido → mostrar dos campos vinculados; si no → mostrar solo precio por unidad.

Buscar la sección donde se muestra/edita `pres_factor` y agregar debajo:

```tsx
{/* Precio */}
<div>
  <label className="label"><span className="label-text text-xs">Precio de referencia</span></label>
  <div className="flex items-center gap-2">
    <div className="flex-1">
      <label className="label py-0"><span className="label-text text-xs text-base-content/60">
        Por {unidades?.find(u => u.id === Number(form.unidad_base_id))?.nombre || 'unidad'}
      </span></label>
      <input
        type="number"
        min="0"
        step="0.01"
        className="input input-sm input-bordered w-full"
        value={form.precio_unidad}
        onChange={e => handlePrecioUnidadChange(e.target.value)}
        placeholder="$ —"
      />
    </div>
    {form.pres_factor && Number(form.pres_factor) > 0 && (
      <>
        <span className="text-base-content/30 mt-5">↔</span>
        <div className="flex-1">
          <label className="label py-0"><span className="label-text text-xs text-base-content/60">
            Por {form.pres_nombre || 'presentación'}
          </span></label>
          <input
            type="number"
            min="0"
            step="0.01"
            className="input input-sm input-bordered w-full"
            value={form.precio_pres}
            onChange={e => handlePrecioPresChange(e.target.value)}
            placeholder="$ —"
          />
        </div>
      </>
    )}
  </div>
</div>
```

- [ ] **Step 7: Verificar TypeScript**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -20
```

Expected: sin errores nuevos.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/pages/creador-productos/productos-tab.tsx
git commit -m "feat(create-producto): add stock_minimo and precio_unidad fields to create dialog"
```

---

## Task 10: Frontend — productos-tab.tsx: Edit Dialog

**Files:**
- Modify: `frontend/src/pages/creador-productos/productos-tab.tsx`

- [ ] **Step 1: Agregar `precio_unidad` y `precio_pres` al estado del form de edición**

El estado actual del `EditProductoDialog` (líneas ~908-923) tiene `stock_minimo` pero no precio. Agregar los campos:

```typescript
  const [form, setForm] = useState({
    nombre: '',
    descripcion: '',
    categoria_id: '',
    area_id: '',
    proveedor_id: '',
    codigo_proveedor: '',
    codigo_maestro: '',
    stock_minimo: '0',
    precio_unidad: '',
    precio_pres: '',
    pres_id: '',
    pres_version: 0,
    pres_nombre: '',
    pres_nombre_plural: '',
    pres_factor: '',
    pres_codigo_barras: '',
  })
```

- [ ] **Step 2: Pre-poblar `precio_unidad` en el `useEffect`**

En el `useEffect` que llama a `setForm({...})` (líneas ~925-950), agregar:

```typescript
        precio_unidad: producto.precio_unidad ? String(producto.precio_unidad) : '',
        precio_pres: (() => {
          const pu = parseFloat(producto.precio_unidad)
          const factor = firstPres ? parseFloat(String(firstPres.factor_conversion)) : 0
          if (!isNaN(pu) && factor > 0) return String((pu * factor).toFixed(2))
          return ''
        })(),
```

- [ ] **Step 3: Agregar los mismos handlers de precio que en Create**

Agregar `handlePrecioUnidadChange` y `handlePrecioPresChange` en el `EditProductoDialog` (misma lógica que Task 9 Step 3).

- [ ] **Step 4: Incluir `precio_unidad` en el payload de `updateMut.mutate`**

Buscar la llamada a `updateMut.mutate({...})` en `EditProductoDialog` y agregar:

```typescript
      precio_unidad: form.precio_unidad ? Number(form.precio_unidad) : undefined,
```

- [ ] **Step 5: Agregar UI de precio en el Edit dialog**

Misma UI que Task 9 Step 6, pero en `EditProductoDialog`. Buscar donde aparece `pres_factor` en el JSX del edit y añadir el bloque de precio igual que en Create.

- [ ] **Step 6: Verificar TypeScript**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -20
```

Expected: sin errores.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/creador-productos/productos-tab.tsx
git commit -m "feat(edit-producto): add precio_unidad fields to edit dialog"
```

---

## Task 11: Frontend — productos-tab.tsx: ProductoDetail panel

**Files:**
- Modify: `frontend/src/pages/creador-productos/productos-tab.tsx`

- [ ] **Step 1: Mostrar precio en el panel de detalle**

Buscar el componente `ProductoDetail` (o la función que renderiza el panel lateral de detalle). Agregar la sección de precio cerca de `stock_minimo`. Buscar el patrón `stock_minimo` en el panel de detalle e insertar a continuación:

```tsx
{/* Precio */}
{producto.precio_unidad && (
  <div className="mt-3 p-3 bg-base-200 rounded-lg">
    <p className="text-xs text-base-content/50 mb-1">Precio de referencia</p>
    <p className="text-sm font-medium">
      ${Number(producto.precio_unidad).toFixed(4)} / {producto.unidad_base?.nombre || 'unidad'}
    </p>
    {producto.presentaciones?.[0] && (
      <p className="text-xs text-base-content/60 mt-0.5">
        ${(Number(producto.precio_unidad) * Number(producto.presentaciones[0].factor_conversion)).toFixed(2)} por {producto.presentaciones[0].nombre}
        {' '}(× {producto.presentaciones[0].factor_conversion})
      </p>
    )}
  </div>
)}
```

- [ ] **Step 2: Verificar TypeScript y que no hay errores**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/creador-productos/productos-tab.tsx
git commit -m "feat(producto-detail): show precio_unidad and derived presentation price"
```

---

## Task 12: Frontend — recepciones/nueva.tsx: campo costo_unitario

**Files:**
- Modify: `frontend/src/pages/recepciones/nueva.tsx`

- [ ] **Step 1: Agregar `costo_unitario` a `DetalleLineUI`**

En la interfaz `DetalleLineUI` (líneas ~36-52), agregar:

```typescript
interface DetalleLineUI {
  id: string
  producto_id: string
  producto_nombre: string
  presentacion_id: number | null
  presentacion_nombre: string
  presentacion_nombre_plural: string
  cantidad_presentacion: number
  factor_conversion: number
  unidad_base_nombre: string
  unidad_base_nombre_plural: string
  codigo_lote: string
  fecha_vencimiento: string
  area_destino_id: number | null
  area_destino_nombre: string
  presentaciones: Presentacion[]
  costo_unitario: string          // ← nuevo (vacío = no ingresado)
}
```

- [ ] **Step 2: Inicializar `costo_unitario: ''` donde se construyen nuevas líneas**

Buscar todas las llamadas a `setDetalles(prev => [...prev, { ...nuevaLinea }])` y asegurarse de que incluyen `costo_unitario: ''`.

- [ ] **Step 3: Agregar `costo_unitario` al `RecepcionPayload`**

```typescript
interface RecepcionPayload {
  proveedor_id: number
  guia_despacho?: string
  fecha_recepcion: string
  nota?: string
  estado?: string
  detalle: {
    producto_id: string
    numero_lote: string
    fecha_vencimiento: string
    presentacion_id?: number | null
    cantidad_presentaciones: number
    area_destino_id: number
    costo_unitario?: number | null   // ← nuevo
  }[]
}
```

- [ ] **Step 4: Incluir `costo_unitario` en `buildRequest`**

En el `.map((d) => ({...}))` dentro de `buildRequest`:

```typescript
      detalle: valid.map((d) => ({
        producto_id: String(d.producto_id),
        numero_lote: d.codigo_lote,
        fecha_vencimiento: d.fecha_vencimiento,
        presentacion_id: d.presentacion_id,
        cantidad_presentaciones: d.cantidad_presentacion,
        area_destino_id: d.area_destino_id!,
        costo_unitario: d.costo_unitario ? Number(d.costo_unitario) : null,   // ← nuevo
      })),
```

- [ ] **Step 5: Agregar input de `costo_unitario` en el JSX de cada línea de detalle**

Agregar el campo después del selector de área destino (alrededor de la línea ~897 del archivo, después del `</div>` del select de área). Buscar el `<div className="flex items-center gap-1.5">` del `MapPin` y agregar después:

```tsx
<div className="flex items-center gap-1.5">
  <span className="text-xs text-base-content/40 shrink-0">Precio</span>
  <input
    type="number"
    min="0"
    step="0.01"
    className="input input-sm input-bordered w-28"
    placeholder="$ opcional"
    value={d.costo_unitario}
    onChange={(e) => updateLine(d.id, { costo_unitario: e.target.value })}
  />
  <span className="text-xs text-base-content/40 shrink-0">
    /{d.presentacion_nombre || d.unidad_base_nombre}
  </span>
</div>
```

**Nota:** El precio que el usuario ingresa es por presentación (o unidad base si no hay presentación). El backend recibe `costo_unitario` en `DetalleRecepcionInput` que ya existe y espera el precio por unidad base. Convertir al guardar:

Actualizar Step 4 — el `buildRequest` debe convertir precio-por-presentación a precio-por-unidad-base:

```typescript
        costo_unitario: d.costo_unitario
          ? Number(d.costo_unitario) / (d.presentacion_id ? d.factor_conversion : 1)
          : null,
```

- [ ] **Step 6: Verificar TypeScript**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -20
```

Expected: sin errores nuevos.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/recepciones/nueva.tsx
git commit -m "feat(recepciones): add optional costo_unitario field per reception line"
```

---

## Task 13: Verificación final end-to-end

- [ ] **Step 1: Build completo backend**

```bash
cd backend && cargo build --release 2>&1 | tail -10
```

Expected: `Finished release [optimized]`

- [ ] **Step 2: Build completo frontend**

```bash
cd frontend && npm run build 2>&1 | tail -20
```

Expected: `✓ built in X.XXs`

- [ ] **Step 3: Test manual en browser**

Con el servidor corriendo:
1. Ir a `/creador-productos` — NO debe mostrar ErrorBoundary
2. Crear un producto con precio → verificar que aparece en el panel de detalle
3. Editar el producto → precio debe pre-popularse
4. Crear una recepción con `costo_unitario` → confirmar → verificar que `productos.precio_unidad` se actualiza en BD

- [ ] **Step 4: Commit final si hay ajustes menores**

```bash
git add -p   # solo archivos con cambios no commiteados
git commit -m "fix: minor adjustments from end-to-end testing"
```

---

## Notas de implementación

### Orden recomendado
Implementar en el orden de los tasks: primero la migración de BD, luego el modelo Rust, luego el service, luego el handler, luego el sync de recepciones — todo el backend antes de tocar el frontend. Esto permite que el backend compile limpio antes de integrar con el frontend.

### Si el crash persiste después de Task 6
Si después del fix del Dialog el crash sigue ocurriendo, abrir DevTools → Console en `/creador-productos` y capturar el mensaje exacto de error del `ErrorBoundary`. El componente en `frontend/src/components/ui/error-boundary.tsx` muestra `{import.meta.env.DEV && <code>{this.state.error?.message}</code>}` en modo desarrollo.

### El campo `costo_unitario` en recepciones ya existe en backend
`DetalleRecepcionInput.costo_unitario: Option<Decimal>` ya está definido y persiste en `lotes` a través de `crear_o_reutilizar_lote`. Solo falta el sync a `productos` (Task 5) y el UI del frontend (Task 12).
