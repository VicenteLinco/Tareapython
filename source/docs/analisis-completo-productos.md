# Análisis Completo — Diseño de BD de Productos

> **Fecha**: 2026-07-23
> **Alcance**: Análisis exhaustivo del diseño de la base de datos de productos, incluyendo documentación del esquema, análisis de 20 deficiencias, y benchmark contra ISO 15189:2022 y LIMS modernos.
> **Fuentes**: ISO 15189:2022 §6.6 (Reagents & Consumables), schema LIMS de referencia (32 tablas), Siemens BIMS, LabStockManager (thesis ULiege 2025), Cleverence/Labs practices, Benchling/CloudLIMS/LabWare patterns.

---

# PARTE I — Documentación del Esquema

## Tabla Principal: `productos`

| Columna | Tipo | Constraints |
|---|---|---|
| `id` | `uuid` | PK, `gen_random_uuid()` |
| `codigo_interno` | `varchar(20)` | NOT NULL |
| `nombre` | `varchar(300)` | NOT NULL |
| `descripcion` | `text` | |
| `categoria_id` | `integer` | FK → `categorias` |
| `unidad_base_id` | `integer` | FK → `unidades_basicas` |
| `activo` | `boolean` | DEFAULT `true` |
| `version` | `integer` | DEFAULT `1` (optimistic locking) |
| `created_at` | `timestamptz` | DEFAULT `now()` |
| `updated_at` | `timestamptz` | DEFAULT `now()` |
| `imagen_path` | `text` | Legacy, reemplazado por imagen_url |
| `imagen_url` | `text` | URL de imagen del producto |
| `deleted_at` | `timestamptz` | Soft delete |
| `ubicacion` | `varchar(200)` | Ej: "Estante B3" |
| `lead_time_propio` | `integer` | Días de reposición propios |
| `control_lote` | `text` | CHECK: `trazable` / `con_vto` / `simple` |
| `estado_catalogo` | `text` | CHECK: `incompleto` / `pendiente_aprobacion` / `aprobado` / `rechazado` |
| `origen_registro` | `text` | CHECK: `manual` / `api_regulatoria` / `guia_pdf` / `importacion_csv` |
| `temperatura_almacenamiento` | `varchar(30)` | CHECK: `ambiente` / `refrigerado` / `congelado` / `ultra_frio` / `no_aplica` |
| `requiere_cadena_frio` | `boolean` | DEFAULT `false` |
| `dias_estabilidad_abierto` | `integer` | Días de vida útil una vez abierto |
| `clase_riesgo` | `varchar(20)` | CHECK: `biologico` / `quimico` / `radiactivo` / `inflamable` / `corrosivo` / `ninguno` |
| `fabricante` | `varchar(300)` | |
| `mpn` | `varchar(100)` | Manufacturer Part Number |
| `alias_unidad_clinica` | `varchar(50)` | Alias para contexto clínico |
| `es_kit` | `boolean` | DEFAULT `false` |
| `stock_minimo_global` | `numeric(12,4)` | DEFAULT `0` |
| `codigo_loinc_cpt` | `varchar(100)` | Códigos LOINC/CPT médicos |
| `promedio_uso_mensual` | `numeric(12,4)` | DEFAULT `0` |
| `promedio_uso_mensual_inicial` | `numeric(12,4)` | DEFAULT `0` |
| `motivo_rechazo` | `text` | Razón de rechazo en cuarentena |
| `search_vector` | `tsvector` | Full-text search (PostgreSQL) |

### Índices conocidos

- `search_vector` → GIN (full-text search)

### Constraints CHECK

- `chk_productos_estado_catalogo`: `estado_catalogo IN ('incompleto', 'pendiente_aprobacion', 'aprobado', 'rechazado')`
- `chk_productos_origen_registro`: `origen_registro IN ('manual', 'api_regulatoria', 'guia_pdf', 'importacion_csv')`
- `productos_clase_riesgo_check`: `clase_riesgo IN ('biologico', 'quimico', 'radiactivo', 'inflamable', 'corrosivo', 'ninguno')`
- `productos_control_lote_check`: `control_lote IN ('trazable', 'con_vto', 'simple')`
- `productos_temperatura_almacenamiento_check`: `temperatura_almacenamiento IN ('ambiente', 'refrigerado', 'congelado', 'ultra_frio', 'no_aplica')`

---

## Tablas Relacionadas

### `presentaciones` (1:N con productos)

| Columna | Tipo | Constraints |
|---|---|---|
| `id` | `integer` | PK (serial) |
| `producto_id` | `uuid` | FK → `productos` |
| `nombre` | `varchar(100)` | NOT NULL |
| `nombre_plural` | `varchar(100)` | NOT NULL |
| `factor_conversion` | `numeric(12,6)` | NOT NULL, CHECK > 0 |
| `codigo_barras` | `varchar(100)` | |
| `gtin` | `varchar(14)` | |
| `gs1_habilitado` | `boolean` | DEFAULT `false` |
| `sku` | `varchar(100)` | |
| `formato_id` | `integer` | FK → `presentacion_formatos` |
| `activa` | `boolean` | DEFAULT `true` |
| `version` | `integer` | DEFAULT `1` |
| `created_at` | `timestamptz` | DEFAULT `now()` |
| `deleted_at` | `timestamptz` | |

### `producto_area` (N:M — stock por área)

| Columna | Tipo | Constraints |
|---|---|---|
| `producto_id` | `uuid` | FK → `productos`, PK compuesto |
| `area_id` | `integer` | FK → `areas`, PK compuesto |
| `stock_maximo` | `numeric(12,2)` | |
| `punto_reorden` | `numeric(12,2)` | |

