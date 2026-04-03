# Solicitudes de Compra — Rediseño Completo

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rediseñar `/solicitudes-compra` con panel dual, precios + IVA 19%, modo borrador, recomendaciones por urgencia dinámica y unidades de presentación correctas.

**Architecture:** Tres migraciones extienden el esquema. El backend agrega 4 endpoints nuevos y modifica 2. El frontend se reescribe completamente como panel dual (sugerencias izquierda / borrador derecha). El PDF se mejora con precios e IVA.

**Tech Stack:** Rust + Axum + SQLx (backend), React + TypeScript + TanStack Query + jsPDF (frontend), PostgreSQL.

---

## Mapa de archivos

| Acción | Archivo |
|--------|---------|
| Crear  | `backend/migrations/028_precio_recepcion_detalle.sql` |
| Crear  | `backend/migrations/029_solicitud_precio_presentacion.sql` |
| Crear  | `backend/migrations/030_solicitud_estado_borrador.sql` |
| Modificar | `backend/src/handlers/recepciones.rs` |
| Modificar | `backend/src/handlers/solicitudes_compra.rs` |
| Modificar | `frontend/src/pages/solicitudes-compra/index.tsx` |
| Modificar | `frontend/src/lib/solicitud-pdf.ts` |
| Modificar | `frontend/src/types/index.ts` (agregar tipos nuevos) |

---

## Task 1: Migración 028 — precio en recepcion_detalle

**Files:**
- Crear: `backend/migrations/028_precio_recepcion_detalle.sql`

- [ ] **Step 1: Crear el archivo de migración**

```sql
-- backend/migrations/028_precio_recepcion_detalle.sql
-- ============================================================
-- Migración 028: Precio unitario en detalle de recepción
-- Permite rastrear el último precio pagado por producto
-- para auto-completar solicitudes de compra.
-- ============================================================

ALTER TABLE recepcion_detalle
    ADD COLUMN precio_unitario DECIMAL(14,2);

COMMENT ON COLUMN recepcion_detalle.precio_unitario
    IS 'Precio neto pagado por unidad (de presentación o base) en esta recepción';
```

- [ ] **Step 2: Aplicar la migración**

```bash
cd backend
sqlx migrate run
```

Resultado esperado: `Applied 1 migration` sin errores.

- [ ] **Step 3: Verificar**

```bash
psql $DATABASE_URL -c "\d recepcion_detalle" | grep precio_unitario
```

Resultado esperado: línea que muestra `precio_unitario | numeric`.

- [ ] **Step 4: Commit**

```bash
git add backend/migrations/028_precio_recepcion_detalle.sql
git commit -m "feat(db): add precio_unitario to recepcion_detalle (migration 028)"
```

---

## Task 2: Actualizar handler de recepciones — guardar precio_unitario

**Files:**
- Modificar: `backend/src/handlers/recepciones.rs`

El `DetalleRecepcionInput` ya tiene `costo_unitario: Option<Decimal>` (que va a `lotes`). Necesitamos agregar `precio_unitario` separado para guardar en `recepcion_detalle`.

- [ ] **Step 1: Agregar campo al DTO de entrada**

En `recepciones.rs`, buscar `pub struct DetalleRecepcionInput` y agregar el campo después de `costo_unitario`:

```rust
#[derive(Debug, Deserialize)]
pub struct DetalleRecepcionInput {
    pub producto_id: Uuid,
    pub numero_lote: String,
    pub fecha_vencimiento: NaiveDate,
    pub presentacion_id: Option<i32>,
    pub cantidad_presentaciones: Decimal,
    pub area_destino_id: i32,
    pub costo_unitario: Option<Decimal>,
    pub precio_unitario: Option<Decimal>,  // ← NUEVO: precio neto para solicitudes
}
```

- [ ] **Step 2: Pasar precio_unitario al service de stock_ops**

Buscar en el handler la función `stock_ops::procesar_recepcion` o el INSERT a `recepcion_detalle`. El INSERT actual se ve así (buscar por `INSERT INTO recepcion_detalle`):

Agregar `precio_unitario` al INSERT:

```rust
sqlx::query(
    "INSERT INTO recepcion_detalle
     (recepcion_id, producto_id, lote_id, presentacion_id, area_destino_id,
      cantidad_presentaciones, factor_conversion_usado, cantidad_unidades_base, precio_unitario)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)"
)
.bind(recepcion_id)
.bind(item.producto_id)
.bind(lote_id)
.bind(item.presentacion_id)
.bind(item.area_destino_id)
.bind(item.cantidad_presentaciones)
.bind(factor)
.bind(cantidad_base)
.bind(item.precio_unitario)   // ← NUEVO
.execute(&mut *tx)
.await?;
```

> **Nota:** Si el INSERT está en `stock_ops.rs` en lugar del handler, ajustar en ese archivo. Buscar `INSERT INTO recepcion_detalle` con `grep -n "INSERT INTO recepcion_detalle" backend/src/`.

- [ ] **Step 3: Compilar**

```bash
cd backend && cargo build 2>&1 | grep -E "error|warning" | head -20
```

Resultado esperado: sin errores de compilación.

- [ ] **Step 4: Commit**

```bash
git add backend/src/handlers/recepciones.rs
# Si el cambio fue en stock_ops.rs también agregarlo
git commit -m "feat(recepciones): accept and store precio_unitario per item"
```

---

## Task 3: Migraciones 029 y 030 — solicitud_compra_detalle + estado borrador

**Files:**
- Crear: `backend/migrations/029_solicitud_precio_presentacion.sql`
- Crear: `backend/migrations/030_solicitud_estado_borrador.sql`

- [ ] **Step 1: Crear migración 029**

```sql
-- backend/migrations/029_solicitud_precio_presentacion.sql
-- ============================================================
-- Migración 029: Precio y presentación en detalle de solicitud
-- ============================================================

ALTER TABLE solicitud_compra_detalle
    ADD COLUMN precio_unitario        DECIMAL(14,2),
    ADD COLUMN presentacion_id        INTEGER REFERENCES presentaciones(id),
    ADD COLUMN cantidad_presentaciones DECIMAL(12,2);

COMMENT ON COLUMN solicitud_compra_detalle.precio_unitario
    IS 'Precio neto por unidad de presentación (o base si no hay presentación)';
COMMENT ON COLUMN solicitud_compra_detalle.presentacion_id
    IS 'Presentación usada para expresar la cantidad. NULL = se pide en unidad base';
COMMENT ON COLUMN solicitud_compra_detalle.cantidad_presentaciones
    IS 'Cantidad en unidades de presentación. NULL si no hay presentación definida';
```

- [ ] **Step 2: Crear migración 030**

```sql
-- backend/migrations/030_solicitud_estado_borrador.sql
-- ============================================================
-- Migración 030: Agregar estado 'borrador' a solicitudes_compra
-- ============================================================

ALTER TABLE solicitudes_compra DROP CONSTRAINT solicitudes_compra_estado_check;

ALTER TABLE solicitudes_compra
    ADD CONSTRAINT solicitudes_compra_estado_check
    CHECK (estado IN (
        'borrador', 'pendiente', 'aprobada', 'rechazada',
        'enviada', 'completada', 'cancelada'
    ));

-- Cambiar default: nuevas solicitudes nacen como borrador
ALTER TABLE solicitudes_compra
    ALTER COLUMN estado SET DEFAULT 'borrador';
```

- [ ] **Step 3: Aplicar migraciones**

```bash
cd backend && sqlx migrate run
```

Resultado esperado: `Applied 2 migrations`.

- [ ] **Step 4: Verificar**

```bash
psql $DATABASE_URL -c "\d solicitud_compra_detalle" | grep -E "precio|presentacion|cantidad_pres"
psql $DATABASE_URL -c "SELECT constraint_name, check_clause FROM information_schema.check_constraints WHERE constraint_name = 'solicitudes_compra_estado_check';"
```

- [ ] **Step 5: Commit**

```bash
git add backend/migrations/029_solicitud_precio_presentacion.sql backend/migrations/030_solicitud_estado_borrador.sql
git commit -m "feat(db): add precio/presentacion to solicitud_detalle, add borrador state (029-030)"
```

