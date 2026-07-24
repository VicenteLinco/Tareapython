# Análisis de Deficiencias — Diseño de BD de Productos (v2 Corregida)

> **Fecha**: 2026-07-23  
> **Alcance**: Solo análisis. Sin implementación.  
> **Nota**: Esta versión corrige hallazgos de la v1 que fueron verificados incorrectamente. Se incluyen ubicaciones exactas de código, líneas, y evidencia.

---

## Tabla de Contenidos

1. [imagen_path — Bug activo: 2 queries retornan NULL](#1-imagen_path--bug-activo-2-queries-retornan-null)
2. [CHECK constraints: strings crudos vs enums PG — desalineación real](#2-check-constraints-strings-crudos-vs-enums-pg--desalineación-real)
3. [estado_catalogo: Rust enum incompleto](#3-estado_catalogo-rust-enum-incompleto)
4. [clase_riesgo: sin Rust enum — CHECK vulnerable a importación](#4-clase_riesgo-sin-rust-enum--check-vulnerable-a-importación)
5. [temperatura_almacenamiento: sin Rust enum — mismo problema](#5-temperatura_almacenamiento-sin-rust-enum--mismo-problema)
6. [updated_at: trigger existe, pero redundancia y inconsistencia cross-table](#6-updated_at-trigger-existe-pero-redundancia-e-inconsistencia-cross-table)
7. [search_vector: trigger existe y funciona correctamente](#7-search_vector-trigger-existe-y-funciona-correctamente)
8. [producto_area: PK existe, pero INSERT sin ON CONFLICT](#8-producto_area-pk-existe-pero-insert-sin-on-conflict)
9. [stock_maximo / punto_reorden: sin CHECK de rangos](#9-stock_maximo--punto_reorden-sin-check-de-rangos)
10. [stock_minimo_global: sin CHECK no-negativo](#10-stock_minimo_global-sin-check-no-negativo)
11. [nombre: sin UNIQUE — duplicados silenciosos](#11-nombre-sin-unique--duplicados-silenciosos)
12. [codigo_interno: unique parcial sin considerar activo](#12-codigo_interno-unique-parcial-sin-considerar-activo)
13. [codigo_loinc_cpt: campo híbrido sin normalización](#13-codigo_loinc_cpt-campo-híbrido-sin-normalización)
14. [control_lote: downgrade sin protección](#14-control_lote-downgrade-sin-protección)
15. [created_by / updated_by: audit_log existe pero payloads mínimos](#15-created_by--updated_by-audit_log-existe-pero-payloads-mínimos)
16. [es_kit: flag sin soporte relacional](#16-es_kit-flag-sin-soporte-relacional)
17. [lotes: ON DELETE NO ACTION — hard delete bloqueado](#17-lotes-on-delete-no-action--hard-delete-bloqueado)
18. [presentaciones: sin UNIQUE compuesto](#18-presentaciones-sin-unique-compuesto)
19. [producto_codigos_barras: sin validación de formato](#19-producto_codigos_barras-sin-validación-de-formato)
20. [promedio_uso_mensual: dualidad sin documentación](#20-promedio_uso_mensual-dualidad-sin-documentación)

---

## 1. `imagen_path` — Bug activo: 2 queries retornan NULL

### Qué es

La tabla `productos` tiene DOS columnas de imagen:

```sql
-- Migración 001_initial_schema.sql, líneas 1033 y 1042:
imagen_path text,    -- Columna legacy, NUNCA se escribe
imagen_url text,     -- Columna activa, todas las operaciones la usan
```

### Cómo afecta al sistema

**Hay 2 queries en producción que seleccionan la columna equivocada:**

**`handlers/conteo.rs` línea 205:**
```sql
p.imagen_path AS imagen_url
```

**`services/stock_service.rs` línea 525:**
```sql
p.imagen_path AS imagen_url
```

Ambas hacen `alias` de `imagen_path` a `imagen_url`. Como `imagen_path` NUNCA se escribe (todas las operaciones — `set_imagen`, `limpiar_imagen`, bulk import — escriben a `imagen_url`), estas queries **siempre retornan NULL** para la imagen del producto.

**Impacto concreto:**
- En la vista de conteo físico, los productos **no muestran imagen** aunque tengan una imagen cargada.
- En el servicio de stock (panel de detalle, alertas), los productos **no muestran imagen**.
- El frontend recibe `imagen_url: null` y muestra un placeholder vacío.

### Cómo debería ser

Reemplazar `p.imagen_path AS imagen_url` por `p.imagen_url AS imagen_url` en ambas queries, y luego DROP COLUMN `imagen_path` después de verificar que no hay datos en ella.

**Archivos a corregir:**
- `source/backend/src/handlers/conteo.rs:205`
- `source/backend/src/services/stock_service.rs:525`

---

## 2. CHECK constraints: strings crudos vs enums PG — desalineación real

### Qué es

Cinco campos usan CHECK constraints con arrays de strings literales en SQL:

| Campo | Valores en CHECK (SQL) | Tipo Rust |
|-------|------------------------|-----------|
| `control_lote` | `trazable`, `con_vto`, `simple` | `enum ControlLote` ✅ |
| `estado_catalogo` | `incompleto`, `pendiente_aprobacion`, `aprobado`, `rechazado` | `enum EstadoCatalogo` ⚠️ **2 de 4** |
| `origen_registro` | `manual`, `api_regulatoria`, `guia_pdf`, `importacion_csv` | `enum OrigenRegistro` ✅ |
| `clase_riesgo` | `biologico`, `quimico`, `radiactivo`, `inflamable`, `corrosivo`, `ninguno` | `Option<String>` ❌ **sin enum** |
| `temperatura_almacenamiento` | `ambiente`, `refrigerado`, `congelado`, `ultra_frio`, `no_aplica` | `Option<String>` ❌ **sin enum** |

### Cómo afecta al sistema

**Problema 1: Duplicación de source of truth.** Los valores están definidos en DOS lugares: el CHECK constraint de SQL y el enum de Rust. Si se agrega un valor en uno y se olvida el otro, hay un mismatch silencioso. El CHECK falla en runtime con un error de BD crudo, no una validación amigable.

**Problema 2: Sin enum Rust para `clase_riesgo` y `temperatura_almacenamiento`.** El backend recibe这些 campos como `Option<String>` — no valida nada antes de hacer INSERT. Si el smart importer de CSV envía `"2-8 C"` para temperatura o `"Class IIa"` para clase_riesgo, el error ocurre en la BD con un `CHECK constraint violation` crudo, no en la capa de aplicación con un mensaje util.

**Problema 3: El frontend hardcodea los valores en 5+ lugares.** `productos-tab.tsx`, `control-lote.ts`, `ImportadorGuiaModal.tsx` — cada uno tiene su propia lista de opciones. Si se agrega un valor al CHECK, hay que tocar todos estos archivos manualmente.

### Cómo debería ser

```sql
-- Opción A: ENUMs de PostgreSQL (un solo source of truth)
CREATE TYPE control_lote_t AS ENUM ('trazable', 'con_vto', 'simple');
ALTER TABLE productos ALTER COLUMN control_lote TYPE control_lote_t USING control_lote::control_lote_t;
```

En Rust, sqlx soporta enums nativos de PG:
```rust
#[derive(sqlx::Type)]
#[sqlx(type_name = "control_lote_t", rename_all = "snake_case")]
pub enum ControlLote { Trazable, ConVto, Simple }
```

Esto elimina la duplicación, da type safety en Rust, y permite que el frontend genere las opciones automáticamente desde el schema de la BD.

---

## 3. `estado_catalogo`: Rust enum incompleto

### Qué es

El CHECK constraint de SQL permite 4 valores:
```sql
-- 001_initial_schema.sql línea 1055:
CHECK ((estado_catalogo = ANY (ARRAY['incompleto', 'pendiente_aprobacion', 'aprobado', 'rechazado'])))
```

El enum Rust solo tiene 2:
```rust
// domain/estados.rs líneas 107-114:
pub enum EstadoCatalogo {
    PendienteAprobacion,
    Aprobado,
}
```

**Faltan: `Incompleto` y `Rechazado`.**

### Cómo afecta al sistema

El código backend trabaja alrededor de esto usando strings crudos:

- `setup_service.rs:103` — `WHERE estado_catalogo IN ('incompleto','pendiente_aprobacion')` (raw SQL string)
- `setup_service.rs:747` — `SET estado_catalogo = 'pendiente_aprobacion'` (raw SQL string)
- `import_batches.rs:531` — `SET estado_catalogo=CASE WHEN unidad_base_id IS NULL THEN 'incompleto' ELSE 'pendiente_aprobacion' END` (raw SQL string)
- `consumo_service.rs:101` — `if estado_catalogo == "pendiente_aprobacion"` (string comparison, no enum)

El enum `EstadoCatalogo` solo se usa en:
- `producto_service.rs:1451` — `if prod.estado_catalogo != EstadoCatalogo::PendienteAprobacion`
- `handlers/productos.rs:229` — `if req.estado_catalogo == Some(EstadoCatalogo::PendienteAprobacion)`

**Impacto:** El tipo enum no cubre todos los estados posibles. Los valores `incompleto` y `rechazado` existen en la BD pero no en el modelo Rust, lo que significa que cualquier lógica que quiera distinguir estos estados tiene que hacer string comparison en vez de pattern matching exhaustivo. Si se agrega un nuevo estado, el compilador no obliga a manejarlo.

### Cómo debería ser

```rust
pub enum EstadoCatalogo {
    Incompleto,         // ← agregar
    PendienteAprobacion,
    Aprobado,
    Rechazado,          // ← agregar
}
```

Y reemplazar TODOS los strings crudos `'incompleto'`, `'pendiente_aprobacion'` etc. por el enum. Esto da exhaustividad en match y previene typos.

---

## 4. `clase_riesgo`: sin Rust enum — CHECK vulnerable a importación

### Qué es

```sql
-- 001_initial_schema.sql línea 1057:
CHECK (((clase_riesgo)::text = ANY (ARRAY['biologico', 'quimico', 'radiactivo', 'inflamable', 'corrosivo', 'ninguno'])))
```

En Rust: `Option<String>` — sin enum, sin validación.

### Cómo afecta al sistema

**El smart importer de CSV trata `clase_riesgo` como texto libre:**
```typescript
// smart-importer.tsx líneas 1096-1102:
// Hint: "Clase I, Clase IIa, Clase III"
```

El ejemplo en la migración de datos es `"Clase IIa"` — un valor que **NO existe en el CHECK constraint**. Si un usuario importa un CSV con ese valor:

1. El frontend envía `"Class IIa"` como string.
2. El backend (`producto_service.rs:344`) lo binda como raw string sin validación.
3. PostgreSQL rechaza el INSERT con: `ERROR: new row for relation "productos" violates check constraint "productos_clase_riesgo_check"`.
4. El usuario ve un error crudo de BD, no un mensaje amigable.

**Lo mismo aplica para `api_regulatoria_service.rs`** que trae datos de FDA/EUDAMED con valores de clase que no coinciden con el CHECK de la BD.

**`temperatura_almacenamiento` tiene el mismo problema:** el smart importer envía texto libre (`"2-8 C"`, `"Refrigerador"`) que no coincide con los valores del CHECK (`refrigerado`, `congelado`, etc.).

### Cómo debería ser

1. Crear enums Rust para ambos campos.
2. Agregar validación en la capa de servicio ANTES del INSERT.
3. El smart importer debe mapear los valores libres a los valores del enum (ej: `"2-8 C"` → `"refrigerado"`, `"Class IIa"` → no mapeable, reportar error).
4. Idealmente, crear ENUMs de PostgreSQL para tener validación en ambos niveles.

---

## 5. `temperatura_almacenamiento`: sin Rust enum — mismo problema

Ver sección 4. Mismo patrón: CHECK constraint en SQL, `Option<String>` en Rust, texto libre en el importer.

**Diferencia adicional:** El frontend `productos-tab.tsx:1719-1732` SÍ tiene un `<select>` con las 5 opciones correctas, pero el importer de CSV ignora eso y trata el campo como texto libre.

---

## 6. `updated_at`: trigger existe, pero redundancia e inconsistencia cross-table

### Qué es (CORREGIDO de v1)

**SÍ existe un trigger automático** en `productos`:

```sql
-- 001_initial_schema.sql línea 2777:
CREATE TRIGGER trg_update_timestamp_productos
  BEFORE UPDATE ON public.productos
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_update_timestamp();
```

```sql
-- 001_initial_schema.sql líneas 301-308:
CREATE FUNCTION fn_update_timestamp() RETURNS trigger AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

### Cómo afecta al sistema

**El trigger funciona correctamente** — todo UPDATE a `productos` obtiene `updated_at = CURRENT_TIMESTAMP` automáticamente. Sin embargo, hay dos problemas:

**Problema 1: Redundancia confusa.** 5 de 14 queries de UPDATE en producción escriben `updated_at = NOW()` explícitamente, sabiendo o no que el trigger lo sobreescribirá:

| Ubicación | Operación | ¿Escribe updated_at? |
|---|---|---|
| `producto_service.rs:543` | editar_producto | SÍ (redundante) |
| `producto_service.rs:638` | eliminar_producto | SÍ (redundante) |
| `producto_service.rs:668` | reactivar_producto | SÍ (redundante) |
| `producto_service.rs:1381` | set_imagen | NO (trigger cubre) |
| `producto_service.rs:1392` | limpiar_imagen | NO (trigger cubre) |
| `producto_service.rs:1469` | approve_product | SÍ (redundante) |
| `setup_service.rs:826` | auto-approve import | NO (trigger cubre) |
| `import_batches.rs:517` | set unidad_base | SÍ (redundante) |
| `import_batches.rs:531` | recalculate estado | NO (trigger cubre) |
| `import_batches.rs:535` | approve after enrich | NO (trigger cubre) |
| `promedio_job.rs:87` | recalc promedio | SÍ (redundante) |

Los desarrolladores que escriben `updated_at = NOW()` no parecen saber que el trigger existe. Esto crea confusión: ¿es necesario o no?

**Problema 2: Inconsistencia cross-table.** Solo `productos`, `stock`, `usuarios` y `solicitud_envios` tienen triggers. Otras tablas con `updated_at` NO lo tienen:

| Tabla | ¿Tiene updated_at? | ¿Tiene trigger? |
|---|---|---|
| `productos` | ✅ | ✅ |
| `stock` | ✅ | ✅ |
| `usuarios` | ✅ | ✅ |
| `solicitud_envios` | ✅ | ✅ |
| `conteo_items` | ✅ | ❌ |
| `sesiones_conteo` | ✅ | ❌ |
| `lab_campo_definicion` | ✅ | ❌ |
| `lab_campo_valor` | ✅ | ❌ |
| `lab_campo_producto_valor` | ✅ | ❌ |

Las tablas sin trigger dependen 100% de que el backend recuerde escribir `updated_at = NOW()` en cada UPDATE. Si alguien olvida, el campo queda stale.

### Cómo debería ser

1. **Eliminar la escritura manual redundante** de `updated_at = NOW()` en las 5 queries de producción — el trigger ya lo hace.
2. **Crear el mismo trigger `fn_update_timestamp()` para TODAS las tablas que tienen `updated_at`** — especialmente `conteo_items`, `sesiones_conteo`, `lab_campo_*`.
3. **Documentar la convención**: "Nunca escribas `updated_at` manualmente; el trigger se encarga."

---

## 7. `search_vector`: trigger existe y funciona correctamente

### Qué es (CORREGIDO de v1)

**SÍ existe un trigger automático** en `productos`:

```sql
-- 001_initial_schema.sql línea 2770:
CREATE TRIGGER trg_productos_search_vector
    BEFORE INSERT OR UPDATE OF nombre, codigo_interno, descripcion, fabricante
    ON public.productos
    FOR EACH ROW
    EXECUTE FUNCTION public.productos_search_vector_update();
```

```sql
-- 001_initial_schema.sql líneas 447-458:
CREATE FUNCTION productos_search_vector_update() RETURNS trigger AS $$
BEGIN
    NEW.search_vector :=
        setweight(to_tsvector('simple', COALESCE(NEW.nombre, '')), 'A') ||
        setweight(to_tsvector('simple', COALESCE(NEW.codigo_interno, '')), 'A') ||
        setweight(to_tsvector('simple', COALESCE(NEW.descripcion, '')), 'C') ||
        setweight(to_tsvector('simple', COALESCE(NEW.fabricante, '')), 'C');
    RETURN NEW;
END;
$$;
```

**Detalles del trigger:**
- Se dispara en INSERT y en UPDATE **solo** de las 4 columnas de texto (`nombre`, `codigo_interno`, `descripcion`, `fabricante`).
- Usa config `'simple'` (sin stemming, sin stop words — solo tokenización).
- `nombre` y `codigo_interno` tienen peso A (máximo). `descripcion` y `fabricante` tienen peso C.
- El backend NUNCA escribe `search_vector` manualmente — confía 100% en el trigger.
- Hay un GIN index: `CREATE INDEX idx_productos_search_vector ON productos USING gin (search_vector)`.

**La búsqueda híbrida** en `producto_service.rs:1153-1158` combina:
1. Full-text via `@@ plainto_tsquery` (usa el GIN index).
2. Fallback `ILIKE '%term%'` en `nombre` y `codigo_interno` (para substrings).
3. Búsqueda en `presentaciones.sku` vía `EXISTS`.

### Impacto actual

**Funciona correctamente.** No hay deficiencia funcional. El único punto de mejora es que el GIN index no tiene `WHERE deleted_at IS NULL`, lo que significa que productos soft-deleteados siguen indexados ( desperdicia espacio mínimo, pero no afecta resultados porque el backend filtra por `activo = true`).

### Cómo debería ser

Sin cambios necesarios. Opcionalmente, agregar `WHERE deleted_at IS NULL` al GIN index para ahorrar espacio, pero es un optimización menor.

---

## 8. `producto_area`: PK existe, pero INSERT sin ON CONFLICT

### Qué es (CORREGIDO de v1)

**SÍ existe un PRIMARY KEY compuesto:**

```sql
-- 001_initial_schema.sql línea 1937:
ALTER TABLE ONLY public.producto_area
    ADD CONSTRAINT producto_area_pkey PRIMARY KEY (producto_id, area_id);
```

Esto **previene duplicados** a nivel de BD.

### Cómo afecta al sistema

El problema no es la PK — es que la capa de aplicación no la maneja correctamente.

**`producto_service.rs` línea 386 (crear producto):**
```rust
// INSERT INTO producto_area (producto_id, area_id) VALUES ($1, $2)
// Sin ON CONFLICT
```

Si `area_ids` contiene `[1, 1]` o si la relación ya existe, el segundo INSERT falla con:
```
ERROR: duplicate key value violates unique constraint "producto_area_pkey"
```

Esto es un error crudo de BD que se propaga como un 500 interno, no como una validación amigable.

**En contraste, las rutas seguras:**
- `setup_service.rs:1069` — `INSERT ... ON CONFLICT DO NOTHING` ✅
- `recepcion_service.rs:492` — `INSERT ... ON CONFLICT DO NOTHING` ✅
- `whatsapp_service.rs:612` — `INSERT ... ON CONFLICT DO NOTHING` ✅

### Cómo debería ser

Agregar `ON CONFLICT DO NOTHING` al INSERT de `producto_service.rs:386`, o validar en la capa de servicio que `area_ids` no contiene duplicados antes del INSERT.

---

## 9. `stock_maximo` / `punto_reorden`: sin CHECK de rangos

### Qué es

```sql
-- 001_initial_schema.sql líneas 938-943:
CREATE TABLE public.producto_area (
    producto_id uuid NOT NULL,
    area_id integer NOT NULL,
    stock_maximo numeric(12,2),      -- nullable, sin CHECK
    punto_reorden numeric(12,2)      -- nullable, sin CHECK
);
```

### Cómo afecta al sistema

**Escenario 1: Valores negativos.** Se puede configurar `stock_maximo = -100` o `punto_reorden = -50`. El sistema de alertas de stock probablemente compara `stock_actual < punto_reorden`, lo que causaría alertas falsas o silenciadas.

**Escenario 2: Inversión de lógica.** Se puede configurar `punto_reorden = 1000` y `stock_maximo = 10`. El sistema de alertas dispararía constantemente porque `stock_actual` nunca supera el `punto_reorden` pero siempre está "por debajo del máximo".

**Escenario 3: Sin validación en el frontend.** El componente de configuración de áreas en el frontend no valida rangos antes de enviar. El backend tampoco valida — los valores pasan directo a SQL.

### Cómo debería ser

```sql
ALTER TABLE producto_area
    ADD CONSTRAINT chk_stock_maximo_nonneg
        CHECK (stock_maximo IS NULL OR stock_maximo >= 0),
    ADD CONSTRAINT chk_punto_reorden_nonneg
        CHECK (punto_reorden IS NULL OR punto_reorden >= 0),
    ADD CONSTRAINT chk_reorden_lte_max
        CHECK (punto_reorden IS NULL OR stock_maximo IS NULL OR punto_reorden <= stock_maximo);
```

Y agregar validación en la capa de servicio antes del INSERT/UPDATE.

---

## 10. `stock_minimo_global`: sin CHECK no-negativo

### Qué es

```sql
-- 001_initial_schema.sql línea 1050:
stock_minimo_global numeric(12,4) DEFAULT 0 NOT NULL,
```

Sin CHECK constraint. Un bug en el frontend (`-50` en un input) o un error humano pasa directo a la BD.

### Cómo afecta al sistema

`stock_minimo_global` se usa para alertas de reposición. Si es negativo, la lógica de "stock por debajo del mínimo" nunca se activa (porque todo stock positivo supera un mínimo negativo), silenciando alertas críticas.

### Cómo debería ser

```sql
ALTER TABLE productos
    ADD CONSTRAINT chk_stock_minimo_global_nonneg
        CHECK (stock_minimo_global >= 0);
```

---

## 11. `nombre`: sin UNIQUE — duplicados silenciosos

### Qué es

```sql
-- 001_initial_schema.sql línea 1025:
nombre character varying(300) NOT NULL,
```

Sin UNIQUE constraint. Sin índice único. Dos productos pueden llamarse exactamente igual.

### Cómo afecta al sistema

**Escenario clínico:** Dos productos "Hemograma Completo" con diferentes `codigo_interno`. El usuario busca "Hemograma" y obtiene dos resultados idénticos sin distinción clara. En un contexto de consumo o recepción, seleccionar el producto equivocado causa errores de trazabilidad.

**El frontend muestra `nombre` como el identificador principal** en listas, búsquedas, y tarjetas. Sin distinción visual entre dos productos con el mismo nombre, el usuario no puede saber cuál es cuál.

### Cómo debería ser

Evaluar si se requiere unicidad:
- **Si `codigo_interno` es el identificador único real** → documentar que `nombre` es solo descriptivo y puede duplicarse.
- **Si se requiere unicidad semántica** → `CREATE UNIQUE INDEX idx_productos_nombre_unique ON productos (nombre) WHERE deleted_at IS NULL`.

En cualquier caso, agregar un comentario de BD (`COMMENT ON COLUMN productos.nombre`) que documente la decisión.

---

## 12. `codigo_interno`: unique parcial sin considerar `activo`

### Qué es

```sql
-- 001_initial_schema.sql línea 2455:
CREATE UNIQUE INDEX idx_productos_codigo_interno_active
    ON public.productos USING btree (codigo_interno)
    WHERE (deleted_at IS NULL);
```

### Cómo afecta al sistema

El unique parcial previene duplicados entre productos no-borrados. Pero permite que un producto **activo** y uno **inactivo** (ambos sin `deleted_at`) compartan el mismo `codigo_interno`.

**Escenario:**
1. Producto A con `codigo_interno = "LAB-001"`, `activo = true`, `deleted_at = NULL`.
2. Se desactiva A: `activo = false`, `deleted_at = NULL`.
3. Se crea Producto B con `codigo_interno = "LAB-001"`: ✅ permitido (el unique no distingue activos).
4. Ahora hay dos productos con el mismo código — uno activo y uno inactivo.

**Impacto:** En scanning de código de barras o búsqueda por código, el sistema podría retornar ambos productos o el incorrecto.

### Cómo debería ser

Si la intención es permitir reactivar un producto con su código original:
- El diseño actual es correcto pero debe documentarse.
- Agregar lógica en el backend que, al crear un producto con un `codigo_interno` que ya existe en un inactivo, sugiera reactivar el existente.

Si la intención es que el código sea único globalmente entre activos:
- Cambiar el WHERE: `WHERE deleted_at IS NULL AND activo = true`.

---

## 13. `codigo_loinc_cpt`: campo híbrido sin normalización

### Qué es

```sql
-- 001_initial_schema.sql línea 1051:
codigo_loinc_cpt character varying(100),
```

Un solo campo para códigos LOINC **y/o** CPT. Sin tipo, sin múltiples valores, sin formato definido.

### Cómo afecta al sistema

**No se puede hacer:**
- "¿Cuántos productos tienen código LOINC?" (no hay distinción de tipo).
- "¿Cuáles productos tienen código CPT 99213?" (no se puede filtrar por tipo).
- Un producto con 2 códigos LOINC y 1 CPT (solo cabe 1 string de 100 chars).

**El importador CSV** lo trata como un solo campo con aliases `["loinc", "cpt", "codigo loinc cpt"]` (`product_contract.rs:170-178`). No hay forma de importar múltiples códigos.

**El frontend** lo muestra como un solo campo de texto (`ProductoListItem.codigo_loinc_cpt`).

### Cómo debería ser

```sql
CREATE TABLE producto_codigos_medicos (
    id SERIAL PRIMARY KEY,
    producto_id UUID NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
    tipo TEXT NOT NULL CHECK (tipo IN ('loinc', 'cpt')),
    codigo VARCHAR(20) NOT NULL,
    UNIQUE (producto_id, tipo, codigo)
);
```

Esto permite múltiples códigos por tipo, validación de formato por tipo, y queries eficientes por tipo.

---

## 14. `control_lote`: downgrade sin protección

### Qué es

`control_lote` define el nivel de trazabilidad: `simple` (sin vencimiento) → `con_vto` (con vencimiento) → `trazable` (lote + vencimiento + escaneo obligatorio).

El DTO `ActualizarProducto` lo recibe como `Option<ControlLote>`, permitiendo cambiarlo libremente.

### Cómo afecta al sistema

**Escenario peligroso:**
1. Producto con `control_lote = 'trazable'` tiene 50 lotes escaneados con trazabilidad completa.
2. Un admin cambia `control_lote` a `'simple'`.
3. Ahora el producto no requiere trazabilidad, pero los 50 lotes existentes siguen teniendo datos de trazabilidad.
4. El sistema de consumo (`consumo_service.rs:106`) ya no valida `lote_id` porque `control_lote != "trazable"`.
5. Se pierde la trazabilidad de lotes existentes sin aviso.

**El backend NO valida esta transición.** El `producto_service.rs:577` simplemente actualiza el valor con un COALESCE:

```sql
control_lote = COALESCE($X, control_lote)
```

### Cómo debería ser

En la capa de servicio, antes de permitir el cambio:
```rust
if nuevo_control_lote < control_lote_actual {
    // Verificar que no existan lotes con trazabilidad activa
    let lotes_trazables = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM lotes WHERE producto_id = $1 AND deleted_at IS NULL",
        params.id
    ).fetch_one(pool).await?;
    
    if lotes_trazables > 0 {
        return Err(AppError::Validation(
            "No se puede reducir la trazabilidad: existen lotes activos con trazabilidad".into()
        ));
    }
}
```

---

## 15. `created_by` / `updated_by`: audit_log existe pero payloads mínimos

### Qué es

La tabla `audit_log` existe y captura quién hizo cada cambio:

```sql
-- 001_initial_schema.sql líneas 521-531:
CREATE TABLE public.audit_log (
    id BIGSERIAL PRIMARY KEY,
    tabla VARCHAR(50) NOT NULL,
    registro_id VARCHAR(50) NOT NULL,
    accion VARCHAR(10) NOT NULL,        -- CREATE/UPDATE/DELETE
    datos_anteriores JSONB,
    datos_nuevos JSONB,
    usuario_id UUID NOT NULL REFERENCES usuarios(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Cómo afecta al sistema

**El audit_log SÍ captura quién (`usuario_id`), pero los payloads JSON son mínimos:**

| Operación | datos_anteriores | datos_nuevos |
|---|---|---|
| CREATE (`producto_service.rs:396`) | — | `{"codigo_interno", "nombre"}` (2 campos) |
| UPDATE (`producto_service.rs:604`) | `{"nombre", "version"}` | `{"nombre", "version"}` (2 campos) |
| DELETE (`producto_service.rs:651`) | — | — (sin datos) |
| REACTIVATE (`producto_service.rs:676`) | — | — (sin datos) |

**Impacto:** En un dominio regulatorio/clínico, si un auditor pregunta "¿quién cambió `control_lote` de `trazable` a `simple` y cuándo?", el audit_log no lo respuesta — solo guardó `nombre` y `version`, no `control_lote`.

### Cómo debería ser

Opción A: Expandir los payloads del audit_log para incluir TODOS los campos relevantes (o al menos los campos de trazabilidad: `control_lote`, `estado_catalogo`, `clase_riesgo`).

Opción B: Agregar `created_by uuid` y `updated_by uuid` directamente en la tabla `productos` para acceso rápido sin JOIN al audit_log. Esto es más eficiente pero duplica datos.

Opción C (recomendada): Combinar ambas — `updated_by` en `productos` para acceso rápido + audit_log expandido para trazabilidad completa.

---

## 16. `es_kit`: flag sin soporte relacional

### Qué es

```sql
-- 001_initial_schema.sql línea 1049:
es_kit boolean DEFAULT false NOT NULL,
```

### Cómo afecta al sistema

**El flag existe pero no tiene NINGUNA lógica asociada:**
- No hay tabla `kit_componentes` o `kit_items`.
- No hay lógica que, al consumir un kit, descuente stock de componentes.
- No hay lógica que, al recepcionar componentes, actualice el stock del kit.
- No hay validación de que un kit tenga al menos un componente.

**El flag se puede setear en:**
- Creación de producto (`producto_service.rs:348`)
- Actualización (`producto_service.rs:574`)
- Importación CSV (`product_contract.rs:234-241`)
- API regulatoria (`api_regulatoria_service.rs`)

Pero hacerlo no tiene efecto alguno en el negocio.

### Cómo debería ser

Tres opciones:
1. **Funcionalidad futura:** Documentar como "pending feature" en la BD (`COMMENT ON COLUMN productos.es_kit`) y no permitir setearlo hasta que la tabla de componentes exista.
2. **No se usa:** Eliminar el campo para evitar confusión.
3. **Se va a usar:** Crear la tabla `kit_componentes` con la lógica de negocio correspondiente.

---

## 17. `lotes`: ON DELETE NO ACTION — hard delete bloqueado

### Qué es

```sql
-- 001_initial_schema.sql línea 2847:
ADD CONSTRAINT lotes_producto_id_fkey
    FOREIGN KEY (producto_id) REFERENCES public.productos(id);
-- Sin ON DELETE → default NO ACTION
```

### Cómo afecta al sistema

**ON DELETE NO ACTION** significa que si alguien intenta hacer `DELETE FROM productos WHERE id = X` y ese producto tiene lotes, PostgreSQL rechaza la operación con:
```
ERROR: update or delete on table "productos" violates foreign key constraint "lotes_producto_id_fkey"
```

**En la práctica, esto es correcto** — los lotes son datos de trazabilidad clínica que no deben perderse. El soft delete (`deleted_at`) es la forma correcta de "borrar" un producto.

**Sin embargo, hay un hard delete en producción:**
```sql
-- import_batches.rs línea 446:
DELETE FROM productos p
WHERE p.origen_registro='importacion_csv'
  AND p.id IN (SELECT (outcome->>'product_id')::uuid FROM import_rows WHERE batch_id=$1)
```

Este DELETE está protegido por una verificación previa (líneas 436-442) que bloquea si existen lotes. Pero si la verificación tiene un bug, el DELETE fallaría con un error crudo de FK.

**Las tablas CON CASCADE destruyen datos silenciosamente:**
- `presentaciones` → CASCADE
- `producto_area` → CASCADE
- `producto_codigos_barras` → CASCADE
- `producto_precio_historial` → CASCADE
- `par_level_config` → CASCADE
- `stock_snapshot` → CASCADE

Un hard delete exitoso destruiría todo ese historial.

### Cómo debería ser

Documentar explícitamente la política:
- "El soft delete es la ÚNICA forma de eliminar un producto. El hard delete está prohibido excepto para rollback de importaciones CSV dentro de una transacción protegida."
- Agregar un test que verifique que el hard delete falla cuando existen lotes.
- Evaluar si `ON DELETE RESTRICT` (explícito) es más claro que `NO ACTION` (default).

---

## 18. `presentaciones`: sin UNIQUE compuesto

### Qué es

```sql
-- 001_initial_schema.sql líneas 894-911:
CREATE TABLE public.presentaciones (
    id integer NOT NULL,
    producto_id uuid NOT NULL,
    nombre character varying(100) NOT NULL,
    ...
);
-- Sin UNIQUE (producto_id, nombre)
```

**Únicos existentes:**
- `idx_presentaciones_gtin` — UNIQUE global en `gtin` WHERE NOT NULL
- `idx_presentaciones_gtin_active` — UNIQUE en `gtin` WHERE activo + not deleted
- `idx_presentaciones_sku_active` — UNIQUE en `sku` WHERE not deleted + not null

**Ninguno es compuesto con `producto_id`.**

### Cómo afecta al sistema

Un producto puede tener dos presentaciones llamadas "Caja" o "Kit". El backend (`presentacion_service.rs:45-113`) NO valida duplicados — el INSERT pasa directo.

**Impacto:**
- En scanning, dos presentaciones con el mismo nombre causan ambigüedad.
- En órdenes de compra, el usuario no sabe cuál "Caja" seleccionar.
- En el frontend, las presentaciones se listan por nombre — dos iguales son indistinguibles.

### Cómo debería ser

```sql
CREATE UNIQUE INDEX idx_presentaciones_producto_nombre
    ON presentaciones (producto_id, nombre)
    WHERE deleted_at IS NULL;
```

Y agregar validación en `presentacion_service.rs` que maneje el error de duplicado con un mensaje amigable.

---

## 19. `producto_codigos_barras`: sin validación de formato

### Qué es

```sql
-- 001_initial_schema.sql líneas 950-956:
CREATE TABLE public.producto_codigos_barras (
    id integer NOT NULL,
    producto_id uuid NOT NULL,
    codigo text NOT NULL,           -- sin CHECK de formato
    activo boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);
```

### Cómo afecta al sistema

El campo `codigo` acepta cualquier string no vacío. Se pueden insertar códigos malformados:
- `"abc123"` (mezcla de letras y números donde se espera dígitos)
- `""` (string vacío — aunque el backend valida esto)
- `"12345678901234567890"` (más de 13 dígitos para EAN-13)

**El frontend valida EAN-13** (`productos-tab.tsx:124` — `isValidEan13`), pero el backend y la BD no. Un INSERT directo o vía API puede bypassear la validación del frontend.

### Cómo debería ser

```sql
ALTER TABLE producto_codigos_barras
    ADD CONSTRAINT chk_codigo_barras_nonempty
        CHECK (LENGTH(TRIM(codigo)) > 0),
    ADD CONSTRAINT chk_codigo_barras_digits
        CHECK (codigo ~ '^[0-9]+$');  -- solo dígitos
```

Y agregar validación en el servicio para verificar longitud según el tipo de código (EAN-13 = 13 dígitos, Code128 = variable).

---

## 20. `promedio_uso_mensual`: dualidad sin documentación

### Qué es

```sql
-- 001_initial_schema.sql líneas 1052-1053:
promedio_uso_mensual numeric(12,4) DEFAULT 0.0000 NOT NULL,
promedio_uso_mensual_inicial numeric(12,4) DEFAULT 0.0000 NOT NULL,
```

### Cómo afecta al sistema

**No hay documentación** de la diferencia entre ambos campos. Por el código:

- `promedio_uso_mensual_inicial` → valor semilla que el usuario ingresa al crear el producto.
- `promedio_uso_mensual` → valor recalculado periódicamente por `promedio_job.rs`.

**Problema:** Si el job no corre (servicio caído, error de cron), `promedio_uso_mensual` queda en 0. No hay forma de saber si es "cero real" (el producto no se usa) o "cero porque no corrió el job".

**El `promedio_uso_mensual` se usa para:**
- Cálculo de días de autonomía de stock.
- Alertas de reposición.
- Dashboards de consumo.

Si está en 0 por un job fallido, todas las métricas derivadas son incorrectas.

### Cómo debería ser

1. Agregar `COMMENT ON COLUMN` en la BD documentando la diferencia.
2. Evaluar si `promedio_uso_mensual_inicial` debería renombrarse a `promedio_uso_configurado` o `promedio_uso_seed`.
3. Agregar un CHECK: `CHECK (promedio_uso_mensual >= 0 AND promedio_uso_mensual_inicial >= 0)`.
4. El job debería registrar su último exitoso run para que el sistema pueda detectar si el dato está stale.

---

## Resumen Priorizado (v2 Corregida)

| # | Severidad | Deficiencia | Estado v1 |
|---|---|---|---|
| 1 | 🔴 **BUG** | `imagen_path` alias en 2 queries → NULL silencioso | Era "baja", ahora es BUG activo |
| 3 | 🔴 Alta | `estado_catalogo`: Rust enum solo cubre 2 de 4 valores | Era "CHECK strings" genérico |
| 4 | 🔴 Alta | `clase_riesgo`: sin Rust enum, smart importer viola CHECK | Era "CHECK strings" genérico |
| 5 | 🔴 Alta | `temperatura_almacenamiento`: mismo problema que 4 | Era "CHECK strings" genérico |
| 15 | 🔴 Alta | `audit_log`: payloads mínimos — solo nombre+version | Corregido: audit_log SÍ existe |
| 9 | 🟡 Media | `stock_maximo`/`punto_reorden`: sin CHECK de rangos | Sin cambios |
| 10 | 🟡 Media | `stock_minimo_global`: sin CHECK no-negativo | Sin cambios |
| 11 | 🟡 Media | `nombre`: sin UNIQUE — duplicados silenciosos | Sin cambios |
| 12 | 🟡 Media | `codigo_interno`: unique sin considerar `activo` | Sin cambios |
| 13 | 🟡 Media | `codigo_loinc_cpt`: híbrido sin normalización | Sin cambios |
| 14 | 🟡 Media | `control_lote`: downgrade sin protección | Sin cambios |
| 18 | 🟡 Media | `presentaciones`: sin UNIQUE compuesto | Sin cambios |
| 8 | 🟡 Media | `producto_area`: INSERT sin ON CONFLICT (PK existe) | **Corregido: PK SÍ existe** |
| 6 | 🟡 Media | `updated_at`: redundancia + inconsistencia cross-table | **Corregido: trigger SÍ existe** |
| 17 | 🟡 Media | `lotes`: NO ACTION — hard delete bloqueado pero protegido | Sin cambios |
| 19 | 🟢 Baja | `producto_codigos_barras`: sin validación formato | Sin cambios |
| 20 | 🟢 Baja | `promedio_uso_mensual`: dualidad sin documentación | Sin cambios |
| 16 | 🟢 Baja | `es_kit`: flag sin soporte relacional | Sin cambios |
| ~~7~~ | ~~Corregido~~ | ~~search_vector sin trigger~~ | **Corregido: trigger SÍ existe** |
| ~~17~~ | ~~Corregido~~ | ~~producto_area sin PK~~ | **Corregido: PK SÍ existe** |

### Hallazgos Corregidos de v1

| v1 # | v1 Decisión | Realidad Verificada |
|---|---|---|
| 1 | "Sin trigger updated_at" | **EXISTE** en `001_initial_schema.sql:2777` |
| 13 | "Sin trigger search_vector" | **EXISTE** en `001_initial_schema.sql:2770` |
| 17 | "producto_area sin PK" | **EXISTE** PRIMARY KEY en `001_initial_schema.sql:1937` |