### `producto_codigos_barras` (N:M — códigos alternativos)

| Columna | Tipo | Constraints |
|---|---|---|
| `id` | `integer` | PK (serial) |
| `producto_id` | `uuid` | FK → `productos` |
| `codigo` | `text` | NOT NULL |
| `activo` | `boolean` | DEFAULT `true` |
| `created_at` | `timestamptz` | DEFAULT `now()` |

### `lab_campo_producto_valor` (campos custom laboratorio)

| Columna | Tipo | Constraints |
|---|---|---|
| `id` | `uuid` | PK, `gen_random_uuid()` |
| `producto_id` | `uuid` | FK → `productos` ON DELETE CASCADE |
| `definicion_id` | `uuid` | FK → `lab_campo_definicion` ON DELETE CASCADE |
| `valor_entero` | `integer` | |
| `valor_booleano` | `boolean` | |
| `valor_fecha` | `date` | |
| `valor_texto` | `text` | |
| `created_at` | `timestamptz` | DEFAULT `now()` |
| `updated_at` | `timestamptz` | DEFAULT `now()` |
| UNIQUE | `(producto_id, definicion_id)` | |

---

## Diagrama de Relaciones

```
productos (uuid PK)
├── presentaciones (1:N)           — unidades de venta/empaque
├── producto_area (N:M)            — stock y reorden por área
├── producto_codigos_barras (N:M)  — códigos de barras alternativos
├── lab_campo_producto_valor (N:M) — campos custom laboratorio
├── lotes (1:N)                    — trazabilidad por lote
├── producto_precio_historial      — historial de precios por proveedor
├── categorias (N:1)               — clasificación del producto
└── unidades_basicas (N:1)         — unidad base de medida
```

---

# PARTE II — Análisis de 20 Deficiencias

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

**Problema 2: Sin enum Rust para `clase_riesgo` y `temperatura_almacenamiento`.** El backend recibe estos campos como `Option<String>` — no valida nada antes de hacer INSERT. Si el smart importer de CSV envía `"2-8 C"` para temperatura o `"Class IIa"` para clase_riesgo, el error ocurre en la BD con un `CHECK constraint violation` crudo, no en la capa de aplicación con un mensaje util.

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

**Funciona correctamente.** No hay deficiencia funcional. El único punto de mejora es que el GIN index no tiene `WHERE deleted_at IS NULL`, lo que significa que productos soft-deleteados siguen indexados (desperdicia espacio mínimo, pero no afecta resultados porque el backend filtra por `activo = true`).

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

---

# PARTE III — Benchmark vs ISO 15189:2022 y LIMS Modernos

## 1. Qué exige ISO 15189:2022 §6.6 para inventario de reactivos

ISO 15189:2022 es el estándar internacional para laboratorios de análisis clínicos. La sección **6.6 (Reagents and Consumables)** establece requisitos explícitos:

| Requisito ISO 15189 §6.6 | Descripción | Tu BD lo cumple? |
|---|---|---|
| **§6.6.1 General** | El laboratorio debe usar reactivos según especificaciones del fabricante | Parcial — `fabricante` existe pero sin instrucciones de uso |
| **§6.6.2 Receipt & Storage** | Registrar fecha de recepción, condiciones, lote, fecha de vencimiento | Parcial — lotes tienen vencimiento pero no fecha de recepción explícita |
| **§6.6.3 Acceptance Testing** | Segregar reactivos no aceptados de los aceptados | Parcial — `estado_catalogo` simula esto, pero no es el flujo estándar |
| **§6.6.4 Inventory Management** | Sistema de inventario que separe aceptados de no aceptados | Parcial — `estado_catalogo` maneja cuarentena |
| **§6.6.5 Instructions for Use** | Instrucciones de uso disponibles | ❌ No existe en BD |
| **§6.6.6 Adverse Incident Reporting** | Reporte de incidentes adversos | ❌ No existe en BD |
| **§6.6.7 Records** | Registros de recepción, almacenamiento, uso, disposición | ❌ No hay tabla de movimientos de inventario por producto |

**Gap crítico:** ISO 15189 §6.6.4 requiere que el sistema de inventario **separe explícitamente** reactivos aceptados de los no aceptados. Tu `estado_catalogo` hace esto a nivel de producto, pero el estándar lo espera a nivel de **lote** (cada lote puede estar en cuarentena independientemente del producto).

## 2. Arquitectura de un LIMS moderno: patrones de entidad

Los LIMS modernos (Benchling, LabWare, CloudLIMS, Siemens BIMS) usan un patrón de 4 capas:

```
┌─────────────────────────────────────────────────┐
│  CAPA 1: CATÁLOGO MAESTRO (Master Data)         │
│  → Qué existe en el catálogo (producto/recurso)  │
│  → Definición estática, no cambia con el tiempo   │
├─────────────────────────────────────────────────┤
│  CAPA 2: LOTES/INVENTARIO (Batch/Lot Tracking)   │
│  → Qué llegó al laboratorio (lote específico)     │
│  → Vencimiento, cantidad, estado, proveedor       │
├─────────────────────────────────────────────────┤
│  CAPA 3: UBICACIÓN/STOCK (Location & Stock)      │
│  → Dónde está físicamente cada lote               │
│  → Cantidad por ubicación, condiciones            │
├─────────────────────────────────────────────────┤
│  CAPA 4: MOVIMIENTOS (Transactions)              │
│  → Qué pasó con cada lote: recepción, uso,        │
│    descarte, transferencia, ajuste                 │
│  → Auditoría completa: quién, cuándo, dónde       │
└─────────────────────────────────────────────────┘
```