---

## Task 4: Backend — GET /solicitudes-compra/recomendaciones

**Files:**
- Modificar: `backend/src/handlers/solicitudes_compra.rs`

Este es el endpoint más complejo. Clasifica productos por urgencia dinámica y devuelve precio de última recepción.

- [ ] **Step 1: Agregar struct `ItemRecomendado`**

En `solicitudes_compra.rs`, agregar después de los imports:

```rust
#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct ItemRecomendado {
    pub producto_id: Uuid,
    pub producto_nombre: String,
    pub codigo_proveedor: Option<String>,
    pub codigo_maestro: Option<String>,
    pub proveedor_id: Option<i32>,
    pub proveedor_nombre: Option<String>,
    pub lead_time: i32,
    pub autonomia_dias: Option<f64>,
    pub nivel_urgencia: String,
    pub stock_actual: Decimal,
    pub stock_minimo: Decimal,
    pub consumo_diario_30d: Decimal,
    pub cantidad_sugerida_base: Decimal,
    pub presentacion_id: Option<i32>,
    pub presentacion_nombre: Option<String>,
    pub presentacion_nombre_plural: Option<String>,
    pub factor_conversion: Option<Decimal>,
    pub cantidad_sugerida_presentacion: Option<Decimal>,
    pub precio_ultima_recepcion: Option<Decimal>,
    pub unidad_base: String,
    pub unidad_base_plural: Option<String>,
}
```

- [ ] **Step 2: Implementar handler `recomendaciones`**

```rust
async fn recomendaciones(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, AppError> {
    let items = sqlx::query_as::<_, ItemRecomendado>(
        r#"WITH consumo AS (
            SELECT
                l.producto_id,
                COALESCE(
                    SUM(ABS(m.cantidad)) FILTER (
                        WHERE m.tipo_movimiento = 'consumo'
                          AND m.created_at >= NOW() - INTERVAL '30 days'
                    ) / 30.0,
                    0
                )::DECIMAL(15,4) AS consumo_diario_30d
            FROM movimientos m
            JOIN lotes l ON l.id = m.lote_id
            GROUP BY l.producto_id
        ),
        stock_total AS (
            SELECT producto_id, SUM(cantidad) AS stock_actual
            FROM stock
            GROUP BY producto_id
        ),
        ultimo_precio AS (
            SELECT DISTINCT ON (rd.producto_id)
                rd.producto_id,
                rd.precio_unitario
            FROM recepcion_detalle rd
            JOIN recepciones r ON r.id = rd.recepcion_id
            WHERE rd.precio_unitario IS NOT NULL
              AND r.estado IN ('completa', 'parcial')
            ORDER BY rd.producto_id, r.fecha_recepcion DESC
        ),
        pres AS (
            SELECT DISTINCT ON (producto_id)
                producto_id, id, nombre, nombre_plural, factor_conversion
            FROM presentaciones
            WHERE activa = true
            ORDER BY producto_id, factor_conversion DESC
        )
        SELECT
            p.id                                                              AS producto_id,
            p.nombre                                                          AS producto_nombre,
            p.codigo_proveedor,
            p.codigo_maestro,
            prov.id                                                           AS proveedor_id,
            prov.nombre                                                       AS proveedor_nombre,
            COALESCE(p.lead_time_propio, prov.dias_despacho_tierra, prov.dias_despacho_aereo, 7)::INT
                                                                              AS lead_time,
            CASE
                WHEN COALESCE(c.consumo_diario_30d, 0) > 0.0001
                THEN (COALESCE(st.stock_actual, 0) / c.consumo_diario_30d)::FLOAT
                ELSE NULL
            END                                                               AS autonomia_dias,
            CASE
                WHEN COALESCE(c.consumo_diario_30d, 0) <= 0.0001
                     AND COALESCE(st.stock_actual, 0) < COALESCE(p.stock_minimo, 0)
                    THEN 'critico'
                WHEN COALESCE(c.consumo_diario_30d, 0) > 0.0001
                     AND (COALESCE(st.stock_actual, 0) / c.consumo_diario_30d)
                         < COALESCE(p.lead_time_propio, prov.dias_despacho_tierra, prov.dias_despacho_aereo, 7)
                    THEN 'critico'
                WHEN COALESCE(c.consumo_diario_30d, 0) > 0.0001
                     AND (COALESCE(st.stock_actual, 0) / c.consumo_diario_30d)
                         < COALESCE(p.lead_time_propio, prov.dias_despacho_tierra, prov.dias_despacho_aereo, 7) * 1.5
                    THEN 'urgente'
                WHEN COALESCE(c.consumo_diario_30d, 0) > 0.0001
                     AND (COALESCE(st.stock_actual, 0) / c.consumo_diario_30d)
                         < COALESCE(p.lead_time_propio, prov.dias_despacho_tierra, prov.dias_despacho_aereo, 7) * 2.5
                    THEN 'planificar'
                ELSE NULL
            END                                                               AS nivel_urgencia,
            COALESCE(st.stock_actual, 0)                                      AS stock_actual,
            COALESCE(p.stock_minimo, 0)                                       AS stock_minimo,
            COALESCE(c.consumo_diario_30d, 0)                                 AS consumo_diario_30d,
            -- Sugerencia: (minimo * 2) + (consumo * lead_time) - stock - en_camino
            GREATEST(0, CEIL(
                COALESCE(p.stock_minimo, 0) * 2
                + COALESCE(c.consumo_diario_30d, 0)
                  * COALESCE(p.lead_time_propio, prov.dias_despacho_tierra, prov.dias_despacho_aereo, 7)
                - COALESCE(st.stock_actual, 0)
            ))                                                                AS cantidad_sugerida_base,
            pres.id                                                           AS presentacion_id,
            pres.nombre                                                       AS presentacion_nombre,
            pres.nombre_plural                                                AS presentacion_nombre_plural,
            pres.factor_conversion,
            CASE
                WHEN pres.factor_conversion IS NOT NULL AND pres.factor_conversion > 0
                THEN CEIL(
                    GREATEST(0, CEIL(
                        COALESCE(p.stock_minimo, 0) * 2
                        + COALESCE(c.consumo_diario_30d, 0)
                          * COALESCE(p.lead_time_propio, prov.dias_despacho_tierra, prov.dias_despacho_aereo, 7)
                        - COALESCE(st.stock_actual, 0)
                    )) / pres.factor_conversion
                )
                ELSE NULL
            END                                                               AS cantidad_sugerida_presentacion,
            up.precio_unitario                                                AS precio_ultima_recepcion,
            ub.nombre                                                         AS unidad_base,
            ub.nombre_plural                                                  AS unidad_base_plural
        FROM productos p
        LEFT JOIN proveedores prov ON prov.id = p.proveedor_id
        LEFT JOIN consumo c ON c.producto_id = p.id
        LEFT JOIN stock_total st ON st.producto_id = p.id
        LEFT JOIN ultimo_precio up ON up.producto_id = p.id
        LEFT JOIN pres ON pres.producto_id = p.id
        LEFT JOIN unidades_basicas ub ON ub.id = p.unidad_base_id
        WHERE p.activo = true
          AND p.deleted_at IS NULL
        HAVING
            -- Solo incluir si tiene nivel de urgencia calculado
            CASE
                WHEN COALESCE(c.consumo_diario_30d, 0) <= 0.0001
                     AND COALESCE(st.stock_actual, 0) < COALESCE(p.stock_minimo, 0)
                    THEN TRUE
                WHEN COALESCE(c.consumo_diario_30d, 0) > 0.0001
                     AND (COALESCE(st.stock_actual, 0) / c.consumo_diario_30d)
                         < COALESCE(p.lead_time_propio, prov.dias_despacho_tierra, prov.dias_despacho_aereo, 7) * 2.5
                    THEN TRUE
                ELSE FALSE
            END
        ORDER BY
            CASE CASE
                WHEN COALESCE(c.consumo_diario_30d, 0) <= 0.0001
                     AND COALESCE(st.stock_actual, 0) < COALESCE(p.stock_minimo, 0) THEN 'critico'
                WHEN COALESCE(c.consumo_diario_30d, 0) > 0.0001
                     AND (COALESCE(st.stock_actual, 0) / c.consumo_diario_30d)
                         < COALESCE(p.lead_time_propio, prov.dias_despacho_tierra, prov.dias_despacho_aereo, 7) THEN 'critico'
                WHEN COALESCE(c.consumo_diario_30d, 0) > 0.0001
                     AND (COALESCE(st.stock_actual, 0) / c.consumo_diario_30d)
                         < COALESCE(p.lead_time_propio, prov.dias_despacho_tierra, prov.dias_despacho_aereo, 7) * 1.5 THEN 'urgente'
                ELSE 'planificar'
            END
            WHEN 'critico' THEN 1
            WHEN 'urgente' THEN 2
            ELSE 3
            END,
            COALESCE(autonomia_dias, 0)
        "#
    )
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(serde_json::json!({ "data": items })))
}
```

