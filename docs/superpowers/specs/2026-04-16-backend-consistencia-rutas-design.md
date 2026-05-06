# Backend — Consistencia de Rutas de Presentaciones — Spec de Diseño

**Fecha:** 2026-04-16
**Prioridad:** Baja
**Estado:** Propuesto

---

## Problema

En `backend/src/routes.rs` coexisten:

```
GET    /productos/{producto_id}/presentaciones
POST   /productos/{producto_id}/presentaciones
GET    /presentaciones
PUT    /presentaciones/{id}
DELETE /presentaciones/{id}
```

Ambas familias existen sin criterio documentado. Un desarrollador nuevo no sabe cuál usar ni por qué están ambas. El frontend usa mezcla de ambas.

## Objetivo

Una única convención para acceder a presentaciones, documentada y usada consistentemente desde el frontend.

## Alcance

**Incluido:**
- Definir la convención.
- Eliminar o refactorizar las rutas redundantes.
- Actualizar llamadas del frontend.

**Fuera de alcance:**
- Cambiar el modelo de datos de presentaciones.
- Cambiar otros recursos con ambigüedad similar (evaluar en specs propios).

## Diseño propuesto

### Convención propuesta

**Operaciones anidadas bajo el producto** cuando la relación con el producto es intrínseca:
- `GET /productos/{producto_id}/presentaciones` → listar las presentaciones de un producto
- `POST /productos/{producto_id}/presentaciones` → crear una nueva para ese producto

**Operaciones sobre una presentación específica** (por su propio ID) cuando la presentación ya es conocida:
- `GET /presentaciones/{id}` → detalle de una presentación (si se necesita fuera del contexto de su producto)
- `PUT /presentaciones/{id}` → editar
- `DELETE /presentaciones/{id}` → eliminar

**Eliminar:**
- `GET /presentaciones` (listado global) → no se justifica; siempre se listan en contexto de producto. Si algún caller lo usa, migrar a filtro (`/presentaciones?producto_id=...`) o listado bajo producto.

### Criterio general (para casos similares)

- Listado + creación: **anidado bajo el recurso padre**.
- Edición/eliminación por ID: **endpoint plano por ID**.
- Listados globales: solo si hay un caso de uso real (ej: búsqueda cross-producto).

### Cambios en código

**Backend:**
- Verificar usos de `GET /presentaciones` (listado global) antes de eliminar. Si hay callers, migrar.
- Mantener `PUT`/`DELETE /presentaciones/{id}` (es el patrón correcto).

**Frontend:**
- Reemplazar cualquier `api.get('/presentaciones')` por `api.get(\`/productos/${id}/presentaciones\`)`.

## Archivos afectados

**Backend:**
- `backend/src/routes.rs` (eliminar ruta redundante)
- `backend/src/handlers/presentaciones.rs` (eliminar handler de listado global si existe)

**Frontend:**
- Buscar `/presentaciones` en `frontend/src/` y migrar callers.

## Criterios de aceptación

- [ ] `GET /presentaciones` ya no existe en `routes.rs`.
- [ ] El frontend no llama a `/presentaciones` (grep vacío).
- [ ] El handler de presentaciones mantiene solo los endpoints con la convención acordada.
- [ ] Los tests pasan (`cargo test`).
- [ ] El CHANGELOG (si existe) documenta la ruta eliminada.

## Preguntas abiertas

- ¿Hay otros endpoints con duplicación similar? Revisar: `/lotes`, `/productos`, `/areas`. → Evaluar en spec propio si aparecen casos; este spec se limita a presentaciones.