**Tu BD cubre capas 1 y 2 parcialmente. Las capas 3 y 4 están incompletas.**

## 3. El modelo "Items → Lots → Stock → Location"

El patrón estándar de la industria es:

```
ITEM (definición catálogo)
  ├── LOT (lote específico con vencimiento)
  │     ├── STOCK_PER_LOCATION (cantidad por ubicación)
  │     └── MOVEMENTS (transacciones: recepción, uso, descarte)
  ├── PRESENTATION (unidades de empaque)
  └── BARCODE (códigos de barras)
```

En tu BD actual:

```
PRODUCTO (mezcla catálogo + inventario)
  ├── LOTE (parcial — sin ubicación por lote)
  ├── PRESENTACIÓN (unidades de empaque)
  ├── PRODUCTO_AREA (stock por área, no por lote)
  └── PRODUCTO_CODIGOS_BARRAS (códigos alternativos)
```

**El problema fundamental:** Tu `productos` mezcla la definición del catálogo con propiedades de inventario (stock, estado de cuarentena, origen). En un LIMS moderno, estas son capas separadas.

---

## 4. Entidad `productos`: análisis detallado campo por campo

### 4.1 Campos de identidad y nombre

| Campo | Tipo | Estándar LIMS | Evaluación | Mejora |
|---|---|---|---|---|
| `id` | `uuid` PK | ID único universal | ✅ Excelente — UUID es correcto para sistemas distribuidos | Sin cambio |
| `codigo_interno` | `varchar(20)` NOT NULL | Catálogo number / Item code | ✅ Correcto — es el ID legible humano | Sin cambio |
| `nombre` | `varchar(300)` NOT NULL | Item name | ⚠️ Sin UNIQUE — en LIMS modernos, nombre+fabricante debería ser único | Agregar UNIQUE parcial |
| `descripcion` | `text` | Description | ✅ Correcto | Sin cambio |

**Comparación con Benchling:** Benchling usa `name` (string) + `external_id` + `registry_id`. Tu `codigo_interno` equivale a `external_id`. Falta un `registry_id` o `catalog_number` global.

**Comparación con Siemens BIMS:** BIMS carga datos desde GS1 barcode → el `nombre` viene del fabricante. Tu `nombre` es editado manualmente, lo cual es correcto para un catálogo propio.

### 4.2 Campos de clasificación

| Campo | Tipo | Estándar LIMS | Evaluación | Mejora |
|---|---|---|---|---|
| `categoria_id` | `integer` FK | Department/category | ✅ Correcto | Sin cambio |
| `unidad_base_id` | `integer` FK | Base unit of measure | ✅ Correcto | Sin cambio |
| `clase_riesgo` | `varchar(20)` CHECK | Hazard classification | ⚠️ Sin enum Rust, CHECK vulnerable | Ver análisis v2 |
| `es_kit` | `boolean` | Kit/BOM flag | ⚠️ Sin tabla de componentes | Ver §4.7 |

**Comparación con ISO 15189:** ISO requiere clasificación de riesgo para almacenamiento. Tu `clase_riesgo` cubre esto, pero el CHECK tiene valores que no coinciden con la taxonomía estándar (ISO usa `biological`, `chemical`, `radioactive`, etc. — tus valores son correctos pero el mapeo con API regulatoria falla).

### 4.3 Campos de trazabilidad clínica

| Campo | Tipo | Estándar LIMS | Evaluación | Mejora |
|---|---|---|---|---|
| `control_lote` | `text` CHECK | Lot tracking mode | ✅ Buena idea —三级粒度 (simple/con_vto/trazable) | Sin cambio funcional, agregar protección de downgrade |
| `mpn` | `varchar(100)` | Manufacturer Part Number | ✅ Correcto — equivale a catalog_number | Sin cambio |
| `fabricante` | `varchar(300)` | Manufacturer/supplier | ⚠️ Debería ser FK a `proveedores` o tabla dedicada | Evaluar normalización |
| `codigo_loinc_cpt` | `varchar(100)` | Medical codes | ⚠️ Híbrido LOINC+CPT sin normalización | Ver análisis v2 §13 |
| `alias_unidad_clinica` | `varchar(50)` | Clinical alias | ✅ Útil para contexto clínico | Sin cambio |

**Comparación con LabWare:** LabWare separa `manufacturer` (catálogo del fabricante) de `supplier` (proveedor que entrega). Tu `fabricante` es el fabricante; `proveedores` es el proveedor. La distinción es correcta pero `fabricante` debería ser FK a una tabla `fabricantes` si hay múltiples fabricantes por producto.

### 4.4 Campos de almacenamiento

| Campo | Tipo | Estándar LIMS | Evaluación | Mejora |
|---|---|---|---|---|
| `ubicacion` | `varchar(200)` | Storage location | ❌ **String — debería ser FK a tabla de ubicaciones jerárquicas** | Ver §10 |
| `temperatura_almacenamiento` | `varchar(30)` CHECK | Storage temperature | ⚠️ Sin enum Rust, sin FK a estándar de temperatura | Crear ENUM |
| `requiere_cadena_frio` | `boolean` | Cold chain required | ✅ Correcto | Sin cambio |
| `dias_estabilidad_abierto` | `integer` | Open-vial stability (days) | ✅ Excelente — cubre ISO §6.6.5 parcialmente | Sin cambio, pero faltan campos complementarios |

**Comparación con ISO 15189 §6.6.2:** ISO requiere que cada reactivo tenga instrucciones de almacenamiento documentadas. Tu `ubicacion` es un string libre — en un LIMS moderno, esto es una FK jerárquica:

```
ubicaciones:
  id | padre_id | codigo | nombre | tipo | temperatura_tipo | capacidad
  1  | NULL     | BLD-A  | Edificio A | edificio | — | —
  2  | 1        | RM-101 | Sala 101 | sala | ambiente | —
  3  | 2        | CAB-B3 | Gabinete B3 | gabinete | refrigerado | 50
  4  | 3        | EST-2  | Estante 2 | estante | — | 10
```

**Comparación con Benchling:** Benchling usa `storage` con jerarquía `facility > building > room > freezer > shelf > box > position`. Tu `ubicacion` como string no permite navegación jerárquica ni auditoría de capacidad.

### 4.5 Campos de catálogo y cuarentena

| Campo | Tipo | Estándar LIMS | Evaluación | Mejora |
|---|---|---|---|---|
| `estado_catalogo` | `text` CHECK | Approval status | ⚠️ Enum Rust incompleto (faltan `incompleto`, `rechazado`) | Completar enum |
| `origen_registro` | `text` CHECK | Source/origin | ✅ Correcto — cubre API regulatoria, PDF, CSV, manual | Sin cambio |
| `motivo_rechazo` | `text` | Rejection reason | ✅ Correcto | Sin cambio |

**Comparación con ISO 15189 §6.6.3-4:** ISO requiere un flujo: `Recibido → En cuarentena → Probado → Aceptado/Rechazado`. Tu `estado_catalogo` modela esto, pero el flujo está a nivel de **producto**, no de **lote**. En un LIMS estándar, cada **lote** tiene su propio estado de cuarentena.

**Ejemplo Siemens BIMS:** "A single batch of reagent can be moved to quarantine on delivery and may not be issued for use until released." — Esto es a nivel de lote, no de producto.

### 4.6 Campos de inventario y predicción

| Campo | Tipo | Estándar LIMS | Evaluación | Mejora |
|---|---|---|---|---|
| `stock_minimo_global` | `numeric(12,4)` | Min stock threshold | ✅ Correcto — pero sin CHECK no-negativo | Agregar CHECK |
| `promedio_uso_mensual` | `numeric(12,4)` | Average monthly consumption | ⚠️ Dualidad sin documentación con `_inicial` | Documentar, agregar CHECK |
| `promedio_uso_mensual_inicial` | `numeric(12,4)` | Seed/initial consumption | ⚠️ Sin documentación | Renombrar, documentar |

**Comparación con CloudLIMS:** CloudLIMS tiene `reorder_level`, `reorder_quantity`, `par_level` por ubicación. Tu `stock_minimo_global` es un umbral global — en un LIMS estándar, el mínimo es **por ubicación/área**, no global.

### 4.7 `es_kit`: flag sin soporte

En LIMS modernos (Benchling, LabWare), los kits se modelan como:

```sql
CREATE TABLE kit_components (
    kit_producto_id UUID REFERENCES productos(id),
    componente_producto_id UUID REFERENCES productos(id),
    cantidad_base NUMERIC(12,4) NOT NULL,
    PRIMARY KEY (kit_producto_id, componente_producto_id)
);
```

Tu `es_kit` es un boolean sin tabla de componentes. Sin esta tabla, el sistema no puede:
- Descontar stock de componentes al consumir un kit
- Calcular costo de un kit como suma de componentes
- Alertar cuando falta un componente para armar un kit

### 4.8 Campos de auditoría

| Campo | Tipo | Estándar LIMS | Evaluación | Mejora |
|---|---|---|---|---|
| `created_at` | `timestamptz` | Created timestamp | ✅ Correcto | Sin cambio |
| `updated_at` | `timestamptz` | Last modified | ✅ Trigger existe | Sin cambio |
| `version` | `integer` | Optimistic locking | ✅ Excelente — previene writes perdidos | Sin cambio |
| `deleted_at` | `timestamptz` | Soft delete | ✅ Correcto | Sin cambio |
| `created_by` | — | Creator user | ❌ **AUSENTE** | Agregar FK |
| `updated_by` | — | Last modifier | ❌ **AUSENTE** | Agregar FK |

**Comparación con ISO 15189 §6.6.7:** ISO requiere registros de quién recibió, almacenó, y usó cada reactivo. Tu `audit_log` existe pero es una tabla separada con payloads mínimos. Los campos `created_by`/`updated_by` directos en la tabla dan acceso rápido sin JOIN.

---

## 5. Entidad `presentaciones`: análisis detallado

### Qué es en tu BD

```sql
presentaciones:
  id (PK), producto_id (FK), nombre, nombre_plural,
  factor_conversion, codigo_barras, gtin, gs1_habilitado,
  sku, formato_id, activa, version, created_at, deleted_at
```

### Qué es en un LIMS estándar

En LIMS modernos, las "presentaciones" se modelan como **unidades de medida** o **packaging variants**:

| Patrón LIMS | Tu BD | Evaluación |
|---|---|---|
| `unit_of_measure` (UN/CEFACT) | `nombre` + `factor_conversion` | ✅ Correcto — factor_conversion permite conversión |
| `packaging_type` (caja, frasco, ampolla) | `nombre` como "Caja", "Kit" | ⚠️ `nombre` mezcla tipo de empaque con unidad de medida |
| GS1 GTIN por presentación | `gtin` + `gs1_habilitado` | ✅ Excelente — alineado con GS1 |
| SKU por presentación | `sku` | ✅ Correcto |
| `barcode` por presentación | `codigo_barras` | ✅ Correcto |
| UNIQUE (producto_id, nombre) | ❌ No existe | ⚠️ Permite duplicados |

### Gaps específicos

