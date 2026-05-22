# Informe de Análisis y Plan de Trabajo — Diseño de Base de Datos y Creador de Productos

> Generado: 2026-05-22

## RESUMEN EJECUTIVO

El sistema tiene una base sólida (ledger inmutable, FEFO, soft-delete, optimistic locking, trigger de stock) pero acumula **deuda de diseño visible en 52 migraciones** que revelan decisiones iniciales insuficientes en: catálogo de proveedores, stock por área, atributos de producto críticos para laboratorio clínico, y persistencia de formatos de presentación. A continuación: análisis por capa, comparativa con competidores, y plan de trabajo priorizado.

---

## PARTE 1 — QUÉ SE HIZO BIEN

### Base de datos
| Decisión | Por qué es correcta |
|---|---|
| Ledger inmutable (`movimientos`) | Auditoría completa sin posibilidad de alterar historia |
| Trigger BEFORE INSERT para stock | El stock nunca queda inconsistente con los movimientos |
| FEFO automático en `stock_ops` | No requiere intervención del usuario; crítico en reactivos |
| UUID para entidades distribuidas | Recepciones/productos/movimientos son globalmente únicos |
| Optimistic locking (`version`) | Previene sobreescritura en edición simultánea |
| Soft delete universal | Preserva integridad referencial sin perder historial |
| `UNIQUE(lote_id, area_id)` en stock | Un único registro de stock por lote+área; sin duplicados |
| `factor_conversion` en presentaciones | Cálculo universal desde unidad base; presentaciones son multiplicadores |
| Audit log con JSONB | Historial completo de cambios con antes/después |
| `grupo_movimiento UUID` | Agrupa transferencias entrada/salida en un solo batch lógico |
| Idempotency keys | Previene duplicación en operaciones móviles con red inestable |

### Frontend (Creador de Productos)
- Navegación por URL (`?tab=`) — recargable y compartible
- Quick-create de categoría/unidad/área inline desde el diálogo de producto
- Barcode scanner integrado en la creación de presentación
- Protección de `factor_conversion` si la presentación ya fue usada en recepciones

---

## PARTE 2 — ERRORES Y DEUDA DE DISEÑO

### 2.1 Modelo de Producto-Proveedor: simplificación excesiva

**Problema:** `productos.proveedor_id INT` es un único proveedor por producto. En un laboratorio clínico real, un reactivo puede comprarse a múltiples proveedores según disponibilidad/precio. La migration 049 resolvió esto parcialmente en `solicitudes_compra` (con `solicitud_envios`), pero el catálogo sigue siendo mono-proveedor.

**Impacto:** En `solicitud_compra_detalle`, el proveedor se infiere del producto. Si el producto no tiene proveedor asignado, no aparece en los envíos. Además, no hay forma de registrar el código del producto según cada proveedor, precio pactado con cada uno, o tiempos de despacho específicos por producto.

**Solución:**
```sql
CREATE TABLE producto_proveedor (
    id SERIAL PRIMARY KEY,
    producto_id UUID NOT NULL REFERENCES productos(id),
    proveedor_id INT NOT NULL REFERENCES proveedores(id),
    es_principal BOOLEAN NOT NULL DEFAULT FALSE,
    codigo_proveedor VARCHAR(100),
    precio_unidad DECIMAL(12,4),
    lead_time_dias INT,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    version INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (producto_id, proveedor_id)
);
```
Esto reemplaza `productos.proveedor_id`, `productos.codigo_proveedor`, `productos.precio_unidad` y `productos.lead_time_propio`.

---

### 2.2 `stock_minimo` global: debería ser por área

**Problema:** `productos.stock_minimo` es un único valor para el producto independientemente del área. En la práctica, Bodega Reactivos necesita 100 unidades de una prueba pero PCR solo necesita 10. Las alertas de stock aplican el mismo umbral a todas las áreas.

**Impacto:** Alertas de stock incorrectas o ignoradas porque el umbral global no refleja la realidad de cada área.

