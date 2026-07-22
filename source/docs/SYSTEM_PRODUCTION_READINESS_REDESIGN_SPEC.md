# Especificación maestra de rediseño y preparación para producción

**Sistema:** Tareapython / Inventario de Laboratorio  
**Estado de esta especificación:** normativa, implementable y bloqueante para liberación  
**Fecha de consolidación:** 2026-07-21  
**Commit auditado por las fuentes:** `fac5ffa6147e6e18a42028cd086545ca467fe7f1`  
**Idioma del artefacto:** español neutral/profesional  
**Decisión de release vigente:** **NO-GO**  
**Ámbito:** base de datos, dominio, backend Rust/Axum, API, frontend React, importación, operación y despliegue

> Este documento no es una lista de ideas. Es el contrato de reconstrucción del sistema. Las palabras **DEBE**, **NO DEBE**, **DEBERÍA** y **PUEDE** se usan con sentido normativo. Un requisito solo se considera cumplido cuando existe evidencia automatizada del efecto persistido; un toast, un `2xx` o un estado local no constituyen éxito.

---

## 1. Veredicto ejecutivo y cómo leer/implementar esta especificación

### 1.1 Veredicto

El sistema **NO está preparado para producción**. Tiene un camino feliz funcional y una base de pruebas valiosa, pero conserva fallas demostradas de identidad, integridad histórica, verdad operacional, aislamiento entre usuarios, autorización, atomicidad percibida y operación de release.

Los bloqueadores de mayor impacto son:

1. La aprobación de un producto puede reescalar movimientos históricos y `stock`, dejar `stock_snapshot` divergente y colapsar varias presentaciones.
2. El `PUT /productos/{id}` actual puede borrar campos omitidos y el formulario puede sobrescribir datos que el detalle no devolvió.
3. PostgreSQL admite estados de catálogo que Rust/TypeScript no pueden decodificar; el propio importador crea uno de ellos.
4. Reactivar puede producir un producto visible y activo con `deleted_at` aún informado.
5. Producto, presentación, lote, recepción y compras carecen de una invariante compuesta de pertenencia.
6. Los códigos comerciales no comparten un namespace global y el escáner resuelve colisiones de forma arbitraria.
7. La plantilla activa del importador puede fallar con sus propios valores de ejemplo.
8. La idempotencia se identifica globalmente por clave y puede devolver a un usuario la respuesta de otro.
9. La importación atómica de stock puede responder éxito y contar filas como importadas después de un rollback total.
10. El escáner móvil publicitado como público queda bloqueado detrás del middleware autenticado.
11. La configuración administrativa expone datos sensibles a cualquier autenticado y el descubrimiento de modelos acepta destinos de red aportados por el cliente sin defensa SSRF suficiente.
12. Recepciones tiene contratos frontend inexistentes, escrituras compuestas no reanudables y descarte silencioso de líneas incompletas.
13. Los gates de release están rojos: lint, formato, Clippy y `cargo check --all-targets`; además, no hay CI, persistencia demostrada de uploads ni recuperación probada.

**Decisión arquitectónica central:** reconstruir el esquema de desarrollo alrededor de un agregado de catálogo coherente, presentaciones revisionadas e inmutables, registro global de identificadores, ledger append-only, una sola proyección de saldo, readiness por capacidad, importación durable y contratos API generados. El workspace está en desarrollo activo y autoriza recrear tablas; por ello se privilegia una reconstrucción limpia sobre una cadena de parches de compatibilidad.

### 1.2 Qué queda congelado hasta corregir los P0

| ID | Superficie congelada | Regla temporal |
| --- | --- | --- |
| `DOM-FREEZE-001` | Aprobación con cambio de presentación/factor | El backend DEBE rechazar el cambio de factor durante aprobación. Aprobar solo cambia metadata/estado. |
| `API-FREEZE-001` | Edición genérica de producto | No se habilita edición si el read model no contiene todos los campos editables; el `PUT` destructivo se reemplaza por `PATCH`. |
| `UI-SCAN-FREEZE-001` | QR de escáner móvil | Ocultar o marcar no disponible hasta publicar el endpoint token-scoped y ack durable. |
| `UI-CREADOR-FREEZE-001` | Pestaña Ofertas | Ocultar con feature flag hasta que las rutas reales y contract tests estén verdes. |
| `UI-RECEPCIONES-FREEZE-001` | Confirmación con líneas incompletas | El botón DEBE quedar bloqueado; no se permite filtrar líneas implícitamente. |
| `OPS-FREEZE-001` | Release | No desplegar mientras exista un P0/P1 abierto o un gate obligatorio rojo. |

### 1.3 Cómo usar este documento

1. **Leer primero las decisiones únicas de la sección 5.1.** Evitan implementar modelos incompatibles de estado, importación, stock o recepción.
2. **Seleccionar un work unit de la sección 8.** No implementar por capas técnicas aisladas; cada unidad entrega comportamiento, pruebas, evidencia y rollback.
3. **Tomar los IDs como contrato trazable.** Un PR debe declarar qué IDs satisface, cuáles deja pendientes y qué comandos prueban el efecto.
4. **Aplicar RED → GREEN → REFACTOR.** Primero se reproduce el defecto o se fija el escenario; luego se implementa la mínima conducta; finalmente se limpia sin cambiar el resultado.
5. **Verificar la persistencia.** Después de cada mutación se debe comprobar respuesta, lectura canónica/refetch, base/proyección y auditoría.
6. **No sustituir dominio por UX.** Deshabilitar un botón ayuda, pero la misma invariante DEBE existir en comando/servicio y base cuando sea posible.
7. **No sustituir revisión por totales de tests.** Se exige evidencia por flujo y riesgo, no solo un número agregado.

> **Nota normativa de mapeo de rutas (2026-07-21).** Esta especificación conserva
> referencias AS-IS al checkout auditado para que sus líneas y evidencias sigan siendo
> trazables. Para toda implementación nueva, comando de la sección 8 y artefacto creado
> por `WU-00..23`, se aplica el siguiente mapeo. No se deben recrear las rutas legacy.

| Referencia histórica en este documento | Ruta autoritativa actual |
| --- | --- |
| `backend/` | `source/backend/` |
| `backend/migrations/` y la antigua copia raíz `migrations/` | `source/backend/migrations/` (única autoridad) |
| `codigofuente/frontend/` | `source/frontend/` |
| `scripts/` | `source/tooling/` |
| `SYSTEM_PRODUCTION_READINESS_REDESIGN_SPEC.md` en raíz | `source/docs/SYSTEM_PRODUCTION_READINESS_REDESIGN_SPEC.md` |

Las referencias de evidencia de las secciones 2–4 describen el commit auditado y NO se
reinterpretan como paths actuales. Los requisitos, IDs, gates y orden de work units no
cambian por esta reorganización.

### 1.4 Convención de IDs y estados de avance

| Prefijo | Dominio | Ejemplo |
| --- | --- | --- |
| `DB-*` | esquema, constraints, transacciones, proyecciones | `DB-INV-005` |
| `DOM-*` | agregado, value objects, estados, invariantes | `DOM-PRODUCT-004` |
| `API-*` | DTO, endpoint, error, paginación, idempotencia | `API-PRODUCT-004` |
| `UI-<AREA>-*` | ruta, destino, diálogo o interacción | `UI-RECEPCIONES-D06` |
| `OPS-*` | configuración, seguridad, observabilidad, CI/CD, recuperación | `OPS-DB-ISOLATION-001` |
| `TEST-*` | prueba o gate reproducible | `TEST-IDEMPOTENCY-003` |

Estados permitidos para seguimiento: `pending`, `red`, `green`, `refactored`, `verified`, `blocked`. `verified` requiere comando, resultado, artefacto y SHA del candidato.

Las referencias agregadas `PREFIJO-*`, `ID-001..NNN` y `WU-AA..BB` solo son válidas cuando el linter puede expandirlas a IDs definidos en este documento; cualquier ID exacto no definido o rango vacío falla CI mediante `OPS-DOC-LINT-001`.

### 1.5 Definición normativa de éxito

`DOM-SUCCESS-001`: una acción se considera exitosa únicamente si se cumplen **todas** las condiciones aplicables:

1. el comando fue autorizado para el actor y alcance correctos;
2. la transacción comprometió exactamente los efectos declarados;
3. la respuesta canónica identifica `operation_id`, recurso, versión y `persisted_at`;
4. un GET/refetch posterior observa la nueva versión;
5. ledger y proyección coinciden cuando hay inventario;
6. existe auditoría con actor, causa, correlación y diff seguro;
7. un replay idempotente no duplica la mutación;
8. un fallo parcial se comunica como `partial`, nunca como `success` total;
9. la UI invalida/refresca los recursos afectados y no depende de un toast para afirmar el resultado.

---

## 2. Evidencia y método de verificación

### 2.1 Fuentes consolidadas

| Fuente | SHA-256 | Uso en esta especificación |
| --- | --- | --- |
| `/tmp/tareapython-audit/domain-product.md` | `9ca68a67433b44894098218df05d0f3f73f3f21215d1eddcfda9ddf1eda5f844` | Contrato AS-IS de Producto, reproducciones de integridad y propuesta inicial. |
| `/tmp/tareapython-audit/ui-workflows.md` | `dda6e0fc343a9fd3111f7d817ee1f095216bdfc3a0abc7f276b5fd1d002ff219` | Inventario de 23 rutas, 16 grupos, 50 destinos, permisos y falsos éxitos. |
| `/tmp/tareapython-audit/runtime-production.md` | `98d6cf8b392ad54823a1197dd0af7788d4ec55980201dac3e5a5a9c7b8d1c7dd` | Runtime local, gates, despliegue, idempotencia, rollback e incidente DB. |
| `/tmp/tareapython-audit/product-audit-test-2.log` | `a7f5cb44d8a9369bf50517444dd38140f44c4258232fc784df1b7d297b912308` | Harness sintético del dominio Producto. |
| `/tmp/tareapython-audit/logs/frontend_test.log` | `76b563fe8477bcc127ed7997ddb31aa9929f8515f241af2796a063a8b0b36f59` | 96 pruebas frontend aprobadas. |
| `/tmp/tareapython-audit/logs/backend_check.log` | `8f5f32cd6fe1cdbf76f85e8b920a40a753e832398415ed16e91f3e381ebeb0ae` | Falla `E0061` del target `catalogacion_tests`. |
| `SETUP_BULK_IMPORTER_AUDIT.md` | Contexto local no rastreado previo | Contrato CSV, pérdidas silenciosas y límites del importador directo. |
| `SMART_IMPORTER_MARKET_LEADER_DESIGN.md` | Contexto local no rastreado previo | Intención de UX de mapping, grid y limpieza. |
| `SMART_IMPORTER_V3_DESIGN.md` | Contexto local no rastreado previo | Intención de duplicados, vistas compactas y campos inline. |

Los tres documentos de contexto existentes se leyeron, pero no se editaron ni se tratan como evidencia ejecutada. Sus decisiones incompatibles se resuelven expresamente en 5.1.

### 2.2 Método ejecutado por las auditorías

| Capa | Método | Entorno | Resultado |
| --- | --- | --- | --- |
| Estructura/código | CodeGraph actualizado; 452 archivos, 14.435 nodos, 61.929 aristas en la auditoría | Checkout del commit auditado | Mapa DB → Rust → API → React. |
| Producto | Harness Rust desde `git archive HEAD` | PostgreSQL 16 efímero; migraciones `[1,2]` | 1 prueba de caracterización aprobada que demuestra los defectos actuales. |
| Frontend | Vitest, TypeScript, Vite, ESLint | Dependencias locales instaladas | 96/96 tests, typecheck y build pasan; lint falla 46/10. |
| Backend | Unitarios e integraciones compilables | PostgreSQL local desechable después del incidente | 86 unitarios + 173 integraciones pasan; 2 ignoradas fallan; all-targets no compila. |
| Runtime dirigido | HTTP + consultas DB sobre servidor local | PostgreSQL local desechable | Auth/roles/recepción happy path; P0 de idempotencia y rollback reproducidos. |
| Release | Lectura de Dockerfile, `render.yaml`, config y health | Sin tocar producción | Brechas de secretos, uploads, readiness, CI, backup y trazabilidad. |

No se reejecutaron suites para redactar este documento. Se contrastaron los informes, logs y evidencias ya generados, y se hicieron spot-checks de nombres/rutas P0 con CodeGraph sobre el código actual.

### 2.3 Clasificación de afirmaciones

| Etiqueta | Significado | Uso permitido |
| --- | --- | --- |
| **PROBADO** | Ejecutado sobre PostgreSQL/runtime local o registrado por una suite/log con resultado exacto. | Puede ser gate de regresión directo. |
| **VERIFICADO EN CÓDIGO** | Camino determinístico contrastado en fuente/CodeGraph, sin ejecutar el límite externo. | Debe convertirse en prueba antes de cerrar el requisito. |
| **INFERIDO** | Consecuencia razonable de configuración/diseño, no observada end-to-end. | No puede presentarse como incidente ocurrido. |
| **NO PROBADO** | Fuera de alcance o sin entorno seguro. | Requiere trabajo futuro explícito. |

### 2.4 Resultados ejecutados y límites

| ID | Evidencia | Clasificación | Resultado exacto |
| --- | --- | --- | --- |
| `TEST-EVIDENCE-001` | `product-audit-test-2.log` | PROBADO | `1 passed, 0 failed`; reproduce PUT destructivo, zombi, enum, plantilla, códigos y aprobación. |
| `TEST-EVIDENCE-002` | `logs/frontend_test.log` | PROBADO | 14 archivos, 96 tests aprobados. |
| `TEST-EVIDENCE-003` | `logs/frontend_typecheck.log`, `logs/frontend_vite_build.log` | PROBADO | Typecheck exit 0; build Vite exit 0, 3.022 módulos. |
| `TEST-EVIDENCE-004` | `logs/frontend_lint.log` | PROBADO | Exit 1; 46 errores, 10 advertencias. |
| `TEST-EVIDENCE-005` | `logs/backend_lib_local.log`, `logs/backend_test_*_local.log` | PROBADO | 259 pruebas aprobadas entre targets compilables. |
| `TEST-EVIDENCE-006` | `logs/backend_check.log` | PROBADO | `E0061`; `catalogacion_tests.rs:458` usa firma obsoleta. |
| `TEST-EVIDENCE-007` | `logs/backend_ignored_idempotency_local.log` | PROBADO | 0 aprobadas, 2 fallidas por FK de usuario. |
| `TEST-EVIDENCE-008` | `logs/backend_fmt.log` | PROBADO | Formato falla en 4 archivos. |
| `TEST-EVIDENCE-009` | `logs/backend_clippy.log` | PROBADO | 48 errores lib; 59 lib-test con `-D warnings`. |
| `TEST-EVIDENCE-010` | `evidence/idem_*` | PROBADO | Dos usuarios reciben mismo body/status; stock 100→90→90. |
| `TEST-EVIDENCE-011` | `evidence/stock_mixed_*` | PROBADO | HTTP 200, `importados=1`; DB: 0 lotes, 0 movimientos. |
| `TEST-EVIDENCE-012` | `evidence/batch_mapping_*` | PROBADO | Mapping persistido; `normalized={}`; fila en error. |

**Límites:** no se inspeccionó ni atacó producción, no hubo navegador local, cámara real, lector de pantalla, carga/soak, fuzzing, proveedor IA/WhatsApp real, scan de vulnerabilidades ni restore drill. El bundle de una URL publicada no se comparó con estos bytes. La ausencia de evidencia de backup no prueba pérdida actual; prueba que la recuperación no está demostrada.

### 2.5 Matriz de pruebas sintéticas y resultados reales

| ID | Input/precondición | Operación | Esperado sano | Resultado real | Resultado/evidencia |
| --- | --- | --- | --- | --- | --- |
| `TEST-SYN-001` | Producto completo válido | `POST /productos` | `201`, estado/readiness coherente | `201`, ready | PASS del happy path; `product-audit-test-2.log`. |
| `TEST-SYN-002` | Solo nombre | `POST /productos` | `incomplete` reparable o 422 | Activo, aprobado, unidad nula, no ready | FAIL de contrato; mismo log. |
| `TEST-SYN-003` | mínimos/promedio/días negativos | Crear producto | 422/constraint | 201 y valores negativos persistidos | FAIL; mismo log. |
| `TEST-SYN-004` | GET detalle → defaults → guardar | Editar producto | No-op | `control_lote`, fabricante y kit sobrescritos | FAIL; `producto_service.rs:406-477`, `productos-tab.tsx`. |
| `TEST-SYN-005` | `{"version":1}` | `PUT /productos/{id}` | 422 o no-op | 200; nombre vacío y campos nulos | FAIL; `handlers/productos.rs:278-289`, `ProductoService::actualizar_producto`. |
| `TEST-SYN-006` | Dos PUT con misma versión | Concurrencia | Uno 200, uno conflicto | Exactamente 200/409 | PASS de optimistic lock existente. |
| `TEST-SYN-007` | delete → reactivate | Reactivar | `deleted_at=NULL`, versión/auditoría | activo=true y `deleted_at` no nulo; readiness 0 | FAIL; `reactivar_producto` líneas 659-680. |
| `TEST-SYN-008` | CSV sin unidad | Importar y editar | Cuarentena decodificable | Importa; editar responde 500 por `incompleto` | FAIL; DB admite estado que Rust no modela. |
| `TEST-SYN-009` | Fila ejemplo `simple`, `Ambiente`, `Clase I` | Importar plantilla | Commit válido | CHECK 23514, `committed=0` | FAIL; `product-audit-test-2.log`. |
| `TEST-SYN-010` | GTIN en producto A y alias igual en B | Agregar código y escanear | Rechazar globalmente | 201; escáner elige A | FAIL; `agregar_codigo` solo contrasta barcode. |
| `TEST-SYN-011` | Saldo/movimiento/snapshot 10; factor 1→2 | Aprobar producto | Solo transición | stock 20, movimiento 20, snapshot 10; versión/audit sin cambio | FAIL crítico; `approve_product` líneas 1428-1590. |
| `TEST-SYN-012` | Lote de A con presentación de B | Inserción/recepción | FK reject | Inserción aceptada | FAIL de integridad compuesta. |
| `TEST-SYN-013` | Campo Lab requerido sin valor | Evaluar readiness | No ready | ready=true | FAIL; readiness incompleto. |
| `TEST-SYN-014` | Dos columnas tipadas de un custom value | INSERT directo | CHECK reject | Aceptado | FAIL de shape. |
| `TEST-SYN-015` | Misma idempotency key, usuarios/payload distintos | Dos consumos | Aislamiento o 409 | Segundo recibe body 201 del primero; no muta | FAIL crítico; `evidence/idem_*`. |
| `TEST-SYN-016` | CSV stock: fila válida + producto inexistente | Importación atómica | rollback, `committed=false`, confirmadas 0 | HTTP 200, importados 1; DB 0/0 | FAIL crítico; `evidence/stock_mixed_*`. |
| `TEST-SYN-017` | Batch con headers `display,unitx` | Guardar mapping y validar | Recalcular `normalized` | Mapping persiste, `normalized={}` | FAIL; `evidence/batch_mapping_*`. |
| `TEST-SYN-018` | Teléfono sin JWT, token QR vigente | Scan público | Evento aceptado por token | Endpoint bajo router autenticado | VERIFICADO EN CÓDIGO; `App.tsx:119`, `routes.rs`, handler scanner. |
| `TEST-SYN-019` | Mismo GTIN escaneado dos veces | Scanner teléfono | Dos eventos | Segundo ignorado por `includes(code)` | VERIFICADO EN CÓDIGO. |
| `TEST-SYN-020` | Usuario `consulta` | GET config / descubrir IA | 403, PIN ausente | GET/POST sin role guard; PIN en DTO; URL cliente llega a `reqwest` | VERIFICADO EN CÓDIGO; explotación NO PROBADA. |
| `TEST-SYN-021` | Producto con oferta específica | Abrir Ofertas/recepción | Rutas reales y selección determinista | Frontend llama rutas ausentes y hace fallback | VERIFICADO EN CÓDIGO. |
| `TEST-SYN-022` | POST recepción ok; PUT foto 500 | Reintento | Reanudar adjunto por mismo ID | Handler UI recrea POST con clave nueva | VERIFICADO EN CÓDIGO; fallo externo NO PROBADO E2E. |
| `TEST-SYN-023` | 1 línea completa + 1 incompleta | Confirmar recepción | 0 requests; enfocar faltante | Se envía solo subconjunto válido | VERIFICADO EN CÓDIGO. |
| `TEST-SYN-024` | PATCH conteo con conflicto parcial | Guardar | Conservar conflictivo, resultado partial | UI ignora `conflictos` y muestra éxito | VERIFICADO EN CÓDIGO. |
| `TEST-SYN-025` | 250 productos / 230 movimientos | Buscar/listar | Acceso a todos por cursor | Requests 500/2000 se clamped a 100 | VERIFICADO EN CÓDIGO. |
| `TEST-SYN-026` | 401/403/500/red | Listados principales | Error explícito | Varias pantallas muestran vacío/cero | VERIFICADO EN CÓDIGO. |
| `TEST-SYN-027` | `cargo check --locked --all-targets` | Gate | Exit 0 | E0061, exit 101 | FAIL; `logs/backend_check.log`. |
| `TEST-SYN-028` | fmt/lint/Clippy | Gates | Exit 0 | Todos rojos | FAIL; logs respectivos. |
| `TEST-SYN-029` | Test sin `DATABASE_URL` explícita | Cargar runner | Rechazar remoto antes de conectar | `.env` alcanzó Neon y SQLx creó 5 DB `_sqlx_test_*` | INCIDENTE PROBADO; no se inspeccionó ni limpió remotamente. |
| `TEST-SYN-030` | DB desconectada | `/health` | Readiness no-2xx | HTTP 200 con body degradado | VERIFICADO EN CÓDIGO/configuración. |

### 2.6 Incidente de aislamiento de pruebas y control preventivo

`OPS-DB-ISOLATION-001`: registra el incidente sin reproducir secretos ni credenciales: un `cargo test --lib` sin `DATABASE_URL` explícita cargó `backend/.env`, alcanzó un PostgreSQL Neon remoto y SQLx creó cinco bases efímeras con prefijo `_sqlx_test_*`. La evidencia indica que esos tests usaron bases aisladas, no la base nominal; no autoriza afirmar que el estado remoto quedó intacto ni ejecutar limpieza sin un operador autorizado.

Control obligatorio:

1. un preflight DEBE parsear la URL sin imprimir credenciales;
2. DEBE exigir host local/allowlist de CI y nombre/prefijo de base de pruebas;
3. DEBE fallar cerrado antes de migrar o abrir pool si el destino no cumple;
4. dotenv NO DEBE cargarse implícitamente en tests;
5. un opt-in remoto excepcional debe ser explícito, temporal, auditado y estar fuera del flujo ordinario;
6. CI DEBE crear/destruir su PostgreSQL efímero propio;
7. la revisión/limpieza de las cinco bases queda como operación humana autorizada, no como instrucción automatizada de esta especificación.

### 2.7 Spot-checks actuales con CodeGraph

Los siguientes P0 fueron revalidados sobre código actual sin iniciar una auditoría nueva:

- `backend/src/domain/estados.rs:111-114`: `EstadoCatalogo` solo contiene `PendienteAprobacion` y `Aprobado`.
- `backend/src/services/producto_service.rs:520-612`: el update asigna directamente campos omitibles y mezcla `COALESCE` con reemplazo.
- `backend/src/services/producto_service.rs:659-680`: reactivación solo establece `activo=true` y audita fuera de transacción.
- `backend/src/services/producto_service.rs:1276-1330`: el alias contrasta únicamente `presentaciones.codigo_barras`, no GTIN/SKU.
- `backend/src/services/producto_service.rs:1428-1590`: aprobación reescala `stock`/`movimientos` y actualiza todas las presentaciones.
- `backend/src/handlers/configuracion.rs:13-16,48-61`: lectura y descubrimiento no aplican `require_role`.
- `codigofuente/frontend/src/App.tsx:74-120`: 23 rutas; `/scan/:token` queda fuera de `AppLayout`.
- `codigofuente/frontend/src/pages/recepciones/hooks/useRecepcionItems.ts:270-304`: contrato de presentaciones por proveedor falla a fallback silencioso.
- `backend/src/handlers/import_batches.rs:332-416`: el commit vuelve a serializar CSV y delega al importador legacy.

---

## 3. Análisis AS-IS del diseño de Producto y sus entidades relacionadas

### 3.1 Interpretación actual: no existe un único agregado Producto

`DOM-ASIS-001`: **estado actual verificado.** `productos` actúa simultáneamente como identidad comercial, metadata clínica, lifecycle, estado de catálogo, configuración de lotes, mínimos y promedio de consumo. Las capas no comparten una definición única de cuándo ese objeto existe, está completo, está aprobado o puede operar.

El objeto conceptual actual es:

```text
Producto actual
├── identidad parcial: productos.codigo_interno + aliases + códigos de presentación
├── clasificación: categoria + unidad base + áreas
├── lifecycle triple: activo + deleted_at + estado_catalogo
├── packaging mutable: presentaciones
├── comercial: proveedor/oferta/precio
├── inventario duplicado: movimientos -> stock y stock_snapshot
├── lote/recepción con referencias redundantes
├── planificación duplicada: producto_area + par_level_config
├── atributos dinámicos sin shape fuerte
└── importadores directo y durable con contratos distintos
```

No es un agregado porque una operación sobre “Producto” puede mutar varias raíces históricas sin una frontera coherente; tampoco es un read model, porque mezcla fuente de verdad con proyecciones.

### 3.2 Inventario de entidades y ownership actual

| ID | Entidad/tabla | Responsabilidad actual | Backend/API/frontend | Contradicción o riesgo |
| --- | --- | --- | --- | --- |
| `DB-ASIS-001` | `productos` | Identidad, metadata, estado, lote, mínimos, promedio | `Producto`, create/update, `/productos`, Creador/Setup | `activo`, `deleted_at` y `estado_catalogo` pueden divergir; unidad opcional frente a readiness. |
| `DB-ASIS-002` | `categorias` | Clasificación | DTO/servicio catálogo, pestaña Categorías | Longitud API 255 vs DB 100; FK nullable. |
| `DB-ASIS-003` | `unidades_basicas` | Unidad canónica | DTO/servicio, pestaña Unidades | Puede faltar al crear/importar y no existe camino uniforme de patch. |
| `DB-ASIS-004` | `areas` | Área/bodega | endpoints de áreas, filtros, recepción/stock | Catálogo y configuración operacional se mezclan. |
| `DB-ASIS-005` | `producto_area` | Asociación y mínimos/máximos | producto/área | Duplica política de reposición y carece de orden/no-negatividad. |
| `DB-ASIS-006` | `par_level_config` | Min/max/safety/lead time | planificación/reposición | Segundo dueño; permite múltiples globales por semántica de NULL. |
| `DB-ASIS-007` | `presentacion_formatos` | Catálogo de formato | pestaña Formatos | Relación incompleta en read models. |
| `DB-ASIS-008` | `presentaciones` | Nombre, factor, barcode, GTIN, SKU | servicio/handlers de presentaciones; Empaques/Recepción | Factor mutable altera interpretación histórica; IDs no están ligados de forma compuesta al producto en consumidores. |
| `DB-ASIS-009` | `producto_codigos_barras` | Alias secundarios | `/productos/{id}/codigos`, scanner | Namespace separado de barcode/GTIN/SKU. |
| `DB-ASIS-010` | `proveedores` | Proveedor y lifecycle | catálogo, recepción, compra | Estado activo no se aplica uniformemente a FKs/lecturas. |
| `DB-ASIS-011` | `ofertas_proveedor` | Precio/SKU por presentación/proveedor | Existe en DB/servicios parciales; UI llama rutas ausentes | Vigencia/selección no determinista; contrato HTTP incompleto. |
| `DB-ASIS-012` | `producto_precio_historial` | Historial de precios | lecturas de precios | Convive sin política única de vigencia/redondeo. |
| `DB-ASIS-013` | `solicitudes_compra` | Cabecera de demanda | `/solicitudes-compra`, wizard | Ownership/rol de mutaciones no está definido de forma central. |
| `DB-ASIS-014` | `solicitudes_compra_detalle` | Producto/unidad/presentación solicitada | detalle y conversión a OC | Copia referencias sin coherencia compuesta completa. |
| `DB-ASIS-015` | `ordenes_compra` | Orden al proveedor | lista/detalle OC | Lectura abierta aunque UI la presenta admin-only. |
| `DB-ASIS-016` | `ordenes_compra_detalle` | Producto/presentación/precio | OC/recepción | Producto y presentación pueden divergir. |
| `DB-ASIS-017` | `recepciones` | Cabecera/estado/guía | lista, nueva, detalle | Crear y adjuntar foto son dos operaciones que UI presenta como una. |
| `DB-ASIS-018` | `recepcion_detalle` | Producto/presentación/lote/cantidad/precio | `recepcion_service`, wizard | Referencias redundantes sin FK compuesta; líneas incompletas se pueden perder antes del request. |
| `DB-ASIS-019` | `reconciliacion` | Diferencias recepción/solicitud | modal de reconciliación | Hereda cualquier descarte de líneas o identidad errónea. |
| `DB-ASIS-020` | `lotes` | Lote por producto, presentación y vencimiento | stock, recepción, scanner | Número es único por producto, pero scanner lo consulta globalmente; presentación ajena aceptable. |
| `DB-ASIS-021` | `movimientos` | Ledger mutable de inventario | consumos/recepciones/descartes/conteos | La aprobación lo reescribe; no es append-only. |
| `DB-ASIS-022` | `stock` | Saldo por lote/área, escala 2 | stock y triggers | Una de dos autoridades; no toda mutación conserva escala/consistencia. |
| `DB-ASIS-023` | `stock_snapshot` | Segunda proyección por lote, escala 4 | reportes/readiness parciales | No se actualiza en aprobación; diverge. |
| `DB-ASIS-024` | `sesiones_conteo` | Cabecera de conteo | `/conteo` | Creación multiárea es una secuencia no atómica en UI. |
| `DB-ASIS-025` | `conteo_items` | Observación y versión por lote | `/conteo/{id}/items` | API devuelve conflictos en 200; UI los elimina del estado local. |
| `DB-ASIS-026` | `scanner_sessions` | Sesión temporal de escaneo | recepción QR | Endpoint prometido público está bajo auth global. |
| `DB-ASIS-027` | `scanner_items` | Códigos capturados/fetched | polling | `fetched=true` antes de ack permite pérdida de eventos. |
| `DB-ASIS-028` | `lab_campo_definicion` | Campo dinámico, tipo, alcance, required | config/schema/importer | `required` no participa en readiness. |
| `DB-ASIS-029` | `lab_campo_producto_valor` | Valor dinámico tipado por columnas | importador/lecturas | Puede poblar varias columnas; tipo/alcance no se valida completamente. |
| `DB-ASIS-030` | `import_batches` | Upload/mapping/status/revisión | `/setup/import-batches` | Existe, pero UI activa no lo usa y mapping no recompone rows. |
| `DB-ASIS-031` | `import_rows` | raw/normalized/diagnostics/outcome | batch handlers | Normalized puede quedar obsoleto; asociación por nombre puede vincular mal. |
| `DB-ASIS-032` | `import_transforms` | Transformaciones de staging | batch handlers | Mejor base, pero sin paridad end-to-end. |
| `DB-ASIS-033` | `audit_log` | Auditoría genérica | servicios/admin audit | Mutaciones críticas omiten audit o lo hacen fuera de la transacción. |
| `DB-ASIS-034` | `idempotency_keys` | Cache de respuestas | servicio compartido por comandos | PK lógica solo por key; no liga actor/ruta/hash. |
| `DB-ASIS-035` | filesystem `uploads/` | Imágenes/guías | handlers y Docker runtime | Efímero en despliegue declarado; reemplazo de imagen no atómico. |
| `DB-ASIS-036` | `configuracion` | Branding, reglas, PIN e integraciones | GET/PUT config, login branding | DTO administrativo expuesto a todo autenticado; PIN no debe ser reversible. |

