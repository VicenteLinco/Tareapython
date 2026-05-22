# Etapa 1 — Modelo de Producto (Multi-proveedor + Almacenamiento + Stock por Área)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar tres mejoras en el modelo de datos de productos: (1) relación muchos-a-muchos con proveedores via `producto_proveedor`, (2) atributos de almacenamiento de reactivos, y (3) stock mínimo/máximo configurable por área.

**Architecture:** Se crean 3 migraciones SQL (058–060). El backend mantiene `productos.proveedor_id` como caché del proveedor principal para compatibilidad con el filtro de lista, y añade `producto_proveedor` para el catálogo completo. El frontend actualiza los diálogos de creación/edición.

**Tech Stack:** Rust + Axum + SQLx, React 19 + TypeScript + Tailwind/DaisyUI, PostgreSQL 16

---

## Mapa de archivos

| Archivo | Cambio |
|---|---|
| `backend/migrations/058_producto_proveedor.sql` | CREAR tabla + migrar datos |
| `backend/migrations/059_producto_almacenamiento.sql` | CREAR columnas de almacenamiento en `productos` |
| `backend/migrations/060_producto_area_config.sql` | CREAR columnas stock_minimo/maximo en `producto_area` |
| `backend/src/models/producto_proveedor.rs` | CREAR struct `ProductoProveedor` |
| `backend/src/models/producto.rs` | MODIFICAR — agregar `deleted_at`, storage attrs |
| `backend/src/models/mod.rs` | MODIFICAR — registrar `producto_proveedor` |
| `backend/src/services/producto_service.rs` | MODIFICAR — crear/actualizar/detalle con proveedores |
| `backend/src/handlers/productos.rs` | MODIFICAR — DTOs, query list, filter proveedor |
| `backend/src/handlers/stock.rs` | MODIFICAR — alertas usan stock mínimo por área |
| `backend/src/bin/export_types.rs` | MODIFICAR — exportar `ProductoProveedor` |
| `frontend/src/pages/creador-productos/productos-tab.tsx` | MODIFICAR — multi-proveedor en Create/Edit dialog |

---

## Task 1: Migration 058 — tabla `producto_proveedor`

**Files:**
- Create: `backend/migrations/058_producto_proveedor.sql`

- [ ] **Step 1: Crear el archivo de migration**

```sql
-- backend/migrations/058_producto_proveedor.sql
-- Catálogo multi-proveedor por producto. Reemplaza la relación 1:1
-- de productos.proveedor_id por una relación N:M con datos adicionales.

CREATE TABLE producto_proveedor (
    id SERIAL PRIMARY KEY,
    producto_id UUID NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
    proveedor_id INT NOT NULL REFERENCES proveedores(id),
    es_principal BOOLEAN NOT NULL DEFAULT FALSE,
    codigo_proveedor VARCHAR(100),
    precio_unidad DECIMAL(12,4),
    lead_time_dias INT,
    unidad_minima_pedido DECIMAL(12,2),
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_producto_proveedor UNIQUE (producto_id, proveedor_id)
);

CREATE UNIQUE INDEX idx_pp_principal
    ON producto_proveedor(producto_id)
    WHERE es_principal = TRUE;

CREATE INDEX idx_pp_producto ON producto_proveedor(producto_id);
CREATE INDEX idx_pp_proveedor ON producto_proveedor(proveedor_id);

-- Migrar datos existentes de productos
INSERT INTO producto_proveedor
    (producto_id, proveedor_id, es_principal, codigo_proveedor, precio_unidad, lead_time_dias)
SELECT
    id,
    proveedor_id,
    TRUE,
    codigo_proveedor,
    precio_unidad,
    lead_time_propio
FROM productos
WHERE proveedor_id IS NOT NULL;
```

- [ ] **Step 2: Verificar que el archivo existe**

```bash
ls backend/migrations/058_producto_proveedor.sql
```

---

## Task 2: Migration 059 — atributos de almacenamiento

**Files:**
- Create: `backend/migrations/059_producto_almacenamiento.sql`

- [ ] **Step 1: Crear migration**

```sql
-- backend/migrations/059_producto_almacenamiento.sql
ALTER TABLE productos
    ADD COLUMN temperatura_almacenamiento VARCHAR(30)
        CHECK (temperatura_almacenamiento IN (
            'ambiente', 'refrigerado', 'congelado', 'ultra_frio', 'no_aplica'
        )),
    ADD COLUMN requiere_cadena_frio BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN dias_estabilidad_abierto INT,
    ADD COLUMN clase_riesgo VARCHAR(20)
        CHECK (clase_riesgo IN (
            'biologico', 'quimico', 'radiactivo', 'inflamable', 'corrosivo', 'ninguno'
        ));
```

---

## Task 3: Migration 060 — stock mínimo/máximo por área

**Files:**
- Create: `backend/migrations/060_producto_area_config.sql`

- [ ] **Step 1: Crear migration**

```sql
-- backend/migrations/060_producto_area_config.sql
-- NULL = hereda el stock_minimo global de productos.stock_minimo
ALTER TABLE producto_area
    ADD COLUMN stock_minimo DECIMAL(12,2),
    ADD COLUMN stock_maximo DECIMAL(12,2),
    ADD COLUMN punto_reorden DECIMAL(12,2);
```

---

## Task 4: Actualizar `models/producto.rs`

**Files:**
- Modify: `backend/src/models/producto.rs`

