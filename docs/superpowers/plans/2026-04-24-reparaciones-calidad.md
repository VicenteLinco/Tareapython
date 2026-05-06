# Reparaciones de Calidad — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corregir 7 problemas de calidad identificados en la revisión: race condition en borradores, SQL dinámico frágil, upsert silencioso en unidades, eliminar área sin feedback diferenciado, dead code, componente de 1501 líneas, y tipo `any[]` en ConteoDetalle.

**Architecture:** Fixes independientes agrupados en 2 bloques: backend (Tasks 1–5) y frontend (Tasks 6–7). Cada task es autocontenido y compilable por separado.

**Tech Stack:** Rust + SQLx 0.8 + Axum 0.8 (backend); React 19 + TypeScript + Vite (frontend).

---

## Mapa de archivos

| Archivo | Tarea | Tipo |
|---------|-------|------|
| `backend/migrations/045_unique_borrador_por_usuario.sql` | T1 | Crear |
| `backend/src/handlers/solicitudes_compra.rs` | T2 | Modificar |
| `backend/src/services/unidad_basica_service.rs` | T3 | Modificar |
| `backend/src/services/area_service.rs` | T4 | Modificar |
| `backend/src/handlers/areas.rs` | T4 | Modificar |
| `backend/src/errors.rs` | T5 | Modificar |
| `frontend/src/pages/solicitudes-compra/solicitud-utils.ts` | T6 | Crear |
| `frontend/src/pages/solicitudes-compra/components/proveedor-gallery.tsx` | T6 | Crear |
| `frontend/src/pages/solicitudes-compra/components/quiebres-panel.tsx` | T6 | Crear |
| `frontend/src/pages/solicitudes-compra/components/pedido-panel.tsx` | T6 | Crear |
| `frontend/src/pages/solicitudes-compra/components/historial-view.tsx` | T6 | Crear |
| `frontend/src/pages/solicitudes-compra/components/detalle-modal.tsx` | T6 | Crear |
| `frontend/src/pages/solicitudes-compra/index.tsx` | T6 | Modificar (reduce a ~350 líneas) |
| `frontend/src/types/index.ts` | T7 | Modificar |

---

## Task 1: Migration — UNIQUE parcial para borradores

**Problema:** Entre la consulta `SELECT id WHERE estado = 'borrador'` y el `INSERT` en `crear()` dos peticiones concurrentes del mismo usuario pueden crear dos borradores. No hay constraint de BD que lo impida.

**Fix:** Índice UNIQUE parcial de PostgreSQL sobre `(usuario_id) WHERE estado = 'borrador'`.

**Files:**
- Crear: `backend/migrations/045_unique_borrador_por_usuario.sql`

- [ ] **Step 1: Crear la migración**

```sql
-- backend/migrations/045_unique_borrador_por_usuario.sql
-- Garantiza que cada usuario tenga como máximo un borrador de solicitud de compra.
-- UNIQUE parcial: solo aplica a filas donde estado = 'borrador'.
-- Filas con estado 'guardada' / 'aprobada' etc. no están restringidas.

CREATE UNIQUE INDEX IF NOT EXISTS uq_solicitudes_compra_borrador_por_usuario
    ON solicitudes_compra (usuario_id)
    WHERE estado = 'borrador';
```

- [ ] **Step 2: Verificar que el backend compila y aplica la migración**

```bash
cd "C:/Users/Desarrollo/Documents/14 marzo inventario"
docker compose up --build -d
```

Esperado: contenedor backend arranca, los logs muestran `Applied 1 migration`.

- [ ] **Step 3: Verificar el índice en la DB**

```bash
docker compose exec db psql -U postgres -d inventario -c "\d solicitudes_compra"
```

Esperado: aparece la línea `uq_solicitudes_compra_borrador_por_usuario UNIQUE, ... WHERE estado = 'borrador'`.

- [ ] **Step 4: Commit**

```bash
git add backend/migrations/045_unique_borrador_por_usuario.sql
git commit -m "fix(db): unique parcial para borrador por usuario en solicitudes_compra"
```

---

## Task 2: Backend — QueryBuilder en `listar()` de solicitudes_compra

**Problema:** `listar()` construye SQL con `format!()` y `bind_idx: i32` manual. Un reordenamiento de filtros desalinea los índices `$1`, `$2`… y causa pánico en runtime.

**Fix:** Reemplazar con `sqlx::QueryBuilder` que maneja los placeholders automáticamente.

**Files:**
- Modificar: `backend/src/handlers/solicitudes_compra.rs` — función `listar` (líneas 198–287)

- [ ] **Step 1: Reemplazar la función `listar` completa**

Reemplaza el bloque desde `async fn listar(` hasta el `Ok(Json(...))` final (inclusive) con:

```rust
async fn listar(
    State(state): State<AppState>,
    Query(params): Query<SolicitudListParams>,
) -> Result<Json<serde_json::Value>, AppError> {
    let per_page = params.per_page.unwrap_or(20).max(1).min(100);
    let page = params.page.unwrap_or(1).max(1);
    let offset = (page - 1) * per_page;

    let q_pattern = params.q.as_ref().map(|q| format!("%{}%", q));

    // ── COUNT ────────────────────────────────────────────────────────────────
    let mut count_builder: sqlx::QueryBuilder<sqlx::Postgres> = sqlx::QueryBuilder::new(
        "SELECT COUNT(*) FROM solicitudes_compra s JOIN usuarios u ON u.id = s.usuario_id WHERE 1=1"
    );
    if let Some(ref pat) = q_pattern {
        count_builder.push(" AND (s.numero_documento ILIKE ");
        count_builder.push_bind(pat);
        count_builder.push(" OR u.nombre ILIKE ");
        count_builder.push_bind(pat);
        count_builder.push(")");
    }
    if let Some(ref estado) = params.estado {
        count_builder.push(" AND s.estado = ");
        count_builder.push_bind(estado);
    }
    if let Some(proveedor_id) = params.proveedor_id {
        count_builder.push(
            " AND EXISTS (SELECT 1 FROM solicitud_compra_detalle scd \
             JOIN productos p ON p.id = scd.producto_id \
             WHERE scd.solicitud_id = s.id AND p.proveedor_id = "
        );
        count_builder.push_bind(proveedor_id);
        count_builder.push(")");
    }
    let total: i64 = count_builder
        .build_query_scalar()
        .fetch_one(&state.pool)
        .await?;

    // ── LIST ─────────────────────────────────────────────────────────────────
    let mut list_builder: sqlx::QueryBuilder<sqlx::Postgres> = sqlx::QueryBuilder::new(
        r#"SELECT s.id, s.numero_documento, s.fecha_creacion, s.estado,
                  u.nombre as usuario_nombre,
                  (SELECT COUNT(*)::integer FROM solicitud_compra_detalle WHERE solicitud_id = s.id) as items_count
           FROM solicitudes_compra s
           JOIN usuarios u ON u.id = s.usuario_id
           WHERE 1=1"#
    );
    if let Some(ref pat) = q_pattern {
        list_builder.push(" AND (s.numero_documento ILIKE ");
        list_builder.push_bind(pat);
        list_builder.push(" OR u.nombre ILIKE ");
        list_builder.push_bind(pat);
        list_builder.push(")");
    }
    if let Some(ref estado) = params.estado {
        list_builder.push(" AND s.estado = ");
        list_builder.push_bind(estado);
    }
    if let Some(proveedor_id) = params.proveedor_id {
        list_builder.push(
            " AND EXISTS (SELECT 1 FROM solicitud_compra_detalle scd \
             JOIN productos p ON p.id = scd.producto_id \
             WHERE scd.solicitud_id = s.id AND p.proveedor_id = "
        );
        list_builder.push_bind(proveedor_id);
        list_builder.push(")");
    }
    list_builder.push(" ORDER BY s.fecha_creacion DESC LIMIT ");
    list_builder.push_bind(per_page);
    list_builder.push(" OFFSET ");
    list_builder.push_bind(offset);

    let solicitudes = list_builder
        .build_query_as::<SolicitudResumen>()
        .fetch_all(&state.pool)
        .await?;

    let total_pages = ((total as f64) / (per_page as f64)).ceil() as i64;

    Ok(Json(serde_json::json!({
        "data": solicitudes,
        "total": total,
        "page": page,
        "per_page": per_page,
        "total_pages": total_pages
    })))
}
```

> **Nota sobre imports:** `sqlx::QueryBuilder` ya está disponible con `sqlx = "0.8"`. No se necesita import adicional porque `sqlx` ya está en scope.

- [ ] **Step 2: Eliminar el macro `bind_filters!` que ya no se usa**

En el archivo, elimina el bloque completo del macro (aprox. líneas 252–266 del original):

```rust
    // Bind helpers — we build both queries with the same bind sequence
    macro_rules! bind_filters {
        ($query:expr) => {{
            let mut q = $query;
            if let Some(ref pat) = q_pattern {
                q = q.bind(pat).bind(pat);
            }
            if let Some(ref estado) = params.estado {
                q = q.bind(estado);
            }
            if let Some(proveedor_id) = params.proveedor_id {
                q = q.bind(proveedor_id);
            }
            q
        }};
    }
```

- [ ] **Step 3: Compilar**

```bash
cd "C:/Users/Desarrollo/Documents/14 marzo inventario/backend"
cargo build 2>&1 | head -30
```

Esperado: `Finished` sin errores. Si hay error de tipo en `build_query_as`, verificar que `SolicitudResumen` implementa `sqlx::FromRow`.