### 3.3 Trazado DB → backend → API → frontend

| Concepto | Base de datos | Backend Rust | API actual | Frontend actual | Resultado observable |
| --- | --- | --- | --- | --- | --- |
| Estado catálogo | CHECK con 4 estados | Enum con 2 | `Producto` puede fallar al decodificar | `generated.ts` con 2 | Registro válido en DB produce 500. |
| Lifecycle | `activo` + `deleted_at` | delete/reactivate separados | listado filtra `activo`; readiness filtra `deleted_at` | Creador muestra reactivado | Producto zombi visible/no operativo. |
| Edición | columnas nullable/no nullable | DTO opcional → params parcialmente requeridos | `PUT` híbrido | GET detalle incompleto + defaults | Guardado destruye datos sin intención. |
| Presentación | factor mutable | approval/update CRUD | rutas generales; ofertas faltantes | Empaques/Ofertas/Recepción | Historia y selección proveedor inconsistentes. |
| Identificadores | 4 ubicaciones | consultas con precedencia/`LIMIT 1` | scan con side effect | scanner/assign modal | Colisión se resuelve silenciosamente. |
| Readiness | view débil | checks por canal | errores no uniformes | UI infiere estado | Canales discrepan sobre “operativo”. |
| Cantidad | numeric 2/4/6 | `Decimal` | JSON string parcial | tipos manuales `number` | Redondeos y precisión no gobernados. |
| Importación | batch + pipeline directo | dos implementaciones | UI usa directo | SmartImporter hard-coded | Preview/template/commit pueden divergir. |
| Recepción | cabecera/detalle/foto separada | servicio parcial | POST + PUT foto | una mutación visual | Duplicado/retry parcial. |
| Conteo | versionado por item | body con `conflictos` | 200 parcial | body ignorado | Falso éxito. |

### 3.4 Flujos de mutación actuales

1. **Crear manual:** formulario construye un payload que omite `promedio_uso_mensual_inicial` y puede incluir claves no aceptadas; backend permite aprobar sin unidad.
2. **Editar:** GET manual incompleto → defaults → PUT híbrido → update SQL con reemplazos/`COALESCE` distintos → audit parcial.
3. **Aprobar:** actualiza metadata/estado → toma una presentación arbitraria → reescala `stock` y `movimientos` → actualiza todas las presentaciones → commit sin snapshot/version/audit.
4. **Reactivar:** `activo=true` → audit separado; no limpia `deleted_at`.
5. **Importar producto directo:** parsea CSV hard-coded → valida parcialmente → crea incomplete/pending → UI no siempre puede editarlo.
6. **Importar batch:** persiste raw/normalized → mapping queda separado → commit regenera CSV y llama al pipeline directo.
7. **Recibir:** UI selecciona presentación general/fallback → POST cabecera/detalle → PUT foto → refetch; la pertenencia producto/presentación no está garantizada.
8. **Mover stock:** inserta movimiento y trigger/proyección; otras rutas escriben saldos/proyecciones de forma distinta.

### 3.5 Máquina de estados AS-IS y contradicciones

```text
DB:       incompleto | pendiente_aprobacion | aprobado | rechazado
Rust/TS:               pendiente_aprobacion | aprobado
Delete:   activo=false + deleted_at=timestamp
Reject:   puede soft-delete en vez de usar rechazado
Reactivate: activo=true, deleted_at permanece
```

La combinación real permite, entre otras, `(activo=true, deleted_at!=NULL, aprobado)`, `(activo=true, incomplete)` y registros `rechazado` que el modelo tipado no puede leer. No existe una transición única que incremente versión, audite y recalcule readiness.

---

## 4. Problemas y contradicciones del objeto Producto

### 4.1 Defectos P0/P1: estado, causa, objetivo y aceptación

| ID/prioridad | Estado actual verificado | Problema | Causa raíz | Especificación objetivo | Criterios de aceptación y evidencia |
| --- | --- | --- | --- | --- | --- |
| `DOM-P0-001` | Aprobación selecciona factor con `LIMIT 1`, reescala `stock`/`movimientos`, actualiza todas las presentaciones. | Corrupción de historia/proyecciones. | Packaging mutable y aprobación usada como corrección retroactiva. | Aprobar solo transiciona estado; factor usado es inmutable; correcciones son nuevas revisiones/eventos compensatorios. | `TEST-DOM-001`: aprobación deja hash/conteos de ledger/balance/package previos idénticos; solo cambia producto/audit/version. |
| `API-P0-001` | `PUT` omite nombre y lo convierte en vacío; otros campos se nulifican. | Pérdida de datos sin intención. | Semántica híbrida PUT/PATCH y DTO sin tri-state. | JSON Merge Patch con omitido/null/valor, `If-Match`, read model completo. | `TEST-API-001`: patch `{}` es no-op; omitido conserva; null solo borra nullable; ETag obsoleto=412. |
| `DOM-P0-002` | DB admite 4 estados; Rust/TS 2. | 500 al leer/importar estados válidos. | Máquina de estados duplicada manualmente. | Un enum canónico generado y transición exhaustiva. | Tests roundtrip DB/Rust/OpenAPI/TS para los 4 estados; ningún input de usuario produce 500. |
| `DB-P0-001` | Reactivar conserva `deleted_at`. | Producto activo visible pero fuera de readiness. | Doble/triple lifecycle y operación no transaccional. | Eliminar `activo`; vigencia derivada de `deleted_at`; reactivar limpia archivo, incrementa versión y audita. | Reactivar produce `deleted_at=NULL`, versión+1, audit y readiness recalculado. |
| `DB-P0-002` | Lote/orden/recepción aceptan producto A + presentación B. | Cantidad/costo pueden usar factor ajeno. | FKs simples sobre columnas redundantes. | FK compuesta `(package_revision_id, product_id)` o derivar producto. | SQL directo incompatible falla con FK; API devuelve 422 con path de campo. |
| `DB-P0-003` | Alias, barcode, GTIN y SKU viven separados. | Escaneo ambiguo y owner silencioso. | No hay registro/normalización global. | `producto_identificadores` global único con owner XOR. | Ningún valor normalizado puede tener dos owners; lookup ambiguo nunca usa `LIMIT 1`. |
| `API-P0-002` | Plantilla genera valores fuera del vocabulario DB. | Plantilla oficial no es ejecutable. | Listas hard-coded y traducciones legacy. | Templates/mapping/validación derivados de schema: producto y política de inventario son recursos separados. | Plantillas mínima/completa de producto y plantilla de políticas se importan sin editar; allowed values coinciden byte a byte con schema. |
| `OPS-P0-001` | Cache idempotente busca solo `key`. | Replay cruzado y divulgación/falso éxito. | Identidad no incluye actor/método/ruta/hash. | Clave compuesta + request hash + claim transaccional. | Mismo usuario/hash replay exacto; distinto actor no ve respuesta; mismo scope/payload distinto=409. |
| `API-P0-003` | Rollback total responde 200/importados 1. | Operador cree que hay stock inexistente. | Contador pre-commit y contrato sin `committed`. | Contadores procesadas/válidas/confirmadas/rechazadas; éxito solo post-commit. | Archivo mixto atómico: status no ambiguo, `committed=false`, confirmadas 0, DB 0. |
| `UI-SCAN-P0-001` | QR público llama endpoint protegido; dedupe por código; fetched sin ack. | Flujo imposible/pérdida de eventos. | Ruta y protocolo no diseñados como sesión token-scoped. | Endpoint público mínimo, token hash+TTL+rate limit, event sequence y ack. | Teléfono sin JWT envía dos códigos iguales; estación recibe dos exactamente una vez, incluso tras pérdida de respuesta. |
| `UI-CONFIG-P0-001` | GET config/POST IA sin rol; PIN retornado; URL arbitraria. | Exposición y riesgo SSRF. | DTO único, sidebar como pseudo-control y cliente HTTP sin egress policy. | Config admin separada, PIN hash, capability guard, allowlist/validación DNS/redirecciones. | consulta=403; PIN nunca sale; loopback/privada/link-local se rechazan antes de request. |
| `API-P0-004` | UI llama presentaciones por proveedor/ofertas que router no publica. | Empaque/precio erróneo o pestaña muerta. | Frontend diseñado contra API imaginada. | Contratos de ofertas/presentaciones implementados o feature flag off. | Contract test arranca Router Axum y prueba método/ruta/rol/schema; no hay fallback silencioso. |
| `UI-RECEPCIONES-P0-001` | POST recepción y PUT foto con claves nuevas; URL se envía como base64. | Duplicado y falso fracaso parcial. | Operación compuesta sin `operation_id`/`upload_id`. | Upload durable previo + command de recepción que referencia `upload_id`; retry de misma intención. | Si storage/commit falla, no duplica; estado parcial/reanudable es explícito. |
| `UI-RECEPCIONES-P0-002` | `filter(validos)` envía subconjunto de líneas visibles. | Descarte silencioso de intención. | Validación solo exige al menos una válida. | Todas las líneas no excluidas deben ser completas; excluir es acción explícita con motivo. | Con 1 completa+1 incompleta se emiten 0 requests y se enfoca la incompleta. |
| `UI-CONTEO-P1-001` | Body 200 con conflictos se ignora y limpia estado local. | Falso éxito/pérdida de edición. | Resultado booleano en UI frente a contrato parcial. | Guardar draft retorna outcome `partial` y conserva conflictos; confirmar es atómico. | Solo líneas draft persistidas se limpian; conflicto de confirmación produce 0 movimientos/saldos y mantiene sesión editable. |
| `API-PAGINATION-P1-001` | `per_page` alto se limita a 100 silenciosamente. | Catálogo/historial truncado. | Cliente usa precarga masiva; servidor clampa sin señal. | Cursor/search remoto; límite validado, no truncado. | Producto 201 y movimiento 230 son accesibles; UI muestra cursor/total disponible. |
| `UI-STATE-P1-001` | 401/403/500/red se presentan como vacío/cero/default. | Decisión basada en ausencia falsa. | Componentes no modelan query state exhaustivo. | `AsyncResourceState` compartido; empty solo tras 2xx. | Tests por pantalla distinguen empty/error/stale/retrying. |
| `DB-P1-001` | Campos Lab required no afectan readiness y shape acepta varias columnas. | Producto “ready” con metadata obligatoria ausente. | Readiness fija y value storage débil. | Readiness evalúa definiciones activas; valor JSON tipado validado por trigger. | Required faltante bloquea submit/approve; tipo incompatible falla 422/constraint. |
| `DB-P1-002` | `producto_area` y `par_level_config` poseen mínimos/máximos. | Políticas contradictorias. | Ownership duplicado. | `InventoryPolicy(product_id,area_id)` único; assignment sin umbrales. | Una por producto+área; `safety=0`, max nullable, demanda baseline >=0 y checks de orden. |
| `DOM-P1-001` | Escalas numeric 2/4/6 y TS number/string. | Redondeo no predecible. | Sin value objects por concepto. | `Quantity`, `Money`, `ConversionFactor`; JSON decimal string; políticas explícitas. | Property tests de roundtrip y redondeo; sin conversión IEEE-754 en frontera. |
| `OPS-P1-001` | all-targets/lint/fmt/Clippy rojos; no CI. | No existe gate reproducible. | Calidad manual y tests excluidos/ignorados. | CI obligatorio sobre DB efímera con todos los gates. | Todos los comandos de 8.5 terminan 0 en SHA candidato. |
| `OPS-P1-002` | Upload local efímero, health 200 degradado, secreto refresh no declarado. | Deploy no autosuficiente/recuperable. | Manifiesto incompleto y liveness/readiness mezclados. | Object storage, secretos declarados, endpoints separados y backup/restore. | Redeploy conserva archivo; DB caída vuelve readiness no-2xx; restore drill cumple RPO/RTO. |

### 4.2 Reproducciones críticas y falsos éxitos

#### 4.2.1 Aprobación destructiva

```text
Antes:  stock=10.00, movimiento=10.00, snapshot=10.0000, version=1, audit_count=1
Acción: aprobar con pres_factor=2
Después: stock=20.00, movimiento=20.00, snapshot=10.0000, version=1, audit_count=1
Presentaciones: 2 filas; ambas terminan con un solo nombre/factor lógico
```

**Causa raíz:** se confunde “corregir el factor de empaque” con “reescribir la unidad de todos los hechos históricos”. **Regla objetivo:** los hechos se corrigen con reversa/ajuste, no con UPDATE.

#### 4.2.2 PUT y edición roundtrip

```text
Input: PUT {"version": 1}
Real: 200 OK; nombre='', descripcion=NULL, categoria_id=NULL,
      ubicacion=NULL, fabricante=NULL
```

Separadamente, GET detalle omite `control_lote`, `fabricante`, `es_kit`; el formulario aplica `con_vto`, `""`, `false` y los reenvía. Son dos defectos distintos y ambos deben tener tests.

#### 4.2.3 Falsos éxitos/fracaso/vacío

| ID | Señal UI/API | Estado persistido posible | Clasificación objetivo |
| --- | --- | --- | --- |
| `DOM-FALSE-001` | “Producto aprobado” | Ledger/proyecciones divergentes | Debe ser imposible por invariante. |
| `API-FALSE-001` | `importados:1`, HTTP 200 | Rollback total; 0 lotes/movimientos | `rejected`, `committed=false`. |
| `UI-FALSE-001` | “Documento vinculado” | Solo existe URL de análisis; no vínculo | `pending_attachment` hasta refetch. |
| `UI-FALSE-002` | Error al adjuntar | Recepción ya creada | `partial` reanudable con ID. |
| `UI-FALSE-003` | “Recepción confirmada” | Faltantes filtrados | Bloqueo previo; nunca éxito parcial implícito. |
| `UI-FALSE-004` | “Cambios guardados” | Draft de conteo contiene conflictos | `partial` con líneas conflictivas; confirmar con cualquier conflicto se rechaza completo. |
| `UI-FALSE-005` | “Sin resultados/stock” | Query 401/403/500/red | `error`, nunca `empty`. |
| `UI-FALSE-006` | Ofertas vacías | Ruta no existe | Capability disabled o error de contrato. |
| `UI-FALSE-007` | Scanner sin cambio | Evento marcado fetched, respuesta perdida | pending hasta ack. |

### 4.3 Contradicciones que NO deben resolverse con parches locales

1. Hacer que Rust acepte `incompleto` sin corregir transiciones solo vuelve decodificable un modelo contradictorio.
2. Limpiar `deleted_at` sin eliminar la doble autoridad `activo` deja abierta otra combinación inválida.
3. Agregar más checks al scanner sin un registry global mantiene precedencias ambiguas.
4. Actualizar también `stock_snapshot` durante aprobación haría consistente una corrupción; no vuelve válida la reescritura histórica.
5. Aumentar `per_page` a 2000 desplaza el truncamiento y degrada rendimiento; no reemplaza paginación/búsqueda.
6. Añadir toasts a errores parciales no crea atomicidad, idempotencia ni read-after-write.
7. Completar mocks de Ofertas sin contract tests perpetúa una API imaginada.

---

## 5. Propuesta TO-BE y rediseño de un Producto representativo

### 5.1 Decisiones únicas para resolver especificaciones previas contradictorias

| ID | Contradicción previa | Decisión normativa | Razón y tradeoff |
| --- | --- | --- | --- |
| `DOM-DEC-001` | “Importación estricta” frente a “ingestión name-only a cuarentena”. | **Validación estructural estricta + completitud de negocio permisiva en cuarentena.** Una fila sin nombre, con tipo inválido, código en colisión o referencia corrupta no es commiteable. Una fila con nombre/identidad válida pero sin unidad/categoría/atributos requeridos PUEDE persistirse como `incompleto`; queda visible para enriquecimiento y bloqueada para operar. | Evita basura no interpretable sin obligar a completar todo el catálogo antes de cargarlo. La alternativa “todo o nada por completitud” impide la carga inicial; la alternativa “aceptar cualquier token” rompe dominio. |
| `DOM-DEC-002` | Commit atómico frente a “éxito parcial”. | El commit de una **revisión de batch** es atómico. Antes del commit, el usuario DEBE corregir o excluir explícitamente las filas estructuralmente inválidas. Las filas business-incomplete no son errores: se confirman en cuarentena y se cuentan como `committed_incomplete`. | No hay rollback fantasma ni descarte implícito. Se conserva flexibilidad mediante staging y exclusión auditada, no mediante savepoints invisibles. |
| `API-DEC-001` | Corregir el endpoint directo primero frente a migrar a batch durable. | El **pipeline durable es el único target**. `/setup/importar-productos` PUEDE sobrevivir durante un work unit como adapter que crea/valida/commitea un batch; se elimina al probar paridad. Nunca mantendrá lógica propia. | La auditoría antigua recomendaba diferir la migración porque batch no tenía paridad. El código actual ya tiene sus tablas/rutas, pero sigue incompleto; ahora corresponde completar paridad y retirar la duplicación. |
| `DOM-DEC-003` | `activo`, `deleted_at` y estado catálogo. | Lifecycle se representa solo con `deleted_at`; catálogo se representa con `estado_catalogo`. No existe `activo`. Archivar no rechaza; reactivar no aprueba. | Dos ejes explícitos eliminan combinaciones zombis. |
| `DOM-DEC-004` | Factor mutable y reescalado histórico. | Una presentación tiene identidad lógica y **revisiones inmutables**. Cambiar factor crea una revisión futura; ledger siempre guarda cantidad base ya convertida. | Aumenta número de filas, pero preserva verdad histórica y simplifica auditoría. |
| `DB-DEC-001` | `stock` + `stock_snapshot`. | `movimientos` es ledger append-only; `stock` es la única proyección de saldo reconstruible. Cualquier snapshot analítico es checkpoint derivado, nunca autoridad transaccional. | Eliminar la segunda autoridad evita divergencia; reconstruir exige herramientas y métricas, previstas en operaciones. |
| `API-DEC-002` | PUT completo o PATCH parcial. | Se adopta `PATCH application/merge-patch+json` con `If-Match`; `PUT /productos/{id}` se depreca y luego se elimina. | PATCH tri-state expresa omitido/null/valor. PUT sería válido si el formulario enviara el recurso completo, pero hoy incrementa riesgo y payload. |
| `API-DEC-003` | Crear recepción+archivo atómico o saga. | El binario se sube primero a storage durable y se obtiene `upload_id`; después un único comando DB crea recepción y enlaza el upload en la misma transacción. Un upload no enlazado expira por cleanup idempotente. | Evita una transacción distribuida larga y permite reintento seguro sin recrear recepción. |
| `UI-SCAN-DEC-001` | Scanner público token-scoped o login/pairing. | Para el flujo actual se adopta token público de alcance mínimo, hasheado, TTL corto, rate limit y ack. Device pairing queda como evolución si aumenta el riesgo. | Conserva baja fricción; obliga a hardening y no autoriza acceso al resto del API. |
| `API-OFFER-DEC-001` | Eliminar Ofertas o implementar backend. | Se implementa `SupplierOffer` y sus rutas; la UI queda feature-flagged hasta que contract tests pasen. | La recepción/compra necesita factor, precio, SKU y vigencia por proveedor. Eliminar permanentemente perdería capacidad de negocio real. |
| `DOM-RBAC-DEC-001` | Roles fijos dispersos o capacidades. | Backend publica capacidades efectivas en `/auth/me`; rutas y comandos exigen capacidades. Los roles son plantillas de capacidades, no checks repartidos. | Más piezas que tres `if rol`, pero resuelve tecnólogo/catalogación, consulta y futuras variantes sin drift. |
| `DOM-TIME-DEC-001` | Fechas locales y UTC implícito. | Instantes se persisten como `timestamptz` UTC; vencimiento es `date`; la zona de negocio configurable inicial es `America/Punta_Arenas`. | Un vencimiento no es un instante. La UI convierte solo en frontera y muestra zona cuando importa. |
| `DOM-MONEY-DEC-001` | `number` frontend, escalas variables y unitarios redondeados que no reconcilian. | Cantidad/dinero/factor viajan como strings decimales. Cantidad base `numeric(18,4)`, factor `numeric(18,6)` y dinero `numeric(18,4)` + ISO 4217. El **total de línea** es autoritativo; el costo unitario es el cociente racional `total/cantidad`, solo de presentación. Si una línea se reparte entre eventos, se asigna a escala 4 por mayor residuo, orden `(operacion_id,secuencia)`, y todo residual queda en el último evento del orden para que la suma sea exacta. | Evita IEEE-754 y el desfase `unitario × cantidad`; exige helpers y una aserción de reconciliación exacta. |
| `DOM-POLICY-DEC-001` | Umbrales/demanda en Product frente a asignación por área. | `InventoryPolicy(product_id, area_id)` es el único owner de `safety_stock`, `reorder_point`, `max_stock`, `monthly_demand_baseline` y `lead_time_days`. Product conserva identidad y `ProductAreaAssignment` solo asociación. | Una política depende del lugar de almacenamiento; evita defaults globales que sobrescriben decisiones por área. |
| `DOM-COUNT-DEC-001` | Conteo parcial o atómico. | **Guardar borrador** PUEDE devolver outcomes por ítem y persistir solo ítems sin conflicto. **Confirmar** es un command atómico: cualquier conflicto rechaza toda la confirmación, produce cero movimientos/cambios de saldo y devuelve diagnósticos por ítem. | Permite trabajo incremental sin afirmar un inventario final parcialmente confirmado. |
| `API-CONFIG-DEC-001` | Save global o por sección. | Cada sección de configuración tiene command, versión y ETag independientes; no existe Guardar global. Un command de sección compromete todo o nada y refetchea solo sus dependencias declaradas. | Evita colisiones entre dominios y un falso atomic global sobre recursos no relacionados. |
| `UI-WHATSAPP-DEC-001` | Integración operativa o enlace externo. | V1 es `external-record-only`: registra intención, abre un handoff externo y solo registra el resultado que el usuario confirma. Nunca declara entrega. Provider/webhook, firma, delivery receipts y reintentos quedan fuera de este programa y requieren cambio separado. | Cierra el contrato sin fingir capacidades de mensajería que el sistema no opera. |

### 5.2 Bounded contexts y fronteras de agregado

```text
Product Catalog
├── Product (aggregate root)
├── ProductIdentifier (child; namespace escaneable global)
├── ProductPackage + ProductPackageRevision (child; revisión inmutable)
├── ProductAttributeValue (child; tipado por definición)
└── ProductAreaAssignment (child; solo asociación)

Inventory
├── Lot (root operativo, ligado a Product + PackageRevision coherentes)
├── InventoryEvent (append-only)
└── InventoryBalance (proyección reconstruible)

Planning
└── InventoryPolicy (Product + Area; único dueño de safety/reorder/max/demand/lead time)

Procurement
├── Supplier
├── SupplierOffer (Supplier + ProductPackageRevision + vigencia)
├── PurchaseRequest / PurchaseOrder
└── Receipt (command transaccional; Lot + InventoryEvent)

Import
├── ImportBatch (identidad/source y puntero a revisión vigente)
├── ImportBatchRevision + versioned ImportRow / ImportTransform
└── ImportCommit (binding exacto de revisión, hashes y outcomes)

Platform
├── IdempotencyRecord
├── UploadObject
├── AuditEvent
└── OutboxEvent
```

#### Requisitos del agregado Product Catalog

| ID | Requisito |
| --- | --- |
| `DOM-PRODUCT-001` | `Product` DEBE ser la raíz para metadata, estado catálogo, lifecycle, identifiers, packages, attributes y assignments. |
| `DOM-PRODUCT-002` | Ningún comando del catálogo PUEDE actualizar ledger, balances, receipts, lots históricos o revisiones de package ya usadas. |
| `DOM-PRODUCT-003` | Todo comando DEBE cargar la versión, validar transición/invariantes y persistir Product + children + audit + outbox en una transacción. |
| `DOM-PRODUCT-004` | `Product` DEBE exponer readiness derivado por capacidad y razones estables; no se persiste un booleano manual “ready”. |
| `DOM-PRODUCT-005` | Archivar DEBE impedir nuevas operaciones, pero NO DEBE ocultar producto/lot/eventos de consultas históricas. |
| `DOM-PRODUCT-006` | Un cambio que invalida una aprobación DEBE ejecutar una transición explícita a `pendiente_aprobacion`; no se infiere por un side effect silencioso. |
| `DOM-PRODUCT-007` | Los children se modifican solo mediante comandos del agregado; endpoints CRUD que eviten versionado/audit quedan prohibidos. |

#### Fronteras fuera del agregado

- `SupplierOffer` no es child de Product: pertenece a Procurement y referencia una revisión de package.
- `Lot` no es child mutable del catálogo: su identidad e historial permanecen aunque el producto se archive.
- `InventoryBalance` no se edita desde catálogo; solo proyecta eventos.
- `InventoryPolicy` no se duplica en `productos` ni `product_area_assignments` y siempre pertenece a un área.
- `ImportRow` no es un Product hasta que el commit ejecuta el comando canónico.

### 5.3 Value objects obligatorios

| ID | Value object | Representación/reglas | Serialización |
| --- | --- | --- | --- |
| `DOM-VO-001` | `ProductId`, `LotId`, `OperationId` | UUID v4/7; no intercambiables en Rust | string UUID |
| `DOM-VO-002` | `InternalCode` | trim, Unicode NFKC, uppercase para comparación; 1–64; inmutable; global único | valor original + normalizado interno |
| `DOM-VO-003` | `ScanIdentifier` | tipo explícito; normalización por tipo; checksum GTIN cuando aplique; global único si es escaneable | `{type,value}` |
| `DOM-VO-004` | `ProductName` | trim; 1–255 caracteres Unicode; preserva display; clave de búsqueda accent-insensitive separada | string |
| `DOM-VO-005` | `CatalogStatus` | `incompleto`, `pendiente_aprobacion`, `aprobado`, `rechazado` | snake_case |
| `DOM-VO-006` | `Lifecycle` | vigente si `deleted_at IS NULL`; archivado si no | `deleted_at` ISO-8601/null |
| `DOM-VO-007` | `Quantity` | `numeric(18,4)`, unidad base, no usa float; comandos ordinarios >0, eventos signed !=0 | string decimal |
| `DOM-VO-008` | `ConversionFactor` | `numeric(18,6)`, >0; inmutable tras primer uso | string decimal |
| `DOM-VO-009` | `Money` / `UnitCostRatio` | total amount `numeric(18,4)` >=0 + currency ISO 4217 es autoritativo; unitario conserva razón `total_amount/base_quantity` y solo se redondea para display | `{amount:"245000.0000",currency:"CLP"}` |
| `DOM-VO-010` | `LotNumber` | trim/NFKC/uppercase compare; 1–80; único por producto | string |
| `DOM-VO-011` | `ExpirationDate` | fecha civil; requerido para `con_vto`; prohibido/ignorado explícitamente para `simple` según política | `YYYY-MM-DD` |
| `DOM-VO-012` | `StorageTemperature` | enum/rango gobernado por schema, no string libre hard-coded | key estable |
| `DOM-VO-013` | `OptimisticVersion` | entero >=1; debe coincidir vía ETag/If-Match | ETag `"product:<id>:<version>"` |
| `DOM-VO-014` | `IdempotencyKey` | 1–256, creada por intención; reutilizable solo en mismo scope y hash | header |
| `DOM-VO-015` | `RequestHash` | SHA-256 de método+ruta normalizada+actor/tenant+payload canónico | hex, nunca retornado completo a usuarios finales |
| `DOM-VO-016` | `AuditActor` | usuario o actor de sistema explícito; nunca `SELECT ... LIMIT 1` | UUID + actor_type |
| `DOM-VO-017` | `ReadinessReason` | code estable, field path, message, blocking capability | objeto estructurado |

### 5.4 Catálogos objetivo y ownership

| ID | Catálogo | Dueño y reglas |
| --- | --- | --- |
| `DOM-CATALOG-001` | Categorías | Product Catalog; nombre 1–100, unique normalizado, soft archive si tiene referencias. |
| `DOM-CATALOG-002` | Unidades base | Product Catalog; key estable, singular/plural, escala permitida; no se elimina si existe producto/evento. |
| `DOM-CATALOG-003` | Áreas | Inventory; tipo/bodega y lifecycle; asignación separada de reorder policy. |
| `DOM-CATALOG-004` | Formatos de empaque | Product Catalog; describe “kit/caja/frasco”, no contiene factor particular del producto. |
| `DOM-CATALOG-005` | Proveedores | Procurement; lifecycle y datos comerciales; ofertas activas no pueden apuntar a proveedor archivado. |
| `DOM-CATALOG-006` | Definiciones Lab | Product Catalog/config admin; key/UUID inmutable, tipo/alcance/required/opciones/version; cambios incompatibles requieren plan explícito. |
| `DOM-CATALOG-007` | Monedas | Configuración allowlist ISO 4217; CLP inicial. No se acepta string arbitrario. |
| `DOM-CATALOG-008` | Motivos | Motivos de rechazo/descarte/ajuste versionados; texto libre adicional solo cuando política lo exige. |

### 5.5 Máquinas de estado objetivo

#### 5.5.1 Producto

Los nombres del diagrama son conceptuales; los valores persistidos/HTTP conservan la convención vigente: `incompleto`, `pendiente_aprobacion`, `aprobado`, `rechazado`.

```text
                complete + submit
INCOMPLETE  ---------------------------->  PENDING_APPROVAL
    ^                                            |      |
    | repair                                     |      | reject(reason)
    |                                            |      v
REJECTED <---------------------------------------+   REJECTED
    | repair                                            |
    +--------------------> INCOMPLETE/PENDING_APPROVAL  |
                                                   approve
                                                      |
                                                      v
                                                  APPROVED
                                                      |
                             material metadata change requiring review
                                                      |
                                                      v
                                               PENDING_APPROVAL

Lifecycle orthogonal: CURRENT --archive(reason)--> ARCHIVED --reactivate--> CURRENT
```

| ID | Transición | Precondición | Efectos atómicos |
| --- | --- | --- | --- |
| `DOM-STATE-001` | create | nombre + internal code válidos | `incompleto`, version 1, audit `product.created`. |
| `DOM-STATE-002` | submit | `catalog_complete=true` | `pendiente_aprobacion`, version+1, audit/outbox. |
| `DOM-STATE-003` | approve | pendiente, actor `catalog.approve`, readiness exigida | `aprobado`, version+1, reason null; NO toca inventario/package previos. |
| `DOM-STATE-004` | reject | pendiente, motivo no vacío | `rechazado`, version+1, motivo/actor/audit. |
| `DOM-STATE-005` | repair | rechazado/incompleto | aplica patch; estado derivado incompleto o pendiente solo mediante comando explícito. |
| `DOM-STATE-006` | archive | vigente, sin comando incompatible en curso | `deleted_at/deleted_by/motivo_eliminacion`, version+1; historia visible. |
| `DOM-STATE-007` | reactivate | archived | limpia archive; estado catálogo previo no se eleva; version+1/audit. |