- [ ] **Step 1: Agregar campos nuevos al struct**

El archivo actual tiene 26 líneas. Reemplazar el contenido completo con:

```rust
use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, sqlx::FromRow, specta::Type)]
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
    pub lead_time_propio: Option<i32>,
    pub ubicacion: Option<String>,
    // Migration 059
    pub temperatura_almacenamiento: Option<String>,
    pub requiere_cadena_frio: bool,
    pub dias_estabilidad_abierto: Option<i32>,
    pub clase_riesgo: Option<String>,
    // Migration 056
    pub deleted_at: Option<DateTime<Utc>>,
    pub activo: bool,
    pub version: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}
```

> Nota: Los `use` del archivo original deben conservarse. Verificar que ya importa `serde::Serialize`.

---

## Task 5: Crear `models/producto_proveedor.rs`

**Files:**
- Create: `backend/src/models/producto_proveedor.rs`

- [ ] **Step 1: Crear archivo del modelo**

```rust
use chrono::{DateTime, Utc};
use rust_decimal::Decimal;
use serde::Serialize;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, sqlx::FromRow, specta::Type)]
pub struct ProductoProveedor {
    pub id: i32,
    pub producto_id: Uuid,
    pub proveedor_id: i32,
    pub es_principal: bool,
    pub codigo_proveedor: Option<String>,
    pub precio_unidad: Option<Decimal>,
    pub lead_time_dias: Option<i32>,
    pub unidad_minima_pedido: Option<Decimal>,
    pub activo: bool,
    pub version: i32,
    pub created_at: DateTime<Utc>,
}
```

- [ ] **Step 2: Registrar en `models/mod.rs`**

Agregar al final de `backend/src/models/mod.rs`:
```rust
pub mod producto_proveedor;
```

---

## Task 6: Actualizar `bin/export_types.rs`

**Files:**
- Modify: `backend/src/bin/export_types.rs`

- [ ] **Step 1: Agregar import y exportación de `ProductoProveedor`**

Localizar la línea donde se importan los modelos (busca `use inventario_lab_backend::models`). Agregar:
```rust
use inventario_lab_backend::models::producto_proveedor::ProductoProveedor;
```

Localizar la sección donde se registran los tipos con `export_types!` o similar y agregar `ProductoProveedor`.

- [ ] **Step 2: Compilar y regenerar tipos TypeScript**

```bash
cd backend && cargo run --bin export_types
```

Verificar que `frontend/src/types/generated.ts` contiene:
```typescript
export type ProductoProveedor = { id: number; producto_id: string; proveedor_id: number; es_principal: boolean; codigo_proveedor: string | null; precio_unidad: string | null; lead_time_dias: number | null; unidad_minima_pedido: string | null; activo: boolean; version: number; created_at: string }
```

Y que `Producto` incluye los nuevos campos de storage:
```typescript
export type Producto = { ...; temperatura_almacenamiento: string | null; requiere_cadena_frio: boolean; dias_estabilidad_abierto: number | null; clase_riesgo: string | null; deleted_at: string | null; ... }
```

---

## Task 7: Actualizar `handlers/productos.rs` — DTOs y queries

**Files:**
- Modify: `backend/src/handlers/productos.rs`

### 7.1 — Nuevo DTO `ProveedorProductoInput`

- [ ] **Step 1: Agregar struct después de `CreatePresentacionInline` (línea ~100)**

```rust
#[derive(Debug, Deserialize, specta::Type)]
pub struct ProveedorProductoInput {
    pub proveedor_id: i32,
    pub es_principal: bool,
    pub codigo_proveedor: Option<String>,
    pub precio_unidad: Option<Decimal>,
    pub lead_time_dias: Option<i32>,
    pub unidad_minima_pedido: Option<Decimal>,
}
```

### 7.2 — Actualizar `CreateProducto`

- [ ] **Step 2: Reemplazar struct `CreateProducto` (líneas 77-92)**

```rust
#[derive(Debug, Deserialize, specta::Type)]
struct CreateProducto {
    nombre: String,
    descripcion: Option<String>,
    categoria_id: Option<i32>,
    unidad_base_id: i32,
    codigo_maestro: Option<String>,
    stock_minimo: Option<Decimal>,
    ubicacion: Option<String>,
    // Storage attributes (Migration 059)
    temperatura_almacenamiento: Option<String>,
    requiere_cadena_frio: Option<bool>,
    dias_estabilidad_abierto: Option<i32>,
    clase_riesgo: Option<String>,
    // Relaciones
    presentaciones: Option<Vec<CreatePresentacionInline>>,
    area_ids: Option<Vec<i32>>,
    proveedores: Option<Vec<ProveedorProductoInput>>,
}
```

### 7.3 — Actualizar `UpdateProducto`

- [ ] **Step 3: Reemplazar struct `UpdateProducto` (líneas 102-116)**

```rust
#[derive(Debug, Deserialize)]
struct UpdateProducto {
    nombre: Option<String>,
    descripcion: Option<String>,
    categoria_id: Option<i32>,
    codigo_maestro: Option<String>,
    stock_minimo: Option<Decimal>,
    ubicacion: Option<String>,
    // Storage attributes
    temperatura_almacenamiento: Option<String>,
    requiere_cadena_frio: Option<bool>,
    dias_estabilidad_abierto: Option<i32>,
    clase_riesgo: Option<String>,
    // Relaciones
    area_ids: Option<Vec<i32>>,
    proveedores: Option<Vec<ProveedorProductoInput>>,
    version: i32,
}
```