- [ ] **Step 4: Commit**

```bash
git add backend/src/handlers/solicitudes_compra.rs
git commit -m "refactor(solicitudes): QueryBuilder en listar() elimina bind_idx manual"
```

---

## Task 3: Backend — Corregir upsert silencioso en `unidades_basicas`

**Problema:** `crear()` usa `ON CONFLICT (nombre) DO UPDATE SET activo = true, nombre_plural = EXCLUDED.nombre_plural` — si el nombre ya existe (activo o no), reescribe `nombre_plural` silenciosamente y no reporta conflicto. El caller (y el usuario) cree que creó algo nuevo.

**Fix:** Separar en dos operaciones limpias: intentar `INSERT`; si hay conflicto de nombre con registro activo → error descriptivo; si conflicto con registro inactivo → reactivar explícitamente con los nuevos valores y registrar en audit.

**Files:**
- Modificar: `backend/src/services/unidad_basica_service.rs` — función `crear`

- [ ] **Step 1: Reemplazar la función `crear`**

```rust
pub async fn crear(
    pool: &PgPool,
    req: CreateUnidadBasica,
    usuario_id: Uuid,
) -> Result<UnidadBasica, AppError> {
    req.validate()?;
    let nombre = req.nombre.trim().to_string();
    let nombre_plural = req.nombre_plural.trim().to_string();

    // ── Verificar si ya existe un registro con ese nombre ────────────────────
    let existente: Option<(i32, bool)> = sqlx::query_as(
        "SELECT id, activo FROM unidades_basicas WHERE nombre = $1 LIMIT 1"
    )
    .bind(&nombre)
    .fetch_optional(pool)
    .await?;

    match existente {
        Some((_, true)) => {
            return Err(AppError::Conflict(format!(
                "La unidad básica '{}' ya existe",
                nombre
            )));
        }
        Some((id, false)) => {
            // Reactivar explícitamente
            let unidad = sqlx::query_as::<_, UnidadBasica>(
                "UPDATE unidades_basicas \
                 SET activo = true, nombre_plural = $1, version = version + 1 \
                 WHERE id = $2 \
                 RETURNING id, nombre, nombre_plural, activo, version",
            )
            .bind(&nombre_plural)
            .bind(id)
            .fetch_one(pool)
            .await?;

            crate::services::audit::registrar(
                pool, "unidades_basicas", &unidad.id.to_string(), "REACTIVATE",
                Some(serde_json::json!({"activo": false})),
                Some(serde_json::json!({"nombre": &unidad.nombre, "nombre_plural": &unidad.nombre_plural, "activo": true})),
                usuario_id,
            ).await?;

            return Ok(unidad);
        }
        None => {} // continúa con insert normal
    }

    let unidad = sqlx::query_as::<_, UnidadBasica>(
        "INSERT INTO unidades_basicas (nombre, nombre_plural) VALUES ($1, $2) \
         RETURNING id, nombre, nombre_plural, activo, version",
    )
    .bind(&nombre)
    .bind(&nombre_plural)
    .fetch_one(pool)
    .await
    .map_err(|e| match &e {
        sqlx::Error::Database(db) if db.is_unique_violation() => {
            AppError::Conflict(format!("La unidad básica '{}' ya existe", nombre))
        }
        _ => e.into(),
    })?;

    crate::services::audit::registrar(
        pool, "unidades_basicas", &unidad.id.to_string(), "CREATE",
        None,
        Some(serde_json::json!({"nombre": &unidad.nombre, "nombre_plural": &unidad.nombre_plural})),
        usuario_id,
    ).await?;

    Ok(unidad)
}
```

- [ ] **Step 2: Compilar**

```bash
cd "C:/Users/Desarrollo/Documents/14 marzo inventario/backend"
cargo build 2>&1 | head -30
```

Esperado: `Finished` sin errores.

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/unidad_basica_service.rs
git commit -m "fix(unidades): crear() separa insert/reactivar, elimina upsert silencioso"
```

---

## Task 4: Backend — `area_service::eliminar` comunica soft vs hard delete

**Problema:** `eliminar()` retorna `Ok(())` en ambos casos (soft-delete o hard-delete). El handler responde siempre `204 No Content`. El usuario ve el mismo resultado sin importar qué pasó.

**Fix:** Agregar un enum `EliminarResultado` en `area_service`. El handler lo usa para devolver JSON diferenciado.

**Files:**
- Modificar: `backend/src/services/area_service.rs`
- Modificar: `backend/src/handlers/areas.rs`

- [ ] **Step 1: Agregar enum y actualizar `eliminar` en `area_service.rs`**

Al inicio del archivo, después de los `use`, agrega:

```rust
#[derive(Debug)]
pub enum EliminarResultado {
    /// El área fue eliminada definitivamente (no tenía stock)
    Eliminada,
    /// El área fue desactivada (tenía stock activo, soft-delete)
    Desactivada,
}
```

Luego reemplaza la firma y el cuerpo de `eliminar`:

```rust
pub async fn eliminar(
    pool: &PgPool,
    id: i32,
    usuario_id: Uuid,
) -> Result<EliminarResultado, AppError> {
    let stock_count: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM stock WHERE area_id = $1 AND cantidad > 0")
            .bind(id)
            .fetch_one(pool)
            .await?;

    let resultado = if stock_count.0 > 0 {
        sqlx::query("UPDATE areas SET activa = false WHERE id = $1")
            .bind(id)
            .execute(pool)
            .await?;
        EliminarResultado::Desactivada
    } else {
        let result = sqlx::query("DELETE FROM areas WHERE id = $1")
            .bind(id)
            .execute(pool)
            .await?;
        if result.rows_affected() == 0 {
            return Err(AppError::NotFound("Área no encontrada".into()));
        }
        EliminarResultado::Eliminada
    };

    let accion = match resultado {
        EliminarResultado::Eliminada => "DELETE",
        EliminarResultado::Desactivada => "DEACTIVATE",
    };

    crate::services::audit::registrar(
        pool, "areas", &id.to_string(), accion,
        None, None, usuario_id,
    ).await?;

    Ok(resultado)
}
```

- [ ] **Step 2: Actualizar el handler `eliminar` en `areas.rs`**

Reemplaza la función `eliminar` en `handlers/areas.rs`:

```rust
async fn eliminar(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<i32>,
) -> Result<Json<serde_json::Value>, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;
    let resultado = area_service::eliminar(&state.pool, id, claims.sub).await?;
    let mensaje = match resultado {
        area_service::EliminarResultado::Eliminada => "Área eliminada",
        area_service::EliminarResultado::Desactivada => "Área desactivada (tiene stock activo)",
    };
    Ok(Json(serde_json::json!({ "ok": true, "mensaje": mensaje })))
}
```

- [ ] **Step 3: Compilar**

```bash
cd "C:/Users/Desarrollo/Documents/14 marzo inventario/backend"
cargo build 2>&1 | head -30
```

Esperado: `Finished` sin errores.

- [ ] **Step 4: Commit**

```bash
git add backend/src/services/area_service.rs backend/src/handlers/areas.rs
git commit -m "fix(areas): eliminar() retorna EliminarResultado con mensaje diferenciado"
```

---

## Task 5: Backend — Eliminar dead code en `errors.rs`

**Problema:** `validate_email()` y `EMAIL_RE` están marcadas con `#[allow(dead_code)]` pero no se usan en ningún lugar del codebase.

**Files:**
- Modificar: `backend/src/errors.rs` — eliminar las últimas 16 líneas

- [ ] **Step 1: Verificar que realmente no se usan**

```bash
cd "C:/Users/Desarrollo/Documents/14 marzo inventario"
grep -r "validate_email\|EMAIL_RE" backend/src/ --include="*.rs"
```

Esperado: solo aparecen las definiciones en `errors.rs`, ninguna referencia desde otro archivo.

- [ ] **Step 2: Eliminar el bloque dead code**

En `backend/src/errors.rs`, elimina desde la línea 117 hasta el final del archivo:

```rust
#[allow(dead_code)]
static EMAIL_RE: OnceLock<Regex> = OnceLock::new();

/// Valida un campo de email con regex RFC-compatible y longitud.
#[allow(dead_code)]
pub fn validate_email(email: &str) -> Result<(), AppError> {
    if email.len() > 254 {
        return Err(AppError::Validation("Email demasiado largo".into()));
    }
    let re = EMAIL_RE.get_or_init(|| {
        Regex::new(r"^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$").unwrap()
    });
    if !re.is_match(email) {
        return Err(AppError::Validation("Formato de email inválido".into()));
    }
    Ok(())
}
```

El archivo debe quedar terminando en la línea `Ok(())` de `validate_text_length`.

- [ ] **Step 3: Verificar si `regex` sigue siendo usada**

```bash
grep -r "use regex\|extern crate regex" backend/src/ --include="*.rs"
```

Si `regex` ya no se usa en ningún otro lugar, también elimina la dependencia de `Cargo.toml`:

```bash
grep "regex" "C:/Users/Desarrollo/Documents/14 marzo inventario/backend/Cargo.toml"
```

Si solo aparece `regex = "..."`, eliminar esa línea del `Cargo.toml`.

También elimina el import no usado en `errors.rs` si queda:
```rust
use regex::Regex;          // eliminar si no queda referencia
use std::sync::OnceLock;   // eliminar si no queda referencia
```

- [ ] **Step 4: Compilar**

```bash
cd "C:/Users/Desarrollo/Documents/14 marzo inventario/backend"
cargo build 2>&1 | head -30
```

