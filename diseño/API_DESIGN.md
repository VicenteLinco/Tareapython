# Diseño de API REST - Inventario de Laboratorio Clínico V1.0

## Convenciones

- **Base URL:** `/api/v1`
- **Autenticación:** Bearer Token (JWT) en header `Authorization`
- **Formato:** JSON (request y response)
- **Paginación:** `?page=1&per_page=25` → respuesta incluye `{ data: [], total: number, page: number, per_page: number }`
- **Filtros:** Query params (ej: `?area_id=3&categoria_id=5`)
- **Búsqueda:** `?q=texto` (búsqueda parcial por nombre/código)
- **Ordenamiento:** `?sort=nombre&order=asc`
- **Errores:** `{ error: string, code: string, details?: object }`
- **Timestamps:** ISO 8601 con timezone (`2026-03-14T15:30:00Z`)
- **Idempotency:** Endpoints de escritura críticos requieren header `X-Idempotency-Key: <uuid>`. Si el backend recibe una key ya procesada, retorna la respuesta original sin re-ejecutar. Crítico para móvil con señal inestable. Aplica a: POST consumos, consumos/batch, recepciones, transferencias, descartes.
- **Optimistic Locking:** Los PUT de catálogo (productos, presentaciones, proveedores) requieren campo `version` en el body. Si la versión no coincide → `409 Conflict` con `code: "VERSION_CONFLICT"`.
- **Audit Trail:** Todo CREATE/UPDATE/DELETE en tablas de catálogo se registra automáticamente en `audit_log` (quién, cuándo, qué cambió). Transparente para el frontend.

### Códigos HTTP
- `200` OK (GET, PUT exitoso)
- `201` Created (POST exitoso)
- `204` No Content (DELETE exitoso)
- `400` Bad Request (validación fallida)
- `401` Unauthorized (sin token o token inválido)
- `403` Forbidden (rol insuficiente)
- `404` Not Found
- `409` Conflict (duplicado, constraint violado)
- `422` Unprocessable Entity (lógica de negocio fallida, ej: stock insuficiente)

### Roles por endpoint
- 🔓 Público (sin auth)
- 👁️ Consulta (consulta, tecnologo, admin)
- 🔧 Operación (tecnologo, admin)
- 🔒 Admin (solo admin)

---

## 0. Infraestructura

### `GET /api/v1/health` 🔓
Health check para Docker/orquestadores. No requiere auth.
```json
// Response 200
{ "status": "ok", "db": "connected", "version": "1.0.0" }

// Response 503 (si la DB no responde)
{ "status": "error", "db": "disconnected" }
```

---

## 1. Autenticación

### `POST /api/v1/auth/login` 🔓
Login con email y password. Retorna JWT.
```json
// Request
{ "email": "usuario@lab.cl", "password": "..." }

// Response 200
{
  "token": "eyJ...",
  "refresh_token": "eyJ...",
  "usuario": {
    "id": "uuid",
    "nombre": "Juan Pérez",
    "email": "usuario@lab.cl",
    "rol": "tecnologo",
    "areas": [
      { "id": 1, "nombre": "Microbiología" },
      { "id": 3, "nombre": "Orinas" }
    ]
  }
}
```

### `GET /api/v1/auth/me` 👁️
Retorna el usuario autenticado con sus áreas.

### `POST /api/v1/auth/refresh` 👁️
Renueva el token. El refresh re-consulta la DB para obtener rol y áreas actualizados.
```json
// Request
{ "refresh_token": "eyJ..." }

// Response 200
{ "token": "eyJ...", "refresh_token": "eyJ..." }
```