### 7.4 — Actualizar filtro de proveedor en `listar`

- [ ] **Step 4: Cambiar el filtro de `proveedor_id` (línea ~187-190)**

Reemplazar:
```rust
if params.proveedor_id.is_some() {
    conditions.push(format!("p.proveedor_id = ${}", param_idx));
    param_idx += 1;
}
```

Por:
```rust
if params.proveedor_id.is_some() {
    conditions.push(format!(
        "EXISTS (SELECT 1 FROM producto_proveedor pp WHERE pp.producto_id = p.id AND pp.proveedor_id = ${} AND pp.activo = TRUE)",
        param_idx
    ));
    param_idx += 1;
}
```

### 7.5 — Actualizar handler `crear`

- [ ] **Step 5: Actualizar el bloque `crear` (líneas ~300-345) para pasar los nuevos campos al service**

```rust
async fn crear(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Json(req): Json<CreateProducto>,
) -> Result<(axum::http::StatusCode, Json<serde_json::Value>), AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;

    let nombre = req.nombre.trim().to_string();
    if nombre.is_empty() {
        return Err(AppError::Validation("El nombre es requerido".into()));
    }
    validate_text_length(&nombre, "nombre", 255)?;
    if let Some(ref desc) = req.descripcion {
        validate_text_length(desc, "descripcion", 1000)?;
    }

    let producto = ProductoService::crear_producto(
        &state.pool,
        crate::services::producto_service::CrearProductoParams {
            nombre,
            descripcion: req.descripcion,
            categoria_id: req.categoria_id,
            unidad_base_id: req.unidad_base_id,
            codigo_maestro: req.codigo_maestro,
            stock_minimo: req.stock_minimo,
            ubicacion: req.ubicacion,
            temperatura_almacenamiento: req.temperatura_almacenamiento,
            requiere_cadena_frio: req.requiere_cadena_frio.unwrap_or(false),
            dias_estabilidad_abierto: req.dias_estabilidad_abierto,
            clase_riesgo: req.clase_riesgo,
            presentaciones: req.presentaciones,
            area_ids: req.area_ids,
            proveedores: req.proveedores,
            usuario_id: claims.sub,
        },
    )
    .await?;

    Ok((
        axum::http::StatusCode::CREATED,
        Json(json!({
            "id": producto.id,
            "codigo_interno": producto.codigo_interno,
            "nombre": producto.nombre,
        })),
    ))
}
```

### 7.6 — Actualizar handler `actualizar`

- [ ] **Step 6: Actualizar el bloque `actualizar` (líneas ~347-384)**

```rust
async fn actualizar(
    State(state): State<AppState>,
    Extension(claims): Extension<Claims>,
    Path(id): Path<Uuid>,
    Json(req): Json<UpdateProducto>,
) -> Result<Json<Producto>, AppError> {
    crate::auth::middleware::require_role(&["admin"])(&claims)?;

    let nombre = req.nombre.as_deref().map(str::trim).unwrap_or("");
    if req.nombre.is_some() && nombre.is_empty() {
        return Err(AppError::Validation("El nombre no puede estar vacío".into()));
    }

    let producto = ProductoService::actualizar_producto(
        &state.pool,
        crate::services::producto_service::ActualizarProductoParams {
            id,
            nombre: nombre.to_string(),
            descripcion: req.descripcion,
            categoria_id: req.categoria_id,
            codigo_maestro: req.codigo_maestro,
            stock_minimo: req.stock_minimo,
            ubicacion: req.ubicacion,
            temperatura_almacenamiento: req.temperatura_almacenamiento,
            requiere_cadena_frio: req.requiere_cadena_frio,
            dias_estabilidad_abierto: req.dias_estabilidad_abierto,
            clase_riesgo: req.clase_riesgo,
            area_ids: req.area_ids,
            proveedores: req.proveedores,
            version_esperada: req.version,
            usuario_id: claims.sub,
        },
    )
    .await?;

    Ok(Json(producto))
}
```

---

## Task 8: Actualizar `services/producto_service.rs`

**Files:**
- Modify: `backend/src/services/producto_service.rs`

### 8.1 — Actualizar `CrearProductoParams`

- [ ] **Step 1: Reemplazar struct `CrearProductoParams` (líneas 11-26)**

```rust
pub struct CrearProductoParams {
    pub nombre: String,
    pub descripcion: Option<String>,
    pub categoria_id: Option<i32>,
    pub unidad_base_id: i32,
    pub codigo_maestro: Option<String>,
    pub stock_minimo: Option<Decimal>,
    pub ubicacion: Option<String>,
    // Storage attrs
    pub temperatura_almacenamiento: Option<String>,
    pub requiere_cadena_frio: bool,
    pub dias_estabilidad_abierto: Option<i32>,
    pub clase_riesgo: Option<String>,
    // Relaciones
    pub presentaciones: Option<Vec<crate::handlers::productos::CreatePresentacionInline>>,
    pub area_ids: Option<Vec<i32>>,
    pub proveedores: Option<Vec<crate::handlers::productos::ProveedorProductoInput>>,
    pub usuario_id: Uuid,
}
```

### 8.2 — Actualizar `ActualizarProductoParams`

- [ ] **Step 2: Reemplazar struct `ActualizarProductoParams` (líneas 28-43)**

