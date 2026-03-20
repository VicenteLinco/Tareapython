# TODO — Sistema de Inventario Lab Clínico
> Análisis realizado: 2026-03-20 | Rama: main

---

## 🔴 CRÍTICO — Seguridad / Integridad de datos

### [ ] SEC-01 · Validación de presentación no verifica producto
**Archivo:** `backend/src/handlers/recepciones.rs` ~línea 325
**Problema:** La query busca `WHERE id = $1 AND activa = true` sin verificar que la presentación pertenezca al producto. Un usuario podría pasar el ID de la presentación de otro producto y obtener un factor de conversión incorrecto.
**Fix:** Agregar `AND producto_id = $2` a la query.

### [ ] SEC-02 · Race condition en creación de lotes
**Archivo:** `backend/src/handlers/recepciones.rs` ~línea 591
**Problema:** Hay una ventana entre el `SELECT` para verificar si el lote existe y el `INSERT`. Con solicitudes concurrentes puede crearse un lote duplicado.
**Fix:** Reemplazar con `INSERT INTO lotes ... ON CONFLICT (producto_id, numero_lote) DO UPDATE` o `DO NOTHING RETURNING id`.

### [ ] SEC-03 · Control de acceso por área faltante en stock y recepciones
**Archivo:** `backend/src/handlers/stock.rs` — función `stock_por_area`
**Problema:** El endpoint no valida que el usuario tenga acceso al área solicitada. Usuarios con rol `consulta` pueden ver stock de áreas que no les corresponden. En `recepciones.rs` tampoco se valida `area_destino_id`.
**Fix:** Reutilizar `stock_ops::validar_acceso_area` como se hace en consumos.

### [ ] SEC-04 · XSS potencial en URL de íconos de proveedores
**Archivo:** `frontend/src/components/ui/proveedor-select.tsx` línea 15
**Problema:** Se acepta cualquier URL (incluyendo `data:image/svg+xml`) sin sanitización. Un admin malicioso podría inyectar SVG con scripts.
**Fix:** Usar una lista blanca de dominios permitidos o sanitizar con DOMPurify antes de renderizar.

### [ ] SEC-05 · Tokens JWT en localStorage (vulnerable a XSS)
**Archivo:** `frontend/src/hooks/use-auth-store.ts`
**Problema:** Access y refresh tokens persisten en `localStorage`. Cualquier XSS puede robarlos.
**Fix ideal:** Mover a cookies `httpOnly; Secure; SameSite=Strict`. Si no es posible ahora, al menos mover el `accessToken` a `sessionStorage` y solo persistir el `refreshToken`.

---

## 🟠 ALTO — Lógica incorrecta / Bugs importantes

### [ ] BUG-01 · Validación incorrecta de imagen en recepciones (data URL de SVG)
**Archivo:** `backend/src/handlers/recepciones.rs` ~línea 559
**Problema:** Solo verifica que empiece con `data:image/` pero acepta `data:image/svg+xml` que puede contener scripts. No valida magic bytes reales.
**Fix:** Validar que sea `data:image/jpeg` o `data:image/png` únicamente, o procesar la imagen con una librería antes de almacenar.

### [ ] BUG-02 · N+1 queries en `stock_por_area`
**Archivo:** `backend/src/handlers/stock.rs` ~línea 278
**Problema:** Por cada producto se lanza una query separada para obtener sus lotes. Con 1500 insumos esto son 1500+ queries por request.
**Fix:** Reescribir con un JOIN o `SELECT ... WHERE lote_id IN (...)`.

### [ ] BUG-03 · Alertas: 4 queries separadas sin paginación
**Archivo:** `backend/src/handlers/stock.rs` ~línea 318
**Problema:** Se lanzan 4 queries secuenciales (`bajo_minimo`, `por_vencer_30d`, `por_vencer_90d`, `vencidos`) y se retornan todos los registros sin límite.
**Fix:** Consolidar con CTEs en una sola query + agregar paginación o límite configurable.

### [ ] BUG-04 · Optimistic locking inconsistente
**Archivos:** `backend/src/handlers/productos.rs` (tiene check de `version`), `proveedores.rs`, `presentaciones.rs` (no tienen)
**Problema:** El campo `version` existe en la tabla pero solo se verifica al actualizar productos. Las demás entidades no protegen contra ediciones concurrentes.
**Fix:** Implementar el check `WHERE id = $1 AND version = $2` en todos los handlers de actualización.

### [ ] BUG-05 · Validación de email muy permisiva
**Archivo:** `backend/src/errors.rs` líneas 84-96
**Problema:** La validación manual acepta emails inválidos como `a@b.c` o `test@.com`. No cumple RFC 5322.
**Fix:** Usar la crate `validator` con `#[validate(email)]` o una regex correcta.

