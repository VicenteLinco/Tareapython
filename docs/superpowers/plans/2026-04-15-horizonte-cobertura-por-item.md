# Horizonte de Cobertura por Ítem Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar un horizonte de cobertura configurable por ítem en solicitudes de compra, con sugerencia inteligente basada en ciclo histórico, variabilidad de consumo y lead time del proveedor.

**Architecture:** Nuevo endpoint `GET /solicitudes-compra/horizonte` que calcula la sugerencia en Rust usando 3 queries SQL simples. Tres columnas nuevas en `solicitud_compra_detalle` persisten la decisión para auditoría. El frontend consume el endpoint al agregar ítems y renderiza chips interactivos (nuevo componente `HorizonteChips`) que recalculan la cantidad al hacer click.

**Tech Stack:** Rust + Axum + SQLx (backend), React 19 + TypeScript + Tailwind + DaisyUI (frontend), PostgreSQL 16, jsPDF (PDF).

---

## File Map

| Archivo | Acción | Responsabilidad |
|---------|--------|-----------------|
| `backend/migrations/043_horizonte_dias_solicitud.sql` | Crear | Añade 3 columnas a `solicitud_compra_detalle` |
| `backend/src/dto/solicitud.rs` | Modificar | Añade campos horizonte a `CreateSolicitudItem` y `SolicitudDetalleItem` |
| `backend/src/handlers/solicitudes_compra.rs` | Modificar | Nuevo handler `horizonte_sugerido`, actualiza `insertar_item` y query de detalle |
| `frontend/src/types/index.ts` | Modificar | Añade 6 campos nuevos a `SolicitudItem` |
| `frontend/src/types/generated.ts` | Regenerar | Refleja los campos nuevos de `SolicitudDetalleItem` y `CreateSolicitudItem` |
| `frontend/src/pages/solicitudes-compra/components/horizonte-chips.tsx` | Crear | Componente de chips 7/15/30/90/180/365d + badge de razón |
| `frontend/src/pages/solicitudes-compra/index.tsx` | Modificar | Integra `HorizonteChips`, actualiza handlers, llama `/horizonte` al agregar |
| `frontend/src/lib/solicitud-pdf.ts` | Modificar | Muestra "cubre X días" en celda Cantidad |

---

## Task 1: Migración DB

**Files:**
- Create: `backend/migrations/043_horizonte_dias_solicitud.sql`

- [ ] **Crear el archivo de migración**

```sql
-- backend/migrations/043_horizonte_dias_solicitud.sql
ALTER TABLE solicitud_compra_detalle
  ADD COLUMN horizonte_dias       INTEGER,
  ADD COLUMN horizonte_sugerido   INTEGER,
  ADD COLUMN horizonte_razon      TEXT;

COMMENT ON COLUMN solicitud_compra_detalle.horizonte_dias
  IS 'Horizonte activo al guardar. NULL indica cantidad editada manualmente (ningún chip activo).';
COMMENT ON COLUMN solicitud_compra_detalle.horizonte_sugerido
  IS 'Horizonte calculado por el sistema al agregar el ítem. Inmutable.';
COMMENT ON COLUMN solicitud_compra_detalle.horizonte_razon
  IS 'Razón textual del horizonte sugerido. Inmutable.';
```

- [ ] **Aplicar la migración reconstruyendo el container**

```bash
docker compose up --build -d
```

Esperar hasta que el backend esté saludable:
```bash
docker compose logs backend --tail=20
```
Debe mostrar `Listening on 0.0.0.0:3000` sin errores.

- [ ] **Verificar que las columnas existen**

```bash
docker compose exec -T db psql -U lab_user -d inventario_lab -c "\d solicitud_compra_detalle"
```

Expected: columnas `horizonte_dias`, `horizonte_sugerido`, `horizonte_razon` presentes.

- [ ] **Commit**

```bash
git add backend/migrations/043_horizonte_dias_solicitud.sql
git commit -m "feat(db): añadir horizonte_dias/sugerido/razon a solicitud_compra_detalle"
```

---

## Task 2: Backend DTOs

**Files:**
- Modify: `backend/src/dto/solicitud.rs`

- [ ] **Añadir campos a `CreateSolicitudItem`**

Reemplazar el struct existente:
```rust
#[derive(Debug, Deserialize, Type)]
pub struct CreateSolicitudItem {
    pub producto_id: Uuid,
    pub cantidad_sugerida: Decimal,
    pub unidad: String,
    pub precio_unitario: Option<Decimal>,
    pub presentacion_id: Option<i32>,
    pub cantidad_presentaciones: Option<Decimal>,
    pub horizonte_dias: Option<i32>,
    pub horizonte_sugerido: Option<i32>,
    pub horizonte_razon: Option<String>,
}
```