#### 5.5.2 Revisión de presentación

```text
DRAFT --activate--> ACTIVE --supersede(new revision)--> CLOSED
```

- Una revisión `ACTIVE` usada por offer/lot/receipt/event es inmutable.
- `supersede` cierra `valid_to` y crea revision+1 dentro de la misma transacción.
- No puede existir más de una revisión activa por `package_id`.
- El factor nuevo solo rige operaciones cuya fecha/comando selecciona la nueva revisión.

#### 5.5.3 Import batch

```text
Batch:    UPLOADED -> ACTIVE -> COMMITTING -> COMMITTED -> ROLLED_BACK
             |          ^         |              (solo sin dependencias)
             +-> CANCELLED         +-> FAILED -> ACTIVE (resume/retry)

Revision: DRAFT -> MAPPED -> VALIDATED -> READY -> COMMITTED
              \         \             |
               +---------+------------> SUPERSEDED (al crear revision N+1)

Commit attempt: COMMITTING -> COMMITTED
                        \--> FAILED
```

Reglas cerradas:

1. `import_batches.current_revision_id` apunta a una sola revisión del mismo batch y cambia bajo lock/CAS.
2. `DRAFT/MAPPED/VALIDATED` pueden avanzar dentro de la revisión; al alcanzar `READY`, filas, mapping, schema y los cuatro hashes quedan inmutables.
3. Editar, remapear, transformar o excluir después de `READY` crea revisión `N+1` desde `source_revision_id`; la anterior pasa a `SUPERSEDED` y nunca se sobrescribe.
4. Reanudar carga batch, revisión vigente, filas y diagnósticos persistidos. Un `FAILED` puede volver a `ACTIVE` solo si no existe commit exitoso y la revisión sigue vigente; si cambió el contenido, crea otra revisión.
5. Solo la revisión vigente `READY` puede pasar a commit. El request repite exactamente `revision_id`, `schema_version`, `content_hash`, `mapping_hash` y `preview_hash`; cualquier divergencia, revisión superseded o batch distinto responde 409/412 antes de escribir targets.
6. Un replay con el mismo scope/key/hash retorna `response_body` del `import_commits` ya `COMMITTED`. Otra key sobre esa revisión devuelve el mismo resultado canónico; nunca crea un segundo commit exitoso. Mismo key con binding distinto es 409.
7. Productos/children, outcomes por fila, counts, audit/outbox y transición revision/batch a `COMMITTED` se escriben en **una TX SERIALIZABLE**. Un fallo deja cero target writes/outcomes committed; el intento se marca `FAILED` después del rollback sin alterar la revisión inmutable.

#### 5.5.4 Recepción y upload

```text
Upload: INITIATED -> UPLOADED -> VERIFIED -> LINKED
                         |          |
                         +-> REJECTED/EXPIRED

Receipt: DRAFT -> CONFIRMED
           |          |
           +-> CANCELLED
CONFIRMED --compensate--> eventos de reversa; nunca DELETE histórico
```

#### 5.5.5 Idempotencia

```text
CLAIMED(in_progress) -> COMPLETED(response)
         |                  |
         +-> FAILED/EXPIRED +-> EXPIRED por retención
```

Un segundo request idéntico espera/recibe el resultado. Un hash distinto dentro del mismo scope responde `IDEMPOTENCY_PAYLOAD_MISMATCH`.

### 5.6 Readiness por capacidad

| ID/capacidad | Condiciones mínimas | Qué bloquea | Qué permanece permitido |
| --- | --- | --- | --- |
| `DOM-READY-001` `catalog_complete` | current, nombre/internal code, categoría/unidad según configuración, custom required válidos | submit/approve | editar/enriquecer/archivar |
| `DOM-READY-002` `inventory_ready` | aprobado, vigente, unidad, package revision activa, policy de lote coherente | lotes/movimientos/stock/conteo nuevo | lectura histórica |
| `DOM-READY-003` `receiving_ready` | inventory_ready + package elegida; expiry/lot según policy; área asignable | línea de recepción | editar catálogo/oferta |
| `DOM-READY-004` `purchasing_ready` | aprobado/vigente + package; offer vigente cuando el flujo exige proveedor/precio | solicitud/OC | revisión de catálogo |
| `DOM-READY-005` `scanner_ready` | identifier global inequívoco + capacidad del comando de destino | lookup operacional | lookup read-only que devuelva razones |
| `DOM-READY-006` `reporting_ready` | identidad válida; historia puede incluir archived | inclusión en reportes operativos nuevos | reportes históricos siempre preservados |
| `DOM-READY-007` `setup_complete` | sin batch unresolved, sin filas estructurales pendientes y decisión explícita sobre `incompleto` | finalizar setup | corregir/reanudar/descargar |

El evaluador DEBE retornar `ready`, `reasons[]`, `evaluated_at`, `policy_version`. Todos los canales llaman la misma capa de aplicación; triggers DB protegen escrituras directas críticas.

### 5.7 Invariantes de dominio y transacción

| ID | Invariante | Aplicación | Defensa DB |
| --- | --- | --- | --- |
| `DB-INV-001` | Lifecycle sin contradicción | Commands archive/reactivate | No existe columna `activo`; `deleted_at` es la única fuente. |
| `DB-INV-002` | Estado válido en todas las capas | Enum generado | Tipo/check canónico + contract generation. |
| `DB-INV-003` | Presentación pertenece al producto | Receipt/lot/order commands | FK compuesta `(package_revision_id, product_id)`. |
| `DB-INV-004` | Identificador escaneable único | Registry service | UNIQUE `normalized_value` en scope global. |
| `DB-INV-005` | Ledger inmutable | Inventory service | Trigger bloquea UPDATE/DELETE; reversa por nuevo evento. |
| `DB-INV-006` | Saldo = suma del ledger | Transaction projector | Balance actualizado con lock y herramienta de rebuild/reconcile. |
| `DB-INV-007` | Saldo no negativo salvo permiso extraordinario | consume/discard/adjust | CHECK + lock por lote/área; override como evento auditado. |
| `DB-INV-008` | Factor >0 e inmutable tras uso | Package command | CHECK; trigger impide cambio material de revisión referenciada. |
| `DB-INV-009` | Cantidades/costos no negativos donde corresponda | DTO/value objects | CHECK numeric; evento signed es excepción tipada. |
| `DB-INV-010` | Lote y vencimiento siguen policy | Receipt command | Constraint trigger diferible con product policy. |
| `DB-INV-011` | Una InventoryPolicy por producto+área | Planning service | `UNIQUE(product_id,area_id)`; no existe policy global con área null. |
| `DB-INV-012` | `reorder >= safety >= 0`; `max` null o `max >= reorder`; demanda mensual >=0 | Planning service | CHECKs; `safety=0`, `max=null` por defecto. |
| `DB-INV-013` | Custom value concuerda con definition | Product command/import | JSON type trigger y unique `(product_id,definition_id)`. |
| `DB-INV-014` | Audit/outbox comparte commit | Todos los commands | Inserción en misma TX; publicación outbox posterior. |
| `DB-INV-015` | Optimistic locking | Product/receipt/count/config commands | `UPDATE ... WHERE version=?`; filas=0 → 412/409 tipado. |
| `DB-INV-016` | Idempotencia aislada | Middleware/command bus | PK compuesta actor+method+route+key; hash requerido. |
| `DB-INV-017` | Preview=commit | Import | Commit vincula exactamente `revision_id + schema_version + content_hash + mapping_hash + preview_hash`; trigger/command bloquea mismatch o revisión superseded. |
| `DB-INV-018` | No hay descarte implícito | Receipt/import/count | Receipt/import declaran cada row/line. Count draft admite outcomes por ítem; confirmación count es all-or-nothing. |
| `DB-INV-019` | Actor real | Todos los commands | actor obligatorio o service principal; nunca usuario arbitrario. |
| `DB-INV-020` | GET no muta | Lookup/scanner/read models | Creación externa solo por POST command idempotente. |

### 5.8 Data dictionary objetivo

| Entidad | Campo clave | Tipo/escala | Null | Regla/semántica |
| --- | --- | ---: | :---: | --- |
| `productos` | `id` | uuid | no | Identidad técnica. |
| | `nombre` / `nombre_normalizado` | varchar(255)/text | no | Display preservado / búsqueda. |
| | `estado_catalogo` | enum/text | no | Máquina de estado única. |
| | `unidad_base_id`, `categoria_id` | FK | sí | Pueden faltar solo en `incompleto`. |
| | `control_lote` | enum | no | `simple`, `trazable`, `con_vto`. |
| | `version` | bigint | no | Optimistic lock. |
| | `deleted_at`, `deleted_by`, `motivo_eliminacion` | timestamptz/uuid/text | sí | Los tres null o los tres informados mediante check. |
| `producto_identificadores` | `tipo`, `valor`, `valor_normalizado` | enum/text | no | Resolver único; código interno exactamente uno vigente. |
| `presentaciones` | `id`, `producto_id`, `formato_id` | uuid/FK | no | Identidad lógica de empaque. |
| `presentacion_revisiones` | `revision`, `factor_conversion` | int/numeric(18,6) | no | Revisión efectiva e inmutable. |
| `ofertas_proveedor` | `proveedor_id`, `presentacion_revision_id` | FK | no | Oferta por empaque exacto. |
| | `precio_unitario`, `moneda` | numeric(18,4)/char(3) | no | Precio del package, vigencia temporal. |
| `lotes` | `producto_id`, `presentacion_revision_id` | FK compuesta | no | Pertenencia garantizada. |
| | `numero_lote`, `fecha_vencimiento` | varchar(80)/date | según policy | Identidad de lote. |
| `movimientos` | `cantidad` | numeric(18,4) | no | Signed, !=0, en unidad base. |
| | `costo_total`, `moneda` | numeric(18,4)/char(3) | sí | Total autoritativo del evento; ambos null o ambos presentes. |
| | `operacion_id`, `secuencia` | uuid/int | no | Unique; idempotencia del grupo. |
| `stock` | `lote_id`, `area_id`, `cantidad`, `version` | FK/FK/numeric/bigint | no | Única proyección operacional. |
| `politicas_reposicion` (`InventoryPolicy`) | `producto_id`, `area_id` | FK/FK | no | Owner único por producto+área; nunca parte del PATCH de Product. |
| | `stock_seguridad`, `punto_reorden`, `stock_maximo`, `demanda_mensual_base` | numeric(18,4) | `stock_maximo` sí | Defaults/invariantes de `DB-INV-012`. |
| `lab_campo_producto_valor` | `valor` | jsonb | no | Un valor, tipo validado contra definición. |
| `idempotency_keys` | `usuario_id`+`metodo_http`+`ruta_template`+`key`+`request_hash` | text/bytea | no | Resultado nunca cruza actor/endpoint. |
| `audit_log` | actor, action, aggregate, before/after | uuid/text/jsonb | parcial | Append-only; secretos redactados. |
| `external_handoffs` | actor/channel/recipient/intent/status/user_result | uuid/text/jsonb/enum | resultado sí | Evidencia de handoff externo; nunca delivery receipt. |
| `uploads` | object_key, sha256, status | text/bytea/enum | no | Storage durable, no data URL. |
| `import_batches` | source, `import_kind`, status, `current_revision_id` | bytea/enum/uuid | según fase | Identidad reanudable de producto o policy; una revisión vigente. |
| `import_batch_revisions` | revision, schema/content/mapping/preview hashes | bigint/text/bytea | preview hasta validar | Snapshot versionado; READY y terminales son inmutables. |
| `import_rows` | `revision_id`, row_number, raw/normalized/diagnostics/status | uuid/int/jsonb/enum | según fase | PK por revisión+fila; nunca se sobrescribe una preview anterior. |
| `import_commits` | binding de cinco campos, status, counts, operation | uuid/hash/enum/jsonb | según fase | Un commit exitoso por revisión; replay recupera la respuesta persistida. |
| `import_commit_row_outcomes` | commit+row, outcome, target_product | FK/int/enum/FK | target según outcome | Outcomes y target writes comparten la TX de commit. |

### 5.9 Esquema SQL objetivo de referencia

El siguiente DDL define la forma normativa. La implementación puede dividirlo por módulos, pero NO PUEDE degradar sus constraints. Los nombres pueden adaptarse solo mediante una decisión registrada y actualización de IDs/tests.
Se conservan los identificadores SQL existentes en español (`productos`, `presentaciones`, `movimientos`, `stock`, `audit_log`, `idempotency_keys`) y se introducen nombres nuevos coherentes con esa convención.

```sql
-- PostgreSQL 16; reconstrucción limpia de la base de desarrollo.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TYPE estado_catalogo_tipo AS ENUM
  ('incompleto', 'pendiente_aprobacion', 'aprobado', 'rechazado');
CREATE TYPE control_lote_tipo AS ENUM ('simple', 'trazable', 'con_vto');
CREATE TYPE tipo_identificador AS ENUM
  ('codigo_interno', 'gtin', 'codigo_barras', 'alias_qr');
CREATE TYPE tipo_movimiento AS ENUM
  ('entrada_recepcion', 'consumo', 'descarte', 'ajuste_conteo',
   'stock_inicial', 'reversa', 'ajuste_administrativo');
CREATE TYPE estado_upload AS ENUM
  ('initiated', 'uploaded', 'verified', 'linked', 'rejected', 'expired');
CREATE TYPE estado_import_batch AS ENUM
  ('uploaded', 'active', 'committing', 'committed',
   'failed', 'cancelled', 'rolled_back');
CREATE TYPE tipo_importacion AS ENUM ('products', 'inventory_policies');
CREATE TYPE estado_import_revision AS ENUM
  ('draft', 'mapped', 'validated', 'ready', 'superseded', 'committed');
CREATE TYPE estado_import_row AS ENUM
  ('raw', 'valid', 'incomplete', 'error', 'excluded');
CREATE TYPE estado_import_commit AS ENUM
  ('committing', 'committed', 'failed');
CREATE TYPE resultado_import_row AS ENUM
  ('committed_ready', 'committed_incomplete', 'rejected', 'excluded');
CREATE TYPE estado_external_handoff AS ENUM
  ('intent_registered', 'confirmed_opened', 'reported_not_sent', 'cancelled');

CREATE TABLE productos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre varchar(255) NOT NULL CHECK (length(btrim(nombre)) BETWEEN 1 AND 255),
  nombre_normalizado text NOT NULL,
  descripcion varchar(1000),
  categoria_id integer REFERENCES categorias(id),
  unidad_base_id integer REFERENCES unidades_basicas(id),
  control_lote control_lote_tipo NOT NULL DEFAULT 'con_vto',
  ubicacion varchar(200),
  temperatura_almacenamiento_clave varchar(64),
  requiere_cadena_frio boolean NOT NULL DEFAULT false,
  dias_estabilidad_abierto integer CHECK (dias_estabilidad_abierto IS NULL OR dias_estabilidad_abierto >= 0),
  clase_riesgo_clave varchar(64),
  fabricante varchar(300),
  fabricante_normalizado text,
  mpn varchar(128),
  mpn_normalizado text,
  alias_unidad_clinica varchar(128),
  es_kit boolean NOT NULL DEFAULT false,
  codigo_loinc_cpt varchar(128),
  estado_catalogo estado_catalogo_tipo NOT NULL DEFAULT 'incompleto',
  motivo_rechazo text,
  version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
  deleted_at timestamptz,
  deleted_by uuid REFERENCES usuarios(id),
  motivo_eliminacion text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES usuarios(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES usuarios(id),
  CHECK ((estado_catalogo = 'rechazado') = (motivo_rechazo IS NOT NULL)),
  CHECK (
    (deleted_at IS NULL AND deleted_by IS NULL AND motivo_eliminacion IS NULL)
    OR
    (deleted_at IS NOT NULL AND deleted_by IS NOT NULL
     AND length(btrim(motivo_eliminacion)) > 0)
  )
);
CREATE UNIQUE INDEX productos_fabricante_mpn_uidx
  ON productos(fabricante_normalizado, mpn_normalizado)
  WHERE mpn_normalizado IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX productos_busqueda_idx ON productos(nombre_normalizado);
CREATE INDEX productos_estado_idx ON productos(estado_catalogo) WHERE deleted_at IS NULL;

CREATE TABLE producto_area (
  producto_id uuid NOT NULL REFERENCES productos(id),
  area_id integer NOT NULL REFERENCES areas(id),
  asignado_at timestamptz NOT NULL DEFAULT now(),
  asignado_por uuid NOT NULL REFERENCES usuarios(id),
  PRIMARY KEY (producto_id, area_id)
);

CREATE TABLE presentaciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  producto_id uuid NOT NULL REFERENCES productos(id),
  formato_id integer REFERENCES presentacion_formatos(id),
  nombre_logico varchar(120) NOT NULL CHECK (length(btrim(nombre_logico)) > 0),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES usuarios(id),
  UNIQUE (id, producto_id)
);

CREATE TABLE presentacion_revisiones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  presentacion_id uuid NOT NULL,
  producto_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision >= 1),
  nombre varchar(120) NOT NULL CHECK (length(btrim(nombre)) > 0),
  nombre_plural varchar(120) NOT NULL CHECK (length(btrim(nombre_plural)) > 0),
  factor_conversion numeric(18,6) NOT NULL CHECK (factor_conversion > 0),
  vigente_desde timestamptz NOT NULL DEFAULT now(),
  vigente_hasta timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES usuarios(id),
  motivo_cambio text NOT NULL CHECK (length(btrim(motivo_cambio)) > 0),
  FOREIGN KEY (presentacion_id, producto_id)
    REFERENCES presentaciones(id, producto_id),
  UNIQUE (presentacion_id, revision),
  UNIQUE (id, producto_id),
  CHECK (vigente_hasta IS NULL OR vigente_hasta > vigente_desde)
);
CREATE UNIQUE INDEX presentacion_una_revision_vigente_uidx
  ON presentacion_revisiones(presentacion_id) WHERE vigente_hasta IS NULL;

CREATE TABLE producto_identificadores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  producto_id uuid REFERENCES productos(id),
  presentacion_revision_id uuid REFERENCES presentacion_revisiones(id),
  tipo tipo_identificador NOT NULL,
  valor varchar(256) NOT NULL CHECK (length(btrim(valor)) > 0),
  valor_normalizado varchar(256) NOT NULL,
  vigente_desde timestamptz NOT NULL DEFAULT now(),
  vigente_hasta timestamptz,
  created_by uuid NOT NULL REFERENCES usuarios(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((producto_id IS NOT NULL)::int +
         (presentacion_revision_id IS NOT NULL)::int = 1),
  CHECK (vigente_hasta IS NULL OR vigente_hasta > vigente_desde),
  UNIQUE (valor_normalizado)
);
CREATE UNIQUE INDEX producto_un_codigo_interno_uidx
  ON producto_identificadores(producto_id)
  WHERE tipo = 'codigo_interno' AND vigente_hasta IS NULL;

CREATE TABLE ofertas_proveedor (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proveedor_id integer NOT NULL REFERENCES proveedores(id),
  presentacion_revision_id uuid NOT NULL REFERENCES presentacion_revisiones(id),
  codigo_proveedor varchar(128),
  precio_unitario numeric(18,4) NOT NULL CHECK (precio_unitario >= 0),
  moneda char(3) NOT NULL,
  vigente_desde timestamptz NOT NULL,
  vigente_hasta timestamptz,
  es_preferida boolean NOT NULL DEFAULT false,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES usuarios(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES usuarios(id),
  CHECK (vigente_hasta IS NULL OR vigente_hasta > vigente_desde),
  UNIQUE (proveedor_id, codigo_proveedor)
);
CREATE UNIQUE INDEX oferta_proveedor_una_preferida_uidx
  ON ofertas_proveedor(proveedor_id, presentacion_revision_id)
  WHERE es_preferida AND vigente_hasta IS NULL;

CREATE TABLE lab_campo_producto_valor (
  producto_id uuid NOT NULL REFERENCES productos(id),
  definicion_id uuid NOT NULL REFERENCES lab_campo_definicion(id),
  valor jsonb NOT NULL,
  definicion_version integer NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES usuarios(id),
  PRIMARY KEY (producto_id, definicion_id)
);

CREATE TABLE politicas_reposicion (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  producto_id uuid NOT NULL REFERENCES productos(id),
  area_id integer NOT NULL REFERENCES areas(id),
  stock_seguridad numeric(18,4) NOT NULL DEFAULT 0 CHECK (stock_seguridad >= 0),
  punto_reorden numeric(18,4) NOT NULL DEFAULT 0 CHECK (punto_reorden >= 0),
  stock_maximo numeric(18,4) CHECK (stock_maximo IS NULL OR stock_maximo >= 0),
  demanda_mensual_base numeric(18,4) NOT NULL DEFAULT 0 CHECK (demanda_mensual_base >= 0),
  lead_time_dias integer NOT NULL DEFAULT 0 CHECK (lead_time_dias >= 0),
  version bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES usuarios(id),
  CHECK (stock_maximo IS NULL OR stock_maximo >= punto_reorden),
  CHECK (punto_reorden >= stock_seguridad),
  UNIQUE (producto_id, area_id)
);

CREATE TABLE lotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  producto_id uuid NOT NULL REFERENCES productos(id),
  presentacion_revision_id uuid NOT NULL,
  numero_lote varchar(80) NOT NULL CHECK (length(btrim(numero_lote)) > 0),
  numero_lote_normalizado varchar(80) NOT NULL,
  fecha_vencimiento date,
  recibido_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES usuarios(id),
  FOREIGN KEY (presentacion_revision_id, producto_id)
    REFERENCES presentacion_revisiones(id, producto_id),
  UNIQUE (producto_id, numero_lote_normalizado)
);

CREATE TABLE movimientos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operacion_id uuid NOT NULL,
  secuencia integer NOT NULL CHECK (secuencia >= 1),
  tipo tipo_movimiento NOT NULL,
  lote_id uuid NOT NULL REFERENCES lotes(id),
  area_id integer NOT NULL REFERENCES areas(id),
  cantidad numeric(18,4) NOT NULL CHECK (cantidad <> 0),
  costo_total numeric(18,4) CHECK (costo_total IS NULL OR costo_total >= 0),
  moneda char(3),
  origen_tipo varchar(64) NOT NULL,
  origen_id uuid NOT NULL,
  revierte_movimiento_id uuid UNIQUE REFERENCES movimientos(id),
  causation_id uuid,
  correlation_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  usuario_id uuid NOT NULL REFERENCES usuarios(id),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (operacion_id, secuencia),
  CHECK ((costo_total IS NULL) = (moneda IS NULL))
);
CREATE INDEX movimientos_lote_area_fecha_idx
  ON movimientos(lote_id, area_id, occurred_at, id);

CREATE TABLE stock (
  lote_id uuid NOT NULL REFERENCES lotes(id),
  area_id integer NOT NULL REFERENCES areas(id),
  cantidad numeric(18,4) NOT NULL DEFAULT 0 CHECK (cantidad >= 0),
  version bigint NOT NULL DEFAULT 1,
  ultimo_movimiento_id uuid NOT NULL REFERENCES movimientos(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (lote_id, area_id)
);

CREATE TABLE idempotency_keys (
  usuario_id uuid NOT NULL REFERENCES usuarios(id),
  metodo_http varchar(8) NOT NULL,
  ruta_template varchar(160) NOT NULL,
  key varchar(256) NOT NULL,
  request_hash bytea NOT NULL,
  state varchar(16) NOT NULL CHECK (state IN ('in_progress','completed','failed')),
  response_status smallint,
  response_body jsonb,
  resource_version bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (usuario_id, metodo_http, ruta_template, key),
  CHECK ((state = 'completed') =
         (response_status IS NOT NULL AND response_body IS NOT NULL))
);

CREATE TABLE uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  object_key text NOT NULL UNIQUE,
  sha256 bytea NOT NULL,
  media_type varchar(100) NOT NULL,
  byte_size bigint NOT NULL CHECK (byte_size BETWEEN 1 AND 10485760),
  status estado_upload NOT NULL,
  purpose varchar(64) NOT NULL,
  created_by uuid NOT NULL REFERENCES usuarios(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  verified_at timestamptz,
  linked_resource_type varchar(64),
  linked_resource_id uuid,
  expires_at timestamptz NOT NULL
);

CREATE TABLE audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tabla varchar(64) NOT NULL,
  registro_id uuid NOT NULL,
  version_agregado bigint NOT NULL,
  accion varchar(96) NOT NULL,
  usuario_id uuid REFERENCES usuarios(id),
  actor_type varchar(32) NOT NULL,
  operacion_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  reason text,
  datos_anteriores jsonb,
  datos_nuevos jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tabla, registro_id, version_agregado, accion)
);

CREATE TABLE external_handoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel varchar(32) NOT NULL CHECK (channel = 'whatsapp'),
  actor_id uuid NOT NULL REFERENCES usuarios(id),
  recipient_normalized varchar(32) NOT NULL,
  template_key varchar(96) NOT NULL,
  resource_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  intent_hash bytea NOT NULL,
  status estado_external_handoff NOT NULL DEFAULT 'intent_registered',
  user_result_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'intent_registered') = (user_result_at IS NULL))
);

CREATE TABLE outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tabla varchar(64) NOT NULL,
  registro_id uuid NOT NULL,
  tipo varchar(96) NOT NULL,
  payload jsonb NOT NULL,
  correlation_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  last_error text
);

CREATE TABLE import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_name varchar(255) NOT NULL,
  source_sha256 bytea NOT NULL,
  source_upload_id uuid NOT NULL REFERENCES uploads(id),
  import_kind tipo_importacion NOT NULL,
  status estado_import_batch NOT NULL DEFAULT 'uploaded',
  current_revision_id uuid,
  created_by uuid NOT NULL REFERENCES usuarios(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  committed_at timestamptz,
  UNIQUE (created_by, import_kind, source_sha256)
);

CREATE TABLE import_batch_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  revision bigint NOT NULL CHECK (revision >= 1),
  source_revision_id uuid,
  status estado_import_revision NOT NULL DEFAULT 'draft',
  schema_version varchar(64) NOT NULL,
  content_hash bytea NOT NULL,
  mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  mapping_hash bytea NOT NULL,
  preview_hash bytea,
  duplicate_strategy varchar(32) NOT NULL
    CHECK (duplicate_strategy IN ('reject','skip','fill_empty','review')),
  counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NOT NULL REFERENCES usuarios(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  ready_at timestamptz,
  superseded_at timestamptz,
  UNIQUE (batch_id, revision),
  UNIQUE (id, batch_id),
  FOREIGN KEY (source_revision_id, batch_id)
    REFERENCES import_batch_revisions(id, batch_id),
  CHECK (
    status NOT IN ('ready','superseded','committed')
    OR (preview_hash IS NOT NULL AND ready_at IS NOT NULL)
  ),
  CHECK ((status = 'superseded') = (superseded_at IS NOT NULL))
);

ALTER TABLE import_batches
  ADD CONSTRAINT import_batch_current_revision_fk
  FOREIGN KEY (current_revision_id, id)
  REFERENCES import_batch_revisions(id, batch_id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE import_rows (
  revision_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  row_number integer NOT NULL CHECK (row_number >= 1),
  raw jsonb NOT NULL,
  normalized jsonb NOT NULL DEFAULT '{}'::jsonb,
  diagnostics jsonb NOT NULL DEFAULT '[]'::jsonb,
  status estado_import_row NOT NULL DEFAULT 'raw',
  matched_product_id uuid REFERENCES productos(id),
  excluded_by uuid REFERENCES usuarios(id),
  exclusion_reason text,
  PRIMARY KEY (revision_id, row_number),
  FOREIGN KEY (revision_id, batch_id)
    REFERENCES import_batch_revisions(id, batch_id) ON DELETE CASCADE,
  CHECK ((status = 'excluded') =
         (excluded_by IS NOT NULL AND exclusion_reason IS NOT NULL))
);

CREATE TABLE import_transforms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  revision_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  field_key varchar(128) NOT NULL,
  mode varchar(24) NOT NULL CHECK (mode IN ('blank_only','overwrite')),
  typed_value jsonb NOT NULL,
  affected_count integer NOT NULL CHECK (affected_count >= 0),
  preview_token bytea NOT NULL,
  created_by uuid NOT NULL REFERENCES usuarios(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (revision_id, batch_id)
    REFERENCES import_batch_revisions(id, batch_id) ON DELETE CASCADE
);

CREATE TABLE import_commits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  attempt integer NOT NULL CHECK (attempt >= 1),
  status estado_import_commit NOT NULL DEFAULT 'committing',
  schema_version varchar(64) NOT NULL,
  content_hash bytea NOT NULL,
  mapping_hash bytea NOT NULL,
  preview_hash bytea NOT NULL,
  operation_id uuid NOT NULL UNIQUE,
  counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  response_body jsonb,
  failure_code varchar(96),
  started_by uuid NOT NULL REFERENCES usuarios(id),
  started_at timestamptz NOT NULL DEFAULT now(),
  committed_at timestamptz,
  failed_at timestamptz,
  UNIQUE (revision_id, attempt),
  UNIQUE (id, revision_id),
  FOREIGN KEY (revision_id, batch_id)
    REFERENCES import_batch_revisions(id, batch_id),
  CHECK ((status = 'committed') =
         (committed_at IS NOT NULL AND response_body IS NOT NULL)),
  CHECK ((status = 'failed') = (failed_at IS NOT NULL))
);
CREATE UNIQUE INDEX import_un_commit_exitoso_por_revision_uidx
  ON import_commits(revision_id) WHERE status = 'committed';

CREATE TABLE import_commit_row_outcomes (
  commit_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  row_number integer NOT NULL,
  outcome resultado_import_row NOT NULL,
  target_product_id uuid REFERENCES productos(id),
  diagnostics jsonb NOT NULL DEFAULT '[]'::jsonb,
  PRIMARY KEY (commit_id, row_number),
  FOREIGN KEY (commit_id, revision_id)
    REFERENCES import_commits(id, revision_id) ON DELETE CASCADE,
  FOREIGN KEY (revision_id, row_number)
    REFERENCES import_rows(revision_id, row_number),
  CHECK (
    (outcome IN ('committed_ready','committed_incomplete'))
      = (target_product_id IS NOT NULL)
  )
);
```

#### 5.9.1 Readiness derivado

La implementación DEBE crear una vista o consulta canónica equivalente a:

```sql
CREATE VIEW product_readiness AS
SELECT
  p.id AS producto_id,
  (
    p.deleted_at IS NULL
    AND length(btrim(p.nombre)) > 0
    AND EXISTS (
      SELECT 1 FROM producto_identificadores i
      WHERE i.producto_id = p.id
        AND i.tipo = 'codigo_interno'
        AND i.vigente_hasta IS NULL
    )
    AND p.unidad_base_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM lab_campo_definicion d
      WHERE d.activo = true
        AND d.alcance = 'producto'
        AND d.requerido = true
        AND NOT EXISTS (
          SELECT 1 FROM lab_campo_producto_valor v
          WHERE v.producto_id = p.id
            AND v.definicion_id = d.id
            AND v.definicion_version = d.version
        )
    )
  ) AS catalog_complete,
  (
    p.deleted_at IS NULL
    AND p.estado_catalogo = 'aprobado'
    AND p.unidad_base_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM presentaciones pres
      JOIN presentacion_revisiones rev ON rev.presentacion_id = pres.id
      WHERE pres.producto_id = p.id
        AND pres.deleted_at IS NULL
        AND rev.vigente_hasta IS NULL
    )
  ) AS inventory_ready,
  ARRAY(
    SELECT faltante.clave
    FROM (
      SELECT 'codigo_interno'::text AS clave
      WHERE NOT EXISTS (
        SELECT 1 FROM producto_identificadores i
        WHERE i.producto_id = p.id
          AND i.tipo = 'codigo_interno'
          AND i.vigente_hasta IS NULL
      )
      UNION ALL SELECT 'unidad_base_id' WHERE p.unidad_base_id IS NULL
      UNION ALL SELECT 'estado_catalogo' WHERE p.estado_catalogo <> 'aprobado'
      UNION ALL SELECT 'presentacion_vigente' WHERE NOT EXISTS (
        SELECT 1 FROM presentaciones pres
        JOIN presentacion_revisiones rev ON rev.presentacion_id = pres.id
        WHERE pres.producto_id = p.id
          AND pres.deleted_at IS NULL
          AND rev.vigente_hasta IS NULL
      )
    ) faltante
  ) AS missing_core_fields
FROM productos p;
```

Los custom fields faltantes y reglas específicas por capacidad DEBEN convertirse en `ReadinessReason` estructurados en la capa de dominio; no se retorna solo un array de strings.

#### 5.9.2 Triggers/procedimientos obligatorios

| ID | Trigger/procedimiento | Conducta |
| --- | --- | --- |
| `DB-TRG-001` | `prevent_movimientos_mutation` | Rechaza todo UPDATE/DELETE ordinario sobre `movimientos`. |
| `DB-TRG-002` | `validate_lab_campo_producto_valor` | Bloquea tipo/opción/definition version/alcance incompatibles. |
| `DB-TRG-003` | `validate_lote_policy` | En INSERT de lote, exige/prohíbe vencimiento según `control_lote`; valida package/product. |
| `DB-TRG-004` | `prevent_used_presentacion_revision_change` | Solo permite cerrar `vigente_hasta`; prohíbe cambiar factor/nombres en revisión referenciada. |
| `DB-TRG-005` | `guard_operational_product_readiness` | Bloquea lot/event/order/receipt directo para producto no listo con code estable. |
| `DB-TRG-006` | `prevent_ready_import_revision_mutation` | Rechaza UPDATE/DELETE de mapping, hashes, rows y transforms en revisión `ready/superseded/committed`; solo permite transición de estado autorizada. |
| `DB-TRG-007` | `validate_import_commit_binding` | Antes de `committing`, compara batch y los cinco campos de binding con la revisión vigente `ready`; bloquea mismatch/superseded/segundo commit. |
| `DB-PROC-001` | `aplicar_movimiento_inventario` | Lock de balance, valida saldo, inserta evento y upsert de balance dentro de una TX. |
| `DB-PROC-002` | `reconstruir_stock` | Reconstruye a tabla sombra, compara, intercambia de forma controlada y emite reporte. |
| `DB-PROC-003` | `claim_idempotency` | Inserta claim o retorna replay/mismatch sin carrera. |
| `DB-PROC-004` | `commit_import_revision` | Ejecuta bajo SERIALIZABLE el binding check, commands tipados, outcomes/counts, audit/outbox y transiciones terminales; no llama CSV legacy. |

### 5.10 Matriz transaccional objetivo

| Comando | Lock/aislamiento | Escrituras en la misma TX | Fallo/retry |
| --- | --- | --- | --- |
| Crear/patch Product | row/version; READ COMMITTED suficiente con CAS | product, children afectados, audit, outbox | 412 en version; key conserva intención. |
| Submit/approve/reject/archive/reactivate | product `FOR UPDATE` | estado/lifecycle/version, audit, outbox | Ningún efecto colateral de inventario. |
| Revisar package | package + revisión actual `FOR UPDATE` | close old, insert new, identifiers, audit/outbox | Colisión/version=409/412; old queda intacta. |
| Agregar identifier | product/package lock | registry + version/audit | unique conflict=409 con owner seguro. |
| Confirmar recepción | `SERIALIZABLE` o locks deterministas por lot/area | receipt/detalle, lot, events, balances, upload link, audit/outbox | Todo commit o todo rollback; misma key replays. |
| Consumo/descarte | locks balance ordenados por PK | events, balances, audit/outbox | saldo insuficiente=422; sin evento parcial. |
| Guardar borrador de conteo | session/items con CAS | ítems no conflictivos + outcomes por ítem + audit | Puede ser `partial`; conserva local/server/version de conflictos y no crea movimientos. |
| Confirmar conteo | session/items/balances con locks deterministas | estado confirmado, todos los adjustment events, balances, audit/outbox | Cualquier conflicto=409/412 con diagnósticos; TX completa rollback, cero movimientos parciales. |
| Commit import | batch+revisión vigente `FOR UPDATE`, SERIALIZABLE | products/children, outcomes, counts, commit, audit/outbox y estados | Binding mismatch=409/412; rollback deja target writes/outcomes confirmados 0. |
| Vincular upload | upload `FOR UPDATE` | link al recurso y status | Retry no duplica; objeto huérfano expira. |

### 5.11 Eventos de dominio y auditoría

| ID/evento | Cuándo | Payload mínimo | Consumidores |
| --- | --- | --- | --- |
| `DOM-EVT-001` `product.created` | Product version 1 | product_id, status, actor, source | audit, search index |
| `DOM-EVT-002` `product.catalog_status_changed` | transición | from/to, reasons, version | notifications, setup |
| `DOM-EVT-003` `product.archived/reactivated` | lifecycle | reason, actor, version | UI caches, readiness |
| `DOM-EVT-004` `product_package.revised` | nuevo factor/nombre | package, old/new revision IDs, valid_from | procurement, UI |
| `DOM-EVT-005` `product_identifier.registered/retired` | registry change | kind, owner, value redacted cuando aplique | scanner cache |
| `DOM-EVT-006` `receipt.confirmed` | commit | receipt, supplier, event IDs, upload ID | reports/labels |
| `DOM-EVT-007` `inventory.event_recorded` | cada hecho | event ID/type/quantity/lot/area/source | balance reconciliation/metrics |
| `DOM-EVT-008` `import.committed/failed/rolled_back` | terminal batch | revision ID, schema/content/mapping/preview hashes, counts y outcome IDs | setup/history/alerts |
| `DOM-EVT-009` `idempotency.mismatch` | key reused with hash distinto | actor, route, key fingerprint, request IDs | security metric |

`OPS-AUDIT-001`: audit y outbox son append-only. `before_state`/`after_state` solo incluyen campos permitidos; contraseñas, tokens, PIN, API keys, datos binarios y headers de auth se redactan. Cada evento contiene `operation_id`, `correlation_id`, actor real y versión del agregado.

### 5.12 Producto concreto representativo: kit TSH de 96 determinaciones

Todos los datos de este ejemplo son sintéticos. El GTIN se eligió con checksum válido, pero no representa un producto comercial real.

#### 5.12.1 Intención clínica/comercial

| Dimensión | Valor objetivo |
| --- | --- |
| Producto | **Reactivo TSH ultrasensible, kit 96 determinaciones** |
| Código interno | `LAB-TSH-0001` |
| Categoría | `Reactivos de inmunoensayo` |
| Unidad base | `determinación` / `determinaciones` |
| Fabricante / MPN | `BioLab Diagnóstica` / `TSH-US-96` |
| Control de lote | `con_vto` |
| Almacenamiento | `2–8 °C`, cadena de frío requerida |
| Campo Lab requerido | `registro_sanitario_isp = ISP-SYN-2026-001` |
| Área | `Bodega Refrigerada` |
| Presentación | `Kit` / `Kits`, factor `96.000000` determinaciones por kit |
| GTIN sintético | `07801234567894` |
| Proveedor | `Diagnóstica Austral SpA` |
| SKU proveedor | `DA-TSH96` |
| Oferta | `245000.0000 CLP` por kit, vigente 2026-07-01 a 2026-12-31 |
| Lote | `TSH-2607-A`, vence `2027-06-30` |
| Recepción | 2 kits = `192.0000` determinaciones |
| Valoración | Total autoritativo `490000.0000 CLP`; razón unitaria exacta `490000.0000 / 192.0000`, display `2552.0833 CLP` |

#### 5.12.2 Estado persistido esperado

```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "name": "Reactivo TSH ultrasensible, kit 96 determinaciones",
  "internal_code": "LAB-TSH-0001",
  "estado_catalogo": "aprobado",
  "lifecycle": "current",
  "version": 4,
  "category": {"id": 12, "name": "Reactivos de inmunoensayo"},
  "unit": {
    "id": 8,
    "name": "determinación",
    "plural": "determinaciones"
  },
  "lot_control": "con_vto",
  "storage": {
    "location": "Bodega Refrigerada",
    "temperature_key": "cold_2_8_c",
    "cold_chain_required": true,
    "open_stability_days": 30
  },
  "manufacturer": {
    "name": "BioLab Diagnóstica",
    "part_number": "TSH-US-96"
  },
  "is_kit": true,
  "identifiers": [
    {"kind": "internal_code", "value": "LAB-TSH-0001", "owner": "product"},
    {"kind": "gtin", "value": "07801234567894", "owner": "package_revision"}
  ],
  "packages": [{
    "package_id": "22222222-2222-4222-8222-222222222222",
    "revision_id": "33333333-3333-4333-8333-333333333333",
    "revision": 1,
    "name": "Kit",
    "plural": "Kits",
    "factor_to_base": "96.000000",
    "valid_from": "2026-07-01T00:00:00Z",
    "valid_to": null
  }],
  "area_assignments": [{"id": 7, "name": "Bodega Refrigerada"}],
  "attributes": {
    "registro_sanitario_isp": "ISP-SYN-2026-001"
  },
  "readiness": {
    "policy_version": "product-readiness-v1",
    "catalog_complete": {"ready": true, "reasons": []},
    "inventory_ready": {"ready": true, "reasons": []},
    "receiving_ready": {"ready": true, "reasons": []},
    "purchasing_ready": {"ready": true, "reasons": []},
    "scanner_ready": {"ready": true, "reasons": []}
  }
}
```

#### 5.12.3 Oferta, recepción, lote y saldo

```json
{
  "offer": {
    "supplier_id": 42,
    "supplier_name": "Diagnóstica Austral SpA",
    "package_revision_id": "33333333-3333-4333-8333-333333333333",
    "supplier_sku": "DA-TSH96",
    "price": {"amount": "245000.0000", "currency": "CLP"},
    "valid_from": "2026-07-01T00:00:00Z",
    "valid_to": "2026-12-31T23:59:59Z"
  },
  "receipt": {
    "id": "66666666-6666-4666-8666-666666666666",
    "operation_id": "55555555-5555-4555-8555-555555555555",
    "supplier_id": 42,
    "status": "confirmed",
    "received_at": "2026-07-21T15:00:00Z",
    "business_timezone": "America/Punta_Arenas",
    "total": {"amount": "490000.0000", "currency": "CLP"},
    "lines": [{
      "product_id": "11111111-1111-4111-8111-111111111111",
      "package_revision_id": "33333333-3333-4333-8333-333333333333",
      "package_quantity": "2.0000",
      "base_quantity": "192.0000",
      "lot_number": "TSH-2607-A",
      "expiration_date": "2027-06-30",
      "area_id": 7,
      "line_total": {"amount": "490000.0000", "currency": "CLP"},
      "unit_cost_ratio": {
        "total_amount": "490000.0000",
        "base_quantity": "192.0000",
        "display_amount": "2552.0833",
        "currency": "CLP"
      }
    }]
  },
  "inventory_event": {
    "type": "entrada_recepcion",
    "sequence": 1,
    "lot_id": "44444444-4444-4444-8444-444444444444",
    "area_id": 7,
    "quantity_base": "192.0000",
    "cost_total": {"amount": "490000.0000", "currency": "CLP"},
    "source_type": "receipt",
    "source_id": "66666666-6666-4666-8666-666666666666"
  },
  "balance_after_commit": {
    "lot_id": "44444444-4444-4444-8444-444444444444",
    "area_id": 7,
    "quantity_base": "192.0000",
    "last_event_operation_id": "55555555-5555-4555-8555-555555555555"
  }
}
```

Comprobación obligatoria: `SUM(movimientos.cantidad)` para lote+área = `192.0000` = `stock.cantidad`, y `SUM(movimientos.costo_total)` de los eventos de esa línea = total de línea = total de recepción = `490000.0000 CLP`. El unitario mostrado `2552.0833` NO se multiplica para reconstruir el total. Si la línea se divide, el algoritmo de `DOM-MONEY-DEC-001` reparte a escala 4 y asigna el residual determinista al último `(operacion_id,secuencia)`. Un refetch muestra 192 determinaciones y, opcionalmente, “2 kits equivalentes”; nunca guarda “2” como saldo paralelo.

#### 5.12.4 Secuencia de auditoría esperada

| Orden | Aggregate/version | Acción | Efecto observable |
| ---: | --- | --- | --- |
| 1 | Product v1 | `product.created` | Nombre + código; `incompleto`. |
| 2 | Product v2 | `product.enriched` | Unidad, categoría, storage, atributo, área, package y GTIN; queda complete. |
| 3 | Product v3 | `product.catalog_status_changed` | `incompleto → pendiente_aprobacion`. |
| 4 | Product v4 | `product.catalog_status_changed` | `pendiente_aprobacion → aprobado`, actor/motivo. |
| 5 | SupplierOffer v1 | `supplier_offer.activated` | Proveedor, revisión, precio, moneda y vigencia. |
| 6 | Receipt v1 | `receipt.confirmed` | Dos kits, upload/guía, línea exacta. |
| 7 | Inventory operation | `inventory.event_recorded` | `+192.0000`; correlación con receipt. |

Si luego el factor correcto fuera 100, se crea Package revision 2 con factor `100.000000` y fecha futura. El evento y balance de la recepción anterior permanecen `192.0000`. Si la recepción fue capturada erróneamente, se registra una reversa `-192.0000` y un nuevo evento correcto; nunca se actualiza el evento original.

### 5.13 Contratos API objetivo

#### 5.13.1 Convenciones generales

| ID | Contrato |
| --- | --- |
| `API-COMMON-001` | Base `/api/v1`; JSON UTF-8; nombres de campos snake_case para preservar convención actual. |
| `API-COMMON-002` | OpenAPI se genera desde DTOs Rust canónicos; cliente/types TS se regeneran y CI falla ante diff no confirmado. |
| `API-COMMON-003` | Decimales son strings; fechas civiles `YYYY-MM-DD`; instantes RFC 3339 UTC. |
| `API-COMMON-004` | Toda respuesta incluye `X-Request-Id`; toda mutación exitosa incluye `operation_id`, `outcome`, `persisted_at` y versión/ETag cuando aplica. |
| `API-COMMON-005` | No se clampa paginación silenciosamente. `limit` válido 1–100; inválido=422. Listas grandes usan cursor opaco. |
| `API-COMMON-006` | GET es read-only. Materializar candidato regulatorio usa POST idempotente. |
| `API-COMMON-007` | Capability backend es autoridad; frontend no interpreta sidebar como autorización. |

#### 5.13.2 Endpoints de Producto

| ID | Método/ruta | Capability | Request/resultado |
| --- | --- | --- | --- |
| `API-PRODUCT-001` | `GET /productos` | `catalog.read` | Cursor, `q`, status, readiness, archived, category/area/supplier; read model resumido. |
| `API-PRODUCT-002` | `POST /productos` | `catalog.manage` o setup command | Crea `incompleto`; puede generar internal code si fuente import lo declara. |
| `API-PRODUCT-003` | `GET /productos/{id}` | `catalog.read` | Read model completo y edit-safe: todos los campos, identifiers, packages, attributes, readiness, version. |
| `API-PRODUCT-004` | `PATCH /productos/{id}` | `catalog.manage` | Merge patch tri-state + `If-Match`; no-op explícito. |
| `API-PRODUCT-005` | `POST /productos/{id}/submit` | `catalog.manage` | Valida completeness; transición. |
| `API-PRODUCT-006` | `POST /productos/{id}/approve` | `catalog.approve` | Solo transición; body con reason/expected_version; no factor. |
| `API-PRODUCT-007` | `POST /productos/{id}/reject` | `catalog.approve` | Motivo requerido. |
| `API-PRODUCT-008` | `POST /productos/{id}/archive` | `catalog.manage` | Reason + expected_version; conserva historia. |
| `API-PRODUCT-009` | `POST /productos/{id}/reactivate` | `catalog.manage` | Limpia archive; conserva catalog status. |
| `API-PRODUCT-010` | `GET /productos/{id}/readiness` | `catalog.read` | Capacidades/reasons/policy version. |
| `API-PRODUCT-011` | `GET /productos/schema` | auth; setup admin | Campos, tipos, aliases, allowed values, dependencias, límites y schema version. |

Create mínimo desde UI manual:

```json
{
  "name": "Reactivo TSH ultrasensible, kit 96 determinaciones",
  "internal_code": "LAB-TSH-0001",
  "source": "manual"
}
```

Response:

```json
{
  "operation_id": "<uuid>",
  "outcome": "success",
  "persisted_at": "2026-07-21T15:00:00Z",
  "resource": {"id": "<uuid>", "estado_catalogo": "incompleto", "version": 1},
  "effects": [{"type": "product.created", "id": "<uuid>"}],
  "warnings": []
}
```

PATCH:

```http
PATCH /api/v1/productos/11111111-1111-4111-8111-111111111111
Content-Type: application/merge-patch+json
If-Match: "product:11111111-1111-4111-8111-111111111111:1"
X-Idempotency-Key: product-edit-intent-<uuid>

{"description": null, "unit_id": 8}
```

`description:null` borra; campos omitidos permanecen. Un body vacío retorna el recurso sin incrementar versión y con `effects:[]`.

#### 5.13.3 Identificadores, packages, ofertas y políticas por área

| ID | Método/ruta | Regla |
| --- | --- | --- |
| `API-IDENT-001` | `POST /productos/{id}/identifiers` | kind/value/owner/expected product version; unique global. |
| `API-IDENT-002` | `DELETE /productos/{id}/identifiers/{identifier_id}` | Retira con `valid_to`; internal code no puede retirarse sin reemplazo atómico. |
| `API-PACKAGE-001` | `POST /productos/{id}/packages` | Crea identidad + revision 1; factor >0. |
| `API-PACKAGE-002` | `POST /productos/{id}/packages/{package_id}/revisions` | Cierra actual y crea nueva; reason/effective_at. |
| `API-PACKAGE-003` | `GET /productos/{id}/packages` | Devuelve current e historia paginada, no solo mutable actual. |
| `API-OFFER-001` | `GET /productos/{id}/ofertas?supplier_id=&at=` | Ofertas vigentes sobre revisión exacta. |
| `API-OFFER-002` | `POST /productos/{id}/ofertas` | Crea oferta; product se deriva/verifica desde package revision. |
| `API-OFFER-003` | `PATCH /ofertas/{id}` | Version/If-Match; no cambia package histórica, crea vigencia nueva si precio cambia. |
| `API-OFFER-004` | `DELETE /ofertas/{id}` | Cierra vigencia; no borra historia. |
| `API-OFFER-005` | `GET /proveedores/{id}/presentaciones?q=&cursor=` | Read model explícito de ofertas/package por proveedor; reemplaza ruta imaginada/fallback. |
| `API-POLICY-001` | `GET /productos/{id}/areas/{area_id}/inventory-policy` | Read model/version de `InventoryPolicy`; 404 significa no configurada, no defaults persistidos. |
| `API-POLICY-002` | `PUT /productos/{id}/areas/{area_id}/inventory-policy` | Command completo con `If-Match`; defaults `safety_stock=0`, `max_stock=null`; valida orden/demanda y no pasa por PATCH Product. |
| `API-POLICY-003` | `POST /inventory-policies/import-batches` | Crea el batch durable de la plantilla canónica de políticas; usa las mismas revisiones/hashes/commit que productos. |

#### 5.13.4 Scanner y candidatos

| ID | Método/ruta | Regla |
| --- | --- | --- |
| `API-SCAN-001` | `GET /productos/scan/lookup?codigo=` | Read-only, resolución única; 404 o 409 candidates si hay datos legacy ambiguos. |
| `API-SCAN-002` | `POST /catalog-candidates` | Materializa resultado externo con idempotencia, audit y pending review. |
| `API-SCAN-003` | `POST /recepciones/scanner-session/{token}/events` | Público token-scoped; evento con client_event_id y secuencia; no JWT. |
| `API-SCAN-004` | `GET /recepciones/scanner-session/{id}/events?after=` | Estación autenticada obtiene eventos sin marcarlos ack. |
| `API-SCAN-005` | `POST /recepciones/scanner-session/{id}/ack` | Ack idempotente hasta secuencia; pérdida de respuesta no pierde evento. |

#### 5.13.5 Recepción y uploads

| ID | Método/ruta | Regla |
| --- | --- | --- |
| `API-UPLOAD-001` | `POST /uploads/initiate` | purpose/media_type/size/sha; retorna upload_id y destino limitado. |
| `API-UPLOAD-002` | `POST /uploads/{id}/complete` | Verifica checksum/media/size/scan; status `verified`. |
| `API-RECEIPT-001` | `POST /recepciones` | Command único: header+all lines+upload_id+decision; todas las líneas explícitas. |
| `API-RECEIPT-002` | `GET /recepciones/{id}` | Read model con línea/package revision/lot/events/upload y status. |
| `API-RECEIPT-003` | `POST /recepciones/{id}/confirm` | Solo para draft recuperable; idempotente y atómico. |
| `API-RECEIPT-004` | `POST /recepciones/{id}/compensate` | Reversas auditadas; no DELETE de eventos confirmados. |

Cada línea debe declarar `line_id`, `product_id`, `package_revision_id`, `package_quantity`, `area_id`, `lot_number`, `expiration_date`, `offer_id` o precio explícito con permiso. `payload.lines.length` DEBE igualar líneas visibles no excluidas y el backend vuelve a validar esa invariante.

#### 5.13.6 Error estructurado

```json
{
  "error": {
    "code": "PRODUCT_NOT_READY",
    "message": "El producto no está listo para recepción.",
    "status": 422,
    "request_id": "req_<opaque>",
    "operation_id": "<uuid-or-null>",
    "retryable": false,
    "field_errors": [
      {"path": "lines[1].expiration_date", "code": "REQUIRED_FOR_LOT_POLICY",
       "message": "La fecha de vencimiento es obligatoria."}
    ],
    "conflict": null,
    "details": {"capability": "receiving_ready", "policy_version": "product-readiness-v1"}
  }
}
```

| Status | Uso |
| ---: | --- |
| 400 | JSON/multipart malformado. |
| 401 | Sin autenticación válida. |
| 403 | Capability ausente; sin filtrar datos sensibles. |
| 404 | Recurso inexistente o no visible. |
| 409 | Colisión de identidad, transición o idempotency hash mismatch. |
| 412 | ETag/version no coincide. |
| 422 | Validación/readiness/regla de negocio. |
| 429 | Rate limit único, body común y `Retry-After`. |
| 503 | Dependencia obligatoria no disponible/readiness del servicio. |

`API-ERROR-001`: los errores SQL conocidos (unique/FK/check/serialization) DEBEN mapearse a códigos estables; input del usuario no puede terminar en `INTERNAL_ERROR` genérico. `API-ERROR-002`: `partial` solo se usa cuando la operación fue diseñada con outcomes por elemento; incluye `persisted[]`, `conflicts[]`, `rejected[]` y jamás se expresa solo por 200.

#### 5.13.7 Paginación, filtros y cancelación

```json
{
  "data": [],
  "page": {
    "limit": 50,
    "next_cursor": "opaque-or-null",
    "previous_cursor": "opaque-or-null",
    "total": 250
  },
  "applied_filters": {
    "q": "tsh",
    "estado_catalogo": ["aprobado"],
    "area_id": [7]
  }
}
```

- Filtros multi-value se repiten o usan arrays según OpenAPI, nunca strings ambiguos.
- Orden incluye tie-breaker estable (`name,id` o `occurred_at,id`).
- React Query cancela requests obsoletos mediante `AbortSignal`.
- El servidor valida rango `from <= to`; no interpreta rango inválido como vacío.
- CSV/Excel export usa exactamente los filtros confirmados y expone job/status cuando el dataset es grande.

#### 5.13.8 Idempotencia por intención

`API-IDEMPOTENCY-001`: scope = `(actor_id, method, route_template, key)`.  
`API-IDEMPOTENCY-002`: el hash incluye body canónico, path params y query semántica.  
`API-IDEMPOTENCY-003`: mismo scope+hash devuelve status/body/resource version originales.  
`API-IDEMPOTENCY-004`: mismo scope+hash distinto devuelve 409, sin filtrar la respuesta previa.  
`API-IDEMPOTENCY-005`: la UI crea la key cuando nace la intención y la rota solo tras éxito, cancelación confirmada o cambio material de payload.  
`API-IDEMPOTENCY-006`: claims concurrentes producen una sola mutación; el segundo espera con timeout o recibe `operation_in_progress`, nunca ejecuta dos veces.

#### 5.13.9 Conteo, configuración y handoff externo

| ID | Método/ruta | Contrato cerrado |
| --- | --- | --- |
| `API-COUNT-001` | `PATCH /conteos/{id}/items` | Guarda **borrador** con `If-Match`; retorna `success` o `partial` con `persisted[]` y `conflicts[]`. Solo ítems persistidos avanzan versión; no crea movimientos ni cambia saldo. |
| `API-COUNT-002` | `POST /conteos/{id}/confirm` | Admin + idempotency key + expected session/item versions. Es atómico: un conflicto devuelve 409/412 y diagnósticos de todos los ítems, mantiene sesión editable y confirma **cero** movimientos/saldos. |
| `API-CONFIG-001` | `GET /configuracion/{section}` | `section ∈ {branding,inventory_demand,expiration,ai_models,lab_fields}`; retorna DTO mínimo, `version` y ETag propios. |
| `API-CONFIG-002` | `PATCH /configuracion/{section}` | Command atómico de una sección con `If-Match`; response/effects/refetch acotados. No existe endpoint ni botón de save global. |
| `API-WHATSAPP-001` | `POST /external-handoffs/whatsapp` | Registra intención con actor, recipient normalizado, template key y resource refs; retorna `handoff_id` y URL externa allowlisted. Estado inicial `intent_registered`; no envía mensaje. |
| `API-WHATSAPP-002` | `POST /external-handoffs/{id}/user-result` | El actor declara `confirmed_opened`, `reported_not_sent` o `cancelled`; persiste actor/fecha/audit. Ningún estado se llama sent/delivered. |
| `API-WHATSAPP-003` | `GET /external-handoffs/{id}` | Devuelve solo intención y resultado declarado por usuario. La UI DEBE rotularlo “confirmado por usuario”, nunca “entregado”. |

La URL de handoff se construye server-side sobre el host externo allowlisted y se abre mediante acción explícita; nunca se acepta una URL destino arbitraria. La integración operacional con provider/webhook está **fuera de alcance** y solo puede introducirse mediante otro cambio con autenticidad de webhook, delivery receipts, health, retries e idempotencia propios.

### 5.14 Importador único, durable y gobernado por schema

#### 5.14.1 Flujo

```text
upload/paste
  -> persistir source + sha256
  -> detectar encoding/delimitador
  -> mapping unívoco
  -> normalizar cada raw row con schema version
  -> transforms tipados y auditados
  -> validar estructura, identidad, duplicados y completeness
  -> preview revision/hash inmutable
  -> corregir o excluir explícitamente errores
  -> commit SERIALIZABLE del mismo hash
  -> outcomes reconciliables + cuarentena/readiness
  -> history/download/rollback condicionado
```

#### 5.14.2 Reglas normativas

| ID | Regla |
| --- | --- |
| `API-IMPORT-001` | `/productos/schema` gobierna columnas, aliases, tipos, allowed values, dependencias y límites. No hay listas paralelas en React/Rust. |
| `API-IMPORT-002` | Remap/edición/transform/exclusión crea revisión N+1 desde `source_revision_id`, reconstruye `normalized` desde `raw` para todas las filas y marca la previa `superseded` dentro de una TX; nunca sobrescribe una preview. |
| `API-IMPORT-003` | Preview y commit comparten exactamente `revision_id`, `schema_version`, `content_hash`, `mapping_hash` y `preview_hash`. Cualquier cambio crea otra revisión e invalida el binding previo. |
| `API-IMPORT-004` | El commit consume commands tipados; NO serializa CSV ni llama al parser legacy. |
| `API-IMPORT-005` | Name-only genera internal code determinista/único en preview y persiste `incompleto`; no puede operar hasta enriquecer/aprobar. |
| `API-IMPORT-006` | Tokens desconocidos de boolean/enum/date son error por fila/campo; nunca caen a `false`/`con_vto`. |
| `API-IMPORT-007` | `stock_minimo` solo es alias legacy de `reorder_point` y `promedio_uso_mensual_inicial` solo de `monthly_demand_baseline`; ambos pertenecen a `InventoryPolicy` y requieren `area_code`. Sin área son error bloqueante, nunca columnas de Product ni descarte silencioso. |
| `API-IMPORT-008` | `precio_unitario` requiere proveedor, package y moneda; dependencia ausente es blocking diagnostic. |
| `API-IMPORT-009` | Duplicate strategy real: `reject`, `skip`, `fill_empty`, `review`; nombre parecido solo sugiere, no identifica. |
| `API-IMPORT-010` | Campos Lab crean valores tipados por UUID/version. Crear definición inline es un command separado y obliga a regenerar schema/mapping. |
| `API-IMPORT-011` | Límites: 5 MiB, 5.000 filas, 64 columnas, 4 KiB por celda; rechazo antes de cargar todo en memoria cuando sea posible. |
| `API-IMPORT-012` | Se soporta `.csv` case-insensitive, UTF-8 BOM, coma y `;`; otras codificaciones requieren conversión explícita. |
| `API-IMPORT-013` | Counts: `total`, `structurally_valid`, `committed_ready`, `committed_incomplete`, `excluded`, `rejected`, `confirmed`; sumas deben reconciliar. |
| `API-IMPORT-014` | Rollback solo si no hay dependencias operativas; conserva batch/audit/outcomes y usa comandos compensatorios cuando corresponda. |

#### 5.14.3 Endpoints y binding de revisión

