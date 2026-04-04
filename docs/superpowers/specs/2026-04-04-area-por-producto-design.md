# Diseño: Área y Ubicación por Producto

**Fecha:** 2026-04-04  
**Branch:** feat/solicitudes-compra-redesign (continúa en mismo branch o nuevo)  
**Estado:** Aprobado

---

## Problema

El sistema actual trata el área como un **filtro de sesión global**: el usuario selecciona un área en el header o en cada formulario, y eso pre-rellena los flujos operativos. Esto genera fricción innecesaria porque en este laboratorio cada producto tiene un destino físico fijo — un reactivo de hematología siempre va a Hematología, no a Bioquímica.

Además, no existe un campo para indicar el **lugar físico exacto de almacenamiento** (ej: "Refrigerador 2", "Armario B estante 3"), lo que obliga a los técnicos a memorizar o preguntar dónde guardar cada insumo.

---

## Solución

Dos cambios complementarios:

1. **Área como atributo del producto**: el área deja de ser un filtro de sesión y pasa a ser un dato del catálogo. Los flujos operativos (recepciones, consumos) leen el área directamente del producto.
2. **Nuevo campo `ubicacion`**: texto libre que indica el lugar físico de almacenamiento. Informacional — el sistema lo muestra pero no razona con él.

---

## Modelo de datos

### Campo `ubicacion` en `productos`

Nueva migración:
```sql
ALTER TABLE productos ADD COLUMN ubicacion VARCHAR(200);
```

Nullable, texto libre. Ejemplos de valores: `"Refrigerador 2"`, `"Armario B, estante 3"`, `"Congelador -20°C, bandeja superior"`.

### Área (sin cambio de schema)

La relación `producto_area` ya existe (tabla m:m). El backend ya devuelve `area: { id, nombre }` en el endpoint de productos usando el primer área asignada. **No se agrega ninguna columna nueva para área** — se formaliza el uso del dato existente.

---

## Cambios por módulo

### 1. Migración DB — `034_ubicacion_producto.sql`

```sql
ALTER TABLE productos ADD COLUMN ubicacion VARCHAR(200);
```

### 2. Backend

**`dto/producto.rs`**
- `CreateProducto`: agregar campo `ubicacion: Option<String>`
- `UpdateProducto`: agregar campo `ubicacion: Option<String>`

**`handlers/productos.rs`**
- Incluir `ubicacion` en INSERT y UPDATE
- Incluir `ubicacion` en el SELECT del detalle de producto (`GET /productos/:id`)

**`bin/export_types.rs`**
- Regenerar `CreateProducto` y `UpdateProducto` para incluir `ubicacion`

### 3. Frontend — Creador de Productos (`productos-tab.tsx`)

**Sección Área — cambios:**
- Label: `"Área de almacenamiento"` → cambia a `"Área"`
- Subtexto bajo el label: `"Sección del laboratorio donde este producto pertenece, se usa y debe estar almacenado"`
- El `<select>` de área pasa a ser **obligatorio**: sin opción vacía, el formulario no avanza si no hay área seleccionada
- La validación ya existe (`if (!form.area_id) { toast.error(...) }`); se refuerza visualmente con `select-error` si se intenta guardar sin área
- **Aplica tanto en creación como en edición**: un producto existente sin área puede editarse y guardarse solo si se asigna un área

**Nuevo campo Ubicación:**
- Label: `"Ubicación de almacenamiento"`
- Subtexto: `"Lugar físico exacto: refrigerador, armario, estante"`
- Input de texto libre, **opcional**
- Placeholder: `"Ej: Refrigerador 2, estante superior"`
- Posición: inmediatamente debajo del campo Área

### 4. Frontend — Recepciones (`recepciones/nueva.tsx`)

**Paso 1 (General):**
- Eliminar el campo `"Área Sugerida"` y el estado `areaGlobalId`

**Paso 2 (Ítems) — por línea:**
- Reemplazar el `<select>` de área por un badge de solo lectura: `<Badge>{d.area_destino_nombre}</Badge>`
- En `addProductoDirecto`: `finalAreaId = fullProd.areas?.[0]?.id` (ya calculado, solo se elimina el fallback a `areaGlobalId`)

**Edge case — producto sin área:**
- Si `fullProd.areas?.[0]` es `undefined` al agregar el producto, mostrar un `<select>` compacto inline con label `⚠ Asignar área` en estilo warning
- Al seleccionar un área en ese inline picker, hacer `PATCH /productos/:id` con `{ area_ids: [areaId] }` inmediatamente (silent save)
- Una vez asignada, el select se reemplaza por el badge normal
- La confirmación de la recepción bloquea si alguna línea aún tiene área pendiente (`area_destino_id === null`)

### 5. Frontend — Consumos (`consumos/index.tsx`)

- Eliminar el `<select>` de filtro de área del header
- Eliminar el estado `areaId` y la query de `areas`
- La query de stock pasa a buscar sin `area_id` en params (muestra todo el stock accesible)
- El badge `{p.area_nombre}` en cada tarjeta se mantiene — es la referencia visual del área del producto
- En `handleScan`: eliminar la lógica de preferencia por `areaId`; simplemente usar `items[0]`

---

## Lo que NO cambia

- **Stock**: el filtro de área en la vista de stock queda como filtro de consulta opcional. No es operativo.
- **Conteo**: las sesiones son por área intencionalmente. Sin cambio.
- **Movimientos / Lotes**: sin cambio.
- **`useAreaStore`**: se mantiene tal cual — Stock lo usa como filtro de consulta opcional. No se modifica.

---

## Flujo resultante (happy path)

**Recepción:**
1. Usuario selecciona proveedor → paso 2
2. Escanea o busca producto → se agrega con área pre-llenada desde catálogo
3. Completa lote, vencimiento, cantidad → confirma
4. Sin selección de área en ningún momento

**Consumo:**
1. Usuario busca o escanea producto
2. Tarjeta muestra stock + área del producto
3. Agrega al carrito → confirma
4. Sin selección de área en ningún momento

---

## Criterios de aceptación

- [ ] Un producto sin área no puede guardarse desde el creador de productos
- [ ] El campo `ubicacion` se guarda y se muestra correctamente en el formulario de edición
- [ ] En recepciones, al agregar un producto con área asignada, el área aparece como badge (no select)
- [ ] En recepciones, al agregar un producto sin área, aparece el inline picker y el PATCH se ejecuta al seleccionar
- [ ] En consumos, no existe selector de área en el header
- [ ] Los consumos se registran correctamente con el `area_id` proveniente del stock item (no de un estado global)
- [ ] Los tipos TypeScript generados incluyen `ubicacion` en `CreateProducto` y `UpdateProducto`