- [ ] **Añadir campos a `SolicitudDetalleItem`**

Reemplazar el struct existente:
```rust
#[derive(Debug, Serialize, sqlx::FromRow, Type)]
pub struct SolicitudDetalleItem {
    pub producto_id: Uuid,
    pub producto_nombre: String,
    pub cantidad_sugerida: Decimal,
    pub unidad: String,
    pub codigo_proveedor: Option<String>,
    pub codigo_maestro: Option<String>,
    pub proveedor_nombre: Option<String>,
    pub presentacion_nombre: Option<String>,
    pub presentacion_nombre_plural: Option<String>,
    pub factor_conversion: Option<Decimal>,
    pub precio_unitario: Option<Decimal>,
    pub presentacion_id: Option<i32>,
    pub cantidad_presentaciones: Option<Decimal>,
    pub imagen_url: Option<String>,
    pub horizonte_dias: Option<i32>,
    pub horizonte_sugerido: Option<i32>,
    pub horizonte_razon: Option<String>,
}
```

- [ ] **Verificar que compila**

```bash
cd backend && cargo check 2>&1 | head -30
```

Expected: sin errores (puede haber warnings de campos sin usar, es normal).

- [ ] **Commit**

```bash
git add backend/src/dto/solicitud.rs
git commit -m "feat(dto): añadir campos horizonte a CreateSolicitudItem y SolicitudDetalleItem"
```

---

## Task 3: Backend Handler — actualizar `insertar_item` y query de detalle

**Files:**
- Modify: `backend/src/handlers/solicitudes_compra.rs`

- [ ] **Actualizar `insertar_item` para persistir los campos horizonte**

Reemplazar la función `insertar_item` completa:
```rust
async fn insertar_item(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    solicitud_id: Uuid,
    item: &CreateSolicitudItem,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO solicitud_compra_detalle
         (solicitud_id, producto_id, cantidad_sugerida, unidad,
          precio_unitario, presentacion_id, cantidad_presentaciones,
          horizonte_dias, horizonte_sugerido, horizonte_razon)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)"
    )
    .bind(solicitud_id)
    .bind(item.producto_id)
    .bind(item.cantidad_sugerida)
    .bind(&item.unidad)
    .bind(item.precio_unitario)
    .bind(item.presentacion_id)
    .bind(item.cantidad_presentaciones)
    .bind(item.horizonte_dias)
    .bind(item.horizonte_sugerido)
    .bind(&item.horizonte_razon)
    .execute(&mut **tx)
    .await?;
    Ok(())
}
```

- [ ] **Actualizar el SELECT en `obtener_solicitud_por_id` para devolver los campos horizonte**

Reemplazar la query de items dentro de `obtener_solicitud_por_id`:
```rust
    let items = sqlx::query_as::<_, SolicitudDetalleItem>(
        r#"SELECT
            d.producto_id,
            p.nombre as producto_nombre,
            d.cantidad_sugerida,
            d.unidad,
            p.codigo_proveedor,
            p.codigo_maestro,
            prov.nombre as proveedor_nombre,
            pres.nombre as presentacion_nombre,
            pres.nombre_plural as presentacion_nombre_plural,
            pres.factor_conversion,
            d.precio_unitario,
            d.presentacion_id,
            d.cantidad_presentaciones,
            p.imagen_url,
            d.horizonte_dias,
            d.horizonte_sugerido,
            d.horizonte_razon
           FROM solicitud_compra_detalle d
           JOIN productos p ON p.id = d.producto_id
           LEFT JOIN proveedores prov ON prov.id = p.proveedor_id
           LEFT JOIN presentaciones pres ON pres.id = d.presentacion_id
           WHERE d.solicitud_id = $1
           ORDER BY p.nombre"#,
    )
    .bind(id)
    .fetch_all(pool)
    .await?;
```

- [ ] **Verificar que compila**

```bash
cd backend && cargo check 2>&1 | head -30
```

Expected: sin errores.

- [ ] **Commit**

```bash
git add backend/src/handlers/solicitudes_compra.rs
git commit -m "feat(handler): persistir y devolver campos horizonte en solicitud_compra_detalle"
```

---

## Task 4: Backend Handler — nuevo endpoint `/horizonte`

**Files:**
- Modify: `backend/src/handlers/solicitudes_compra.rs`

- [ ] **Añadir structs de respuesta al inicio del archivo** (después de los `use` existentes)