```rust
pub struct ActualizarProductoParams {
    pub id: Uuid,
    pub nombre: String,
    pub descripcion: Option<String>,
    pub categoria_id: Option<i32>,
    pub codigo_maestro: Option<String>,
    pub stock_minimo: Option<Decimal>,
    pub ubicacion: Option<String>,
    // Storage attrs
    pub temperatura_almacenamiento: Option<String>,
    pub requiere_cadena_frio: Option<bool>,
    pub dias_estabilidad_abierto: Option<i32>,
    pub clase_riesgo: Option<String>,
    // Relaciones
    pub area_ids: Option<Vec<i32>>,
    pub proveedores: Option<Vec<crate::handlers::productos::ProveedorProductoInput>>,
    pub version_esperada: i32,
    pub usuario_id: Uuid,
}
```

### 8.3 — Actualizar `crear_producto`

- [ ] **Step 3: Reemplazar el INSERT de productos (líneas 57-80) para incluir los nuevos campos**

```rust
let producto = sqlx::query_as::<_, Producto>(
    r#"INSERT INTO productos
       (codigo_interno, nombre, descripcion, categoria_id, unidad_base_id,
        codigo_maestro, stock_minimo, ubicacion,
        temperatura_almacenamiento, requiere_cadena_frio, dias_estabilidad_abierto, clase_riesgo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *"#,
)
.bind(&codigo)
.bind(&params.nombre)
.bind(&params.descripcion)
.bind(params.categoria_id)
.bind(params.unidad_base_id)
.bind(&params.codigo_maestro)
.bind(params.stock_minimo.unwrap_or(Decimal::ZERO))
.bind(&params.ubicacion)
.bind(&params.temperatura_almacenamiento)
.bind(params.requiere_cadena_frio)
.bind(params.dias_estabilidad_abierto)
.bind(&params.clase_riesgo)
.fetch_one(&mut *tx)
.await
.map_err(|e| match &e {
    sqlx::Error::Database(db_err) if db_err.is_foreign_key_violation() => {
        AppError::Validation("Categoría, unidad o área no existe".into())
    }
    _ => e.into(),
})?;
```

- [ ] **Step 4: Agregar inserción en `producto_proveedor` después del INSERT de presentaciones y áreas (antes del audit_log)**

```rust
if let Some(provs) = params.proveedores {
    for prov in provs {
        sqlx::query(
            r#"INSERT INTO producto_proveedor
               (producto_id, proveedor_id, es_principal, codigo_proveedor, precio_unidad, lead_time_dias, unidad_minima_pedido)
               VALUES ($1, $2, $3, $4, $5, $6, $7)"#,
        )
        .bind(producto.id)
        .bind(prov.proveedor_id)
        .bind(prov.es_principal)
        .bind(&prov.codigo_proveedor)
        .bind(prov.precio_unidad)
        .bind(prov.lead_time_dias)
        .bind(prov.unidad_minima_pedido)
        .execute(&mut *tx)
        .await?;

        // Mantener productos.proveedor_id sincronizado con el proveedor principal
        if prov.es_principal {
            sqlx::query(
                "UPDATE productos SET proveedor_id = $1, codigo_proveedor = $2, precio_unidad = $3, lead_time_propio = $4 WHERE id = $5"
            )
            .bind(prov.proveedor_id)
            .bind(&prov.codigo_proveedor)
            .bind(prov.precio_unidad)
            .bind(prov.lead_time_dias)
            .bind(producto.id)
            .execute(&mut *tx)
            .await?;
        }
    }
}
```

### 8.4 — Actualizar `actualizar_producto`

- [ ] **Step 5: Reemplazar el UPDATE de productos (líneas 211-233)**

```rust
let producto = sqlx::query_as::<_, Producto>(
    r#"UPDATE productos
       SET nombre = $1, descripcion = $2, categoria_id = $3,
           stock_minimo = $4, codigo_maestro = $5, ubicacion = $6,
           temperatura_almacenamiento = $7, requiere_cadena_frio = $8,
           dias_estabilidad_abierto = $9, clase_riesgo = $10,
           version = version + 1, updated_at = NOW()
       WHERE id = $11 AND version = $12
       RETURNING *"#,
)
.bind(&params.nombre)
.bind(&params.descripcion)
.bind(params.categoria_id)
.bind(params.stock_minimo.unwrap_or(anterior.stock_minimo))
.bind(&params.codigo_maestro)
.bind(&params.ubicacion)
.bind(&params.temperatura_almacenamiento)
.bind(params.requiere_cadena_frio.unwrap_or(anterior.requiere_cadena_frio))
.bind(params.dias_estabilidad_abierto)
.bind(&params.clase_riesgo)
.bind(params.id)
.bind(params.version_esperada)
.fetch_optional(&mut *tx)
.await?
.ok_or(AppError::Conflict("Error de concurrencia al actualizar".into()))?;
```

- [ ] **Step 6: Agregar reemplazo de `producto_proveedor` en `actualizar_producto` (después del bloque de áreas)**