### Contenido del JWT (access_token)
```json
{
  "sub": "uuid-del-usuario",
  "rol": "tecnologo",
  "area_ids": [1, 3, 5],
  "exp": 1711000000,
  "iat": 1710999100
}
```
- **access_token:** vida corta (15 minutos). Contiene rol y áreas para evitar queries por request.
- **refresh_token:** vida larga (24h). Al renovar, re-consulta la DB → si el admin cambió rol o áreas, el nuevo token refleja los cambios.
- **Revocación inmediata:** Para casos críticos (ej: despido), el admin puede invalidar todos los tokens de un usuario. El backend mantiene una lista corta en memoria de `user_ids` revocados que se verifica en el middleware.

### `POST /api/v1/auth/cambiar-password` 👁️
```json
{ "password_actual": "...", "password_nueva": "..." }
```

---

## 2. Usuarios

### `GET /api/v1/usuarios` 🔒
Lista usuarios. Filtros: `?rol=tecnologo&activo=true`

### `POST /api/v1/usuarios` 🔒
```json
{
  "nombre": "María López",
  "email": "maria@lab.cl",
  "password": "...",
  "rol": "tecnologo",
  "area_ids": [1, 3, 5]
}
```

### `GET /api/v1/usuarios/:id` 🔒

### `PUT /api/v1/usuarios/:id` 🔒
Actualiza datos del usuario. Incluye `area_ids` para reasignar áreas.

### `DELETE /api/v1/usuarios/:id` 🔒
Soft delete (`activo = false`). No se borra — tiene movimientos vinculados.

---

## 3. Áreas

### `GET /api/v1/areas` 👁️
Lista todas las áreas activas. Filtro: `?es_bodega=true`

### `POST /api/v1/areas` 🔒
```json
{ "nombre": "Microbiología", "es_bodega": false }
```

### `PUT /api/v1/areas/:id` 🔒

### `DELETE /api/v1/areas/:id` 🔒
Solo si no tiene stock asociado. Sino, soft delete.

### `GET /api/v1/areas/:id/productos` 👁️
Lista los productos asignados a un área (vía `producto_area`).

### `PUT /api/v1/areas/:id/productos` 🔒
Reemplaza la asignación de productos de un área. Recibe array de `producto_ids`.
```json
{ "producto_ids": ["uuid-1", "uuid-2", "uuid-3"] }
```
Nota: También se puebla automáticamente al recibir insumos en un área.

---

## 4. Categorías

### `GET /api/v1/categorias` 👁️
### `POST /api/v1/categorias` 🔒
### `PUT /api/v1/categorias/:id` 🔒
### `DELETE /api/v1/categorias/:id` 🔒
Solo si no tiene productos asociados.

---

## 5. Unidades de Medida

### `GET /api/v1/unidades-medida` 👁️
### `POST /api/v1/unidades-medida` 🔒
### `PUT /api/v1/unidades-medida/:id` 🔒
### `DELETE /api/v1/unidades-medida/:id` 🔒
Solo si no tiene productos asociados.

---

## 6. Proveedores

### `GET /api/v1/proveedores` 👁️
Filtro: `?q=nombre&activo=true`
### `POST /api/v1/proveedores` 🔒
### `PUT /api/v1/proveedores/:id` 🔒
### `DELETE /api/v1/proveedores/:id` 🔒
Soft delete.

---

## 7. Productos (Catálogo)

### `GET /api/v1/productos` 👁️
Lista paginada con filtros.
```
?q=glucosa&categoria_id=3&area_id=1&activo=true&page=1&per_page=25
```
Cuando se pasa `area_id`, filtra por `producto_area` → el tecnólogo solo ve los de su área.

```json
// Response 200 — Ligero, sin stock. Para selectores, búsqueda y catálogo.
// El stock se consulta vía GET /stock (no se duplica aquí).
{
  "data": [
    {
      "id": "uuid",
      "codigo_interno": "PRD-00042",
      "nombre": "Glucosa Oxidasa",
      "categoria": { "id": 3, "nombre": "Reactivos Química" },
      "unidad_base": { "id": 1, "abreviatura": "ml" },
      "presentaciones": [
        { "id": 12, "nombre": "Frasco 500ml", "factor_conversion": 500, "codigo_barras": "7801234..." }
      ],
      "stock_minimo": 500.00,
      "activo": true
    }
  ],
  "total": 342,
  "page": 1,
  "per_page": 25
}
```