```rust
#[derive(Debug, Deserialize)]
struct HorizonteParams {
    producto_id: Uuid,
    proveedor_id: i32,
}

#[derive(Debug, Serialize)]
struct HorizonteFactores {
    ciclo_historico_dias: Option<i32>,
    n_pedidos_historico: i32,
    coeficiente_variacion: f64,
    multiplicador_variabilidad: f64,
    lead_time: i32,
}

#[derive(Debug, Serialize)]
struct HorizonteResponse {
    horizonte_sugerido: i32,
    razon: String,
    consumo_diario: f64,
    stock_actual: f64,
    stock_minimo: f64,
    factores: HorizonteFactores,
}
```

- [ ] **Añadir el handler `horizonte_sugerido`** (antes de la función `routes()`)

```rust
pub async fn horizonte_sugerido(
    State(state): State<AppState>,
    Query(params): Query<HorizonteParams>,
) -> Result<Json<HorizonteResponse>, AppError> {
    // ── 1. Ciclo histórico ──────────────────────────────────────────────────
    let ciclo_row = sqlx::query!(
        r#"
        SELECT
            COUNT(gap_dias)::INT                         AS "n_pedidos!: i32",
            AVG(gap_dias)::INT                           AS "ciclo_dias?: i32"
        FROM (
            SELECT DATE_PART('day',
                LAG(fecha_creacion) OVER (ORDER BY fecha_creacion DESC)
                - fecha_creacion
            )::INT AS gap_dias
            FROM (
                SELECT DISTINCT sc.fecha_creacion
                FROM solicitudes_compra sc
                JOIN solicitud_compra_detalle scd ON scd.solicitud_id = sc.id
                WHERE scd.producto_id = $1
                  AND sc.estado IN ('guardada', 'aprobada')
                ORDER BY sc.fecha_creacion DESC
                LIMIT 5
            ) pedidos
        ) gaps
        WHERE gap_dias IS NOT NULL
        "#,
        params.producto_id
    )
    .fetch_one(&state.pool)
    .await?;

    let n_pedidos = ciclo_row.n_pedidos;
    let ciclo_dias = ciclo_row.ciclo_dias;

    // ── 2. Variabilidad de consumo semanal (últimos 90 días) ───────────────
    let var_row = sqlx::query!(
        r#"
        SELECT
            COALESCE(AVG(consumo_semana), 0)::FLOAT8    AS "media!: f64",
            COALESCE(STDDEV(consumo_semana), 0)::FLOAT8 AS "stddev!: f64"
        FROM (
            SELECT DATE_TRUNC('week', m.created_at),
                   SUM(m.cantidad)::FLOAT8 AS consumo_semana
            FROM movimientos m
            JOIN lotes l ON l.id = m.lote_id
            WHERE l.producto_id = $1
              AND m.tipo = 'CONSUMO'
              AND m.created_at >= NOW() - INTERVAL '90 days'
            GROUP BY DATE_TRUNC('week', m.created_at)
        ) semanas
        "#,
        params.producto_id
    )
    .fetch_one(&state.pool)
    .await?;

    let media = var_row.media;
    let stddev = var_row.stddev;
    let cv = if media > 0.0 { stddev / media } else { 0.0 };

    // ── 3. Lead time, stock actual, stock mínimo, consumo diario ──────────
    let info_row = sqlx::query!(
        r#"
        SELECT
            COALESCE(p.stock_minimo, 0)::FLOAT8                        AS "stock_minimo!: f64",
            COALESCE(
                (SELECT SUM(s.cantidad)::FLOAT8
                 FROM stock s JOIN lotes l2 ON l2.id = s.lote_id
                 WHERE l2.producto_id = p.id), 0
            )                                                           AS "stock_actual!: f64",
            COALESCE(prov.dias_despacho_tierra,
                     prov.dias_despacho_aereo, 7)::INT                 AS "lead_time!: i32",
            COALESCE(
                (SELECT (SUM(m.cantidad)::FLOAT8 /
                    GREATEST(DATE_PART('day', NOW() - MIN(m.created_at)), 1))
                 FROM movimientos m JOIN lotes l3 ON l3.id = m.lote_id
                 WHERE l3.producto_id = p.id AND m.tipo = 'CONSUMO'
                   AND m.created_at >= NOW() - INTERVAL '30 days'
                ), 0
            )                                                           AS "consumo_diario!: f64"
        FROM productos p
        LEFT JOIN proveedores prov ON prov.id = $2
        WHERE p.id = $1
        "#,
        params.producto_id,
        params.proveedor_id
    )
    .fetch_optional(&state.pool)
    .await?
    .ok_or(AppError::NotFound("Producto no encontrado".into()))?;

    let lead_time = info_row.lead_time;
    let stock_minimo = info_row.stock_minimo;
    let stock_actual = info_row.stock_actual;
    let consumo_diario = info_row.consumo_diario;

    // ── 4. Algoritmo de horizonte ──────────────────────────────────────────
    let (horizonte_base, razon_base) = if n_pedidos >= 2 {
        let dias = ciclo_dias.unwrap_or(30);
        (dias, format!("ciclo histórico ~{}d con este proveedor", dias))
    } else {
        let fallback = ((lead_time as f64 * 3.0) as i32).max(30);
        (fallback, "sin historial — estimación conservadora".to_string())
    };

    let (multiplicador, razon) = if n_pedidos >= 2 {
        if cv < 0.3 {
            (1.0f64, razon_base)
        } else if cv < 0.7 {
            (1.3f64, format!("ciclo histórico ~{}d + buffer por consumo variable",
                ciclo_dias.unwrap_or(30)))
        } else {
            (1.5f64, format!("ciclo histórico ~{}d + buffer por consumo irregular",
                ciclo_dias.unwrap_or(30)))
        }
    } else {
        (1.0f64, razon_base)
    };

    let horizonte_ajustado = (horizonte_base as f64 * multiplicador) as i32;
    let piso = ((lead_time as f64 * 1.5) as i32).max(7);
    let horizonte_sugerido = horizonte_ajustado.max(piso);

    Ok(Json(HorizonteResponse {
        horizonte_sugerido,
        razon,
        consumo_diario,
        stock_actual,
        stock_minimo,
        factores: HorizonteFactores {
            ciclo_historico_dias: ciclo_dias,
            n_pedidos_historico: n_pedidos,
            coeficiente_variacion: (cv * 100.0).round() / 100.0,
            multiplicador_variabilidad: multiplicador,
            lead_time,
        },
    }))
}
```