Esperado: `Finished` sin errores ni warnings de `dead_code`.

- [ ] **Step 5: Commit**

```bash
git add backend/src/errors.rs backend/Cargo.toml
git commit -m "chore(errors): eliminar validate_email y EMAIL_RE no usados"
```

---

## Task 6: Frontend — Partir `solicitudes-compra/index.tsx` en componentes

**Problema:** El archivo tiene 1501 líneas mezclando galería de proveedores, panel de quiebres, panel de pedido, historial, modal de detalle, helpers de cálculo, y toda la lógica de estado. Es difícil de mantener y de leer.

**Solución:** Extraer en 5 componentes + 1 archivo de utilidades. El `index.tsx` queda como orquestador (~350 líneas).

**Files:**
- Crear: `frontend/src/pages/solicitudes-compra/solicitud-utils.ts`
- Crear: `frontend/src/pages/solicitudes-compra/components/proveedor-gallery.tsx`
- Crear: `frontend/src/pages/solicitudes-compra/components/quiebres-panel.tsx`
- Crear: `frontend/src/pages/solicitudes-compra/components/pedido-panel.tsx`
- Crear: `frontend/src/pages/solicitudes-compra/components/historial-view.tsx`
- Crear: `frontend/src/pages/solicitudes-compra/components/detalle-modal.tsx`
- Modificar: `frontend/src/pages/solicitudes-compra/index.tsx`

> La carpeta `components/` ya existe (`solicitud-buscador.tsx` ya está ahí).

### Step 1: Crear `solicitud-utils.ts` con helpers puros

- [ ] **Crear `solicitud-utils.ts`**

```typescript
// frontend/src/pages/solicitudes-compra/solicitud-utils.ts
import { formatCantidad } from '@/lib/utils'
import type { SolicitudItem } from '@/types'
import api from '@/lib/api'

export const HORIZONTE_CHIPS = [7, 15, 30, 90, 180, 365] as const
export type HorizonChip = typeof HORIZONTE_CHIPS[number]

/** Calcula unidades a pedir dado un horizonte de cobertura. */
export function calcularCantidad(
  horizonte: number,
  consumoDiario: number,
  leadTime: number,
  stockMinimo: number,
  stockActual: number,
  factorConversion?: number | null,
): number {
  const base = Math.max(1, Math.ceil(
    stockMinimo + consumoDiario * (leadTime + horizonte) - stockActual
  ))
  if (factorConversion && factorConversion > 0) {
    return Math.max(1, Math.ceil(base / factorConversion))
  }
  return base
}

/** Días de stock cubiertos con la cantidad actual del ítem. */
export function calcularDiasCubiertos(item: SolicitudItem): number | null {
  if (item.consumo_diario <= 0) return null
  const unidadesBase = item.factor_conversion
    ? item.cantidad * item.factor_conversion
    : item.cantidad
  return Math.round(unidadesBase / item.consumo_diario)
}

/** Clases CSS del pill de cobertura según días cubiertos. */
export function pillClasses(dias: number | null, personalizado: boolean): string {
  if (personalizado) return 'bg-purple-500/10 text-purple-300 border-purple-500/30'
  if (dias === null)  return 'bg-base-200 text-base-content/40 border-base-300'
  if (dias < 15)     return 'bg-error/10 text-error border-error/30'
  if (dias < 30)     return 'bg-warning/10 text-warning border-warning/30'
  if (dias < 90)     return 'bg-success/10 text-success border-success/30'
  return 'bg-info/10 text-info border-info/30'
}

/** Texto del pill de cobertura. */
export function pillText(dias: number | null, personalizado: boolean): string {
  if (dias === null) return '📅 Sin historial'
  return personalizado ? `📌 ~${dias} días` : `📅 ~${dias} días`
}

/** Etiqueta de unidad para un ítem (presentación o unidad base). */
export function unidadLabel(item: SolicitudItem, qty: number): string {
  if (item.presentacion_nombre) {
    return formatCantidad(qty, item.presentacion_nombre, item.presentacion_nombre_plural ?? undefined)
      .replace(/^[\d.,\s]+/, '').trim()
  }
  return formatCantidad(qty, item.unidad_base, item.unidad_base_plural ?? undefined)
    .replace(/^[\d.,\s]+/, '').trim()
}

/** Formatea un valor como moneda. */
export function formatPesos(val: number | string | null, monedaCodigo = 'CLP'): string {
  if (val === null) return '$0'
  const n = typeof val === 'string' ? parseFloat(val) : val
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: monedaCodigo }).format(n)
}

/** Llama al backend para obtener el horizonte sugerido de un producto. */
export async function fetchHorizonte(productoId: string, proveedorId: number | null) {
  if (!proveedorId) {
    return {
      horizonte_sugerido: 30,
      razon: 'sin proveedor — estimación por defecto',
      consumo_diario: 0,
      stock_actual: 0,
      stock_minimo: 0,
    }
  }
  const res = await api.get<{
    horizonte_sugerido: number
    razon: string
    consumo_diario: number
    stock_actual: number
    stock_minimo: number
  }>('/solicitudes-compra/horizonte', {
    params: { producto_id: productoId, proveedor_id: proveedorId }
  })
  return res.data
}

/** Etiqueta legible para un número de días de horizonte. */
export function horizonLabel(d: number): string {
  if (d >= 365) return '1 año'
  if (d >= 180) return '6m'
  if (d >= 90)  return '3m'
  return `${d}d`
}
```

### Step 2: Crear `proveedor-gallery.tsx`

- [ ] **Crear `proveedor-gallery.tsx`**

```tsx
// frontend/src/pages/solicitudes-compra/components/proveedor-gallery.tsx
import { Clock, Mail, Phone } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import type { Proveedor } from '@/types'

interface UrgenciaCount { total: number; criticos: number }

interface ProveedorCardProps {
  proveedor: Proveedor
  urgencias: number
  criticos: number
  onClick: () => void
}

function ProveedorCard({ proveedor, urgencias, criticos, onClick }: ProveedorCardProps) {
  const hasCriticos = criticos > 0
  const hasUrgencias = urgencias > 0

  return (
    <button
      onClick={onClick}
      className="group relative flex flex-col items-center gap-3 p-6 bg-base-100 border border-base-300 rounded-3xl hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5 transition-all duration-200 text-center"
    >
      {hasCriticos ? (
        <span className="absolute top-3 right-3 badge badge-error badge-sm font-bold gap-1">
          <span className="text-[9px]">●</span> {criticos} crítico{criticos !== 1 ? 's' : ''}
        </span>
      ) : hasUrgencias ? (
        <span className="absolute top-3 right-3 badge badge-warning badge-sm font-bold gap-1">
          <span className="text-[9px]">▲</span> {urgencias}
        </span>
      ) : (
        <span className="absolute top-3 right-3 badge badge-success badge-sm font-bold text-[9px]">✓ OK</span>
      )}

      <div className={cn(
        "w-14 h-14 rounded-2xl flex items-center justify-center text-2xl transition-transform group-hover:scale-110 overflow-hidden",
        hasCriticos ? 'bg-error/10' : hasUrgencias ? 'bg-warning/10' : 'bg-success/10'
      )}>
        {proveedor.icono
          ? <img src={proveedor.icono} alt={proveedor.nombre} className="h-full w-full object-contain" />
          : '🏭'}
      </div>

      <div className="flex-1 flex flex-col gap-1 w-full">
        <p className="font-bold text-sm leading-tight">{proveedor.nombre}</p>
        <p className="text-[10px] opacity-40 font-medium">
          {proveedor.total_productos} producto{proveedor.total_productos !== 1 ? 's' : ''}
        </p>
        {(proveedor.dias_despacho_tierra || proveedor.dias_despacho_aereo) && (
          <p className="text-[10px] opacity-50 flex items-center justify-center gap-1">
            <Clock className="h-2.5 w-2.5" />
            LT: {proveedor.dias_despacho_tierra ?? proveedor.dias_despacho_aereo} días
          </p>
        )}
      </div>

      {(proveedor.contacto || proveedor.email || proveedor.telefono) && (
        <div className="w-full pt-2.5 border-t border-base-200 space-y-1 text-left">
          {proveedor.contacto && (
            <p className="text-[10px] opacity-50 truncate flex items-center gap-1">
              <span className="opacity-60">👤</span> {proveedor.contacto}
            </p>
          )}
          {proveedor.telefono && (
            <p className="text-[10px] opacity-50 truncate flex items-center gap-1">
              <Phone className="h-2.5 w-2.5 shrink-0" /> {proveedor.telefono}
            </p>
          )}
          {proveedor.email && (
            <p className="text-[10px] opacity-50 truncate flex items-center gap-1">
              <Mail className="h-2.5 w-2.5 shrink-0" /> {proveedor.email}
            </p>
          )}
        </div>
      )}

      <div className={cn(
        "absolute inset-0 rounded-3xl border-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none",
        hasCriticos ? 'border-error/40' : hasUrgencias ? 'border-warning/40' : 'border-primary/30'
      )} />
    </button>
  )
}

interface ProveedorGalleryProps {
  proveedores: Proveedor[] | undefined
  isLoading: boolean
  urgenciasByProveedor: Record<number, UrgenciaCount>
  logoBase64?: string | null
  onSelect: (p: Proveedor) => void
}

export function ProveedorGallery({
  proveedores,
  isLoading,
  urgenciasByProveedor,
  logoBase64,
  onSelect,
}: ProveedorGalleryProps) {
  return (
    <div className="flex-1 flex flex-col gap-6 min-h-0">
      <div className="flex items-center gap-4">
        {logoBase64 && (
          <img src={logoBase64} alt="Logo laboratorio" className="h-12 w-auto object-contain rounded-xl" />
        )}
        <div>
          <p className="text-base font-bold">¿A qué proveedor vas a pedir?</p>
          <p className="text-sm opacity-40">El pedido se generará exclusivamente con productos de ese proveedor.</p>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          {Array(6).fill(0).map((_, i) => <Skeleton key={i} className="h-36 rounded-3xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 overflow-y-auto custom-scrollbar pb-2">
          {(proveedores ?? []).filter(p => p.activa).map(p => (
            <ProveedorCard
              key={p.id}
              proveedor={p}
              urgencias={urgenciasByProveedor[p.id]?.total ?? 0}
              criticos={urgenciasByProveedor[p.id]?.criticos ?? 0}
              onClick={() => onSelect(p)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
```