### `GET /api/v1/productos/:id` 👁️
Detalle completo: producto + presentaciones + stock por área + lotes activos.
```json
{
  "id": "uuid",
  "codigo_interno": "PRD-00042",
  "nombre": "Glucosa Oxidasa",
  "categoria": { "id": 3, "nombre": "Reactivos Química" },
  "unidad_base": { "id": 1, "nombre": "mililitro", "abreviatura": "ml" },
  "stock_minimo": 500.00,
  "presentaciones": [
    { "id": 12, "nombre": "Frasco 500ml", "factor_conversion": 500, "codigo_barras": "7801234..." }
  ],
  "stock_por_area": [
    { "area_id": 1, "area_nombre": "Microbiología", "stock": 1500.00, "proximo_vencimiento": "2026-08-15" },
    { "area_id": 7, "area_nombre": "Bodega Reactivos", "stock": 1000.00, "proximo_vencimiento": "2026-12-01" }
  ],
  "stock_total": 2500.00,
  "lotes_activos": [
    {
      "id": "uuid",
      "numero_lote": "LOT-ABC123",
      "codigo_interno": "LOT-20260301-00015",
      "fecha_vencimiento": "2026-08-15",
      "proveedor": "Merck",
      "costo_unitario": 1.25,
      "stock_por_area": [
        { "area_id": 1, "stock": 800.00 },
        { "area_id": 7, "stock": 500.00 }
      ]
    }
  ],
  "areas": [1, 7]
}
```

### `POST /api/v1/productos` 🔒
```json
{
  "nombre": "Glucosa Oxidasa",
  "descripcion": "Reactivo para determinación de glucosa",
  "categoria_id": 3,
  "unidad_base_id": 1,
  "stock_minimo": 500,
  "presentaciones": [
    { "nombre": "Frasco 500ml", "factor_conversion": 500, "codigo_barras": "7801234..." }
  ],
  "area_ids": [1, 7]
}
```
El `codigo_interno` se genera automáticamente.

### `PUT /api/v1/productos/:id` 🔒
No permite cambiar `unidad_base_id` si el producto tiene lotes con stock.
Requiere `version` en el body (optimistic locking):
```json
{
  "nombre": "Glucosa Oxidasa (actualizado)",
  "categoria_id": 3,
  "stock_minimo": 600,
  "version": 1
}
```
Si `version` no coincide → `409 Conflict`:
```json
{ "error": "El registro fue modificado por otro usuario", "code": "VERSION_CONFLICT", "version_actual": 2 }
```

### `DELETE /api/v1/productos/:id` 🔒
Soft delete. Solo si no tiene stock activo.

### `POST /api/v1/productos/importar` 🔒
Importación masiva desde CSV.
```
Content-Type: multipart/form-data
Body: file (CSV)
```
```json
// Response 200
{
  "importados": 1423,
  "errores": 12,
  "detalle_errores": [
    { "fila": 45, "error": "Categoría 'Reactivos XYZ' no existe" },
    { "fila": 89, "error": "Unidad base 'lt' no reconocida" }
  ]
}
```

---

## 8. Presentaciones

### `GET /api/v1/productos/:producto_id/presentaciones` 👁️
### `POST /api/v1/productos/:producto_id/presentaciones` 🔒
### `PUT /api/v1/presentaciones/:id` 🔒
No permite cambiar `factor_conversion` si hay recepciones que la usaron.
### `DELETE /api/v1/presentaciones/:id` 🔒
Soft delete.

---

## 9. Lotes

### `GET /api/v1/lotes` 👁️
Filtros: `?producto_id=uuid&con_stock=true&vencido=true&area_id=1`

### `GET /api/v1/lotes/:id` 👁️
Detalle: lote + stock por área + historial de movimientos del lote.