- [ ] **Registrar la ruta en `routes()`**

Reemplazar la función `routes()` al final del archivo:
```rust
pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(listar).post(crear))
        .route("/borrador", get(get_borrador))
        .route("/recomendaciones", get(recomendaciones))
        .route("/horizonte", get(horizonte_sugerido))
        .route("/{id}", get(obtener).put(actualizar))
        .route("/{id}/guardar", post(guardar))
}
```

- [ ] **Compilar y verificar que no hay errores**

```bash
cd backend && cargo check 2>&1 | head -40
```

Expected: sin errores de compilación.

- [ ] **Reconstruir el container Docker y probar el endpoint**

```bash
docker compose up --build -d
```

Esperar que levante (verificar con `docker compose logs backend --tail=10`), luego probar con un producto y proveedor reales de la DB:

```bash
# Obtener un producto_id y proveedor_id de prueba
docker compose exec -T db psql -U lab_user -d inventario_lab -c "
SELECT p.id AS producto_id, p.proveedor_id
FROM productos p WHERE p.proveedor_id IS NOT NULL AND p.activo = true LIMIT 1;"
```

Luego llamar al endpoint (reemplazar los UUIDs con los del resultado anterior):
```bash
curl -s "http://localhost:3000/api/v1/solicitudes-compra/horizonte?producto_id=<UUID>&proveedor_id=<ID>" \
  -H "Authorization: Bearer <TOKEN>" | python -m json.tool
```

Expected response shape:
```json
{
  "horizonte_sugerido": 30,
  "razon": "sin historial — estimación conservadora",
  "consumo_diario": 0.0,
  "stock_actual": 0.0,
  "stock_minimo": 100.0,
  "factores": { ... }
}
```

- [ ] **Commit**

```bash
git add backend/src/handlers/solicitudes_compra.rs
git commit -m "feat(handler): endpoint GET /solicitudes-compra/horizonte con algoritmo inteligente"
```

---

## Task 5: Regenerar tipos TypeScript

**Files:**
- Modify: `frontend/src/types/generated.ts`

- [ ] **Exportar tipos desde Rust**

```bash
cd "C:/Users/Desarrollo/Documents/14 marzo inventario/backend" && cargo run --bin export_types 2>&1
```

Expected: genera/actualiza `frontend/src/types/generated.ts` sin errores.

- [ ] **Verificar que los nuevos campos aparecen en `generated.ts`**

```bash
grep -n "horizonte" "C:/Users/Desarrollo/Documents/14 marzo inventario/frontend/src/types/generated.ts"
```

Expected: debe aparecer `horizonte_dias`, `horizonte_sugerido`, `horizonte_razon` en `CreateSolicitudItem` y `SolicitudDetalleItem`.

- [ ] **Commit**

```bash
git add frontend/src/types/generated.ts
git commit -m "chore(types): regenerar tipos TS — campos horizonte en solicitud"
```

---

## Task 6: Frontend — tipos `SolicitudItem`

**Files:**
- Modify: `frontend/src/types/index.ts`

