# Imágenes de Productos — Diseño

**Fecha:** 2026-04-04  
**Estado:** Aprobado por usuario

---

## Resumen

Agregar soporte de imágenes opcionales a los productos del catálogo. Las imágenes se comprimen en el navegador antes del upload, se almacenan en disco (misma infraestructura que las fotos de recepciones), y se muestran como miniatura en todas las vistas relevantes del sistema. Los productos sin imagen siguen mostrando el ícono genérico de caja — sin regresión.

---

## Decisiones clave

| Decisión | Elección |
|---|---|
| ¿Dónde se sube? | Solo desde el editor de productos (tab productos) |
| ¿Quién puede subir? | Cualquier usuario activo |
| ¿Dónde se comprime? | En el navegador (canvas API), antes del upload |
| ¿Dónde se almacena? | Disco — via `storage.rs` existente |
| ¿Formato de salida? | JPEG, 400×400px máx, calidad 80% (~30–50 KB) |

---

## Modelo de datos

### Migración nueva: `017_imagen_productos.sql`

```sql
ALTER TABLE productos ADD COLUMN imagen_url TEXT;
```

El campo es nullable. `NULL` significa sin imagen — el frontend cae en el fallback del ícono.

### Tipos generados

Ejecutar `cargo run --bin export_types` después de la migración para que `Producto` incluya `imagen_url: string | null` en `generated.ts`.

---

## Backend

### Endpoint nuevo: `PUT /api/v1/productos/:id/imagen`

**Request body:**
```json
{ "data_url": "data:image/jpeg;base64,..." }
```

**Lógica:**
1. Verificar que el producto existe.
2. Si ya tiene `imagen_url`, eliminar el archivo anterior con `storage::delete_image`.
3. Llamar a `storage::save_base64_image(data_url, "productos", &id.to_string())`.
4. Actualizar `productos SET imagen_url = $path WHERE id = $id`.
5. Retornar `{ "imagen_url": "/api/v1/uploads/productos/..." }`.

**Endpoint borrado: `DELETE /api/v1/productos/:id/imagen`**

1. Si tiene `imagen_url`, llamar a `storage::delete_image`.
2. `UPDATE productos SET imagen_url = NULL WHERE id = $id`.
3. Retornar `{ "ok": true }`.

### Ruta agregada en `handlers/productos.rs`

```rust
.route("/{id}/imagen", put(subir_imagen).delete(quitar_imagen))
```

---

## Frontend

### Compresión en navegador

Función `comprimirImagen(file: File): Promise<string>` en `lib/image-utils.ts`:

1. Leer el archivo con `FileReader`.
2. Dibujar en `<canvas>` redimensionando a máximo 400×400px (manteniendo proporción).
3. Exportar con `canvas.toBlob('image/jpeg', 0.80)`.
4. Convertir a data URL base64.
5. Rechazar si el archivo original no es imagen (MIME check).

### Componente `ProductoImage`

Nuevo componente `components/ui/producto-image.tsx`:

```tsx
<ProductoImage
  src={producto.imagen_url}   // null → muestra fallback
  size="sm" | "md" | "lg"    // 28px / 40px / 72px
  className?
/>
```

- Si `src` está definido: renderiza `<img src={getImageUrl(src)} ... />` con `onError` que cae al fallback.
- Fallback: ícono `<Package>` de lucide-react (actual comportamiento).
- Clases de tamaño: `sm=28px`, `md=40px`, `lg=72px`, border-radius proporcional.

### Upload UI en editor de productos

En `pages/creador-productos/productos-tab.tsx`, dentro del formulario de edición/creación del producto:

- Sección "Imagen del producto" con:
  - Preview cuadrado 80×80px mostrando la imagen actual (o dashed border si no hay).
  - Input `type="file" accept="image/jpeg,image/png"` oculto.
  - Botón "Cambiar foto" que abre el file picker → comprime → llama a `PUT /productos/:id/imagen`.
  - Botón "Quitar" (solo si hay imagen) que llama a `DELETE /productos/:id/imagen`.
- El upload es inmediato (no espera al guardado del formulario).
- Toast de éxito/error.
- Invalidar query `['productos-all']` y `['producto', id]` tras upload.

### Vistas que muestran `ProductoImage`

| Vista | Tamaño | Reemplaza |
|---|---|---|
| `consumos/index.tsx` | `md` (40px) | Ícono de caja genérico |
| `stock/index.tsx` (lista) | `sm` (28px) | Nada (añade columna visual) |
| `stock/stock-detail.tsx` | `md` (40px) | — |
| `recepciones/nueva.tsx` (sugerencia de scan) | `md` (40px) | — |
| `conteo/detalle.tsx` | `sm` (28px) | — |
| `pages/kiosk/index.tsx` (confirmación scan) | `lg` (72px) | — |
| `creador-productos/productos-tab.tsx` | 80px fijo | — (nuevo, con upload) |

---

## Manejo de errores

- Archivo no es imagen → rechazo en frontend antes del upload, toast de error.
- Archivo > 5MB antes de comprimir → toast de advertencia (la compresión normalmente lo reduce drásticamente, pero si el original es enorme se avisa).
- Error de red en upload → toast de error, la imagen anterior queda sin cambios.
- Imagen con `onError` en `<img>` → cae silenciosamente al ícono fallback (nunca muestra broken image).

---

## Fuera de alcance

- Múltiples imágenes por producto.
- Imágenes en resolución distinta por vista (una sola imagen para todos).
- CDN o almacenamiento en la nube.
- Detección de duplicados de imagen.