> **Nota:** La query usa `HAVING` con la misma lógica de nivel. Si SQLx da problemas con HAVING en queries sin GROUP BY, mover el filtro a un CTE envolvente. Ajustar según el schema real verificando que `productos.activo` y `productos.deleted_at` existen.

- [ ] **Step 3: Registrar la ruta** (lo hacemos en Task 5)

- [ ] **Step 4: Compilar**

```bash
cd backend && cargo build 2>&1 | grep "^error" | head -20
```

---

## Task 5: Backend — endpoints borrador (GET, POST, PUT, POST /enviar)

**Files:**
- Modificar: `backend/src/handlers/solicitudes_compra.rs`

- [ ] **Step 1: Struct para actualizar borrador**

Agregar en `solicitudes_compra.rs`:

```rust
#[derive(Debug, Deserialize)]
pub struct UpdateSolicitudRequest {
    pub nota: Option<String>,
    pub items: Vec<CreateSolicitudItem>,
}

#[derive(Debug, Deserialize)]
pub struct CreateSolicitudItem {
    pub producto_id: Uuid,
    pub cantidad_sugerida: Decimal,
    pub unidad: String,
    pub precio_unitario: Option<Decimal>,
    pub presentacion_id: Option<i32>,
    pub cantidad_presentaciones: Option<Decimal>,
}
```

> **Nota:** Reemplazar el `CreateSolicitudItem` existente con este (agrega los 3 campos nuevos).

- [ ] **Step 2: Handler `get_borrador`**

```rust
async fn get_borrador(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
) -> Result<Json<serde_json::Value>, AppError> {
    let borrador_id: Option<Uuid> = sqlx::query_scalar(
        "SELECT id FROM solicitudes_compra
         WHERE usuario_id = $1 AND estado = 'borrador'
         ORDER BY created_at DESC LIMIT 1"
    )
    .bind(claims.sub)
    .fetch_optional(&state.pool)
    .await?;

    match borrador_id {
        None => Ok(Json(serde_json::json!({ "borrador": null }))),
        Some(id) => {
            // Reusar handler obtener para traer el detalle
            let detalle = obtener_solicitud_por_id(id, &state.pool).await?;
            Ok(Json(serde_json::json!({ "borrador": detalle })))
        }
    }
}
```

- [ ] **Step 3: Extraer helper `obtener_solicitud_por_id`**

Extraer la lógica de `obtener` en una función privada reutilizable:

```rust
async fn obtener_solicitud_por_id(
    id: Uuid,
    pool: &sqlx::PgPool,
) -> Result<SolicitudDetalle, AppError> {
    let solicitud = sqlx::query_as::<_, SolicitudDetalleRow>(
        r#"SELECT s.id, s.numero_documento, s.fecha_creacion, s.estado, s.nota,
                  s.nota_revision, s.fecha_revision,
                  u.nombre as usuario_nombre,
                  ur.nombre as revisado_por_nombre
           FROM solicitudes_compra s
           JOIN usuarios u ON u.id = s.usuario_id
           LEFT JOIN usuarios ur ON ur.id = s.revisado_por
           WHERE s.id = $1"#
    )
    .bind(id)
    .fetch_optional(pool)
    .await?
    .ok_or(AppError::NotFound("Solicitud no encontrada".into()))?;

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
            d.cantidad_presentaciones
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

    Ok(SolicitudDetalle {
        id: solicitud.id,
        numero_documento: solicitud.numero_documento,
        fecha_creacion: solicitud.fecha_creacion,
        estado: solicitud.estado,
        usuario_nombre: solicitud.usuario_nombre,
        nota: solicitud.nota,
        nota_revision: solicitud.nota_revision,
        fecha_revision: solicitud.fecha_revision,
        revisado_por_nombre: solicitud.revisado_por_nombre,
        items,
    })
}
```

Y hacer que el handler `obtener` llame a este helper:

```rust
async fn obtener(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<SolicitudDetalle>, AppError> {
    Ok(Json(obtener_solicitud_por_id(id, &state.pool).await?))
}
```

- [ ] **Step 4: Modificar `crear` — siempre crea como borrador, verifica unicidad**

```rust
async fn crear(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(payload): Json<UpdateSolicitudRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    // Verificar si ya existe un borrador activo
    let borrador_existente: Option<Uuid> = sqlx::query_scalar(
        "SELECT id FROM solicitudes_compra
         WHERE usuario_id = $1 AND estado = 'borrador'
         LIMIT 1"
    )
    .bind(claims.sub)
    .fetch_optional(&state.pool)
    .await?;

    if let Some(id) = borrador_existente {
        return Err(AppError::BusinessLogic(
            format!("Ya existe un borrador activo: {}", id),
            "BORRADOR_EXISTENTE".into(),
        ));
    }

    let mut tx = state.pool.begin().await?;

    let solicitud_id: Uuid = sqlx::query_scalar(
        "INSERT INTO solicitudes_compra (usuario_id, nota, estado)
         VALUES ($1, $2, 'borrador') RETURNING id"
    )
    .bind(claims.sub)
    .bind(&payload.nota)
    .fetch_one(&mut *tx)
    .await?;

    for item in &payload.items {
        insertar_item(&mut tx, solicitud_id, item).await?;
    }

    tx.commit().await?;

    let numero: String = sqlx::query_scalar(
        "SELECT numero_documento FROM solicitudes_compra WHERE id = $1"
    )
    .bind(solicitud_id)
    .fetch_one(&state.pool)
    .await?;

    Ok(Json(serde_json::json!({
        "id": solicitud_id,
        "numero_documento": numero,
        "status": "borrador_creado"
    })))
}
```

- [ ] **Step 5: Helper `insertar_item`**

```rust
async fn insertar_item(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    solicitud_id: Uuid,
    item: &CreateSolicitudItem,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO solicitud_compra_detalle
         (solicitud_id, producto_id, cantidad_sugerida, unidad,
          precio_unitario, presentacion_id, cantidad_presentaciones)
         VALUES ($1, $2, $3, $4, $5, $6, $7)"
    )
    .bind(solicitud_id)
    .bind(item.producto_id)
    .bind(item.cantidad_sugerida)
    .bind(&item.unidad)
    .bind(item.precio_unitario)
    .bind(item.presentacion_id)
    .bind(item.cantidad_presentaciones)
    .execute(&mut **tx)
    .await?;
    Ok(())
}
```

- [ ] **Step 6: Handler `actualizar` (PUT)**

```rust
async fn actualizar(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<Uuid>,
    Json(payload): Json<UpdateSolicitudRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    // Solo el dueño puede editar su borrador
    let es_dueno: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM solicitudes_compra
         WHERE id = $1 AND usuario_id = $2 AND estado = 'borrador')"
    )
    .bind(id)
    .bind(claims.sub)
    .fetch_one(&state.pool)
    .await?;

    if !es_dueno {
        return Err(AppError::BusinessLogic(
            "Solo puedes editar tu propio borrador".into(),
            "ACCESO_DENEGADO".into(),
        ));
    }

    let mut tx = state.pool.begin().await?;

    // Actualizar nota
    sqlx::query("UPDATE solicitudes_compra SET nota = $1 WHERE id = $2")
        .bind(&payload.nota)
        .bind(id)
        .execute(&mut *tx)
        .await?;

    // Reemplazar ítems
    sqlx::query("DELETE FROM solicitud_compra_detalle WHERE solicitud_id = $1")
        .bind(id)
        .execute(&mut *tx)
        .await?;

    for item in &payload.items {
        insertar_item(&mut tx, id, item).await?;
    }

    tx.commit().await?;

    Ok(Json(serde_json::json!({ "status": "actualizado", "id": id })))
}
```