- [ ] **Añadir 6 campos nuevos a `SolicitudItem`**

Reemplazar la interfaz `SolicitudItem`:
```ts
// Ítem en el borrador (estado local del componente)
export interface SolicitudItem {
  producto_id: string
  producto_nombre: string
  codigo_proveedor: string | null
  codigo_maestro: string | null
  proveedor_id: number | null
  proveedor_nombre: string
  lead_time: number
  presentacion_id: number | null
  presentacion_nombre: string | null
  presentacion_nombre_plural: string | null
  factor_conversion: number | null
  unidad_base: string
  unidad_base_plural: string | null
  cantidad: number
  precio_unitario: number
  imagen_url?: string | null
  // Datos necesarios para recalcular cantidad al cambiar horizonte
  consumo_diario: number
  stock_actual: number
  stock_minimo: number
  // Horizonte de cobertura
  horizonte_dias: number | null      // null = chip desactivado (cantidad manual)
  horizonte_sugerido: number | null  // calculado al agregar, no cambia
  horizonte_razon: string | null     // texto del badge, no cambia
}
```

- [ ] **Verificar que el proyecto compila sin errores de tipos**

```bash
cd "C:/Users/Desarrollo/Documents/14 marzo inventario/frontend" && npx tsc --noEmit 2>&1 | head -30
```

Habrá errores en `index.tsx` porque `SolicitudItem` ahora requiere los nuevos campos. Se corregirán en Task 8. Por ahora solo verificar que NO hay errores en otros archivos.

- [ ] **Commit**

```bash
git add frontend/src/types/index.ts
git commit -m "feat(types): añadir campos horizonte y fórmula a SolicitudItem"
```

---

## Task 7: Frontend — componente `HorizonteChips`

**Files:**
- Create: `frontend/src/pages/solicitudes-compra/components/horizonte-chips.tsx`

- [ ] **Crear el componente**

