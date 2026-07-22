# FDA GUDID API vs. Base de Datos — Análisis y Schema Mínimo

## 1. Campos comunes entre FDA GUDID y la BD actual

| FDA GUDID (openFDA) | BD actual (`productos`) | BD actual (`presentaciones`) |
|---|---|---|
| `brand_name` | `nombre` | — |
| `device_description` | `descripcion` | `nombre` |
| `catalog_number` | `sku` | `sku` |
| `version_or_model_number` | — (no existe como campo propio) | — |
| `company_name` | — (el fabricante está en `api_regulatoria_service::DispositivoMapeado.fabricante`) | — |
| `identifiers[].id` (GTIN) | `pres_gtin` | `gtin` |
| `identifiers[].issuing_agency` | `pres_gs1_habilitado` (derivado) | `gs1_habilitado` |
| `storage[].low/high` (temp) | `temperatura_almacenamiento` (enum: ambiente/refrigerado/congelado/ultra_frio) | — |
| `product_codes[].openfda.device_class` | `clase_riesgo` (pero usa enum distinto: biologico/quimico/radiactivo/inflamable/corrosivo/ninguno) | — |
| `has_lot_or_batch_number` | `control_lote` (enum: con_vto/sin_vto/no) | — |
| `has_expiration_date` | implícito en `control_lote = con_vto` | — |
| `is_kit` | — (no existe) | — |
| `device_count_in_base_package` | — | `factor_conversion` |
| `gmdn_terms[].name` | — (no existe) | — |
| `premarket_submissions[].submission_number` | — (no existe) | — |
| `commercial_distribution_status` | — (no existe) | — |

---

## 2. Ejemplo concreto: Roche Diagnostics

```json
{
  "brand_name": "Cholesterol Gen.2",
  "catalog_number": "03039773190",
  "version_or_model_number": "3039773190",
  "company_name": "Roche Diagnostics GmbH",
  "identifiers": [{ "id": "04015630918430", "type": "Primary", "issuing_agency": "GS1" }],
  "storage": [],
  "device_count_in_base_package": 1,
  "has_lot_or_batch_number": true,
  "has_expiration_date": true,
  "is_kit": false,
  "gmdn_terms": [{ "code": "53359", "name": "Total cholesterol lipid IVD, kit, spectrophotometry" }],
  "product_codes": [{ "code": "CHH", "openfda": { "device_class": "1" } }]
}
```

| Campo FDA | Valor | Mapeo a BD sugerido |
|---|---|---|
| `brand_name` | `"Cholesterol Gen.2"` | → `productos.nombre` |
| `catalog_number` | `"03039773190"` | → `productos.sku` (REF del fabricante) |
| `version_or_model_number` | `"3039773190"` | → `presentaciones.sku` o nuevo campo |
| `company_name` | `"Roche Diagnostics GmbH"` | → `fabricantes.nombre` (tabla separada) |
| `identifiers[].id` | `"04015630918430"` | → `presentaciones.gtin` |
| `has_expiration_date` | `true` | → `productos.control_lote = 'con_vto'` |
| `is_kit` | `false` | → nuevo flag si aplica |
| `device_count_in_base_package` | `1` | → `presentaciones.factor_conversion` |
| `storage` | `[]` | → `productos.temperatura_almacenamiento` |

---

## 3. Diferencias clave entre la BD actual y la FDA

### 3.1 Lo que la BD actual TIENE y la FDA **NO** provee

| Campo BD | Propósito |
|---|---|
| `unidad_base_id` | Unidad de medida interna (ej: mL, unidad, prueba) |
| `categoria_id` | Clasificación interna del laboratorio |
| `proveedor_id` | Distribuidor local (no el fabricante) |
| `precio_unidad` | Precio de compra local |
| `codigo_interno` | SKU interno del laboratorio |
| `ubicacion` | Ubicación física en bodega |
| `dias_estabilidad_abierto` | Estabilidad pos-apertura |
| `requiere_cadena_frio` | Flag de cadena de frío |
| `origen_registro` | `manual` / `api_fda` / `api_eudamed` / `guia_importada` |
| `estado_catalogo` | `aprobado` / `pendiente_aprobacion` / `rechazado` |
| `nombre_plural` | Plural de la presentación |

### 3.2 Lo que la FDA TIENE y la BD actual **NO** captura

| Campo FDA | Utilidad |
|---|---|
| `company_name` | Fabricante original del producto (ej: "Roche Diagnostics GmbH") |
| `gmdn_terms[].name` | Clasificación global estandarizada GMDN |
| `product_codes[].openfda.device_class` | Clase de riesgo FDA (1, 2, 3) — más granular que el enum actual |
| `premarket_submissions[].submission_number` | Número de registro FDA / autorización de mercado |
| `commercial_distribution_status` | Si está en distribución activa |
| `version_or_model_number` | Versión específica / modelo (a veces distinto de catalog_number) |
| `is_kit` | Si contiene múltiples componentes |
| `device_description` | Descripción más completa que el nombre comercial |

---

## 4. Schema mínimo desde cero

Basado en los campos comunes de la FDA GUDID + necesidades reales de gestión de inventario de laboratorio:

```sql
-- ============================================================
-- FABRICANTE (marca original, ej: Roche Diagnostics GmbH)
-- ============================================================
CREATE TABLE fabricantes (
    id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre      VARCHAR(300) NOT NULL,
    duns        VARCHAR(20),       -- DUNS number from FDA
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- PRODUCTO (ítem de catálogo, versión de laboratorio)
-- ============================================================
CREATE TABLE productos (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fabricante_id   INTEGER NOT NULL REFERENCES fabricantes(id),

    -- Identificación
    nombre          VARCHAR(300) NOT NULL,          -- brand_name
    descripcion     TEXT,                            -- device_description
    codigo_ref      VARCHAR(100),                   -- catalog_number REF
    modelo_version  VARCHAR(100),                   -- version_or_model_number

    -- Clasificación regulatoria
    clase_riesgo_fda CHAR(1),                       -- 1, 2, 3 (device_class)
    gmdn_code       VARCHAR(20),                    -- código GMDN
    gmdn_name       VARCHAR(300),                   -- nombre GMDN
    product_code    VARCHAR(10),                    -- código FDA product code
    submission      VARCHAR(20),                    -- premarket submission number

    -- Atributos físicos
    es_kit          BOOLEAN NOT NULL DEFAULT false,
    requiere_lote   BOOLEAN NOT NULL DEFAULT true,  -- has_lot_or_batch_number
    requiere_vto    BOOLEAN NOT NULL DEFAULT true,  -- has_expiration_date
    temp_min_c      NUMERIC(4,1),                   -- storage low
    temp_max_c      NUMERIC(4,1),                   -- storage high

    -- Internos del laboratorio
    codigo_interno  VARCHAR(20) NOT NULL UNIQUE,    -- SKU interno
    categoria_id    INTEGER REFERENCES categorias(id),
    ubicacion       VARCHAR(200),

    -- Auditoría
    activo          BOOLEAN NOT NULL DEFAULT true,
    origen          VARCHAR(20) NOT NULL DEFAULT 'manual'
                    CHECK (origen IN ('manual','api_fda','api_eudamed','guia')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- PRESENTACIÓN (unidad de compra/consumo, ej: "kit x100 tests")
-- ============================================================
CREATE TABLE presentaciones (
    id              INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    producto_id     UUID NOT NULL REFERENCES productos(id),

    nombre          VARCHAR(200) NOT NULL,           -- ej: "kit x100", "caja x50"
    nombre_plural   VARCHAR(200),
    factor          NUMERIC(12,2) NOT NULL,          -- cantidad de unidad base que contiene

    -- Identificación GS1
    gtin            VARCHAR(14),                     -- GTIN-14
    codigo_barras   VARCHAR(100),

    -- Interno
    activa          BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- PROVEEDOR (distribuidor local que vende el producto)
-- ============================================================
CREATE TABLE proveedores (
    id          INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nombre      VARCHAR(300) NOT NULL,               -- ej: "Galenica Chile S.A."
    contacto    VARCHAR(200),
    telefono    VARCHAR(50),
    email       VARCHAR(255),
    activo      BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- PRODUCTO-PROVEEDOR (precios y refs por distribuidor)
-- ============================================================
CREATE TABLE producto_proveedor (
    producto_id     UUID NOT NULL REFERENCES productos(id),
    proveedor_id    INTEGER NOT NULL REFERENCES proveedores(id),
    ref_proveedor   VARCHAR(100),                    -- código REF del distribuidor
    precio_unidad   NUMERIC(12,4),
    lead_time_dias  INTEGER,
    PRIMARY KEY (producto_id, proveedor_id)
);
```

---

## 5. Mapeo FDA → Schema mínimo

| FDA GUDID | Tabla destino | Campo |
|---|---|---|
| `company_name` | `fabricantes` | `nombre` |
| `brand_name` | `productos` | `nombre` |
| `device_description` | `productos` | `descripcion` |
| `catalog_number` | `productos` | `codigo_ref` |
| `version_or_model_number` | `productos` | `modelo_version` |
| `identifiers[].id` (GTIN) | `presentaciones` | `gtin` |
| `product_codes[].openfda.device_class` | `productos` | `clase_riesgo_fda` |
| `gmdn_terms[].code` | `productos` | `gmdn_code` |
| `gmdn_terms[].name` | `productos` | `gmdn_name` |
| `product_codes[].code` | `productos` | `product_code` |
| `premarket_submissions[].submission_number` | `productos` | `submission` |
| `is_kit` | `productos` | `es_kit` |
| `has_lot_or_batch_number` | `productos` | `requiere_lote` |
| `has_expiration_date` | `productos` | `requiere_vto` |
| `storage[].low.value / high.value` | `productos` | `temp_min_c / temp_max_c` |
| `device_count_in_base_package` | `presentaciones` | `factor` |

---

## 6. Resumen de diferencias fabricante vs proveedor

El schema actual mezcla ambas entidades en `proveedores` y en el campo `productos.proveedor_id`. La FDA separa claramente:

- **Fabricante** = `company_name` (Roche Diagnostics GmbH, Abbott Ireland, bioMérieux SA) — quien diseña y produce
- **Proveedor** = el distribuidor local (Galenica, MedSupply, Biolab) — quien vende y entrega

La tabla `producto_proveedor` permite que un mismo producto (ej: Cholesterol Gen.2 de Roche) se compre a distintos distribuidores con precios distintos.
