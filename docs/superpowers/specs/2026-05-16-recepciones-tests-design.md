# Diseño: Tests de integración — Módulo Recepciones

**Fecha:** 2026-05-16  
**Alcance:** `backend/tests/recepciones_test.rs` + endpoints faltantes en `backend/src/handlers/recepciones.rs`

---

## Problema

El módulo de recepciones no tiene tests de integración. Adicionalmente, dos endpoints que el frontend ya consume no están implementados en el backend:

- `POST /api/v1/recepciones/{id}/confirmar` — el servicio `confirmar_borrador` existe pero no tiene handler ni ruta
- `DELETE /api/v1/recepciones/{id}` — ni servicio ni handler ni ruta

---

## Solución ✅ *Recomendada*

Enfoque **Opción A — Archivo único** `recepciones_test.rs`, consistente con el patrón del proyecto (`catalogos_test.rs`, `solicitudes_test.rs`). Primero se agregan los endpoints faltantes al handler, luego se escribe el archivo de tests.

---

## Endpoints a agregar al backend

### `POST /recepciones/{id}/confirmar`

- Llama a `recepcion_service::confirmar_borrador(pool, id, usuario_id)`
- Retorna 200 con el `id` de la recepción confirmada
- Requiere roles: admin, tecnologo
- Error 404 si no existe; 409 si no es borrador (código `ESTADO_INVALIDO`)

### `DELETE /recepciones/{id}`

Nuevo servicio `recepcion_service::eliminar_borrador(pool, id)`:
- Verifica que la recepción existe y es borrador → si no, 404 / 409
- Elimina en cascada: `recepcion_detalle`, `recepciones` (los lotes de borrador no tienen movimientos de stock)
- Retorna 204
- Requiere rol admin

---

## Tests a implementar (~16 tests)

### Grupo 1: CRUD básico

| Test | Verifica |
|------|---------|
| `listar_recepciones` | GET `/recepciones` → 200, lista paginada |
| `crear_recepcion_completa_crea_lote` | POST crea recepción completa, respuesta incluye `codigo_interno` y `cantidad` |
| `crear_recepcion_completa_impacta_stock` | Stock en `GET /stock` aumenta tras creación |
| `obtener_recepcion_por_id` | GET `/{id}` → 200 con `estado: "completa"` y detalle |
| `crear_recepcion_sin_token_retorna_401` | Sin JWT → 401 |
| `consulta_no_puede_crear_recepcion` | Rol `consulta` → 403 |

### Grupo 2: Flujo borrador

| Test | Verifica |
|------|---------|
| `crear_borrador_no_impacta_stock` | `estado: "borrador"` → stock sigue en 0 |
| `confirmar_borrador_impacta_stock` | POST `/{id}/confirmar` → stock aumenta, estado = "completa" |
| `confirmar_no_borrador_retorna_409` | Confirmar recepción completa → 409 `ESTADO_INVALIDO` |
| `eliminar_borrador_retorna_204` | DELETE `/{id}` → 204, recepción desaparece |
| `eliminar_recepcion_confirmada_retorna_409` | DELETE sobre recepción completa → 409 |

### Grupo 3: Idempotencia

| Test | Verifica |
|------|---------|
| `crear_recepcion_mismo_idempotency_key_no_duplica` | Dos POST con mismo `X-Idempotency-Key` → segunda retorna la primera sin duplicar stock |

### Grupo 4: Reconciliación con solicitud

| Test | Verifica |
|------|---------|
| `recepcion_completa_cierra_solicitud` | Recepción que cubre todo lo solicitado → solicitud pasa a `"completada"` |
| `recepcion_parcial_deja_solicitud_parcialmente_recibida` | Recepción con menos cantidad → solicitud pasa a `"parcialmente_recibida"` |

### Grupo 5: Validaciones

| Test | Verifica |
|------|---------|
| `crear_recepcion_estado_invalido_retorna_422` | `estado: "invalido"` → 422 |
| `crear_recepcion_sin_detalle_completa_retorna_422` | `estado: "completa"` sin items → 422 |

---

## Helpers dentro del archivo

```rust
async fn setup_base(pool: &PgPool, token: &str, app: &Router) -> (i32, Uuid, i32, i32)
// Retorna: (proveedor_id, producto_id, presentacion_id, area_id)
// Crea: proveedor → producto con presentación → usa área 1 del seed

async fn crear_recepcion_payload(
    proveedor_id: i32,
    producto_id: Uuid,
    presentacion_id: i32,
    area_id: i32,
    estado: &str,
    cantidad: f64,
) -> serde_json::Value
// Construye el payload estándar con fecha_vencimiento y numero_lote únicos

async fn stock_en_area(pool: &PgPool, producto_id: Uuid, area_id: i32) -> f64
// Consulta directamente en DB la cantidad actual de stock
```

---

## Commits esperados

1. `fix(recepciones): agregar endpoints confirmar y eliminar_borrador`
2. `test(recepciones): commit tests existentes actualizados (catalogos, refactor_val, solicitudes)`
3. `test(recepciones): tests de integración completos para módulo recepciones`

---

## Archivos modificados

| Archivo | Acción |
|---------|--------|
| `backend/src/handlers/recepciones.rs` | Agregar `confirmar` handler + `eliminar_borrador` handler; registrar rutas |
| `backend/src/services/recepcion_service.rs` | Agregar `eliminar_borrador` service function |
| `backend/tests/recepciones_test.rs` | Crear desde cero con ~16 tests |
| `backend/tests/catalogos_test.rs` | Commit cambio existente (version en PUT) |
| `backend/tests/refactor_val_test.rs` | Commit cambio existente (sqlx::query dinámico) |
| `backend/tests/solicitudes_test.rs` | Commit cambio existente (proveedor_id requerido) |
