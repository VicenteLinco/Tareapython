# Benchmark: Diseño de BD de Productos vs Mejores Prácticas 2026

> **Fecha**: 2026-07-23  
> **Alcance**: Comparación detallada de la entidad `productos` y sus relaciones contra los estándares de LIMS modernos, ISO 15189:2022, y mejores prácticas de inventario de laboratorio.  
> **Fuentes**: ISO 15189:2022 §6.6 (Reagents & Consumables), schema LIMS de referencia (32 tablas), Siemens BIMS, LabStockManager (thesis ULiege 2025), Cleverence/Labs practices, Benchling/CloudLIMS/LabWare patterns.

---

## Tabla de Contenidos

### PARTE I — Estándar de Referencia
1. [Qué exige ISO 15189:2022 §6.6 para inventario de reactivos](#par1-iso)
2. [Arquitectura de un LIMS moderno: patrones de entidad](#par1-patterns)
3. [El modelo " Items → Lots → Stock → Location" ](#par1-model)

### PARTE II — Tu Esquema vs el Estándar
4. [Entidad `productos`: análisis detallado campo por campo](#par2-productos)
5. [Entidad `presentaciones`: análisis detallado](#par2-presentaciones)
6. [Entidad `lotes`: análisis detallado](#par2-lotes)
7. [Entidad `producto_area` + stock: análisis detallado](#par2-stock)
8. [Entidad `producto_codigos_barras`: análisis detallado](#par2-barcode)
9. [Tablas de soporte: categorías, unidades, proveedores](#par2-soporte)
10. [Tablas ausentes: qué falta vs el estándar](#par2-ausentes)

### PARTE III — Relaciones y Diagrama
11. [Mapa completo de relaciones actual vs ideal](#par3-relations)
12. [Diagrama de entidad mejorado propuesto](#par3-diagram)

### PARTE IV — Plan de Mejora
13. [Priorización de mejoras por impacto](#par4-plan)
14. [Tabla resumen de gaps y esfuerzo](#par4-summary)

---

# PARTE I — Estándar de Referencia

## 1. Qué exige ISO 15189:2022 §6.6 para inventario de reactivos

ISO 15189:2022 es el estándar internacional para laboratorios de análisis clínicos. La sección **6.6 (Reagents and Consumables)** establece requisitos explícitos:

| Requisito ISO 15189 §6.6 | Descripción | Tu BD lo cumple? |
|---|---|---|---|
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

# PARTE II — Tu Esquema vs el Estándar

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
| `ubicacion` | `varchar(200)` | Storage location | ❌ **字符串 — debería ser FK a tabla de ubicaciones jerárquicas** | Ver §10 |
| `temperatura_almacenamiento` | `varchar(30)` CHECK | Storage temperature | ⚠️ Sin enum Rust, sin FK a标准 de temperatura | Crear ENUM |
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

| Tablaausente | Propósito | Prioridad |
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

# PARTE III — Relaciones y Diagrama

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

# PARTE IV — Plan de Mejora

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

> **Conclusión:** Tu BD tiene una base sólida — los campos core de identidad, trazabilidad, y control de lotes están bien pensados. Los gaps principales están en: (1) la粒度 de cuarentena (debe ser por lote, no por producto), (2) la ausencia de tabla de ubicaciones jerárquicas, y (3) la falta de movimientos de inventario para auditoría completa. Estos 3 cambios te acercarían significativamente al estándar ISO 15189 y a los LIMS comerciales modernos.