### Step 3: Crear `quiebres-panel.tsx`

- [ ] **Crear `quiebres-panel.tsx`**

```tsx
// frontend/src/pages/solicitudes-compra/components/quiebres-panel.tsx
import { Search, CheckCircle2, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/ui/skeleton'
import { SolicitudBuscador } from './solicitud-buscador'
import type { ItemRecomendado, Proveedor, Producto, SolicitudItem } from '@/types'

type TabIzquierdo = 'quiebres' | 'buscar'

interface QuiebresPanelProps {
  proveedor: Proveedor
  recomendaciones: ItemRecomendado[]
  isLoadingRecs: boolean
  itemsEnPedido: SolicitudItem[]
  tab: TabIzquierdo
  monedaCodigo: string
  onTabChange: (t: TabIzquierdo) => void
  onAddFromRec: (r: ItemRecomendado) => void
  onAddFromSearch: (p: Producto) => void
}

export function QuiebresPanelIzquierdo({
  proveedor,
  recomendaciones,
  isLoadingRecs,
  itemsEnPedido,
  tab,
  monedaCodigo,
  onTabChange,
  onAddFromRec,
  onAddFromSearch,
}: QuiebresPanelProps) {
  const excluidos = itemsEnPedido.map(i => i.producto_id)

  return (
    <div className="flex flex-col bg-base-100 rounded-[2rem] border border-base-300 shadow-sm min-h-0">
      {/* Tab selector */}
      <div className="shrink-0 p-2.5 border-b border-base-200">
        <div className="flex bg-base-200/70 rounded-xl p-0.5 gap-0.5">
          <button
            onClick={() => onTabChange('buscar')}
            className={cn(
              "flex-1 py-2 text-[11px] font-bold rounded-[10px] transition-all flex items-center justify-center gap-1.5",
              tab === 'buscar'
                ? "bg-base-100 text-base-content shadow-sm"
                : "text-base-content/40 hover:text-base-content/60"
            )}
          >
            <Search className="h-3 w-3" /> Buscar
          </button>

          {recomendaciones.length === 0 ? (
            <div className="flex-1 py-2 text-[11px] font-bold rounded-[10px] flex items-center justify-center gap-1.5 text-base-content/20 cursor-not-allowed select-none">
              <span>⚠</span> Sin quiebres
            </div>
          ) : (
            <button
              onClick={() => onTabChange('quiebres')}
              className={cn(
                "relative flex-1 py-2 text-[11px] font-bold rounded-[10px] transition-all flex items-center justify-center gap-1.5",
                tab === 'quiebres'
                  ? "bg-warning/15 text-warning shadow-sm"
                  : "bg-warning/8 text-warning hover:bg-warning/20"
              )}
            >
              {tab !== 'quiebres' && (
                <span className="absolute inset-0 rounded-[10px] animate-ping bg-warning/20 pointer-events-none" />
              )}
              <span>⚠</span> Quiebres
              <span className={cn(
                "text-[9px] font-black min-w-[16px] h-4 flex items-center justify-center rounded-full px-1.5",
                tab === 'quiebres'
                  ? "bg-warning text-warning-content"
                  : "bg-warning text-warning-content animate-pulse"
              )}>
                {recomendaciones.length}
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Contenido */}
      {tab === 'buscar' ? (
        <div className="p-3 overflow-visible">
          <SolicitudBuscador
            proveedorId={proveedor.id}
            monedaCodigo={monedaCodigo}
            excluidos={excluidos}
            onAdd={onAddFromSearch}
          />
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-2.5 space-y-2 custom-scrollbar min-h-0">
          {isLoadingRecs ? (
            Array(3).fill(0).map((_, i) => <Skeleton key={i} className="h-20 rounded-2xl" />)
          ) : recomendaciones.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center opacity-30 text-center p-6 gap-3">
              <div className="w-10 h-10 rounded-2xl bg-base-200 flex items-center justify-center">
                <CheckCircle2 className="h-5 w-5 stroke-[1.5px]" />
              </div>
              <div>
                <p className="font-bold text-xs">¡Todo al día!</p>
                <p className="text-[10px] mt-0.5">Sin quiebres para {proveedor.nombre}.</p>
              </div>
            </div>
          ) : (
            recomendaciones.map(r => {
              const alreadyAdded = excluidos.includes(r.producto_id)
              const isCritica = r.nivel_urgencia === 'critica'
              const isAlta = r.nivel_urgencia === 'alta'
              const yaPedido = parseFloat(r.ya_pedido_unidades)
              const sugBase = parseFloat(r.cantidad_sugerida_base)
              const sugLabel = r.cantidad_sugerida_presentacion
                ? `${Math.ceil(parseFloat(r.cantidad_sugerida_presentacion))} ${r.presentacion_nombre_plural || r.presentacion_nombre}`
                : `${Math.ceil(sugBase)} ${r.unidad_base_plural || r.unidad_base}`
              const unidadEnCamino = r.unidad_base_plural || r.unidad_base
              const cubierto = yaPedido > 0 && sugBase === 0

              return (
                <div
                  key={r.producto_id}
                  className={cn(
                    "relative flex flex-col gap-2 p-3 pl-4 rounded-2xl border transition-all overflow-hidden",
                    alreadyAdded
                      ? "opacity-40 bg-base-200/30 border-transparent"
                      : isCritica
                        ? "bg-error/5 border-error/20 hover:border-error/40"
                        : isAlta
                          ? "bg-warning/5 border-warning/20 hover:border-warning/40"
                          : "bg-base-100 border-base-200 hover:border-primary/30"
                  )}
                >
                  <div className={cn(
                    "absolute left-0 inset-y-0 w-[3px]",
                    isCritica ? 'bg-error' : isAlta ? 'bg-warning' : 'bg-primary/40'
                  )} />

                  <div className="flex items-start justify-between gap-1">
                    <p className="font-bold text-[11px] leading-snug line-clamp-2 flex-1 min-w-0">
                      {r.producto_nombre}
                    </p>
                    {!alreadyAdded && (isCritica || isAlta) && (
                      <span className={cn(
                        "shrink-0 text-[8px] font-black uppercase px-1.5 py-0.5 rounded-full leading-tight",
                        isCritica ? "bg-error/15 text-error" : "bg-warning/15 text-warning"
                      )}>
                        {isCritica ? "crítico" : "alta"}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center justify-between">
                    <p className={cn(
                      "text-[9px] font-medium tabular-nums",
                      parseFloat(r.stock_actual) === 0 ? "text-error font-bold" : "text-base-content/40"
                    )}>
                      Stock: {parseFloat(r.stock_actual)} / {parseFloat(r.stock_seguridad)}
                    </p>
                    {yaPedido === 0 && (
                      <p className="text-[9px] text-base-content/35 font-medium">Sug: {sugLabel}</p>
                    )}
                  </div>

                  {yaPedido > 0 && (
                    <div className={cn(
                      "flex items-center gap-1.5 text-[9px] font-bold rounded-lg px-2 py-1",
                      cubierto
                        ? "bg-success/10 text-success border border-success/20"
                        : "bg-info/10 text-info border border-info/20"
                    )}>
                      <span>📦</span>
                      <span className="tabular-nums">{Math.round(yaPedido)} {unidadEnCamino} en camino</span>
                      <span className="ml-auto font-medium opacity-70 shrink-0">
                        {cubierto ? '✓ cubierto' : `+ ${sugLabel} sug.`}
                      </span>
                    </div>
                  )}

                  <button
                    className={cn(
                      "btn btn-xs w-full rounded-xl gap-1 text-[10px] font-bold transition-all",
                      alreadyAdded
                        ? "btn-ghost cursor-default text-success pointer-events-none"
                        : isCritica
                          ? "bg-error/10 text-error border border-error/30 hover:bg-error hover:text-white hover:border-error"
                          : "btn-primary shadow-sm shadow-primary/20"
                    )}
                    onClick={() => !alreadyAdded && onAddFromRec(r)}
                    disabled={alreadyAdded}
                  >
                    {alreadyAdded
                      ? <><CheckCircle2 className="h-3 w-3" /> Agregado</>
                      : <><Plus className="h-3 w-3" /> Agregar</>
                    }
                  </button>
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
```

### Step 4: Crear `pedido-panel.tsx`

- [ ] **Crear `pedido-panel.tsx`**

