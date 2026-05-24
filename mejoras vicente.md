# Mejoras Vicente - Analisis completo del sistema

Fecha de revision: 2026-05-24

Alcance: revision estatica del repositorio completo: backend Rust/Axum/PostgreSQL, frontend React/Vite/TanStack Query, migraciones, Docker, docs y patrones de UI. No se ejecuto una prueba funcional completa con navegador ni base de datos real en esta pasada.

## 1. Resumen ejecutivo

El sistema tiene una base solida para inventario de laboratorio: usa ledger de movimientos, trigger de stock para impedir saldos negativos, autenticacion JWT, roles, areas, idempotencia en operaciones criticas, migraciones versionadas, tests de backend y una interfaz modular con flujos especificos para stock, consumos, recepciones, solicitudes, conteo, descartes y reportes.

Los principales riesgos no estan en la idea central, sino en consistencia y operacion:

- Hay deuda de seguridad por credenciales/admin de emergencia y exposicion de uploads.
- La idempotencia existe, pero debe cubrir todas las mutaciones criticas de forma uniforme.
- El frontend todavia mezcla calculos Decimal con `Number`/`parseFloat` en pantallas criticas.
- Hay dos estilos de acceso a datos en frontend: hooks por dominio y queries directas por pagina.
- La UI responsive esta avanzada, pero varias pantallas densas dependen de tablas, paneles sticky y cards con radios grandes que pueden desperdiciar espacio en desktop o saturar mobile.
- Las migraciones y release estan bien encaminados, pero conviene reforzar backups, rollback, monitoreo, seeds y limpieza de idempotency/uploads.

Prioridad recomendada:

1. P0: Seguridad, integridad de stock, errores de doble envio, backup y control de accesos.
2. P1: Consistencia de cantidades/precios, query keys, validaciones, performance de listados y busqueda.
3. P2: Mejoras UX, responsive, densidad visual, documentacion operativa y observabilidad avanzada.

## 2. Arquitectura actual

### Backend

Tecnologia:

- Rust 2024.
- Axum 0.8.
- SQLx/PostgreSQL.
- JWT con HS256.
- Argon2 para password.
- Migraciones SQLx.
- Swagger parcial con `utoipa`.

Fortalezas:

- Separacion razonable en `handlers`, `services`, `models`, `dto`, `auth`, `middleware`.
- Reglas de stock centralizadas en movimientos y trigger SQL.
- Uso de transacciones en operaciones de stock.
- Idempotencia implementada para consumos, descartes, conteo y recepciones.
- Errores tipados (`AppError`) con codigos consumibles por frontend.
- Rate limiting basico por IP/usuario.
- Security headers basicos.
- Tests de servicios y handlers.

Riesgos:

- El `main.rs` crea un admin de emergencia con password conocida si no existe.
- Algunos comentarios/cadenas tienen problemas de encoding, lo que no rompe la app pero afecta mantenibilidad y profesionalismo.
- Swagger documenta muy poco del API real.
- Rate limiting en memoria no escala bien con multiples instancias.
- `uploads` se sirve desde `/api/v1/uploads` sin autenticacion en rutas anidadas.
- No se ve una politica de expiracion/limpieza de idempotency keys.

### Frontend

Tecnologia:

- React 19.
- Vite 6.
- TypeScript.
- TanStack Query.
- Zustand para auth.
- DaisyUI/Tailwind v4.
- Lucide icons.
- PDF/Excel con jsPDF/xlsx.

Fortalezas:

- Rutas lazy-loaded.
- ErrorBoundary global.
- AuthInitializer e inactivity timeout.
- Interceptor central para JWT refresh.
- Interceptor central que agrega `X-Idempotency-Key` en mutaciones.
- Componentes UI reutilizables: DataTable, Dialog, ConfirmDialog, FilterBar, EmptyState, PageState, badges, tooltip.
- Pantallas operativas especificas para mobile en conteo y drawers/bottom sheets en flujos de consumo/recepcion.

Riesgos:

- Persistencia de refresh token y usuario en localStorage aumenta impacto de XSS.
- Hay calculos de cantidades/precios con `Number` y `parseFloat` en pantallas criticas.
- Hay query keys manuales dispersas junto con `queryKeys.ts`.
- Muchas invalidaciones usan claves amplias o inconsistentes.
- Algunas pantallas grandes concentran demasiada logica en un solo archivo, especialmente creador de productos, consumos, descartes y solicitudes.

## 3. Seguridad

### P0. Eliminar admin de emergencia con password fija

Problema:

- En `backend/src/main.rs` existe un bloque que crea `admin@laboratorio.cl` con password `Admin123!` si no hay admin.
- Tambien aparece en seed/migraciones y tests.

Riesgo:

- En produccion, una instalacion nueva puede quedar con credenciales conocidas.
- Si el usuario no cambia la clave, es un acceso critico.

Mejora:

- Cambiar el flujo a `SETUP_ADMIN_EMAIL` y `SETUP_ADMIN_PASSWORD` obligatorios solo cuando `ALLOW_BOOTSTRAP_ADMIN=true`.
- Registrar advertencia fuerte si queda activo fuera de desarrollo.
- Obligar cambio de password en primer login para usuarios bootstrap.
- Separar seed de demo de seed productivo.

Criterio de cierre:

- No existe password hardcodeada en runtime productivo.
- Tests siguen pudiendo crear usuario admin mediante fixture especifica.

### P0. Proteger uploads o firmar acceso a archivos sensibles

Problema:

- `/api/v1/uploads` se sirve como `ServeDir`.
- Fotos de recepcion, guias o imagenes pueden contener informacion sensible.

Riesgo:

- Cualquier persona con URL podria consultar archivos si la ruta queda expuesta.

Mejora:

- Mover uploads detras de endpoint autenticado.
- Validar permisos por rol/area/registro.
- Para imagenes publicas de producto, separar bucket/directorio publico de documentos privados.
- Agregar headers de cache diferenciados: imagen de producto puede cachearse; guia/foto de recepcion no.

Criterio de cierre:

- Documentos privados requieren token.
- Productos pueden seguir renderizando imagenes sin romper UX.

### P0. Endurecer tokens y sesion

Problema:

- Access token se guarda en sessionStorage y refresh token en localStorage.
- El refresh token no parece tener rotacion server-side ni lista de revocacion.

Riesgo:

- Un XSS puede robar refresh token persistente.
- Logout no invalida tokens ya emitidos a nivel servidor.

Mejora:

- Ideal: refresh token en cookie `HttpOnly`, `Secure`, `SameSite=Lax/Strict`.
- Guardar hash de refresh tokens en DB con `jti`, expiracion, dispositivo y revocacion.
- Rotar refresh token en cada refresh.
- Invalidar sesiones al cambiar password o desactivar usuario.

Criterio de cierre:

- Logout y cambio de password revocan refresh tokens.
- Un refresh token reutilizado se detecta y bloquea.

### P1. Rate limit distribuido

Problema:

- Rate limiter en memoria funciona en una instancia.

Riesgo:

- Si se despliega con multiples replicas, cada replica permite su propio limite.
- Reinicios limpian limites.

Mejora:

- Usar Redis o Postgres para limites compartidos.
- Limites mas estrictos para login: por IP, email y combinacion IP/email.
- Agregar `Retry-After`.

Criterio de cierre:

- Limites consistentes aunque haya mas de una instancia.

### P1. Politica CSP

Problema:

- Hay security headers basicos, pero no CSP.

Riesgo:

- Mayor impacto ante XSS.

Mejora:

- Agregar `Content-Security-Policy` compatible con Vite build y assets.
- Evitar inline scripts no controlados.

Criterio de cierre:

- CSP activa en produccion sin romper login, PDFs, imagenes ni scanner.

## 4. Integridad de datos y reglas de negocio

### P0. Mantener el ledger como fuente de verdad

Fortaleza:

- `movimientos` funciona como ledger.
- `stock` se actualiza por trigger.
- El trigger valida que el stock no quede negativo.

Riesgo:

- Si algun handler actualiza `stock` directamente en el futuro, rompe trazabilidad.

Mejora:

- Documentar regla: stock solo cambia mediante `movimientos`.
- Crear test que busque en codigo SQL directo contra `stock` fuera de trigger/migraciones.
- Restringir permisos DB: app no deberia tener UPDATE directo a stock salvo por trigger si se puede separar.

Criterio de cierre:

- Toda entrada/salida/ajuste genera movimiento auditable.

### P0. Idempotencia uniforme en mutaciones criticas

Fortaleza:

- Ya existe `idempotency_keys`.
- Frontend agrega key a POST/PUT/PATCH salvo auth.
- Backend la usa en consumos, descartes, conteo y recepciones.

Riesgos:

- No todas las mutaciones del sistema parecen usar idempotencia.
- DELETE no recibe idempotency key desde frontend.
- La tabla inicial tenia `key VARCHAR(50)`, luego se amplio; confirmar en DB real.
- Si una operacion queda con `response_status = 0`, puede bloquear reintentos hasta limpieza manual.

Mejora:

- Definir matriz de endpoints: obligatorio, opcional o no aplica.
- Cubrir solicitudes, ordenes, setup/importaciones y cambios masivos.
- Agregar limpieza de keys antiguas.
- Agregar estado `processing`, `completed`, `failed` con timestamp.
- Permitir reintento si `processing` supera timeout seguro.

Criterio de cierre:

- Doble click, retry de red y refresh no duplican movimientos, recepciones, solicitudes ni descartes.

### P1. Decimal end-to-end

Problema:

- Backend usa `rust_decimal`.
- Frontend ya tiene `frontend/src/domain/parse.ts`, pero todavia hay `Number`/`parseFloat` en conteo, PDFs, quiebres, movimientos, stock detail y recepciones.

Riesgo:

- Errores de redondeo, perdida de decimales, diferencias entre pantalla/PDF/backend.
- Inconsistencia en unidades base vs presentaciones.

Mejora:

- Regla: toda cantidad/precio critica pasa por `toDecimal`, `sumDecimal`, `mulDecimal` o helpers equivalentes.
- Prohibir `parseFloat` para stock, consumo, conteo, recepcion, solicitud y precio con lint custom o busqueda CI.
- Centralizar formatters: cantidad, moneda, presentacion, equivalencia.

Criterio de cierre:

- El mismo valor se muestra igual en cards, tablas, detalle, PDF y payload.

### P1. Versionado optimista consistente

Fortaleza:

- Hay soporte de conflictos de version en errores.

Riesgo:

- No todos los catalogos/flujos pueden estar usando version en actualizaciones.

Mejora:

- Requerir `version` en updates de productos, proveedores, solicitudes, recepciones y usuarios.
- Mostrar dialog claro de conflicto: "otro usuario modifico este registro".
- Permitir recargar y comparar cambios.

Criterio de cierre:

- Dos usuarios editando el mismo registro no pisan cambios silenciosamente.

### P1. Reglas de dominio explicitas

Mejora:

- Crear documento corto de invariantes:
  - Stock nunca negativo.
  - Lote unico por producto/proveedor/numero segun regla real.
  - Recepcion confirmada no editable salvo reconciliacion controlada.
  - Solicitud enviada/cerrada no puede volver a borrador sin evento.
  - Conteo confirmado genera ajustes una sola vez.
  - Producto inactivo no se sugiere ni recibe stock nuevo salvo permiso admin.

Criterio de cierre:

- Cada invariante tiene test backend.

## 5. Backend: mejoras tecnicas

### P1. Completar OpenAPI/Swagger

Problema:

- Swagger solo cubre auth de forma minima.

Mejora:

- Documentar todos los endpoints publicos `/api/v1`.
- Incluir errores tipados y ejemplos.
- Usar el contrato para generar cliente o validar tipos frontend.

Beneficio:

- Menos divergencia entre backend y frontend.
- Mas facil probar integraciones.

### P1. Observabilidad

Fortaleza:

- Logging JSON con tracing.

Mejora:

- Agregar request id/correlation id.
- Loggear latencia, status, metodo, ruta normalizada, usuario_id, area si aplica.
- Crear metricas: requests por endpoint, errores por codigo, latencia p95, pool DB, operaciones de stock, conflictos de version.
- Agregar health detallado: DB ok, migracion actual, espacio uploads.

### P1. Manejo de errores DB mas especifico

Problema:

- Muchos errores SQLx caen en `INTERNAL_ERROR`.

Mejora:

- Mapear unique violation a `CONFLICT`.
- Mapear foreign key violation a `VALIDATION_ERROR`.
- Mapear check violation de stock negativo a `STOCK_INSUFICIENTE`.

Beneficio:

- El usuario recibe mensajes accionables.
- Menos soporte manual.

### P1. Pool y timeouts

Problema:

- Pool max 10 conexiones fijo.

Mejora:

- Configurar por env: `DB_MAX_CONNECTIONS`, `DB_CONNECT_TIMEOUT`, `DB_ACQUIRE_TIMEOUT`.
- Agregar timeouts a operaciones pesadas.
- Revisar queries de reportes y exportaciones para paginar/streaming.

### P2. Limpieza de encoding

Problema:

- Se observan textos con mojibake (`ConfiguraciÃ³n`, `AutenticaciÃ³n`, etc.).

Mejora:

- Normalizar archivos a UTF-8.
- Revisar terminal/editor y `.editorconfig`.

Beneficio:

- Mejor mantenibilidad y documentacion.

## 6. Base de datos y migraciones

### Fortalezas

- Migraciones completas y ordenadas.
- Indices de performance en stock, lotes, movimientos y busqueda.
- Trigger de stock con bloqueo `FOR UPDATE`.
- Search vector para productos con GIN.
- Soft delete en catalogos segun migraciones posteriores.

### P0. Backups y restauracion probada

Problema:

- Hay notas operativas, pero no se ve automatizacion dentro del repo.

Mejora:

- Script `backup.ps1`/job programado para Postgres y uploads.
- Script de restore probado.
- Checklist: backup antes de migrar, restore en ambiente de prueba, retencion 7/30/90 dias.

Criterio de cierre:

- Se puede restaurar DB + uploads en otra maquina con instrucciones claras.

### P1. Indices por uso real

Mejora:

- Ejecutar `EXPLAIN ANALYZE` en:
  - `/stock` con busqueda, categoria, proveedor, area, estado.
  - `/movimientos` con fecha/tipo/area.
  - recomendaciones de solicitudes.
  - dashboard.
  - audit log.
- Agregar indices compuestos solo donde el plan real lo justifique.

### P1. Politica de retencion

Mejora:

- `idempotency_keys`: borrar completadas antiguas.
- `audit_log`: retener segun necesidad legal/operativa, o particionar por fecha.
- `movimientos`: normalmente no borrar; considerar particion mensual si crece mucho.
- `uploads`: borrar archivos huerfanos si se elimina/reemplaza imagen.

### P2. Release migrations

Observacion:

- Hay `backend/migrations` y `release/migrations`.

Mejora:

- Automatizar copia/validacion para evitar que una migracion exista en backend pero no en release.
- CI que compare ambas carpetas o defina una sola fuente de verdad.

## 7. Frontend: calidad, estado y errores

### P1. Unificar query keys y hooks de dominio

Problema:

- Conviven `queryKeys.ts` y muchas claves manuales (`['stock']`, `['stock-list']`, `['alertas']`, etc.).

Riesgo:

- Invalidaciones incompletas o excesivas.
- Datos viejos en una pantalla mientras otra actualizo.

Mejora:

- Usar `queryKeys.ts` como unica fuente.
- Migrar queries directas de paginas a hooks de dominio cuando se repitan.
- Definir invalidacion por entidad:
  - recepcion confirmada invalida recepciones, stock, lotes, dashboard.
  - consumo invalida stock, movimientos, dashboard, recomendaciones.
  - producto editado invalida productos, stock, recomendaciones.

Criterio de cierre:

- No quedan query keys duplicadas para la misma entidad.

### P1. UX de errores consistente

Fortaleza:

- `parseApiError` existe.
- `notify` existe.

Mejora:

- Toda mutacion debe usar el parser central.
- Los errores de conflicto 409 deben conservar contexto y permitir recargar.
- Los errores de stock insuficiente deben mostrar disponible/solicitado si viene `details`.
- Para offline, mostrar estado persistente y bloqueo de acciones no seguras.

### P1. Validaciones de formulario

Mejora:

- Centralizar schemas por flujo:
  - producto.
  - presentacion.
  - lote.
  - recepcion.
  - consumo.
  - conteo.
  - solicitud.
- Validar en frontend sin reemplazar backend.
- Mensajes por campo, no solo toast global.

### P1. Reducir archivos gigantes

Problema:

- Algunas pantallas concentran mucho estado y UI.

Mejora:

- Separar:
  - hooks de estado.
  - componentes de lista.
  - formularios.
  - modales.
  - calculos puros.
  - adaptadores API.

Beneficio:

- Menos regresiones y mejor testabilidad.

## 8. Performance

### Backend

P1:

- Revisar queries N+1 en detalles de stock, recepciones y solicitudes.
- Usar paginacion obligatoria en listados grandes.
- Poner limites maximos de `per_page`.
- Evitar exportar todo sin control cuando crezca el sistema.
- Cachear catalogos poco cambiantes si la carga aumenta.

P2:

- Materialized views para dashboard/recomendaciones si las queries se vuelven pesadas.
- Jobs nocturnos para forecast si no necesita recalculo en cada request.

### Frontend

P1:

- Debounce en todas las busquedas remotas.
- Virtualizacion para listas largas de productos/lotes si superan cientos de filas.
- Reducir re-render en pantallas con carrito usando reducers o stores locales.
- Evitar invalidaciones globales cuando se puede actualizar cache puntual.

P2:

- Preload de rutas frecuentes despues de login.
- Separar chunks de PDF/Excel para no cargar librerias pesadas hasta exportar.
- Medir bundle con `vite build --mode production` y visualizer.

## 9. QA y prevencion de errores

### P0. Matriz de pruebas criticas

Debe existir una suite repetible para:

- Login, refresh, logout, expiracion.
- Usuario sin area intentando consumir/descartar.
- Consumo FEFO con un lote, varios lotes, stock insuficiente.
- Doble click en consumo/recepcion/conteo.
- Recepcion borrador vs confirmada.
- Reconciliacion post-recepcion.
- Solicitudes multi-proveedor.
- Conteo ciego y ajuste.
- Soft delete de catalogos usados por historial.
- Busqueda de producto por nombre, codigo interno, proveedor, maestro y barcode.

### P1. E2E minimo

Crear pruebas Playwright para:

1. Login admin.
2. Ver dashboard.
3. Crear producto/presentacion.
4. Registrar recepcion.
5. Consumir parcial.
6. Ver movimiento.
7. Exportar o abrir PDF basico.
8. Conteo mobile con viewport pequeño.

### P1. CI

Mejora:

- `cargo fmt --check`.
- `cargo clippy -- -D warnings` gradualmente.
- `cargo test --no-run`.
- `npm run lint`.
- `npm run build`.
- Comparar types generados.
- Verificar migraciones ordenadas y sin huecos.

### P1. Checklist de release obligatorio

Ya existe `docs/CHECKLIST_RELEASE.md`; conviene convertirlo en gate real antes de entregar:

- Estado git limpio o cambios documentados.
- Backup previo.
- Migraciones revisadas.
- Build backend/frontend.
- Smoke test manual.
- Registro de riesgos conocidos.

## 10. Producto y operaciones

### P1. Setup/importacion

Mejora:

- Preview antes de importar.
- Errores por fila con descarga CSV de errores.
- Modo dry-run.
- Validacion de duplicados.
- Plantilla descargable.
- Idempotencia/import job para evitar doble carga.

### P1. Compras y forecast

Fortaleza:

- Hay forecast con confianza, historial corto, EWMA, winsorizacion y urgencia.