1. **Sin UNIQUE (producto_id, nombre):** Dos "Caja" para el mismo producto. Un LIMS estándar previene esto.

2. **`factor_conversion` sin contexto de unidad:** El factor es un número, pero ¿convierte de qué a qué? Ej: si `factor_conversion = 12` para "Caja", ¿12 qué? 12 unidades base? 12 mL? El LIMS estándar tiene `from_unit` y `to_unit` explícitos.

3. **Sin campo de `costo_unitario`:** En un LIMS estándar, cada presentación tiene un costo asociado para cálculo de valor de inventario.

4. **Sin `peso_volumen`:** Para cálculos de peso/volumen por presentación (útil para logística y almacenamiento).

### Cómo debería ser

```sql
CREATE TABLE presentaciones (
    id SERIAL PRIMARY KEY,
    producto_id UUID NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
    
    -- Identidad
    nombre VARCHAR(100) NOT NULL,          -- "Caja", "Frasco", "Kit"
    nombre_plural VARCHAR(100) NOT NULL,
    
    -- Conversión
    factor_conversion NUMERIC(12,6) NOT NULL CHECK (factor_conversion > 0),
    -- NOTA: factor = 12 significa "1 presentación = 12 unidades base"
    
    -- Códigos
    sku VARCHAR(100),
    gtin VARCHAR(14),
    codigo_barras VARCHAR(100),
    gs1_habilitado BOOLEAN DEFAULT false,
    
    -- Empaque
    formato_id INTEGER REFERENCES presentacion_formatos(id),
    
    -- Costo (NUEVO)
    costo_unitario NUMERIC(12,4),
    moneda VARCHAR(3) DEFAULT 'USD',
    
    -- Estado
    activa BOOLEAN DEFAULT true NOT NULL,
    version INTEGER DEFAULT 1 NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    deleted_at TIMESTAMPTZ,
    
    -- Constraints
    UNIQUE (producto_id, nombre) WHERE deleted_at IS NULL,
    UNIQUE (sku) WHERE deleted_at IS NULL AND sku IS NOT NULL,
    UNIQUE (gtin) WHERE deleted_at IS NULL AND gtin IS NOT NULL
);
```

---

## 6. Entidad `lotes`: análisis detallado

### Qué es en tu BD

```sql
lotes (inferido del código):
  id, producto_id, numero_lote, fecha_vencimiento,
  cantidad, estado, import_batch_id, ...
```

### Qué exige ISO 15189 §6.6

ISO 15189 §6.6.2-4 requiere para CADA lote:

| Requisito ISO | Tu BD | Evaluación |
|---|---|---|
| Número de lote del fabricante | `numero_lote` | ✅ Correcto |
| Fecha de vencimiento | `fecha_vencimiento` | ✅ Correcto |
| Fecha de recepción | ❌ No existe explícitamente | ⚠️ `created_at` puede servir, pero no es la fecha real de recepción |
| Condiciones de almacenamiento | ❌ No está en lotes, está en productos | ⚠️ Debería ser por lote |
| Estado de aceptación (cuarentena) | ❌ No está en lotes | ⚠️ Debería ser por lote |
| Cantidad recibida | `cantidad` | ✅ Correcto |
| Proveedor del lote | ❌ No está en lotes | ⚠️ Debería ser por lote (un mismo producto puede venir de distintos proveedores) |

**Gap crítico:** En un LIMS estándar, el **lote** es la unidad de trazabilidad. Tu BD pone el estado de cuarentena (`estado_catalogo`) en el **producto**, no en el **lote**. Esto significa que si recibes 2 lotes de un producto, uno aprobado y otro en cuarentena, no puedes modelarlo.

### Cómo debería ser

```sql
-- Tabla lotes mejorada
CREATE TABLE lotes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    producto_id UUID NOT NULL REFERENCES productos(id),
    
    -- Identidad del lote
    numero_lote VARCHAR(100) NOT NULL,
    numero_lote_fabricante VARCHAR(100),  -- Lote del fabricante (puede diferir)
    
    -- Cantidades
    cantidad_recibida NUMERIC(12,4) NOT NULL,
    cantidad_disponible NUMERIC(12,4) NOT NULL,  -- stock actual
    unidad_medida VARCHAR(20) NOT NULL,  -- unidad del lote (no base)
    
    -- Fechas
    fecha_recepcion TIMESTAMPTZ NOT NULL,  -- CUÁNDO llegó
    fecha_vencimiento DATE,                 -- CUÁNDO vence
    fecha_apertura TIMESTAMPTZ,             -- CUÁNDO se abrió (para open-vial)
    dias_estabilidad_abierto INTEGER,       -- vida útil una vez abierto
    fecha_fabricacion DATE,                 -- CUÁNDO se fabricó
    
    -- Origen
    proveedor_id INTEGER REFERENCES proveedores(id),
    numero_orden_compra VARCHAR(100),
    factura_numero VARCHAR(100),
    
    -- Estado (por lote, no por producto)
    estado_lote TEXT NOT NULL DEFAULT 'pendiente_recepcion'
        CHECK (estado_lote IN (
            'pendiente_recepcion',  -- Recibido, no inspeccionado
            'en_cuarentena',        -- En proceso de verificación
            'aprobado',             -- Liberado para uso
            'rechazado',            -- No apto
            'en_uso',               -- abierto y en uso
            'vencido',              -- pasó fecha de vencimiento
            'agotado',              -- cantidad = 0
            'descartado'            -- descartado
        )),
    
    -- Almacenamiento (por lote, no por producto)
    ubicacion_id INTEGER REFERENCES ubicaciones(id),
    temperatura_requerida TEXT,
    
    -- Metadata
    notas TEXT,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    deleted_at TIMESTAMPTZ,
    
    -- Constraints
    UNIQUE (producto_id, numero_lote) WHERE deleted_at IS NULL,
    CHECK (cantidad_disponible >= 0),
    CHECK (cantidad_disponible <= cantidad_recibida)
);
```