### `GET /api/v1/lotes/buscar-codigo/:codigo` 👁️
Busca por `codigo_interno` (etiqueta escaneada) o `codigo_barras` de presentación.
```json
// Response 200 (puede retornar múltiples si es código de barras)
{
  "resultados": [
    {
      "tipo": "lote_interno",
      "lote": { "id": "uuid", "numero_lote": "ABC123", "producto_nombre": "Glucosa Oxidasa" }
    }
  ]
}
```
Si retorna múltiples → la UI muestra lista para elegir (manejo de colisión de código de barras).

---

## 10. Stock ⭐ (Consulta — Vista principal)

### `GET /api/v1/stock` 👁️
Vista principal de stock. Es la pantalla que más se usa.
```
?area_id=1&q=glucosa&categoria_id=3&vencimiento_antes=2026-06-01&stock_bajo=true&page=1&per_page=50
```
```json
{
  "data": [
    {
      "producto_id": "uuid",
      "codigo_interno": "PRD-00042",
      "producto_nombre": "Glucosa Oxidasa",
      "categoria": "Reactivos Química",
      "unidad": "ml",
      "stock_total": 2500.00,
      "stock_minimo": 500.00,
      "proximo_vencimiento": "2026-08-15",
      "cantidad_lotes_activos": 3,
      "areas": ["Microbiología", "Bodega Reactivos"]
    }
  ],
  "total": 87,
  "page": 1,
  "per_page": 50,
  "resumen": {
    "total_productos_con_stock": 823,
    "productos_bajo_minimo": 12,
    "productos_por_vencer_90d": 34
  }
}
```

### `GET /api/v1/stock/area/:area_id` 👁️
Stock de un área específica. Agrupa por producto, muestra lotes.
```
?q=glucosa&categoria_id=3&page=1&per_page=50
```
```json
{
  "area": { "id": 1, "nombre": "Microbiología" },
  "total": 124,
  "page": 1,
  "per_page": 50,
  "productos": [
    {
      "producto_id": "uuid",
      "codigo_interno": "PRD-00042",
      "nombre": "Glucosa Oxidasa",
      "unidad": "ml",
      "stock": 1500.00,
      "lotes": [
        { "lote_id": "uuid", "numero_lote": "ABC123", "stock": 800.00, "fecha_vencimiento": "2026-08-15" },
        { "lote_id": "uuid", "numero_lote": "DEF456", "stock": 700.00, "fecha_vencimiento": "2026-12-01" }
      ]
    }
  ]
}
```

### `GET /api/v1/stock/alertas` 👁️
Productos que necesitan atención.
```json
{
  "bajo_minimo": [ { "producto": "...", "stock_actual": 200, "stock_minimo": 500 } ],
  "por_vencer_30d": [ { "producto": "...", "lote": "...", "fecha_vencimiento": "...", "stock": 150 } ],
  "por_vencer_90d": [ ... ],
  "vencidos": [ { "producto": "...", "lote": "...", "fecha_vencimiento": "...", "stock": 50 } ]
}
```

---

## 11. Consumo ⭐ (Operación más frecuente)

### `POST /api/v1/consumos` 🔧
Registrar un consumo. El backend aplica FEFO automáticamente.

**Validación de acceso:** El backend verifica que `area_id` esté en `usuario_area` del usuario autenticado. Admin tiene acceso a todas las áreas. Si no tiene acceso → 403.

