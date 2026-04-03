# Spec: Rediseño Solicitudes de Compra
**Fecha:** 2026-04-03  
**Estado:** Aprobado por usuario

---

## 1. Contexto y objetivo

La página `/solicitudes-compra` existe pero le falta:
- Precios y total estimado con IVA
- Modo borrador real (editable hasta envío)
- Recomendaciones con urgencia dinámica según lead time del proveedor
- Presentaciones/formato como unidad de pedido
- Códigos de proveedor y bodega visibles

El objetivo es transformarla en una herramienta de reposición real que un tecnólogo chileno pueda usar para generar una orden de compra lista para enviar.

---

## 2. Decisiones de diseño

### 2.1 Origen de precios
- **Fuente primaria:** último `precio_unitario` pagado al proveedor (campo nuevo en `recepciones_detalle`)
- **Fuente secundaria:** el usuario lo escribe manualmente en la solicitud si no hay historial
- El precio es **por unidad de presentación** si existe, o **por unidad base** si no
- El precio almacenado en la solicitud es editable hasta que se envía

### 2.2 Modo borrador
- `POST /solicitudes-compra` crea siempre en estado `borrador`
- Solo un borrador activo por usuario a la vez
- `PUT /solicitudes-compra/:id` actualiza ítems del borrador
- `POST /solicitudes-compra/:id/enviar` transiciona `borrador → pendiente` (bloquea edición)
- Al entrar a la página: si hay un borrador activo se retoma automáticamente

### 2.3 Motor de recomendaciones — urgencia dinámica
Los umbrales son **relativos al `dias_despacho` del proveedor** (campo existente):

| Nivel | Condición | Color |
|-------|-----------|-------|
| 🔴 Crítico | `autonomia_dias < lead_time × 1.0` | rojo |
| 🟡 Urgente | `autonomia_dias < lead_time × 1.5` | amarillo |
| 🟢 Planificar | `autonomia_dias < lead_time × 2.5` | verde |

La `autonomia_dias` se calcula igual que hoy: `stock_actual / consumo_diario_30d`.  
Si `consumo_diario = 0` pero `stock < stock_minimo`, se clasifica como 🔴 Crítico de todos modos.

### 2.4 Layout — Panel dual
Dos columnas + tab de historial:
- **Panel izquierdo (Sugerencias):** lista de productos recomendados clasificados por urgencia, con botón "+ Agregar"
- **Panel derecho (Mi Pedido):** borrador en edición, agrupado por proveedor fijo, con tabla de ítems
- **Tab Historial:** tabla existente, sin cambios funcionales

### 2.5 IVA (Chile)
En el footer del panel derecho:
```
Subtotal neto:   $1.322.000
IVA 19%:           $251.180
Total con IVA:   $1.573.180
```
El total con IVA es **referencial** (no se almacena en BD, se calcula en cliente).

### 2.6 Proveedor fijo
- El proveedor de cada ítem proviene del producto (`productos.proveedor_id`)
- No es editable en la solicitud
- Se muestra como tag informativo

### 2.7 Mismo insumo, distintos proveedores = productos distintos
"Alcohol Walmart" y "Alcohol Superfix" son dos `productos` diferentes en el catálogo, con `proveedor_id` distintos. Nunca se fusionan. Aparecen como líneas separadas en grupos de proveedor distintos.

### 2.8 Unidades de pedido — presentaciones
| Caso | Campo cantidad | Label | Detalle |
|------|---------------|-------|---------|
| Sin presentación | unidad base | `lancetas` | — |
| Con presentación | unidades de presentación | `cajas` | `= 300 guantes (100/caja)` |

**Conversión de sugerencia del sistema:**
```
sin presentación:   cantidad_sugerida (en unidades base)
con presentación:   ceil(cantidad_sugerida / factor_conversion)
```
Siempre se redondea hacia arriba (no se puede pedir media caja).

### 2.9 Códigos en tabla y PDF
Cada ítem muestra:
- `codigo_proveedor` — código del producto en el catálogo del proveedor (azul)
- `codigo_maestro` — código interno de bodega del laboratorio (violeta)

Ambos existen en `productos` y ya los devuelve el backend en `SolicitudDetalleItem`.

---

## 3. Cambios en base de datos

### Migración 028 — precio en recepciones
```sql
ALTER TABLE recepcion_detalle
    ADD COLUMN precio_unitario DECIMAL(14,2);

COMMENT ON COLUMN recepcion_detalle.precio_unitario 
    IS 'Precio neto pagado por unidad (base o presentación) en esta recepción';
```

