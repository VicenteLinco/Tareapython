# Schema — Decisiones finales

## Resumen de cambios

### SACAR (13 campos)

| Tabla | Campo | Destino |
|---|---|---|
| `productos` | `proveedor_id` | → `producto_proveedor.proveedor_id` |
| `productos` | `precio_unidad` | → `producto_proveedor.precio_unidad` |
| `productos` | `lead_time_propio` | → `producto_proveedor.lead_time_dias` |
| `productos` | `pres_nombre` | → `presentaciones.nombre` |
| `productos` | `pres_nombre_plural` | → `presentaciones.nombre_plural` |
| `productos` | `pres_factor` | → `presentaciones.factor_conversion` |
| `productos` | `pres_codigo_barras` | → `presentaciones.codigo_barras` |
| `productos` | `pres_gtin` | → `presentaciones.gtin` |
| `productos` | `pres_gs1_habilitado` | → `presentaciones.gs1_habilitado` |
| `productos` | `imagen_path` | eliminar (duplicado de `imagen_url`) |
| `productos` | `requiere_cadena_frio` | eliminar (se deduce de temp) |

### RENOMBRAR

| Hoy | Nueva |
|---|---|
| `productos.sku` | `productos.codigo_ref` |
| `productos.temperatura_almacenamiento` (enum) | `productos.temp_min_c` + `productos.temp_max_c` (numeric) |

### AGREGAR (17 campos nuevos)

| Tabla | Campo | Tipo |
|---|---|---|
| `fabricantes` | (tabla nueva) | `id`, `nombre`, `duns`, `pais`, `activo` |
| `productos` | `fabricante_id` | `INTEGER FK → fabricantes` |
| `productos` | `modelo_version` | `VARCHAR(100)` |
| `productos` | `es_kit` | `BOOLEAN` |
| `productos` | `tipo_producto` | `VARCHAR(30)` ENUM |
| `productos` | `registro_isp` | `VARCHAR(30)` |
| `productos` | `codigo_mercadopublico` | `VARCHAR(20)` |
| `productos` | `pais_origen` | `CHAR(2)` |
| `productos` | `es_control_calidad` | `BOOLEAN` |
| `productos` | `es_calibrador` | `BOOLEAN` |
| `productos` | `proteccion_luz` | `BOOLEAN` |
| `productos` | `dias_estabilidad_descongelado` | `INTEGER` |
| `productos` | `max_ciclos_descongelado` | `INTEGER` |
| `productos` | `nivel_bioseguridad` | `INTEGER` (1-4) |
| `productos` | `hoja_seguridad_url` | `TEXT` |
| `productos` | `alerta_vencimiento_dias` | `INTEGER DEFAULT 30` |
| `productos` | `intervalo_control_calidad_dias` | `INTEGER` |
| `presentaciones` | `gtin_interno` | `BOOLEAN` |
| `producto_proveedor` | (activar tabla existente) | `ref_proveedor`, `precio_unidad`, `lead_time_dias`, `es_proveedor_principal` |

### SE QUEDA IGUAL (sin cambios)

| Tabla | Campo |
|---|---|
| `productos` | `clase_riesgo` (enum químico actual) |
| `productos` | `categoria_id` |
| `productos` | `unidad_base_id` |
| `productos` | `codigo_interno` |
| `productos` | `nombre`, `descripcion` |
| `productos` | `ubicacion` |
| `productos` | `dias_estabilidad_abierto` |
| `productos` | `activo`, `control_lote`, `estado_catalogo`, `origen_registro` |
| `productos` | `version`, `created_at`, `updated_at` |
| `productos` | `imagen_url` |
| `presentaciones` | `codigo_barras` (conservado para barcodes no-GS1) |
| `producto_area` | sin cambios |

---

## Estado final de `fabricantes` (tabla nueva)

```
id              INTEGER PK GENERATED ALWAYS AS IDENTITY
nombre          VARCHAR(300) NOT NULL     -- Razón social
nombre_corto    VARCHAR(50)               -- Para selects
duns            VARCHAR(20)               -- DUNS number FDA
pais            CHAR(2)                   -- ISO 3166-1 alpha-2
activo          BOOLEAN DEFAULT true
created_at      TIMESTAMPTZ DEFAULT now()
```

## Estado final de `producto_proveedor` (activar)