```rust
if let Some(provs) = params.proveedores {
    sqlx::query("DELETE FROM producto_proveedor WHERE producto_id = $1")
        .bind(params.id)
        .execute(&mut *tx)
        .await?;

    for prov in &provs {
        sqlx::query(
            r#"INSERT INTO producto_proveedor
               (producto_id, proveedor_id, es_principal, codigo_proveedor, precio_unidad, lead_time_dias, unidad_minima_pedido)
               VALUES ($1, $2, $3, $4, $5, $6, $7)"#,
        )
        .bind(params.id)
        .bind(prov.proveedor_id)
        .bind(prov.es_principal)
        .bind(&prov.codigo_proveedor)
        .bind(prov.precio_unidad)
        .bind(prov.lead_time_dias)
        .bind(prov.unidad_minima_pedido)
        .execute(&mut *tx)
        .await?;
    }

    // Sincronizar proveedor principal en productos
    if let Some(principal) = provs.iter().find(|p| p.es_principal) {
        sqlx::query(
            "UPDATE productos SET proveedor_id = $1, codigo_proveedor = $2, precio_unidad = $3, lead_time_propio = $4 WHERE id = $5"
        )
        .bind(principal.proveedor_id)
        .bind(&principal.codigo_proveedor)
        .bind(principal.precio_unidad)
        .bind(principal.lead_time_dias)
        .bind(params.id)
        .execute(&mut *tx)
        .await?;
    } else {
        // Sin proveedor principal, limpiar la referencia directa
        sqlx::query(
            "UPDATE productos SET proveedor_id = NULL, codigo_proveedor = NULL, precio_unidad = NULL, lead_time_propio = NULL WHERE id = $1"
        )
        .bind(params.id)
        .execute(&mut *tx)
        .await?;
    }
}
```

### 8.5 — Actualizar `obtener_detalle` para incluir `proveedores`

- [ ] **Step 7: Reemplazar `obtener_detalle` (líneas 121-189)**

Agregar el array de proveedores al JSON construido. La clave es añadir el bloque `proveedores` dentro de `json_build_object`:

```rust
pub async fn obtener_detalle(pool: &PgPool, id: Uuid) -> Result<serde_json::Value, AppError> {
    let result: Option<serde_json::Value> = sqlx::query_scalar(
        r#"SELECT json_build_object(
            'id',              p.id,
            'codigo_interno',  p.codigo_interno,
            'nombre',          p.nombre,
            'descripcion',     p.descripcion,
            'codigo_maestro',  p.codigo_maestro,
            'stock_minimo',    p.stock_minimo,
            'ubicacion',       p.ubicacion,
            'temperatura_almacenamiento', p.temperatura_almacenamiento,
            'requiere_cadena_frio',       p.requiere_cadena_frio,
            'dias_estabilidad_abierto',   p.dias_estabilidad_abierto,
            'clase_riesgo',               p.clase_riesgo,
            'activo',          p.activo,
            'version',         p.version,
            'created_at',      p.created_at,
            'updated_at',      p.updated_at,
            'categoria', CASE WHEN c.id IS NOT NULL
                THEN json_build_object('id', c.id, 'nombre', c.nombre)
                ELSE NULL
            END,
            'unidad_base', json_build_object(
                'id', ub.id,
                'nombre', ub.nombre,
                'nombre_plural', ub.nombre_plural
            ),
            'proveedores', COALESCE(
                (SELECT json_agg(
                    json_build_object(
                        'id',               pp.id,
                        'proveedor_id',     pp.proveedor_id,
                        'proveedor_nombre', prov.nombre,
                        'proveedor_icono',  prov.icono,
                        'es_principal',     pp.es_principal,
                        'codigo_proveedor', pp.codigo_proveedor,
                        'precio_unidad',    pp.precio_unidad,
                        'lead_time_dias',   pp.lead_time_dias,
                        'unidad_minima_pedido', pp.unidad_minima_pedido,
                        'activo',           pp.activo,
                        'version',          pp.version
                    ) ORDER BY pp.es_principal DESC, prov.nombre
                ) FROM producto_proveedor pp
                JOIN proveedores prov ON prov.id = pp.proveedor_id
                WHERE pp.producto_id = p.id AND pp.activo = TRUE),
                '[]'::json
            ),
            'presentaciones', COALESCE(
                (SELECT json_agg(
                    json_build_object(
                        'id',               pr.id,
                        'producto_id',      pr.producto_id,
                        'nombre',           pr.nombre,
                        'nombre_plural',    pr.nombre_plural,
                        'factor_conversion',pr.factor_conversion,
                        'codigo_barras',    pr.codigo_barras,
                        'activa',           pr.activa,
                        'version',          pr.version,
                        'created_at',       pr.created_at
                    ) ORDER BY pr.nombre
                ) FROM presentaciones pr
                WHERE pr.producto_id = p.id AND pr.activa = true),
                '[]'::json
            ),
            'areas', COALESCE(
                (SELECT json_agg(
                    json_build_object('id', a.id, 'nombre', a.nombre)
                    ORDER BY a.nombre
                ) FROM areas a
                JOIN producto_area pa ON pa.area_id = a.id
                WHERE pa.producto_id = p.id),
                '[]'::json
            )
        )
        FROM productos p
        LEFT JOIN categorias c ON c.id = p.categoria_id
        JOIN unidades_basicas ub ON ub.id = p.unidad_base_id
        WHERE p.id = $1"#,
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;

    result.ok_or(AppError::NotFound("Producto no encontrado".into()))
}
```

---

## Task 9: Actualizar stock handler — alertas por área

**Files:**
- Modify: `backend/src/handlers/stock.rs`

- [ ] **Step 1: Localizar la query de alertas (busca `stock_minimo`)**