| ID | Método/ruta | Request/resultado y transición |
| --- | --- | --- |
| `API-IMPORT-015` | `POST /import-batches` | `upload_id`, `import_kind` en `products`, `inventory_policies`, duplicate strategy. Crea batch `uploaded` y revisión 1 `draft` con `content_hash`; devuelve ambos IDs. |
| `API-IMPORT-016` | `GET /import-batches/{batch_id}` | Reanudación: batch, `current_revision_id`, estado, historial de revisiones/commits y counts; no reparsea fuente. |
| `API-IMPORT-017` | `POST /import-batches/{batch_id}/revisions` | `source_revision_id`, expected current, mapping, edits, transforms y exclusions. Crea N+1 `mapped`, rows versionadas y `mapping_hash`; marca origen `superseded` atómicamente. |
| `API-IMPORT-018` | `POST /import-batches/{batch_id}/revisions/{revision_id}/validate` | Normaliza/valida la revisión no terminal y la deja `validated` con diagnostics/counts. Repetición exacta es no-op; una corrección exige N+1. |
| `API-IMPORT-019` | `POST /import-batches/{batch_id}/revisions/{revision_id}/preview` | Calcula representación canónica, fija `preview_hash`, `ready_at` y estado `ready`; response contiene el binding completo y filas/outcomes previstos. Desde aquí es inmutable. |
| `API-IMPORT-020` | `POST /import-batches/{batch_id}/commits` | Body contiene los cinco campos del binding; `X-Idempotency-Key` obligatorio. Lock/revalida vigente+ready y ejecuta `DB-PROC-004`; responde commit/operation/counts/targets persistidos. |
| `API-IMPORT-021` | `GET /import-batches/{batch_id}/commits/{commit_id}` | Read-after-write/replay: binding, status, counts, outcomes y target IDs; un intento failed no puede aparentar targets committed. |

`API-IMPORT-BINDING-001`: `import_commits` conserva una copia de los cinco campos y referencia `(revision_id,batch_id)`; `DB-TRG-007` exige igualdad byte a byte con la revisión y que esta sea `current + ready`. `API-IMPORT-BINDING-002`: un commit exitoso es único por revisión; target writes, outcomes, counts, audit/outbox y estados terminales comparten TX. El registro de un intento `failed` ocurre solo después del rollback y contiene cero target IDs.

#### 5.14.4 Plantillas objetivo

Mínima válida:

```csv
nombre
Reactivo TSH ultrasensible
```

El preview muestra el internal code generado y `estado_catalogo=incompleto`; no promete readiness.

Completa de producto: la descarga DEBE obtener keys/allowed values reales del schema, no labels localizados. No contiene política de stock ni demanda.

```csv
nombre,codigo_interno,unidad,categoria,control_lote,temperatura_almacenamiento,requiere_cadena_frio,fabricante,mpn,formato_presentacion,nombre_presentacion,factor_conversion,gtin,proveedor,codigo_proveedor,precio_unitario,moneda,area,lab_<UUID_REGISTRO_ISP>
Reactivo TSH ultrasensible kit 96,LAB-TSH-0001,determinacion,reactivos_inmunoensayo,con_vto,cold_2_8_c,true,BioLab Diagnóstica,TSH-US-96,kit,Kit,96,07801234567894,Diagnóstica Austral SpA,DA-TSH96,245000,CLP,Bodega Refrigerada,ISP-SYN-2026-001
```

JSON normalizado esperado para esa fila de producto:

```json
{
  "entity": "product",
  "product": {
    "name": "Reactivo TSH ultrasensible kit 96",
    "internal_code": "LAB-TSH-0001",
    "unit_key": "determinacion",
    "category_key": "reactivos_inmunoensayo",
    "lot_control": "con_vto",
    "temperature_key": "cold_2_8_c",
    "cold_chain_required": true,
    "manufacturer": "BioLab Diagnóstica",
    "mpn": "TSH-US-96"
  },
  "package": {"format_key": "kit", "name": "Kit", "factor_to_base": "96.000000"},
  "identifiers": [{"kind": "gtin", "value": "07801234567894"}],
  "offer": {
    "supplier_key": "Diagnóstica Austral SpA",
    "supplier_sku": "DA-TSH96",
    "price": {"amount": "245000.0000", "currency": "CLP"}
  },
  "area_assignment": {"area_code": "bodega_refrigerada"},
  "attributes": {"lab_<UUID_REGISTRO_ISP>": "ISP-SYN-2026-001"}
}
```

Plantilla canónica separada de `InventoryPolicy`:

```csv
product_code,area_code,safety_stock,reorder_point,max_stock,monthly_demand_baseline
LAB-TSH-0001,bodega_refrigerada,0,192,,48
```

JSON normalizado esperado:

```json
{
  "entity": "inventory_policy",
  "product_code": "LAB-TSH-0001",
  "area_code": "bodega_refrigerada",
  "safety_stock": "0.0000",
  "reorder_point": "192.0000",
  "max_stock": null,
  "monthly_demand_baseline": "48.0000"
}
```

Defaults: `safety_stock="0.0000"`; `max_stock=null` permitido; `reorder_point >= safety_stock`; si max no es null, `max_stock >= reorder_point`; `monthly_demand_baseline >= 0`. Los aliases legacy `stock_minimo` y `promedio_uso_mensual_inicial` se aceptan solo en esta plantilla, mapean exactamente a `reorder_point` y `monthly_demand_baseline`, y requieren `area_code`.

`TEST-IMPORT-TEMPLATE-001`: descargar → importar sin editar la plantilla completa de producto produce exactamente el primer JSON, preview `ready` y commit reconciliado. `TEST-IMPORT-TEMPLATE-002`: el mismo roundtrip para políticas produce el segundo JSON y un `InventoryPolicy` versionado; repetir con los dos aliases legacy produce el mismo normalized/hash semántico, y omitir `area_code` falla antes del commit.

El backend DEBE rechazar una columna mapeada dos veces, una dependencia comercial incompleta y un GTIN con checksum/colisión inválidos. El grid puede sugerir transformaciones, pero cada transformación muestra diff, filas afectadas, impacto de readiness y requiere confirmación; “Auto-Doctor” no escribe silenciosamente.

### 5.15 Transición apta para desarrollo activo

#### 5.15.1 Estrategia

1. Congelar endpoints destructivos mediante los controles 1.2.
2. Añadir tests de caracterización de P0 sobre la base actual.
3. Crear una nueva baseline de desarrollo coherente; no intentar preservar datos no productivos.
4. Recrear DB local/CI y cargar fixtures/seed sintéticos aprobados.
5. Implementar commands/read models sobre el esquema nuevo.
6. Regenerar OpenAPI/TS y hacer que el frontend compile solo con cliente generado.
7. Migrar el SmartImporter al batch durable y hacer del endpoint directo un adapter temporal.
8. Migrar pantallas por capability y estado común; ocultar features sin backend real.
9. Eliminar tablas/columnas/rutas legacy solo después de contract/integration tests.
10. Ejecutar gate integral sobre una base nueva y una imagen candidata con SHA.

#### 5.15.2 Mapeo legacy → objetivo

| Legacy | Objetivo | Acción |
| --- | --- | --- |
| `productos.activo` | derivado de `deleted_at` | Eliminar. |
| `productos.deleted_at` | `productos.deleted_at/deleted_by/motivo_eliminacion` | Conservar y completar metadata. |
| `productos.codigo_interno` | `producto_identificadores(tipo=codigo_interno)` | Mover y validar único. |
| `presentaciones` mutable | `presentaciones` + revisions | Recrear; ningún reescalado histórico. |
| columnas barcode/GTIN | `producto_identificadores` | Consolidar namespace. |
| `stock` + `stock_snapshot` | `movimientos` + `stock` | Reemplazar; fixture inicial usa `stock_inicial`. |
| `movimientos` mutable | `movimientos` | Reemplazar; bloquear mutación. |
| `producto_area` umbrales | `producto_area` + `politicas_reposicion` | Separar ownership. |
| `par_level_config` | `politicas_reposicion` | Eliminar después de seed. |
| custom typed columns | JSONB validado | Recrear valores desde fixtures si se necesitan. |
| `/setup/importar-productos` | adapter a batch, luego 410/eliminación | Sin lógica propia. |
| `PUT /productos/{id}` | PATCH + transitions | Deprecation header, luego eliminar. |
| `/productos/scan` con side effect | lookup GET + POST candidate | Separar command/query. |
| filesystem uploads | object storage + upload registry | No copiar archivos efímeros. |

`OPS-MIGRATION-001`: cualquier reset automático destructivo queda limitado a entornos explícitos `development/test`, con guard de host/nombre y confirmación de schema fingerprint. En producción futura las migraciones son fail-closed; nunca se reutiliza el mecanismo de reset.

---

## 6. Impacto y mejora de rutas, pestañas, subpestañas, diálogos y botones

Esta sección aparece **después** del modelo de Producto porque la UI debe representar contratos de dominio, no inventarlos. Se conservan las 23 rutas actuales cuando su propósito sigue siendo válido; se corrige su política, semántica y estado. El wildcard se especifica aparte.

### 6.1 Contrato transversal obligatorio para toda pantalla/destino

Las siguientes reglas aplican a cada ruta y a los 50 destinos internos. Las tablas posteriores solo declaran deltas específicos.

#### 6.1.1 Estado de lectura

`UI-COMMON-001`: define una unión exhaustiva:

```ts
type AsyncResourceState<T> =
  | { kind: "idle" }
  | { kind: "loading"; previous?: T }
  | { kind: "data"; data: T; fetchedAt: string; stale: boolean }
  | { kind: "empty"; fetchedAt: string }
  | { kind: "error"; error: ApiError; previous?: T }
  | { kind: "retrying"; previous?: T; attempt: number };
```

- `empty` solo se produce después de una respuesta 2xx válida con cero elementos.
- `error` diferencia auth, permission, not-found, validation, conflict, network, timeout y server.
- Durante refetch se mantienen datos previos con indicador “actualizando”; no se reemplazan por skeleton/empty.
- Cada error ofrece acción segura: reintentar lectura, volver, iniciar sesión o solicitar permiso según el caso.
- Los filtros activos se preservan en URL cuando la pantalla es navegable/revisable.

#### 6.1.2 Estado de comando

`UI-COMMON-002`:

```ts
type CommandState<R> =
  | { kind: "idle" }
  | { kind: "validating" }
  | { kind: "submitting"; operationKey: string }
  | { kind: "success"; result: R; observedVersion: string }
  | { kind: "partial"; persisted: unknown[]; conflicts: unknown[]; rejected: unknown[] }
  | { kind: "conflict"; local: unknown; server: unknown }
  | { kind: "rejected"; error: ApiError }
  | { kind: "unknown"; operationKey: string };
```

- `unknown` se usa cuando se perdió la respuesta; consulta por `operation_id`/idempotency key antes de reintentar.
- El botón primario es reentrante: guard síncrono/ref + disabled/pending; no depende solo del siguiente render.
- El mismo `operationKey` persiste durante retry de la misma intención.
- `success` requiere respuesta persistida + invalidación/refetch o actualización canónica con versión.
- Un toast es complementario; nunca es la única prueba.

#### 6.1.3 Permisos y precondiciones

`UI-COMMON-003`: cada route loader evalúa la capability antes de disparar queries sensibles. El backend repite el control. Un 403 renderiza una página 403 completa, no estructura vacía. Acciones dentro de una ruta verifican capabilities independientes: leer no implica mutar, confirmar o administrar.

#### 6.1.4 Cancelación, rollback y salida

`UI-COMMON-004`:

- Queries obsoletas se cancelan con `AbortSignal`.
- Cerrar un diálogo con cambios pregunta una sola vez y conserva draft si existe soporte.
- Wizards largos tienen draft server-side o advertencia de salida; F5 reconstruye desde servidor/revisión.
- Cancelar una operación `submitting` no promete cancelar el servidor; pasa a `unknown` y reconcilia.
- Undo solo se ofrece cuando existe un command compensatorio seguro. No se usa para borrar ledger.
- Destructivos exigen confirmación proporcional, impacto y motivo cuando el dominio lo requiere.

#### 6.1.5 Invalidación/refetch por recurso

| Recurso mutado | Queries mínimas a invalidar/refetch |
| --- | --- |
| Product/identifier/package/readiness | detalle, lista catálogo, stock autocomplete, cuarentena, schema solo si definición cambió. |
| Supplier offer | ofertas producto, presentaciones proveedor, solicitud/recepción selector. |
| Receipt/upload | lista por tabs, detalle, stock/lotes, movimientos, solicitud/OC vinculada, guía. |
| Inventory event | stock, lotes, movimientos, dashboard alerts, reportes afectados. |
| Count | lista sesión, detalle, stock, movimientos si confirmó ajustes. |
| Import batch | batch/history/rows/setup blockers, catálogo/readiness después de commit. |
| Config/capabilities | config/branding/auth-me según campos; nunca invalidar secretos al cliente. |
| User/area | listas, auth-me si usuario actual, filtros/catálogos dependientes. |

`UI-COMMON-005`: una invalidación no debe producir tormenta; se agrupa por `operation_id`, usa keys canónicas y espera el commit confirmado.

#### 6.1.6 Responsive, teclado y accesibilidad

`UI-COMMON-006`:

- Breakpoints mínimos: móvil 320 px, tablet 768 px, escritorio 1280 px; sin pérdida de acciones/datos.
- Tablas críticas ofrecen cards/drawer equivalentes en móvil; ocultar una columna nunca elimina su información.
- Tabs usan `tablist`, `tab`, `tabpanel`, `aria-selected`, flechas, Home/End y foco visible.
- Diálogos usan `role=dialog`, `aria-modal`, label/description, focus trap, retorno de foco y Escape salvo operación no cancelable explícita.
- Todos los icon buttons tienen nombre accesible; errores se asocian con `aria-describedby`; regiones async usan live region sin spam.
- Foco del error se mueve al primer campo inválido y, si está en otra pestaña, activa esa pestaña y muestra badge.
- Cámara, gráficos y PDF tienen alternativa textual/teclado.
- Contraste WCAG AA, targets táctiles ≥44×44 y `prefers-reduced-motion` respetado.

#### 6.1.7 Jerarquía visual compartida

`UI-COMMON-007`: cada página usa el orden **título y propósito → estado/contexto → acción primaria → filtros → contenido → acciones secundarias**. El color comunica estado junto con texto/icono, nunca solo color. Éxito persistido usa un resumen verificable con ID/versión; warnings y partial permanecen visibles hasta resolver.

### 6.2 Matriz objetivo de capacidades

| Capability | Consulta | Tecnólogo | Admin | Público token-scoped |
| --- | :---: | :---: | :---: | :---: |
| `dashboard.read` | sí | sí | sí | no |
| `inventory.read`, `movement.read` | sí | sí | sí | no |
| `stock.operate`, `discard.create`, `consumption.create` | no | sí | sí | no |
| `receipt.read` | sí | sí | sí | no |
| `receipt.manage` | no | sí | sí | no |
| `count.read`, `count.edit` | no | sí | sí | no |
| `count.confirm` | no | no | sí | no |
| `catalog.read` | sí | sí | sí | no |
| `catalog.review` | no | sí | sí | no |
| `catalog.manage`, `catalog.approve` | no | no | sí | no |
| `purchase_request.create/manage_own` | sí | sí | sí | no |
| `purchase_request.manage_all`, `purchase_order.manage` | no | no | sí | no |
| `purchase_order.read_sensitive` | no | no | sí | no |
| `reports.read_sensitive` | no | no | sí | no |
| `label.print` | sí | sí | sí | no |
| `config.manage`, `users.manage`, `areas.manage`, `audit.read`, `setup.manage` | no | no | sí | no |
| `scanner.event.submit` | no | no | no | sí, solo sesión/token |

Reglas de Solicitudes: consulta/tecnólogo pueden crear, editar y cancelar su propio borrador; una vez enviado, solo acciones expresamente permitidas por estado/capability. Crear OC, gestionar precios globales o actuar sobre borradores ajenos requiere admin. El backend filtra por owner cuando aplica.

### 6.3 Contratos por ruta en orden de navegación y dependencia

#### `UI-LOGIN-001` — `/login`

- **Objetivo/actor/precondición:** autenticar a un usuario no autenticado; branding público disponible, sin exponer configuración admin.
- **Happy path y acciones:** email + contraseña → **Iniciar sesión** → `POST /auth/login` → `GET /auth/me` con capacidades → redirect a ruta original autorizada. **Soporte** abre canal externo con copy claro.
- **Estados:** campos vacíos/invalid credentials/rate limit/red se distinguen; pending bloquea reentrada. No hay empty state. Cancelar request conserva email, nunca contraseña.
- **Conservar:** required, botón pending y enlace de soporte. **Quitar/reformular:** mensajes genéricos indistinguibles y cualquier lectura de PIN/config completa.
- **Visual/a11y:** formulario único centrado, branding secundario; autocomplete correcto; error summary y foco.
- **Aceptación:** DADO login válido, CUANDO responde y `/auth/me` confirma capacidades, ENTONCES la sesión queda persistida y la ruta original se abre; DADO 429, ENTONCES se muestra espera de `Retry-After` sin reenviar.
- **Pruebas mínimas:** component + API contract + E2E valid/invalid/429/refresh concurrente/teclado.

#### `UI-DASHBOARD-001` — `/`

- **Objetivo/actor/precondición:** resumen operacional para todo autenticado; datos limitados por capability.
- **Happy path/acciones:** cargar KPIs/alertas → abrir **Ver stock**, **Crear solicitud** o acción permitida. APIs: `/stock`, `/stock/alertas`, `/areas`, endpoints agregados paginados.
- **Estados/invalidation:** cada card puede fallar/reintentar de forma independiente; un panel fallido no convierte el dashboard entero en cero. Eventos de inventario/readiness invalidan KPIs.
- **Conservar:** accesos rápidos y retry de alertas. **Mover:** administración fuera de accesos para no-admin. **Quitar:** métricas sin definición/fecha.
- **Visual/a11y:** “última actualización”, severidad textual, orden P0 operativo → tendencia → accesos; cards lineales en móvil.
- **Aceptación:** DADO fallo de alertas y KPIs válidos, CUANDO carga, ENTONCES KPIs quedan visibles y alertas muestran error; no “0 alertas”.
- **Pruebas:** empty/data/error parcial, capability links, stale/refetch, 320 px.

#### `UI-STOCK-001` — `/stock`

- **Objetivo/actor/precondición:** consultar saldo por producto/lote/área; operar solo con `stock.operate`.
- **Happy path/acciones:** buscar/filtrar/paginar → seleccionar producto → destinos **Lotes Activos** o **Historial** → **Exportar**, **Consumir**, **Descartar**, y admin **Nuevo producto**. APIs cursor `/stock`, `/lotes`, `/movimientos`; commands de consumo/descarte.
- **Estados/invalidation:** lista y panel tienen estados independientes; fallo principal es error, no vacío. Después de evento se refetch stock/lote/movimientos/dashboard. Export usa mismos filtros y job verificable.
- **Cancelación:** cerrar panel conserva filtros URL; PDF cancelable antes de generar; command en vuelo reconcilia por operation key.
- **Conservar:** filtros dinámicos, FEFO, recuperación de página. **Reformular:** historial server-side y autocomplete remoto. **Quitar:** requests `per_page=200` y probes error→sin stock.
- **Visual/a11y:** saldo base prominente, equivalencias de package secundarias, estado de vencimiento textual; drawer accesible en móvil.
- **Aceptación:** DADO 250 productos, CUANDO se busca el 201, ENTONCES aparece; DADO 500, ENTONCES error/retry, no lista vacía.
- **Pruebas:** cursor/search, >100 movimientos, permissions, PDF filter parity, keyboard panel.

#### `UI-CONSUMOS-001` — `/consumos`

- **Objetivo/actor/precondición:** registrar consumo FEFO para admin/tecnólogo; consulta recibe 403 antes de queries.
- **Happy path/acciones:** elegir área → buscar/escanear → seleccionar lote o aceptar FEFO → ajustar cantidad → **Revisar** → **Confirmar consumo** con operation key. APIs lookup/stock/lotes y `POST /consumos/batch`.
- **Estados/invalidation:** sin stock real tras 2xx se distingue de error; readiness reason bloquea línea. Éxito requiere eventos/balance/refetch y números de movimiento.
- **Cancelación:** **Vaciar** confirma si hay líneas; salir conserva draft local cifrado solo si política lo permite; unknown reconcilia antes de repetir.
- **Conservar:** drawer, lote sugerido, revisión y bloqueo de cantidades. **Reformular:** scan GET read-only y key por intención. **Quitar:** fallback arbitrario.
- **Visual/a11y:** carrito/resumen sticky sin cubrir contenido; cámara con entrada manual; shortcuts documentados y desactivables.
- **Aceptación:** DADO doble clic/red perdida, CUANDO se confirma, ENTONCES existe un solo grupo de eventos; el refetch coincide con ledger.
- **Pruebas:** FEFO, insufficient stock, archived/not-ready, double click, offline/unknown, role matrix.

#### `UI-DESCARTES-001` — `/descartes`

- **Objetivo/actor/precondición:** crear descartes auditados o consultar historial según capability.
- **Happy path/acciones:** admin/tecnólogo entra a **Nuevo Descarte**, elige lote/cantidad/motivo; material sano exige justificación; **Confirmar** crea evento. Consulta aterriza en **Historial** sin DOM de creación. APIs lotes vencidos, `POST/GET /descartes`, acta/PDF.
- **Estados/invalidation:** conservar manejo explícito de error/empty; success muestra acta ID y refetch stock/movimientos/historial. PDF no sustituye persistencia.
- **Cancelación:** confirmación de material sano; no undo de ledger, solo compensación autorizada.
- **Conservar:** filtros y justificación de 10 caracteres. **Reformular:** motivo catálogo versionado + idempotencia. **Quitar:** acceso tardío a 403.
- **Visual/a11y:** advertencia clara por lote vencido/sano; motivo y impacto antes del CTA destructivo.
- **Aceptación:** DADO consulta, CUANDO abre ruta directa, ENTONCES solo Historial; DADO material sano sin razón, ENTONCES 0 requests.
- **Pruebas:** roles, >0/decimal, healthy reason, replay, error history, PDF correlation.

#### `UI-RECEPCIONES-001` — `/recepciones`

- **Objetivo/actor/precondición:** consultar y gestionar ciclo de recepciones; lectura para autenticados, mutación para `receipt.manage`.
- **Happy path/acciones:** filtros y destinos **Borradores**, **Confirmadas**, **Todas**, **Guías Respaldadas**; abrir detalle; **Nueva recepción**, **Confirmar**, **Eliminar borrador**, **Adjuntar/Reemplazar guía**, **Etiquetas** según capability.
- **APIs:** cursor `/recepciones`, detalle, confirm/cancel, uploads; no DELETE para confirmadas.
- **Estados/invalidation:** error por pestaña, empty específico; mutación refetch lista/detalle/stock/guía. Tab/filtros en URL.
- **Cancelación/rollback:** borrar solo draft con confirmación; confirmada usa compensación. Upload fallido no cambia guía visible.
- **Conservar:** agrupamiento de cuatro tabs y panel. **Reformular:** foto via upload_id. **Quitar:** query error→empty y delete ambiguo.
- **Visual/a11y:** status+progreso+proveedor/número como jerarquía; acciones destructivas en menú secundario; drawer accesible.
- **Aceptación:** DADO 403/500 en una pestaña, CUANDO abre, ENTONCES muestra error y preserva otras; DADO upload confirmado, refetch muestra checksum/estado linked.
- **Pruebas:** 4 tabs data/empty/error, route role, draft cancel, guide retry, invalidation graph.

#### `UI-RECEPCIONES-NUEVA-001` — `/recepciones/nueva`

- **Objetivo/actor/precondición:** construir una recepción completa/reanudable; admin/tecnólogo, proveedor/productos ready.
- **Happy path/acciones:** **Proveedor y guía** → **Ítems y lotes** → **Decisión** → **Confirmar recepción**. Acciones: vincular solicitud, importar/analizar guía, cámara/QR, asignar código, agregar/excluir línea con razón, reconciliar, imprimir etiquetas post-commit.
- **APIs:** suppliers/offers/packages con búsqueda remota; upload initiate/complete; scanner session; `POST /recepciones` único.
- **Estados/invalidation:** draft server-side/revision; cada línea muestra readiness. El CTA exige todas las líneas completas o excluidas. Success solo tras receipt+events+upload linked y refetch; partial/unknown se reanuda por ID/key.
- **Cancelación:** salir conserva/cancela draft; excluir es explícito; upload huérfano expira. No repetir POST si ya existe resource ID.
- **Conservar:** flujo en 3 secciones, GS1, reconciliación y etiquetas. **Reformular:** oferta real, upload_id, operation key y cantidad parser. **Quitar:** `filter(validos)`, fallback truthy después de `Number(value)`, URL como base64, `per_page=500`.
- **Visual/a11y:** progress “N de N líneas completas”; errores por sección/línea; CTA sticky con resumen, no solo color; bottom sheet accesible.
- **Aceptación:** DADO una línea sin área, CUANDO confirmar, ENTONCES 0 requests y foco exacto; DADO POST confirmado y respuesta perdida, retry recupera mismo receipt.
- **Pruebas:** 3 pasos, F5 resume, line incomplete/excluded, offer failure blocking, upload failure, double click, future date, zero/negative, mobile/keyboard.

#### `UI-RECEPCIONES-DETALLE-001` — `/recepciones/:id`

- **Objetivo/actor/precondición:** leer evidencia completa de una recepción y ejecutar acciones válidas por estado/capability.
- **Happy path/acciones:** ver header/lines/lotes/package revision/guía/events/audit; **Confirmar draft**, **Adjuntar/Reemplazar**, **PDF**, **Etiquetas**, **Abrir scanner celular**.
- **Estados/invalidation:** 404 separado de error; live refetch de scanner por cursor/ack; mutaciones actualizan version/ETag y lista.
- **Cancelación:** scanner puede revocarse; reemplazo conserva guía previa hasta link nuevo; confirmación en vuelo reconcilia.
- **Conservar:** detalle explícito y documentos. **Reformular:** QR hardened y package revision. **Quitar:** dedupe por código/fetched pre-ack.
- **Visual/a11y:** timeline de estado/eventos; guía y auditoría secundarias; QR dialog con expiración visible y nombre accesible.
- **Aceptación:** DADO token vigente y dos scans iguales, CUANDO estación hace poll+ack, ENTONCES aparecen dos eventos una vez.
- **Pruebas:** 404/500, role actions, QR TTL/offline/lost poll, replace upload, print.

#### `UI-CONTEO-001` — `/conteo`

- **Objetivo/actor/precondición:** listar/crear sesiones para tecnólogo/admin; áreas deben tener stock confirmado o error explícito.
- **Happy path/acciones:** filtrar área/estado → **Nueva sesión** una/múltiples áreas → abrir sesión. APIs cursor `/conteo`, `/pendientes`, stock probes o endpoint batch de disponibilidad, create batch.
- **Estados/invalidation:** estado de área `loading|with_stock|empty|error`; crear múltiples es un command batch **atómico**: cualquier área inválida produce cero sesiones. Refetch lista/pendientes tras success.
- **Cancelación:** modal conserva selección ante error; un rechazo enumera todas las áreas inválidas y no oculta sesiones preexistentes.
- **Conservar:** filtros/pendientes/multiárea. **Reformular:** endpoint batch y resultado. **Quitar:** catch→sin-stock y POST secuencial opaco.
- **Visual/a11y:** cards de áreas con estado textual; selector multiárea navegable; CTA explica blockers.
- **Aceptación:** DADO probe 500, ENTONCES área muestra “No se pudo verificar”; DADO una de tres áreas inválida, CUANDO crea batch, ENTONCES persisten cero sesiones y se señalan blockers.
- **Pruebas:** role, four-state probes, atomic create batch, pagination, keyboard modal.

#### `UI-CONTEO-DETALLE-001` — `/conteo/:id`

- **Objetivo/actor/precondición:** contar/guardar para tecnólogo/admin; confirmar solo admin.
- **Happy path/acciones:** escanear en modo **Saltar** o **+1**, editar cantidad/no contado, **Guardar**, **Revisar**, admin **Confirmar**, PDF.
- **APIs:** GET detalle versionado, PATCH items con outcomes, POST confirmar idempotente.
- **Estados/invalidation:** Guardar draft puede ser `partial`: conflictos conservan local/server/version y solo persisted se limpian. Confirmar es `success` atómico o 409/412 completo; nunca `partial`; tras success refetch stock/movimientos/session.
- **Cancelación:** salir con edits pregunta/guarda draft; sesión confirmada es read-only; cancelar según owner/estado.
- **Conservar:** vistas móvil/escritorio y dos modos. **Reformular:** outcome/operation key. **Quitar:** success ciego ante `conflictos`.
- **Visual/a11y:** diferencias prominentes solo después de contar; scanner con input manual; badges de conflicto no solo rojos.
- **Aceptación:** DADO un item persistible y otro conflictivo, CUANDO guarda draft, ENTONCES el primero se limpia y el segundo conserva valor/diff; DADO cualquier conflicto al confirmar, ENTONCES persisten 0 movimientos y la sesión sigue editable.
- **Pruebas:** +1 repetido, skip, draft partial, confirm atomic conflict, admin confirm, technologist denied, offline/unknown, focus.

#### `UI-MOVIMIENTOS-001` — `/movimientos`

- **Objetivo/actor/precondición:** consultar ledger e interpretar tendencias para autenticados.
- **Happy path/acciones:** destino **Historial** con fecha/área/tipo/producto; destino **Tendencias** con granularidad/agrupación; **Limpiar**, **Exportar CSV**.
- **APIs:** cursor `/movimientos`; agregados `/tendencias-consumo`; export con mismos filtros.
- **Estados/invalidation:** loading/data/empty/error separados; rango inválido bloquea request; inventory events invalidan queries activas.
- **Cancelación:** cambiar filtro aborta query anterior; export job cancelable antes de listo.
- **Conservar:** filtros almacenados y separación. **Reformular:** cursor y filtros URL. **Quitar:** “sin datos” para error y filtros client-side sobre 100.
- **Visual/a11y:** ledger tabular primero; tendencias con tabla alternativa; fecha/zona visibles.
- **Aceptación:** DADO rango invertido, ENTONCES no se consulta; DADO 230 movimientos, todos son navegables/exportables.
- **Pruebas:** filters parity, cursor, 500 vs empty, chart/table equivalence, timezone.

#### `UI-SOLICITUDES-001` — `/solicitudes-compra`

- **Objetivo/actor/precondición:** crear/gestionar solicitudes propias; admin administra todas y convierte a OC.
- **Happy path/acciones:** historial → crear por **Sugeridos** o **Por proveedor** → pasos **Modo**, **Proveedores**, **Productos** → **Guardar borrador**, **Finalizar**, luego diálogos registrar/enviar/completar/cancelar/recibir/crear OC según estado.
- **APIs:** solicitudes versionadas, recomendaciones, suppliers/offers, send/finalize/cancel, OC command; ownership server-side.
- **Estados/invalidation:** draft durable; cambiar modo/proveedor nunca elimina líneas sin confirmación. Mutaciones refetch solicitud/history/OC; partial por proveedor explícito.
- **Cancelación:** salir guarda o descarta draft; quitar proveedor no borra ítems implícitamente; cancelar enviada exige reason/capability.
- **Conservar:** dos modos, stepper y diálogos de lifecycle. **Reformular:** ownership, offers/package revisions y state machine. **Quitar:** estado puramente local/destructivo implícito.
- **Visual/a11y:** status/owner al inicio; stepper no es tabs falsas; resumen de costos/moneda; diálogos con impacto.
- **Aceptación:** DADO borrador con líneas, CUANDO cambia modo, ENTONCES conserva/reasigna o pide confirmación; DADO otro usuario, backend impide editar ajeno.
- **Pruebas:** own/all permissions, F5 draft, mode switch, provider removal, quantities >=1, send/finish/cancel transitions, six dialogs.

#### `UI-ORDENES-001` — `/ordenes-compra`