```
producto_id     UUID NOT NULL FK → productos
proveedor_id    INTEGER NOT NULL FK → proveedores
ref_proveedor   VARCHAR(100)              -- código que usa el distribuidor
precio_unidad   NUMERIC(12,4)
lead_time_dias  INTEGER
es_principal    BOOLEAN DEFAULT false     -- proveedor default
created_at      TIMESTAMPTZ DEFAULT now()
PRIMARY KEY (producto_id, proveedor_id)
```

## Estado final de `presentaciones`

```
id                  INTEGER PK GENERATED ALWAYS AS IDENTITY
producto_id         UUID NOT NULL FK → productos
nombre              VARCHAR(100) NOT NULL
nombre_plural       VARCHAR(100) NOT NULL
factor_conversion   NUMERIC(12,6) NOT NULL
codigo_barras       VARCHAR(100)          -- conservado para barcodes no-GS1
gtin                VARCHAR(14)
gtin_interno        BOOLEAN DEFAULT false -- (NUEVO) true = generado por el sistema
gs1_habilitado      BOOLEAN DEFAULT false
activa              BOOLEAN DEFAULT true
version             INTEGER DEFAULT 1
deleted_at          TIMESTAMPTZ
created_at          TIMESTAMPTZ DEFAULT now()
sku                 VARCHAR(100)          -- REF propio de la presentación
```

## Estado final de `productos`

```
id                  UUID PK
codigo_interno      VARCHAR(20) NOT NULL     -- SKU interno del lab
nombre              VARCHAR(300) NOT NULL    -- brand_name
descripcion         TEXT                     -- device_description
categoria_id        INTEGER FK              -- clasificación interna
unidad_base_id      INTEGER FK NOT NULL
ubicacion           VARCHAR(200)

-- Fabricante (NUEVO)
fabricante_id       INTEGER FK NOT NULL
codigo_ref          VARCHAR(100)             -- REF del fabricante (antes sku)
modelo_version      VARCHAR(100)             -- version_or_model_number (FDA)

-- Clasificación
tipo_producto       VARCHAR(30)              -- reactivo / control / calibrador / consumible / ...
es_kit              BOOLEAN DEFAULT false
es_control_calidad  BOOLEAN DEFAULT false
es_calibrador       BOOLEAN DEFAULT false
clase_riesgo        VARCHAR(20)              -- enum químico actual (se queda)

-- Chile (NUEVO)
registro_isp        VARCHAR(30)              -- registro sanitario ISP
codigo_mercadopublico VARCHAR(20)            -- ChileCompra
pais_origen         CHAR(2)                  -- ISO 3166-1 alpha-2

-- Almacenamiento (cambiado)
temp_min_c          NUMERIC(4,1)
temp_max_c          NUMERIC(4,1)
proteccion_luz      BOOLEAN DEFAULT false
nivel_bioseguridad  INTEGER                  -- 1-4
hoja_seguridad_url  TEXT

-- Estabilidad
dias_estabilidad_abierto        INTEGER     -- (existente)
dias_estabilidad_descongelado   INTEGER     -- (NUEVO)
max_ciclos_descongelado         INTEGER     -- (NUEVO)
alerta_vencimiento_dias         INTEGER DEFAULT 30  -- (NUEVO)
intervalo_control_calidad_dias  INTEGER     -- (NUEVO)

-- Auditoría
activo              BOOLEAN DEFAULT true
control_lote        VARCHAR(20)              -- con_vto / sin_vto / no
estado_catalogo     VARCHAR(30)              -- aprobado / pendiente_aprobacion / rechazado
origen_registro     VARCHAR(20)              -- manual / api_fda / api_eudamed / guia
version             INTEGER DEFAULT 1
created_at          TIMESTAMPTZ
updated_at          TIMESTAMPTZ
imagen_url          TEXT
```

---

## Resumen numérico

| Operación | Cantidad |
|---|---|
| SACAR | 13 campos |
| RENOMBRAR | 2 campos |
| AGREGAR | 17 campos + 1 tabla nueva (fabricantes) + activar producto_proveedor |
| SE QUEDA | 15 campos sin tocar |

---

## Puntos débiles y riesgos

### 🟡 Migración de datos existentes

El cambio más riesgoso. Hoy hay productos con `proveedor_id`, `sku`, `precio_unidad` y `lead_time_propio` poblados. La migración tiene que:

1. Por cada producto con `proveedor_id NOT NULL`, insertar una fila en `producto_proveedor` con los valores actuales
2. Si el mismo par (producto, proveedor) ya existe en `producto_proveedor` (por la migración 058), decidir cuál gana o mergear
3. Recién después dropear las columnas de `productos`

> ⚠️ **Riesgo:** si hay duplicados o inconsistencias entre `productos.proveedor_id` y `producto_proveedor`, la migración puede fallar o perder datos.

### 🟡 `codigo_ref` puede colisionar

Actualmente `sku` no tiene UNIQUE. Si lo renombramos a `codigo_ref`, dos productos del mismo fabricante pueden tener el mismo REF (ej: una presentación de 50 tests y otra de 100). La UNIQUE real es `(fabricante_id, codigo_ref)`.

> **Sugerencia:** no poner UNIQUE en `codigo_ref` solo, sino `UNIQUE (fabricante_id, codigo_ref)` si es necesario. O directamente no poner UNIQUE y manejarlo en la app.

### 🟡 `tipo_producto` ENUM vs tabla

Ponerlo como `VARCHAR(30)` con CHECK es rígido. Si después querés agregar "control_toxicologia", necesitás ALTER TABLE. Una tabla `tipos_producto` con FK es más flexible.

> **Sugerencia:** si creés que va a crecer, usa tabla. Si sabés que son fijos (~10 valores), el CHECK alcanza.

### 🟡 `nivel_bioseguridad` sin constraint explícito

En el schema final quedó como `INTEGER` sin CHECK (1-4). PostgreSQL no valida el rango a menos que lo agreguemos.

> **Sugerencia:** agregar `CHECK (nivel_bioseguridad BETWEEN 1 AND 4)`.

### 🟡 `codigo_mercadopublico` es frágil

ChileCompra cambia códigos periódicamente en licitaciones. Si el código lo mantenés a mano, se desactualiza rápido. Si lo obtenés de la API de Mercado Público, necesitás un job de sincronización.

> **Sugerencia:** evaluar si realmente se va a mantener actualizado o si es un campo que va a quedar obsoleto al mes.

### 🟡 `intervalo_control_calidad_dias` mezcla dominios

La frecuencia de QC es una config del laboratorio, no un atributo intrínseco del producto. Un mismo producto puede tener distinta frecuencia de QC en distintos laboratorios o áreas.

> **Sugerencia:** si el QC lo define cada laboratorio, este campo pertenece a `producto_area`, no a `productos`.

### 🟡 `updated_at` no se actualiza solo

El schema final muestra `updated_at` pero no hay mención de un trigger o de manejarlo desde la app. Si la app no lo setea explícitamente, queda en el valor de `created_at`.

> **Sugerencia:** verificar que el trigger `update_updated_at_column()` existe (o crearlo).

### 🟡 `fabricante_id` NOT NULL puede bloquear

Si llega un producto de un fabricante que no está en la tabla `fabricantes`, la inserción falla. Durante la migración inicial, productos legacy sin fabricante conocido van a requerir un `fabricante_id` por defecto (ej: "Sin fabricante" o "No identificado").

> **Sugerencia:** o permitir NULL temporalmente, o crear un registro "Desconocido / No identificado" en `fabricantes` y usarlo como default.

### 🟡 Orden de migrations importa

Si aplicamos los SACAR y AGREGAR en una sola migration, el orden debe ser:

1. Crear tabla `fabricantes` + insertar datos iniciales
2. Agregar columnas nuevas a `productos` (con defaults o nullable)
3. Migrar datos de `productos → producto_proveedor`
4. Poblar `fabricante_id` en productos existentes
5. Recién ahí dropear columnas viejas
6. Crear índices

Hacerlo en otro orden puede romper queries existentes.

### ✅ Puntos fuertes del schema

- `fabricantes` separado de `proveedores` — desacopla marca de distribuidor
- `tipo_producto` — permite lógica diferenciada por tipo (alertas, reorden, caducidad)
- `registro_isp` + `codigo_mercadopublico` — necesario para compras públicas en Chile
- `temp_min_c`/`temp_max_c` numérico — más preciso que el enum, y la VIEW del enum se puede crear como columna generada
- Los booleans control/calibrador/kit permiten filtrar sin joins
- `alerta_vencimiento_dias` por producto — override para casos especiales sin hardcodear