```tsx
// frontend/src/pages/solicitudes-compra/components/horizonte-chips.tsx
import { cn } from '@/lib/utils'

const CHIPS = [7, 15, 30, 90, 180, 365]

function chipMasCercano(horizonte: number): number {
  return CHIPS.reduce((prev, curr) => {
    const diffCurr = Math.abs(curr - horizonte)
    const diffPrev = Math.abs(prev - horizonte)
    return diffCurr < diffPrev ? curr : diffCurr === diffPrev ? Math.max(curr, prev) : prev
  })
}

export { chipMasCercano }

interface HorizonteChipsProps {
  horizonteDias: number | null        // chip activo actual (null = modo manual)
  horizonteSugerido: number | null    // valor sugerido por el sistema
  horizonteRazon: string | null       // texto del badge verde
  consumoDiario: number               // para calcular "cubre ~X días"
  cantidad: number                    // para calcular "cubre ~X días"
  onChipSelect: (dias: number) => void
}

export function HorizonteChips({
  horizonteDias,
  horizonteSugerido,
  horizonteRazon,
  consumoDiario,
  cantidad,
  onChipSelect,
}: HorizonteChipsProps) {
  const diasCubiertos = consumoDiario > 0 ? Math.round(cantidad / consumoDiario) : null

  return (
    <div className="mt-1.5 space-y-1">
      {/* Chips */}
      <div className="flex items-center gap-1 flex-wrap">
        <span className="text-[9px] font-bold opacity-40 uppercase tracking-wide mr-0.5">
          Horizonte:
        </span>
        {CHIPS.map(chip => {
          const isActive = horizonteDias === chip
          const isSugerido = horizonteSugerido === chip
          return (
            <button
              key={chip}
              onClick={() => onChipSelect(chip)}
              className={cn(
                "px-2 py-0.5 rounded-full text-[10px] font-bold border transition-all",
                isActive
                  ? "bg-primary text-primary-content border-primary"
                  : "bg-base-100 text-base-content/50 border-base-300 hover:border-primary/40 hover:text-primary"
              )}
            >
              {isSugerido && !isActive && (
                <span className="text-success mr-0.5">★</span>
              )}
              {chip >= 365 ? '1a' : chip >= 180 ? '6m' : chip >= 90 ? '3m' : `${chip}d`}
            </button>
          )
        })}
      </div>

      {/* Razón del sugerido + cobertura actual */}
      <div className="flex items-center gap-2 flex-wrap">
        {diasCubiertos !== null && (
          <span className={cn(
            "text-[10px] font-semibold",
            horizonteDias !== null ? "text-primary/70" : "text-base-content/40"
          )}>
            cubre ~{diasCubiertos} días
          </span>
        )}
        {horizonteRazon && horizonteDias !== null && (
          <span className="text-[9px] bg-success/10 text-success border border-success/20 rounded-md px-1.5 py-0.5 font-medium">
            ★ {horizonteRazon}
          </span>
        )}
        {horizonteDias === null && (
          <span className="text-[9px] opacity-30 italic">cantidad manual</span>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Verificar que el componente compila**

```bash
cd "C:/Users/Desarrollo/Documents/14 marzo inventario/frontend" && npx tsc --noEmit 2>&1 | grep "horizonte-chips"
```

Expected: sin errores en el nuevo archivo.

- [ ] **Commit**

```bash
git add frontend/src/pages/solicitudes-compra/components/horizonte-chips.tsx
git commit -m "feat(ui): nuevo componente HorizonteChips con chips 7/15/30/90/180/365d"
```

---

## Task 8: Frontend — integrar en `index.tsx`

**Files:**
- Modify: `frontend/src/pages/solicitudes-compra/index.tsx`

- [ ] **Añadir import de `HorizonteChips` y `chipMasCercano`**

Al inicio del archivo, en el bloque de imports locales:
```ts
import { HorizonteChips, chipMasCercano } from './components/horizonte-chips'
```

- [ ] **Añadir helper `calcularCantidad` después de `equivalenciaBase`**

```ts
function calcularCantidad(
  horizonte: number,
  consumoDiario: number,
  leadTime: number,
  stockMinimo: number,
  stockActual: number,
): number {
  return Math.max(1, Math.ceil(
    stockMinimo + consumoDiario * (leadTime + horizonte) - stockActual
  ))
}
```

- [ ] **Añadir query hook para `/horizonte`**

Añadir esta función antes del componente principal `SolicitudesCompraPage`:
```ts
async function fetchHorizonte(productoId: string, proveedorId: number | null) {
  if (!proveedorId) {
    return { horizonte_sugerido: 30, razon: 'sin proveedor — estimación por defecto', consumo_diario: 0, stock_actual: 0, stock_minimo: 0 }
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
```

- [ ] **Actualizar `handleAddFromRec` para incluir los campos nuevos y calcular cantidad con horizonte**

Reemplazar `handleAddFromRec`:
```ts
const handleAddFromRec = async (r: ItemRecomendado) => {
  if (items.find(i => i.producto_id === r.producto_id)) {
    toast.error('Producto ya está en la lista')
    return
  }
  const proveedorId = r.proveedor_id ?? selectedProveedor?.id ?? null
  const horizData = await fetchHorizonte(r.producto_id, proveedorId)
  const horizonte = horizData.horizonte_sugerido
  const consumoDiario = parseFloat(r.consumo_diario.toString())
  const stockActual = parseFloat(r.stock_actual.toString())
  const stockMinimo = parseFloat(r.stock_seguridad.toString())
  const leadTime = r.lead_time

  const cantidad = calcularCantidad(horizonte, consumoDiario, leadTime, stockMinimo, stockActual)

  const newItem: SolicitudItem = {
    producto_id: r.producto_id,
    producto_nombre: r.producto_nombre,
    codigo_proveedor: r.codigo_proveedor,
    codigo_maestro: r.codigo_maestro,
    proveedor_id: proveedorId,
    proveedor_nombre: r.proveedor_nombre || 'S/P',
    lead_time: leadTime,
    presentacion_id: r.presentacion_id,
    presentacion_nombre: r.presentacion_nombre,
    presentacion_nombre_plural: r.presentacion_nombre_plural,
    factor_conversion: r.factor_conversion ? parseFloat(r.factor_conversion.toString()) : null,
    unidad_base: r.unidad_base,
    unidad_base_plural: r.unidad_base_plural || autoPlural(r.unidad_base),
    cantidad,
    precio_unitario: r.precio_ultima_recepcion ? parseFloat(r.precio_ultima_recepcion.toString()) : 0,
    imagen_url: r.imagen_url,
    consumo_diario: consumoDiario,
    stock_actual: stockActual,
    stock_minimo: stockMinimo,
    horizonte_dias: chipMasCercano(horizonte),
    horizonte_sugerido: horizonte,
    horizonte_razon: horizData.razon,
  }
  setItems(prev => [...prev, newItem])
}
```

> **Nota:** `handleAddFromRec` ahora es `async`. Actualizar el onClick donde se llama: `onClick={() => handleAddFromRec(r)}` → `onClick={() => { handleAddFromRec(r) }}` (ya funciona con promesas sin await en el onClick).

- [ ] **Actualizar `handleAddFromSearch` para incluir los campos nuevos**

Reemplazar `handleAddFromSearch`:
```ts
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
  const unidadNombre = px.unidad_base?.nombre ?? 'u'
  const unidadPlural = px.unidad_base?.nombre_plural ?? 'u'
  const presId = px.pres_id ?? null
  const presNombre = px.pres_nombre ?? null
  const presNombrePlural = px.pres_nombre_plural ?? null
  const presFactor = px.pres_factor ? px.pres_factor : null
  const proveedorId = px.proveedor?.id ?? selectedProveedor?.id ?? null

  const horizData = await fetchHorizonte(p.id, proveedorId)
  const horizonte = horizData.horizonte_sugerido
  const consumoDiario = horizData.consumo_diario
  const stockActual = horizData.stock_actual
  const stockMinimo = horizData.stock_minimo
  const leadTime = p.lead_time_propio || 0

  const cantidad = calcularCantidad(horizonte, consumoDiario, leadTime, stockMinimo, stockActual)

  const newItem: SolicitudItem = {
    producto_id: p.id,
    producto_nombre: p.nombre,
    codigo_proveedor: p.codigo_proveedor,
    codigo_maestro: p.codigo_maestro,
    proveedor_id: proveedorId,
    proveedor_nombre: selectedProveedor?.nombre ?? 'Manual',
    lead_time: leadTime,
    presentacion_id: presId,
    presentacion_nombre: presNombre,
    presentacion_nombre_plural: presNombrePlural,
    factor_conversion: presFactor ? parseFloat(presFactor) : null,
    unidad_base: unidadNombre,
    unidad_base_plural: unidadPlural,
    cantidad,
    precio_unitario: p.precio_unidad ? parseFloat(String(p.precio_unidad)) : 0,
    imagen_url: px.imagen_url ?? null,
    consumo_diario: consumoDiario,
    stock_actual: stockActual,
    stock_minimo: stockMinimo,
    horizonte_dias: chipMasCercano(horizonte),
    horizonte_sugerido: horizonte,
    horizonte_razon: horizData.razon,
  }
  setItems(prev => [...prev, newItem])
}
```

- [ ] **Actualizar `handleUpdateQty` para desactivar el chip al editar manualmente**

Reemplazar `handleUpdateQty`:
```ts
const handleUpdateQty = (pid: string, val: number) => {
  setItems(prev => prev.map(i =>
    i.producto_id === pid
      ? { ...i, cantidad: Math.max(1, val), horizonte_dias: null }
      : i
  ))
}
```

- [ ] **Añadir handler para cambio de chip**

Añadir después de `handleUpdateQty`:
```ts
const handleHorizonteChip = (pid: string, dias: number) => {
  setItems(prev => prev.map(i => {
    if (i.producto_id !== pid) return i
    const nueva = calcularCantidad(dias, i.consumo_diario, i.lead_time, i.stock_minimo, i.stock_actual)
    return { ...i, horizonte_dias: dias, cantidad: nueva }
  }))
}
```

- [ ] **Actualizar el borrador al cargar (borradorItems) para inicializar los nuevos campos con defaults**

Dentro del `useEffect` que carga el borrador, en el `map` de `borradorItems`, añadir los campos nuevos con defaults:

```ts
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
  unidad_base_plural: autoPlural(item.unidad),
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
```

- [ ] **Actualizar los mutations `saveMutation` y `guardarMutation` para enviar los campos horizonte**

En `handleSaveBorrador`, actualizar el map de items:
```ts
items: items.map(i => ({
  producto_id: i.producto_id,
  cantidad_sugerida: i.cantidad.toString(),
  unidad: i.unidad_base,
  precio_unitario: i.precio_unitario.toString(),
  presentacion_id: i.presentacion_id,
  cantidad_presentaciones: i.cantidad.toString(),
  horizonte_dias: i.horizonte_dias ?? undefined,
  horizonte_sugerido: i.horizonte_sugerido ?? undefined,
  horizonte_razon: i.horizonte_razon ?? undefined,
})),
```

Hacer lo mismo en la `saveData` dentro de `guardarMutation.mutationFn`.

- [ ] **Renderizar `HorizonteChips` dentro de cada tarjeta de ítem**

Dentro del `items.map(item => ...)` en el panel derecho (pedido), después del `<div className="flex items-center gap-1.5 mt-1">` que contiene los botones +/− y la unidad, añadir:

```tsx
<HorizonteChips
  horizonteDias={item.horizonte_dias}
  horizonteSugerido={item.horizonte_sugerido}
  horizonteRazon={item.horizonte_razon}
  consumoDiario={item.consumo_diario}
  cantidad={item.cantidad}
  onChipSelect={(dias) => handleHorizonteChip(item.producto_id, dias)}
/>
```

El elemento debe quedar como hijo directo de `<div className="flex-1 min-w-0">`, después del bloque de cantidad.

- [ ] **Verificar que TypeScript no tiene errores**

```bash
cd "C:/Users/Desarrollo/Documents/14 marzo inventario/frontend" && npx tsc --noEmit 2>&1 | head -40
```

Expected: 0 errores.

- [ ] **Probar en el browser**

Abrir `http://localhost:5173/solicitudes-compra`, seleccionar un proveedor, agregar un ítem desde recomendaciones y otro desde el buscador. Verificar:
- Los chips aparecen debajo de la cantidad
- El chip sugerido tiene el ★ verde
- Hacer click en un chip distinto → la cantidad cambia
- Editar la cantidad manualmente → todos los chips se desactivan y aparece "cantidad manual"

- [ ] **Commit**

```bash
git add frontend/src/pages/solicitudes-compra/index.tsx
git commit -m "feat(solicitudes): integrar HorizonteChips con recálculo de cantidad por horizonte"
```

---

## Task 9: PDF — mostrar horizonte en celda Cantidad

**Files:**
- Modify: `frontend/src/lib/solicitud-pdf.ts`

- [ ] **Añadir campo `horizonte_dias` a la interfaz de items del PDF**

En `SolicitudPdfOptions`, añadir al tipo de items:
```ts
horizonte_dias?: number | null
```

- [ ] **Actualizar `cantDisplay` para incluir horizonte si está activo**

Reemplazar el bloque que construye `cantDisplay`:
```ts
const baseQty = Math.round(item.cantidad_sugerida)
const baseUnitLabel = baseQty === 1
  ? item.unidad
  : (item.unidad_plural ?? autoPlural(item.unidad))
const horizonteLinea = item.horizonte_dias
  ? `\ncubre ${item.horizonte_dias >= 365 ? '1 año' : item.horizonte_dias >= 180 ? '6 meses' : item.horizonte_dias >= 90 ? '3 meses' : `${item.horizonte_dias} días`}`
  : ''
const cantDisplay = usaPresentacion
  ? `${item.cantidad_presentaciones} ${presLabel}\n= ${baseEquiv} ${baseEquiv === 1 ? item.unidad : (item.unidad_plural ?? autoPlural(item.unidad))}${horizonteLinea}`
  : `${baseQty} ${baseUnitLabel}${horizonteLinea}`
```

- [ ] **Actualizar el call site en `index.tsx` para pasar `horizonte_dias`**

En el map de items dentro del `onClick` del botón PDF:
```ts
items: detail.items.map(i => ({
  producto_nombre: i.producto_nombre,
  cantidad_sugerida: parseFloat(i.cantidad_sugerida),
  unidad: i.unidad,
  codigo_maestro: i.codigo_maestro,
  codigo_proveedor: i.codigo_proveedor,
  presentacion_nombre: i.presentacion_nombre,
  presentacion_nombre_plural: i.presentacion_nombre_plural,
  factor_conversion: i.factor_conversion ? parseFloat(i.factor_conversion) : null,
  cantidad_presentaciones: i.cantidad_presentaciones ? parseFloat(i.cantidad_presentaciones) : null,
  precio_unitario: i.precio_unitario ? parseFloat(i.precio_unitario) : null,
  horizonte_dias: i.horizonte_dias ?? null,
})),
```

- [ ] **Verificar TypeScript**

```bash
cd "C:/Users/Desarrollo/Documents/14 marzo inventario/frontend" && npx tsc --noEmit 2>&1 | head -20
```

Expected: 0 errores.

- [ ] **Probar generando un PDF desde el historial** — verificar que la celda Cantidad muestra "cubre 90 días" cuando aplica.

- [ ] **Commit final**

```bash
git add frontend/src/lib/solicitud-pdf.ts frontend/src/pages/solicitudes-compra/index.tsx
git commit -m "feat(pdf): mostrar horizonte de cobertura en celda Cantidad"
```

---

## Resumen de commits esperados

1. `feat(db): añadir horizonte_dias/sugerido/razon a solicitud_compra_detalle`
2. `feat(dto): añadir campos horizonte a CreateSolicitudItem y SolicitudDetalleItem`
3. `feat(handler): persistir y devolver campos horizonte en solicitud_compra_detalle`
4. `feat(handler): endpoint GET /solicitudes-compra/horizonte con algoritmo inteligente`
5. `chore(types): regenerar tipos TS — campos horizonte en solicitud`
6. `feat(types): añadir campos horizonte y fórmula a SolicitudItem`
7. `feat(ui): nuevo componente HorizonteChips con chips 7/15/30/90/180/365d`
8. `feat(solicitudes): integrar HorizonteChips con recálculo de cantidad por horizonte`
9. `feat(pdf): mostrar horizonte de cobertura en celda Cantidad`