- [ ] **Step 7: Handler `enviar`**

```rust
async fn enviar(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<Uuid>,
) -> Result<Json<serde_json::Value>, AppError> {
    let items_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM solicitud_compra_detalle WHERE solicitud_id = $1"
    )
    .bind(id)
    .fetch_one(&state.pool)
    .await?;

    if items_count == 0 {
        return Err(AppError::Validation(
            "La solicitud debe tener al menos un ítem".into()
        ));
    }

    let filas = sqlx::query(
        "UPDATE solicitudes_compra
         SET estado = 'pendiente'
         WHERE id = $1 AND usuario_id = $2 AND estado = 'borrador'"
    )
    .bind(id)
    .bind(claims.sub)
    .execute(&state.pool)
    .await?;

    if filas.rows_affected() == 0 {
        return Err(AppError::BusinessLogic(
            "No se encontró un borrador activo tuyo con ese ID".into(),
            "BORRADOR_NO_ENCONTRADO".into(),
        ));
    }

    Ok(Json(serde_json::json!({ "status": "enviada", "estado": "pendiente" })))
}
```

- [ ] **Step 8: Actualizar `SolicitudDetalleItem` struct**

```rust
#[derive(Debug, Serialize, sqlx::FromRow)]
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
}
```

- [ ] **Step 9: Actualizar tabla de rutas**

```rust
pub fn routes() -> Router<AppState> {
    Router::new()
        .route("/", get(listar).post(crear))
        .route("/borrador", get(get_borrador))
        .route("/recomendaciones", get(recomendaciones))
        .route("/{id}", get(obtener).put(actualizar))
        .route("/{id}/revisar", post(revisar))
        .route("/{id}/enviar", post(enviar))
}
```

- [ ] **Step 10: Compilar y verificar**

```bash
cd backend && cargo build 2>&1 | grep "^error" | head -30
```

Resultado esperado: sin errores.

- [ ] **Step 11: Commit**

```bash
git add backend/src/handlers/solicitudes_compra.rs
git commit -m "feat(solicitudes): add borrador flow + recomendaciones endpoint"
```

---

## Task 6: Frontend — tipos TypeScript

**Files:**
- Modificar: `frontend/src/types/index.ts` (o donde estén definidos los tipos)

- [ ] **Step 1: Localizar donde están los tipos actuales**

```bash
grep -n "SolicitudCompra\|SolicitudItem" frontend/src/types/index.ts | head -20
```

- [ ] **Step 2: Agregar/reemplazar tipos**

Buscar los tipos `SolicitudCompra`, `SolicitudCompraDetalle`, `SolicitudItem` y reemplazar/agregar:

```typescript
// Ítem en el borrador (estado local del componente)
export interface SolicitudItem {
  producto_id: string
  producto_nombre: string
  codigo_proveedor: string | null
  codigo_maestro: string | null
  proveedor_id: number | null
  proveedor_nombre: string
  lead_time: number
  // presentación
  presentacion_id: number | null
  presentacion_nombre: string | null
  presentacion_nombre_plural: string | null
  factor_conversion: number | null
  // unidad base
  unidad_base: string
  unidad_base_plural: string | null
  // cantidades (en unidades de presentación si hay, o base)
  cantidad: number
  // precio
  precio_unitario: number
}

// Respuesta del endpoint GET /recomendaciones
export interface ItemRecomendado {
  producto_id: string
  producto_nombre: string
  codigo_proveedor: string | null
  codigo_maestro: string | null
  proveedor_id: number | null
  proveedor_nombre: string | null
  lead_time: number
  autonomia_dias: number | null
  nivel_urgencia: 'critico' | 'urgente' | 'planificar'
  stock_actual: number
  stock_minimo: number
  consumo_diario_30d: number
  cantidad_sugerida_base: number
  presentacion_id: number | null
  presentacion_nombre: string | null
  presentacion_nombre_plural: string | null
  factor_conversion: number | null
  cantidad_sugerida_presentacion: number | null
  precio_ultima_recepcion: number | null
  unidad_base: string
  unidad_base_plural: string | null
}

// Lo que se envía al backend (POST/PUT)
export interface CreateSolicitudRequest {
  nota?: string
  items: {
    producto_id: string
    cantidad_sugerida: number
    unidad: string
    precio_unitario?: number
    presentacion_id?: number
    cantidad_presentaciones?: number
  }[]
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/types/index.ts
git commit -m "feat(types): add SolicitudItem, ItemRecomendado types for redesign"
```

---

## Task 7: Frontend — helpers de unidades

**Files:**
- Modificar: `frontend/src/pages/solicitudes-compra/index.tsx`

Estos helpers van al inicio del componente (fuera del JSX, dentro del archivo).

- [ ] **Step 1: Agregar helpers al inicio del archivo**

```typescript
// Retorna el label de unidad correcto en singular o plural
function unidadLabel(item: SolicitudItem, qty: number): string {
  if (item.presentacion_nombre) {
    return qty === 1
      ? item.presentacion_nombre
      : (item.presentacion_nombre_plural ?? item.presentacion_nombre + 's')
  }
  return qty === 1
    ? item.unidad_base
    : (item.unidad_base_plural ?? autoPlural(item.unidad_base))
}

// Retorna "= 300 guantes (100/caja)" o null si no hay presentación
function equivalenciaBase(item: SolicitudItem): string | null {
  if (!item.presentacion_id || !item.factor_conversion) return null
  const base = Math.round(item.cantidad * item.factor_conversion)
  const u = base === 1
    ? item.unidad_base
    : (item.unidad_base_plural ?? autoPlural(item.unidad_base))
  return `= ${base.toLocaleString('es-CL')} ${u} (${item.factor_conversion}/${item.presentacion_nombre})`
}

// Convierte un ItemRecomendado en un SolicitudItem listo para agregar al borrador
function recomendadoToItem(r: ItemRecomendado): SolicitudItem {
  const qty = r.cantidad_sugerida_presentacion != null && r.factor_conversion
    ? Math.ceil(r.cantidad_sugerida_presentacion)
    : Math.ceil(r.cantidad_sugerida_base)

  return {
    producto_id: r.producto_id,
    producto_nombre: r.producto_nombre,
    codigo_proveedor: r.codigo_proveedor,
    codigo_maestro: r.codigo_maestro,
    proveedor_id: r.proveedor_id,
    proveedor_nombre: r.proveedor_nombre ?? 'Sin proveedor',
    lead_time: r.lead_time,
    presentacion_id: r.presentacion_id,
    presentacion_nombre: r.presentacion_nombre,
    presentacion_nombre_plural: r.presentacion_nombre_plural,
    factor_conversion: r.factor_conversion,
    unidad_base: r.unidad_base,
    unidad_base_plural: r.unidad_base_plural,
    cantidad: qty,
    precio_unitario: r.precio_ultima_recepcion ?? 0,
  }
}

// Formatea precio en pesos chilenos
function formatPesos(n: number): string {
  return '$' + Math.round(n).toLocaleString('es-CL')
}
```

- [ ] **Step 2: Agregar cálculo IVA al componente**

Dentro del componente, después de definir `items`:

```typescript
const subtotalNeto = items.reduce((s, i) => s + i.cantidad * i.precio_unitario, 0)
const iva = Math.round(subtotalNeto * 0.19)
const totalConIva = subtotalNeto + iva
```

---

## Task 8: Frontend — panel izquierdo (Recomendaciones)

**Files:**
- Modificar: `frontend/src/pages/solicitudes-compra/index.tsx`