### [ ] BUG-06 · `per_page = 0` no está validado
**Archivo:** `backend/src/handlers/stock.rs` ~línea 211
**Problema:** Si llega `per_page=0`, se produce división por cero o comportamiento indefinido.
**Fix:** Validar que `per_page >= 1` (y poner un máximo razonable, ej. 200) al inicio de cada handler paginado.

---

## 🟡 MEDIO — Calidad / UX / Deuda técnica

### [ ] UX-01 · Sin confirmación antes de eliminar borradores / productos
**Archivos:** `frontend/src/pages/recepciones/index.tsx`, `frontend/src/pages/catalogos/productos-tab.tsx`
**Problema:** No hay modal de confirmación antes de acciones destructivas.
**Fix:** Agregar diálogo `AlertDialog` de shadcn antes de DELETE.

### [ ] UX-02 · Manejo de errores inconsistente en frontend
**Archivo:** `frontend/src/pages/login/index.tsx` líneas 32-41 y otros
**Problema:** Algunos errores se capturan con `as any`, no se distingue entre error de red y error del servidor, mensajes genéricos.
**Fix:** Crear un helper `parseApiError(err)` reutilizable que devuelva mensajes descriptivos según el status code y el cuerpo del error.

### [ ] UX-03 · Sin Error Boundary en React
**Archivo:** `frontend/src/App.tsx`
**Problema:** Si cualquier componente lanza una excepción no capturada, toda la app muestra pantalla en blanco sin opción de recuperarse.
**Fix:** Agregar un componente `<ErrorBoundary>` que muestre un mensaje amigable con botón "Recargar".

### [ ] UX-04 · Sin estado de carga en formulario de nueva recepción
**Archivo:** `frontend/src/pages/recepciones/nueva.tsx`
**Problema:** Al guardar una recepción con muchos ítems no hay feedback visual. El usuario puede hacer clic varias veces pensando que no funcionó.
**Fix:** Deshabilitar botón de guardar mientras se procesa + mostrar spinner.

### [ ] UX-05 · Sidebar no indica la sección activa en sub-rutas
**Archivo:** `frontend/src/components/layout/sidebar.tsx`
**Problema:** Si el usuario está en `/recepciones/nueva`, el item "Recepciones" del sidebar puede no estar marcado como activo.
**Fix:** Usar `useMatch` o comparar `pathname.startsWith(item.href)` en lugar de `===`.

### [ ] UX-06 · Página de detalle de recepción sin breadcrumb ni navegación de regreso
**Archivo:** `frontend/src/pages/recepciones/detalle.tsx`
**Problema:** No hay forma obvia de volver al listado de recepciones sin usar el botón atrás del navegador.
**Fix:** Agregar breadcrumb (`Recepciones > REC-000001`) y botón "← Volver".

### [ ] UX-07 · Stock PDF sin timestamp ni usuario
**Archivo:** `frontend/src/lib/stock-pdf.ts`
**Problema:** El PDF exportado probablemente no incluye la fecha y hora de generación ni el nombre del usuario que lo generó.
**Fix:** Agregar header con fecha, hora, usuario y filtros aplicados al exportar.

### [ ] UX-08 · data-table sin estado vacío personalizado
**Archivo:** `frontend/src/components/ui/data-table.tsx`
**Problema:** Cuando no hay resultados, la tabla muestra un mensaje genérico. Para un usuario de laboratorio es confuso.
**Fix:** Permitir una prop `emptyMessage` para cada tabla, ej. "No hay insumos registrados en esta área".

---

## 🔵 BAJO — Deuda técnica / Mejoras arquitectónicas

### [ ] TECH-01 · 55+ llamadas a `unwrap()` / `expect()` en backend
**Archivos:** `backend/src/main.rs`, `backend/src/config.rs` y otros
**Problema:** Si el entorno está mal configurado (JWT_SECRET corto, DB no disponible), el proceso hace `panic!` con mensajes de error poco claros para el operador.
**Fix:** Reemplazar con manejo explícito de errores y mensajes descriptivos en startup. Especialmente en `config.rs`.

### [ ] TECH-02 · Construcción dinámica de SQL con índices manuales es frágil
**Archivos:** `backend/src/handlers/productos.rs` ~línea 138, `recepciones.rs`
**Problema:** Construcción de SQL con `param_idx` manual es difícil de mantener y propenso a errores de índice.
**Fix:** Evaluar usar `sqlx-query-builder` o `sea-query` para queries dinámicas.

### [ ] TECH-03 · Zustand sin validación de schema al hidratar desde localStorage
**Archivo:** `frontend/src/hooks/use-auth-store.ts`
**Problema:** Si la estructura del store cambia entre versiones, el estado corrupto del localStorage puede causar errores silenciosos.
**Fix:** Agregar `version` y `migrate` a la configuración de `persist`.