### Migración 029 — campos nuevos en solicitud_compra_detalle
```sql
ALTER TABLE solicitud_compra_detalle
    ADD COLUMN precio_unitario   DECIMAL(14,2),
    ADD COLUMN presentacion_id   INTEGER REFERENCES presentaciones(id),
    ADD COLUMN cantidad_presentaciones DECIMAL(12,2);

COMMENT ON COLUMN solicitud_compra_detalle.precio_unitario 
    IS 'Precio neto por unidad de presentación (o base si no hay presentación)';
COMMENT ON COLUMN solicitud_compra_detalle.presentacion_id 
    IS 'Presentación usada para expresar la cantidad (NULL = se pide en unidad base)';
COMMENT ON COLUMN solicitud_compra_detalle.cantidad_presentaciones 
    IS 'Cantidad en unidades de presentación (NULL si no hay presentación)';
```

### Migración 030 — estado borrador en solicitudes
```sql
ALTER TABLE solicitudes_compra DROP CONSTRAINT solicitudes_compra_estado_check;

ALTER TABLE solicitudes_compra
    ADD CONSTRAINT solicitudes_compra_estado_check
    CHECK (estado IN ('borrador', 'pendiente', 'aprobada', 'rechazada', 'enviada', 'completada', 'cancelada'));
```

---

## 4. Cambios en el backend

### 4.1 Recepciones — nuevo campo precio
- `POST /recepciones` y la creación de detalles aceptan `precio_unitario` opcional por línea
- El handler guarda el valor en `recepciones_detalle.precio_unitario`

### 4.2 Nuevos endpoints Solicitudes de Compra

#### `GET /solicitudes-compra/borrador`
Devuelve el borrador activo del usuario autenticado o `null`.
```json
{ "borrador": { "id": "...", "items": [...] } | null }
```

#### `POST /solicitudes-compra` (modificado)
Ahora crea siempre en estado `borrador`. Si el usuario ya tiene un borrador activo, devuelve 409 con `{ "id": "<borrador_id>", "code": "BORRADOR_EXISTENTE" }` para que el frontend lo retome.

#### `PUT /solicitudes-compra/:id`
Reemplaza los ítems del borrador. Solo funciona si `estado = 'borrador'` y el usuario es el dueño.

#### `POST /solicitudes-compra/:id/enviar`
Transiciona `borrador → pendiente`. Valida que haya al menos un ítem.

#### `GET /solicitudes-compra/recomendaciones`
Nuevo endpoint. Devuelve productos clasificados por urgencia, con precio de última recepción.

```rust
struct ItemRecomendado {
    producto_id: Uuid,
    producto_nombre: String,
    codigo_proveedor: Option<String>,
    codigo_maestro: Option<String>,
    proveedor_id: Option<i32>,
    proveedor_nombre: Option<String>,
    dias_despacho: i32,          // lead time del proveedor
    autonomia_dias: Option<f64>, // stock_actual / consumo_diario_30d
    nivel_urgencia: String,      // "critico" | "urgente" | "planificar"
    stock_actual: Decimal,
    stock_minimo: Decimal,
    consumo_diario_30d: Decimal,
    cantidad_sugerida_base: Decimal,  // en unidades base
    // presentación preferida
    presentacion_id: Option<i32>,
    presentacion_nombre: Option<String>,
    presentacion_nombre_plural: Option<String>,
    factor_conversion: Option<Decimal>,
    cantidad_sugerida_presentacion: Option<Decimal>, // ceil(base / factor)
    // precio
    precio_ultima_recepcion: Option<Decimal>,
    unidad_base: String,
    unidad_base_plural: Option<String>,
}
```

**Lógica de clasificación:**
```sql
-- Obtener lead_time del proveedor (default 7 si NULL)
-- autonomia = stock_actual / consumo_diario (NULL si consumo = 0)
-- nivel:
--   consumo=0 AND stock < minimo → critico
--   autonomia < lead_time * 1.0  → critico
--   autonomia < lead_time * 1.5  → urgente
--   autonomia < lead_time * 2.5  → planificar
--   else                         → no incluir
```

**Precio de última recepción** — subconsulta:
```sql
SELECT rd.precio_unitario
FROM recepcion_detalle rd
JOIN recepciones r ON r.id = rd.recepcion_id
WHERE rd.producto_id = p.id
  AND rd.precio_unitario IS NOT NULL
  AND r.estado IN ('completa', 'parcial')
ORDER BY r.fecha_recepcion DESC
LIMIT 1
```