```tsx
// frontend/src/pages/solicitudes-compra/components/pedido-panel.tsx
import { ShoppingCart, Plus, Minus, Trash2, CheckCircle2 } from 'lucide-react'
import { cn, formatCantidad } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ProductoImage } from '@/components/ui/producto-image'
import type { SolicitudItem, Proveedor } from '@/types'
import {
  HORIZONTE_CHIPS,
  calcularDiasCubiertos,
  pillClasses,
  pillText,
  unidadLabel,
  formatPesos,
  horizonLabel,
} from '../solicitud-utils'

interface PedidoPanelProps {
  proveedor: Proveedor
  items: SolicitudItem[]
  solicitudId: string | null
  isSaving: boolean
  isGuardando: boolean
  horizonteGlobal: number
  popoverOpenId: string | null
  monedaCodigo: string
  onUpdateQty: (pid: string, val: number) => void
  onRemove: (pid: string) => void
  onGlobalHorizonteChange: (dias: number) => void
  onHorizonteChip: (pid: string, dias: number) => void
  onResetHorizonteToGlobal: (pid: string) => void
  onPopoverToggle: (pid: string | null) => void
  onSaveBorrador: () => void
  onGuardar: () => void
}

export function PedidoPanel({
  proveedor,
  items,
  solicitudId,
  isSaving,
  isGuardando,
  horizonteGlobal,
  popoverOpenId,
  monedaCodigo,
  onUpdateQty,
  onRemove,
  onGlobalHorizonteChange,
  onHorizonteChip,
  onResetHorizonteToGlobal,
  onPopoverToggle,
  onSaveBorrador,
  onGuardar,
}: PedidoPanelProps) {
  const fmt = (v: number | string | null) => formatPesos(v, monedaCodigo)
  const totalEstimado = items.reduce((acc, i) => {
    const precio = i.presentacion_id && i.factor_conversion
      ? i.precio_unitario * i.factor_conversion
      : i.precio_unitario
    return acc + i.cantidad * precio
  }, 0)

  return (
    <div className="flex flex-col bg-base-100 rounded-[2.5rem] border border-base-300 shadow-2xl overflow-hidden relative min-w-0 min-h-0">
      {/* Header */}
      <div className="px-4 py-3 border-b border-base-200 bg-primary/5 space-y-2 shrink-0">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-1.5 bg-primary text-primary-content rounded-xl shadow-md shrink-0">
              <ShoppingCart className="h-3.5 w-3.5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-xs font-bold leading-tight truncate">
                Pedido · {proveedor.nombre}
              </h2>
              <p className="text-[9px] font-bold uppercase tracking-widest text-primary/50">
                {items.length} {items.length === 1 ? 'producto' : 'productos'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {solicitudId && (
              <Badge className="bg-success/10 text-success border-success/20 px-2 py-0.5 text-[9px]">
                Guardado
              </Badge>
            )}
          </div>
        </div>

        {/* Chips de horizonte global */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[9px] font-bold opacity-35 uppercase tracking-wider shrink-0">Cubrir:</span>
          {HORIZONTE_CHIPS.map(d => (
            <button
              key={d}
              onClick={() => onGlobalHorizonteChange(d)}
              className={cn(
                "px-2 py-0.5 rounded-full text-[9px] font-bold border transition-all",
                horizonteGlobal === d
                  ? "bg-primary text-primary-content border-primary shadow-sm"
                  : "bg-base-100 text-base-content/50 border-base-300 hover:border-primary/40 hover:text-primary"
              )}
            >
              {horizonLabel(d)}
            </button>
          ))}
        </div>
      </div>

      {/* Lista de items */}
      <div className="flex-1 overflow-y-auto p-3 space-y-1 custom-scrollbar min-h-0">
        {items.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center opacity-25 p-8 gap-3">
            <div className="w-12 h-12 bg-base-200 rounded-full flex items-center justify-center">
              <Plus className="h-6 w-6" />
            </div>
            <div>
              <p className="font-bold text-sm">Lista vacía</p>
              <p className="text-xs mt-0.5">Agrega desde las sugerencias o el buscador.</p>
            </div>
          </div>
        ) : (
          items.map(item => {
            const diasCubiertos = calcularDiasCubiertos(item)
            const esPersonalizado = item.horizonte_personalizado === true
            const popoverAbierto = popoverOpenId === item.producto_id
            const hasPres = !!(item.presentacion_id && item.factor_conversion)

            return (
              <div
                key={item.producto_id}
                className="flex items-center gap-2 px-3 py-1.5 hover:bg-base-200/50 border border-transparent hover:border-primary/10 transition-all rounded-xl group"
              >
                {item.imagen_url && (
                  <ProductoImage src={item.imagen_url} size="sm" className="shrink-0" />
                )}

                <span className="flex-1 min-w-0 font-medium text-xs truncate">
                  {item.producto_nombre}
                </span>

                {/* Pill de cobertura */}
                <div className="relative shrink-0" data-popover-item>
                  <button
                    onClick={() => onPopoverToggle(popoverAbierto ? null : item.producto_id)}
                    className={cn(
                      "text-[10px] font-bold border rounded-full px-2.5 py-1 whitespace-nowrap transition-all hover:opacity-80",
                      pillClasses(diasCubiertos, esPersonalizado)
                    )}
                  >
                    {pillText(diasCubiertos, esPersonalizado)}
                  </button>
                  {popoverAbierto && (
                    <div className="absolute top-full right-0 mt-1.5 z-50 bg-base-100 border border-base-300 rounded-2xl shadow-2xl p-3 min-w-[220px]">
                      <p className="text-[10px] font-bold opacity-60 uppercase tracking-wider mb-2">
                        Ajustar horizonte
                      </p>
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {HORIZONTE_CHIPS.map(d => (
                          <button
                            key={d}
                            onClick={() => onHorizonteChip(item.producto_id, d)}
                            className={cn(
                              "px-2.5 py-1 rounded-full text-[10px] font-bold border transition-all",
                              item.horizonte_dias === d
                                ? "bg-primary text-primary-content border-primary"
                                : "bg-base-100 text-base-content/50 border-base-300 hover:border-primary/40"
                            )}
                          >
                            {horizonLabel(d)}
                            {d === horizonteGlobal && item.horizonte_dias !== d && (
                              <span className="ml-1 opacity-50 text-[8px]">global</span>
                            )}
                          </button>
                        ))}
                      </div>
                      {esPersonalizado && (
                        <button
                          onClick={() => onResetHorizonteToGlobal(item.producto_id)}
                          className="text-[10px] text-primary hover:underline w-full text-left opacity-70"
                        >
                          ↩ Usar global ({horizonteGlobal}d)
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Control de cantidad */}
                <div className="flex items-center bg-base-100 rounded-lg border border-base-300 p-0.5 shadow-inner shrink-0">
                  <button
                    className="btn btn-ghost btn-xs btn-circle h-5 w-5 min-h-0"
                    onClick={() => onUpdateQty(item.producto_id, item.cantidad - 1)}
                  >
                    <Minus className="h-2.5 w-2.5" />
                  </button>
                  <input
                    type="number"
                    className="w-9 text-center text-xs font-black bg-transparent focus:outline-none no-spinners"
                    value={item.cantidad}
                    onChange={e => onUpdateQty(item.producto_id, parseInt(e.target.value) || 1)}
                  />
                  <button
                    className="btn btn-ghost btn-xs btn-circle h-5 w-5 min-h-0"
                    onClick={() => onUpdateQty(item.producto_id, item.cantidad + 1)}
                  >
                    <Plus className="h-2.5 w-2.5" />
                  </button>
                </div>

                <span className="text-[10px] font-bold text-primary w-14 truncate shrink-0">
                  {unidadLabel(item, item.cantidad)}
                </span>

                <div className="text-right w-24 shrink-0">
                  {hasPres ? (
                    <>
                      <p className="text-[10px] font-bold font-mono truncate">
                        {item.precio_unitario > 0
                          ? `${fmt(item.precio_unitario * item.factor_conversion!)} / ${item.presentacion_nombre ?? 'pres.'}`
                          : <span className="opacity-30">—</span>
                        }
                      </p>
                      <p className="text-[9px] opacity-35 truncate">
                        {formatCantidad(item.factor_conversion!, item.unidad_base, item.unidad_base_plural ?? undefined)}
                      </p>
                    </>
                  ) : (
                    <p className="text-[10px] font-bold font-mono truncate">
                      {item.precio_unitario > 0
                        ? `${fmt(item.precio_unitario)} / ${item.unidad_base}`
                        : <span className="opacity-30">—</span>
                      }
                    </p>
                  )}
                </div>

                <button
                  className="btn btn-ghost btn-xs btn-circle text-error opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                  onClick={() => onRemove(item.producto_id)}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            )
          })
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 bg-base-200/50 border-t border-base-300 space-y-2.5 shrink-0">
        <div className="flex justify-between items-center">
          <span className="opacity-40 uppercase tracking-widest text-[9px] font-bold">Costo Estimado</span>
          <span className="text-base font-black flex items-center gap-1.5">
            {fmt(totalEstimado)}
            <span className="badge badge-ghost badge-xs font-mono">{monedaCodigo}</span>
          </span>
        </div>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="rounded-xl h-9 text-xs font-medium px-3 opacity-50 hover:opacity-100 shrink-0"
            onClick={onSaveBorrador}
            disabled={items.length === 0 || isSaving}
            title="Guarda el progreso para continuar más tarde"
          >
            {isSaving ? <span className="loading loading-spinner loading-xs" /> : 'Pausar'}
          </Button>
          <Button
            className="rounded-xl h-9 font-bold gap-2 shadow-md shadow-primary/20 flex-1"
            disabled={items.length === 0 || isGuardando}
            onClick={onGuardar}
          >
            {isGuardando
              ? <span className="loading loading-spinner loading-sm" />
              : <><CheckCircle2 className="h-4 w-4" /> Finalizar solicitud</>
            }
          </Button>
        </div>
      </div>
    </div>
  )
}
```