**Header requerido:** `X-Idempotency-Key: <uuid>` (generado por el frontend).
```json
// Request
{
  "producto_id": "uuid",
  "area_id": 1,
  "cantidad": 50,
  "unidad": "base",
  "nota": "Proceso de muestras matutino"
}
```
Opción con presentación (el backend convierte):
```json
{
  "producto_id": "uuid",
  "area_id": 1,
  "cantidad": 2,
  "unidad": "presentacion",
  "presentacion_id": 12,
  "nota": "2 frascos completos"
}
```
```json
// Response 201
{
  "grupo_movimiento": "uuid",
  "movimientos": [
    {
      "id": "uuid",
      "numero_documento": "MOV-000891",
      "lote": { "numero_lote": "ABC123", "fecha_vencimiento": "2026-08-15" },
      "cantidad": 50,
      "cantidad_resultante": 750.00,
      "tipo": "CONSUMO"
    }
  ],
  "stock_restante_area": 1450.00
}
```
```json
// Response 422 — Stock insuficiente
{
  "error": "Stock insuficiente",
  "code": "STOCK_INSUFICIENTE",
  "details": {
    "producto": "Glucosa Oxidasa",
    "area": "Microbiología",
    "stock_disponible": 30.00,
    "cantidad_pedida": 50.00
  }
}
```

### `POST /api/v1/consumos/batch` 🔧
Consumo masivo en una sola transacción. Todo o nada.
```json
// Request
{
  "area_id": 1,
  "items": [
    { "producto_id": "uuid-1", "cantidad": 50, "unidad": "base" },
    { "producto_id": "uuid-2", "cantidad": 2, "unidad": "presentacion", "presentacion_id": 12 },
    { "producto_id": "uuid-3", "cantidad": 100, "unidad": "base" }
  ],
  "nota": "Procesamiento matutino"
}
```
```json
// Response 201
{
  "grupo_movimiento": "uuid",
  "movimientos_generados": 4,
  "resumen": [
    { "producto": "Glucosa Oxidasa", "cantidad_consumida": 50, "stock_restante": 1450 },
    { "producto": "Kit Hemograma", "cantidad_consumida": 200, "stock_restante": 800 },
    { "producto": "Buffer pH 7.0", "cantidad_consumida": 100, "stock_restante": 300 }
  ]
}
```
```json
// Response 422 — Si algún item no tiene stock suficiente, NADA se procesa
{
  "error": "Stock insuficiente en uno o más items",
  "code": "STOCK_INSUFICIENTE_BATCH",
  "details": {
    "items_fallidos": [
      { "producto_id": "uuid-3", "producto": "Buffer pH 7.0", "stock_disponible": 80, "cantidad_pedida": 100 }
    ]
  }
}
```
Todos los movimientos comparten el mismo `grupo_movimiento`. Ideal para registro rápido desde celular.

**No existe GET /consumos.** El historial de consumos se consulta vía `GET /movimientos?tipo=CONSUMO`. Evita duplicar lógica.

---

## 12. Recepciones

### `GET /api/v1/recepciones` 👁️
Lista paginada. Filtros: `?proveedor_id=1&estado=completa&desde=2026-01-01`
Estados válidos: `borrador`, `completa`, `parcial`, `rechazada`.
Borradores solo visibles para el usuario que los creó y admins.

### `GET /api/v1/recepciones/:id` 👁️
Detalle completo: cabecera + líneas de detalle + movimientos generados.

### `POST /api/v1/recepciones` 🔧
Crear recepción completa (cabecera + detalle). Genera lotes, stock y movimientos en una transacción.

**Validaciones de lotes:**
- Si dos líneas de detalle tienen el mismo `(producto_id, numero_lote)` → rechazar con error `LOTE_DUPLICADO_EN_REQUEST`.
- Si el lote ya existe en la DB, se reutiliza (se suma stock). Si la `fecha_vencimiento` del request difiere de la existente → advertencia en la respuesta (se usa la fecha existente).
```json
{
  "proveedor_id": 1,
  "numero_guia": "GD-2026-00542",
  "estado": "completa",
  "fecha_recepcion": "2026-03-14T10:30:00Z",
  "nota": "Pedido mensual marzo",
  "detalle": [
    {
      "producto_id": "uuid",
      "numero_lote": "MK-LOT-2026A",
      "fecha_vencimiento": "2027-06-15",
      "presentacion_id": 12,
      "cantidad_presentaciones": 5,
      "area_destino_id": 1,
      "costo_unitario": 1.25
    },
    {
      "producto_id": "uuid",
      "numero_lote": "MK-LOT-2026B",
      "fecha_vencimiento": "2027-09-01",
      "presentacion_id": 12,
      "cantidad_presentaciones": 3,
      "area_destino_id": 7
    }
  ]
}
```