- **Objetivo/actor/precondición:** listar órdenes y precios sensibles para admin con `purchase_order.read_sensitive`.
- **Happy path/acciones:** filtrar/paginar → abrir detalle; **Nueva OC** solo nace desde solicitud aprobada o command explícito. API cursor `GET /ordenes-compra`.
- **Estados/invalidation:** 403 antes de query; 2xx vacío distinto de red/server. Crear/cambiar OC refetch lista y solicitud origen.
- **Cancelación:** filtros URL; query cancelable; no hay operación destructiva en listado.
- **Conservar:** tabla/paginación/breadcrumb. **Reformular:** capability y error. **Quitar/fusionar:** pestaña visual única se convierte en encabezado/filtro, no tab falsa.
- **Visual/a11y:** número/estado/proveedor/total/moneda/vigencia; acción abrir con fila/teclado.
- **Aceptación:** DADO no-admin, CUANDO abre URL, ENTONCES 403 sin recibir precios; DADO red fallida, no muestra lista vacía.
- **Pruebas:** role route/API, empty/error, cursor, row keyboard, request linkage.

#### `UI-ORDENES-DETALLE-001` — `/ordenes-compra/:id`

- **Objetivo/actor/precondición:** inspeccionar lifecycle, productos, precios, recepciones y guías; admin.
- **Happy path/acciones:** ver cabecera/line items/package revision/receipts → **Enviar**, **Cancelar**, **Descargar**, abrir recepción. APIs GET, transition send/cancel con If-Match.
- **Estados/invalidation:** 404 vs 403 vs 500; transición refetch detalle/lista/solicitud. Progreso deriva de líneas recibidas, no de contador local.
- **Cancelación:** cancelar exige motivo/impacto; una OC con recepción confirmada se compensa según regla, no se borra.
- **Conservar:** progreso y guías. **Reformular:** referencias coherentes y transitions. **Quitar:** lecturas abiertas a todo autenticado.
- **Visual/a11y:** status y total primero, timeline luego, líneas y evidencia después; preview guía en dialog accesible.
- **Aceptación:** DADO package revision ajena al producto, command falla 422/FK; DADO cancel con dependencia, UI explica blocker.
- **Pruebas:** 404/403/500, send/cancel concurrency, partial receipts, document preview.

#### `UI-CREADOR-001` — `/creador-productos`

- **Objetivo/actor/precondición:** administrar catálogo; admin accede a seis tabs, tecnólogo solo a `Catalogación` por `catalog.review`.
- **Happy path/acciones:** destinos **Productos**, **Catalogación**, **Categorías**, **Unidades**, **Proveedores**, **Formatos de Empaque** por `?tab=`. CRUD/archivo/reactivación, export, identifiers, packages, offers, approve/reject e importación.
- **APIs:** Product endpoints target, catálogos, readiness, identifiers/packages/offers; cliente generado.
- **Estados/invalidation:** error por tab, filtros/cursor URL; mutation refetch exacto según 6.1.5. Detalle/edit usan version y no defaults destructivos.
- **Cancelación:** formularios dirty protegen salida; conflictos ofrecen comparar/recargar; archivar/rechazar con reason.
- **Conservar:** deep link `?tab=`, vista lista/tarjeta y alertas de duplicado. **Reformular:** dividir componente de 2.818 líneas, state machine y capabilities por tab. **Quitar:** interfaces manuales, endpoints imaginados, `gtins-tab.tsx`/`areas-tab.tsx` huérfanos tras migrar o fusionar su función.
- **Visual/a11y:** tablist real; encabezado de catálogo con readiness counts; acción primaria contextual, no diez botones equivalentes.
- **Aceptación:** DADO tecnólogo, ve Catalogación y no CRUD admin; DADO save sin cambios, no sube versión; DADO conflicto, formulario se conserva.
- **Pruebas:** 6 tabs roles/states, deep links, create/edit roundtrip, package revision, identifier collision, offer contracts, keyboard tabs.

#### `UI-CONFIG-001` — `/configuracion`

- **Objetivo/actor/precondición:** configuración administrativa versionada; solo admin; una hidratación exitosa antes de editar.
- **Happy path/acciones:** destinos **Laboratorio y Marca**, **Inventario y Demanda**, **Vencimientos**, **Modelos de IA**, **Campos del Laboratorio**; cada uno usa **Guardar sección** con su propio If-Match. No existe Guardar global.
- **APIs:** `GET/PATCH /configuracion/{section}`, DTO/versión independientes, branding público mínimo, uploads, IA discovery server-configured/allowlisted y fields versionados.
- **Estados/invalidation:** GET error bloquea solo esa sección y no aplica defaults editables. El command de sección es atómico, refetchea su versión y dependencias declaradas; no existe `partial` ni una versión global ambigua.
- **Cancelación:** cambio de tab preserva draft; salir pregunta; upload nuevo no elimina asset previo hasta commit/link.
- **Conservar:** cinco dominios. **Reformular:** deep link por `?tab=` y commands atómicos por sección con versiones independientes. **Quitar:** save global, PIN en response, URL arbitraria, claves/dev defaults y formulario hidratado con defaults tras error.
- **Visual/a11y:** navegación lateral/tabs semánticas, estado “guardado en versión N”, secretos como configured/not-configured, nunca valor.
- **Aceptación:** DADO consulta, GET/POST IA=403; DADO GET 500, controles disabled; DADO URL privada/loopback, se rechaza antes de egress.
- **Pruebas:** RBAC/API schema, SSRF unit/integration defensivo sin requests ofensivos, PIN absence/hash/rate limit, dirty guard, upload atomicity, tabs keyboard.

#### `UI-USUARIOS-001` — `/usuarios`

- **Objetivo/actor/precondición:** lifecycle y roles/capabilities de usuarios; admin.
- **Happy path/acciones:** buscar/filtrar → **Crear**, **Editar**, **Activar/Desactivar**, **Restablecer contraseña**, configurar teléfono opcional y **Abrir WhatsApp** como handoff externo.
- **APIs:** cursor users, versioned patch/transitions, reset command y `API-WHATSAPP-001..003`; secretos nunca se retornan.
- **Estados/invalidation:** error listado explícito; mutation refetch user/list; si afecta usuario actual, refetch `/auth/me`. El handoff registra `intent_registered`, abre el destino y luego pregunta el resultado al usuario; no muestra sent/delivered.
- **Cancelación:** desactivar/reset confirman impacto; password temporal se muestra una vez por canal seguro o flujo de set-password, no logs.
- **Conservar:** filtros/roles/teléfono. **Reformular:** capability templates, lifecycle y WhatsApp `external-record-only`. **Quitar:** cualquier afirmación de entrega, éxito solo toast y reset sin evidencia.
- **Visual/a11y:** identidad/estado/rol antes de acciones; acciones peligrosas secundarias; formulario labels/autocomplete.
- **Aceptación:** DADO user desactivado, refresh/token deja de autorizar; DADO 500 listado, no muestra cero usuarios; DADO handoff abierto, solo aparece “confirmado por usuario” después de su acción explícita.
- **Pruebas:** admin-only, create/edit/version, deactivate self policy, reset secrecy, current capability refresh, URL allowlisted e intent/result auditados sin delivery claim.

#### `UI-AREAS-001` — `/areas`

- **Objetivo/actor/precondición:** administrar áreas/bodegas, asignaciones y reorder policies; admin.
- **Happy path/acciones:** **Crear/Editar/Archivar área**, configurar productos, frecuencia de conteo y policies min/reorder/max.
- **APIs:** areas versionadas, product assignments, `politicas_reposicion`; no umbrales en assignment.
- **Estados/invalidation:** conservar guard local pero reemplazar por guard común; mutation refetch áreas/filtros/stock/policies/count pending.
- **Cancelación:** archivar con stock activo muestra blocker/plan; formularios dirty protegidos.
- **Conservar:** buena guardia y feedback. **Reformular:** separar asociación de policy y validación de orden. **Quitar:** delete ambiguo y dos dueños de mínimos.
- **Visual/a11y:** ficha área con tipo/stock/policies; editor de policies tabular con errores inline; móvil por cards.
- **Aceptación:** DADO max < reorder, 0 requests/422; DADO dos policies globales, DB rechaza; DADO no-admin, 403 route/API.
- **Pruebas:** constraints, archive with stock, assignments, policy concurrency, role/accessibility.

#### `UI-AUDIT-001` — `/audit-log`

- **Objetivo/actor/precondición:** investigación auditada y segura; admin/audit.read.
- **Happy path/acciones:** filtrar aggregate/action/actor/fecha/operation ID → tabla/timeline → expandir diff → paginar/exportar permitido.
- **APIs:** cursor `/audit-log`, filtros exactos, redacción server-side; append-only.
- **Estados/invalidation:** 2xx vacío vs 403/500; datos stale durante refetch. Nuevos events invalidan primera página sin perder posición del investigador.
- **Cancelación:** query/export cancelables; no mutaciones ni “limpiar audit”.
- **Conservar:** filtros/timeline/diff. **Reformular:** correlación/aggregate version y redacción. **Quitar:** error como “No se encontraron registros”.
- **Visual/a11y:** timestamp/actor/action/aggregate/operation; JSON diff con tabla textual y copy seguro.
- **Aceptación:** DADO API 500, muestra error/request ID; DADO evento con secreto, response no contiene valor; DADO operation ID, se reconstruye secuencia.
- **Pruebas:** RBAC, redaction, cursor/date timezone, empty/error, keyboard expand.

#### `UI-SETUP-001` — `/setup`

- **Objetivo/actor/precondición:** inicialización controlada y reanudable; admin; ruta visible desde configuración/onboarding mientras no finalice.
- **Happy path/acciones:** destinos **Productos**, **Stock**, **Finalizar**; crear/reanudar batch, enriquecer productos `incompleto`, cargar opening stock, revisar blockers, **Finalizar setup**.
- **APIs:** import batches, readiness/setup status contractual, opening-balance commands, downloads/rollback.
- **Estados/invalidation:** servidor determina paso; F5 reanuda. Error DB en blockers es error y bloquea finalización; no `unwrap_or(0)`. Counts reconciliables incluyendo lotes.
- **Cancelación:** cancelar batch conserva audit/source según retención; rollback condicionado; finalizar requiere confirmación de blockers resueltos y decisiones sobre productos `incompleto`.
- **Conservar:** wizard Productos/Stock/Finalizar. **Reformular:** ruta descubrible, guard, batch durable. **Quitar:** estado local autoritativo, finalización vacía implícita y contrato `lotes_cargados` divergente.
- **Visual/a11y:** checklist de readiness con enlaces a blockers; no confundir catálogo con stock; progreso basado en servidor.
- **Aceptación:** DADO batch failed/unresolved o query blockers falla, finalizar es imposible; DADO name-only committed, aparece en enrichment y no recibe stock.
- **Pruebas:** admin-only, F5 resume, blockers DB error, empty setup policy, products→stock dependency, finalization contract.

#### `UI-REPORTES-001` — `/reportes`

- **Objetivo/actor/precondición:** análisis sensible para admin; filtros válidos y datasets consistentes.
- **Happy path/acciones:** destinos **Calendario**, **Productos**, **Descartes**; fecha/área/producto; **Exportar Excel** del dataset de la vista.
- **APIs:** tres endpoints/report jobs con cursor/filters o endpoint agregador; backend exige capability.
- **Estados/invalidation:** cada panel tiene data/empty/error; Excel no se habilita como completo si el panel falló. Eventos de inventario invalidan rango relevante.
- **Cancelación:** filtros abortan queries; export job cancelable; rango invertido no dispara request.
- **Conservar:** tres tabs y filtros. **Reformular:** lazy query solo tab activa y parity export. **Quitar:** tres queries siempre simultáneas y acceso URL no-admin.
- **Visual/a11y:** resumen de período/filtros y freshness; chart con tabla alternativa; “Uso diario” permanece contenido de Calendario.
- **Aceptación:** DADO error solo en Descartes, otras tabs funcionan y export Descartes se deshabilita; DADO 2xx vacío, copy indica período sin actividad.
- **Pruebas:** RBAC, tab lazy queries, range validation, partial endpoints, export parity, chart a11y.

#### `UI-ETIQUETAS-001` — `/etiquetas`

- **Objetivo/actor/precondición:** seleccionar lotes con saldo confirmado e imprimir/reimprimir; autenticados con `label.print`.
- **Happy path/acciones:** buscar producto remoto → cargar lotes → seleccionar cantidades/formato → **Previsualizar/Imprimir/Reimprimir**.
- **APIs:** product search cursor, lots/balance; impresión cliente o job con audit de reimpresión si es requerido.
- **Estados/invalidation:** error de producto/lotes no equivale a ausencia de stock. Inventario events refetch lotes; print success no altera stock.
- **Cancelación:** preview/print dialog cancelable; reimpresión puede pedir motivo según política.
- **Conservar:** selector y formatos. **Reformular:** errores/freshness y producto >100. **Quitar:** fallback “sin lotes” ante fallo.
- **Visual/a11y:** label preview con alternativa textual; selección mobile; conteo exacto.
- **Aceptación:** DADO lotes endpoint 500, muestra error/retry y no imprime; DADO lote saldo 0 tras refetch, se deselecciona con explicación.
- **Pruebas:** >100 search, error vs empty, stale stock, print keyboard, reprint audit.

#### `UI-SCAN-001` — `/scan/:token`

- **Objetivo/actor/precondición:** enviar eventos de escaneo desde teléfono sin sesión web; token vigente y scoped a una scanner session.
- **Happy path/acciones:** validar token → permiso cámara → escanear o entrada manual → enviar cada evento → lista de eventos con status pending/acked; **Reintentar**, **Detener cámara**, **Cerrar sesión**.
- **API:** `POST .../{token}/events`; no llama endpoints autenticados generales. El token se guarda hasheado en servidor, TTL/revocación/rate limit/tamaño.
- **Estados/invalidation:** connecting/ready/sending/offline/expired/revoked/error; dos códigos iguales crean dos `client_event_id`. Cola local limitada reintenta hasta ack.
- **Cancelación:** detener cámara cancela stream; cerrar conserva o descarta cola con confirmación; token expirado bloquea nuevos envíos sin perder status local.
- **Conservar:** cámara y lista. **Reformular:** protocolo event+ack. **Quitar:** `includes(code)`, toast genérico y dependencia JWT.
- **Visual/a11y:** interfaz móvil de una mano, fallback input, vibración/sonido opcionales, status textual y live region moderada.
- **Aceptación:** DADO teléfono sin JWT y token válido, dos scans iguales producen dos eventos; DADO offline, quedan pendientes y se envían al reconectar; DADO expirado, copy específico.
- **Pruebas:** token valid/expired/revoked, duplicate, offline queue, retry/lost response, camera unavailable, rate limit, 320 px.

#### `UI-NOTFOUND-001` — wildcard `*`

- **Objetivo:** representar URL inexistente, no ocultarla redirigiendo a `/`.
- **Acciones:** **Volver**, **Ir al inicio**, búsqueda global si está autenticado.
- **Estado/permiso:** no emite queries sensibles; conserva request/path para soporte sin incluir tokens.
- **Conservar/quitar:** eliminar redirect silencioso. Visual simple con código 404 y foco al título.
- **Aceptación:** DADO `/foo`, CUANDO carga, ENTONCES muestra 404 y no navega automáticamente.
- **Pruebas:** public/auth variants, keyboard, no API calls.

### 6.4 Inventario completo de los 16 grupos y 50 destinos internos

La numeración siguiente es cerrada: **16 grupos, 50 destinos**. Cada destino hereda 6.1 y el contrato de su ruta; la columna final agrega el escenario mínimo específico.

| # / ID | Grupo y destino: objetivo/actor/precondición | Happy path, acciones y API/command | Estados, decisión visual y cambio | Criterio Given/When/Then + prueba mínima |
| ---: | --- | --- | --- | --- |
| 01 `UI-STOCK-D01` | **Stock detalle — Lotes Activos**. Todo autenticado lee; operar exige capability y product ready. | Seleccionar producto → listar lotes/saldo FEFO → **Consumir/Descartar/Etiquetas**; `/lotes`, `/stock`, commands. | Data muestra base quantity, package equivalente, expiry y freshness; error no es “sin lotes”. Conservar FEFO; mover acciones al lote. | DADO lotes activos/vencidos/cero, CUANDO abre, ENTONCES solo saldos relevantes y acciones autorizadas. Test query+RBAC+mobile drawer. |
| 02 `UI-STOCK-D02` | **Stock detalle — Historial**. Lectura autenticada; producto seleccionado. | Cursor de eventos → filtros secundarios; **Cargar más/Exportar**; `/movimientos?product_id=`. | Timeline/tabla append-only con operation/source; quitar slice de 100 local. | DADO 230 eventos, CUANDO pagina, ENTONCES accede a 230 sin duplicado. Test cursor/tie-breaker/error. |
| 03 `UI-STOCK-D03` | **Historial — Todos**. Vista base del conjunto completo. | Quita filtro de tipo, conserva producto/fecha; refetch server-side. | Contador `mostrados/total`; empty solo 2xx. | DADO cuatro tipos, CUANDO Todos, ENTONCES suma por API coincide. Test filter reset. |
| 04 `UI-STOCK-D04` | **Historial — Entradas**. Actor lector. | `event_type` en `receipt`, `opening_balance`, `positive_adjustment`; abrir source receipt. | Color/icono + texto “Entrada”; cantidad signed y unidad. | DADO recepción, CUANDO filtra, ENTONCES source navega a detalle y cantidad coincide. |
| 05 `UI-STOCK-D05` | **Historial — Consumos**. Actor lector. | `event_type=consumption`; abrir operation/group. | No mezclar descartes; error independiente. | DADO consumo compensado, ENTONCES muestra original y reversa, no edita original. |
| 06 `UI-STOCK-D06` | **Historial — Descartes**. Actor lector. | `event_type=discard`; abrir acta/motivo. | Motivo visible/redactado según permiso; PDF correlacionado. | DADO descarte, ENTONCES filtro y export contienen mismo event ID. |
| 07 `UI-DESCARTES-D01` | **Descartes — Nuevo Descarte**. Admin/tecnólogo; saldo >0. | Seleccionar área/lote/cantidad/motivo → **Confirmar**; command idempotente. | Form bloquea <=0; material sano exige reason; success muestra acta+refetch. | DADO consulta o reason ausente, CUANDO intenta crear, ENTONCES 0 requests. Test RBAC/boundary/replay. |
| 08 `UI-DESCARTES-D02` | **Descartes — Historial**. Todo autenticado con lectura; default para consulta. | Filtros fecha/área/proveedor/próximos → abrir acta/PDF. | Loading/empty/error exhaustivo; filtros URL. | DADO 500, ENTONCES error/retry conserva filtros. Test state/export. |
| 09 `UI-RECEPCIONES-D01` | **Recepciones — Borradores**. Lectura; mutación admin/tech. | Listar drafts → **Continuar/Confirmar/Cancelar**. | Cada card muestra completeness y blockers; no “confirmar” si faltan líneas. | DADO draft incompleto, CUANDO confirmar, ENTONCES navega/enfoca blockers, sin command. |
| 10 `UI-RECEPCIONES-D02` | **Recepciones — Confirmadas**. Lectura autenticada. | Listar confirmadas → detalle/PDF/etiquetas/compensación autorizada. | Inmutabilidad histórica; status y event count. | DADO confirmada, ENTONCES no existe Delete y balance refetch coincide con events. |
| 11 `UI-RECEPCIONES-D03` | **Recepciones — Todas**. Lectura autenticada. | Cursor multiestado y filtros; abrir detalle. | Status chips accesibles; no carga duplicada de otras tabs. | DADO mezcla de estados, ENTONCES conteos por API reconcilian. Test cursor/tab URL. |
| 12 `UI-RECEPCIONES-D04` | **Recepciones — Guías Respaldadas**. Lectura; upload manage admin/tech. | Ver verified/linked uploads → **Abrir/Reemplazar**. | Estado `verified/linked/error`; no data URL ni “vinculada” antes de link. | DADO upload verified no linked, ENTONCES lo marca pendiente, no respaldado. Test lifecycle/retry. |
| 13 `UI-RECEPCIONES-D05` | **Nueva recepción — Proveedor y guía**. Admin/tech; draft. | Buscar proveedor; ingresar guía/fecha; iniciar/completar upload; vincular solicitud. | Error de offer/upload bloquea avance; fecha futura inválida; jerarquía proveedor→documento. | DADO URL de análisis sin upload_id, CUANDO avanza, ENTONCES bloqueo. Test future date/upload checksum. |
| 14 `UI-RECEPCIONES-D06` | **Nueva recepción — Ítems y lotes**. Admin/tech; proveedor definido. | Buscar producto remoto, seleccionar offer/package/área/lot/expiry/cantidad; scan/GS1; **Excluir con razón**. | Readiness por línea; 0 no se convierte en 1; sin fallback silencioso. | DADO package de otro producto o línea incompleta, ENTONCES 0 confirm y field error. Test >100/search/decimal/FK. |
| 15 `UI-RECEPCIONES-D07` | **Nueva recepción — Decisión**. Admin/tech; todas líneas resolved. | Elegir completa/parcial/rechazada, motivos/nota → **Confirmar recepción**. | Completa limpia motivos antiguos; partial/rejected exige razón; resumen de efectos antes del CTA. | DADO partial sin motivo, ENTONCES 0 requests; DADO success, receipt/events/upload se observan tras refetch. |
| 16 `UI-MOVIMIENTOS-D01` | **Movimientos — Historial**. Lectura autenticada. | Filtros + cursor + **CSV** sobre ledger. | Tabla es primaria, timezone/freshness; error no vacío. | DADO filtro combinado, export y vista contienen mismos IDs. Test contract/export. |
| 17 `UI-MOVIMIENTOS-D02` | **Movimientos — Tendencias**. Lectura autenticada. | Cambiar mensual/trimestral/semestral/anual y global/área/producto; export. | Chart+tabla; título/KPIs/granularidad coherentes; lazy load. | DADO cada combinación, ENTONCES bucket totals = ledger del rango. Test aggregate property/a11y. |
| 18 `UI-SOLICITUDES-D01` | **Solicitud modo — Sugeridos**. Owner draft; forecast disponible. | Elegir horizonte, revisar sugerencias → agregar/restaurar/quitar explícitamente. | Suggestions explican fuente/confianza; cambiar modo no borra. | DADO items editados, CUANDO cambia modo, ENTONCES confirma/reasigna sin pérdida. |
| 19 `UI-SOLICITUDES-D02` | **Solicitud modo — Por proveedor**. Owner draft. | Buscar proveedor/ofertas vigentes → seleccionar packages/precios. | Error de ofertas bloquea; no fallback a primer package. | DADO dos proveedores/packages, ENTONCES cada uno muestra solo sus offers. Contract test real. |
| 20 `UI-SOLICITUDES-D03` | **Solicitud paso 1 — Modo**. Owner draft. | Elegir Sugeridos/Proveedor y condiciones → **Continuar**. | Stepper semántico; validación antes de avanzar; draft version. | DADO modo incompleto, 0 navegación/requests de commit. Component test keyboard. |
| 21 `UI-SOLICITUDES-D04` | **Solicitud paso 2 — Proveedores**. Aplica a Por proveedor. | Seleccionar/deseleccionar providers; **Continuar/Volver**. | Quitar filtro no borra líneas; muestra impacto. | DADO provider con líneas, CUANDO deselecciona, ENTONCES pregunta y conserva hasta decisión. |
| 22 `UI-SOLICITUDES-D05` | **Solicitud paso 3 — Productos**. Owner; packages ready. | Cantidades/precios → **Guardar/Finalizar**. | quantity >=1/value objects; summary currency; outcome drives status. | DADO price stale/version conflict, ENTONCES conserva draft y ofrece rebase. |
| 23 `UI-CREADOR-D01` | **Creador — Productos**. Admin manage; otros read solo si ruta lo permite. | Search/filter/sort/cursor; **Crear/Editar/Archivar/Reactivar/Exportar**. | Readiness/status/lifecycle visibles; edit-safe GET. | DADO save no-op, version no cambia; DADO 500, tabla no queda vacía. |
| 24 `UI-CREADOR-D02` | **Creador — Catalogación**. Tecnólogo review; admin approve. | Cola `incompleto`/`pendiente_aprobacion`/`rechazado` → enriquecer/recalcular; admin **Aprobar/Rechazar**. | Reasons accionables; aprobación no contiene factor ni muta stock. | DADO `incompleto` reparado, submit; DADO approve, hashes ledger/balance idénticos. |
| 25 `UI-CREADOR-D03` | **Creador — Categorías**. Admin. | CRUD/archive; field errors inline. | Nombre/longitud DB/API iguales; dependency impact. | DADO duplicado/largo, dialog no cierra y muestra code. Test boundary/FK. |
| 26 `UI-CREADOR-D04` | **Creador — Unidades**. Admin. | CRUD/archive singular/plural/scale. | In-use no delete; schema/readiness invalidation. | DADO unidad referenciada, archive preserva history y explica. |
| 27 `UI-CREADOR-D05` | **Creador — Proveedores**. Admin. | CRUD/reactivate/archive; abrir offers. | Active state coherente; no duplicado al reactivar. | DADO supplier archived con offer, nuevas receipts lo excluyen; history visible. |
| 28 `UI-CREADOR-D06` | **Creador — Formatos de Empaque**. Admin. | CRUD/archive de catálogo; packages usan revision separada. | No editar factor aquí; dependencies visibles. | DADO formato usado, eliminar se bloquea/archive. Test dependency. |
| 29 `UI-PRODUCT-D01` | **Producto form — Identificación**. Admin/manage; draft loaded completo. | Nombre, código, categoría, fabricante/MPN, identifiers → siguiente/guardar. | Unicode/límites/count; collision owner visible; badge si error oculto. | DADO nombre 255/256 y GTIN duplicado, resultados  success/422 estables. |
| 30 `UI-PRODUCT-D02` | **Producto form — Almacenamiento**. Admin/manage. | location, temperature key, cold chain, lot control, stability. | Campos condicionales schema-driven; no defaults destructivos. | DADO cambia lot policy incompatible, ENTONCES impacto y review transition explícitos. |
| 31 `UI-PRODUCT-D03` | **Producto form — Inventario & Alertas**. Admin/manage. | Product command guarda unidad y asignaciones de área; cada área abre `InventoryPolicyEditor`, que guarda por `API-POLICY-002`, fuera del PATCH Product. | Assignment separado de policy; demanda/umbrales viven por área, con versión propia y decimales string. | DADO max<reorder, policy no se guarda; DADO required custom faltante, Product no hace submit. Ningún payload Product contiene demanda/umbrales. |
| 32 `UI-PRODUCT-D04` | **Producto detalle — Detalles**. Catalog.read. | Ver metadata/status/readiness/audit; **Editar** si capability. | 404 distinto; canonical response, no campos omitidos. | DADO GET falla, error/retry; DADO archived, historia visible y operaciones bloqueadas. |
| 33 `UI-PRODUCT-D05` | **Producto detalle — Empaques**. Read; manage admin. | Ver revision history; **Crear package/Nueva revisión/Retirar identifier**. | Factor old read-only; active revision prominente. | DADO factor change, crea revision 2 y receipts previas siguen revision 1. |
| 34 `UI-PRODUCT-D06` | **Producto detalle — Ofertas**. Read sensible/admin según política; feature gated. | Listar vigentes/historia; **Crear/Editar/Cerrar oferta**. | Error visible; currency/vigencia/package exactos; no ruta hasta capability manifest true. | DADO router no declara endpoints, tab no aparece; con flag, contract tests pasan. |
| 35 `UI-CONFIG-D01` | **Config — Laboratorio y Marca**. Admin; config hydrated. | Editar nombre/assets → upload/guardar. | Preview local no es persistido; linked/refetch confirma. | DADO upload fail, asset anterior permanece. Test atomic replacement. |
| 36 `UI-CONFIG-D02` | **Config — Inventario y Demanda**. Admin. | Ajustar políticas globales/forecast → guardar versionado. | No duplica product reorder policy; efecto/alcance explicados. | DADO version conflict, conserva draft y compara. |
| 37 `UI-CONFIG-D03` | **Config — Vencimientos**. Admin. | Umbrales/alertas → guardar. | Fechas civiles/timezone explícito; preview de categorías. | DADO umbrales inválidos, 0 request/422. Test timezone boundary. |
| 38 `UI-CONFIG-D04` | **Config — Modelos de IA**. Admin. | Activar provider configurado; descubrir modelos; test seguro. | API key solo “configured”; URL no editable salvo allowlist administrada server-side; errors. | DADO URL privada/redirect, request saliente no ocurre. Unit test resolver/allowlist. |
| 39 `UI-CONFIG-D05` | **Config — Campos del Laboratorio**. Admin. | CRUD/version field/type/options/required; impacto y migración. | Cambiar tipo con values exige plan; schema version invalida batch preview. | DADO field required nuevo, readiness reasons aparecen; batch preview viejo=conflict. |
| 40 `UI-REPORTES-D01` | **Reportes — Calendario**. Admin. | Rango/área → uso diario, navegar fecha, export. | “Uso diario” es contenido, no tab 4; chart+table. | DADO timezone boundary, día asignado según `America/Punta_Arenas`. |
| 41 `UI-REPORTES-D02` | **Reportes — Productos**. Admin. | Filtros/product ranking → drilldown/export. | Dataset/filters/freshness; archived histórico incluido cuando corresponde. | DADO product archived, historia del rango no desaparece. |
| 42 `UI-REPORTES-D03` | **Reportes — Descartes**. Admin. | Motivos/áreas/productos → drilldown acta/export. | Error panel bloquea export completo; reason catalog labels. | DADO endpoint 500, solo este panel falla y Excel no afirma completitud. |
| 43 `UI-SETUP-D01` | **Setup — Productos**. Admin; setup open. | Crear/reanudar importer, enrichment, readiness. | Server state; counts ready/incomplete/error/excluded reconcilian. | DADO name-only commit, visible incomplete y stock command bloqueado. |
| 44 `UI-SETUP-D02` | **Setup — Stock**. Admin; products inventory_ready. | Template stock → stage/validate/commit opening events. | Rollback total=confirmed 0; no usuario arbitrario; event ledger. | DADO CSV mixto, committed=false/DB 0/feedback rojo. API+DB+UI test. |
| 45 `UI-SETUP-D03` | **Setup — Finalizar**. Admin; blockers query success. | Revisar checklist → **Finalizar setup**. | Error de query es blocker; política de incomplete explícita; status contractual. | DADO unresolved/error infrastructure, finalización rechazada con razones. |
| 46 `UI-IMPORT-D01` | **Smart Importer — Cargar Archivo**. Admin; setup/import capability. | Drag/drop/paste; download templates; parse source durable. | Vacío/>5MiB/>5000/encoding/delimiter con causa; source hash/upload ID. | DADO solo headers o `.CSV` con `;`, comportamiento válido/documentado. Tests parser/boundary. |
| 47 `UI-IMPORT-D02` | **Smart Importer — Mapear Columnas**. Batch revision. | Cards/matrix; automap, reset, typed fill, create field command. | Exact/alias antes de fuzzy; una columna→un destino; raw drawer inline, no modal sobre modal. | DADO provider/unit collisions, mapping unívoco; remap recompone normalized. Integration test. |
| 48 `UI-IMPORT-D03` | **Smart Importer — Previsualizar**. Mapping validado. | Tabs all/ready/incomplete/errors/modified; edit cell, transform preview/apply, exclude with reason, download, commit. | Sum rows=original; hash/revision visible; no auto-fix oculto; result counts confirmed post-commit. | DADO edit/revalidate, otras filas no cambian; doble click replay mismo commit. |
| 49 `UI-CONTEO-D01` | **Conteo modo — Saltar**. Admin/tech, session editable. | Scan enfoca item/lote sin modificar cantidad; input manual fallback. | Señal textual “sin cambio”; selección ambigua exige elegir. | DADO dos scans en Saltar, cantidad queda idéntica. Unit+device event test. |
| 50 `UI-CONTEO-D02` | **Conteo modo — +1**. Admin/tech, unit discrete/policy permite. | Cada evento incrementa exactamente una unidad base/configurada; guardar versionado. | No dedupe por code; decimal policy si unidad no entera; conflict conserva local. | DADO dos scans, cantidad aumenta exactamente 2; replay mismo client event no duplica. |