- [ ] **Step 1: Query de recomendaciones**

Dentro del componente, agregar el query:

```typescript
const { data: recomendacionesData, isLoading: loadingRecs } = useQuery({
  queryKey: ['solicitudes-recomendaciones'],
  queryFn: () =>
    api.get<{ data: ItemRecomendado[] }>('/solicitudes-compra/recomendaciones')
      .then(r => r.data.data),
  refetchOnWindowFocus: false,
})
```

- [ ] **Step 2: Helper para agrupar por urgencia**

```typescript
const grupos = useMemo(() => {
  const recs = recomendacionesData ?? []
  return {
    critico:    recs.filter(r => r.nivel_urgencia === 'critico'),
    urgente:    recs.filter(r => r.nivel_urgencia === 'urgente'),
    planificar: recs.filter(r => r.nivel_urgencia === 'planificar'),
  }
}, [recomendacionesData])
```

- [ ] **Step 3: Componente de ítem de recomendación**

```typescript
function ItemRecCard({
  item,
  yaEnPedido,
  onAgregar,
}: {
  item: ItemRecomendado
  yaEnPedido: boolean
  onAgregar: (item: ItemRecomendado) => void
}) {
  const qty = item.cantidad_sugerida_presentacion != null
    ? Math.ceil(item.cantidad_sugerida_presentacion)
    : Math.ceil(item.cantidad_sugerida_base)
  const unidad = item.presentacion_nombre_plural ?? item.presentacion_nombre
    ?? (qty === 1 ? item.unidad_base : (item.unidad_base_plural ?? autoPlural(item.unidad_base)))

  return (
    <div className={cn(
      "border rounded-xl p-3 mb-2 bg-white flex items-center gap-3",
      item.nivel_urgencia === 'critico'    && "border-l-[3px] border-l-error",
      item.nivel_urgencia === 'urgente'    && "border-l-[3px] border-l-warning",
      item.nivel_urgencia === 'planificar' && "border-l-[3px] border-l-success",
    )}>
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-xs truncate">{item.producto_nombre}</div>
        <div className="text-[9px] font-mono text-base-content/40 mt-0.5">
          {item.codigo_proveedor && `Prov: ${item.codigo_proveedor}`}
          {item.codigo_proveedor && item.codigo_maestro && ' · '}
          {item.codigo_maestro && `Bodega: ${item.codigo_maestro}`}
        </div>
        <div className="flex gap-1 mt-1.5 flex-wrap">
          <Badge className={cn(
            "text-[9px] py-0 h-4",
            item.nivel_urgencia === 'critico'    && "bg-error/10 text-error border-error/20",
            item.nivel_urgencia === 'urgente'    && "bg-warning/10 text-warning border-warning/20",
            item.nivel_urgencia === 'planificar' && "bg-success/10 text-success border-success/20",
          )}>
            {item.autonomia_dias != null ? `${Math.round(item.autonomia_dias)}d autonomía` : 'Sin consumo · bajo mínimo'}
          </Badge>
          <Badge variant="outline" className="text-[9px] py-0 h-4 font-normal">
            {item.proveedor_nombre ?? 'Sin proveedor'} · {item.lead_time}d
          </Badge>
          {item.precio_ultima_recepcion && (
            <Badge className="bg-info/10 text-info border-info/20 text-[9px] py-0 h-4">
              {formatPesos(item.precio_ultima_recepcion)}/u
            </Badge>
          )}
        </div>
      </div>
      <div className="text-right flex-shrink-0">
        <div className="text-[10px] text-primary font-bold mb-1">
          Sugerir: {qty} {unidad}
        </div>
        <button
          className={cn(
            "text-[10px] font-bold px-2 py-1 rounded-lg",
            yaEnPedido
              ? "bg-success/10 text-success cursor-default"
              : "bg-primary text-white hover:bg-primary/90"
          )}
          onClick={() => !yaEnPedido && onAgregar(item)}
        >
          {yaEnPedido ? '✓ En pedido' : '+ Agregar'}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Render del panel izquierdo**

En el JSX principal del componente (dentro de `view === 'nuevo'`):

```tsx
<div className="w-[380px] flex-shrink-0 bg-white border-r border-base-200 flex flex-col overflow-hidden">
  <div className="p-3 border-b border-base-200">
    <h2 className="font-bold text-sm">💡 Sistema recomienda</h2>
    <p className="text-[10px] text-base-content/40 mt-0.5">
      Urgencia relativa al lead time de cada proveedor
    </p>
  </div>
  <div className="flex-1 overflow-y-auto p-3">
    {loadingRecs ? (
      [1,2,3].map(i => <Skeleton key={i} className="h-16 w-full rounded-xl mb-2" />)
    ) : (
      <>
        {grupos.critico.length > 0 && (
          <div className="mb-3">
            <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wide text-error bg-error/5 rounded-md px-2 py-1 mb-2">
              🔴 Crítico — llega a cero antes del pedido ({grupos.critico.length})
            </div>
            {grupos.critico.map(r => (
              <ItemRecCard
                key={r.producto_id}
                item={r}
                yaEnPedido={items.some(i => i.producto_id === r.producto_id)}
                onAgregar={agregarDesdeRecomendacion}
              />
            ))}
          </div>
        )}
        {grupos.urgente.length > 0 && (
          <div className="mb-3">
            <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wide text-warning bg-warning/5 rounded-md px-2 py-1 mb-2">
              🟡 Urgente — menos de 1.5× lead time ({grupos.urgente.length})
            </div>
            {grupos.urgente.map(r => (
              <ItemRecCard
                key={r.producto_id}
                item={r}
                yaEnPedido={items.some(i => i.producto_id === r.producto_id)}
                onAgregar={agregarDesdeRecomendacion}
              />
            ))}
          </div>
        )}
        {grupos.planificar.length > 0 && (
          <div className="mb-3">
            <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wide text-success bg-success/5 rounded-md px-2 py-1 mb-2">
              🟢 Planificar — pedir en este ciclo ({grupos.planificar.length})
            </div>
            {grupos.planificar.map(r => (
              <ItemRecCard
                key={r.producto_id}
                item={r}
                yaEnPedido={items.some(i => i.producto_id === r.producto_id)}
                onAgregar={agregarDesdeRecomendacion}
              />
            ))}
          </div>
        )}
        {(recomendacionesData?.length ?? 0) === 0 && !loadingRecs && (
          <div className="py-16 text-center opacity-30">
            <p className="text-xs">Sin alertas activas — inventario en orden</p>
          </div>
        )}
      </>
    )}
  </div>
</div>
```

- [ ] **Step 5: Handler `agregarDesdeRecomendacion`**

```typescript
function agregarDesdeRecomendacion(rec: ItemRecomendado) {
  if (items.some(i => i.producto_id === rec.producto_id)) {
    toast.error('Este producto ya está en el pedido')
    return
  }
  setItems(prev => [recomendadoToItem(rec), ...prev])
  toast.success(`${rec.producto_nombre} agregado al pedido`)
}
```

---

## Task 9: Frontend — panel derecho (tabla por proveedor)

**Files:**
- Modificar: `frontend/src/pages/solicitudes-compra/index.tsx`

- [ ] **Step 1: Agrupar ítems por proveedor**

```typescript
const itemsPorProveedor = useMemo(() => {
  const grupos: Record<string, SolicitudItem[]> = {}
  items.forEach(item => {
    const key = item.proveedor_nombre
    if (!grupos[key]) grupos[key] = []
    grupos[key].push(item)
  })
  return grupos
}, [items])
```

- [ ] **Step 2: Funciones de edición de ítems**

```typescript
function updateCantidad(producto_id: string, qty: number) {
  setItems(prev => prev.map(i =>
    i.producto_id === producto_id ? { ...i, cantidad: Math.max(0.01, qty) } : i
  ))
}

function updatePrecio(producto_id: string, precio: number) {
  setItems(prev => prev.map(i =>
    i.producto_id === producto_id ? { ...i, precio_unitario: Math.max(0, precio) } : i
  ))
}