**Solución:** Extender la tabla `producto_area` que ya existe:
```sql
ALTER TABLE producto_area
    ADD COLUMN stock_minimo DECIMAL(12,2),  -- NULL = usa el global del producto
    ADD COLUMN stock_maximo DECIMAL(12,2),  -- para cálculo de punto de reorden
    ADD COLUMN punto_reorden DECIMAL(12,2); -- cuando disparar la solicitud de compra
```

---

### 2.3 Atributos críticos de laboratorio ausentes en productos

**Problema:** No existe ningún campo para las condiciones de almacenamiento. Para un laboratorio clínico, esto es información crítica de seguridad y calidad.

**Campos faltantes:**
```sql
ALTER TABLE productos ADD COLUMN temperatura_almacenamiento VARCHAR(30)
    CHECK (temperatura_almacenamiento IN (
        'ambiente',    -- 15-30°C
        'refrigerado', -- 2-8°C
        'congelado',   -- -20°C
        'ultra_frio',  -- -80°C
        'no_aplica'
    ));
ALTER TABLE productos ADD COLUMN requiere_cadena_frio BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE productos ADD COLUMN clase_riesgo VARCHAR(20);
ALTER TABLE productos ADD COLUMN dias_estabilidad_abierto INT;
ALTER TABLE productos ADD COLUMN unidad_minima_pedido DECIMAL(12,2);
```

**Impacto en el sistema completo:** Las alertas de vencimiento deberían también considerar `dias_estabilidad_abierto` desde la fecha de apertura del lote.

---

### 2.4 `imagen_url` almacena base64 en BD: error de diseño grave

**Problema:** El campo `imagen_url TEXT` almacena imágenes en base64 directamente en PostgreSQL. Una imagen de 200 KB en base64 ocupa ~267 KB en la base de datos. Con 1500 productos, eso son hasta 400 MB solo en imágenes.

**Impacto:** Queries de listado de productos arrastran megabytes de base64 innecesariamente. El nombre `imagen_url` es semánticamente incorrecto.

**Solución correcta:** Almacenar en filesystem y guardar la ruta:
```sql
ALTER TABLE productos RENAME COLUMN imagen_url TO imagen_path;
-- El valor sería: 'uploads/productos/<uuid>.webp'
```

---

### 2.5 `solicitud_compra_detalle.unidad VARCHAR(50)`: campo frágil

**Problema:** La unidad se almacena como texto libre en lugar de FK a `unidades_basicas`.

```sql
-- Actual (frágil):
unidad VARCHAR(50) NOT NULL

-- Correcto:
unidad_base_id INT NOT NULL REFERENCES unidades_basicas(id),
presentacion_id INT REFERENCES presentaciones(id), -- opcional
```

Si se renombra una unidad en `unidades_basicas`, los detalles históricos de solicitud quedan con el nombre viejo sin trazabilidad.

---

### 2.6 `configuracion_sistema.valor VARCHAR(500)`: trunca logos

**Problema:** El logo del laboratorio se guarda en base64 en esta columna de 500 caracteres. Un logo mínimo en base64 ocupa ~2 KB. La columna trunca silenciosamente.

**Solución:** Cambiar a `TEXT` o mejor, usar almacenamiento de archivos igual que las imágenes de producto.

---

### 2.7 No existe constraint UNIQUE en `recepcion_reconciliacion`

**Problema:** La tabla `recepcion_reconciliacion` (migration 050) no tiene constraint único sobre `(recepcion_id, solicitud_id, producto_id)`. Múltiples ejecuciones del proceso de reconciliación crean filas duplicadas.

```sql
ALTER TABLE recepcion_reconciliacion
    ADD CONSTRAINT uq_rec_reconciliacion 
    UNIQUE (recepcion_id, solicitud_id, producto_id);
```

---

### 2.8 `lotes` sin constraint refinado por proveedor

**Problema:** El constraint `UNIQUE (producto_id, numero_lote)` no considera el proveedor: dos proveedores distintos pueden usar el mismo número de lote para el mismo producto.

