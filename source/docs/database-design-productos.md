# Diseño de Base de Datos — Productos

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