function removeItem(producto_id: string) {
  setItems(prev => prev.filter(i => i.producto_id !== producto_id))
}
```

- [ ] **Step 3: Render del panel derecho — tabla por proveedor**

```tsx
<div className="flex-1 flex flex-col bg-base-50 overflow-hidden">
  {/* Header con indicador de borrador */}
  <div className="p-3 bg-white border-b border-base-200 flex items-center justify-between">
    <h2 className="font-bold text-sm">🛒 Mi Pedido</h2>
    {borradorId && (
      <span className="text-[10px] bg-warning/10 text-warning px-2 py-1 rounded-full font-bold">
        ● Borrador guardado
      </span>
    )}
  </div>

  <div className="flex-1 overflow-y-auto p-3">
    {/* Buscador manual */}
    <div className="relative mb-3">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 opacity-30" />
      <Input
        placeholder="Añadir producto manualmente..."
        className="pl-9 h-9 rounded-xl text-xs"
        value={productSearch}
        onChange={e => setProductSearch(e.target.value)}
      />
      {searchResults?.data && productSearch.length > 2 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-base-200 rounded-xl shadow-xl z-50 overflow-hidden">
          {searchResults.data.length === 0 ? (
            <div className="p-3 text-xs text-center opacity-40">Sin resultados</div>
          ) : (
            <div className="divide-y divide-base-100">
              {searchResults.data.map((p: any) => (
                <button
                  key={p.id}
                  className="w-full flex items-center justify-between p-2.5 hover:bg-primary/5 text-left"
                  onClick={() => agregarManual(p)}
                >
                  <div>
                    <div className="text-xs font-semibold">{p.nombre}</div>
                    <div className="text-[9px] opacity-40">{p.proveedor?.nombre ?? 'Sin proveedor'}</div>
                  </div>
                  <Plus className="w-4 h-4 text-primary" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>

    {/* Tablas por proveedor */}
    {items.length === 0 ? (
      <div className="py-20 text-center opacity-20">
        <ShoppingCart className="w-10 h-10 mx-auto mb-3" />
        <p className="text-xs">Agrega productos desde el panel izquierdo</p>
      </div>
    ) : (
      Object.entries(itemsPorProveedor).map(([proveedor, provItems]) => {
        const subtotalProv = provItems.reduce((s, i) => s + i.cantidad * i.precio_unitario, 0)

        return (
          <div key={proveedor} className="bg-white border border-base-200 rounded-2xl overflow-hidden mb-3">
            {/* Header proveedor */}
            <div className="px-3 py-2 bg-base-50 border-b border-base-200 flex items-center justify-between">
              <div>
                <div className="font-bold text-xs">{proveedor}</div>
                <div className="text-[9px] opacity-40">
                  {provItems[0].lead_time}d despacho · {provItems.length} producto{provItems.length > 1 ? 's' : ''}
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs font-bold text-primary">{formatPesos(subtotalProv)} neto</div>
                <div className="text-[9px] opacity-40">{formatPesos(subtotalProv * 1.19)} c/IVA</div>
              </div>
            </div>

            {/* Tabla de ítems */}
            <table className="w-full text-[11px]">
              <thead>
                <tr className="bg-base-50/50">
                  <th className="text-left px-3 py-1.5 text-[9px] font-bold uppercase opacity-40 w-[30%]">Producto</th>
                  <th className="text-left px-2 py-1.5 text-[9px] font-bold uppercase opacity-40">Cód. Prov.</th>
                  <th className="text-left px-2 py-1.5 text-[9px] font-bold uppercase opacity-40">Cód. Bodega</th>
                  <th className="text-center px-2 py-1.5 text-[9px] font-bold uppercase opacity-40">Cantidad</th>
                  <th className="text-right px-2 py-1.5 text-[9px] font-bold uppercase opacity-40">P. Neto</th>
                  <th className="text-right px-2 py-1.5 text-[9px] font-bold uppercase opacity-40">Total</th>
                  <th className="w-6"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-base-100">
                {provItems.map(item => {
                  const equiv = equivalenciaBase(item)
                  const totalLinea = item.cantidad * item.precio_unitario
                  return (
                    <tr key={item.producto_id}>
                      <td className="px-3 py-2">
                        <div className="font-medium leading-tight">{item.producto_nombre}</div>
                        {item.presentacion_nombre && (
                          <div className="text-[9px] opacity-40">📦 {item.presentacion_nombre}</div>
                        )}
                      </td>
                      <td className="px-2 py-2">
                        {item.codigo_proveedor
                          ? <span className="font-mono text-[9px] bg-info/10 text-info px-1.5 py-0.5 rounded">{item.codigo_proveedor}</span>
                          : <span className="opacity-20">—</span>}
                      </td>
                      <td className="px-2 py-2">
                        {item.codigo_maestro
                          ? <span className="font-mono text-[9px] bg-secondary/10 text-secondary px-1.5 py-0.5 rounded">{item.codigo_maestro}</span>
                          : <span className="opacity-20">—</span>}
                      </td>
                      <td className="px-2 py-2 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <input
                            type="number"
                            className="w-12 bg-base-100 rounded-lg text-center font-bold text-xs border border-base-200 py-1 focus:outline-none focus:border-primary"
                            value={item.cantidad}
                            min={0.01}
                            step={1}
                            onChange={e => updateCantidad(item.producto_id, Number(e.target.value))}
                          />
                          <span className="text-[9px] opacity-50">{unidadLabel(item, item.cantidad)}</span>
                        </div>
                        {equiv && <div className="text-[9px] text-info mt-0.5">{equiv}</div>}
                      </td>
                      <td className="px-2 py-2 text-right">
                        <div className="flex items-center justify-end gap-0.5">
                          <span className="text-[9px] opacity-40">$</span>
                          <input
                            type="number"
                            className="w-20 bg-base-100 rounded-lg text-right font-semibold text-xs border border-base-200 py-1 px-1.5 focus:outline-none focus:border-primary"
                            value={item.precio_unitario}
                            min={0}
                            onChange={e => updatePrecio(item.producto_id, Number(e.target.value))}
                          />
                        </div>
                        <div className="text-[8px] opacity-30 text-right">
                          por {unidadLabel(item, 1)}
                        </div>
                      </td>
                      <td className="px-2 py-2 text-right font-bold">
                        {formatPesos(totalLinea)}
                      </td>
                      <td className="pr-2">
                        <button
                          className="text-error/30 hover:text-error transition-colors"
                          onClick={() => removeItem(item.producto_id)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      })
    )}
  </div>
</div>
```

- [ ] **Step 4: Handler `agregarManual`**

```typescript
function agregarManual(p: any) {
  if (items.some(i => i.producto_id === p.id)) {
    toast.error('Este producto ya está en el pedido')
    return
  }

  // Preferir la presentación con mayor factor_conversion
  const pres = p.presentaciones?.find((pr: any) => pr.activa) ?? null

  const newItem: SolicitudItem = {
    producto_id: p.id,
    producto_nombre: p.nombre,
    codigo_proveedor: p.codigo_proveedor ?? null,
    codigo_maestro: p.codigo_maestro ?? null,
    proveedor_id: p.proveedor?.id ?? null,
    proveedor_nombre: p.proveedor?.nombre ?? 'Sin proveedor',
    lead_time: p.lead_time_propio ?? p.proveedor?.dias_despacho_tierra ?? p.proveedor?.dias_despacho_aereo ?? 7,
    presentacion_id: pres?.id ?? null,
    presentacion_nombre: pres?.nombre ?? null,
    presentacion_nombre_plural: pres?.nombre_plural ?? null,
    factor_conversion: pres?.factor_conversion ?? null,
    unidad_base: p.unidad_base?.nombre ?? '',
    unidad_base_plural: p.unidad_base?.nombre_plural ?? null,
    cantidad: 1,
    precio_unitario: 0,
  }

  setItems(prev => [newItem, ...prev])
  setProductSearch('')
  toast.success(`${p.nombre} agregado`)
}
```

---

## Task 10: Frontend — footer IVA + flujo borrador completo

**Files:**
- Modificar: `frontend/src/pages/solicitudes-compra/index.tsx`

- [ ] **Step 1: Estado del borrador**

Al inicio del componente, agregar:

```typescript
const [borradorId, setBorradorId] = useState<string | null>(null)
const [nota, setNota] = useState('')
```

- [ ] **Step 2: Cargar borrador al montar**

```typescript
const { data: borradorData } = useQuery({
  queryKey: ['solicitud-borrador'],
  queryFn: () =>
    api.get<{ borrador: SolicitudCompraDetalle | null }>('/solicitudes-compra/borrador')
      .then(r => r.data),
})

// Efecto para cargar borrador existente en el estado local
useEffect(() => {
  if (!borradorData?.borrador) return
  const b = borradorData.borrador
  setBorradorId(b.id)
  setNota(b.nota ?? '')
  setItems(b.items.map(item => ({
    producto_id: item.producto_id,
    producto_nombre: item.producto_nombre,
    codigo_proveedor: item.codigo_proveedor ?? null,
    codigo_maestro: item.codigo_maestro ?? null,
    proveedor_id: null,
    proveedor_nombre: item.proveedor_nombre ?? 'Sin proveedor',
    lead_time: 7,
    presentacion_id: item.presentacion_id ?? null,
    presentacion_nombre: item.presentacion_nombre ?? null,
    presentacion_nombre_plural: item.presentacion_nombre_plural ?? null,
    factor_conversion: item.factor_conversion ? Number(item.factor_conversion) : null,
    unidad_base: item.unidad,
    unidad_base_plural: null,
    cantidad: item.cantidad_presentaciones
      ? Number(item.cantidad_presentaciones)
      : Number(item.cantidad_sugerida),
    precio_unitario: item.precio_unitario ? Number(item.precio_unitario) : 0,
  })))
}, [borradorData])
```

- [ ] **Step 3: Mutation guardar borrador**

```typescript
const guardarMutation = useMutation({
  mutationFn: async () => {
    const payload: CreateSolicitudRequest = {
      nota: nota || undefined,
      items: items.map(i => ({
        producto_id: i.producto_id,
        cantidad_sugerida: i.factor_conversion
          ? i.cantidad * i.factor_conversion   // convertir a base
          : i.cantidad,
        unidad: i.unidad_base,
        precio_unitario: i.precio_unitario || undefined,
        presentacion_id: i.presentacion_id ?? undefined,
        cantidad_presentaciones: i.presentacion_id ? i.cantidad : undefined,
      }))
    }
    if (borradorId) {
      return api.put(`/solicitudes-compra/${borradorId}`, payload)
    } else {
      const res = await api.post('/solicitudes-compra', payload)
      setBorradorId(res.data.id)
      return res
    }
  },
  onSuccess: () => toast.success('Borrador guardado'),
  onError: () => toast.error('Error al guardar el borrador'),
})
```

- [ ] **Step 4: Mutation enviar**

```typescript
const enviarMutation = useMutation({
  mutationFn: async () => {
    // Si no hay borrador guardado aún, guardar primero
    if (!borradorId) {
      const saved = await guardarMutation.mutateAsync()
      return api.post(`/solicitudes-compra/${(saved as any).data.id}/enviar`)
    }
    return api.post(`/solicitudes-compra/${borradorId}/enviar`)
  },
  onSuccess: async (response) => {
    toast.success('Solicitud enviada a aprobación')
    // Generar PDF
    try {
      const detail = await api.get<SolicitudCompraDetalle>(`/solicitudes-compra/${borradorId}`).then(r => r.data)
      const config = await api.get<{ nombre_laboratorio: string }>('/configuracion').then(r => r.data)
      await exportarSolicitudPDF({
        numero_documento: detail.numero_documento,
        fecha_creacion: detail.fecha_creacion,
        usuario_nombre: detail.usuario_nombre,
        nota: detail.nota,
        items: detail.items,
        subtotal_neto: subtotalNeto,
        iva: iva,
        total_con_iva: totalConIva,
        nombreLaboratorio: config.nombre_laboratorio || 'Laboratorio'
      })
    } catch {
      toast.error('Error al generar PDF, pero la solicitud fue enviada')
    }
    queryClient.invalidateQueries({ queryKey: ['solicitudes-historial'] })
    setBorradorId(null)
    setItems([])
    setNota('')
    setView('historial')
  },
  onError: () => toast.error('Error al enviar la solicitud'),
})
```

- [ ] **Step 5: Footer del panel derecho**

```tsx
{/* Footer con IVA + acciones */}
<div className="bg-white border-t border-base-200">
  {/* Totales */}
  <div className="px-4 pt-3 pb-0 space-y-1">
    <div className="flex justify-between text-xs text-base-content/60">
      <span>Subtotal neto</span>
      <span>{formatPesos(subtotalNeto)}</span>
    </div>
    <div className="flex justify-between text-xs font-semibold text-info">
      <span>IVA 19%</span>
      <span>{formatPesos(iva)}</span>
    </div>
    <div className="flex justify-between font-bold text-sm border-t border-base-200 pt-2 mt-2">
      <span>Total con IVA</span>
      <span>{formatPesos(totalConIva)}</span>
    </div>
  </div>
  {/* Notas */}
  <div className="px-4 py-2">
    <textarea
      className="textarea textarea-bordered w-full text-xs h-10 rounded-xl resize-none bg-base-100"
      placeholder="Observaciones para el área de compras..."
      value={nota}
      onChange={e => setNota(e.target.value)}
    />
  </div>
  {/* Botones */}
  <div className="flex gap-2 px-4 pb-3">
    <Button
      variant="outline"
      className="flex-1 h-11 rounded-xl text-xs font-bold"
      disabled={items.length === 0 || guardarMutation.isPending}
      onClick={() => guardarMutation.mutate()}
    >
      {guardarMutation.isPending
        ? <span className="loading loading-spinner loading-xs" />
        : '💾 Guardar borrador'}
    </Button>
    <Button
      className="flex-2 h-11 rounded-xl text-xs font-bold gap-1"
      disabled={items.length === 0 || enviarMutation.isPending}
      onClick={() => enviarMutation.mutate()}
    >
      {enviarMutation.isPending
        ? <span className="loading loading-spinner loading-xs" />
        : '✉️ Enviar a aprobación'}
    </Button>
  </div>
</div>
```

- [ ] **Step 6: Estructura general del componente (layout panel dual)**

El componente principal retorna:

```tsx
return (
  <div className="flex flex-col h-[calc(100vh-4rem)]">
    {/* Header */}
    <div className="flex items-center justify-between px-6 py-3 bg-white border-b border-base-200 flex-shrink-0">
      <div>
        <h1 className="text-lg font-bold">Solicitudes de Compra</h1>
        <p className="text-[10px] opacity-40">Reposición inteligente · Precios netos + IVA 19%</p>
      </div>
      <div className="flex items-center gap-2 bg-base-200 p-1 rounded-xl">
        <Button variant={view === 'nuevo' ? 'default' : 'ghost'} size="sm" className="rounded-lg" onClick={() => setView('nuevo')}>
          💡 Recomendaciones
        </Button>
        <Button variant={view === 'historial' ? 'default' : 'ghost'} size="sm" className="rounded-lg" onClick={() => setView('historial')}>
          <History className="w-4 h-4 mr-1" /> Historial
        </Button>
      </div>
    </div>

    {view === 'nuevo' ? (
      <div className="flex flex-1 overflow-hidden">
        {/* Panel izquierdo — Sugerencias */}
        {/* ... (Task 8 Step 4) ... */}

        {/* Panel derecho — Mi Pedido */}
        {/* ... (Task 9 Step 3 + Task 10 Step 5) ... */}
      </div>
    ) : (
      /* Historial — tabla existente sin cambios */
      <div className="flex-1 overflow-auto p-6">
        {/* ... tabla de historial existente ... */}
      </div>
    )}

    {/* Modal de revisión — sin cambios */}
  </div>
)
```

- [ ] **Step 7: Verificar en navegador**

Navegar a `http://localhost:5173/solicitudes-compra`. Verificar:
- Panel izquierdo muestra recomendaciones cargadas desde el backend
- Clic en "+ Agregar" mueve ítem al panel derecho
- Cantidad y precio son editables
- Footer muestra subtotal, IVA 19% y total
- "Guardar borrador" llama al backend y muestra confirmación
- Recargar página restaura el borrador guardado
- "Enviar a aprobación" cambia estado y redirige al historial

- [ ] **Step 8: Commit**

```bash
git add frontend/src/pages/solicitudes-compra/index.tsx frontend/src/types/index.ts
git commit -m "feat(solicitudes): complete dual-panel redesign with draft mode and IVA"
```

---

## Task 11: PDF — mejorar exportarSolicitudPDF con precios e IVA

**Files:**
- Modificar: `frontend/src/lib/solicitud-pdf.ts`

- [ ] **Step 1: Actualizar la interfaz de opciones**

```typescript
interface SolicitudPdfOptions {
  numero_documento: string
  fecha_creacion: string
  usuario_nombre: string
  nota?: string | null
  subtotal_neto: number
  iva: number
  total_con_iva: number
  nombreLaboratorio: string
  items: {
    producto_nombre: string
    cantidad_sugerida: number
    unidad: string
    codigo_maestro?: string | null
    codigo_proveedor?: string | null
    proveedor_nombre?: string | null
    presentacion_nombre?: string | null
    presentacion_nombre_plural?: string | null
    factor_conversion?: number | null
    precio_unitario?: number | null
    cantidad_presentaciones?: number | null
  }[]
}
```

- [ ] **Step 2: Reemplazar la tabla de ítems**

Reemplazar el bloque `autoTable(doc, {...})` con:

```typescript
autoTable(doc, {
  startY: y,
  head: [[
    '#',
    'Descripción · Identificadores',
    'Cód. Prov.',
    'Cód. Bodega',
    'Cantidad',
    'P. Neto',
    'Total Neto',
  ]],
  body: items.map((item, index) => {
    const usaPresentacion = item.presentacion_nombre && item.factor_conversion && item.cantidad_presentaciones
    const cantDisplay = usaPresentacion
      ? `${item.cantidad_presentaciones} ${item.cantidad_presentaciones === 1 ? item.presentacion_nombre : (item.presentacion_nombre_plural ?? item.presentacion_nombre + 's')}\n= ${Math.round(item.cantidad_sugerida)} ${item.unidad}`
      : `${Math.round(item.cantidad_sugerida)} ${item.unidad}`
    const totalLinea = item.precio_unitario
      ? (usaPresentacion ? item.cantidad_presentaciones! : item.cantidad_sugerida) * item.precio_unitario
      : null

    return [
      index + 1,
      item.producto_nombre,
      item.codigo_proveedor ?? '—',
      item.codigo_maestro ?? '—',
      { content: cantDisplay, styles: { fontSize: 7 } },
      item.precio_unitario ? `$${Math.round(item.precio_unitario).toLocaleString('es-CL')}` : '—',
      totalLinea ? `$${Math.round(totalLinea).toLocaleString('es-CL')}` : '—',
    ]
  }),
  theme: 'grid',
  headStyles: {
    fillColor: C.primary,
    textColor: C.white,
    fontSize: 7,
    fontStyle: 'bold',
    halign: 'center',
    cellPadding: 3,
  },
  styles: { fontSize: 8, cellPadding: 3, valign: 'middle' },
  columnStyles: {
    0: { halign: 'center', cellWidth: 7 },
    1: { cellWidth: 60 },
    2: { halign: 'center', cellWidth: 22 },
    3: { halign: 'center', cellWidth: 22 },
    4: { halign: 'center', cellWidth: 28 },
    5: { halign: 'right', cellWidth: 22 },
    6: { halign: 'right', cellWidth: 25 },
  },
  alternateRowStyles: { fillColor: C.bgLight },
})
```

- [ ] **Step 3: Agregar bloque de totales IVA después de la tabla**

Después del `autoTable`, antes del bloque de firmas:

```typescript
const tableEndY = (doc as any).lastAutoTable.finalY + 5
let ty = tableEndY

// Caja de totales (derecha)
const boxX = W - 85
doc.setFillColor(...C.bgLight)
doc.roundedRect(boxX, ty, 70, 28, 2, 2, 'F')

doc.setFontSize(8)
doc.setTextColor(...C.textLight)
doc.setFont('helvetica', 'normal')
doc.text('Subtotal neto:', boxX + 4, ty + 7)
doc.text('IVA 19%:', boxX + 4, ty + 14)

doc.setFont('helvetica', 'bold')
doc.setTextColor(...C.textMain)
doc.text(`$${Math.round(options.subtotal_neto).toLocaleString('es-CL')}`, W - 20, ty + 7, { align: 'right' })
doc.text(`$${Math.round(options.iva).toLocaleString('es-CL')}`, W - 20, ty + 14, { align: 'right' })

// Línea separadora
doc.setDrawColor(...C.secondary)
doc.setLineWidth(0.5)
doc.line(boxX + 4, ty + 17, boxX + 66, ty + 17)

doc.setFontSize(10)
doc.setTextColor(...C.secondary)
doc.text('Total con IVA:', boxX + 4, ty + 24)
doc.text(`$${Math.round(options.total_con_iva).toLocaleString('es-CL')}`, W - 20, ty + 24, { align: 'right' })

const finalY = ty + 33
```

> Reemplazar `const finalY = (doc as any).lastAutoTable.finalY + 25` con `const finalY = ty + 33` y ajustar el bloque de firmas para usar `finalY` correctamente.

- [ ] **Step 4: Compilar TypeScript**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -30
```

Resultado esperado: sin errores de tipo.

- [ ] **Step 5: Verificar PDF generado**

Generar una solicitud de prueba y descargar el PDF. Verificar:
- Columnas Cód. Prov. y Cód. Bodega presentes
- Columna Cantidad muestra unidades de presentación + equivalencia base
- Bloque de totales muestra Subtotal neto, IVA 19%, Total con IVA

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/solicitud-pdf.ts
git commit -m "feat(pdf): add precio, IVA breakdown, and product codes to solicitud PDF"
```

---

## Self-Review

### Cobertura del spec
- ✅ Sec 2.1 Precio de última recepción → Task 4 (query `ultimo_precio`) + Task 2 (migración + handler)
- ✅ Sec 2.2 Modo borrador → Task 5 (POST/PUT/GET borrador/enviar) + Task 10 (frontend)
- ✅ Sec 2.3 Urgencia dinámica → Task 4 (SQL con lead_time × factores)
- ✅ Sec 2.4 Panel dual → Task 8 + Task 9
- ✅ Sec 2.5 IVA 19% → Task 10 (footer) + Task 11 (PDF)
- ✅ Sec 2.6 Proveedor fijo → Task 9 (solo display, no editable)
- ✅ Sec 2.7 Mismo insumo distintos proveedores → Task 9 (grupos por proveedor sin fusionar)
- ✅ Sec 2.8 Unidades de presentación → Task 7 (helpers) + Task 9 (render)
- ✅ Sec 2.9 Códigos en tabla y PDF → Task 9 (tabla) + Task 11 (PDF)
- ✅ Sec 3 Migraciones → Tasks 1, 3
- ✅ Sec 4.1 Recepciones precio → Task 2
- ✅ Sec 4.2 Nuevos endpoints → Task 4, Task 5
- ✅ Sec 4.3 SolicitudDetalleItem → Task 5 Step 8
- ✅ Sec 5.3-5.6 Frontend completo → Tasks 6-10
- ✅ Sec 5.7 PDF → Task 11

### Consistencia de tipos
- `SolicitudItem.cantidad` es la cantidad en unidades de presentación o base — consistente en Task 7, 9, 10
- `CreateSolicitudRequest.items` usa `cantidad_sugerida` (en base) + `cantidad_presentaciones` — calculado en Task 10 Step 3
- `unidadLabel` recibe `SolicitudItem` y `number` — usado así en Task 9
- `ItemRecomendado` definido en Task 6, usado en Task 8 — consistente
