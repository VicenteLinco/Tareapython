# Spec: Precio de insumos + Mejoras Creador de Productos

**Fecha:** 2026-04-01
**Estado:** Aprobado por usuario

---

## Contexto y motivación

Las solicitudes de compra necesitan precio unitario y precio por presentación para que los pedidos al proveedor sean completos. El problema es que:

1. Algunos insumos se compran por **unidad base** (guantes, tiras reactivas sueltas).
2. Otros se compran por **presentación** (cajas × N unidades).
3. Los **precios cambian frecuentemente** — una cotización de hace 3 meses puede estar desfasada.

La solución debe ser simple (mínimos campos en BD) y trazable (los pedidos reflejan el precio real al momento de crearlos).

---

## Principio de diseño de precios

**Un solo precio de referencia almacenado: `precio_unidad` en `productos`.**

Toda la lógica de precio deriva de ahí:

```
precio_por_presentación = precio_unidad × factor_conversion
```

La UI permite ingresar el precio por cualquiera de los dos lados; el sistema siempre guarda la unidad base con 4 decimales de precisión.

El precio en la recepción registra el precio real pagado por lote, y opcionalmente actualiza el precio de referencia del producto.

---

## Cambios de base de datos

### Migración 028: precio_unidad en productos

```sql
ALTER TABLE productos ADD COLUMN precio_unidad DECIMAL(12,4);
-- NULL significa sin precio definido
```

### Migración 029: precio_unitario en lotes

```sql
ALTER TABLE lotes ADD COLUMN precio_unitario DECIMAL(12,4);
-- Precio real pagado por unidad base al recibir este lote
-- NULL si no se registró precio en la recepción
```

**No se agrega ningún campo a `presentaciones`** — el precio de presentación siempre es calculado.

---

## Cambios en backend (Rust)

### 1. Modelo `Producto`

Agregar campo al struct y a todas las queries de INSERT/UPDATE/SELECT:
```rust
pub precio_unidad: Option<Decimal>,
```

### 2. Modelo `Lote`

```rust
pub precio_unitario: Option<Decimal>,
```

### 3. `producto_service.rs`

- `crear_producto`: aceptar y persistir `precio_unidad`
- `actualizar_producto`: aceptar y persistir `precio_unidad`
- `obtener_detalle`: incluir `precio_unidad` en JSON
- Query de lista (`listar`): incluir `precio_unidad`

### 4. `handlers/productos.rs`

- `CreateProducto` DTO: agregar `precio_unidad: Option<Decimal>`
- `UpdateProducto` DTO: agregar `precio_unidad: Option<Decimal>`

### 5. `handlers/recepciones.rs`

- `CreateLoteInline` DTO: agregar `precio_unitario: Option<Decimal>`
- Al insertar el lote: persistir `precio_unitario`
- Nueva acción opcional al confirmar recepción: si algún ítem tiene `precio_unitario`, actualizar `productos.precio_unidad` con ese valor (UPDATE solo si el lote es el más reciente)

### 6. `handlers/lotes.rs` (endpoint de detalle)

- Incluir `precio_unitario` en respuestas

---

## Cambios en frontend (TypeScript + React)

### 1. Tipos (`src/types/index.ts`)

```typescript
// Actualizar
export interface Producto {
  ...
  precio_unidad: string | null   // Decimal viene como string desde Rust
}

// Actualizar
export interface CreateProducto {
  ...
  precio_unidad?: number
}

export interface UpdateProducto {
  ...
  precio_unidad?: number
}

// Actualizar
export interface Lote {
  ...
  precio_unitario: string | null
}
```

### 2. `Dialog` component — fix de renderizado

**Bug actual:** El componente `Dialog` renderiza sus `children` siempre, incluso con `open={false}`. Esto monta los 5 tabs de catálogo (CategoriasTab, UnidadesTab, AreasTab, ProveedoresTab, PresentacionesFormatosTab) al cargar la página, disparando 5+ queries innecesarias y potencialmente causando el crash.

**Fix:**
```tsx
// En dialog.tsx — renderizar children solo cuando está abierto
{open && children}
// o con un wrapper para mantener el DOM:
{(open || wasOpenRef.current) && children}
```

Se elige la variante simple `{open && children}` — los tabs se desmontan al cerrar, lo cual es aceptable porque su estado se resetea igualmente al reabrirse.

### 3. `CreateProductoDialog` — campos de precio

Agregar al estado del formulario:
```typescript
precio_unidad: '',      // precio por unidad base (lo que se guarda)
precio_pres: '',        // precio por presentación (campo auxiliar, calculado)
```

UI en la sección **Presentación** (cuando hay presentación seleccionada):

```
┌──────────────────────────────────────────────┐
│ Precio por [unidad_base]   Precio por [pres] │
│ [$ _________ ]      ←→    [$ _________ ]    │
│  ↑ lo que se guarda        ↑ campo auxiliar  │
│                              = unidad × factor│
└──────────────────────────────────────────────┘
```

Cuando **no hay** presentación (solo unidad base):