### [ ] TECH-04 · Query keys de React Query sin type-safety
**Archivos:** Varios pages de frontend
**Problema:** Los query keys son arrays de strings libres. Si se renombra una variable, el cache no se invalida y no hay error de TypeScript.
**Fix:** Centralizar query keys en un objeto `QUERY_KEYS` tipado.

### [ ] TECH-05 · Uso de `as any` / `as unknown as` en frontend
**Archivos:** `frontend/src/pages/recepciones/index.tsx` ~línea 266, otros
**Problema:** Bypasea el sistema de tipos de TypeScript, ocultando posibles incompatibilidades con la API.
**Fix:** Tipar correctamente los datos usando los tipos definidos en `types/index.ts`.

### [ ] TECH-06 · Sin índices en claves foráneas de alta frecuencia
**Archivo:** `backend/migrations/001_initial_schema.sql`
**Problema:** `recepcion_detalle.recepcion_id`, `stock.area_id` y otras FK de consulta frecuente no tienen índices dedicados. A medida que crece la BD, las queries se lentifican.
**Fix:** Agregar `CREATE INDEX CONCURRENTLY` en una nueva migración.

### [ ] TECH-07 · Rate limiting solo en auth, no en endpoints de mutación
**Archivo:** `backend/src/main.rs`
**Problema:** Solo login y refresh están limitados. Endpoints de creación de recepciones, consumos, etc. pueden ser abusados.
**Fix:** Aplicar un rate limiter más amplio (ej. 100 req/min por usuario) en el middleware global.

---

## ✅ PENDIENTE DE IMPLEMENTAR (funcionalidad faltante)

### [ ] FEAT-01 · Módulo Setup (carga inicial CSV)
**Memoria:** "Falta: Setup module (6 endpoints: importar CSV, finalizar carga inicial)"
**Descripción:** Importación masiva de productos, lotes y stock inicial desde CSV para el onboarding del laboratorio. Sin esto, el sistema no puede ponerse en marcha sin entrada manual de ~1500 insumos.

### [ ] FEAT-02 · Página de Configuración (frontend)
**Directorio:** `frontend/src/pages/configuracion/` (existe pero revisar completitud)
**Descripción:** Gestión de parámetros del sistema: stock mínimo global, alertas de vencimiento, datos del laboratorio.

### [ ] FEAT-03 · Detalle de recepción (frontend)
**Archivo:** `frontend/src/pages/recepciones/detalle.tsx` (existe, revisar completitud)
**Descripción:** Vista completa de una recepción confirmada con todos sus ítems, foto adjunta y posibilidad de imprimir.

### [ ] FEAT-04 · Audit trail completo en stock y movimientos
**Descripción:** El `audit_log` solo registra cambios en catálogos. Las operaciones de consumo, transferencia y descarte no generan entradas de auditoría trazables a nivel de "quién hizo qué con qué insumo".

### [ ] FEAT-05 · Pantalla de Consumos (frontend)
**Descripción:** No hay evidencia de una página para registrar consumos individuales o batch desde el frontend. Solo existe el backend.

### [ ] FEAT-06 · Pantalla de Transferencias y Descartes (frontend)
**Descripción:** Operaciones de transferencia entre áreas y descarte de insumos vencidos/dañados necesitan interfaz.

### [ ] FEAT-07 · Pantalla de Movimientos / Historial (frontend)
**Descripción:** Vista paginada de todos los movimientos del inventario con filtros por producto, área, tipo y fecha.

### [ ] FEAT-08 · Gestión de Usuarios (frontend)
**Descripción:** CRUD de usuarios (crear, editar, desactivar, cambiar contraseña). El backend está completo pero falta la UI.

---

## 📊 Resumen de prioridades

| Categoría | Crítico | Alto | Medio | Bajo | Pendiente |
|-----------|---------|------|-------|------|-----------|
| Seguridad | SEC-01..05 | BUG-01 | — | TECH-07 | — |
| Lógica/Bugs | — | BUG-02..06 | — | TECH-01..02 | — |
| UX/Frontend | — | — | UX-01..08 | TECH-03..05 | — |
| BD/Performance | — | BUG-02, BUG-03 | — | TECH-06 | — |
| Funcionalidad | — | — | — | — | FEAT-01..08 |

**Recomendación de orden:**
1. SEC-03 (acceso por área) + SEC-01 (validación presentación) → integridad de datos
2. BUG-01 (SVG injection) + SEC-04 (XSS íconos) → seguridad UI
3. BUG-02 (N+1 queries) → performance antes de ir a producción
4. FEAT-01 (setup CSV) → bloquea el onboarding
5. FEAT-05..08 → completar el MVP funcional