### Step 5: Crear `historial-view.tsx`

- [ ] **Crear `historial-view.tsx`**

```tsx
// frontend/src/pages/solicitudes-compra/components/historial-view.tsx
import { Search, ArrowRight, User } from 'lucide-react'
import { cn, formatDate } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import type { SolicitudResumen } from '@/types'

interface HistorialViewProps {
  solicitudes: SolicitudResumen[] | undefined
  isLoading: boolean
  search: string
  onSearchChange: (v: string) => void
  onSelectSolicitud: (id: string) => void
}

export function HistorialView({
  solicitudes,
  isLoading,
  search,
  onSearchChange,
  onSelectSolicitud,
}: HistorialViewProps) {
  return (
    <div className="flex-1 bg-base-100 rounded-[2rem] border border-base-300 shadow-sm overflow-hidden flex flex-col">
      <div className="p-6 border-b border-base-200 bg-base-200/20 flex items-center gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 opacity-30" />
          <Input
            placeholder="Buscar por N° documento o usuario..."
            className="pl-10 h-10 rounded-xl"
            value={search}
            onChange={e => onSearchChange(e.target.value)}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {isLoading ? (
          <div className="p-10 text-center">
            <span className="loading loading-spinner loading-lg text-primary opacity-20" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table table-md table-zebra w-full">
              <thead className="bg-base-200/50 sticky top-0 z-10">
                <tr className="border-b border-base-300">
                  <th className="text-[10px] font-black uppercase tracking-widest opacity-40">Documento</th>
                  <th className="text-[10px] font-black uppercase tracking-widest opacity-40">Fecha</th>
                  <th className="text-[10px] font-black uppercase tracking-widest opacity-40">Usuario</th>
                  <th className="text-[10px] font-black uppercase tracking-widest opacity-40 text-center">Items</th>
                  <th className="text-[10px] font-black uppercase tracking-widest opacity-40">Estado</th>
                  <th className="text-[10px] font-black uppercase tracking-widest opacity-40 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {solicitudes?.map(s => (
                  <tr
                    key={s.id}
                    className="hover:bg-primary/5 transition-colors cursor-pointer group"
                    onClick={() => onSelectSolicitud(s.id)}
                  >
                    <td className="font-bold text-sm">{s.numero_documento}</td>
                    <td className="text-xs opacity-60">{formatDate(s.fecha_creacion)}</td>
                    <td className="text-xs font-medium">
                      <div className="flex items-center gap-2">
                        <User className="h-3 w-3" /> {s.usuario_nombre}
                      </div>
                    </td>
                    <td className="text-center font-mono text-sm">{s.items_count}</td>
                    <td>
                      <Badge variant="outline" className={cn(
                        "capitalize font-bold px-3 py-1",
                        s.estado === 'aprobada'  ? 'bg-success/10 text-success border-success/30' :
                        s.estado === 'pendiente' ? 'bg-warning/10 text-warning border-warning/30' :
                        s.estado === 'rechazada' ? 'bg-error/10 text-error border-error/30' :
                        s.estado === 'enviada'   ? 'bg-info/10 text-info border-info/30' :
                        'bg-base-200 text-base-content/50 border-base-300'
                      )}>
                        {s.estado}
                      </Badge>
                    </td>
                    <td className="text-right">
                      <button className="btn btn-ghost btn-sm btn-circle opacity-0 group-hover:opacity-100 transition-opacity">
                        <ArrowRight className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
```

### Step 6: Crear `detalle-modal.tsx`

- [ ] **Crear `detalle-modal.tsx`**

```tsx
// frontend/src/pages/solicitudes-compra/components/detalle-modal.tsx
import { FileDown } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog } from '@/components/ui/dialog'
import { exportarSolicitudPDF } from '@/lib/solicitud-pdf'
import { formatPesos } from '../solicitud-utils'
import type { SolicitudDetalle } from '@/types'

interface DetalleModalProps {
  solicitudId: string | null
  detail: SolicitudDetalle | undefined
  isLoading: boolean
  pdfFirmaLabel: string
  monedaCodigo: string
  monedaSimbolo: string
  nombreLaboratorio: string
  logoBase64?: string | null
  onClose: () => void
  onPdfFirmaChange: (v: string) => void
}

export function DetalleModal({
  solicitudId,
  detail,
  isLoading,
  pdfFirmaLabel,
  monedaCodigo,
  monedaSimbolo,
  nombreLaboratorio,
  logoBase64,
  onClose,
  onPdfFirmaChange,
}: DetalleModalProps) {
  const fmt = (v: number | string | null) => formatPesos(v, monedaCodigo)

  const calcTotal = (items: SolicitudDetalle['items']) =>
    items.reduce((acc, i) => {
      const qty = parseFloat(i.cantidad_sugerida)
      const fc = i.factor_conversion ? parseFloat(i.factor_conversion) : null
      const pu = i.precio_unitario ? parseFloat(i.precio_unitario) : 0
      return acc + qty * (i.presentacion_id && fc ? pu * fc : pu)
    }, 0)

  const handleExportPDF = () => {
    if (!detail) return
    const subtotal = calcTotal(detail.items)
    const iva = subtotal * 0.19
    exportarSolicitudPDF({
      numero_documento: detail.numero_documento,
      fecha_creacion: detail.fecha_creacion,
      usuario_nombre: detail.usuario_nombre,
      nota: detail.nota,
      subtotal_neto: subtotal,
      iva,
      total_con_iva: subtotal + iva,
      nombreLaboratorio,
      logoBase64: logoBase64 ?? null,
      monedaSimbolo,
      firma_solicitante_label: pdfFirmaLabel || null,
      items: detail.items.map(i => ({
        producto_nombre: i.producto_nombre,
        cantidad_sugerida: parseFloat(i.cantidad_sugerida),
        unidad: i.unidad,
        unidad_plural: i.unidad_plural,
        codigo_maestro: i.codigo_maestro,
        codigo_proveedor: i.codigo_proveedor,
        presentacion_nombre: i.presentacion_nombre,
        presentacion_nombre_plural: i.presentacion_nombre_plural,
        factor_conversion: i.factor_conversion ? parseFloat(i.factor_conversion) : null,
        cantidad_presentaciones: i.cantidad_presentaciones ? parseFloat(i.cantidad_presentaciones) : null,
        precio_unitario: i.precio_unitario ? parseFloat(i.precio_unitario) : null,
      })),
    })
  }

  if (!solicitudId) return null

  return (
    <Dialog
      open={!!solicitudId}
      onClose={onClose}
      title={`Detalle Solicitud ${detail?.numero_documento || ''}`}
      className="max-w-4xl"
    >
      {isLoading ? (
        <div className="py-20 text-center"><span className="loading loading-spinner loading-lg" /></div>
      ) : detail && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-base-200/50 rounded-2xl">
            <div>
              <p className="text-[10px] font-black uppercase opacity-40">Estado</p>
              <p className="font-bold capitalize">{detail.estado}</p>
            </div>
            <div>
              <p className="text-[10px] font-black uppercase opacity-40">Solicitado por</p>
              <p className="font-bold">{detail.usuario_nombre}</p>
            </div>
            <div>
              <p className="text-[10px] font-black uppercase opacity-40">Fecha</p>
              <p className="font-bold">{formatDate(detail.fecha_creacion)}</p>
            </div>
          </div>

          <div className="overflow-hidden border border-base-300 rounded-2xl">
            <table className="table table-zebra table-sm">
              <thead className="bg-base-200">
                <tr>
                  <th>Producto</th>
                  <th>Proveedor</th>
                  <th className="text-center">Cant.</th>
                  <th>Unidad</th>
                  <th className="text-right">Precio c/u</th>
                  <th className="text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {detail.items.map((item, idx) => {
                  const cant = parseFloat(item.cantidad_sugerida)
                  const fc = item.factor_conversion ? parseFloat(item.factor_conversion) : null
                  const hasPres = !!(item.presentacion_id && fc)
                  const puBase = item.precio_unitario ? parseFloat(item.precio_unitario) : 0
                  const precioUnit = hasPres ? puBase * fc! : puBase
                  return (
                    <tr key={idx}>
                      <td className="font-bold text-xs">{item.producto_nombre}</td>
                      <td className="text-[10px] opacity-60">{item.proveedor_nombre}</td>
                      <td className="text-center font-bold">{cant}</td>
                      <td className="text-[10px] uppercase font-bold opacity-50">
                        {item.presentacion_nombre || item.unidad}
                      </td>
                      <td className="text-right">
                        <p className="font-mono text-[11px] font-bold">
                          {precioUnit > 0 ? fmt(precioUnit) : <span className="opacity-30">—</span>}
                        </p>
                        {precioUnit > 0 && (
                          <p className="text-[9px] opacity-35 font-medium">
                            / {hasPres ? (item.presentacion_nombre ?? 'pres.') : item.unidad}
                          </p>
                        )}
                      </td>
                      <td className="text-right font-bold text-xs">{fmt(cant * precioUnit)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {detail.nota && (
            <div className="p-4 bg-primary/5 rounded-2xl border border-primary/10">
              <p className="text-[10px] font-black uppercase opacity-40 mb-1">Nota</p>
              <p className="text-sm italic">"{detail.nota}"</p>
            </div>
          )}

          <div className="p-4 bg-base-200/50 rounded-2xl border border-base-300 space-y-3">
            <p className="text-[10px] font-black uppercase tracking-widest opacity-40 flex items-center gap-1.5">
              <FileDown className="h-3 w-3" /> Configurar firma del PDF
            </p>
            <div className="space-y-1 max-w-xs">
              <label className="text-[10px] font-bold opacity-50">Nombre solicitante</label>
              <Input
                placeholder={detail.usuario_nombre}
                value={pdfFirmaLabel}
                onChange={e => onPdfFirmaChange(e.target.value)}
                className="h-8 rounded-xl text-xs"
              />
            </div>
          </div>

          <div className="flex justify-between items-center pt-2 border-t">
            <div className="text-xl font-black flex items-center gap-2">
              <span className="text-xs opacity-40 font-bold uppercase mr-1">Total Estimado:</span>
              {fmt(calcTotal(detail.items))}
              <span className="badge badge-ghost badge-xs font-mono">{monedaCodigo}</span>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="rounded-xl h-10 gap-2" onClick={handleExportPDF}>
                <FileDown className="h-4 w-4" /> PDF
              </Button>
              <Button className="rounded-xl h-10" onClick={onClose}>Cerrar</Button>
            </div>
          </div>
        </div>
      )}
    </Dialog>
  )
}
```