**Diferencias clave con tu BD actual:**
1. `estado_lote` en vez de `estado_catalogo` en producto → permite cuarentena por lote
2. `fecha_recepcion` separada de `created_at` → fecha real de llegada al lab
3. `fecha_apertura` + `dias_estabilidad_abierto` → soporte para open-vial stability
4. `proveedor_id` en lote → un producto puede venir de distintos proveedores
5. `ubicacion_id` FK → ubicación física por lote, no por producto
6. `cantidad_disponible` → stock real del lote, no global

---

## 7. Entidad `producto_area` + stock: análisis detallado

### Qué es en tu BD

```sql
producto_area:
  producto_id (FK, PK compuesto),
  area_id (FK, PK compuesto),
  stock_maximo,
  punto_reorden
```

### Qué es en un LIMS estándar

El patrón estándar separa 3 conceptos:

```
STOCK_PER_LOCATION (cuánto hay)
  → producto_id + lote_id + ubicacion_id + cantidad
  
PAR_LEVELS (cuánto debería haber)
  → producto_id + ubicacion_id + min + max + reorder_point
  
MOVEMENTS (qué pasó)
  → lote_id + tipo_movimiento + cantidad + de/para ubicación + usuario + timestamp
```

### Gaps específicos

| Aspecto | Tu BD | Estándar LIMS | Impacto |
|---|---|---|---|
| Stock por lote | ❌ No | ✅ Requerido | No puedes saber cuánto queda de cada lote |
| Stock por ubicación | ✅ (por área) | ✅ (por ubicación jerárquica) | Tu "área" es granular; falta ubicación física |
| Par levels por ubicación | ✅ (stock_maximo, punto_reorden) | ✅ | Correcto |
| Movimientos | Tabla separada `movimientos` | ✅ | Tu tabla existe pero sin FK a lotes |
| FEFO enforcement | ❌ No | ✅ Requerido por ISO | No puedes forzar "primer vencido primero" |

### Cómo debería ser el stock

```sql
-- Stock por lote por ubicación (patrón estándar)
CREATE TABLE stock (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lote_id UUID NOT NULL REFERENCES lotes(id),
    ubicacion_id INTEGER NOT NULL REFERENCES ubicaciones(id),
    producto_id UUID NOT NULL REFERENCES productos(id),  -- denormalizado para performance
    
    cantidad NUMERIC(12,4) NOT NULL CHECK (cantidad >= 0),
    unidad_medida VARCHAR(20) NOT NULL,
    
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    
    UNIQUE (lote_id, ubicacion_id)
);

-- Vista de stock por producto (para queries rápidas)
CREATE VIEW v_stock_producto AS
SELECT 
    s.producto_id,
    s.ubicacion_id,
    SUM(s.cantidad) AS stock_total,
    COUNT(DISTINCT s.lote_id) AS lotes_count
FROM stock s
GROUP BY s.producto_id, s.ubicacion_id;
```

---

## 8. Entidad `producto_codigos_barras`: análisis detallado

### Tu BD actual

```sql
producto_codigos_barras:
  id, producto_id, codigo, activo, created_at
```

### Patrón GS1 estándar (ISO/IEC 15416, GS1 General Specifications)

Un LIMS moderno que cumple GS1 maneja:

| Campo GS1 | Tu BD | Evaluación |
|---|---|---|
| GTIN (Global Trade Item Number) | `gtin` en `presentaciones` | ✅ Correcto — está en presentaciones, no en la tabla de códigos |
| Batch/Lot Number | En `lotes` | ✅ Correcto |
| Expiry Date | En `lotes` | ✅ Correcto |
| Serial Number | ❌ No existe | ⚠️ Para trazabilidad unitaria |
| Barcode Type (EAN-13, Code128, DataMatrix) | ❌ No registrado | ⚠️ No sabes qué tipo de código es |

### Gaps

1. **Sin campo `tipo_codigo`:** No puedes distinguir entre EAN-13, Code128, QR, DataMatrix. Un LIMS estándar registra el symbology.

2. **Sin validación de formato:** El CHECK `codigo text NOT NULL` acepta cualquier string.

3. **Código de barras vs GTIN:** Tu BD tiene `codigo_barras` en presentaciones Y `gtin` en presentaciones Y `producto_codigos_barras` como tabla separada. Hay solapamiento confuso.

### Cómo debería ser

```sql
-- Consolidar en una sola tabla
CREATE TABLE producto_codigos (
    id SERIAL PRIMARY KEY,
    producto_id UUID NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
    presentacion_id INTEGER REFERENCES presentaciones(id),
    
    tipo_codigo TEXT NOT NULL CHECK (tipo_codigo IN (
        'gtin', 'ean13', 'ean8', 'upc', 'code128', 
        'code39', 'datamatrix', 'qr', 'sku', 'interno'
    )),
    codigo VARCHAR(100) NOT NULL,
    
    es_principal BOOLEAN DEFAULT false,  -- código escaneado por defecto
    activo BOOLEAN DEFAULT true,
    
    created_at TIMESTAMPTZ DEFAULT now(),
    
    UNIQUE (tipo_codigo, codigo) WHERE activo = true
);
```

---

## 9. Tablas de soporte: categorías, unidades, proveedores

### `categorias`