Mejora:

- Mostrar al usuario por que se sugiere una cantidad.
- Detectar anomalias:
  - consumo fuera de patron.
  - precio recibido mayor a historico.
  - lote con vencimiento demasiado cercano.
- Permitir override con motivo.

### P2. Multi-bodega/multi-laboratorio

No implementar sin decision. Antes definir:

- Es multi-area dentro de un laboratorio?
- Es multi-bodega?
- Es multi-tenant con datos aislados por cliente?

Implementarlo tarde puede ser caro, pero implementarlo sin necesidad tambien agrega complejidad.

## 11. Documentacion recomendada

Crear o actualizar:

- `docs/ARQUITECTURA.md`: diagrama simple, modulos, flujo stock.
- `docs/INVARIANTES.md`: reglas de negocio no negociables.
- `docs/OPERACION.md`: backup, restore, despliegue, logs, rollback.
- `docs/API.md` o Swagger completo.
- `docs/QA_CRITICO.md`: pruebas manuales de entrega.

## 12. Plan de mejora por fases

### Fase 0 - Seguridad e integridad inmediata

Duracion sugerida: 1 a 3 dias.

- Quitar admin de emergencia con password fija o condicionar por env seguro.
- Proteger uploads privados.
- Revisar storage de refresh token y preparar rotacion.
- Confirmar idempotencia en endpoints criticos.
- Agregar limpieza de idempotency keys.
- Documentar backup y probar restore.

Resultado esperado:

- Menos riesgo de acceso indebido.
- Menos riesgo de duplicar operaciones.
- Capacidad real de recuperar datos.

### Fase 1 - Consistencia de datos y errores

Duracion sugerida: 3 a 7 dias.

- Terminar migracion Decimal en frontend.
- Mapear errores SQL a errores de dominio.
- Unificar formatters de cantidad/precio.
- Completar versionado optimista en updates.
- Agregar tests para invariantes principales.

Resultado esperado:

- Menos errores silenciosos en stock, conteo, compras y recepcion.

### Fase 2 - Performance y mantenibilidad

Duracion sugerida: 1 a 2 semanas.

- Unificar query keys.
- Separar pantallas grandes en hooks/componentes.
- Medir queries con `EXPLAIN ANALYZE`.
- Revisar paginacion y limites.
- Lazy load de librerias PDF/Excel.
- CI mas estricto.

Resultado esperado:

- Mejor velocidad percibida y menor costo de mantener.

### Fase 3 - UX operativa y responsive

Duracion sugerida: 1 semana.

- Reorganizar pantallas densas por prioridad operativa.
- Ajustar mobile/desktop segun seccion final de este documento.
- Validar con capturas en 375px, 768px, 1366px y 1920px.
- Crear guia de densidad visual y componentes.

Resultado esperado:

- Menos scroll innecesario, mas claridad y mejores flujos en terreno.

### Fase 4 - Observabilidad y producto avanzado

Duracion sugerida: incremental.

- Metricas, health detallado y alertas.
- Notificaciones por email/digest.
- Anomalias de consumo/precio.
- Forecast precalculado si hace falta.
- Mejor importador masivo.

## 13. Priorizacion rapida

| Prioridad | Mejora | Impacto | Riesgo si no se hace |
|---|---|---|---|
| P0 | Admin seguro | Seguridad | Acceso no autorizado |
| P0 | Uploads protegidos | Seguridad/datos | Exposicion de documentos |
| P0 | Backup/restore probado | Operacion | Perdida de datos |
| P0 | Idempotencia completa | Integridad | Duplicados de stock |
| P1 | Decimal end-to-end | Exactitud | Cantidades/precios incorrectos |
| P1 | Query keys unificadas | UX/datos | Pantallas desactualizadas |
| P1 | Errores DB tipados | Soporte | Mensajes poco accionables |
| P1 | E2E critico | Calidad | Regresiones en entrega |
| P2 | Observabilidad avanzada | Operacion | Problemas dificiles de diagnosticar |
| P2 | Responsive refinado | UX | Uso incomodo en mobile/desktop |