```
┌──────────────────────┐
│ Precio por [unidad]  │
│ [$ _________ ]       │
└──────────────────────┘
```

Lógica de vinculación:
- Usuario edita `precio_unidad` → `precio_pres = precio_unidad × factor`
- Usuario edita `precio_pres` → `precio_unidad = precio_pres / factor`
- Solo `precio_unidad` se envía al backend

Agregar campo `precio_unidad` al estado de form:
```typescript
const [form, setForm] = useState({
  ...campos actuales...,
  precio_unidad: '',
})
```

### 4. `EditProductoDialog` — campos de precio

Misma lógica que Create. En el `useEffect` que pre-popula el form:
```typescript
precio_unidad: producto.precio_unidad ? String(producto.precio_unidad) : '',
```

### 5. `ProductoDetail` panel — mostrar precio

```
Precio unitario:   $50.0000 / tubo
Precio por caja:   $5,000.00  (× 100 tubos)   ← solo si tiene presentación
```

### 6. `CreateProductoDialog` — agregar `stock_minimo`

Actualmente el formulario de creación no tiene campo `stock_minimo` pero el de edición sí. Se agrega en la sección Identificación:

```typescript
stock_minimo: '0',
```

Con input number en el form (igual que en EditProductoDialog).

### 7. Recepciones — campo de precio por ítem

En la pantalla de nueva recepción (`recepciones/nueva.tsx`), cada línea de ítem agrega:

```
Precio por [presentación o unidad]:  [$ _________ ]
                                      opcional
```

Al confirmar la recepción: el sistema actualiza `productos.precio_unidad` con el precio registrado (si se ingresó) — con prompt al usuario: **"¿Actualizar precio de referencia en catálogo?"** (checkbox, por defecto activado).

---

## Flujo completo de precios

```
[Creador de Productos]
  Ingresa precio_unidad de referencia
         ↓
[Solicitudes de Compra]  (fase futura)
  Lee precio_unidad × factor → precio sugerido por presentación
  Editable antes de enviar
         ↓
[Recepción confirmada]
  Registra precio_unitario en el lote
  Pregunta: "¿Actualizar precio de referencia?" → actualiza productos.precio_unidad
         ↓
[Próxima Solicitud de Compra]
  Precio actualizado refleja último precio pagado
```

---

## Errores y mejoras adicionales identificadas en Creador de Productos

### Bug crítico: crash en `/creador-productos`

**Síntoma:** La página muestra el ErrorBoundary ("Algo salió mal").
**Causa probable:** El `Dialog` renderiza sus children incondicionalmente. Los 5 tabs de catálogo se montan al cargar la página, causando renders concurrentes complejos. El fix del Dialog (sección 2 arriba) debería resolverlo.
**Verificación:** Después del fix, si el crash persiste, revisar la consola del navegador para el mensaje exacto del ErrorBoundary (visible en dev mode).

### Mejora: `import AuditLogPage` fuera de lugar en `App.tsx`

El import en la línea 35 (después de `const queryClient = ...`) es mala práctica aunque ES modules lo soporten. Mover al bloque de imports al inicio del archivo.

### Bug menor: `stock_minimo` ausente en crear producto

El formulario de creación no tiene campo `stock_minimo` pero la lógica de alertas lo necesita desde el primer momento.

### Mejora: Presentaciones en el panel de detalle no muestran precio

El panel lateral `ProductoDetail` muestra las presentaciones con solo `x{factor}` sin precio. Se actualiza para mostrar precio calculado.

---

## Archivos a modificar

### Backend
| Archivo | Cambio |
|---------|--------|
| `backend/migrations/028_precio_unidad.sql` | NUEVO — ADD COLUMN precio_unidad |
| `backend/migrations/029_precio_unitario_lotes.sql` | NUEVO — ADD COLUMN precio_unitario |
| `backend/src/models/producto.rs` | +precio_unidad |
| `backend/src/models/lote.rs` | +precio_unitario |
| `backend/src/services/producto_service.rs` | queries CREATE/UPDATE/SELECT/JSON |
| `backend/src/handlers/productos.rs` | DTOs Create/Update |
| `backend/src/handlers/recepciones.rs` | DTO CreateLoteInline + lógica actualizar precio |
| `backend/src/handlers/lotes.rs` | incluir precio_unitario en respuestas |

### Frontend
| Archivo | Cambio |
|---------|--------|
| `frontend/src/types/index.ts` | Producto, CreateProducto, UpdateProducto, Lote |
| `frontend/src/components/ui/dialog.tsx` | fix: lazy children |
| `frontend/src/pages/creador-productos/productos-tab.tsx` | precio_unidad en create+edit+detail, stock_minimo en create |
| `frontend/src/pages/recepciones/nueva.tsx` | precio_unitario por ítem |
| `frontend/src/App.tsx` | mover import AuditLogPage al inicio |

---

## Fuera de alcance

- Precio en solicitudes de compra (depende de la implementación de solicitudes)
- Múltiples precios por proveedor
- Historial completo de precios (tabla dedicada)
- Valorización de inventario (cálculo de stock total en dinero)