### 6.5 Inventario de diálogos, overlays y botones críticos

Todos heredan `UI-COMMON-002/004/006`. Esta tabla evita que los detalles fuera de tabs queden omitidos.

| ID | Superficie/diálogo | Botones/acciones objetivo | Persistencia, cancelación y criterio observable |
| --- | --- | --- | --- |
| `UI-GLOBAL-DLG-001` | Búsqueda global Ctrl/Cmd+K | Buscar, abrir resultado, cerrar | Search remoto paginado/cancelable; Escape retorna foco; capability filtra resultados server-side. |
| `UI-GLOBAL-DLG-002` | Perfil/inactividad/logout | Continuar sesión, cerrar sesión | Countdown accesible; refresh/logout revoca estado; no logout solo local. |
| `UI-GLOBAL-DLG-003` | Notificaciones | Marcar una/todas, limpiar | Pending por acción, rollback optimista, error/retry; **Limpiar** confirma y no depende de lista vacía. |
| `UI-STOCK-DLG-001` | Panel detalle/PDF/descarte | Cerrar, Exportar, Consumir, Descartar | Drawer focus; PDF mismo filtro; discard command comprobado por refetch. |
| `UI-CONSUMOS-DLG-001` | Carrito/revisión/FEFO/cámara | Vaciar, elegir FEFO, cancelar, confirmar | Draft y operation key; cámara cancelable; FEFO no selecciona ambiguo. |
| `UI-DESCARTES-DLG-001` | Material sano/resultado | Volver, confirmar con reason, ver acta | 0 request sin reason; result muestra event/acta IDs. |
| `UI-RECEPCIONES-DLG-001` | Panel/lista, guía, etiquetas, borrar draft | Abrir, reemplazar, imprimir, cancelar draft | Upload link verificado; delete solo draft; etiquetas tras stock refetch. |
| `UI-RECEPCIONES-DLG-002` | Vincular solicitud/importar guía/reconciliar | Vincular, analizar, aplicar selección | IDs reales, no copy de vínculo prematuro; reconciliación suma todas líneas. |
| `UI-RECEPCIONES-DLG-003` | LoteBottomSheet/cámara/QR/asignar código | Seleccionar, scan, revocar, registrar identifier | Package/product constraint; global code conflict; focus/touch. |
| `UI-CONTEO-DLG-001` | Nueva sesión multiárea/lote/revisión/PDF | Crear, guardar, confirmar, cancelar | Batch outcome; conflictos retenidos; confirmar admin. |
| `UI-SOLICITUDES-DLG-001` | Detalle y seis diálogos lifecycle | Registrar envío, enviar, completar, cancelar, recibir, crear OC | Cada uno es transition con version/capability/reason; dialog no inventa status. |
| `UI-ORDENES-DLG-001` | Preview de guía/cancelación | Abrir/descargar/cancelar | Upload durable; cancel transition y dependencies. |
| `UI-CREADOR-DLG-001` | Producto create/edit/sheet | Guardar, comparar conflicto, cerrar | GET completo; merge patch; dirty guard; no-op sin version bump. |
| `UI-CREADOR-DLG-002` | Archive/reactivate/reject/approve | Confirmar con reason | Transición única; approval no pide factor ni toca ledger. |
| `UI-CREADOR-DLG-003` | Identifiers/packages/offers | Registrar, nueva revisión, cerrar oferta | Namespace/FK/version; respuesta y refetch. |
| `UI-CONFIG-DLG-001` | Modelo IA/campos/assets | Descubrir, activar, versionar, subir | SSRF guard; schema invalidation; old asset preserved on fail. |
| `UI-USUARIOS-DLG-001` | Create/edit/reset/toggle | Guardar, reset, activar/desactivar | Version/capability; secreto one-time, audit. |
| `UI-AREAS-DLG-001` | Area/productos/policies | Guardar/archive | Constraints y impact; no duplicate owner. |
| `UI-AUDIT-DLG-001` | Timeline/diff | Expandir/copiar seguro | Read-only, redacted, keyboard; no “clear”. |
| `UI-IMPORT-DLG-001` | Editor de celda/bulk fill/commit | Preview, aplicar, excluir, commit | Revision/hash; diff; rows reconciliables. |
| `UI-ETIQUETAS-DLG-001` | Preview impresión | Imprimir/cancelar | Stock refetch antes de imprimir; audit si reprint. |
| `UI-SCAN-DLG-001` | Cámara móvil | Permitir, reintentar, detener | Offline queue y ack; no dedupe por value. |

### 6.6 Regla de cobertura de pantalla

`TEST-UI-COVERAGE-001`: CI mantiene un manifest de las 23 rutas, 16 grupos y 50 IDs anteriores. Un cambio de router/tabs que agregue, quite o renombre un destino DEBE actualizar manifest, permisos, contract tests y esta especificación o su sucesora. `TEST-UI-COVERAGE-002`: para cada ruta se ejecutan al menos estados loading/data/empty/error y el rol mínimo; los destinos mutables agregan success/partial/conflict/rejected/unknown según corresponda.

---

## 7. Rediseño visual transversal, patrones a reformular y éxito observable

### 7.1 Principios de diseño visual y de interacción

| ID | Principio | Regla implementable |
| --- | --- | --- |
| `UI-VISUAL-001` | Verdad antes que celebración | No mostrar verde/success hasta `persisted_at` y versión/efectos; partial usa ámbar persistente y lista de pendientes. |
| `UI-VISUAL-002` | Estado visible | Toda entidad operacional muestra status textual, readiness/lifecycle, última actualización y razón de bloqueo cerca del título. |
| `UI-VISUAL-003` | Una acción primaria | Cada contexto tiene máximo una CTA primaria; secundarias neutras; destructivas separadas y con confirmación. |
| `UI-VISUAL-004` | Progresive disclosure | Lista → detalle → evidencia/audit; errores críticos no se ocultan en acordeones. |
| `UI-VISUAL-005` | Reconocimiento sobre memoria | Catálogos, unidades, moneda, package y motivos se seleccionan por labels/metadata; no se exige recordar códigos. |
| `UI-VISUAL-006` | Densidad adaptativa | Cards para onboarding/móvil; matrix/table para operación experta; ambas comparten datos/acciones, no features distintas. |
| `UI-VISUAL-007` | Foco en el trabajo incompleto | Counts de blockers y next action antes que métricas decorativas. |
| `UI-VISUAL-008` | Evidencia al alcance | IDs, operation ID, versión, documento y auditoría visibles/copiables según permiso. |

### 7.2 Inventario explícito de eliminación, deprecación y reformulación

| ID | Elemento actual | Acción | Reemplazo | Tradeoff |
| --- | --- | --- | --- | --- |
| `DOM-REMOVE-001` | `productos.activo` | **Eliminar** | `deleted_at` como lifecycle único | Requiere adaptar filtros, pero elimina estados zombis. |
| `DB-REMOVE-001` | `stock_snapshot` como segunda autoridad | **Eliminar/redefinir solo checkpoint derivado** | events + balance reconstruible | Rebuild operacional necesario; gana consistencia. |
| `DB-REMOVE-002` | UPDATE/DELETE de `movimientos` | **Prohibir** | reversa/ajuste append-only | Más eventos, historia verdadera. |
| `DB-REMOVE-003` | Umbrales en `producto_area` y `par_level_config` | **Eliminar/fusionar** | `politicas_reposicion` | Migración de fixtures; ownership claro. |
| `API-DEPRECATE-001` | `PUT /productos/{id}` híbrido | **Deprecar y eliminar** | Merge PATCH + transitions | Cliente debe manejar tri-state/ETag. |
| `API-DEPRECATE-002` | `/setup/importar-productos` con lógica propia | **Adapter temporal → eliminar** | batch durable commands | Trabajo inicial mayor; una sola semántica. |
| `API-REMOVE-001` | GET scanner con side effects | **Eliminar side effect** | lookup GET + candidate POST | Un paso explícito adicional, auditable. |
| `API-REMOVE-002` | IDs/códigos repartidos | **Migrar/eliminar columnas legacy** | identifier registry | Lookup simple; exige resolver colisiones en seed. |
| `API-REMOVE-003` | data URL/base64 como vínculo de archivos | **Eliminar** | upload registry + object storage | Infra adicional; persistencia/retry reales. |
| `API-REMOVE-004` | `per_page=200/500/2000` | **Eliminar** | cursor + autocomplete remoto | Más requests pequeños; escala y no trunca. |
| `API-REMOVE-005` | response `success: true` sin efectos/version | **Eliminar** | mutation outcome común | Payload algo mayor; verdad operacional. |
| `UI-REMOVE-001` | Toast como prueba de éxito | **Reformular** | outcome panel + refetch/audit | UI más explícita; reduce falsos éxitos. |
| `UI-REMOVE-002` | `catch -> []/false/default` | **Eliminar** | `AsyncResourceState.error` | Requiere ramas UI, evita falsos vacíos. |
| `UI-REMOVE-003` | Sidebar como autorización | **Eliminar paradigma** | capabilities backend + route/action guards | Matriz inicial más formal; coherencia. |
| `UI-REMOVE-004` | Interfaces TS manuales duplicadas | **Eliminar** | cliente/types OpenAPI generados | Dependencia del schema; CI detecta drift. |
| `UI-REMOVE-005` | Mocks de endpoints inexistentes como única prueba | **Eliminar suficiencia** | Axum router contract tests + MSW generado | Tests algo más lentos; prueban sistema real. |
| `UI-REMOVE-006` | Pestaña Ofertas activa sin backend | **Feature flag off** hasta verde | SupplierOffer API | Menos superficie temporal; sin engaño. |
| `UI-REMOVE-007` | `gtins-tab.tsx` y `areas-tab.tsx` huérfanos | **Eliminar tras migrar funciones** | Identifiers en Product; areas en assignments | Reduce código muerto. |
| `UI-REMOVE-008` | Modal sobre modal del importador | **Eliminar** | raw-data drawer inline | Menos interrupción; requiere layout responsive. |
| `UI-REMOVE-009` | Tabs hechas con botones sin semántica | **Reformular** | Tabs primitive accesible | Refactor compartido; teclado correcto. |
| `UI-REMOVE-010` | Diálogos `div` sin focus trap | **Reformular** | Dialog primitive accesible | Dependencia/primitiva común; menos bugs. |
| `UI-REMOVE-011` | Componentes monolíticos Product/Importer | **Dividir** | feature modules + reducer/state machine | Más archivos/interfaces; menor blast radius. |
| `UI-REMOVE-012` | UUID idempotente creado dentro de cada click | **Eliminar** | operation key por intención | Se debe gestionar lifecycle de key. |
| `OPS-REMOVE-001` | `.env` implícito para tests | **Prohibir** | env explícito + preflight allowlist | Menos comodidad local, fail-safe. |
| `OPS-REMOVE-002` | Uploads en filesystem efímero | **Eliminar de producción** | storage durable | Costo infra; recuperación demostrable. |
| `OPS-REMOVE-003` | `/health` combinado y 200 degradado | **Separar** | `/live` + `/ready` | Dos probes; routing correcto. |
| `OPS-REFORM-001` | Rate limit in-memory y doble evaluación | **Reformular** | una capa, store distribuido cuando >1 instancia | Dependencia externa futura; contrato 429 único. |
| `OPS-REFORM-002` | `Cache-Control: no-store` global | **Reformular** | no-store para API sensible; immutable para assets hash | Política por ruta más compleja; mejor performance. |

### 7.3 Paradigmas objetivo

| Antes | Después | Regla |
| --- | --- | --- |
| CRUD genérico | Commands + read models | Los estados/transiciones no se expresan mediante updates arbitrarios. |
| Entidad mutable histórica | Revisión + evento | Package revision y ledger conservan hechos. |
| Estado local autoritativo | Server state durable + reducer UI efímero | TanStack Query contiene servidor; reducer solo navegación/selección. |
| Role checks dispersos | Capability policy | Route y action consultan el mismo manifest de `/auth/me`. |
| Validación por pantalla | Schema/value objects compartidos | Frontend ayuda; backend/DB garantizan. |
| Fetch masivo | Query remota incremental | Cursor/debounce/cancelación/virtualización. |
| “optimistic success” irreversible | Optimismo reversible o pessimistic confirmed | Solo usar optimistic update cuando existe rollback local seguro. |
| Batch como CSV regenerado | Rows JSON tipadas | Preview/commit exactos. |
| Estado booleano | State machine exhaustiva | Compiler/tests obligan a manejar partial/conflict/error. |

### 7.4 Componentes compartidos con contrato

| ID/componente | Responsabilidad | Props/resultado mínimo | Prohibiciones |
| --- | --- | --- | --- |
| `UI-CMP-001` `CapabilityRoute` | Bloquear ruta antes de queries | `required`, fallback 403, preserve returnTo | No confiar solo en sidebar. |
| `UI-CMP-002` `RequireCapability` | Mostrar/habilitar acción | capability, denied reason | No renderizar acción sensible disabled si revela dato; según política ocultar/explicar. |
| `UI-CMP-003` `PageStateBoundary` | loading/data/empty/error/stale/retry | AsyncResourceState, render functions | No convertir error en empty. |
| `UI-CMP-004` `MutationOutcomePanel` | success/partial/conflict/rejected/unknown | operation/result/effects/retry/reconcile | No usar solo toast. |
| `UI-CMP-005` `CursorDataTable` | paginación/orden/cursor/row a11y | data/page/columns/loading/error | No clamping ni índice como key. |
| `UI-CMP-006` `RemoteCombobox` | búsqueda paginada cancelable | query, cursor, selected canonical object | No precargar 500/2000 registros. |
| `UI-CMP-007` `FilterBar` | URL canonical filters | schema, defaults, applied filters | No exportar filtros distintos. |
| `UI-CMP-008` `AccessibleTabs` | tabs/deep links/keyboard | items, active, route/query binding | No button group sin roles. |
| `UI-CMP-009` `AccessibleDialog/Drawer` | overlays | title, description, dirty guard, focus return | No nested modal; no cierre icon sin label. |
| `UI-CMP-010` `FormErrorSummary` | field/tab errors | path→control/tab; focus | No error solo toast. |
| `UI-CMP-011` `QuantityInput` | decimal exacto/unidad | string value, scale, min/max, parser locale | No `Number(value)` seguido de fallback truthy. |
| `UI-CMP-012` `MoneyInput` | amount/currency | decimal string, ISO currency | No float en payload. |
| `UI-CMP-013` `BusinessDateInput` | date/timezone policy | date, min/max, future rule | No datetime-local sin zona/regla. |
| `UI-CMP-014` `ReadinessPanel` | capability/reasons/next actions | canonical readiness response | No inferir pending por stock ausente. |
| `UI-CMP-015` `PackageRevisionEditor` | nueva revisión | current read-only, draft new, effective/reason | No editar revisión usada. |
| `UI-CMP-016` `IdentifierField` | normalizar/validar/registrar | kind/value/owner/conflict | No resolver colisión por prioridad local. |
| `UI-CMP-017` `UploadField` | lifecycle durable | upload_id/status/progress/checksum/retry | No data URL ni borrar anterior primero. |
| `UI-CMP-018` `OperationKeyBoundary` | key por intención | payload fingerprint, reset policy, reconcile | No UUID por invocación. |
| `UI-CMP-019` `ConflictResolver` | version/partial diff | local/server/base, reload/rebase | No reload ciego que borre draft. |
| `UI-CMP-020` `AuditTimeline` | events redacted/correlated | operation/aggregate/version | No datos secretos/raw HTML. |
| `UI-CMP-021` `ScannerEventQueue` | client event IDs/offline/ack | queue, TTL, attempts, ack cursor | No dedupe por code. |
| `UI-CMP-022` `ImportWizardMachine` | steps/revision/hash/outcomes | server batch + local selection | No commit de preview obsoleto. |

### 7.5 Sistema visual

#### 7.5.1 Tokens semánticos

- `surface/default/subtle/raised`, no fondos ad hoc por página.
- `text/primary/secondary/muted/inverse` con contraste AA.
- `status/info/success/warning/danger/neutral`; cada uso acompaña icono+label.
- Escala espaciado base 4 px; densidad `comfortable|compact` solo en tablas/grids.
- Tipografía: título página, título sección, body, caption y mono para IDs/códigos; no tamaños arbitrarios.
- Foco global de alto contraste y no eliminado por CSS.
- Motion 120–200 ms y alternativa reduced-motion.

#### 7.5.2 Jerarquía de estados

| Nivel | Ejemplo | Tratamiento |
| --- | --- | --- |
| Bloqueo | producto no ready, línea receipt inválida | Banner persistente con reason/next action; CTA disabled explicado. |
| Resultado parcial | conteo/import | Panel ámbar con counts y acciones por elemento. |
| Error recuperable | red/timeout | Estado inline con retry y datos previos stale. |
| Error de permiso | 403 | Página/section explícita, sin filtrar payload. |
| Éxito | receipt/event committed | Resumen con ID, versión, efectos y enlaces; toast secundario. |
| Información | ayuda/formatos | Disclosure/tooltips accesibles, nunca esconden regla crítica. |

### 7.6 Responsive, rendimiento y carga cognitiva

| ID | Budget/regla |
| --- | --- |
| `UI-PERF-001` | Mantener lazy routes; scanner/PDF/charts/importer se cargan bajo intención y muestran fallback contextual. |
| `UI-PERF-002` | Definir budget CI por chunk inicial y por feature; el baseline auditado (~401–422 KB en chunks pesados) no puede crecer sin excepción. Meta inicial: reducir cada feature heavy al menos 20% o justificar. |
| `UI-PERF-003` | Virtualizar grids >200 filas; no renderizar 5.000 rows/cells simultáneamente. |
| `UI-PERF-004` | Debounce search 250–400 ms, cancelación de request anterior y cache por query/cursor. |
| `UI-PERF-005` | Prefetch solo por intención/hover/focus y capability; no disparar tres reportes ocultos. |
| `UI-COGNITIVE-001` | Wizard máximo una decisión principal por paso; resumen de impacto antes del commit. |
| `UI-COGNITIVE-002` | Errores agrupados por fila/pestaña con contador y next action; no lista plana de cientos sin navegación. |
| `UI-COGNITIVE-003` | Expert matrix y novice cards comparten state/commands; no duplicar lógica. |

### 7.7 Reglas de éxito observable por flujo

| ID | Flujo | Evidencia de éxito obligatoria |
| --- | --- | --- |
| `UI-SUCCESS-001` | Product patch/transition | Response version/ETag + GET mismo estado + audit event; no ledger change en approve. |
| `UI-SUCCESS-002` | Identifier/package/offer | Registro/revision/offer visible en GET canónico y selectors dependientes después de invalidar. |
| `UI-SUCCESS-003` | Receipt | Receipt confirmed + todas las líneas + upload linked + event IDs + balances/refetch. |
| `UI-SUCCESS-004` | Consumption/discard/count | Events + balances + movement history; partial enumera conflictos. |
| `UI-SUCCESS-005` | Import | Batch committed/hash/revision + counts reconciliables + row outcomes + products/readiness visibles. |
| `UI-SUCCESS-006` | Config | Nueva versión GET; branding/schema/capability side effects observados; secretos no retornados. |
| `UI-SUCCESS-007` | Upload | Object verified y linked; old object retained hasta link; cleanup de huérfano medible. |
| `UI-SUCCESS-008` | Scanner | client event acked y visible una vez en estación; code repetido conserva multiplicidad. |

### 7.8 Tradeoffs aceptados y alternativas descartadas

| Decisión | Elegida | Alternativa | Motivo |
| --- | --- | --- | --- |
| Autorización | Capabilities | Roles fijos centralizados | Más flexible para review/confirm; roles siguen como presets. |
| Listados | Cursor | Página numérica global | Cursor estable con mutaciones; total puede ser costoso y opcional. |
| Recepción+archivo | upload previo + command DB | Saga POST+PUT | Menos estados parciales; objeto huérfano se limpia. |
| Scanner | Token público mínimo | Login/device pairing | Menor fricción actual; pairing futuro si riesgo cambia. |
| Import commit | Atómico tras staging | Savepoint parcial automático | Evita éxito ambiguo; excluir es decisión explícita. |
| Stock | Ledger+balance | Event sourcing total de todo el sistema | Se limita complejidad al dominio que necesita historia fuerte. |
| UI state | TanStack Query + reducer | Store global único | Separa server/local y reduce invalidaciones manuales. |

---

## 8. Plan de implementación, pruebas, rollout y gate NO-GO/GO

### 8.1 Prioridades y reglas de entrega

| Prioridad | Definición | Política |
| --- | --- | --- |
| **P0** | Corrupción, pérdida/falso éxito crítico, aislamiento/autorización severa | Bloquea cualquier release y feature nueva en la superficie. |
| **P1** | Confianza de build/test/deploy, operación crítica o contrato transversal | Bloquea producción; se implementa antes de pulido. |
| **P2** | Robustez, UX, accesibilidad, observabilidad y mantenibilidad importantes | Debe cerrar antes de GO salvo excepción explícita con fecha/owner. |
| **P3** | Optimización/deuda no bloqueante | Puede seguir después del primer GO si no debilita gates. |

`OPS-WORKUNIT-001`: cada work unit es un comportamiento revisable con código, tests y documentación/evidencia juntos. No se separan “models”, “services” y “tests” en commits que no funcionen por sí solos.  
`OPS-WORKUNIT-002`: objetivo máximo **400 líneas authored changed** por PR slice. Si una unidad supera el forecast, se divide en RED/infra y GREEN/behavior o por vertical, manteniendo cada commit coherente. Los generated types/goldens no cuentan para el budget, pero sí para identidad/review.  
`OPS-WORKUNIT-003`: no se hace commit/push/PR hasta que el contenido exacto tenga el receipt/review requerido por las reglas del repositorio y pase el gate nativo correspondiente.

### 8.2 Grafo de dependencias

```text
WU-00 Contención
  └─> WU-01 Test isolation + CI base
       ├─> WU-02 Product lifecycle schema
       │    ├─> WU-03 Package/identifier schema
       │    ├─> WU-05 Attributes/readiness/planning
       │    └─> WU-07 Product command API
       ├─> WU-04 Ledger/balance
       └─> WU-06 Idempotency/audit/outbox
            ├─> WU-07 Product API
            └─> WU-13 Scanner protocol

WU-03 + WU-07 -> WU-08 Package/identifier/offer API
WU-03 + WU-05 + WU-07 -> WU-09 Durable importer
WU-06 -> WU-09 Durable importer idempotency/audit
WU-03 + WU-05 + WU-06 + WU-08 + WU-04 -> WU-12 Receipt backend
WU-04 -> WU-10 Setup stock sobre ledger
WU-05 + WU-07 + WU-09 -> WU-10 Setup/import UI
WU-01 + WU-07 -> WU-11 Error/pagination/capabilities contract
WU-11 -> WU-14 Shared UI primitives
WU-07 + WU-08 + WU-14 -> WU-15 Creator UI
WU-04 + WU-14 -> WU-16 Stock/operations UI
WU-12 + WU-13 + WU-14 -> WU-17 Receipt UI
WU-04 + WU-06 + WU-14 -> WU-18 Count UI
WU-08 + WU-12 + WU-14 -> WU-19 Procurement UI
WU-11 + WU-14 -> WU-20 Admin/support UI
WU-10..20 -> WU-21 Accessibility/performance
WU-01 + WU-06 + WU-12 -> WU-22 Production platform
WU-00..22 -> WU-23 Integrated release proof
```

### 8.3 Work units RED → GREEN → REFACTOR

| WU / prioridad / forecast | Resultado vertical y requisitos | RED primero | GREEN + REFACTOR | Evidencia y rollback boundary |
| --- | --- | --- | --- | --- |
| `WU-00` P0, 260–400 | Contención P0 + harness seguro: guards/flags (`DOM-FREEZE-*`, `API-FREEZE-*`, `UI-*-FREEZE-*`), `scripts/test-isolated-db.sh`, lint de IDs y Markdown. | Reproducir aprobación/PUT/receipt; wrapper rechaza URL remota antes de pool; linters fallan con ID undefined/pipe roto. | Rechazos/flags; wrapper crea/injecta/destruye PostgreSQL efímero; `scripts/lint-spec-references.py` y markdownlint. | Tests de contención+self-test wrapper+doc lint; rollback de scripts/flags sin tocar datos. |
| `WU-01` P0/P1, 250–380 | CI base consume exclusivamente el wrapper de WU-00 (`OPS-DB-ISOLATION-001`, `OPS-P1-001`). | Job sin wrapper o con URL remota debe fallar antes de abrir pool. | Workflow invoca `scripts/test-isolated-db.sh -- <command>`, env explícito, no dotenv. | Log de guard/ephemeral lifecycle y CI; rollback: workflow/env test exclusivamente. |
| `WU-02` P0, 300–400 | Baseline `productos` lifecycle/status/version y transiciones (`DB-INV-001/002/015`, `DOM-STATE-*`). | Migration/SQL tests de combinaciones y transition table. | Recrear baseline, Rust enums exhaustivos, repository. | Fresh DB migrations + tests; rollback: baseline/product domain modules antes de datos operativos. |
| `WU-03` P0, 320–400 | Package revisions + identifier registry + composite keys (`DB-INV-003/004/008`). | SQL directo de package ajeno, duplicate GTIN, mutation used revision debe fallar. | Tables/FKs/triggers/value objects. | Migration integration; rollback: package/identifier schema + seed. |
| `WU-04` P0, 350–400 | Append-only inventory events y único balance (`DB-INV-005/006/007`). | Tests UPDATE/DELETE, concurrent consumption, rebuild mismatch. | Procedure/service apply event, locks deterministas, rebuild command. | Ledger property tests + runtime harness; rollback: new inventory tables/services before consumers switch. |
| `WU-05` P1, 320–400 | Attributes JSON tipado, readiness y `InventoryPolicy(product,area)` (`DB-INV-011/012/013`, `DOM-READY-*`). | Required custom absent, type mismatch, duplicate product+area, aliases sin area y orden/defaults inválidos. | Definitions/values trigger, evaluator/reasons, policy+demanda owner único. | DB/service tests; rollback: new readiness/planning modules. |
| `WU-06` P0, 330–400 | Idempotency scoped + audit/outbox transaccional (`OPS-P0-001`, `DB-INV-014/016/019`). | Multiuser replay, payload mismatch, concurrent identical claims, audit rollback. | Composite claim/hash/store, middleware/command helper, redaction/outbox. | Runtime 2-user harness and concurrency; rollback: service/tables before route adoption. |
| `WU-07` P0/P1, 350–400 | Product create/read/merge-patch/transitions/readiness canónicos (`API-PRODUCT-001..011`, especialmente `API-PRODUCT-004`). | Edit roundtrip, `{}` no-op, null vs omit, ETag conflict, enum roundtrip, approval ledger invariant. | DTO/commands/read model/OpenAPI; delete old PUT behind deprecation. | Router/API+DB tests; rollback: new routes/client version, old frozen endpoint remains temporalmente. |
| `WU-08` P0/P1, 350–400 | Identifier/package revision/SupplierOffer endpoints (`API-IDENT-*`, `API-PACKAGE-*`, `API-OFFER-*`). | Router contract must fail for current Ofertas; supplier-specific selection/FK tests. | Implement commands/read models/routes and feature capability manifest. | Axum contract tests without mocks; rollback: flag off + routes/tables unused. |
| `WU-09` P0/P1, 360–400 por slice | Durable importer backend sin CSV loopback (`API-IMPORT-*`, `DB-INV-017`). Separar 09A revisiones/rows y 09B binding/commit/templates. | Revision N+1/superseded/resume, cinco hashes mismatch, replay, rollback counts y self-import de producto+política. | DDL versionado, endpoints 015..021, `DB-PROC-004`, commands tipados y adapter temporal. | Multipart API+DB harness; rollback deja batch legible y target writes en 0. |
| `WU-10` P1/P2, 350–400 por slice | Setup + SmartImporter durable (`UI-SETUP-*`, `UI-IMPORT-*`) sobre ledger WU-04; producto y policy son batches separados. | F5 resume, revision superseded, ambas plantillas, collision, row sums, partial/unknown, blockers. | Query API/hooks + reducer machine; policy UI vive por área; remove monolith tras paridad. | Vitest + browser E2E; rollback: feature flag al importer congelado, preserva batch. |
| `WU-11` P0/P1, 330–400 | API error, cursor, decimals/time y capabilities manifest (`API-COMMON-*`, `API-ERROR-*`, `DOM-RBAC-DEC-001`). | 422 DB mapping, invalid limit, >100 search, timezone/decimal roundtrip, route matrix. | Common response/error/page DTO, `/auth/me` capabilities, route policies. | Contract/property tests; rollback: compatibility response adapter versioned. |
| `WU-12` P0, 360–400 | Durable uploads + atomic receipt command (`API-UPLOAD-*`, `API-RECEIPT-*`, `DB-INV-018`, `DOM-MONEY-DEC-001`). | All lines, product/package mismatch, upload unverified, retry y total `490000.0000` reconciliado pese a unitario display. | Storage registry, receipt TX, costo total autoritativo/reparto residual y compensación. | API+DB+fake storage harness; rollback: feature flag y no nuevas receipts por legacy. |
| `WU-13` P0, 280–380 | Scanner public token event/ack (`API-SCAN-003..005`). | No-JWT token, expired/revoked, duplicate codes, lost poll/ack, rate limit. | Public scoped router, hashed token, sequence/cursor/ack, client event IDs. | Integration + mobile component tests; rollback: revoke sessions/flag QR off. |
| `WU-14` P1/P2, 300–400 | Shared UI state/permission/form primitives (`UI-CMP-001..019`). | Component contract tests for error≠empty, partial, focus, tabs/dialog, cursor. | Implement primitives and Storybook/test fixtures if project accepts; no route migration yet. | Vitest/axe/keyboard; rollback: components isolated. |
| `WU-15` P0/P1, 350–400 per slice | Creator/Product/Catalogation UI (`UI-CREADOR-*`, `UI-PRODUCT-*`). Dividir lista/form y detail/packages/offers. | GET→form→PATCH no-op, hidden tab errors, role tab, package revision/offer contract. | Generated client + shared components; remove manual types/huérfanos. | Component+E2E; rollback: route flag, backend remains. |
| `WU-16` P1/P2, 350–400 per slice | Stock/consumos/descartes/movimientos (`UI-STOCK-*`, `UI-CONSUMOS-*`, `UI-DESCARTES-*`, `UI-MOVIMIENTOS-*`). | Error vs empty, >100 cursor, FEFO, replay/unknown, export filters. | Migrate queries/commands and history server-side. | E2E operational; rollback per route flag, ledger stays authority. |
| `WU-17` P0/P1, 350–400 per slice | Recepciones list/new/detail UI (`UI-RECEPCIONES-*`). Dividir list/detail y wizard. | Incomplete 0 request, upload partial/retry, offer block, duplicate click, scanner ack. | Draft/reducer, upload_id, one command, outcome/refetch. | Browser/API/DB E2E; rollback: disable create, preserve read/detail. |
| `WU-18` P1, 280–380 | Conteo list/detail outcomes (`UI-CONTEO-*`, `API-COUNT-001..002`). | Probe error; create batch atomic; draft partial; confirm con un conflicto debe probar 0 movimientos; scan +1/skip. | Batch create atómico, draft outcome panel/conflict resolver y confirm command all-or-nothing. | Component+API+DB integration; rollback: disable confirm, keep sessions/drafts readable. |
| `WU-19` P1/P2, 350–400 per slice | Solicitudes/OC con ownership y offers (`UI-SOLICITUDES-*`, `UI-ORDENES-*`). | Own/other role transitions, mode loss, stale offer, product/package FK. | Durable draft/state commands, admin OC views. | E2E request→OC→receipt; rollback per state/action flag. |
| `WU-20` P0/P1/P2, 350–400 por slice | Config/Users/Areas/Audit/Reports/Labels/Dashboard. 20A config commands por sección, 20B admin+`external-record-only`, 20C reports/support. | Config 403/PIN/SSRF/versiones aisladas; policy área; WhatsApp sin delivery claim; audit/report/labels error. | Capabilities + shared states + `API-CONFIG-*`/`API-WHATSAPP-*`; sin save global/provider webhook. | Security/contract/E2E; rollback independiente, config fail closed y handoff conserva audit. |
| `WU-21` P2/P3, 250–380 | A11y, responsive y performance sobre rutas migradas (`UI-COMMON-006`, `UI-PERF-*`). | Axe/keyboard/viewport/bundle baseline debe fallar en problemas conocidos. | Fix tabs/dialogs/focus/mobile, split chunks/virtualize. | axe + Playwright viewports + bundle report; rollback CSS/component slice. |
| `WU-22` P1/P3, 300–400 | Plataforma productiva: secrets, readiness, storage, metrics, backup, provenance y logging seguro de migraciones (`OPS-*`). | Missing secrets/mock, DB-down, storage restart, manifest y log con SQL/valor sensible deben fallar. | Render/Docker/CI/telemetry/runbooks/PITR; migración loguea solo ID/duración/hash. | Staging+restore drill+redaction test; rollback release config/image, nunca secretos en repo/log. |
| `WU-23` P0/P1 gate, evidencia | Prueba integrada y release candidate exacto. | Ejecutar matriz completa contra SHA; cualquier P0/P1/gate rojo mantiene NO-GO. | Solo correcciones dentro de nuevos work units/review; no “fix final” informal. | Receipt válido, logs/SBOM/provenance/smoke/restore; rollback no aplica: decide GO/NO-GO. |