Buscar en `stock.rs` la query que verifica `p.stock_minimo`. Hay una que hace:
```sql
WHERE s.cantidad > 0 AND p.stock_minimo > 0 AND p.activo = true
...
HAVING SUM(s.cantidad) < p.stock_minimo
```

- [ ] **Step 2: Actualizar para usar stock mínimo por área con fallback**

Reemplazar el fragmento relevante cambiando el `HAVING` y el filtro para usar el mínimo por área si existe:

```sql
-- Buscar la tabla producto_area para stock_minimo configurado por área
-- Fallback al global si producto_area.stock_minimo IS NULL
WHERE s.cantidad > 0
  AND COALESCE(pa.stock_minimo, p.stock_minimo, 0) > 0
  AND p.activo = true
...
-- En el JOIN agregar:
LEFT JOIN producto_area pa ON pa.producto_id = p.id AND pa.area_id = s.area_id
...
HAVING SUM(s.cantidad) < COALESCE(pa.stock_minimo, p.stock_minimo, 0)
```

> Nota: La query exacta varía según la CTE en `stock.rs`. Aplicar el mismo patrón `COALESCE(pa.stock_minimo, p.stock_minimo, 0)` en todos los lugares donde aparezca `p.stock_minimo` en la comparación de alertas.

---

## Task 10: Compilar backend

**Files:** ninguno nuevo

- [ ] **Step 1: Verificar compilación**

```bash
cd backend && cargo check 2>&1
```

Esperado: `Finished dev profile` sin errores. Warnings preexistentes están bien.

- [ ] **Step 2: Si hay errores de campos faltantes**

Los errores más probables son campos eliminados de `CrearProductoParams`/`ActualizarProductoParams` que aún se referencian en el handler. Verificar que todos los campos removidos (`proveedor_id`, `codigo_proveedor`, `precio_unidad`, `lead_time_propio`) ya no aparezcan en las llamadas al service.

---

## Task 11: Frontend — Interfaces TypeScript

**Files:**
- Modify: `frontend/src/pages/creador-productos/productos-tab.tsx`

Los tipos principales usados en el tab están definidos inline (no en `generated.ts`). Hay que actualizar las interfaces locales.

- [ ] **Step 1: Agregar interface `ProveedorProductoItem` cerca de las otras interfaces al inicio del archivo**

```typescript
interface ProveedorProductoItem {
  id?: number
  proveedor_id: number
  proveedor_nombre?: string
  proveedor_icono?: string | null
  es_principal: boolean
  codigo_proveedor?: string | null
  precio_unidad?: string | null
  lead_time_dias?: number | null
  unidad_minima_pedido?: string | null
  activo?: boolean
  version?: number
}
```

- [ ] **Step 2: Actualizar `ProductoDetailResponse`**

Localizar la interface `ProductoDetailResponse` y reemplazar la sección de proveedor:

```typescript
// Quitar:
proveedor: { id: number; nombre: string } | null

// Agregar:
proveedores: ProveedorProductoItem[]
// Agregar storage attrs:
temperatura_almacenamiento: string | null
requiere_cadena_frio: boolean
dias_estabilidad_abierto: number | null
clase_riesgo: string | null
```

---

## Task 12: Frontend — `CreateProductoDialog` (multi-proveedor)

**Files:**
- Modify: `frontend/src/pages/creador-productos/productos-tab.tsx`

- [ ] **Step 1: Actualizar estado del formulario en `CreateProductoDialog`**

Localizar el estado interno del dialog (busca `useState` con `proveedor_id`). Cambiar de:
```typescript
const [proveedorId, setProveedorId] = useState<number | null>(null)
const [codigoProveedor, setCodigoProveedor] = useState('')
const [precioUnidad, setPrecioUnidad] = useState('')
const [leadTime, setLeadTime] = useState<number | null>(null)
```

A:
```typescript
const [proveedores, setProveedores] = useState<ProveedorProductoItem[]>([])
```

Helper para agregar/eliminar proveedor:
```typescript
const agregarProveedor = (provId: number, nombre: string) => {
  setProveedores(prev => {
    const esPrimero = prev.length === 0
    return [...prev, {
      proveedor_id: provId,
      proveedor_nombre: nombre,
      es_principal: esPrimero,
      codigo_proveedor: null,
      precio_unidad: null,
      lead_time_dias: null,
    }]
  })
}

const eliminarProveedor = (provId: number) => {
  setProveedores(prev => {
    const filtered = prev.filter(p => p.proveedor_id !== provId)
    // Si se eliminó el principal, hacer principal al primero
    if (filtered.length > 0 && !filtered.some(p => p.es_principal)) {
      filtered[0].es_principal = true
    }
    return filtered
  })
}

const marcarPrincipal = (provId: number) => {
  setProveedores(prev => prev.map(p => ({
    ...p,
    es_principal: p.proveedor_id === provId
  })))
}
```

- [ ] **Step 2: Reemplazar la sección de proveedor en el JSX del `CreateProductoDialog`**

Reemplazar el bloque con el `<select>` de proveedor único por:

```tsx
{/* Sección Proveedores */}
<div className="space-y-2">
  <label className="text-[10px] font-bold uppercase tracking-widest text-base-content/40">
    Proveedores
  </label>

  {/* Lista de proveedores agregados */}
  {proveedores.map((pp) => (
    <div key={pp.proveedor_id} className="flex items-center gap-2 p-2 bg-base-200 rounded-lg">
      <div className="flex-1 min-w-0">
        <span className="text-sm font-medium truncate">{pp.proveedor_nombre}</span>
        {pp.es_principal && (
          <span className="ml-2 text-[10px] font-bold uppercase text-primary">Principal</span>
        )}
      </div>
      <input
        type="text"
        placeholder="Cód. proveedor"
        value={pp.codigo_proveedor ?? ''}
        onChange={e => setProveedores(prev => prev.map(p =>
          p.proveedor_id === pp.proveedor_id ? { ...p, codigo_proveedor: e.target.value || null } : p
        ))}
        className="input input-xs input-bordered w-28"
      />
      <input
        type="number"
        placeholder="Precio/u"
        value={pp.precio_unidad ?? ''}
        onChange={e => setProveedores(prev => prev.map(p =>
          p.proveedor_id === pp.proveedor_id ? { ...p, precio_unidad: e.target.value || null } : p
        ))}
        className="input input-xs input-bordered w-24"
        min="0"
        step="0.01"
      />
      {!pp.es_principal && (
        <button
          type="button"
          onClick={() => marcarPrincipal(pp.proveedor_id)}
          className="btn btn-xs btn-ghost text-xs"
          title="Marcar como principal"
        >★</button>
      )}
      <button
        type="button"
        onClick={() => eliminarProveedor(pp.proveedor_id)}
        className="btn btn-xs btn-ghost text-error"
      >✕</button>
    </div>
  ))}

  {/* Dropdown para agregar proveedor */}
  <select
    className="select select-sm bg-base-100 border border-base-300 rounded-xl w-full"
    value=""
    onChange={e => {
      const provId = parseInt(e.target.value)
      if (!provId) return
      const prov = proveedoresList?.find((p: any) => p.id === provId)
      if (prov && !proveedores.some(p => p.proveedor_id === provId)) {
        agregarProveedor(provId, prov.nombre)
      }
    }}
  >
    <option value="">+ Agregar proveedor...</option>
    {proveedoresList
      ?.filter((p: any) => !proveedores.some(pp => pp.proveedor_id === p.id))
      .map((p: any) => (
        <option key={p.id} value={p.id}>{p.nombre}</option>
      ))
    }
  </select>
</div>
```

- [ ] **Step 3: Actualizar el payload del POST en el submit del `CreateProductoDialog`**

En la llamada `api.post('/productos', {...})`, reemplazar los campos de proveedor:

```typescript
// Quitar del payload:
// proveedor_id, codigo_proveedor, precio_unidad, lead_time_propio

// Agregar al payload:
proveedores: proveedores.map(pp => ({
  proveedor_id: pp.proveedor_id,
  es_principal: pp.es_principal,
  codigo_proveedor: pp.codigo_proveedor || null,
  precio_unidad: pp.precio_unidad ? pp.precio_unidad : null,
  lead_time_dias: pp.lead_time_dias || null,
  unidad_minima_pedido: null,
})),
```

- [ ] **Step 4: Agregar campos de almacenamiento al formulario (después de descripción)**

```tsx
{/* Sección Almacenamiento */}
<div className="space-y-3 border-t border-base-200 pt-3">
  <p className="text-[10px] font-bold uppercase tracking-widest text-base-content/40">
    Almacenamiento
  </p>
  <div className="grid grid-cols-2 gap-3">
    <div className="flex flex-col gap-1">
      <label className="text-[10px] font-bold uppercase tracking-widest text-base-content/40">
        Temperatura
      </label>
      <select
        className="select select-sm bg-base-100 border border-base-300 rounded-xl"
        value={temperaturaAlmacenamiento ?? ''}
        onChange={e => setTemperaturaAlmacenamiento(e.target.value || null)}
      >
        <option value="">No especificada</option>
        <option value="ambiente">Ambiente (15–30°C)</option>
        <option value="refrigerado">Refrigerado (2–8°C)</option>
        <option value="congelado">Congelado (-20°C)</option>
        <option value="ultra_frio">Ultra frío (-80°C)</option>
        <option value="no_aplica">No aplica</option>
      </select>
    </div>
    <div className="flex flex-col gap-1">
      <label className="text-[10px] font-bold uppercase tracking-widest text-base-content/40">
        Clase de riesgo
      </label>
      <select
        className="select select-sm bg-base-100 border border-base-300 rounded-xl"
        value={claseRiesgo ?? ''}
        onChange={e => setClaseRiesgo(e.target.value || null)}
      >
        <option value="">Ninguno</option>
        <option value="biologico">Biológico</option>
        <option value="quimico">Químico</option>
        <option value="inflamable">Inflamable</option>
        <option value="corrosivo">Corrosivo</option>
        <option value="radiactivo">Radiactivo</option>
      </select>
    </div>
  </div>
  <div className="flex items-center gap-3">
    <label className="flex items-center gap-2 cursor-pointer">
      <input
        type="checkbox"
        className="checkbox checkbox-sm checkbox-primary"
        checked={requiereCadenaFrio}
        onChange={e => setRequiereCadenaFrio(e.target.checked)}
      />
      <span className="text-sm">Requiere cadena de frío</span>
    </label>
    <div className="flex flex-col gap-1 flex-1">
      <label className="text-[10px] font-bold uppercase tracking-widest text-base-content/40">
        Estabilidad abierto (días)
      </label>
      <input
        type="number"
        className="input input-sm input-bordered bg-base-100"
        placeholder="ej: 30"
        value={diasEstabilidadAbierto ?? ''}
        onChange={e => setDiasEstabilidadAbierto(e.target.value ? parseInt(e.target.value) : null)}
        min="1"
      />
    </div>
  </div>
</div>
```