### `POST /api/v1/recepciones/borrador` 🔧
Guarda borrador (draft mode). No genera movimientos ni stock.
```json
// Mismo formato que POST /recepciones pero se guarda como borrador
```

### `PUT /api/v1/recepciones/borrador/:id` 🔧
Actualiza borrador.

### `POST /api/v1/recepciones/borrador/:id/confirmar` 🔧
Confirma borrador → genera lotes, stock, movimientos. Se convierte en recepción definitiva.

### `DELETE /api/v1/recepciones/borrador/:id` 🔧
Elimina borrador (solo borradores, no recepciones confirmadas).

---

## 13. Transferencias

### `POST /api/v1/transferencias` 🔧
Mover stock de un área a otra.

**Validación de acceso:** El usuario debe tener acceso al área de origen (vía `usuario_area`). Admin acceso total.

```json
{
  "producto_id": "uuid",
  "lote_id": "uuid (OPCIONAL — si no se envía, aplica FEFO)",
  "area_origen_id": 7,
  "area_destino_id": 1,
  "cantidad": 500,
  "nota": "Reposición desde bodega"
}
```
```json
// Response 201
{
  "grupo_movimiento": "uuid",
  "movimiento_salida": { "numero_documento": "MOV-000892", "cantidad_resultante": 500.00 },
  "movimiento_entrada": { "numero_documento": "MOV-000893", "cantidad_resultante": 500.00 }
}
```

---

## 14. Descartes

### `POST /api/v1/descartes` 🔧
Retirar stock por vencimiento o daño.

**Validación de acceso:** El usuario debe tener acceso al área del descarte (vía `usuario_area`). Admin acceso total.
```json
{
  "items": [
    {
      "lote_id": "uuid",
      "area_id": 1,
      "cantidad": 150,
      "tipo": "DESCARTE_VENCIDO",
      "nota": "Vencido 2026-02-28"
    }
  ]
}
```
Soporta descarte masivo (múltiples lotes en una sola operación → mismo `grupo_movimiento`).

---

## 15. Movimientos (Ledger — Solo lectura)

### `GET /api/v1/movimientos` 👁️
Historial general inmutable. Filtros completos:
```
?area_id=1&producto_id=uuid&usuario_id=uuid&tipo=CONSUMO&desde=2026-03-01&hasta=2026-03-14&grupo_movimiento=uuid&page=1&per_page=50
```

### `GET /api/v1/movimientos/:id` 👁️
Detalle de un movimiento con toda su información relacionada.

**No existe PUT ni DELETE.** El ledger es inmutable.

---

## 16. Audit Log (Solo lectura)

### `GET /api/v1/audit-log` 🔒
Historial de cambios en catálogo. Solo admins.
```
?tabla=productos&registro_id=uuid&usuario_id=uuid&desde=2026-03-01&hasta=2026-03-14&page=1&per_page=50
```
```json
{
  "data": [
    {
      "id": 1542,
      "tabla": "productos",
      "registro_id": "uuid",
      "accion": "UPDATE",
      "datos_anteriores": { "nombre": "Glucosa Oxidasa", "stock_minimo": 500 },
      "datos_nuevos": { "nombre": "Glucosa Oxidasa", "stock_minimo": 600 },
      "usuario": { "id": "uuid", "nombre": "Juan Pérez" },
      "created_at": "2026-03-14T10:30:00Z"
    }
  ]
}
```

**No existe POST, PUT ni DELETE.** El audit log es inmutable.

---

## 17. Carga Inicial (Modo Setup)