**Mejor diseño:**
```sql
-- Constraint actual:
UNIQUE (producto_id, numero_lote)

-- Constraint correcto:
UNIQUE (producto_id, proveedor_id, numero_lote)
```

---

### 2.9 Formatos de presentación en `localStorage` (frontend)

**Problema:** La tab "Presentaciones/Formatos" persiste los formatos personalizados en `localStorage` del navegador. Esto significa:
- Si se borra la caché, se pierden los formatos
- No se comparten entre usuarios del sistema
- No hay backup de estos datos

**Solución:** Crear una tabla `presentacion_formatos` en BD:
```sql
CREATE TABLE presentacion_formatos (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(50) NOT NULL UNIQUE,
    nombre_plural VARCHAR(50),
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

### 2.10 No existe historial de precios de producto

**Problema:** `productos.precio_unidad` es el precio actual. No hay forma de ver cómo evolucionó el precio en el tiempo. Para análisis de costo y presupuesto, esto es información crítica.

**Solución:** Tabla de historial de precios:
```sql
CREATE TABLE producto_precio_historial (
    id BIGSERIAL PRIMARY KEY,
    producto_id UUID NOT NULL REFERENCES productos(id),
    proveedor_id INT REFERENCES proveedores(id),
    precio DECIMAL(12,4) NOT NULL,
    fecha_desde DATE NOT NULL,
    usuario_id UUID NOT NULL REFERENCES usuarios(id),
    nota TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

### 2.11 `deleted_at` ausente en tablas con soft-delete

**Problema:** Todas las tablas con soft-delete usan `activo BOOLEAN` pero ninguna tiene `deleted_at TIMESTAMPTZ`. Imposibilita saber cuándo fue desactivado un registro.

**Tablas afectadas:** `categorias`, `unidades_basicas`, `areas`, `productos`, `presentaciones`, `proveedores`.

---

### 2.12 No hay soporte GS1 para códigos de barras

**Problema:** El campo `presentaciones.codigo_barras VARCHAR(100)` almacena un código simple. El estándar de la industria es GS1-128 que codifica: GTIN + número de lote + fecha de vencimiento en un solo símbolo.

**Impacto:** Al escanear un producto en recepción, el sistema no puede pre-poblar lote y fecha de vencimiento automáticamente.

**Solución mínima en BD:**
```sql
ALTER TABLE presentaciones
    ADD COLUMN gtin VARCHAR(14),
    ADD COLUMN gs1_habilitado BOOLEAN NOT NULL DEFAULT FALSE;
```

---

### 2.13 Vista `v_stock_por_producto_area` posiblemente rota

**Problema:** La vista original (migration 001) referencia `unidades_medida` que fue renombrada a `unidades_basicas` en migration 005. La vista debió haber sido recreada.

**Verificación necesaria:**
```sql
SELECT * FROM v_stock_por_producto_area LIMIT 1;
-- Si falla, la vista está rota
```

---

## PARTE 3 — COMPARATIVA CON COMPETIDORES

| Característica | Tu sistema | Odoo 17 | SAP Business One | ERPNext |
|---|---|---|---|---|
| Múltiples proveedores por producto | ❌ Solo 1 | ✅ Catálogo por proveedor | ✅ | ✅ |
| Stock mínimo por área/almacén | ❌ Global | ✅ Por almacén | ✅ | ✅ |
| Temperatura de almacenamiento | ❌ | ❌ (módulo externo) | ❌ (SAP QM) | ❌ |
| FEFO automático | ✅ | ✅ | ✅ | ✅ |
| GS1 barcode parsing | ❌ | ✅ Parcial | ✅ | ✅ Parcial |
| Historial de precios | ❌ | ✅ | ✅ | ✅ |
| Formatos en servidor | ❌ (localStorage) | ✅ UoM categories | ✅ | ✅ |
| Forecast de demanda | ✅ Básico | ✅ Avanzado | ✅ Avanzado | ✅ Básico |
| Imágenes en BD (base64) | ❌ Error | ✅ URLs | ✅ URLs | ✅ URLs |
| Ordenes de compra (OC) | ✅ Reciente | ✅ | ✅ | ✅ |
| Reconciliación recepción/OC | ✅ Reciente | ✅ | ✅ | ✅ |
| Conteo ciego de inventario | ✅ | ✅ | ✅ | ✅ |
| Setup/carga inicial CSV | ❌ Incompleto | ✅ | ✅ | ✅ |
| Máximo de stock por área | ❌ | ✅ | ✅ | ✅ |
| Estabilidad de reactivo abierto | ❌ | ❌ | ❌ | ❌ |

---

## PARTE 4 — PLAN DE TRABAJO PRIORIZADO

### Criterio de priorización
- **P0** — Crítico: Error que afecta integridad de datos o produce resultados incorrectos
- **P1** — Alta: Falta funcionalidad esencial de un sistema de laboratorio
- **P2** — Media: Mejora importante para adopción y usabilidad
- **P3** — Baja: Nice-to-have / diferenciador de producto

---

### ETAPA 0 — Correcciones críticas de integridad (P0)
**Duración estimada: 2-3 días**

| # | Tarea | Migration |
|---|---|---|
| 0.1 | Agregar `UNIQUE(recepcion_id, solicitud_id, producto_id)` en `recepcion_reconciliacion` | 053 |
| 0.2 | Ampliar `configuracion_sistema.valor` a `TEXT` | 054 |
| 0.3 | Verificar y recrear vista `v_stock_por_producto_area` | 055 |
| 0.4 | Agregar `deleted_at TIMESTAMPTZ` a tablas con soft-delete | 056 |
| 0.5 | Corregir constraint `lotes` a `UNIQUE(producto_id, proveedor_id, numero_lote)` | 057 |

---

### ETAPA 1 — Mejoras de modelo de producto (P1)
**Duración estimada: 5-7 días**

#### 1.A — Tabla `producto_proveedor` (catálogo multi-proveedor)
**Migration 058**

```sql
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
    UNIQUE (producto_id, proveedor_id)
);

-- Migrar datos existentes
INSERT INTO producto_proveedor (producto_id, proveedor_id, es_principal, codigo_proveedor, precio_unidad, lead_time_dias)
SELECT id, proveedor_id, TRUE, codigo_proveedor, precio_unidad, lead_time_propio
FROM productos WHERE proveedor_id IS NOT NULL;

-- Índices
CREATE INDEX idx_prod_prov_producto ON producto_proveedor(producto_id);
CREATE INDEX idx_prod_prov_proveedor ON producto_proveedor(proveedor_id);
CREATE UNIQUE INDEX idx_prod_prov_principal ON producto_proveedor(producto_id) WHERE es_principal = TRUE;
```

**Backend afectado:**
- `handlers/productos.rs` — listar, crear, actualizar, detalle
- `services/producto_service.rs` — lógica de creación
- `dto/producto.rs` — `CreateProducto`, `UpdateProducto`, `ProductoDetalle`
- Regenerar `export_types`

**Frontend afectado:**
- `pages/creador-productos/productos-tab.tsx` — `EditProductoDialog`, `CreateProductoDialog`
- Sección de proveedor se convierte en lista de proveedores con uno marcado como principal

#### 1.B — Atributos de almacenamiento de reactivos
**Migration 059**

```sql
ALTER TABLE productos
    ADD COLUMN temperatura_almacenamiento VARCHAR(30)
        CHECK (temperatura_almacenamiento IN ('ambiente','refrigerado','congelado','ultra_frio','no_aplica')),
    ADD COLUMN requiere_cadena_frio BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN dias_estabilidad_abierto INT,
    ADD COLUMN unidad_minima_pedido DECIMAL(12,2),
    ADD COLUMN clase_riesgo VARCHAR(20)
        CHECK (clase_riesgo IN ('biologico','quimico','radiactivo','inflamable','corrosivo','ninguno'));
```

**Frontend afectado:**
- `CreateProductoDialog` y `EditProductoDialog` — nueva sección "Almacenamiento y Seguridad"
- Tabla de productos — icono de temperatura en la lista
- Alertas de stock — reactivos refrigerados próximos a vencer con urgencia elevada

#### 1.C — Stock mínimo y máximo por área
**Migration 060**

```sql
ALTER TABLE producto_area
    ADD COLUMN stock_minimo DECIMAL(12,2),  -- NULL = hereda del producto
    ADD COLUMN stock_maximo DECIMAL(12,2),
    ADD COLUMN punto_reorden DECIMAL(12,2);
```

**Backend afectado:**
- `handlers/stock.rs` — alertas leen `producto_area.stock_minimo` con fallback a `productos.stock_minimo`
- `handlers/areas.rs` — endpoint para configurar stock por área

**Frontend afectado:**
- `pages/creador-productos/areas-tab.tsx` — configuración de stock por producto en el área
- `pages/dashboard/` — alertas usan el umbral correcto por área

---

### ETAPA 2 — Formatos de presentación en servidor (P1)
**Duración estimada: 2 días**

**Migration 061:**
```sql
CREATE TABLE presentacion_formatos (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(50) NOT NULL UNIQUE,
    nombre_plural VARCHAR(50) NOT NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    es_predefinido BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO presentacion_formatos (nombre, nombre_plural, es_predefinido) VALUES
    ('Botella', 'Botellas', TRUE), ('Caja', 'Cajas', TRUE),
    ('Frasco', 'Frascos', TRUE), ('Lata', 'Latas', TRUE),
    ('Sobre', 'Sobres', TRUE), ('Tubo', 'Tubos', TRUE),
    ('Jeringa', 'Jeringas', TRUE), ('Ampolla', 'Ampollas', TRUE),
    ('Unidad', 'Unidades', TRUE), ('Kit', 'Kits', TRUE);
```

**Backend:** Nuevo handler `handlers/presentacion_formatos.rs`
- `GET /presentacion-formatos`
- `POST /presentacion-formatos` (admin)
- `DELETE /presentacion-formatos/{id}` (admin)

**Frontend:** Reemplazar `PresentacionesFormatosTab` — eliminar localStorage, usar React Query.

---

### ETAPA 3 — Almacenamiento de imágenes en filesystem (P1)
**Duración estimada: 3 días**

**Migration 062:**
```sql
ALTER TABLE productos RENAME COLUMN imagen_url TO imagen_path;
UPDATE productos SET imagen_path = NULL WHERE imagen_path LIKE 'data:%';
```

**Backend:**
- `handlers/uploads.rs` — guardar archivo en `./uploads/productos/<uuid>.<ext>`, retornar path
- Modificar `PUT /productos/{id}/imagen` para recibir `multipart/form-data`
- `GET /uploads/<path>` para serving estático en Axum

**Frontend:**
- `EditProductoDialog` — `<input type="file">` en lugar de base64
- `<img src={`/uploads/${product.imagen_path}`} />`

---

### ETAPA 4 — Historial de precios (P2)
**Duración estimada: 2 días**

**Migration 063:**
```sql
CREATE TABLE producto_precio_historial (
    id BIGSERIAL PRIMARY KEY,
    producto_id UUID NOT NULL REFERENCES productos(id),
    proveedor_id INT REFERENCES proveedores(id),
    precio_unidad DECIMAL(12,4) NOT NULL,
    presentacion_id INT REFERENCES presentaciones(id),
    precio_presentacion DECIMAL(12,4),
    vigente_desde DATE NOT NULL DEFAULT CURRENT_DATE,
    usuario_id UUID NOT NULL REFERENCES usuarios(id),
    fuente VARCHAR(20) DEFAULT 'manual'
        CHECK (fuente IN ('manual','recepcion','solicitud')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_precio_hist_producto ON producto_precio_historial(producto_id, vigente_desde DESC);
```

---

### ETAPA 5 — Setup module / Carga inicial CSV (P1)
**Duración estimada: 4 días**

**Endpoint:** `POST /setup/importar-productos`

**Columnas CSV:**
```
nombre, descripcion, categoria, unidad_base, proveedor, codigo_proveedor,
stock_minimo, presentacion_nombre, factor_conversion, codigo_barras, area
```

**Lógica:**
1. Validar todas las filas antes de insertar ninguna (transacción atómica)
2. Auto-crear categorías/unidades si no existen
3. Generar `codigo_interno` automáticamente
4. Retornar reporte: `N productos creados, M errores` con detalle por fila

**Frontend — nueva página `pages/setup/`:**
- Paso 1: Subir CSV, preview de primeras 10 filas
- Paso 2: Mapear columnas
- Paso 3: Revisar errores de validación
- Paso 4: Confirmar importación

---

### ETAPA 6 — Mejoras de UX en Creador de Productos (P2)
**Duración estimada: 3 días**

| Mejora | Descripción |
|---|---|
| Duplicar producto | Botón "Copiar" — pre-rellena el diálogo con datos del producto seleccionado |
| Búsqueda full-text | `productos.search_vector TSVECTOR` sobre nombre+descripción+código |
| Ordenamiento de columnas | Click en cabeceras de tabla |
| Exportar a CSV | `GET /productos?format=csv` |
| Validación de código de barras | Al ingresar EAN-13, validar dígito de control |
| Vista tarjetas vs tabla | Toggle entre grid (con imagen) y tabla |

---

### ETAPA 7 — Soporte GS1 básico (P3)
**Duración estimada: 3 días**

**Migration 064:**
```sql
ALTER TABLE presentaciones
    ADD COLUMN gtin VARCHAR(14),
    ADD COLUMN gs1_habilitado BOOLEAN NOT NULL DEFAULT FALSE;

CREATE UNIQUE INDEX idx_presentaciones_gtin ON presentaciones(gtin) WHERE gtin IS NOT NULL;
```

Al escanear en recepción, si el código es GS1-128, parsear Application Identifiers:
- `(01)` → GTIN
- `(10)` → Número de lote
- `(17)` → Fecha de vencimiento

---

## RESUMEN GENERAL

```
ETAPA 0 — Integridad crítica            2-3 días   Migrations 053-057
ETAPA 1 — Modelo de producto            5-7 días   Migrations 058-060
ETAPA 2 — Formatos en servidor          2 días     Migration 061
ETAPA 3 — Imágenes en filesystem        3 días     Migration 062
ETAPA 4 — Historial de precios          2 días     Migration 063
ETAPA 5 — Setup / importación CSV       4 días     Sin nueva migration
ETAPA 6 — UX Creador de Productos       3 días     Sin migrations
ETAPA 7 — Soporte GS1                   3 días     Migration 064
─────────────────────────────────────────────────
TOTAL ESTIMADO                         24-27 días
```

## IMPACTO EN EL SISTEMA COMPLETO POR ETAPA

| Etapa | Módulos frontend afectados | Handlers backend afectados |
|---|---|---|
| 0 — Integridad | Ninguno (invisible al usuario) | `recepciones`, `configuracion` |
| 1.A — Multi-proveedor | `creador-productos`, `solicitudes-compra` | `productos`, `solicitudes_compra`, `proveedores` |
| 1.B — Almacenamiento | `creador-productos`, `dashboard`, `stock` | `productos`, `stock` |
| 1.C — Stock por área | `creador-productos/areas`, `dashboard` | `stock`, `areas` |
| 2 — Formatos | `creador-productos/presentaciones` | Nuevo handler |
| 3 — Imágenes | `creador-productos/productos` | `productos`, nuevo `uploads` |
| 4 — Precios | `creador-productos/productos` | `productos` |
| 5 — Setup CSV | Nueva página `setup` | `setup` handler (completar) |
| 6 — UX | `creador-productos` | `productos` (añadir ordenamiento, export) |
| 7 — GS1 | `recepciones` (escáner) | `recepciones`, `lotes` |