| Aspecto | Tu BD | Estándar | Evaluación |
|---|---|---|---|
| Jerarquía | Plana (sin padre) | Arboreada (categoría > subcategoría) | ⚠️ Falta jerarquía |
| Campos | `id`, `nombre` | `id`, `nombre`, `codigo`, `padre_id`, `nivel` | ⚠️ Falta `codigo` y `padre_id` |

**Comparación con LabWare:** LabWare usa categorías jerárquicas con 3-4 niveles. Ej: `Reactivos > Hematología > Coagulación > Reactivos de control`. Tu BD solo tiene 1 nivel.

**Mejora propuesta:**
```sql
ALTER TABLE categorias ADD COLUMN padre_id INTEGER REFERENCES categorias(id);
ALTER TABLE categorias ADD COLUMN codigo VARCHAR(20);
ALTER TABLE categorias ADD COLUMN nivel INTEGER DEFAULT 0;
```

### `unidades_basicas`

| Aspecto | Tu BD | Estándar | Evaluación |
|---|---|---|---|
| Codificación | Libre (`nombre`, `nombre_plural`) | UN/CEFACT o ISO 80000 | ⚠️ Sin estándar |
| Conversión | Solo en presentaciones | Tabla de factores de conversión | ⚠️ Limitado |

**Comparación con Benchling:** Benchling usa unidades estandarizadas con factores de conversión predefinidos. Ej: `1 L = 1000 mL = 1000 cm³`. Tu BD solo convierte entre presentación y base, no entre unidades arbitrarias.

### `proveedores`

| Aspecto | Tu BD | Estándar | Evaluación |
|---|---|---|---|
| Datos básicos | ✅ nombre, contacto, teléfono, email | ✅ | Correcto |
| Lead times | `dias_despacho_aereo`, `dias_despacho_tierra` | ✅ | Excelente — cubre logística |
| Calificación | ❌ No existe | Calificación de proveedor (A/B/C) | ⚠️ Falta |
| Contrato | ❌ No existe | Referencia a contrato Marco | ⚠️ Falta |

---

## 10. Tablas ausentes: qué falta vs el estándar

### Tablas que un LIMS moderno tiene y tu BD no

| Tabla ausente | Propósito | Prioridad |
|---|---|---|
| `ubicaciones` | Jerarquía de almacenamiento (building > room > cabinet > shelf) | 🔴 Alta |
| `movimientos_inventario` | Registro de cada movimiento: recepción, consumo, descarte, transferencia | 🔴 Alta |
| `instrucciones_uso` | Instrucciones de uso por producto (ISO §6.6.5) | 🟡 Media |
| `incidentes_adversos` | Reporte de incidentes con reactivos (ISO §6.6.6) | 🟡 Media |
| `kit_componentes` | Componentes de un kit (BOM) | 🟡 Media |
| `fabricantes` | Catálogo normalizado de fabricantes | 🟡 Media |
| `codigos_medicos` | Códigos LOINC/CPT normalizados | 🟡 Media |
| `parametros_almacenamiento` | Condiciones de almacenamiento por producto | 🟢 Baja |
| `certificados_analisis` | Certificados de análisis por lote (ISO §6.6.3) | 🟢 Baja |
| `historial_precios` | Ya existe como `producto_precio_historial` | ✅ Cubierto |

---

# PARTE IV — Relaciones y Diagrama

## 11. Mapa completo de relaciones actual vs ideal

### Relaciones actuales

```
productos (uuid PK)
├── 1:N presentaciones (ON DELETE CASCADE)
├── 1:N producto_codigos_barras (ON DELETE CASCADE)
├── N:M producto_area (ON DELETE CASCADE) [con areas]
├── 1:N lotes (ON DELETE NO ACTION) ⚠️
├── 1:N producto_precio_historial (ON DELETE CASCADE)
├── N:1 categorias (ON DELETE SET NULL)
├── N:1 unidades_basicas (ON DELETE SET NULL)
├── 1:N lab_campo_producto_valor (ON DELETE CASCADE)
├── N:1 areas (via producto_area)
└── N:1 proveedores (via precio_historial)
```

### Relaciones ideales (estándar LIMS 2026)

```
productos (uuid PK)
├── 1:N presentaciones (UNIQUE producto_id+nombre)
│     └── 1:N presentacion_codigos (gtin, sku, barcode)
├── 1:N lotes (estado_lote, proveedor, ubicacion)
│     ├── 1:N stock (cantidad por ubicación)
│     └── 1:N movimientos_inventario (recepción, uso, descarte)
├── N:1 categorias (ARBOL jerárquico)
├── N:1 unidades_basicas
├── N:1 fabricantes (NUEVO)
├── 1:N kit_componentes (NUEVO)
├── 1:N instrucciones_uso (NUEVO)
├── 1:N incidentes_adversos (NUEVO)
├── 1:N lab_campo_producto_valor
└── 1:N codigos_medicos (NUEVO - reemplaza codigo_loinc_cpt)

ubicaciones (NUEVO)
├── self-referencing FK (padre_id) → jerarquía
├── 1:N stock
└── 1:N lotes

movimientos_inventario (NUEVO)
├── N:1 lotes
├── N:1 ubicaciones (origen)
├── N:1 ubicaciones (destino)
├── N:1 usuarios (quién)
└── N:1 productos
```

## 12. Diagrama de entidad mejorado propuesto