### Step 7: Reemplazar `index.tsx` con la versión orquestadora

- [ ] **Reemplazar `index.tsx` completo**

```tsx
// frontend/src/pages/solicitudes-compra/index.tsx
import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useLocation, useSearchParams } from 'react-router-dom'
import { ShoppingCart, Plus, History, Clock, Mail, Phone, ChevronLeft } from 'lucide-react'
import { toast } from 'sonner'
import api from '@/lib/api'
import { autoPlural, cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
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

import { calcularCantidad, fetchHorizonte } from './solicitud-utils'
import { ProveedorGallery } from './components/proveedor-gallery'
import { QuiebresPanelIzquierdo } from './components/quiebres-panel'
import { PedidoPanel } from './components/pedido-panel'
import { HistorialView } from './components/historial-view'
import { DetalleModal } from './components/detalle-modal'

export default function SolicitudesCompraPage() {
  useAuthStore()
  const queryClient = useQueryClient()
  const location = useLocation()
  const [searchParams] = useSearchParams()

  const [view, setView] = useState<'crear' | 'historial'>('crear')
  const [selectedProveedor, setSelectedProveedor] = useState<Proveedor | null>(null)
  const [items, setItems] = useState<SolicitudItem[]>([])
  const [solicitudId, setSolicitudId] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [historialSearch, setHistorialSearch] = useState('')
  const [selectedSolicitudId, setSelectedSolicitudId] = useState<string | null>(null)
  const [pdfFirmaLabel, setPdfFirmaLabel] = useState('')
  const [horizonteGlobal, setHorizonteGlobal] = useState<number>(30)
  const [tabIzquierdo, setTabIzquierdo] = useState<'quiebres' | 'buscar'>('buscar')
  const [popoverOpenId, setPopoverOpenId] = useState<string | null>(null)
  const [restaurando, setRestaurando] = useState(true)
  const borradorCargado = useRef(false)

  useEffect(() => {
    if (location.state?.view) setView(location.state.view)
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
    queryKey: ['solicitudes-historial', historialSearch],
    queryFn: () =>
      api.get<PaginatedResponse<SolicitudResumen>>('/solicitudes-compra', {
        params: { q: historialSearch || undefined },
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
    const productoId = searchParams.get('select')

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
          unidad_base_plural: item.unidad_plural ?? autoPlural(item.unidad),
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

        if (productoId && !borradorItems.some(i => i.producto_id === productoId)) {
          try {
            const res2 = await api.get<Producto>(`/productos/${productoId}`)
            const p = res2.data
            if (p) {
              const newItem: SolicitudItem = {
                producto_id: p.id,
                producto_nombre: p.nombre,
                codigo_proveedor: p.codigo_proveedor,
                codigo_maestro: p.codigo_maestro,
                proveedor_id: p.proveedor_id,
                proveedor_nombre: 'Manual',
                lead_time: p.lead_time_propio || 0,
                presentacion_id: null,
                presentacion_nombre: null,
                presentacion_nombre_plural: null,
                factor_conversion: null,
                unidad_base: 'u',
                unidad_base_plural: 'u',
                cantidad: 1,
                precio_unitario: p.precio_unidad ? parseFloat(String(p.precio_unidad)) : 0,
                imagen_url: (p as Producto & { imagen_url?: string | null }).imagen_url,
                consumo_diario: 0,
                stock_actual: 0,
                stock_minimo: 0,
                horizonte_dias: null,
                horizonte_sugerido: null,
                horizonte_razon: null,
              }
              setItems([...borradorItems, newItem])
            } else {
              setItems(borradorItems)
            }
          } catch {
            setItems(borradorItems)
          }
        } else {
          setItems(borradorItems)
        }
      } catch (err) { console.warn('[solicitudes] Error restaurando borrador:', err) }
      setRestaurando(false)
    }

    restaurar()
  }, [view, searchParams])

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
    const cantidad = calcularCantidad(horizonteGlobal, consumoDiario, r.lead_time, stockMinimo, stockActual, factorConv)

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
      unidad_base_plural: r.unidad_base_plural || autoPlural(r.unidad_base),
      cantidad,
      precio_unitario: r.precio_ultima_recepcion ? parseFloat(r.precio_ultima_recepcion.toString()) : 0,
      imagen_url: r.imagen_url,
      consumo_diario: consumoDiario,
      stock_actual: stockActual,
      stock_minimo: stockMinimo,
      horizonte_dias: horizonteGlobal,
      horizonte_sugerido: horizData.horizonte_sugerido,
      horizonte_razon: horizData.razon,
      horizonte_personalizado: false,
    }])
  }

  const handleAddFromSearch = async (p: Producto) => {
    if (items.find(i => i.producto_id === p.id)) {
      toast.error('Producto ya está en la lista')
      return
    }
    type ProductoExt = Producto & {
      imagen_url?: string | null
      unidad_base?: { id: number; nombre: string; nombre_plural: string }
      proveedor?: { id: number; nombre: string; icono?: string | null }
      pres_id?: number | null
      pres_nombre?: string | null
      pres_nombre_plural?: string | null
      pres_factor?: string | null
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

  const handleSelectProveedor = async (p: Proveedor) => {
    if (items.length > 0) {
      setItems([])
      setSolicitudId(null)
      toast('Lista anterior limpiada', { icon: '↩' })
    }
    localStorage.setItem('solicitud_proveedor_id', String(p.id))
    setSelectedProveedor(p)

    const prefillIds = searchParams.get('prefill')?.split(',').filter(Boolean) ?? []
    if (prefillIds.length === 0) return

    type ProductoExt = Producto & { imagen_url?: string | null; unidad_base?: { nombre: string; nombre_plural: string } }
    const prefillItems: SolicitudItem[] = []
    await Promise.allSettled(prefillIds.map(async (pid) => {
      try {
        const [horizData, prodRes] = await Promise.all([
          fetchHorizonte(pid, p.id),
          api.get<ProductoExt[]>('/productos', { params: { ids: pid, per_page: 1 } })
            .then(r => r.data[0])
            .catch(() => api.get<ProductoExt>(`/productos/${pid}`).then(r => r.data)),
        ])
        const prod = prodRes
        if (!prod) return
        const consumoDiario = horizData.consumo_diario ?? 0
        const leadTime = prod.lead_time_propio ?? 0
        const cantidad = calcularCantidad(horizonteGlobal, consumoDiario, leadTime, horizData.stock_minimo ?? 0, horizData.stock_actual ?? 0)
        prefillItems.push({
          producto_id: prod.id,
          producto_nombre: prod.nombre,
          codigo_proveedor: prod.codigo_proveedor,
          codigo_maestro: prod.codigo_maestro,
          proveedor_id: p.id,
          proveedor_nombre: p.nombre,
          lead_time: leadTime,
          presentacion_id: null,
          presentacion_nombre: null,
          presentacion_nombre_plural: null,
          factor_conversion: null,
          unidad_base: prod.unidad_base?.nombre ?? 'u',
          unidad_base_plural: prod.unidad_base?.nombre_plural ?? 'u',
          cantidad,
          precio_unitario: prod.precio_unidad ? parseFloat(String(prod.precio_unidad)) : 0,
          imagen_url: prod.imagen_url ?? null,
          consumo_diario: consumoDiario,
          stock_actual: horizData.stock_actual ?? 0,
          stock_minimo: horizData.stock_minimo ?? 0,
          horizonte_dias: horizonteGlobal,
          horizonte_sugerido: horizData.horizonte_sugerido ?? null,
          horizonte_razon: horizData.razon ?? null,
          horizonte_personalizado: false,
        })
      } catch { /* ignorar items que fallen */ }
    }))

    if (prefillItems.length > 0) {
      setItems(prefillItems)
      toast.success(`${prefillItems.length} ${prefillItems.length === 1 ? 'producto precargado' : 'productos precargados'} desde Stock`)
    }
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
    if (r.nivel_urgencia === 'critica') acc[pid].criticos++
    return acc
  }, {})

  // ─────────────────────────────────────────────────────────────────────────────

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
        <div className="tabs tabs-boxed bg-base-200 p-1 rounded-2xl self-start">
          <button
            className={cn("tab gap-2 rounded-xl transition-all px-6 h-10", view === 'crear' ? "tab-active bg-primary text-primary-content font-bold shadow-lg" : "hover:bg-base-300")}
            onClick={() => setView('crear')}
          >
            <Plus className="h-4 w-4" /> Nueva
          </button>
          <button
            className={cn("tab gap-2 rounded-xl transition-all px-6 h-10", view === 'historial' ? "tab-active bg-primary text-primary-content font-bold shadow-lg" : "hover:bg-base-300")}
            onClick={() => setView('historial')}
          >
            <History className="h-4 w-4" /> Historial
          </button>
        </div>
      </div>

      {view === 'crear' && restaurando ? (
        <div className="flex-1 grid grid-cols-[30%_1fr] gap-4 min-h-0 animate-pulse">
          <div className="bg-base-200/60 rounded-[2rem]" />
          <div className="flex flex-col gap-3">
            <div className="h-16 bg-base-200/60 rounded-2xl" />
            <div className="flex-1 bg-base-200/60 rounded-[2.5rem]" />
          </div>
        </div>
      ) : view === 'crear' ? (
        selectedProveedor === null ? (
          <ProveedorGallery
            proveedores={proveedores}
            isLoading={isLoadingProveedores}
            urgenciasByProveedor={urgenciasByProveedor}
            logoBase64={configuracion?.logo_base64}
            onSelect={handleSelectProveedor}
          />
        ) : (
          <div className="flex-1 flex flex-col gap-4 min-h-0">
            {/* Banner proveedor */}
            <div className="flex items-center gap-4 px-5 py-3 bg-primary/5 border border-primary/15 rounded-2xl shrink-0">
              <div className="w-10 h-10 rounded-xl overflow-hidden shrink-0 flex items-center justify-center bg-base-200 text-2xl">
                {selectedProveedor.icono
                  ? <img src={selectedProveedor.icono} alt={selectedProveedor.nombre} className="h-full w-full object-contain" />
                  : '🏭'}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm">{selectedProveedor.nombre}</p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5">
                  <span className="text-[10px] opacity-40 font-medium uppercase tracking-wide">
                    {recsFiltered.length > 0 ? `${recsFiltered.length} quiebre${recsFiltered.length !== 1 ? 's' : ''}` : 'Sin quiebres'}
                  </span>
                  {(selectedProveedor.dias_despacho_tierra || selectedProveedor.dias_despacho_aereo) && (
                    <span className="text-[10px] opacity-40 flex items-center gap-0.5">
                      <Clock className="h-2.5 w-2.5" />
                      {selectedProveedor.dias_despacho_tierra ?? selectedProveedor.dias_despacho_aereo}d despacho
                    </span>
                  )}
                  {selectedProveedor.contacto && (
                    <span className="text-[10px] opacity-40 truncate">👤 {selectedProveedor.contacto}</span>
                  )}
                  {selectedProveedor.telefono && (
                    <span className="text-[10px] opacity-40 flex items-center gap-0.5">
                      <Phone className="h-2.5 w-2.5" /> {selectedProveedor.telefono}
                    </span>
                  )}
                  {selectedProveedor.email && (
                    <span className="text-[10px] opacity-40 flex items-center gap-0.5">
                      <Mail className="h-2.5 w-2.5" /> {selectedProveedor.email}
                    </span>
                  )}
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="rounded-xl h-8 gap-1.5 text-xs shrink-0"
                onClick={handleCambiarProveedor}
              >
                <ChevronLeft className="h-3.5 w-3.5" /> Cambiar
              </Button>
            </div>

            {/* Panel dual */}
            <div className="flex-1 grid grid-cols-[30%_1fr] gap-4 min-h-0">
              <QuiebresPanelIzquierdo
                proveedor={selectedProveedor}
                recomendaciones={recsFiltered}
                isLoadingRecs={isLoadingRecs}
                itemsEnPedido={items}
                tab={tabIzquierdo}
                monedaCodigo={monedaCodigo}
                onTabChange={setTabIzquierdo}
                onAddFromRec={handleAddFromRec}
                onAddFromSearch={handleAddFromSearch}
              />
              <PedidoPanel
                proveedor={selectedProveedor}
                items={items}
                solicitudId={solicitudId}
                isSaving={isSaving}
                isGuardando={guardarMutation.isPending}
                horizonteGlobal={horizonteGlobal}
                popoverOpenId={popoverOpenId}
                monedaCodigo={monedaCodigo}
                onUpdateQty={handleUpdateQty}
                onRemove={handleRemove}
                onGlobalHorizonteChange={handleGlobalHorizonteChange}
                onHorizonteChip={handleHorizonteChip}
                onResetHorizonteToGlobal={handleResetHorizonteToGlobal}
                onPopoverToggle={setPopoverOpenId}
                onSaveBorrador={handleSaveBorrador}
                onGuardar={() => guardarMutation.mutate()}
              />
            </div>
          </div>
        )
      ) : (
        <HistorialView
          solicitudes={historial?.data}
          isLoading={isLoadingHistorial}
          search={historialSearch}
          onSearchChange={setHistorialSearch}
          onSelectSolicitud={setSelectedSolicitudId}
        />
      )}

      <DetalleModal
        solicitudId={selectedSolicitudId}
        detail={detail}
        isLoading={isLoadingDetail}
        pdfFirmaLabel={pdfFirmaLabel}
        monedaCodigo={monedaCodigo}
        monedaSimbolo={configuracion?.moneda_simbolo ?? '$'}
        nombreLaboratorio={configuracion?.nombre_laboratorio ?? 'Laboratorio Clínico'}
        logoBase64={configuracion?.logo_base64}
        onClose={() => { setSelectedSolicitudId(null); setPdfFirmaLabel('') }}
        onPdfFirmaChange={setPdfFirmaLabel}
      />
    </div>
  )
}
```