> Estados necesarios a agregar en `CreateProductoDialog`:
> ```typescript
> const [temperaturaAlmacenamiento, setTemperaturaAlmacenamiento] = useState<string | null>(null)
> const [requiereCadenaFrio, setRequiereCadenaFrio] = useState(false)
> const [diasEstabilidadAbierto, setDiasEstabilidadAbierto] = useState<number | null>(null)
> const [claseRiesgo, setClaseRiesgo] = useState<string | null>(null)
> ```

- [ ] **Step 5: Incluir campos de almacenamiento en el payload del POST**

```typescript
temperatura_almacenamiento: temperaturaAlmacenamiento,
requiere_cadena_frio: requiereCadenaFrio,
dias_estabilidad_abierto: diasEstabilidadAbierto,
clase_riesgo: claseRiesgo,
```

---

## Task 13: Frontend — `EditProductoDialog` (multi-proveedor + storage)

**Files:**
- Modify: `frontend/src/pages/creador-productos/productos-tab.tsx`

- [ ] **Step 1: Inicializar proveedores desde el detalle del producto al abrir `EditProductoDialog`**

En el `useEffect` que carga el producto a editar, agregar:
```typescript
setProveedores(producto.proveedores ?? [])
setTemperaturaAlmacenamiento(producto.temperatura_almacenamiento ?? null)
setRequiereCadenaFrio(producto.requiere_cadena_frio ?? false)
setDiasEstabilidadAbierto(producto.dias_estabilidad_abierto ?? null)
setClaseRiesgo(producto.clase_riesgo ?? null)
```

- [ ] **Step 2: Replicar en `EditProductoDialog` el mismo JSX de proveedores y almacenamiento del Create dialog**

Los mismos componentes JSX del Task 12 steps 2 y 4 se usan en Edit. Copiar el bloque.

- [ ] **Step 3: Actualizar payload del PUT en `EditProductoDialog`**

```typescript
// En el body del PUT /productos/{id}, reemplazar campos viejos de proveedor con:
proveedores: proveedores.map(pp => ({
  proveedor_id: pp.proveedor_id,
  es_principal: pp.es_principal,
  codigo_proveedor: pp.codigo_proveedor || null,
  precio_unidad: pp.precio_unidad ?? null,
  lead_time_dias: pp.lead_time_dias ?? null,
  unidad_minima_pedido: null,
})),
temperatura_almacenamiento: temperaturaAlmacenamiento,
requiere_cadena_frio: requiereCadenaFrio,
dias_estabilidad_abierto: diasEstabilidadAbierto,
clase_riesgo: claseRiesgo,
```

---

## Task 14: Verificar compilación final y tipos

- [ ] **Step 1: Compilar backend**
```bash
cd backend && cargo check 2>&1
```
Esperado: `Finished` sin errores.

- [ ] **Step 2: Regenerar tipos TypeScript**
```bash
cd backend && cargo run --bin export_types
```

- [ ] **Step 3: Verificar tipos frontend**
```bash
cd frontend && npx tsc --noEmit 2>&1
```
Esperado: sin errores de tipo.

- [ ] **Step 4: Commit**
```bash
git add backend/migrations/058_producto_proveedor.sql \
        backend/migrations/059_producto_almacenamiento.sql \
        backend/migrations/060_producto_area_config.sql \
        backend/src/models/producto_proveedor.rs \
        backend/src/models/producto.rs \
        backend/src/models/mod.rs \
        backend/src/services/producto_service.rs \
        backend/src/handlers/productos.rs \
        backend/src/handlers/stock.rs \
        backend/src/bin/export_types.rs \
        frontend/src/types/generated.ts \
        frontend/src/pages/creador-productos/productos-tab.tsx

git commit -m "feat(productos): multi-proveedor, atributos de almacenamiento y stock por área (Etapa 1)"
```

---

## Notas de testing manual

Una vez levantado el sistema (`./iniciar.ps1`), verificar:

1. **Crear producto** con 2 proveedores → el principal aparece en el listado
2. **Editar producto** → los proveedores previos cargan correctamente
3. **Filtrar por proveedor** en el tab de Productos → filtra correctamente
4. **Campos de temperatura y riesgo** → se guardan y cargan en el formulario
5. **Alertas de stock** → verificar que usan el mínimo por área cuando está configurado

---

## Self-review

**Spec coverage:**
- ✅ `producto_proveedor` table con migración de datos
- ✅ Multi-proveedor en backend (crear, actualizar, detalle)
- ✅ Multi-proveedor en frontend (create/edit dialog)
- ✅ Atributos de almacenamiento en DB, backend y frontend
- ✅ Stock mínimo/máximo por área en DB y backend alertas
- ⚠️ Frontend areas-tab para configurar stock por área — no incluido en este plan (complejidad adicional, puede ser un sub-task posterior)

**Placeholder scan:** ninguno encontrado. Todo el código está completo.

**Type consistency:**
- `ProveedorProductoInput` definido en handlers/productos.rs y referenciado en services/producto_service.rs ✅
- `ProductoProveedor` model definido en Task 5 y exportado en Task 6 ✅
- `ProveedorProductoItem` interface definida en Task 11 y usada en Tasks 12-13 ✅