```
                         ┌──────────────────┐
                         │    usuarios      │
                         └────────┬─────────┘
                                  │
                    ┌─────────────┴──────────────┐
                    │                             │
             ┌──────┴──────┐              ┌───────┴───────┐
             │  audit_log  │              │  movimientos  │
             └─────────────┘              │  _inventario  │
                                          └───────┬───────┘
                                                  │
┌─────────────┐    ┌──────────────┐    ┌──────────┴──────────┐
│ fabricantes │───▶│  productos   │◀───│      lotes          │
└─────────────┘    └──────┬───────┘    └──────────┬──────────┘
                          │                       │
            ┌─────────────┼───────────┐           │
            │             │           │           │
     ┌──────┴──────┐ ┌────┴────┐ ┌────┴────┐ ┌───┴──────┐
     │presentaciones│ │categorias│ │unidades │ │  stock   │
     └──────┬──────┘ └─────────┘ └─────────┘ └───┬──────┘
            │                                     │
     ┌──────┴──────┐                       ┌──────┴──────┐
     │codigos_     │                       │ ubicaciones │
     │medicos      │                       └─────────────┘
     └─────────────┘
     
     ┌─────────────┐
     │ kit_        │
     │ componentes │
     └─────────────┘
```

---

# PARTE V — Plan de Mejora

## 13. Priorización de mejoras por impacto

### 🔴 Fase 1: Corrección de bugs y gaps críticos (1-2 semanas)

| # | Mejora | Impacto | Esfuerzo |
|---|---|---|---|
| 1.1 | Corregir `imagen_path` en conteo.rs y stock_service.rs | Bug activo — imágenes no se muestran | Bajo |
| 1.2 | Completar enum `EstadoCatalogo` (agregar `Incompleto`, `Rechazado`) | Type safety, previene strings crudos | Bajo |
| 1.3 | Crear enums Rust para `clase_riesgo` y `temperatura_almacenamiento` | Previene CHECK violations del importer | Medio |
| 1.4 | Agregar `ON CONFLICT DO NOTHING` en producto_service.rs:386 | Previene PK violations en creación | Bajo |
| 1.5 | Agregar CHECKs: `stock_minimo_global >= 0`, `stock_maximo >= 0` | Previene datos inválidos | Bajo |

### 🟡 Fase 2: Enriquecimiento de entidades (2-4 semanas)

| # | Mejora | Impacto | Esfuerzo |
|---|---|---|---|
| 2.1 | Crear tabla `ubicaciones` jerárquica | Soporte para almacenamiento físico por ISO | Medio |
| 2.2 | Mover `estado_catalogo` a nivel de lote (nuevo `estado_lote`) | Cuarentena por lote (ISO §6.6.4) | Alto |
| 2.3 | Agregar `fecha_recepcion` y `proveedor_id` a lotes | Trazabilidad completa de origen | Medio |
| 2.4 | Agregar `fecha_apertura` + `dias_estabilidad_abierto` a lotes | Open-vial stability tracking | Medio |
| 2.5 | Normalizar `codigo_loinc_cpt` en tabla `codigos_medicos` | Soporte multi-código por tipo | Medio |
| 2.6 | Agregar UNIQUE `(producto_id, nombre)` a presentaciones | Previene duplicados | Bajo |
| 2.7 | Agregar `created_by`/`updated_by` a productos | Auditoría ISO-compliant | Medio |

### 🟢 Fase 3: Funcionalidad avanzada (1-2 meses)

| # | Mejora | Impacto | Esfuerzo |
|---|---|---|---|
| 3.1 | Crear tabla `movimientos_inventario` | Trazabilidad completa de transacciones | Alto |
| 3.2 | Crear tabla `kit_componentes` | Soporte para kits/BOM | Medio |
| 3.3 | Crear tabla `instrucciones_uso` | ISO §6.6.5 compliance | Medio |
| 3.4 | Crear tabla `incidentes_adversos` | ISO §6.6.6 compliance | Medio |
| 3.5 | Normalizar `fabricantes` como tabla separada | Consistencia de datos | Bajo |
| 3.6 | Agregar jerarquía a `categorias` (padre_id) | Navegación por categorías | Bajo |
| 3.7 | Consolidar `producto_codigos_barras` con GS1 fields | Estándar GS1 compliance | Medio |

## 14. Tabla resumen de gaps y esfuerzo

| Categoría | Gaps encontrados | Fase | Esfuerzo total |
|---|---|---|---|
| Bugs activos | 1 (`imagen_path`) | Fase 1 | 30 min |
| Type safety (enums) | 3 (`estado_catalogo`, `clase_riesgo`, `temperatura_almacenamiento`) | Fase 1 | 2-3 horas |
| Constraints | 5 (CHECKs faltantes) | Fase 1 | 1 hora |
| Entidad lotes | 4 (estado por lote, fecha recepción, open-vial, proveedor) | Fase 2 | 1-2 días |
| Tabla ubicaciones | 1 (nueva tabla jerárquica) | Fase 2 | 1 día |
| Auditoría | 2 (`created_by`, `updated_by`) | Fase 2 | 2 horas |
| Tablas ausentes | 6 (movimientos, kit_componentes, instrucciones, incidentes, fabricantes, codigos_medicos) | Fase 2-3 | 3-5 días |
| Normalización | 3 (categorías jerárquicas, GS1 consolidación, unidades) | Fase 3 | 2-3 días |

**Esfuerzo total estimado:** 8-12 días de desarrollo para alcanzar paridad con un LIMS estándar 2026.

---

> **Conclusión:** Tu BD tiene una base sólida — los campos core de identidad, trazabilidad, y control de lotes están bien pensados. Los gaps principales están en: (1) la granularidad de cuarentena (debe ser por lote, no por producto), (2) la ausencia de tabla de ubicaciones jerárquicas, y (3) la falta de movimientos de inventario para auditoría completa. Estos 3 cambios te acercarían significativamente al estándar ISO 15189 y a los LIMS comerciales modernos.