- [ ] **Step 8: Verificar que compila TypeScript**

```bash
cd "C:/Users/Desarrollo/Documents/14 marzo inventario/frontend"
npx tsc --noEmit 2>&1 | head -40
```

Esperado: sin errores (o solo errores preexistentes no relacionados con estos archivos).

- [ ] **Step 9: Verificar que el dev server arranca**

```bash
cd "C:/Users/Desarrollo/Documents/14 marzo inventario/frontend"
npm run dev
```

Navegar a `http://localhost:5173/solicitudes-compra` y verificar que la galería de proveedores, los paneles y el historial funcionan.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/pages/solicitudes-compra/
git commit -m "refactor(solicitudes): partir index.tsx (1501L) en 5 componentes + utils"
```

---

## Task 7: Frontend — Corregir tipo `any[]` en `ConteoDetalle`

**Problema:** `frontend/src/types/index.ts:275` tiene `presentaciones: any[]` con un `// TODO`. Esto desactiva el chequeo de tipos para esa propiedad.

**Files:**
- Modificar: `frontend/src/types/index.ts`

- [ ] **Step 1: Verificar qué tipo `Presentacion` está disponible en generated.ts**

```bash
grep -n "Presentacion\|presentacion" "C:/Users/Desarrollo/Documents/14 marzo inventario/frontend/src/types/generated.ts" | head -20
```

Si existe `Presentacion` (con campos `id`, `nombre`, `nombre_plural`, `factor_conversion`, etc.) en `generated.ts`, usar ese tipo.

- [ ] **Step 2: Verificar el uso real de `ConteoDetalle.presentaciones`**

```bash
grep -rn "\.presentaciones" "C:/Users/Desarrollo/Documents/14 marzo inventario/frontend/src/" --include="*.tsx" --include="*.ts"
```

Tomar nota de los campos accedidos en los resultados para confirmar la forma del tipo.

- [ ] **Step 3: Actualizar el tipo**

Si `Presentacion` existe en `generated.ts`, en `frontend/src/types/index.ts` reemplazar:

```typescript
export interface ConteoDetalle {
  sesion: SesionConteo
  nota: string | null
  items: ConteoItem[]
  presentaciones: any[] // TODO: Usar Presentacion de generated
}
```

por:

```typescript
export interface ConteoDetalle {
  sesion: SesionConteo
  nota: string | null
  items: ConteoItem[]
  presentaciones: Presentacion[]
}
```

Si `Presentacion` NO existe en `generated.ts`, definir el tipo mínimo necesario basado en los campos que se acceden (resultado del grep del paso anterior):

```typescript
export interface ConteoDetalle {
  sesion: SesionConteo
  nota: string | null
  items: ConteoItem[]
  presentaciones: {
    id: number
    nombre: string
    nombre_plural: string
    factor_conversion: number
    codigo_barras: string | null
    activa: boolean
  }[]
}
```

- [ ] **Step 4: Verificar TypeScript**

```bash
cd "C:/Users/Desarrollo/Documents/14 marzo inventario/frontend"
npx tsc --noEmit 2>&1 | grep "ConteoDetalle\|presentaciones" | head -10
```

Esperado: sin errores sobre `ConteoDetalle`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/types/index.ts
git commit -m "fix(types): reemplazar any[] por tipo concreto en ConteoDetalle.presentaciones"
```

---

## Resumen de commits esperados

```
fix(db): unique parcial para borrador por usuario en solicitudes_compra
refactor(solicitudes): QueryBuilder en listar() elimina bind_idx manual
fix(unidades): crear() separa insert/reactivar, elimina upsert silencioso
fix(areas): eliminar() retorna EliminarResultado con mensaje diferenciado
chore(errors): eliminar validate_email y EMAIL_RE no usados
refactor(solicitudes): partir index.tsx (1501L) en 5 componentes + utils
fix(types): reemplazar any[] por tipo concreto en ConteoDetalle.presentaciones
```