## 14. Visualizacion movil y desktop

Objetivo: priorizar uso correcto de espacios, organizacion clara y flujos eficientes. La app es operativa, no marketing; debe sentirse densa, legible y rapida.

### Principios generales

- Una pantalla debe tener una accion principal clara.
- En mobile, evitar tablas como vista principal; usar cards compactas o flujo paso a paso.
- En desktop, usar el ancho para comparar y operar, no para agrandar tarjetas decorativas.
- Mantener radios moderados; muchas cards usan `rounded-[2rem]` o `rounded-[2.5rem]`, lo que consume espacio y puede verse menos profesional en herramientas operativas.
- Evitar cards dentro de cards cuando no aportan jerarquia.
- Separar informacion primaria, secundaria y acciones.
- Botones destructivos deben estar separados visualmente de acciones frecuentes.
- Los paneles sticky deben tener alturas calculadas consistentes y no competir con header/breadcrumb.

### Mobile

Problemas probables:

- Tablas con scroll horizontal en pantallas como recepciones, audit log, historial, setup o detalle de solicitudes.
- Paneles inferiores fijos pueden tapar contenido si no hay padding inferior suficiente.
- Cards grandes reducen densidad y obligan a demasiado scroll.
- Filtros avanzados pueden ocupar media pantalla antes de mostrar resultados.
- Modales `max-w-*` no siempre son la mejor solucion en mobile; bottom sheet es mas ergonomico para seleccion/confirmacion.

Mejoras recomendadas:

1. Convertir tablas criticas a listas mobile:
   - titulo: producto/proveedor/documento.
   - meta compacta: fecha, area, estado.
   - cantidad/precio como dato destacado.
   - acciones en menu o fila inferior.

2. Filtros mobile:
   - Mostrar busqueda y 1 filtro principal arriba.
   - Mover filtros secundarios a sheet.
   - Mostrar chips activos bajo busqueda.
   - Boton "limpiar" visible solo si hay filtros activos.

3. Acciones persistentes:
   - Usar bottom bar solo para accion primaria.
   - Asegurar `pb-20` o equivalente cuando exista barra fija.
   - Evitar dos elementos fixed compitiendo abajo.

4. Formularios:
   - Campos en una columna.
   - Labels cortos.
   - Inputs numericos con step/controles claros.
   - Errores debajo del campo.
   - Secciones colapsables solo si el formulario es largo.

5. Conteo mobile:
   - La vista de un item a la vez es una buena direccion.
   - Mantener foco en lote/cantidad/diferencia.
   - Agregar confirmacion fuerte para diferencias grandes.
   - Botones grandes y separados: contado, no contado, siguiente.

6. Recepcion mobile:
   - Mantener wizard.
   - El scanner y seleccion de lote deben ocupar casi toda la pantalla cuando esten activos.
   - Las etiquetas deben aparecer al final, no competir con ingreso de items.

7. Densidad:
   - Reducir padding de cards repetidas a 12-14px.
   - Evitar `rounded-3xl` en listas de alta frecuencia.
   - Usar `text-sm` y `text-xs` de forma consistente.

Checklist mobile:

- 375px: no hay texto cortado en botones principales.
- 390px: no hay overflow horizontal salvo tablas deliberadas.
- 430px: filtros no empujan resultados fuera del primer viewport.
- Teclado abierto: input activo no queda tapado por bottom bar.
- Scanner: viewport de camara no queda cortado.
- Modales/sheets: siempre hay forma clara de cerrar.

### Desktop

Problemas probables:

- `main` usa `max-w-6xl`; en pantallas grandes puede desaprovechar espacio para flujos que necesitan comparacion.
- Algunas pantallas usan paneles laterales sticky, pero el contenido puede quedar demasiado estrecho si cards tienen padding/radios grandes.
- Cards grandes con sombras fuertes pueden hacer que herramientas operativas parezcan menos densas.
- Listados con tablas deben priorizar columnas realmente utiles y ocultar ruido.

Mejoras recomendadas:

1. Layout por tipo de pantalla:
   - Dashboard: max width moderado, metricas y alertas.
   - Stock/consumos/recepciones/solicitudes: layout amplio `max-w-[1400px]` o ancho fluido.
   - Configuracion/setup: `max-w-2xl` o `max-w-3xl` esta bien.

2. Panel maestro-detalle:
   - Lista a la izquierda, detalle a la derecha.
   - Detalle sticky con altura `calc(100vh - header - breadcrumb - padding)`.
   - En desktop grande, usar grid estable, por ejemplo `minmax(0,1fr) 420px`.

3. Tablas:
   - Header sticky solo dentro del contenedor de tabla.
   - Columnas numericas alineadas a la derecha.
   - Estados con badges compactos.
   - Acciones al final, iconos con tooltip.
   - No usar demasiada altura de fila si la tabla es operativa.

4. Filtros desktop:
   - Una barra horizontal compacta.
   - Filtros secundarios en popover o fila colapsable.
   - Guardar altura estable para evitar saltos de layout.

5. Sidebar:
   - El hover-expand es util, pero puede molestar en desktop si se abre accidentalmente.
   - Considerar preferencia persistida: colapsado, expandido o expandir al hover.
   - Mantener tooltip solo en colapsado.

6. Espaciado:
   - Usar gaps de 16-20px entre regiones principales.
   - Cards repetidas: padding 12-16px.
   - Paneles principales: padding 16-20px.
   - Evitar `rounded-[2.5rem]` en componentes densos; preferir 8-12px salvo modales o elementos destacados.

7. Jerarquia visual:
   - Titulo de pagina: una linea con accion primaria a la derecha.
   - Subtexto solo si aporta decision operativa.
   - Metricas arriba solo cuando cambian la accion del usuario.
   - El contenido de trabajo debe empezar temprano en el viewport.

Checklist desktop:

- 1366x768: se ve titulo, filtros esenciales y primeros resultados sin scroll excesivo.
- 1440x900: panel detalle no supera el alto disponible.
- 1920x1080: el layout aprovecha ancho sin estirar lineas de texto.
- Sidebar expandida/colapsada no produce saltos bruscos.
- Tablas no esconden columnas clave innecesariamente.
- Las acciones principales estan siempre en el mismo lugar.

### Pantallas a revisar primero

1. Stock:
   - Es pantalla central y se beneficia de maestro-detalle.
   - Ajustar ancho desktop y card/list density.
   - Mobile debe priorizar busqueda, estado y accion.

2. Consumos:
   - Buen patron con drawer/carrito.
   - Revisar que el drawer mobile no tape lista ni confirmacion.
   - En desktop, carrito lateral debe ser compacto y siempre visible.

3. Recepciones:
   - Wizard mobile correcto.
   - Desktop debe aprovechar panel lateral para resumen, no esconder demasiado contenido.
   - Etiquetas y fotos deben estar separadas de la confirmacion principal.

4. Solicitudes de compra:
   - Pantalla compleja; requiere jerarquia fuerte.
   - Separar revision, proveedor, carrito y historial.
   - Reducir radios/padding para ver mas items por viewport.

5. Conteo:
   - Mobile ya tiene enfoque correcto.
   - Desktop puede usar agrupacion por producto/lote con diferencias visibles.

6. Creador de productos:
   - Archivo y pantalla muy grande.
   - Dividir UI y usar layout de formulario lateral o modal segun breakpoint.
   - Evitar que tabs, filtros y formularios empujen la tabla demasiado abajo.

## 15. Definicion de "terminado"

Este plan puede considerarse ejecutado cuando:

- No hay credenciales productivas hardcodeadas.
- Uploads privados requieren autorizacion.
- Backups/restores estan probados.
- Todas las operaciones criticas son idempotentes.
- Cantidades/precios usan Decimal de forma consistente.
- Query keys estan unificadas.
- Hay E2E minimo de flujos criticos.
- Se verificaron capturas mobile/desktop sin overflow, solapamientos ni desperdicio grave de espacio.
- El checklist de release se ejecuta antes de entregar.