### 4.3 SolicitudDetalleItem (modificado)
Agrega campos:
```rust
pub precio_unitario: Option<Decimal>,
pub presentacion_id: Option<i32>,
pub presentacion_nombre: Option<String>,
pub presentacion_nombre_plural: Option<String>,
pub factor_conversion: Option<Decimal>,
pub cantidad_presentaciones: Option<Decimal>,
```

---

## 5. Cambios en el frontend

### 5.1 Archivo principal
`frontend/src/pages/solicitudes-compra/index.tsx` — reescritura completa.

### 5.2 Layout
```
┌─────────────────────────────────────────────────────┐
│  Header: Solicitudes de Compra | [Recomendaciones] [Historial] │
├───────────────────┬─────────────────────────────────┤
│  Panel Izquierdo  │  Panel Derecho                  │
│  💡 Sugerencias   │  🛒 Mi Pedido (borrador)         │
│                   │                                  │
│  🔴 Crítico (N)   │  [buscador manual]               │
│  [items...]       │                                  │
│                   │  ┌── Proveedor A ──────────┐    │
│  🟡 Urgente (N)   │  │ tabla: producto, cód,   │    │
│  [items...]       │  │ cant, precio, total     │    │
│                   │  └─────────────────────────┘    │
│  🟢 Planificar (N)│                                  │
│  [items...]       │  subtotal / IVA 19% / total     │
│                   │  [notas]                         │
│                   │  [💾 Borrador] [✉️ Enviar]      │
└───────────────────┴─────────────────────────────────┘
```

### 5.3 Estado del componente
```typescript
interface SolicitudItem {
  producto_id: string
  producto_nombre: string
  codigo_proveedor: string | null
  codigo_maestro: string | null
  proveedor_id: number | null
  proveedor_nombre: string
  dias_despacho: number
  // presentación
  presentacion_id: number | null
  presentacion_nombre: string | null
  presentacion_nombre_plural: string | null
  factor_conversion: number | null
  // unidad base
  unidad_base: string
  unidad_base_plural: string | null
  // cantidades
  cantidad: number          // en unidades de presentación si hay, o base
  // precio
  precio_unitario: number   // por unidad de presentación o base
}
```

### 5.4 Lógica de display de unidades
```typescript
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

function equivalenciaBase(item: SolicitudItem): string | null {
  if (!item.presentacion_id || !item.factor_conversion) return null
  const base = item.cantidad * item.factor_conversion
  const u = base === 1 ? item.unidad_base : (item.unidad_base_plural ?? autoPlural(item.unidad_base))
  return `= ${base} ${u} (${item.factor_conversion}/${item.presentacion_nombre})`
}
```

### 5.5 Cálculo IVA (cliente)
```typescript
const subtotalNeto = items.reduce((s, i) => s + i.cantidad * i.precio_unitario, 0)
const iva = Math.round(subtotalNeto * 0.19)
const totalConIva = subtotalNeto + iva
```

### 5.6 Flujo de borrador
1. Al montar: `GET /solicitudes-compra/borrador` → si existe, carga ítems en estado local
2. "Guardar borrador": si no existe → `POST /solicitudes-compra` (crea borrador), si existe → `PUT /solicitudes-compra/:id`
3. "Enviar a aprobación": `POST /solicitudes-compra/:id/enviar` → va a tab historial

### 5.7 PDF export (mejorado)
El PDF incluye por proveedor:
- Columnas: Cód. Prov. | Cód. Bodega | Descripción | Cant. (con equivalencia base) | P. Unitario neto | Total neto
- Subtotal neto por proveedor
- Al final: Subtotal neto total + IVA 19% + **Total con IVA**

---

## 6. Pre-requisitos antes de implementar

En orden de dependencia:

1. **Migración 028** — `precio_unitario` en `recepciones_detalle`
2. **Actualizar handler recepciones** — aceptar y guardar `precio_unitario`
3. **Migración 029** — campos nuevos en `solicitud_compra_detalle`
4. **Migración 030** — estado `borrador`
5. **Backend solicitudes** — nuevos endpoints + lógica de recomendaciones
6. **Frontend** — rediseño completo de la página

---

## 7. Lo que NO cambia

- Flujo de aprobación admin (pendiente → aprobada/rechazada via `/revisar`)
- Linkage recepción → solicitud (`recepciones.solicitud_id`)
- Estados posteriores: enviada, completada, cancelada
- Permisos: cualquier usuario autenticado puede crear solicitudes; solo admin puede revisar
- Tabla de historial (sin cambios funcionales, solo mejoras de display)