### `GET /api/v1/setup/estado` 🔒
Verifica si el sistema ya completó la carga inicial.
```json
{ "carga_inicial_completada": false, "productos_cargados": 0, "lotes_cargados": 0 }
```

### `POST /api/v1/setup/importar-productos` 🔒
Importa catálogo desde CSV (productos + presentaciones + categorías).
```
Content-Type: multipart/form-data
```
```json
// Response 200
{
  "importados": 1487,
  "errores": 5,
  "detalle_errores": [
    { "fila": 23, "error": "Unidad base 'lt' no reconocida" }
  ]
}
```

### `POST /api/v1/setup/importar-stock` 🔒
Importa stock inicial desde CSV (producto, lote, vencimiento, área, cantidad).
Genera movimientos tipo `CARGA_INICIAL`.

### `GET /api/v1/setup/resumen` 🔒
Muestra resumen de lo importado para revisión antes de finalizar.
```json
{
  "productos": 1487,
  "presentaciones": 2103,
  "lotes": 2341,
  "stock_registros": 3200,
  "categorias_creadas": 15,
  "areas_con_stock": 10,
  "errores_pendientes": 0
}
```

### `DELETE /api/v1/setup/reiniciar` 🔒
Borra TODA la data importada y permite re-importar desde cero. Solo disponible ANTES de finalizar.
Requiere confirmación: `?confirmar=true`
```json
// Response 200
{ "mensaje": "Setup reiniciado. Todos los datos importados fueron eliminados." }
```

### `POST /api/v1/setup/finalizar` 🔒
Cierra el modo setup permanentemente. No se puede volver a abrir.
```json
// Response 200
{ "mensaje": "Carga inicial completada", "total_productos": 1487, "total_lotes": 2341 }
```

---

## Regla Global de Seguridad: Validación de Área

Todos los endpoints que reciben `area_id` y realizan operaciones de escritura (consumo, recepción, transferencia, descarte) DEBEN validar en el backend:
1. El `area_id` existe y está activa
2. El `area_id` está en `usuario_area` del usuario autenticado
3. Excepción: rol `admin` tiene acceso a todas las áreas

Si la validación falla → `403 Forbidden` con `code: "SIN_ACCESO_AREA"`.

---

## Resumen de Endpoints por Módulo

| Módulo | Endpoints | Rol mínimo |
|--------|-----------|------------|
| Health | 1 | Público |
| Auth | 4 | Público / Autenticado |
| Usuarios | 5 | Admin |
| Áreas | 6 | Consulta / Admin |
| Categorías | 4 | Consulta / Admin |
| Unidades | 4 | Consulta / Admin |
| Proveedores | 4 | Consulta / Admin |
| Productos | 6 | Consulta / Admin |
| Presentaciones | 4 | Consulta / Admin |
| Lotes | 3 | Consulta |
| Stock | 3 | Consulta |
| Consumos | 2 | Tecnólogo |
| Recepciones | 6 | Tecnólogo |
| Transferencias | 1 | Tecnólogo |
| Descartes | 1 | Tecnólogo |
| Movimientos | 2 | Consulta |
| Audit Log | 1 | Admin |
| Setup | 6 | Admin |
| **Total** | **63** | |

## Endpoints MVP (Fase 1 — mínimo para arrancar)

Orden de implementación sugerido:

1. **Auth:** login, me (sin esto no funciona nada)
2. **Setup:** importar productos, importar stock, finalizar (arranque del sistema)
3. **Áreas, Categorías, Unidades, Proveedores:** CRUD básico (datos maestros)
4. **Productos + Presentaciones:** CRUD + búsqueda (catálogo)
5. **Stock:** consulta por área, alertas (visibilidad)
6. **Consumos:** crear + listar (operación diaria)
7. **Recepciones:** crear + borrador + confirmar (entrada de insumos)
8. **Lotes:** consulta + búsqueda por código (escaneo)
9. **Movimientos:** listado (trazabilidad)
10. **Transferencias + Descartes:** operaciones secundarias