### 8.4 Catálogo de pruebas obligatorias

#### 8.4.1 Dominio/base/API

| ID | Prueba RED y resultado GREEN requerido |
| --- | --- |
| `TEST-DOM-001` | Aprobar no cambia ninguna fila/hash de inventory event/balance/package revision; sí cambia status/version/audit. |
| `TEST-DOM-002` | Roundtrip de los cuatro estados DB↔Rust↔OpenAPI↔TS. |
| `TEST-DOM-003` | Archive/reactivate jamás produce combinación lifecycle inválida y preserva estado catálogo. |
| `TEST-DB-001` | SQL directo product A/package B falla FK en lot, receipt, request y order. |
| `TEST-DB-002` | UPDATE/DELETE ledger falla; reversa conserva original y balance correcto. |
| `TEST-DB-003` | Rebuild de balance produce exactamente la proyección actual o reporta divergence y no swap. |
| `TEST-DB-004` | Dos consumos concurrentes no dejan saldo negativo ni doble event. |
| `TEST-DB-005` | Required custom missing/type wrong bloquea readiness/constraint. |
| `TEST-DB-006` | Una `InventoryPolicy` por producto+área; duplicate/null area, demanda negativa y orden inválido fallan; safety=0/max=null son válidos. |
| `TEST-DB-007` | Revisión import `ready/superseded/committed` rechaza mutación; rows de N y N+1 coexisten; FK bloquea revision/batch cruzados. |
| `TEST-API-001` | Merge patch omit/null/value/no-op y ETag stale. |
| `TEST-API-002` | Identifier collision across kind/owner retorna 409; scanner lookup único. |
| `TEST-API-003` | Package factor revision no altera receipts/events previos. |
| `TEST-API-004` | Supplier offers endpoints existen en Router Axum y respetan proveedor/vigencia/currency. |
| `TEST-API-005` | Receipt all-or-nothing: header, all lines, lot, event, balance, upload link, audit y total monetario exacto. |
| `TEST-API-006` | Import crea N+1/superseded, reanuda sin reparse, exige los cinco campos del binding y reconcilia target/outcomes/counts/DB en una TX. |
| `TEST-API-007` | Import name-only → `incompleto` visible y todos los commands operativos devuelven PRODUCT_NOT_READY. |
| `TEST-API-008` | Cursor accede 250/230 records sin duplicar/omitir bajo inserciones concurrentes razonables. |
| `TEST-API-009` | Error mapping para unique/FK/check/serialization; nunca 500 para input conocido. |
| `TEST-API-010` | Draft count admite partial por ítem sin movimientos; confirm con un conflicto devuelve diagnósticos y persiste 0 movimientos/saldos. |
| `TEST-API-011` | Dos secciones config se editan con ETags independientes; conflicto en una no bloquea ni sobrescribe la otra y no existe save global. |
| `TEST-API-012` | Handoff WhatsApp persiste intención/resultado del usuario y URL allowlisted; ninguna respuesta/audit afirma sent/delivered. |
| `TEST-MONEY-001` | 2 × 245000 = recepción/línea/eventos `490000.0000`; display unitario `2552.0833` no reconstruye total y un split asigna residual determinista con suma exacta. |
| `TEST-IMPORT-TEMPLATE-001` | Plantilla completa Product descargada se autoimporta sin editar y normalized coincide byte-semánticamente con 5.14.4. |
| `TEST-IMPORT-TEMPLATE-002` | Plantilla InventoryPolicy y aliases legacy se autoimportan al mismo normalized; omitir area o violar defaults/orden bloquea commit. |
| `TEST-IDEMPOTENCY-001` | Same actor/scope/key/hash = exact replay, una mutación. |
| `TEST-IDEMPOTENCY-002` | Different actor same key no recibe body ajeno. |
| `TEST-IDEMPOTENCY-003` | Same scope/key different hash = 409 sin revelar response previa. |
| `TEST-IDEMPOTENCY-004` | Dos requests simultáneos idénticos producen un claim/event group. |

#### 8.4.2 UI/E2E

| ID | Prueba requerida |
| --- | --- |
| `TEST-UI-001` | Manifest 23 rutas × roles public/consulta/tecnólogo/admin; route y backend coinciden. |
| `TEST-UI-002` | 50 destinos presentes y cada tab/step/mode tiene nombre/keyboard/panel. |
| `TEST-UI-003` | Cada listado: 2xx empty, data, 401, 403, 500, timeout, stale/refetch. |
| `TEST-UI-004` | Product form hidden-tab errors, Unicode 255/256, no-op, conflict compare. |
| `TEST-UI-005` | Receipt wizard F5, all-lines gate, exclude reason, upload fail/retry, double click, future/zero/negative. |
| `TEST-UI-006` | Scanner phone no JWT, duplicate codes, offline queue, expired/revoked token, lost ack. |
| `TEST-UI-007` | Count probe error, create batch atomic, draft partial, confirm conflict con 0 movimientos y skip/+1 repeated. |
| `TEST-UI-008` | Import empty/limits/BOM/semicolon, mapping collision, N+1/resume/superseded, ambos templates, exact binding/replay y counts. |
| `TEST-UI-009` | Requests mode/provider change preserves draft; ownership and six transitions. |
| `TEST-UI-010` | Reports filters/export parity, one panel failure, timezone boundary. |
| `TEST-A11Y-001` | axe sin violaciones críticas; tabs/dialogs/focus/Escape/return focus/labels. |
| `TEST-A11Y-002` | Flujos críticos solo teclado y viewports 320/768/1280. |
| `TEST-PERF-001` | Bundle budget, remote search cancellation y virtual grid 5.000 rows sin bloqueo inaceptable. |

#### 8.4.3 Operación/seguridad/recuperación

| ID | Prueba/gate |
| --- | --- |
| `TEST-OPS-001` | DB guard rechaza URL remota/dotenv implícito antes de conexión. |
| `TEST-OPS-002` | Config admin 403 para roles bajos; respuestas nunca contienen PIN/key; PIN hash/rate limit. |
| `TEST-OPS-003` | SSRF defender: loopback, RFC1918, link-local, metadata, DNS rebinding y redirects fuera de allowlist se rechazan antes del request. Se prueba con resolver/transport falsos, no atacando redes reales. |
| `TEST-OPS-004` | `/live` 200 si proceso vivo; `/ready` no-2xx si DB/storage obligatorio no disponible. |
| `TEST-OPS-005` | Redeploy/restart conserva upload vinculado y checksum; cleanup elimina solo huérfanos vencidos. |
| `TEST-OPS-006` | Backup cifrado + restore drill de DB y objetos cumple RPO/RTO y correlación. |
| `TEST-OPS-007` | Imagen expone SHA/build ID, SBOM/provenance y migración exacta; smoke comprueba mismo SHA. |
| `TEST-OPS-008` | Logger de migraciones emite solo ID/duración/hash/status dentro del límite; test canario prueba que SQL y valores no aparecen. |
| `TEST-DOC-001` | Lint de IDs expande prefijos/rangos declarados y falla con referencias exactas undefined, duplicadas o malformed. |
| `TEST-DOC-002` | Markdown lint falla con fence impar o tabla con pipes/celdas inválidas; este documento pasa completo. |

### 8.5 Comandos de verificación y política RED/GREEN

`OPS-TEST-WRAPPER-001`: WU-00 DEBE crear `scripts/test-isolated-db.sh`. Es la única entrada permitida para tests que puedan abrir pool: crea un PostgreSQL efímero único, instala `trap` de destrucción, elimina `DATABASE_URL`/dotenv heredados, genera e inyecta una URL loopback o de la red privada del contenedor **en la misma invocación**, parsea host/nombre sin imprimir credenciales y rechaza cualquier host remoto o base sin prefijo de test antes de ejecutar el comando recibido después de `--`. Luego aplica la baseline/migraciones, ejecuta exactamente ese comando, conserva su exit code y destruye DB/contenedor aun con señal/fallo. `--self-test` prueba tanto el happy path como que un canario remoto no llega a abrir proceso/pool.

Los nombres de targets y filtros siguientes son artefactos exigidos al WU correspondiente; si aún no existen, el gate falla en vez de sustituirlos por una metavariable:

```bash
# Guard y backend enfocado: URL creada, validada e inyectada por el wrapper.
bash scripts/test-isolated-db.sh --self-test
SQLX_OFFLINE=true ./scripts/test-isolated-db.sh --workdir backend -- \
  cargo test --locked --test producto_api_contract -- --nocapture

# Backend check-only/build y suite completa aislada.
cargo fmt --manifest-path backend/Cargo.toml --all -- --check
SQLX_OFFLINE=true cargo check --manifest-path backend/Cargo.toml --locked --all-targets
SQLX_OFFLINE=true cargo clippy --manifest-path backend/Cargo.toml --locked --all-targets --all-features -- -D warnings
SQLX_OFFLINE=true ./scripts/test-isolated-db.sh --workdir backend -- \
  cargo test --locked --all-targets -- --test-threads=1
cargo build --manifest-path backend/Cargo.toml --locked --release --bin inventario-lab-backend

# Frontend.
npm --prefix codigofuente/frontend ci
npm --prefix codigofuente/frontend test -- --run
npm --prefix codigofuente/frontend run lint
npm --prefix codigofuente/frontend exec -- tsc -b --pretty false
npm --prefix codigofuente/frontend run build

# Documento, contratos e integración/E2E.
python3 scripts/lint-spec-references.py SYSTEM_PRODUCTION_READINESS_REDESIGN_SPEC.md
codigofuente/frontend/node_modules/.bin/markdownlint-cli2 SYSTEM_PRODUCTION_READINESS_REDESIGN_SPEC.md
npm --prefix codigofuente/frontend run test:contracts
npm --prefix codigofuente/frontend run test:e2e
./scripts/runtime-smoke.sh --expected-sha "$GIT_SHA"
```

`OPS-DOC-LINT-001`: `lint-spec-references.py` reconoce definiciones normativas, expande solo los prefijos/rangos declarados en 1.4 y falla ante ID exacto undefined, rango vacío/invertido, destino/ruta duplicado o referencia a sección inexistente. Markdownlint valida fences y tablas además de estilo; ambos son jobs bloqueantes de CI.

#### 8.5.1 WU → comando/filtro enfocado obligatorio

| WU | Comando o filtro exacto |
| --- | --- |
| `WU-00` | `bash scripts/test-isolated-db.sh --self-test && python3 scripts/lint-spec-references.py SYSTEM_PRODUCTION_READINESS_REDESIGN_SPEC.md && codigofuente/frontend/node_modules/.bin/markdownlint-cli2 SYSTEM_PRODUCTION_READINESS_REDESIGN_SPEC.md` |
| `WU-01` | `SQLX_OFFLINE=true ./scripts/test-isolated-db.sh --workdir backend -- cargo test --locked --test db_isolation_contract -- --nocapture` |
| `WU-02` | `SQLX_OFFLINE=true ./scripts/test-isolated-db.sh --workdir backend -- cargo test --locked --test producto_lifecycle_contract -- --nocapture` |
| `WU-03` | `SQLX_OFFLINE=true ./scripts/test-isolated-db.sh --workdir backend -- cargo test --locked --test package_identifier_contract -- --nocapture` |
| `WU-04` | `SQLX_OFFLINE=true ./scripts/test-isolated-db.sh --workdir backend -- cargo test --locked --test inventory_ledger_contract -- --nocapture` |
| `WU-05` | `SQLX_OFFLINE=true ./scripts/test-isolated-db.sh --workdir backend -- cargo test --locked --test readiness_policy_contract -- --nocapture` |
| `WU-06` | `SQLX_OFFLINE=true ./scripts/test-isolated-db.sh --workdir backend -- cargo test --locked --test idempotency_audit_contract -- --nocapture` |
| `WU-07` | `SQLX_OFFLINE=true ./scripts/test-isolated-db.sh --workdir backend -- cargo test --locked --test producto_api_contract -- --nocapture` |
| `WU-08` | `SQLX_OFFLINE=true ./scripts/test-isolated-db.sh --workdir backend -- cargo test --locked --test package_offer_api_contract -- --nocapture` |
| `WU-09` | `SQLX_OFFLINE=true ./scripts/test-isolated-db.sh --workdir backend -- cargo test --locked --test import_batch_contract -- --nocapture` |
| `WU-10` | `npm --prefix codigofuente/frontend test -- --run -t "[WU-10]"` |
| `WU-11` | `SQLX_OFFLINE=true ./scripts/test-isolated-db.sh --workdir backend -- cargo test --locked --test common_api_contract -- --nocapture` |
| `WU-12` | `SQLX_OFFLINE=true ./scripts/test-isolated-db.sh --workdir backend -- cargo test --locked --test receipt_atomic_contract -- --nocapture` |
| `WU-13` | `SQLX_OFFLINE=true ./scripts/test-isolated-db.sh --workdir backend -- cargo test --locked --test scanner_session_contract -- --nocapture` |
| `WU-14` | `npm --prefix codigofuente/frontend test -- --run -t "[WU-14]"` |
| `WU-15` | `npm --prefix codigofuente/frontend test -- --run -t "[WU-15]"` |
| `WU-16` | `npm --prefix codigofuente/frontend test -- --run -t "[WU-16]"` |
| `WU-17` | `npm --prefix codigofuente/frontend test -- --run -t "[WU-17]"` |
| `WU-18` | `SQLX_OFFLINE=true ./scripts/test-isolated-db.sh --workdir backend -- cargo test --locked --test count_atomic_contract -- --nocapture && npm --prefix codigofuente/frontend test -- --run -t "[WU-18]"` |
| `WU-19` | `npm --prefix codigofuente/frontend test -- --run -t "[WU-19]"` |
| `WU-20` | `npm --prefix codigofuente/frontend test -- --run -t "[WU-20]" && ./scripts/security-contracts.sh --filter WU-20` |
| `WU-21` | `npm --prefix codigofuente/frontend run test:a11y && npm --prefix codigofuente/frontend run test:perf` |
| `WU-22` | `./scripts/ops-contracts.sh --filter WU-22` |
| `WU-23` | `./scripts/runtime-smoke.sh --expected-sha "$GIT_SHA" && ./scripts/release-evidence.sh --expected-sha "$GIT_SHA"` |

Para cada comportamiento:

1. **RED:** test falla por la razón esperada; registrar output exacto.
2. **GREEN:** mínimo cambio; test enfocado pasa y DB/refetch/audit prueban efecto.
3. **REFACTOR:** limpiar ownership/nombres/duplicación; repetir enfocado y gates afectados.
4. Normalizadores mutantes (`fmt`, codegen) se ejecutan **antes** de congelar/revisar identidad.
5. Después del review start, solo checks no mutantes; cualquier byte/path/mode cambiado invalida la evidencia.

### 8.6 Contrato de CI/CD

`OPS-CI-001`: PR obligatorio con jobs:

1. checkout por SHA y lockfile verification;
2. secret scan, policy de archivos, `TEST-DOC-001/002` y markdown lint;
3. frontend install/test/lint/typecheck/build;
4. backend fmt/check/clippy/build y tests exclusivamente vía `scripts/test-isolated-db.sh` con PostgreSQL efímero;
5. migration fresh + seed sintético;
6. OpenAPI generate y `git diff --exit-code` para generated client;
7. router/route/destination contract manifest;
8. integration runtime y E2E crítico;
9. image build fijada por digest, SBOM, vulnerability scan bajo política, provenance/signature;
10. upload del artefacto inmutable con SHA.

No se permite `continue-on-error` en P0/P1, tests ignorados críticos ni baseline Clippy/lint creciente. Si se adopta baseline transitorio, cada warning tiene owner/expiry y el conteo solo puede disminuir; el gate actual debe llegar a cero antes de GO salvo excepción formal no P0/P1.

### 8.7 Configuración, secretos y seguridad defensiva

| ID | Requisito |
| --- | --- |
| `OPS-CONFIG-001` | `JWT_SECRET` y `JWT_REFRESH_SECRET` son distintos, requeridos y declarados por nombre en secret manager/manifiesto; nunca valores en git/log. |
| `OPS-CONFIG-002` | Producción falla al iniciar si una integración operacional habilitada conserva credencial/default mock. WhatsApp V1 no tiene provider config ni estado “enabled”: es solo handoff externo. |
| `OPS-CONFIG-003` | `pin_kiosko` se almacena con Argon2id/salt, nunca se devuelve; verify aplica rate limit y audit sin PIN. |
| `OPS-CONFIG-004` | Discovery IA usa providers/hosts allowlisted; valida scheme, puerto, DNS final, IPs privadas/link-local/loopback y cada redirect; egress de infraestructura limita destinos. |
| `OPS-CONFIG-005` | CORS exacto por entorno; wildcard solo en desarrollo explícito. CSP/headers existentes se conservan y prueban. |
| `OPS-CONFIG-006` | Rate limit se aplica una vez por request, contrato 429 común; si hay múltiples instancias, store distribuido. |
| `OPS-CONFIG-007` | Logs y audit redactan Authorization, cookies, passwords, PIN, API keys, tokens scanner y signed upload URLs. |

### 8.8 Uploads, backups y recuperación

| ID | Objetivo operativo inicial |
| --- | --- |
| `OPS-STORAGE-001` | Object storage durable con encryption at rest/in transit, keys no predecibles, MIME allowlist, checksum y retención. |
| `OPS-STORAGE-002` | Signed upload/download con TTL corto; acceso mediado por capability; metadata DB referencia `upload_id`, no path local. |
| `OPS-STORAGE-003` | Cleanup idempotente de uploads no linked vencidos; nunca borra linked por carrera. |
| `OPS-BACKUP-001` | PostgreSQL con PITR; objetivo provisional **RPO ≤15 min**, **RTO ≤4 h**. Cualquier cambio requiere aprobación documentada. |
| `OPS-BACKUP-002` | Object storage con versioning/retention compatible; backup/manifest permite reconstruir enlaces DB↔objeto. |
| `OPS-BACKUP-003` | Restore drill trimestral y antes del primer GO; ambiente aislado; checksum/conteos y smoke funcional. |
| `OPS-BACKUP-004` | Runbook asigna owner, acceso, rotación, retención, criterio de incidente y comunicación. |

Un backup “disponible por el proveedor” sin restore demostrado NO satisface el gate.

### 8.9 Deploy, migraciones y rollback de release

1. Build produce imagen inmutable con `GIT_SHA`, build ID y schema version.
2. Predeploy verifica backup reciente, compatibilidad y locks/timeout; aplica migraciones fail-closed.
3. Ninguna migración destructiva/reset de desarrollo puede ejecutarse en production mode.
4. El servicio nuevo entra con `/ready` no preparado hasta completar migración y dependencias.
5. Smoke por SHA prueba login, auth/RBAC, product read, receipt/stock sintético controlado o check no destructivo equivalente, upload read y readiness.
6. La plataforma revalida head/artefacto antes de publicar; no usa tags flotantes sin política/digest.
7. Rollback de binario solo si schema es backward-compatible. Si no, ejecutar roll-forward previsto; restauración es último recurso según runbook.
8. Postdeploy observa métricas y errores durante ventana definida; cualquier P0 activa rollback/containment.

`OPS-MIGRATION-002`: aunque la base de desarrollo se recrea, el primer esquema productivo debe nacer desde una migración/baseline reproducible. No se promueve una DB manual. `OPS-MIGRATION-003`: la copia raíz incompleta de migraciones se elimina o se genera automáticamente desde la fuente efectiva `backend/migrations`; nunca existen dos autoridades humanas. `OPS-MIGRATION-004`: requisito P3: cada migración registra solo ID, duración, status, schema/build SHA y hash SHA-256 del artefacto; incluso en debug queda prohibido imprimir SQL consolidado completo, parámetros o valores. `TEST-OPS-008` usa canarios y límites de tamaño/redacción.

### 8.10 Observabilidad y alertas

| ID | Señal/alerta mínima |
| --- | --- |
| `OPS-OBS-001` | Logs JSON: request_id, operation_id, correlation_id, actor ID, route template, status, latency, build SHA; sin secretos. |
| `OPS-OBS-002` | 5xx por endpoint/SHA; alerta inicial >2% durante 5 min o cualquier spike P0. |
| `OPS-OBS-003` | Latencia p50/p95/p99; alerta p95 >2 s en commands críticos durante 10 min, ajustable con baseline. |
| `OPS-OBS-004` | Pool DB: used/idle/wait/timeouts; alerta saturación >80% o wait sostenido. |
| `OPS-OBS-005` | Idempotency claims/replays/mismatches/in-progress timeout; mismatch cruza threshold de seguridad. |
| `OPS-OBS-006` | Imports: rows by outcome, commit latency, rollback/failure; cualquier rollback con UI success sería alerta P0 y test imposible. |
| `OPS-OBS-007` | Ledger reconciliation mismatch y balance rebuild; cualquier mismatch bloquea release/operación afectada. |
| `OPS-OBS-008` | Outbox lag/attempts/dead letters; alerta lag >60 s en eventos operativos. |
| `OPS-OBS-009` | Upload initiate/verify/link/failure/orphan/storage capacity. |
| `OPS-OBS-010` | Readiness/liveness/migration duration y status; readiness fail retira instancia. |
| `OPS-OBS-011` | Frontend error boundary/API errors por route/build SHA; no registrar payload sensible. |
| `OPS-OBS-012` | Migraciones por ID/duración/hash/status; nunca SQL/valores, con alerta de timeout por ID. |

Dashboards mínimos: Release health, Inventory integrity, Imports, Storage/uploads, Auth/security, DB/pool. Cada alerta tiene runbook, owner y acción verificable.

### 8.11 Rollout funcional

| Etapa | Alcance | Entrada | Salida |
| --- | --- | --- | --- |
| 0 Contención | Flags/guards P0 | Defectos reproducidos | Acciones peligrosas bloqueadas. |
| 1 Foundations | DB/test/CI/domain | WU-01 | Fresh migration, core invariants verdes. |
| 2 Backend vertical | Product/ledger/platform/import/receipt | WU-02..13 | OpenAPI y integration verde; legacy frozen. |
| 3 Frontend vertical | Shared + rutas por dependencias | WU-14 | Cada ruta tiene state/RBAC/E2E; flags se abren una por una. |
| 4 Staging | Imagen/DB/storage reales no productivos | Todos WU behavior | Smoke, fault injection defensiva, restore drill. |
| 5 Candidate | SHA inmutable | P0/P1 cero | Review/receipt/gates válidos. |
| 6 Production | Publicación controlada | GO formal | Monitor window, smoke exacto, rollback ready. |

No se hace dual-write prolongado entre stock legacy y ledger nuevo: en desarrollo se corta sobre DB recreada. No se habilita una UI que escriba nuevo mientras otra ruta escribe legacy.

### 8.12 Gate NO-GO / GO de producción

#### NO-GO inmediato si cualquiera es verdadero

- [ ] Existe cualquier P0 o P1 abierto de este documento.
- [ ] Approval puede cambiar ledger/balance/package histórico.
- [ ] PUT destructivo o tipos de estado divergentes siguen accesibles.
- [ ] Idempotencia cruza actor/ruta/hash o tests concurrentes fallan.
- [ ] Import/receipt/count puede mostrar éxito distinto de persistencia.
- [ ] Scanner/config/SSRF/PIN/authorization no tienen controles y tests.
- [ ] `fmt`, `check --all-targets`, Clippy, backend tests, frontend tests/lint/typecheck/build o E2E crítico están rojos.
- [ ] Tests pueden alcanzar DB remota por dotenv implícito.
- [ ] Uploads no son durables o restore no fue demostrado.
- [ ] Readiness devuelve 2xx sin dependencia obligatoria.
- [ ] Manifiesto omite secreto requerido o permite defaults mock activos.
- [ ] No existe SHA/SBOM/provenance/receipt válido del artefacto exacto.
- [ ] No hay backup/restore dentro de RPO/RTO o runbook/owner.

#### GO solo con evidencia acumulativa

- [ ] `DB-INV-001..020` y `DOM-STATE/READY` relevantes tienen pruebas verdes.
- [ ] Ejemplo TSH completo se crea, aprueba, ofrece, recibe y reconcilia en un E2E DB/API/UI.
- [ ] Las 23 rutas, 16 grupos y 50 destinos están en manifest y tests por capacidad/estado.
- [ ] Todos los falsos éxitos de 4.2.3 son imposibles o se muestran como partial/unknown exacto.
- [ ] Fresh PostgreSQL aplica migraciones desde cero y no conserva tablas/paths legacy declarados eliminados.
- [ ] Cliente OpenAPI generado no tiene diff y no existen interfaces paralelas en superficies migradas.
- [ ] Todos los comandos de 8.5 terminan 0 sobre el SHA candidato.
- [ ] Imagen staging por digest/SHA pasa smoke, DB-down readiness y persistencia upload tras restart.
- [ ] Restore drill DB+objetos satisface RPO/RTO y deja evidencia fechada.
- [ ] Métricas/alertas/runbooks/owners están activos.
- [ ] Review content-bound y gates pre-commit/pre-push/pre-PR/release permiten exactamente los mismos bytes.
- [ ] No hay excepción implícita; cualquier P2 diferido tiene owner, fecha, riesgo y no debilita P0/P1.

### 8.13 Matriz final de trazabilidad de riesgos a work units

| Riesgo/familia | Requisitos principales | Work units | Gate |
| --- | --- | --- | --- |
| Producto destructivo/estado/zombi | `DOM-P0-001/002`, `API-P0-001`, `DB-P0-001` | 00,02,07,15 | `TEST-DOM-001..003`, `TEST-API-001` |
| Package/códigos/coherencia | `DB-P0-002/003`, `API-P0-004` | 03,08,12,15 | `TEST-DB-001`, `TEST-API-002..004` |
| Ledger/snapshot/decimales | `DB-INV-005..009`, `DOM-MONEY-DEC-001` | 04,11,16 | `TEST-DB-002..004` |
| Idempotencia/audit | `OPS-P0-001`, `API-IDEMPOTENCY-*` | 06 y adopción en 07/09/12/18 | `TEST-IDEMPOTENCY-*` |
| Import/template/readiness | `API-P0-002/003`, `API-IMPORT-*`, `DOM-READY-*` | 05,09,10 | `TEST-API-006/007`, `TEST-UI-008` |
| Recepción/partial/upload | `UI-RECEPCIONES-P0-*`, `API-RECEIPT-*` | 12,17,22 | `TEST-API-005`, `TEST-UI-005`, `TEST-OPS-005` |
| Scanner | `UI-SCAN-P0-001`, `API-SCAN-*` | 13,17 | `TEST-UI-006` |
| Config/RBAC/SSRF/PIN | `UI-CONFIG-P0-001`, `DOM-RBAC-DEC-001` | 11,20,22 | `TEST-UI-001`, `TEST-OPS-002/003` |
| Falsos vacíos/paginación | `UI-STATE-P1-001`, `API-PAGINATION-P1-001` | 11,14,16..20 | `TEST-UI-003`, `TEST-API-008` |
| Conteo/procurement | `UI-CONTEO-P1-001`, offers/ownership | 18,19 | `TEST-UI-007/009` |
| Release/DB isolation/recovery | `OPS-P1-*`, `OPS-*` | 01,21,22,23 | `TEST-OPS-*` + 8.5 |

### 8.14 Definition of Done por requisito

Un ID solo cambia a `verified` cuando el PR/work unit adjunta:

1. escenario Given/When/Then o test equivalente;
2. evidencia RED de la conducta ausente/defectuosa;
3. GREEN del test enfocado;
4. gates afectados en cero;
5. runtime harness y resultado exacto, o `N/A` justificado si no existe boundary runtime;
6. efecto persistido/refetch/audit verificado;
7. rollback boundary independiente del commit;
8. paths y generated artifacts incluidos en identidad/review;
9. documentación/manifest actualizado;
10. no regresión de seguridad, a11y, performance o observabilidad aplicable.

### 8.15 Resultado final esperado del programa

Al completar esta especificación, “Producto” deja de ser una fila interpretada de forma distinta por cada capa y pasa a ser un agregado con identidad, estado, packaging y readiness verificables. Inventario expresa hechos inmutables y un saldo reconstruible. Importar, recibir, contar, consumir y configurar dejan de declarar éxito por intención o por status HTTP: el sistema puede demostrar qué persistió, quién lo hizo, bajo qué versión y cómo se recupera.

Hasta que esa evidencia exista para el SHA candidato, el veredicto permanece **NO-GO**.
